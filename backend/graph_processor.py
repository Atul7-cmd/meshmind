"""graph_processor.py - validate and analyse the graph returned by the AI.

Graph model
-----------
The architecture is a directed graph  G = (V, E)  where

* V (vertices) = infrastructure components: services and databases.
* E (edges)    = ordered pairs (u, v): "u depends on / calls / writes to v".

Direction matters: (A, B) is not the same edge as (B, A).  The graph is NOT
assumed to be acyclic and it may be disconnected.

This module uses only the Python standard library, so it can be tested
without installing FastAPI.  It never trusts its input: every value coming
from the AI is checked, cleaned and either accepted, repaired (with a
warning) or rejected.
"""
from __future__ import annotations

import re
from collections import deque
from typing import Any

MAX_NODES = 100
MAX_EDGES = 300
MAX_LABEL_LEN = 80
MAX_EDGE_LABEL_LEN = 60
MAX_SUMMARY_LEN = 600
MAX_CYCLES_REPORTED = 10
DEFAULT_EDGE_LABEL = "depends on"

NODE_TYPES = ("service", "database")

_TYPE_ALIASES = {
    "service": "service",
    "services": "service",
    "microservice": "service",
    "api": "service",
    "app": "service",
    "application": "service",
    "backend": "service",
    "server": "service",
    "database": "database",
    "databases": "database",
    "db": "database",
    "data base": "database",
    "datastore": "database",
    "data store": "database",
}


class GraphValidationError(Exception):
    """Raised when the graph cannot be used. Messages are safe to show to users."""

    def __init__(self, public_message: str, *, code: str = "invalid_graph", status_code: int = 422):
        super().__init__(public_message)
        self.public_message = public_message
        self.code = code
        self.status_code = status_code


# --------------------------------------------------------------------------
# Small text helpers
# --------------------------------------------------------------------------
def _clean_text(value: Any, max_len: int) -> str:
    """Return a single-line, printable, length-limited string ('' if not a string)."""
    if not isinstance(value, str):
        return ""
    text = re.sub(r"\s+", " ", value).strip()
    text = "".join(ch for ch in text if ch.isprintable())
    return text[:max_len].rstrip()


def slugify(value: Any) -> str:
    """'Auth Database' -> 'auth_database'. Returns '' if nothing usable remains."""
    if not isinstance(value, str):
        return ""
    return re.sub(r"[^a-z0-9]+", "_", value.casefold()).strip("_")[:50]


def _normalise_type(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    key = re.sub(r"[-_]+", " ", value.casefold()).strip()
    return _TYPE_ALIASES.get(key)


# --------------------------------------------------------------------------
# Step 1 - nodes: unique ids, duplicate detection
# --------------------------------------------------------------------------
def _normalise_nodes(raw_nodes: list, warnings: list[str]) -> tuple[list[dict], dict[str, str]]:
    """Return (clean_nodes, lookup).

    `lookup` maps every name an edge might use (declared id, slug of the label,
    lower-cased label) to the canonical node id, so edges that refer to a
    component by label - or by the id of a merged duplicate - still resolve.
    """
    nodes: list[dict] = []
    by_id: dict[str, dict] = {}
    by_label: dict[str, dict] = {}
    lookup: dict[str, str] = {}

    def remember(name: str, node_id: str) -> None:
        if name:
            lookup.setdefault(name, node_id)  # earlier nodes win

    for position, raw in enumerate(raw_nodes, start=1):
        if not isinstance(raw, dict):
            warnings.append(f"Ignored component #{position}: it is not an object.")
            continue

        label = _clean_text(raw.get("label"), MAX_LABEL_LEN) or _clean_text(raw.get("id"), MAX_LABEL_LEN)
        if not label:
            warnings.append(f"Ignored component #{position}: it has no name.")
            continue

        node_type = _normalise_type(raw.get("type"))
        if node_type is None:
            warnings.append(f"Ignored '{label}': its type must be 'service' or 'database'.")
            continue

        declared_id = slugify(raw.get("id"))
        label_slug = slugify(label)
        label_key = label.casefold()
        node_id = declared_id or label_slug

        # Same label (or same id with the same label) -> duplicate: merge.
        existing = by_label.get(label_key)
        if existing is None and node_id in by_id and by_id[node_id]["label"].casefold() == label_key:
            existing = by_id[node_id]
        if existing is not None:
            warnings.append(f"Merged duplicate component '{label}' into '{existing['label']}'.")
            if existing["type"] != node_type:
                warnings.append(f"'{label}' was given two types; kept '{existing['type']}'.")
            remember(declared_id, existing["id"])
            remember(label_slug, existing["id"])
            remember(label_key, existing["id"])
            continue

        # Same id but a different label -> the AI reused an id. Make ours unique.
        if node_id in by_id:
            fresh = label_slug if label_slug and label_slug not in by_id else ""
            counter = 2
            while not fresh or fresh in by_id:
                fresh = f"{node_id or 'node'}_{counter}"
                counter += 1
            warnings.append(f"Id '{node_id}' was used for two components; '{label}' now uses '{fresh}'.")
            node_id = fresh
        elif not node_id:
            node_id = f"node_{position}"
            while node_id in by_id:
                node_id += "_x"

        node = {"id": node_id, "label": label, "type": node_type}
        nodes.append(node)
        by_id[node_id] = node
        by_label[label_key] = node
        remember(node_id, node_id)
        remember(declared_id, node_id)
        remember(label_slug, node_id)
        remember(label_key, node_id)

    return nodes, lookup


# --------------------------------------------------------------------------
# Step 2 - edges: valid references, no self loops, no repeated edges
# --------------------------------------------------------------------------
def _resolve(ref: Any, lookup: dict[str, str]) -> str | None:
    if not isinstance(ref, str):
        return None
    return lookup.get(slugify(ref)) or lookup.get(_clean_text(ref, MAX_LABEL_LEN).casefold())


def _normalise_edges(raw_edges: list, lookup: dict[str, str], warnings: list[str]) -> list[dict]:
    edges: list[dict] = []
    seen: set[tuple[str, str, str]] = set()

    for position, raw in enumerate(raw_edges, start=1):
        if not isinstance(raw, dict):
            warnings.append(f"Ignored connection #{position}: it is not an object.")
            continue

        source = _resolve(raw.get("source"), lookup)
        target = _resolve(raw.get("target"), lookup)
        if source is None or target is None:
            unknown = raw.get("source") if source is None else raw.get("target")
            shown = _clean_text(unknown, 40) or "(empty)"
            warnings.append(f"Ignored connection #{position}: '{shown}' is not a known component.")
            continue
        if source == target:
            warnings.append(f"Ignored connection #{position}: a component cannot depend on itself.")
            continue

        label = _clean_text(raw.get("label"), MAX_EDGE_LABEL_LEN) or DEFAULT_EDGE_LABEL
        key = (source, target, label.casefold())
        if key in seen:
            warnings.append(f"Ignored repeated connection '{source}' -> '{target}'.")
            continue
        seen.add(key)
        edges.append({"source": source, "target": target, "label": label})

    return edges


# --------------------------------------------------------------------------
# Step 3 - analysis: BFS for components, DFS for cycles
# --------------------------------------------------------------------------
def find_components(node_ids: list[str], edges: list[dict]) -> list[list[str]]:
    """Weakly connected components (edge direction ignored) using BFS."""
    neighbours: dict[str, set[str]] = {n: set() for n in node_ids}
    for edge in edges:
        neighbours[edge["source"]].add(edge["target"])
        neighbours[edge["target"]].add(edge["source"])

    order = {n: i for i, n in enumerate(node_ids)}
    seen: set[str] = set()
    components: list[list[str]] = []
    for start in node_ids:
        if start in seen:
            continue
        seen.add(start)
        queue = deque([start])
        members: list[str] = []
        while queue:
            current = queue.popleft()
            members.append(current)
            for nxt in neighbours[current]:
                if nxt not in seen:
                    seen.add(nxt)
                    queue.append(nxt)
        components.append(sorted(members, key=order.__getitem__))
    return components


_UNVISITED, _VISITING, _DONE = 0, 1, 2


def find_cycles(node_ids: list[str], edges: list[dict], limit: int = MAX_CYCLES_REPORTED) -> list[list[str]]:
    """Find circular dependencies with a depth-first search.

    A back edge (an edge to a node that is still on the DFS stack) closes a
    cycle.  Each cycle is returned as a closed path, e.g. ['a', 'b', 'a'].
    One cycle is reported per back edge; this is not every possible simple
    cycle (that count can be exponential), but every node that lies on a
    cycle is on at least one reported cycle.
    """
    adjacency: dict[str, list[str]] = {n: [] for n in node_ids}
    for edge in edges:
        adjacency[edge["source"]].append(edge["target"])

    state: dict[str, int] = {}
    path: list[str] = []
    cycles: list[list[str]] = []
    seen: set[tuple[str, ...]] = set()

    def visit(node: str) -> None:
        state[node] = _VISITING
        path.append(node)
        for nxt in adjacency[node]:
            status = state.get(nxt, _UNVISITED)
            if status == _UNVISITED:
                visit(nxt)
            elif status == _VISITING:
                cycle = path[path.index(nxt):]
                start = cycle.index(min(cycle))
                key = tuple(cycle[start:] + cycle[:start])  # same cycle, any start -> same key
                if key not in seen and len(cycles) < limit:
                    seen.add(key)
                    cycles.append(cycle + [nxt])
        path.pop()
        state[node] = _DONE

    for node in node_ids:  # recursion depth <= MAX_NODES (100), far below Python's limit
        if state.get(node, _UNVISITED) == _UNVISITED:
            visit(node)
    return cycles


# --------------------------------------------------------------------------
# Summary
# --------------------------------------------------------------------------
def _plural(count: int, singular: str, plural: str | None = None) -> str:
    return f"{count} {singular}" if count == 1 else f"{count} {plural or singular + 's'}"


def _build_summary(ai_summary: Any, services: int, databases: int, edge_count: int,
                   cycles: list[list[str]], labels: dict[str, str]) -> str:
    summary = _clean_text(ai_summary, MAX_SUMMARY_LEN)
    if not summary:
        summary = (
            f"The architecture contains {_plural(services, 'service')} and "
            f"{_plural(databases, 'database')} connected by {_plural(edge_count, 'dependency', 'dependencies')}."
        )
    if cycles:
        first = " → ".join(labels[n] for n in cycles[0])
        extra = f" (and {len(cycles) - 1} more)" if len(cycles) > 1 else ""
        summary += f" Circular dependency detected: {first}{extra}."
    return summary


# --------------------------------------------------------------------------
# Public entry point
# --------------------------------------------------------------------------
def build_graph(raw: Any) -> dict:
    """Validate the AI output and return {nodes, edges, summary, analysis}."""
    if not isinstance(raw, dict):
        raise GraphValidationError("The AI response was not a JSON object.",
                                   code="invalid_ai_response", status_code=502)
    raw_nodes = raw.get("nodes")
    if not isinstance(raw_nodes, list):
        raise GraphValidationError("The AI response did not include a list of components.",
                                   code="invalid_ai_response", status_code=502)
    raw_edges = raw.get("edges")
    if raw_edges is None:
        raw_edges = []
    if not isinstance(raw_edges, list):
        raise GraphValidationError("The AI response did not include a valid list of connections.",
                                   code="invalid_ai_response", status_code=502)

    if len(raw_nodes) > MAX_NODES or len(raw_edges) > MAX_EDGES:
        raise GraphValidationError(
            f"The description produced too large a graph (limit: {MAX_NODES} components, "
            f"{MAX_EDGES} connections). Split it into smaller parts.",
            code="graph_too_large",
        )

    warnings: list[str] = []
    nodes, lookup = _normalise_nodes(raw_nodes, warnings)
    if not nodes:
        raise GraphValidationError(
            "No services or databases were found in the description. Describe how your components "
            "connect, for example: 'The Order Service calls the Payment Service.'",
            code="no_components",
        )
    edges = _normalise_edges(raw_edges, lookup, warnings)

    node_ids = [n["id"] for n in nodes]
    labels = {n["id"]: n["label"] for n in nodes}
    services = sum(1 for n in nodes if n["type"] == "service")
    databases = len(nodes) - services

    components = find_components(node_ids, edges)
    cycles = find_cycles(node_ids, edges)
    connected = {e["source"] for e in edges} | {e["target"] for e in edges}
    isolated = [n for n in node_ids if n not in connected]
    if isolated:
        warnings.append("Not connected to anything: " + ", ".join(labels[n] for n in isolated) + ".")

    return {
        "nodes": nodes,
        "edges": edges,
        "summary": _build_summary(raw.get("summary"), services, databases, len(edges), cycles, labels),
        "analysis": {
            "vertex_count": len(nodes),
            "edge_count": len(edges),
            "service_count": services,
            "database_count": databases,
            "component_count": len(components),
            "components": components,
            "cycles": cycles,
            "has_cycles": bool(cycles),
            "isolated": isolated,
            "warnings": warnings,
        },
    }

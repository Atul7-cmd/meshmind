// graphLayout.js - pure functions (no React, no DOM) that turn a graph into coordinates.
//
// Layered ("Sugiyama-style") layout, left to right:
//   1. Find back edges with a DFS. Removing them leaves a DAG, so cycles never break the layout.
//   2. Rank every node by the longest path from a source (Kahn's algorithm). rank = column.
//   3. Order nodes inside each column with a few barycenter sweeps to reduce crossings.
//   4. Convert (rank, order) into x/y centre coordinates.
// Edge geometry helpers (curves, arrow clipping, labels) live here too, so they can be unit-tested.

export const NODE_WIDTH = 176;
export const NODE_HEIGHT = 68;
const GAP_X = 130;
const GAP_Y = 40;
const MARGIN = 56;
const EDGE_SPACING = 46; // distance between parallel edges that join the same two nodes
const BACK_EDGE_BEND = 90; // extra curve for edges that run against the main direction

export const edgeKey = (source, target) => `${source}->${target}`;

export function layoutGraph(nodes, edges) {
  if (!nodes.length) {
    return { positions: {}, width: 0, height: 0, backEdges: new Set() };
  }

  const ids = nodes.map((n) => n.id);
  const known = new Set(ids);
  const valid = edges.filter((e) => known.has(e.source) && known.has(e.target) && e.source !== e.target);

  const out = new Map(ids.map((id) => [id, []]));
  const inc = new Map(ids.map((id) => [id, []]));
  valid.forEach((e) => {
    out.get(e.source).push(e.target);
    inc.get(e.target).push(e.source);
  });

  // 1. Back edges (DFS, grey/black colouring)
  const state = new Map();
  const backEdges = new Set();
  const visit = (u) => {
    state.set(u, 1);
    for (const v of out.get(u)) {
      const s = state.get(v) || 0;
      if (s === 0) visit(v);
      else if (s === 1) backEdges.add(edgeKey(u, v));
    }
    state.set(u, 2);
  };
  const roots = ids.filter((id) => inc.get(id).length === 0);
  [...roots, ...ids].forEach((id) => {
    if (!state.get(id)) visit(id);
  });

  // 2. Longest-path ranks on the DAG that remains
  const forward = new Map(ids.map((id) => [id, []]));
  const indegree = new Map(ids.map((id) => [id, 0]));
  valid.forEach((e) => {
    if (backEdges.has(edgeKey(e.source, e.target))) return;
    forward.get(e.source).push(e.target);
    indegree.set(e.target, indegree.get(e.target) + 1);
  });
  const rank = new Map(ids.map((id) => [id, 0]));
  const queue = ids.filter((id) => indegree.get(id) === 0);
  while (queue.length) {
    const u = queue.shift();
    for (const v of forward.get(u)) {
      rank.set(v, Math.max(rank.get(v), rank.get(u) + 1));
      indegree.set(v, indegree.get(v) - 1);
      if (indegree.get(v) === 0) queue.push(v);
    }
  }

  // Keep each disconnected component together: initial order = (component, input order)
  const parent = new Map(ids.map((id) => [id, id]));
  const find = (x) => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)));
      x = parent.get(x);
    }
    return x;
  };
  valid.forEach((e) => parent.set(find(e.source), find(e.target)));
  const componentIndex = new Map();
  ids.forEach((id) => {
    const root = find(id);
    if (!componentIndex.has(root)) componentIndex.set(root, componentIndex.size);
  });
  const inputIndex = new Map(ids.map((id, i) => [id, i]));
  const initialOrder = (a, b) =>
    componentIndex.get(find(a)) - componentIndex.get(find(b)) || inputIndex.get(a) - inputIndex.get(b);

  const maxRank = Math.max(...rank.values());
  const layers = Array.from({ length: maxRank + 1 }, () => []);
  ids.forEach((id) => layers[rank.get(id)].push(id));
  layers.forEach((layer) => layer.sort(initialOrder));

  // 3. Barycenter sweeps (down, up, down, up)
  const order = new Map();
  const reindex = (layer) => layer.forEach((id, i) => order.set(id, i));
  layers.forEach(reindex);
  for (let pass = 0; pass < 4; pass++) {
    const down = pass % 2 === 0;
    const sequence = down ? layers.map((_, r) => r) : layers.map((_, r) => maxRank - r);
    for (const r of sequence) {
      const layer = layers[r];
      const score = new Map();
      layer.forEach((id) => {
        const neighbours = [...out.get(id), ...inc.get(id)].filter((n) =>
          down ? rank.get(n) < r : rank.get(n) > r
        );
        const mean = neighbours.length
          ? neighbours.reduce((sum, n) => sum + order.get(n), 0) / neighbours.length
          : order.get(id);
        score.set(id, mean);
      });
      layer.sort((a, b) => score.get(a) - score.get(b) || order.get(a) - order.get(b));
      reindex(layer);
    }
  }

  // 4. Coordinates (node centres)
  const tallest = Math.max(...layers.map((l) => l.length));
  const columnHeight = (count) => count * NODE_HEIGHT + (count - 1) * GAP_Y;
  const totalHeight = columnHeight(tallest);
  const positions = {};
  layers.forEach((layer, r) => {
    const top = MARGIN + (totalHeight - columnHeight(layer.length)) / 2;
    layer.forEach((id, i) => {
      positions[id] = {
        x: MARGIN + NODE_WIDTH / 2 + r * (NODE_WIDTH + GAP_X),
        y: top + NODE_HEIGHT / 2 + i * (NODE_HEIGHT + GAP_Y),
      };
    });
  });

  return {
    positions,
    width: 2 * MARGIN + (maxRank + 1) * NODE_WIDTH + maxRank * GAP_X,
    height: 2 * MARGIN + totalHeight,
    backEdges,
  };
}

// How far each edge should bend so parallel / opposite edges do not overlap.
// Returns one number per edge (same order). 0 = straight line.
export function computeEdgeBends(edges, backEdges = new Set()) {
  const groups = new Map();
  edges.forEach((e, i) => {
    const key = [e.source, e.target].sort().join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(i);
  });
  const bends = new Array(edges.length).fill(0);
  groups.forEach((indexes) => {
    indexes.forEach((edgeIndex, slot) => {
      const e = edges[edgeIndex];
      // Offsets are defined in a frame shared by both directions (smaller id -> larger id);
      // flipping the sign for the reverse direction keeps A->B and B->A on opposite sides.
      const sign = e.source < e.target ? 1 : -1;
      let bend = (slot - (indexes.length - 1) / 2) * EDGE_SPACING * sign;
      if (backEdges.has(edgeKey(e.source, e.target))) bend += BACK_EDGE_BEND * sign;
      bends[edgeIndex] = bend;
    });
  });
  return bends;
}

// Point where a ray from the centre of a width x height box toward `toward` leaves the box.
export function clipToBox(center, toward, width = NODE_WIDTH, height = NODE_HEIGHT) {
  const dx = toward.x - center.x;
  const dy = toward.y - center.y;
  if (dx === 0 && dy === 0) return { ...center };
  const tx = dx === 0 ? Infinity : width / 2 / Math.abs(dx);
  const ty = dy === 0 ? Infinity : height / 2 / Math.abs(dy);
  const t = Math.min(tx, ty);
  return { x: center.x + dx * t, y: center.y + dy * t };
}

// SVG path + label anchor for an edge from `from` to `to` (node centres).
export function computeEdgeGeometry(from, to, bend = 0) {
  const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const normal = { x: -dy / length, y: dx / length };
  // A quadratic curve's midpoint moves by half the control-point offset, so double it.
  const control = { x: mid.x + normal.x * bend * 2, y: mid.y + normal.y * bend * 2 };
  const start = clipToBox(from, control);
  const end = clipToBox(to, control);
  return {
    d: `M ${start.x.toFixed(1)} ${start.y.toFixed(1)} Q ${control.x.toFixed(1)} ${control.y.toFixed(1)} ${end.x.toFixed(1)} ${end.y.toFixed(1)}`,
    labelX: 0.25 * start.x + 0.5 * control.x + 0.25 * end.x,
    labelY: 0.25 * start.y + 0.5 * control.y + 0.25 * end.y,
    start,
    end,
  };
}

// Split a label into at most `maxLines` lines of about `maxChars` characters.
export function wrapLabel(label, maxChars = 20, maxLines = 2) {
  const words = String(label).split(/\s+/).filter(Boolean);
  const lines = [];
  let current = "";
  const push = (text) => lines.push(text);
  for (let word of words) {
    while (word.length > maxChars) {
      if (current) {
        push(current);
        current = "";
      }
      push(word.slice(0, maxChars));
      word = word.slice(maxChars);
    }
    if (!current) current = word;
    else if ((current + " " + word).length <= maxChars) current += " " + word;
    else {
      push(current);
      current = word;
    }
  }
  if (current) push(current);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    const last = kept[maxLines - 1];
    kept[maxLines - 1] = (last.length >= maxChars ? last.slice(0, maxChars - 1) : last) + "…";
    return kept;
  }
  return lines.length ? lines : [""];
}

// Cycle edge keys ("a->b") from the backend's cycle paths, e.g. [["a","b","a"]].
export function cycleEdgeKeys(cycles = []) {
  const keys = new Set();
  cycles.forEach((path) => {
    for (let i = 0; i < path.length - 1; i++) keys.add(edgeKey(path[i], path[i + 1]));
  });
  return keys;
}

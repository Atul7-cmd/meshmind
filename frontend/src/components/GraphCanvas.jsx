import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  NODE_HEIGHT,
  NODE_WIDTH,
  computeEdgeBends,
  computeEdgeGeometry,
  cycleEdgeKeys,
  edgeKey,
  layoutGraph,
  shortenLabel,
  wrapLabel,
} from "../services/graphLayout.js";

const MIN_ZOOM = 0.15; // low enough for a wide graph to fit on a phone
const MAX_ZOOM = 2.5;
const DRAG_THRESHOLD = 4; // pixels before a press counts as a drag instead of a click
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function DatabaseShape() {
  const ry = 10;
  const w = NODE_WIDTH;
  const h = NODE_HEIGHT;
  return (
    <>
      <path
        className="node__shape"
        d={`M 0 ${ry} A ${w / 2} ${ry} 0 0 1 ${w} ${ry} V ${h - ry} A ${w / 2} ${ry} 0 0 1 0 ${h - ry} Z`}
      />
      <ellipse className="node__lid" cx={w / 2} cy={ry} rx={w / 2} ry={ry} />
    </>
  );
}

export default function GraphCanvas({
  graph,
  selectedId,
  onSelect,
  loading,
  canRegenerate,
  onRegenerate,
  onExport,
  onClearGraph,
}) {
  const containerRef = useRef(null);
  const svgRef = useRef(null);
  const interaction = useRef(null); // the pointer gesture in progress (pan or node drag)
  const userMoved = useRef(false); // true once the person has panned/zoomed/dragged

  const [view, setView] = useState({ k: 1, x: 0, y: 0 }); // zoom factor and pan offset
  const [dragged, setDragged] = useState({}); // node id -> position chosen by dragging

  const layout = useMemo(() => (graph ? layoutGraph(graph.nodes, graph.edges) : null), [graph]);
  const positions = useMemo(() => (layout ? { ...layout.positions, ...dragged } : {}), [layout, dragged]);
  const bends = useMemo(
    () => (graph && layout ? computeEdgeBends(graph.edges, layout.backEdges) : []),
    [graph, layout]
  );
  const cycleKeys = useMemo(() => cycleEdgeKeys(graph?.analysis?.cycles), [graph]);
  const neighbours = useMemo(() => {
    const set = new Set();
    if (graph && selectedId) {
      graph.edges.forEach((e) => {
        if (e.source === selectedId) set.add(e.target);
        if (e.target === selectedId) set.add(e.source);
      });
    }
    return set;
  }, [graph, selectedId]);

  // ---- zoom / fit -------------------------------------------------------
  const fit = useCallback(() => {
    const el = containerRef.current;
    if (!el || !layout || !layout.width) return;
    const { width, height } = el.getBoundingClientRect();
    const pad = 24;
    const k = clamp(
      Math.min((width - pad * 2) / layout.width, (height - pad * 2) / layout.height, 1.25),
      MIN_ZOOM,
      MAX_ZOOM
    );
    setView({ k, x: (width - layout.width * k) / 2, y: (height - layout.height * k) / 2 });
    userMoved.current = false;
  }, [layout]);

  // New graph -> forget dragged positions and fit it into view.
  useLayoutEffect(() => {
    setDragged({});
    fit();
  }, [fit]);

  // Keep the graph fitted when the container resizes, unless the person has moved it.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(() => {
      if (!userMoved.current) fit();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [fit]);

  const zoomBy = useCallback((factor, cx, cy) => {
    const el = containerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const px = cx ?? rect.width / 2;
    const py = cy ?? rect.height / 2;
    userMoved.current = true;
    setView((v) => {
      const k = clamp(v.k * factor, MIN_ZOOM, MAX_ZOOM);
      const ratio = k / v.k;
      return { k, x: px - (px - v.x) * ratio, y: py - (py - v.y) * ratio }; // zoom around (px, py)
    });
  }, []);

  // Ctrl/Cmd + wheel (also trackpad pinch) zooms. Needs a non-passive listener to call preventDefault.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const onWheel = (event) => {
      if (!(event.ctrlKey || event.metaKey)) return;
      event.preventDefault();
      const rect = el.getBoundingClientRect();
      zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1, event.clientX - rect.left, event.clientY - rect.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomBy]);

  // ---- pointer interaction: pan the background or drag a node --------------
  const startPan = (event) => {
    if (event.button !== 0) return;
    interaction.current = {
      type: "pan",
      startX: event.clientX,
      startY: event.clientY,
      origin: { x: view.x, y: view.y },
      moved: false,
    };
    svgRef.current.setPointerCapture(event.pointerId);
  };

  const startNodeDrag = (event, id) => {
    if (event.button !== 0) return;
    event.stopPropagation();
    interaction.current = {
      type: "node",
      id,
      startX: event.clientX,
      startY: event.clientY,
      origin: { ...positions[id] },
      moved: false,
    };
    svgRef.current.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event) => {
    const it = interaction.current;
    if (!it) return;
    const dx = event.clientX - it.startX;
    const dy = event.clientY - it.startY;
    if (!it.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    it.moved = true;
    userMoved.current = true;
    if (it.type === "pan") {
      setView((v) => ({ ...v, x: it.origin.x + dx, y: it.origin.y + dy }));
    } else {
      setDragged((d) => ({ ...d, [it.id]: { x: it.origin.x + dx / view.k, y: it.origin.y + dy / view.k } }));
    }
  };

  const endPointer = (event, cancelled = false) => {
    const it = interaction.current;
    interaction.current = null;
    if (svgRef.current?.hasPointerCapture?.(event.pointerId)) {
      svgRef.current.releasePointerCapture(event.pointerId);
    }
    if (!it || it.moved || cancelled) return;
    onSelect(it.type === "node" ? it.id : null); // a plain click selects a node or clears the selection
  };

  const onNodeKeyDown = (event, id) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onSelect(id);
    }
  };

  const hasGraph = Boolean(graph && layout);

  return (
    <section className="panel canvas-panel" aria-labelledby="graph-title">
      <div className="canvas-toolbar">
        <h2 id="graph-title">Dependency graph</h2>
        <div className="canvas-toolbar__group">
          <button type="button" className="btn btn--small btn--icon" onClick={() => zoomBy(1 / 1.2)} disabled={!hasGraph} aria-label="Zoom out">
            −
          </button>
          <button type="button" className="btn btn--small btn--icon" onClick={() => zoomBy(1.2)} disabled={!hasGraph} aria-label="Zoom in">
            +
          </button>
          <button type="button" className="btn btn--small" onClick={fit} disabled={!hasGraph}>
            Fit
          </button>
          <button type="button" className="btn btn--small" onClick={onRegenerate} disabled={!canRegenerate}>
            Regenerate
          </button>
          <button type="button" className="btn btn--small" onClick={onExport} disabled={!hasGraph}>
            Export JSON
          </button>
          <button type="button" className="btn btn--small btn--quiet" onClick={onClearGraph} disabled={!hasGraph}>
            Clear graph
          </button>
        </div>
      </div>

      <div className="canvas" ref={containerRef}>
        {hasGraph && (
          <svg
            ref={svgRef}
            className="canvas__svg"
            role="group"
            aria-label={`Dependency graph with ${graph.nodes.length} components and ${graph.edges.length} connections`}
            onPointerDown={startPan}
            onPointerMove={onPointerMove}
            onPointerUp={endPointer}
            onPointerCancel={(e) => endPointer(e, true)}
          >
            <defs>
              {["base", "active", "cycle"].map((tone) => (
                <marker
                  key={tone}
                  id={`mm-arrow-${tone}`}
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" className={`arrow arrow--${tone}`} />
                </marker>
              ))}
            </defs>

            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              <g className="edges">
                {graph.edges.map((edge, i) => {
                  const from = positions[edge.source];
                  const to = positions[edge.target];
                  if (!from || !to) return null;
                  const geometry = computeEdgeGeometry(from, to, bends[i]);
                  const key = edgeKey(edge.source, edge.target);
                  const connected = selectedId && (edge.source === selectedId || edge.target === selectedId);
                  const tone = connected ? "active" : cycleKeys.has(key) ? "cycle" : "base";
                  const dim = selectedId && !connected;
                  return (
                    <g key={`${key}-${i}`} className={`edge edge--${tone}${dim ? " is-dim" : ""}`}>
                      <path d={geometry.d} markerEnd={`url(#mm-arrow-${tone})`} />
                      <text className="edge__label" x={geometry.labelX} y={geometry.labelY - 5} textAnchor="middle">
                        <title>{edge.label}</title>
                        {shortenLabel(edge.label)}
                      </text>
                    </g>
                  );
                })}
              </g>

              <g className="nodes">
                {graph.nodes.map((node) => {
                  const pos = positions[node.id];
                  if (!pos) return null;
                  const lines = wrapLabel(node.label);
                  const selected = node.id === selectedId;
                  const dim = selectedId && !selected && !neighbours.has(node.id);
                  const firstLineY = NODE_HEIGHT / 2 + 5 - ((lines.length - 1) * 17) / 2 + (node.type === "database" ? 4 : 0);
                  return (
                    <g
                      key={node.id}
                      className={`node node--${node.type}${selected ? " is-selected" : ""}${dim ? " is-dim" : ""}`}
                      transform={`translate(${pos.x - NODE_WIDTH / 2} ${pos.y - NODE_HEIGHT / 2})`}
                      tabIndex={0}
                      role="button"
                      aria-pressed={selected}
                      aria-label={`${node.label}, ${node.type}`}
                      onPointerDown={(e) => startNodeDrag(e, node.id)}
                      onKeyDown={(e) => onNodeKeyDown(e, node.id)}
                    >
                      <title>{`${node.label} (${node.type})`}</title>
                      {node.type === "database" ? (
                        <DatabaseShape />
                      ) : (
                        <rect className="node__shape" width={NODE_WIDTH} height={NODE_HEIGHT} rx="12" />
                      )}
                      <text className="node__label" textAnchor="middle">
                        {lines.map((line, i) => (
                          <tspan key={i} x={NODE_WIDTH / 2} y={firstLineY + i * 17}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </g>
            </g>
          </svg>
        )}

        {!hasGraph && !loading && (
          <div className="canvas__empty">
            <p className="canvas__empty-title">Your graph will appear here</p>
            <p>Describe your infrastructure on the left, then select Generate Graph. Try the example to see how it works.</p>
          </div>
        )}

        {loading && (
          <div className="canvas__overlay" role="status">
            <span className="spinner spinner--large" aria-hidden="true" />
            <span>Analysing your description with Gemini</span>
          </div>
        )}
      </div>

      <div className="canvas-footer">
        <ul className="legend" aria-label="Legend">
          <li><span className="legend__swatch legend__swatch--service" />Service</li>
          <li><span className="legend__swatch legend__swatch--database" />Database</li>
          <li><span className="legend__swatch legend__swatch--cycle" />Circular dependency</li>
        </ul>
        <p className="text-muted canvas-footer__hint">
          Drag nodes to rearrange, drag the background to pan, hold Ctrl or ⌘ and scroll to zoom.
        </p>
      </div>
    </section>
  );
}

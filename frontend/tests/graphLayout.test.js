import test from "node:test";
import assert from "node:assert/strict";
import {
  NODE_HEIGHT, NODE_WIDTH, clipToBox, computeEdgeBends, computeEdgeGeometry,
  cycleEdgeKeys, edgeKey, layoutGraph, wrapLabel,
} from "../src/services/graphLayout.js";

const n = (id) => ({ id, label: id, type: "service" });
const e = (source, target) => ({ source, target, label: "calls" });

test("empty graph gives an empty layout", () => {
  const l = layoutGraph([], []);
  assert.deepEqual(l.positions, {});
  assert.equal(l.width, 0);
});

test("a chain is laid out left to right", () => {
  const l = layoutGraph([n("a"), n("b"), n("c")], [e("a", "b"), e("b", "c")]);
  assert.ok(l.positions.a.x < l.positions.b.x && l.positions.b.x < l.positions.c.x);
});

test("longest path decides the column (diamond)", () => {
  const l = layoutGraph([n("a"), n("b"), n("c"), n("d")], [e("a", "b"), e("a", "c"), e("b", "d"), e("c", "d"), e("a", "d")]);
  assert.ok(l.positions.d.x > l.positions.b.x);
});

test("a cycle still produces finite positions and one back edge", () => {
  const l = layoutGraph([n("a"), n("b"), n("c")], [e("a", "b"), e("b", "c"), e("c", "a")]);
  assert.equal(l.backEdges.size, 1);
  for (const p of Object.values(l.positions)) assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y));
});

test("nodes in the same column never overlap", () => {
  const nodes = ["r", "a", "b", "c", "d"].map(n);
  const l = layoutGraph(nodes, [e("r", "a"), e("r", "b"), e("r", "c"), e("r", "d")]);
  const ys = ["a", "b", "c", "d"].map((id) => l.positions[id].y).sort((x, y) => x - y);
  for (let i = 1; i < ys.length; i++) assert.ok(ys[i] - ys[i - 1] >= NODE_HEIGHT);
});

test("disconnected components and isolated nodes are all placed", () => {
  const l = layoutGraph([n("a"), n("b"), n("c"), n("d"), n("lonely")], [e("a", "b"), e("c", "d")]);
  assert.equal(Object.keys(l.positions).length, 5);
});

test("edges with unknown ends and self loops are ignored by the layout", () => {
  const l = layoutGraph([n("a"), n("b")], [e("a", "ghost"), e("a", "a"), e("a", "b")]);
  assert.equal(Object.keys(l.positions).length, 2);
  assert.ok(l.positions.b.x > l.positions.a.x);
});

test("layout bounds contain every node", () => {
  const l = layoutGraph([n("a"), n("b"), n("c")], [e("a", "b"), e("a", "c")]);
  for (const p of Object.values(l.positions)) {
    assert.ok(p.x + NODE_WIDTH / 2 <= l.width && p.y + NODE_HEIGHT / 2 <= l.height);
    assert.ok(p.x - NODE_WIDTH / 2 >= 0 && p.y - NODE_HEIGHT / 2 >= 0);
  }
});

test("opposite edges between two nodes bend to different sides", () => {
  const edges = [e("a", "b"), e("b", "a")];
  const [b1, b2] = computeEdgeBends(edges);
  const g1 = computeEdgeGeometry({ x: 0, y: 0 }, { x: 400, y: 0 }, b1);
  const g2 = computeEdgeGeometry({ x: 400, y: 0 }, { x: 0, y: 0 }, b2);
  assert.ok(g1.labelY !== g2.labelY);
  assert.ok(Math.abs(g1.labelY - g2.labelY) > 20);
});

test("a single edge is straight", () => {
  assert.deepEqual(computeEdgeBends([e("a", "b")]), [0]);
});

test("back edges get extra bend", () => {
  const edges = [e("a", "b"), e("b", "c"), e("c", "a")];
  const bends = computeEdgeBends(edges, new Set([edgeKey("c", "a")]));
  assert.notEqual(bends[2], 0);
  assert.equal(bends[0], 0);
});

test("clipToBox lands on the node border", () => {
  const p = clipToBox({ x: 0, y: 0 }, { x: 1000, y: 0 });
  assert.equal(p.x, NODE_WIDTH / 2);
  assert.equal(p.y, 0);
  const q = clipToBox({ x: 0, y: 0 }, { x: 0, y: -1000 });
  assert.equal(q.y, -NODE_HEIGHT / 2);
});

test("edge geometry starts and ends on node borders", () => {
  const g = computeEdgeGeometry({ x: 100, y: 100 }, { x: 500, y: 100 }, 0);
  assert.equal(g.start.x, 100 + NODE_WIDTH / 2);
  assert.equal(g.end.x, 500 - NODE_WIDTH / 2);
  assert.match(g.d, /^M .* Q .*/);
});

test("wrapLabel wraps, truncates and handles long words", () => {
  assert.deepEqual(wrapLabel("Auth Service"), ["Auth Service"]);
  assert.deepEqual(wrapLabel("Authentication Service Gateway"), ["Authentication", "Service Gateway"]);
  const long = wrapLabel("one two three four five six seven eight nine ten", 12, 2);
  assert.equal(long.length, 2);
  assert.ok(long[1].endsWith("…"));
  assert.ok(wrapLabel("Supercalifragilisticexpialidocious", 10, 2).every((l) => l.length <= 10));
  assert.deepEqual(wrapLabel(""), [""]);
});

test("cycleEdgeKeys turns closed paths into edge keys", () => {
  assert.deepEqual([...cycleEdgeKeys([["a", "b", "c", "a"]])].sort(), ["a->b", "b->c", "c->a"]);
  assert.equal(cycleEdgeKeys().size, 0);
});

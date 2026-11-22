import test from "node:test";
import assert from "node:assert/strict";
import {
  ApiError, MAX_DESCRIPTION_CHARS, checkHealth, generateGraph, isGraphResponse, validateDescription,
} from "../src/services/api.js";

const GOOD = {
  nodes: [{ id: "a", label: "A", type: "service" }, { id: "db", label: "DB", type: "database" }],
  edges: [{ source: "a", target: "db", label: "reads" }],
  summary: "ok",
};
const jsonResponse = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const TEXT = "The Order Service calls the Payment Service.";

test("validateDescription", () => {
  assert.match(validateDescription(""), /Describe/);
  assert.match(validateDescription("   "), /Describe/);
  assert.match(validateDescription("short"), /more detail/);
  assert.match(validateDescription("a".repeat(MAX_DESCRIPTION_CHARS + 1)), /too long/);
  assert.equal(validateDescription(TEXT), null);
});

test("isGraphResponse accepts good and rejects bad shapes", () => {
  assert.equal(isGraphResponse(GOOD), true);
  assert.equal(isGraphResponse(null), false);
  assert.equal(isGraphResponse({ ...GOOD, nodes: "x" }), false);
  assert.equal(isGraphResponse({ ...GOOD, nodes: [{ id: "a", label: "A", type: "queue" }] }), false);
});

test("generateGraph posts the trimmed description and returns the graph", async () => {
  let seen;
  const fetchImpl = async (url, options) => { seen = { url, options }; return jsonResponse(200, GOOD); };
  const result = await generateGraph(`  ${TEXT}  `, { fetchImpl });
  assert.deepEqual(result, GOOD);
  assert.ok(seen.url.endsWith("/api/generate-graph"));
  assert.equal(seen.options.method, "POST");
  assert.deepEqual(JSON.parse(seen.options.body), { description: TEXT });
});

test("generateGraph does not call the network for invalid input", async () => {
  let called = false;
  const fetchImpl = async () => { called = true; return jsonResponse(200, GOOD); };
  await assert.rejects(generateGraph("", { fetchImpl }), (err) => err instanceof ApiError && err.code === "invalid_input");
  assert.equal(called, false);
});

test("server error messages are passed through", async () => {
  const fetchImpl = async () => jsonResponse(422, { error: { code: "no_components", message: "No services found." } });
  await assert.rejects(generateGraph(TEXT, { fetchImpl }), (err) => err.message === "No services found." && err.status === 422);
});

test("status-based fallback message when body is not JSON", async () => {
  const fetchImpl = async () => ({ ok: false, status: 504, json: async () => { throw new Error("not json"); } });
  await assert.rejects(generateGraph(TEXT, { fetchImpl }), /too long to respond/);
});

test("network failure gives a friendly message", async () => {
  const fetchImpl = async () => { throw new TypeError("Failed to fetch"); };
  await assert.rejects(generateGraph(TEXT, { fetchImpl }), (err) => err.code === "network" && /Cannot reach/.test(err.message));
});

test("timeout aborts the request", async () => {
  const fetchImpl = (url, { signal }) => new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
  });
  await assert.rejects(generateGraph(TEXT, { fetchImpl, timeoutMs: 20 }), (err) => err.code === "timeout");
});

test("unexpected response shape is rejected", async () => {
  const fetchImpl = async () => jsonResponse(200, { hello: "world" });
  await assert.rejects(generateGraph(TEXT, { fetchImpl }), (err) => err.code === "bad_shape");
});

test("checkHealth reports online/offline and never throws", async () => {
  const up = await checkHealth({ fetchImpl: async () => jsonResponse(200, { status: "ok", gemini_configured: true }) });
  assert.deepEqual(up, { online: true, geminiConfigured: true });
  const down = await checkHealth({ fetchImpl: async () => { throw new TypeError("x"); } });
  assert.deepEqual(down, { online: false, geminiConfigured: false });
});

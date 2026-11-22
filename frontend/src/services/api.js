// api.js - the only file that talks to the backend.
// The browser never sees the Gemini key; it only knows the backend URL.

export const API_BASE_URL = (import.meta.env?.VITE_API_URL ?? "http://localhost:8000").replace(/\/+$/, "");

// Keep in sync with backend/models.py
export const MIN_DESCRIPTION_CHARS = 10;
export const MAX_DESCRIPTION_CHARS = 5000;
export const REQUEST_TIMEOUT_MS = 45000;

export class ApiError extends Error {
  constructor(message, { status = 0, code = "unknown" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

// Returns a friendly error string, or null when the text is acceptable.
export function validateDescription(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "Describe your infrastructure first, or load the example.";
  if (trimmed.length < MIN_DESCRIPTION_CHARS) {
    return `Add a little more detail (at least ${MIN_DESCRIPTION_CHARS} characters).`;
  }
  if (trimmed.length > MAX_DESCRIPTION_CHARS) {
    return `That description is too long. The limit is ${MAX_DESCRIPTION_CHARS} characters.`;
  }
  return null;
}

export function isGraphResponse(data) {
  return (
    data !== null &&
    typeof data === "object" &&
    Array.isArray(data.nodes) &&
    Array.isArray(data.edges) &&
    typeof data.summary === "string" &&
    data.nodes.every((n) => n && typeof n.id === "string" && typeof n.label === "string" &&
      (n.type === "service" || n.type === "database")) &&
    data.edges.every((e) => e && typeof e.source === "string" && typeof e.target === "string")
  );
}

const STATUS_MESSAGES = {
  413: "That description is too long. Shorten it and try again.",
  422: "The description could not be turned into a graph. Check the text and try again.",
  429: "The AI service is busy. Wait a moment and try again.",
  502: "The AI service returned an unusable answer. Try again.",
  503: "The server is not ready to use the AI service. Check the backend configuration.",
  504: "The AI service took too long to respond. Try a shorter description.",
};

async function fetchWithTimeout(url, options, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err?.name === "AbortError") {
      throw new ApiError("The request timed out. Try again with a shorter description.", { code: "timeout" });
    }
    throw new ApiError(`Cannot reach the MeshMind backend at ${API_BASE_URL}. Is it running?`, { code: "network" });
  } finally {
    clearTimeout(timer);
  }
}

export async function generateGraph(description, { fetchImpl = globalThis.fetch, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const problem = validateDescription(description);
  if (problem) throw new ApiError(problem, { code: "invalid_input" });

  const response = await fetchWithTimeout(
    `${API_BASE_URL}/api/generate-graph`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ description: description.trim() }) },
    fetchImpl,
    timeoutMs
  );

  let data = null;
  try {
    data = await response.json();
  } catch {
    // body was not JSON; handled below
  }

  if (!response.ok) {
    const message = data?.error?.message || STATUS_MESSAGES[response.status] || "Something went wrong. Please try again.";
    throw new ApiError(message, { status: response.status, code: data?.error?.code ?? "http_error" });
  }
  if (!isGraphResponse(data)) {
    throw new ApiError("The backend returned an unexpected response.", { status: response.status, code: "bad_shape" });
  }
  return data;
}

// Returns {online, geminiConfigured}. Never throws.
export async function checkHealth({ fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
  try {
    const response = await fetchWithTimeout(`${API_BASE_URL}/api/health`, { method: "GET" }, fetchImpl, timeoutMs);
    const data = await response.json();
    return { online: response.ok && data.status === "ok", geminiConfigured: Boolean(data.gemini_configured) };
  } catch {
    return { online: false, geminiConfigured: false };
  }
}

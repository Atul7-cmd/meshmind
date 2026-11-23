# MeshMind AI: Interview Guide

Every answer below describes the code in this repository. File names are given so you can open them while you practise.
Be ready to say honestly what is tested and what is not (see README, "Verification status").

## 1. Project introduction

**Q1. What is MeshMind AI in one sentence?**
A web app that turns a plain-English description of services and databases into a validated, interactive dependency graph, using Gemini for extraction and React SVG for drawing.

**Q2. What problem does it solve?**
Architecture knowledge sits in prose. It is hard to see dependencies, cycles and disconnected parts. The app extracts them automatically and shows them visually.

**Q3. Walk me through what happens when I click Generate Graph.**
`App.jsx` validates the text, `api.js` POSTs it, FastAPI validates the body (`models.py`), `gemini_service.extract_graph` calls Gemini, `parse_gemini_response` parses the JSON, `graph_processor.build_graph` validates and analyses it, the response returns, `api.js` checks its shape, and `GraphCanvas` lays out and draws it.

**Q4. Why these technologies?**
They were mandated: React/JS/HTML/CSS for the UI, Python + FastAPI for the API, Gemini for AI. I added only what they need: Vite to compile JSX, uvicorn to serve FastAPI, httpx for FastAPI's test client.

**Q5. What was the hardest part?**
Making AI output safe to use (validation of every field, duplicate and bad-edge handling) and drawing a readable graph without a library (layering, edge curves, cycles).

**Q6. What would you change first with more time?**
Run the real-Gemini checks across many descriptions to tune the prompt, add CI, and add rate limiting/auth.

## 2. Architecture

**Q7. Describe the architecture.**
Three tiers: React SPA, FastAPI backend, Gemini as an external service. The backend is split into API layer (`main.py`), I/O models (`models.py`), AI integration (`gemini_service.py`) and graph logic (`graph_processor.py`).

**Q8. Why separate those modules?**
Single responsibility and testability. `graph_processor.py` uses only the standard library, so I test it with no FastAPI; `gemini_service.py` has one function (`_post_json`) that touches the network, so tests mock just that.

**Q9. Why does the browser not call Gemini directly?**
The API key would be exposed in JavaScript. The backend keeps the key, validates input and output, and enforces limits.

**Q10. What is the data contract between front end and back end?**
Request `{description}`; response `{nodes, edges, summary, analysis}`; errors `{error: {code, message}}`. `api.js` checks the response shape (`isGraphResponse`) before React uses it.

**Q11. Why is `analysis` extra?**
The brief specifies `nodes`, `edges`, `summary`. `analysis` is additive (counts, cycles, groups, warnings) so the UI does not recompute them. Clients that ignore it still work.

**Q12. Where does the layout run, front end or back end?**
Front end (`graphLayout.js`). Positions depend on the viewport and on user dragging, and it keeps the backend a pure data service.

## 3. React.js

**Q13. How is state organised?**
`App.jsx` holds description, graph, loading, error, validation message, last submitted text, selected node id and health. Children get props and callbacks. `GraphCanvas` keeps only view state (zoom/pan, dragged positions).

**Q14. Why no Redux or Context?**
The tree is shallow and one component owns the state; adding a state library would also break the "no extra technologies" rule.

**Q15. What do `useMemo` and `useCallback` do here?**
`useMemo` caches the layout, positions, edge bends and cycle set so they are recomputed only when the graph, selection or drag state changes. `useCallback` keeps `fit` and `zoomBy` stable so effects depending on them do not re-run needlessly.

**Q16. Why `useLayoutEffect` for fitting?**
It runs after the DOM is updated but before paint, so the first frame already shows the fitted graph (no flash).

**Q17. What is `requestId` in `App.jsx`?**
A ref counter. Each request gets an id; if the user clears or starts another request, an older response sees a mismatch and is ignored. It avoids stale data overwriting newer state.

**Q18. How do you avoid re-render problems with the wheel event?**
React attaches wheel listeners as passive, so `preventDefault` would fail. I add a native listener with `{passive: false}` in an effect and only intercept Ctrl/⌘+wheel, so normal page scrolling still works.

**Q19. How is accessibility handled?**
Labelled controls, `role="alert"` for errors, `aria-pressed` and keyboard Enter/Space on nodes (`tabIndex=0`), visible focus styles, `prefers-reduced-motion` respected, and a mobile menu button with `aria-expanded`.

**Q20. Why are keys used in lists?**
React uses `key` to match list items between renders. Nodes use their unique id; edges use source-target plus index since the same pair can have several labelled edges.

## 4. JavaScript

**Q21. How does the front end handle timeouts?**
`api.js` uses `AbortController` with `setTimeout`; on abort it throws an `ApiError` with code `timeout`.

**Q22. What is `ApiError` for?**
A typed error carrying `status` and `code` so the UI can show a friendly message while code stays testable.

**Q23. How do you download the JSON?**
`exportJson.js` creates a `Blob`, makes an object URL, clicks a temporary `<a download>` and revokes the URL. Browser built-ins only.

**Q24. How do the front-end tests run without a framework?**
`node --test` (built-in runner) imports the pure ES modules (`graphLayout.js`, `api.js`). `fetch` is injected as `fetchImpl`, so API behaviour is tested with fakes.

**Q25. What is optional chaining used for in `api.js`?**
`import.meta.env?.VITE_API_URL` works under Vite and also in Node tests, where `import.meta.env` is undefined.

## 5. Python

**Q26. Why `asyncio.to_thread` for Gemini calls?**
`urllib` is blocking. Running it in a worker thread keeps FastAPI's event loop free to serve other requests, and `asyncio.wait_for` adds an overall timeout.

**Q27. Why `urllib` instead of an SDK or `requests`?**
The brief says to prefer built-ins. The call is one JSON POST, so the standard library is enough and there is no extra dependency to maintain.

**Q28. How is configuration loaded?**
`get_settings()` reads environment variables; a small `load_env_file` reads `backend/.env` without overriding real environment variables. The API key never appears in code or responses.

**Q29. What are the custom exceptions for?**
`GeminiError` subclasses and `GraphValidationError` carry `status_code`, `code` and a safe `public_message`. `main.py` registers handlers that turn them into JSON errors, so routes stay clean.

**Q30. Why dataclass(frozen=True) for Settings?**
Immutable configuration object: no accidental mutation, easy to construct in tests.

## 6. FastAPI

**Q31. What does FastAPI give you here?**
Routing, Pydantic validation, async handlers, automatic OpenAPI docs at `/docs`, and exception handlers/middleware.

**Q32. How is input validated?**
`GenerateGraphRequest`: `description` is a string with `max_length=5000`, a validator strips it and requires at least 10 characters, `extra="forbid"` rejects unknown fields.

**Q33. How are validation errors made friendly?**
A `RequestValidationError` handler maps error types: too long -> 413 `description_too_long`, my validator message -> 422, bad JSON -> 422. It never echoes the user's input.

**Q34. What does `response_model` do?**
It validates and filters the outgoing data against `GenerateGraphResponse`, and documents it in OpenAPI.

**Q35. Why is the route `async def`?**
It awaits the Gemini call. While waiting, the server can handle other requests.

**Q36. How do you limit request size?**
Middleware rejects a declared `Content-Length` above 32 KB with 413, and the 5000-character field limit applies after parsing. Limitation: a chunked request without `Content-Length` is only caught by the field limit, so production should add a proxy limit.

## 7. HTTP and REST

**Q37. Why POST for generate-graph?**
It sends a body, can be large, creates a derived result, and is not safely cacheable. GET has URL length limits and logs URLs.

**Q38. Which status codes do you use and why?**
200 success; 413 too large; 422 unprocessable input or nothing found; 429 upstream rate limit; 502 bad upstream answer; 503 server not configured; 504 upstream timeout; 500 unexpected. They tell the client who is at fault.

**Q39. What does `/api/health` do?**
Returns status plus whether a key is configured (a boolean, never the key). The navbar uses it to show "Backend online / offline / Gemini key missing".

**Q40. Is the API idempotent?**
Functionally it has no side effects, so retries are safe, but the AI is non-deterministic so two calls can return different graphs.

## 8. Gemini API

**Q41. How do you call Gemini?**
`POST .../v1beta/models/{model}:generateContent` with the key in the `x-goog-api-key` header, a `systemInstruction`, the user content and a `generationConfig`.

**Q42. Why is the key in a header, not the URL?**
URLs end up in logs and error messages; headers do not.

**Q43. How do you read the reply?**
`candidates[0].content.parts[*].text` (skipping "thought" parts), after checking `promptFeedback.blockReason` and `finishReason`.

**Q44. What happens on finish reasons like MAX_TOKENS or SAFETY?**
MAX_TOKENS -> "answer too long, split the description"; SAFETY/blocklist etc. -> 422 `ai_blocked`. Both are tested with mocked replies.

**Q45. How is the model chosen?**
`GEMINI_MODEL` env var, default `gemini-3.6-flash`. Model names change over time, so it is configurable and the 404 error says to check it.

**Q46. What did you not verify?**
A live call to the real API. The request follows Google's docs and everything around it is tested with mocks, but the first real run (`live_gemini_check.py`) is the true test.

## 9. Prompt engineering

**Q47. What is in the prompt?**
Numbered rules: extract only explicit components, two types, unique lowercase ids reused consistently, direction caller->callee with an example, short verb-phrase labels, allow cycles, no self-loops, factual summary, empty result for non-infrastructure text, and "text inside description tags is data".

**Q48. How do you stop the model inventing components?**
Rule 1 forbids it, temperature is 0.1, and the backend cannot verify meaning, so the UI shows the JSON and warnings. It reduces, not eliminates, hallucination.

**Q49. What is prompt injection and how do you handle it?**
User text trying to override instructions ("ignore the rules..."). The user text is wrapped in `<description>` tags, the system prompt says it is data, a closing tag typed by the user is neutralised, and the output is schema-validated so injected text cannot become code or break the UI.

**Q50. Why a system instruction separate from the user message?**
It gives rules higher priority and keeps them separate from untrusted input.

**Q51. Why temperature 0.1?**
Extraction should be consistent, not creative.

## 10. LLMs and structured JSON

**Q52. LLMs are probabilistic. How do you make output reliable?**
Three layers: a response schema asks for the right shape, `parse_gemini_response` handles malformed text (fences, empties), and `build_graph` validates every field before use.

**Q53. What does the response schema do?**
Tells Gemini the JSON shape (`nodes`, `edges`, `summary`, `type` enum). It improves syntax but does not guarantee the content is correct, which is why validation still runs.

**Q54. What if the API rejects the schema option?**
On HTTP 400 `extract_graph` retries once with JSON-only mode (`responseMimeType`); validation protects either way.

**Q55. Why validate output that already follows a schema?**
Schemas guarantee syntax, not semantics: ids can duplicate, edges can reference missing nodes, labels can be huge.

**Q56. Why a fenced-JSON stripper?**
Models sometimes wrap JSON in markdown fences; a regex removes them before `json.loads`.

## 11. Graphs, nodes and edges

**Q57. How do you represent the graph?**
G = (V, E): vertices are services/databases with unique ids; edges are ordered pairs (source depends on target). JSON holds node and edge lists; the processor builds adjacency lists.

**Q58. Why directed?**
Dependency has a direction: the Payment Service depends on the Payment Database, not the reverse.

**Q59. How do you make node ids unique?**
Slugify the id (`Auth Database` -> `auth_database`); same label = duplicate (merged); same id with different label gets a new id; non-Latin labels get `node_N` ids. Lookup maps let edges resolve by id or label.

**Q60. What edge problems are handled?**
Unknown endpoints, self-loops, exact repeats, non-object entries, missing labels (default "depends on"). Each is dropped or repaired with a warning, shown in the UI.

**Q61. Time complexity of validation?**
Roughly O(V + E) with dictionary lookups, bounded by 100 nodes and 300 edges.

## 12. DFS and BFS

**Q62. Where do you use BFS?**
`find_components`: BFS over the undirected version of the graph to find connected groups, O(V+E).

**Q63. Where do you use DFS?**
`find_cycles` (backend) and back-edge finding in `layoutGraph` (front end). Colours: unvisited, visiting, done.

**Q64. How does DFS detect a cycle?**
If an edge leads to a node currently on the DFS stack ("visiting"), the stack segment from that node to the current one plus the edge is a cycle.

**Q65. Does it find all cycles?**
No: one per back edge, deduplicated by canonical rotation, capped at 10. Listing all simple cycles can be exponential. Every node on some cycle appears on at least one reported cycle.

**Q66. Is recursion safe?**
Depth is at most the node count, capped at 100, far below Python's recursion limit (and JS call stack limits).

## 13. Circular dependencies

**Q67. Why allow cycles?**
Real systems have them (A calls B, B calls A back). The brief says not to assume a DAG. We report them instead of rejecting.

**Q68. How are cycles shown?**
Cycle edges are amber and dashed, the summary appends "Circular dependency detected: A → B → A", and the info panel lists them.

**Q69. How does the layout survive cycles?**
Back edges are removed for ranking (leaving a DAG), ranks come from longest path, then back edges are drawn as extra-curved edges.

## 14. Stateless processing

**Q70. What does stateless mean here?**
Each request is self-contained; the server stores no descriptions, graphs, sessions or files.

**Q71. Benefits and limits?**
Benefits: privacy, easy scaling, no storage to secure or migrate. Limits: no history, repeated AI cost, no per-user server-side limits, graph lost on refresh unless exported.

**Q72. Is anything logged?**
Errors are logged with status and reason, deliberately not with the user's description (the JSON-parse error log records only the error and length).

## 15. API security and CORS

**Q73. How is the API key protected?**
Backend `.env` (git-ignored), sent only in a request header, never logged, never in responses or in React. `VITE_*` variables are public, so only the backend URL lives there.

**Q74. What is CORS?**
A browser rule: a page from one origin cannot read responses from another unless the server allows it via headers. It only restricts browsers; tools like curl are unaffected, so CORS is not authentication.

**Q75. How is CORS configured?**
`CORSMiddleware` with an allow-list from `ALLOWED_ORIGINS` (default the Vite dev origins), methods GET/POST/OPTIONS, header Content-Type, no credentials. It is added after the size middleware so even 413 responses carry CORS headers.

**Q76. Other security measures?**
Input limits, no echo of input in errors, safe error messages, model-name character check (prevents URL tampering through config), React escaping of all text, and prompt-injection defences.

**Q77. What is missing for production?**
Authentication, per-user rate limiting, HTTPS and a reverse proxy with body limits, monitoring, key rotation.

## 16. Error handling

**Q78. How do errors reach the user?**
Backend exceptions become `{error:{code,message}}`; `api.js` turns them (or network failures/timeouts) into `ApiError`; `App.jsx` shows an `ErrorBanner` with plain wording.

**Q79. Why hide upstream details?**
They can leak internals; the real detail goes to the server log only (see `_map_http_error`).

**Q80. What if Gemini is slow?**
Timeout (default 30 s, adjustable 5 to 120), one retry on 5xx, then 504 "took too long".

**Q81. What if the description has no infrastructure?**
Gemini returns empty nodes; `build_graph` raises `no_components` (422) with an example of what to write.

## 17. Performance and scalability

**Q82. Where is the bottleneck?**
Gemini latency (seconds). Local processing is microseconds to milliseconds.

**Q83. How would you scale it?**
Run many stateless instances behind a load balancer; add a cache keyed by a hash of the description (this would need storage, so it is a deliberate trade-off), queue/background jobs, and rate limiting.

**Q84. Front-end performance?**
Memoised layout; dragging updates state per pointer move, fine for the 100-node cap. For thousands of nodes use canvas/WebGL or virtualisation.

## 18. Testing

**Q85. What did you test and how?**
Backend `unittest`: graph rules and analysis, Gemini parsing/errors/retry/fallback with a mocked `_post_json`, and API tests via `TestClient` with `extract_graph` mocked. Front end: Node tests for layout/API. A headless-browser run exercised the UI.

**Q86. Why mock Gemini?**
Tests must be fast, free, deterministic and offline. A live script (`live_gemini_check.py`) covers the real call manually.

**Q87. What is not covered?**
Live Gemini quality, the 15 API tests were not executed where I built it (FastAPI not installable there), and no automated component-rendering tests in the repo (rendering was checked with a one-off browser run).

**Q88. Name a bug testing caught.**
The browser run showed a real mobile bug: a CSS grid track of `1fr` let long content widen the page; fixing it with `minmax(0, 1fr)` and `min-width: 0` removed horizontal scroll. It also showed edge labels colliding with nodes, so I widened the column gap.

## 19. Limitations

**Q89. What are the main limitations?**
LLM mistakes on ambiguous text, only two node types, free-text edge labels, simple layout for dense graphs, no auth/persistence, no touch pinch zoom, size limit relies on Content-Length.

**Q90. How would you evaluate extraction quality?**
Build a labelled set of descriptions with expected graphs and score node and edge precision/recall; track changes when the prompt or model changes.

**Q91. What would you do about wrong edge direction from the model?**
Show the JSON and the graph so users can spot it, tighten prompt examples, and add an edit/flip-edge feature.

## 20. Rapid-fire

**Q92. Why Vite?** It compiles JSX and serves the dev app; it is build tooling, not a runtime framework.
**Q93. Why SVG instead of canvas?** DOM elements per node give free hit-testing, focus, accessibility, CSS styling and crisp zoom.
**Q94. How are arrows drawn?** SVG `<marker>` definitions referenced by `marker-end`; the path ends on the node border via `clipToBox`.
**Q95. How do parallel edges avoid overlapping?** `computeEdgeBends` gives each edge between the same pair a different curve offset in a shared direction frame.
**Q96. Why `pointer capture`?** Keeps receiving move/up events even if the pointer leaves the element during a drag.
**Q97. Difference between 401/403 from Gemini and your 5xx?** Those mean our server's key/config is wrong, so we return a 502 with a safe "check GEMINI_API_KEY" message, not an auth error to the user.
**Q98. What does `extra="forbid"` do?** Rejects unexpected JSON fields so clients cannot send hidden data.
**Q99. Why does `.gitignore` list `.env`?** To prevent committing secrets.
**Q100. One sentence on what you learned?** Treat LLM output as untrusted input: constrain it, parse it defensively, validate it, and explain failures clearly.

# MeshMind AI: AI-Powered Microservice Topology Visualizer

MeshMind AI converts a plain-English description of an infrastructure into an interactive dependency graph.
You write *"The Order Service communicates with the Payment Service..."*; the backend asks Gemini to extract the
components and relationships, validates the answer, and the React front end draws it as an SVG graph you can explore.

## Problem statement

Architecture knowledge usually lives in prose (wikis, tickets, chat). It is hard to see which service depends on which
database, where circular dependencies hide, or which parts are disconnected. Drawing diagrams by hand is slow and goes stale.
MeshMind AI turns the prose into a validated graph in seconds.

## Features

- Natural-language input with example, validation, character counter, Ctrl/⌘+Enter shortcut.
- Gemini-based extraction of services, databases, dependency direction and relationship labels.
- Strict backend validation: unique ids, duplicate merging, invalid-edge removal, self-loop removal, size limits.
- Cycle detection (circular dependencies) and disconnected-group detection.
- Native SVG graph: service rectangles, database cylinders, directional arrows, edge labels, node selection,
  node dragging, pan, zoom buttons, Ctrl/⌘+wheel zoom, fit-to-view, keyboard selection.
- Graph information: service/database/connection counts, architecture summary, validation notes, generated JSON.
- JSON export and copy, regenerate, clear, friendly errors, loading states, responsive layout.
- Stateless: nothing is stored.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React.js, JavaScript, HTML, CSS (graph drawn with React-rendered SVG, no graph library) |
| Backend | Python, FastAPI |
| AI | Gemini API (REST, called with Python's built-in `urllib`) |
| Version control | Git and GitHub |

**Toolchain note.** React's JSX has to be compiled, so the front end uses **Vite** (with `@vitejs/plugin-react`) as the
dev server/bundler. It is build tooling, not an application framework, and it adds no runtime library. The backend adds
only what FastAPI needs: `uvicorn` (server) and `httpx` (required by FastAPI's `TestClient`, used only by tests).
No database, no extra frontend/backend framework, no second AI provider, no graph or state library.

## Architecture

```
USER
  |
  v
REACT.JS FRONTEND  (App.jsx, components/, services/api.js)
  |  HTTP POST /api/generate-graph  {"description": "..."}
  v
FASTAPI BACKEND  (main.py)
  |
  v
INPUT PROCESSING  (models.py: trim, length limits, size limit middleware)
  |
  v
GEMINI API  (gemini_service.py: prompt + schema, async, timeout, retry)
  |
  v
STRUCTURED JSON  (parsed from Gemini's reply)
  |
  v
JSON VALIDATION  (graph_processor.py: nodes, ids, edges)
  |
  v
GRAPH DATA PROCESSING  (graph_processor.py: components via BFS, cycles via DFS, summary)
  |
  v
FASTAPI RESPONSE  {"nodes", "edges", "summary", "analysis"}
  |
  v
REACT.JS FRONTEND  (api.js checks the shape)
  |
  v
INTERACTIVE GRAPH  (graphLayout.js computes positions, GraphCanvas.jsx draws SVG)
```

## Request-response flow

1. The user types a description and presses **Generate Graph**. `validateDescription` checks length in the browser.
2. `api.js` sends `POST /api/generate-graph` with a 45 s timeout.
3. FastAPI rejects bad bodies (empty, whitespace, >5000 chars, >32 KB, malformed JSON) with a friendly error.
4. `extract_graph` builds the prompt and response schema and calls Gemini in a worker thread with a timeout.
5. `parse_gemini_response` handles blocked/truncated/invalid output and parses the JSON.
6. `build_graph` validates and cleans the graph and computes the analysis.
7. The response goes back; `api.js` verifies its shape; React stores it in state and `GraphCanvas` draws it.

## Folder structure and file responsibilities

```
meshmind-ai/
|-- frontend/
|   |-- index.html                 Vite entry page (mounts #root, loads main.jsx)
|   |-- package.json, vite.config.js   dependencies, scripts, React plugin
|   |-- .env.example               VITE_API_URL (backend URL only, no secrets)
|   |-- public/favicon.svg         icon
|   |-- src/
|   |   |-- main.jsx               creates the React root, imports CSS
|   |   |-- App.jsx                top-level state (text, graph, loading, error, selection) and actions
|   |   |-- components/
|   |   |   |-- Navbar.jsx         responsive nav + backend status pill (calls /api/health)
|   |   |   |-- Intro.jsx          project introduction
|   |   |   |-- InputPanel.jsx     textarea, counter, Generate / Use example / Clear
|   |   |   |-- GraphCanvas.jsx    SVG drawing, selection, drag, pan, zoom, toolbar, legend
|   |   |   |-- StatsPanel.jsx     counts, summary, cycles, validation notes
|   |   |   |-- NodeDetails.jsx    selected node, what it depends on / is used by
|   |   |   |-- JsonViewer.jsx     JSON display, copy, export
|   |   |   `-- ErrorBanner.jsx    dismissible error message
|   |   |-- services/
|   |   |   |-- api.js             fetch calls, timeout, error mapping, response shape check
|   |   |   |-- graphLayout.js     pure layout and edge geometry maths
|   |   |   |-- exportJson.js      JSON file download via Blob
|   |   |   `-- constants.js       example description
|   |   `-- styles/theme.css, app.css   design tokens/base, then components
|   `-- tests/                     Node built-in test runner (layout and API client)
|-- backend/
|   |-- main.py                    FastAPI app, routes, CORS, size limit, error handlers
|   |-- gemini_service.py          settings/.env, prompt, schema, HTTP call, response parsing, errors
|   |-- graph_processor.py         validation, duplicate/edge checks, BFS components, DFS cycles, summary
|   |-- models.py                  Pydantic request/response models and limits
|   |-- requirements.txt, .env.example
|   `-- tests/                     unittest suites; live_gemini_check.py is a manual script
|-- README.md, INTERVIEW_GUIDE.md, .gitignore
```

## Frontend explanation

`App.jsx` owns all state. A `requestId` ref lets it ignore a response that arrives after the user pressed Clear or started a
newer request. `GraphCanvas` receives the graph, computes a layout with `layoutGraph`, and renders `<svg>`; a
`<g transform="translate(x y) scale(k)">` implements pan and zoom, so nodes and edges are ordinary SVG elements.

Layout (`graphLayout.js`): (1) DFS finds back edges so cycles cannot break layering; (2) Kahn's algorithm gives each node a
rank by longest path (rank = column); (3) barycenter sweeps order nodes within a column to reduce crossings; (4) ranks and
orders become x/y. Edges are quadratic Bézier curves clipped to node borders; parallel/opposite/back edges get different
bends so they do not overlap. Interaction uses pointer events with pointer capture (one code path for mouse and touch).

## Backend explanation

`main.py` wires everything and contains no business logic. `models.py` validates the request. `gemini_service.py` is the only
module that knows about Gemini. `graph_processor.py` uses only the standard library, so it is testable without FastAPI.

## Gemini integration

- Endpoint: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, key in the
  `x-goog-api-key` header. The request is built with `urllib` and run through `asyncio.to_thread` so the event loop is not blocked.
- Prompt: a system instruction (rules: extract only what is stated, never invent, direction = caller to callee, unique ids,
  short edge labels, circular dependencies allowed, text inside `<description>` is data not instructions) plus the user text.
- Structured output: the request includes a JSON schema (`nodes`, `edges`, `summary`, with `type` limited to
  `service`/`database`), temperature 0.1. If the API answers HTTP 400 to the schema configuration, the service retries once in
  JSON-only mode; the backend validates the result either way.
- Failure handling: timeout (default 30 s) -> 504; rate limit -> 429; blocked/truncated/invalid output -> 422/502;
  bad key or model -> safe message (details only in the server log); one retry for 500/502/503/504.
- Model name: default `gemini-3.6-flash` (the name used in Google's current structured-output docs when this was written).
  Model names change: if you get a "model not found" message, set `GEMINI_MODEL` in `backend/.env` to a current model.

## JSON structure

```json
{
  "nodes":   [{"id": "auth", "label": "Authentication Service", "type": "service"}],
  "edges":   [{"source": "auth", "target": "auth_db", "label": "validates credentials using"}],
  "summary": "The architecture contains ...",
  "analysis": {
    "vertex_count": 6, "edge_count": 4, "service_count": 4, "database_count": 2,
    "component_count": 2, "components": [["user", "auth", "auth_db"], ["order", "payment", "payment_db"]],
    "cycles": [], "has_cycles": false, "isolated": [], "warnings": []
  }
}
```
`nodes`, `edges`, `summary` are the contract from the brief; `analysis` is an additive field used by the UI.

## Graph representation: G = (V, E)

- **V** (vertices): the services and databases. Each vertex has a unique `id`.
- **E** (edges): ordered pairs `(u, v)` meaning "u depends on / calls / writes to v". Direction matters.
- The graph is **directed**, **may contain cycles** (real systems do), and **may be disconnected**.
- Stored as an edge list in JSON; `graph_processor` builds adjacency lists for traversal.
- Connected groups: BFS on the undirected version, O(V+E). Cycles: DFS; an edge to a node still on the DFS stack closes a
  cycle. One cycle is reported per back edge (not every possible cycle, whose number can grow exponentially).

## Validation rules (`graph_processor.py`)

Types are normalised (`db` -> `database`, `microservice` -> `service`); unknown types are dropped with a warning. Same label
(case-insensitive) = duplicate, merged, and edges that used the duplicate's id still resolve. Same id with a different label
gets a new unique id. Edges may reference ids or labels; unknown references, self-loops and exact repeats are dropped with a
warning. Limits: 100 components, 300 connections. No components at all -> 422 with an explanatory message.

## Stateless processing

Each request is handled entirely in memory and forgotten: no database, files, sessions or cache.
**Advantages:** privacy (descriptions are not stored by this app), trivial horizontal scaling (any instance can serve any
request), simple deployment, no migrations or cleanup. **Limitations:** no history or saved graphs, the same text is sent to
Gemini again every time (cost/latency, and results can differ between runs), no server-side rate limiting per user without
extra state, and the browser must keep the graph (a refresh loses it unless exported). Note that the text *is* sent to Google's
Gemini API and is subject to Google's data terms.

## API documentation

**GET `/api/health`** -> `200 {"status": "ok", "service": "meshmind-ai-backend", "gemini_configured": true}`

**POST `/api/generate-graph`**, body `{"description": "..."}` (10 to 5000 characters)

| Status | `error.code` | Meaning |
|---|---|---|
| 200 | | graph returned |
| 413 | `description_too_long`, `request_too_large` | text over 5000 chars or body over 32 KB |
| 422 | `invalid_input`, `no_components`, `graph_too_large`, `ai_blocked` | bad/empty input, nothing found, too big, declined by the AI |
| 429 | `ai_rate_limited` | Gemini quota/rate limit |
| 502 | `ai_invalid_response`, `ai_error` | unusable AI answer or upstream failure |
| 503 | `ai_not_configured` | no `GEMINI_API_KEY` on the server |
| 504 | `ai_timeout` | Gemini too slow |
| 500 | `internal_error` | unexpected bug (details only in the server log) |

Errors always look like `{"error": {"code": "...", "message": "..."}}`. Interactive docs: `http://localhost:8000/docs`.

## Installation

Requirements: Python 3.10+, Node.js 18+, a Gemini API key from Google AI Studio.

```bash
# Backend
cd backend
python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env               # then put your key in .env

# Frontend
cd ../frontend
npm install
cp .env.example .env               # optional; default backend URL is http://localhost:8000
```

## Environment configuration

`backend/.env` (git-ignored; never commit it):

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | none (required) | your key, stays on the server |
| `GEMINI_MODEL` | `gemini-3.6-flash` | model name |
| `GEMINI_TIMEOUT_SECONDS` | `30` | wait limit (5 to 120) |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | CORS allow-list |

`frontend/.env`: `VITE_API_URL` (backend URL only; `VITE_*` values are public, so never put secrets there).

## Execution commands

```bash
# terminal 1
cd backend && uvicorn main:app --reload --port 8000
# terminal 2
cd frontend && npm run dev          # open http://localhost:5173
```

## Testing

```bash
cd backend  && python -m unittest discover -v     # graph, Gemini service (mocked), API (needs pip install)
cd frontend && npm test                           # layout maths and API client (Node built-in runner)
```

Covered: health endpoint; generation endpoint; empty/whitespace/too-long/malformed input; valid descriptions; invalid Gemini
responses (bad JSON, empty, blocked, truncated, rate limit, timeout, bad key, retry, schema fallback); duplicate nodes; invalid
edge references; self-loops; cycles; disconnected groups; CORS; layout, edge geometry and label wrapping; client error handling.
All Gemini calls in automated tests are mocked.

**Testing the real Gemini integration** (needs your key and internet):
```bash
cd backend && python tests/live_gemini_check.py
curl http://localhost:8000/api/health
curl -X POST http://localhost:8000/api/generate-graph -H "Content-Type: application/json" \
  -d '{"description":"The User Service communicates with the Authentication Service. The Authentication Service validates credentials using the Auth Database."}'
```
Expected for that curl: 3 nodes (2 services, 1 database) and 2 edges. AI output varies between runs; check the labels and directions by eye.

### Verification status of this delivery

Run and passing where the code was built: backend `unittest` (54 tests for graph processing and the mocked Gemini service),
frontend `node --test` (26 tests), a production-style bundle of the React app (esbuild, with the React copy available there),
and a headless-Chromium run of the real UI (23 checks: rendering, selection, drag, pan, zoom, export, regenerate, clear,
cycle highlighting, error banners, mobile layout) against a **stand-in server that used the real `graph_processor.py` with canned
AI output**.

**Not run there, so please run them on your machine:** (1) the 15 FastAPI endpoint tests in `backend/tests/test_api.py` were
skipped because FastAPI/httpx could not be installed; `main.py` was only compile-checked; (2) `npm install` and `vite build`;
(3) any call to the **real Gemini API**: the request format follows Google's published docs but has not been exercised end to end.
Run `live_gemini_check.py` first and tell me the output if anything fails.

## Limitations

- Quality depends on the LLM: it can mis-read ambiguous text; validation catches structure errors, not wrong meaning.
- Only two component types (service, database); no queues, caches or external systems.
- Edge labels are free text from the model; no protocol/port information.
- Layout is a simple layered layout: very large or dense graphs get crowded; 100-component limit.
- No touch pinch-zoom (use the +/- buttons); dragged node positions are not saved or exported.
- Request-size limit relies on `Content-Length` and the 5000-character field limit; put a reverse proxy in front for production.
- No authentication or per-user rate limiting.

## Future improvements

Authentication and rate limiting, more node types, edge protocols, saving/sharing graphs (would need storage), SVG/PNG export,
touch pinch zoom, incremental editing of an existing graph, streaming responses, CI running both test suites on GitHub Actions.

## Git and GitHub

```bash
git remote add origin https://github.com/<you>/meshmind-ai.git
git push -u origin main
```
The history is split by stage. Commits are authored as "MeshMind Dev"; rewrite or set your own identity before publishing
(`git config user.name ...`; `git rebase -r --root --exec 'git commit --amend --reset-author --no-edit'`).
Never commit `.env` (it is git-ignored).

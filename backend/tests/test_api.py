"""HTTP-level tests for the FastAPI app (Gemini is mocked).

These need `pip install -r requirements.txt` (fastapi + httpx). Without those
packages the whole module is skipped, it does not fail.
"""
import json
import unittest
from unittest import mock

try:
    from fastapi.testclient import TestClient
    import main
    HAVE_FASTAPI = True
except ImportError:  # pragma: no cover
    HAVE_FASTAPI = False

from gemini_service import GeminiInvalidResponseError, GeminiRateLimitError, GeminiTimeoutError

VALID_TEXT = ("The User Service communicates with the Authentication Service. The Authentication Service "
              "validates credentials using the Auth Database.")
AI_GRAPH = {
    "nodes": [{"id": "user", "label": "User Service", "type": "service"},
              {"id": "auth", "label": "Authentication Service", "type": "service"},
              {"id": "auth_db", "label": "Auth Database", "type": "database"}],
    "edges": [{"source": "user", "target": "auth", "label": "communicates with"},
              {"source": "auth", "target": "auth_db", "label": "validates credentials using"}],
    "summary": "Three components.",
}


@unittest.skipUnless(HAVE_FASTAPI, "fastapi/httpx not installed")
class ApiTests(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(main.app, raise_server_exceptions=False)

    def post(self, body, **kw):
        return self.client.post("/api/generate-graph", json=body, **kw)

    # health
    def test_health(self):
        r = self.client.get("/api/health")
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["status"], "ok")
        self.assertIn("gemini_configured", r.json())
        self.assertNotIn("key", json.dumps(r.json()).lower().replace("gemini_configured", ""))

    # input validation
    def test_empty_description(self):
        r = self.post({"description": ""})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["error"]["code"], "invalid_input")

    def test_whitespace_only_description(self):
        self.assertEqual(self.post({"description": "          \n   "}).status_code, 422)

    def test_missing_field_and_wrong_type(self):
        self.assertEqual(self.post({}).status_code, 422)
        self.assertEqual(self.post({"description": 123}).status_code, 422)

    def test_malformed_json_body(self):
        r = self.client.post("/api/generate-graph", content="{oops", headers={"Content-Type": "application/json"})
        self.assertEqual(r.status_code, 422)

    def test_description_too_long(self):
        r = self.post({"description": "a" * 5001})
        self.assertEqual(r.status_code, 413)
        self.assertEqual(r.json()["error"]["code"], "description_too_long")

    def test_huge_body_rejected_by_size_limit(self):
        r = self.post({"description": "a" * 40_000})
        self.assertEqual(r.status_code, 413)

    # success path
    def test_valid_description_returns_graph(self):
        with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(return_value=AI_GRAPH)):
            r = self.post({"description": VALID_TEXT})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(len(body["nodes"]), 3)
        self.assertEqual(len(body["edges"]), 2)
        self.assertEqual(body["summary"], "Three components.")
        self.assertEqual(body["analysis"]["service_count"], 2)

    def test_duplicate_nodes_and_bad_edges_are_cleaned(self):
        messy = {"nodes": AI_GRAPH["nodes"] + [{"id": "x", "label": "auth database", "type": "database"}],
                 "edges": AI_GRAPH["edges"] + [{"source": "user", "target": "nope", "label": "calls"}],
                 "summary": ""}
        with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(return_value=messy)):
            body = self.post({"description": VALID_TEXT}).json()
        self.assertEqual(len(body["nodes"]), 3)
        self.assertEqual(len(body["edges"]), 2)
        self.assertGreaterEqual(len(body["analysis"]["warnings"]), 2)

    # AI failures
    def test_invalid_ai_json_gives_502(self):
        with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(side_effect=GeminiInvalidResponseError())):
            r = self.post({"description": VALID_TEXT})
        self.assertEqual(r.status_code, 502)
        self.assertEqual(r.json()["error"]["code"], "ai_invalid_response")

    def test_ai_object_without_nodes_gives_502(self):
        with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(return_value={"edges": []})):
            self.assertEqual(self.post({"description": VALID_TEXT}).status_code, 502)

    def test_no_components_found_gives_422(self):
        with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(return_value={"nodes": [], "edges": []})):
            r = self.post({"description": "I like turtles and long walks on the beach."})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["error"]["code"], "no_components")

    def test_timeout_and_rate_limit_status_codes(self):
        for exc, status in ((GeminiTimeoutError(), 504), (GeminiRateLimitError(), 429)):
            with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(side_effect=exc)):
                self.assertEqual(self.post({"description": VALID_TEXT}).status_code, status)

    def test_unexpected_exception_is_hidden(self):
        with mock.patch.object(main, "extract_graph", new=mock.AsyncMock(side_effect=RuntimeError("secret-path"))):
            r = self.post({"description": VALID_TEXT})
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("secret-path", r.text)

    # CORS
    def test_cors_allows_dev_origin_only(self):
        ok = self.client.get("/api/health", headers={"Origin": "http://localhost:5173"})
        self.assertEqual(ok.headers.get("access-control-allow-origin"), "http://localhost:5173")
        bad = self.client.get("/api/health", headers={"Origin": "http://evil.example"})
        self.assertIsNone(bad.headers.get("access-control-allow-origin"))


if __name__ == "__main__":
    unittest.main()

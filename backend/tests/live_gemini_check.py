"""Manual check against the REAL Gemini API (not run by the automated tests).

Usage (from backend/, with GEMINI_API_KEY set in .env):
    python tests/live_gemini_check.py
It calls Gemini once with the example from the brief, prints the raw JSON and the
validated graph, and exits non-zero if anything fails.
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from gemini_service import GeminiError, extract_graph  # noqa: E402
from graph_processor import GraphValidationError, build_graph  # noqa: E402

EXAMPLE = (
    "The User Service communicates with the Authentication Service. The Authentication Service validates "
    "credentials using the Auth Database. The Order Service communicates with the Payment Service. The "
    "Payment Service stores transaction information in the Payment Database."
)


async def main() -> int:
    try:
        raw = await extract_graph(EXAMPLE)
        graph = build_graph(raw)
    except (GeminiError, GraphValidationError) as exc:
        print(f"FAILED [{exc.code}]: {exc.public_message}")
        return 1
    print("RAW GEMINI JSON:\n", json.dumps(raw, indent=2))
    print("\nVALIDATED GRAPH:\n", json.dumps(graph, indent=2))
    print(f"\nnodes={len(graph['nodes'])} edges={len(graph['edges'])} "
          f"(the example describes 6 components and 4 connections; compare by eye)")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))

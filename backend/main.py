"""main.py - FastAPI application: routes, CORS, size limits, error handling.

Request flow for POST /api/generate-graph:
  validate body (models.py) -> extract_graph (gemini_service.py, async)
  -> build_graph (graph_processor.py) -> JSON response.
Nothing is stored: no database, no files, no cache.
"""
import logging

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from gemini_service import GeminiError, extract_graph, get_settings
from graph_processor import GraphValidationError, build_graph
from models import (
    MAX_DESCRIPTION_CHARS,
    GenerateGraphRequest,
    GenerateGraphResponse,
    HealthResponse,
)

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("meshmind.api")

# 5000 characters can be ~20 KB in UTF-8; leave room for JSON overhead.
MAX_BODY_BYTES = 32 * 1024

settings = get_settings()
app = FastAPI(
    title="MeshMind AI API",
    description="Turns infrastructure descriptions into validated dependency graphs.",
    version="1.0.0",
)


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code, "message": message}})


@app.middleware("http")
async def limit_body_size(request: Request, call_next):
    """Reject oversized bodies early when the client declares Content-Length."""
    declared = request.headers.get("content-length", "")
    if declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        return error_response(413, "request_too_large", "The request is too large.")
    return await call_next(request)


# Added after the size middleware so CORS is the outermost layer and its
# headers are present even on error responses such as 413.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Content-Type"],
)


# ------------------------------ error handlers ------------------------------
@app.exception_handler(RequestValidationError)
async def handle_validation_error(request: Request, exc: RequestValidationError):
    errors = exc.errors()
    if any(e.get("type") == "string_too_long" for e in errors):
        return error_response(
            413, "description_too_long",
            f"The description is too long. The limit is {MAX_DESCRIPTION_CHARS} characters.",
        )
    for e in errors:
        if e.get("type") == "value_error" and e.get("msg"):
            return error_response(422, "invalid_input", str(e["msg"]).removeprefix("Value error, "))
    if any(e.get("type") == "json_invalid" for e in errors):
        return error_response(422, "invalid_input", "The request body must be valid JSON.")
    return error_response(422, "invalid_input",
                          "The request must be JSON like {\"description\": \"...\"} with a text description.")


@app.exception_handler(GeminiError)
async def handle_gemini_error(request: Request, exc: GeminiError):
    return error_response(exc.status_code, exc.code, exc.public_message)


@app.exception_handler(GraphValidationError)
async def handle_graph_error(request: Request, exc: GraphValidationError):
    return error_response(exc.status_code, exc.code, exc.public_message)


@app.exception_handler(Exception)
async def handle_unexpected_error(request: Request, exc: Exception):
    logger.exception("Unhandled error")  # details stay in the server log
    return error_response(500, "internal_error", "Something went wrong on the server. Please try again.")


# --------------------------------- routes ----------------------------------
@app.get("/api/health", response_model=HealthResponse)
async def health():
    return {"status": "ok", "service": "meshmind-ai-backend", "gemini_configured": bool(get_settings().api_key)}


@app.post("/api/generate-graph", response_model=GenerateGraphResponse)
async def generate_graph(payload: GenerateGraphRequest):
    raw_graph = await extract_graph(payload.description)  # Gemini (async, with timeout)
    return build_graph(raw_graph)                         # validate + analyse

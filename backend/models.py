"""models.py - request/response shapes (input/output handling).

FastAPI uses these Pydantic models to validate incoming JSON and to shape
(and document) outgoing JSON. Limits here are mirrored in the React app
(frontend/src/services/api.js) for friendlier client-side messages, but the
backend is the real gatekeeper.
"""
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

MIN_DESCRIPTION_CHARS = 10
MAX_DESCRIPTION_CHARS = 5000


class GenerateGraphRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    description: str = Field(..., max_length=MAX_DESCRIPTION_CHARS)

    @field_validator("description")
    @classmethod
    def not_blank(cls, value: str) -> str:
        value = value.strip()
        if len(value) < MIN_DESCRIPTION_CHARS:
            raise ValueError(
                f"Please describe your infrastructure in at least {MIN_DESCRIPTION_CHARS} characters."
            )
        return value


class Node(BaseModel):
    id: str
    label: str
    type: Literal["service", "database"]


class Edge(BaseModel):
    source: str
    target: str
    label: str


class GraphAnalysis(BaseModel):
    vertex_count: int
    edge_count: int
    service_count: int
    database_count: int
    component_count: int
    components: list[list[str]]
    cycles: list[list[str]]
    has_cycles: bool
    isolated: list[str]
    warnings: list[str]


class GenerateGraphResponse(BaseModel):
    nodes: list[Node]
    edges: list[Edge]
    summary: str
    analysis: GraphAnalysis


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    gemini_configured: bool


class ErrorDetail(BaseModel):
    code: str
    message: str


class ErrorResponse(BaseModel):
    error: ErrorDetail

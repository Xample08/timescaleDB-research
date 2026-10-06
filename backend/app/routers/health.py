"""``GET /api/health``."""
from __future__ import annotations

from fastapi import APIRouter, Depends

from app import health as health_service
from app.db import ConnectionPool
from app.deps import get_read_pool
from app.schemas import ErrorResponse, HealthResponse

router = APIRouter(tags=["health"])


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": ErrorResponse, "description": "Database unavailable"}},
)
def get_health(pool: ConnectionPool = Depends(get_read_pool)) -> HealthResponse:
    """Database status, TimescaleDB extension version, and server time."""
    # plain `def`: FastAPI runs it in the threadpool, so the blocking pg8000 call is fine
    return health_service.check_health(pool)

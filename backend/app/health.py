"""Health check service: verifies the database and reports the TimescaleDB version."""
from __future__ import annotations

from datetime import timezone

from app.db import ConnectionPool
from app.schemas import HealthResponse

_HEALTH_SQL = (
    "SELECT (SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'), now()"
)


def check_health(pool: ConnectionPool) -> HealthResponse:
    """Run one cheap round trip on a pooled connection.

    Raises ``DatabaseUnavailableError`` (503) if the database cannot be reached.
    """
    with pool.acquire() as conn:
        version, server_time = conn.run(_HEALTH_SQL)[0]
    if server_time.tzinfo is None:  # session is UTC; make it explicitly aware
        server_time = server_time.replace(tzinfo=timezone.utc)
    return HealthResponse(
        db="ok",
        timescaledb_version=version,
        server_time=server_time.astimezone(timezone.utc),
    )

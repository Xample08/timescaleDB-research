"""FastAPI application: CORS, error handlers, router registration, lifespan.

Run from ``backend/``::

    uvicorn app.main:app --reload
"""
from __future__ import annotations

import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import Settings, get_settings
from app.db import ConnectionPool
from app.errors import register_error_handlers
from app.routers import health, simulation, vehicles, benchmark, storage, admin
from app.simulator import get_simulator

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("app")

API_PREFIX = "/api"


def create_app(settings: Settings | None = None, pool: ConnectionPool | None = None) -> FastAPI:
    """Build the application. ``settings``/``pool`` can be injected for tests."""
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # The pool is lazy: no connection is opened here, so the API starts (and reports
        # 503 on /api/health) even when the database is unreachable.
        app.state.settings = settings
        app.state.read_pool = pool or ConnectionPool(settings.read_dsn, settings.db_pool_size)
        log.info("Started (pool size %d, CORS origins %s)", settings.db_pool_size, settings.cors_origin_list)
        try:
            yield
        finally:
            app.state.read_pool.close()
            # Cleanly stop simulator if running
            sim = get_simulator()
            if sim.state == "running":
                sim.stop()
            log.info("Shut down")

    app = FastAPI(
        title="Vehicle Tracking Demo: TimescaleDB vs PostgreSQL",
        version="0.1.0",
        lifespan=lifespan,
    )

    # Order matters: handlers/catch-all first, CORS last so it is the outermost layer
    # and adds CORS headers to error responses too.
    register_error_handlers(app)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type", "X-Admin-Token"],
    )

    app.include_router(health.router, prefix=API_PREFIX)
    app.include_router(simulation.router, prefix=API_PREFIX)
    app.include_router(vehicles.router, prefix=API_PREFIX)
    app.include_router(benchmark.router, prefix=API_PREFIX)
    app.include_router(storage.router, prefix=API_PREFIX)
    app.include_router(admin.router, prefix=API_PREFIX)
    return app


app = create_app()

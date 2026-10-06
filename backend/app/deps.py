"""Shared FastAPI dependencies."""
from __future__ import annotations

from fastapi import Request

from app.db import ConnectionPool


def get_read_pool(request: Request) -> ConnectionPool:
    """Return the shared read pool created in the app lifespan."""
    return request.app.state.read_pool

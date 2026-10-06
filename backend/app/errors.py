"""Error model and FastAPI exception handlers (SPEC Section 10).

Every error response has the shape::

    { "error": { "code": "validation_error", "message": "human readable" } }
"""
from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

log = logging.getLogger(__name__)


class AppError(Exception):
    """Base class for errors that map to a JSON error response."""

    status_code: int = 500
    code: str = "internal_error"

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code


class BadRequestError(AppError):
    status_code = 400
    code = "bad_request"


class ValidationAppError(AppError):
    status_code = 422
    code = "validation_error"


class ForbiddenError(AppError):
    status_code = 403
    code = "forbidden"


class NotFoundError(AppError):
    status_code = 404
    code = "not_found"


class ConflictError(AppError):
    status_code = 409
    code = "conflict"


class DatabaseUnavailableError(AppError):
    """The database cannot be reached (connection refused, dropped, timed out, auth failure)."""

    status_code = 503
    code = "database_unavailable"


_HTTP_CODES: dict[int, str] = {
    400: "bad_request",
    403: "forbidden",
    404: "not_found",
    405: "method_not_allowed",
    409: "conflict",
    422: "validation_error",
    503: "service_unavailable",
}


def error_body(code: str, message: str) -> dict[str, Any]:
    """Build the standard error payload."""
    return {"error": {"code": code, "message": message}}


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    """Build a JSONResponse in the standard error format."""
    return JSONResponse(status_code=status_code, content=error_body(code, message))


def _format_validation_errors(exc: RequestValidationError) -> str:
    parts = []
    for err in exc.errors():
        loc = ".".join(str(p) for p in err.get("loc", ()) if p != "body")
        parts.append(f"{loc}: {err.get('msg', 'invalid value')}" if loc else str(err.get("msg")))
    return "; ".join(parts) or "invalid request"


async def _app_error_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, AppError)
    if exc.status_code >= 500:
        log.error("%s: %s", exc.code, exc.message)
    return error_response(exc.status_code, exc.code, exc.message)


async def _validation_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, RequestValidationError)
    return error_response(422, "validation_error", _format_validation_errors(exc))


async def _http_exception_handler(_: Request, exc: Exception) -> JSONResponse:
    assert isinstance(exc, StarletteHTTPException)
    code = _HTTP_CODES.get(exc.status_code, "http_error")
    message = exc.detail if isinstance(exc.detail, str) else str(exc.detail)
    return JSONResponse(
        status_code=exc.status_code,
        content=error_body(code, message),
        headers=getattr(exc, "headers", None),
    )


async def _catch_all_middleware(
    request: Request, call_next: Callable[[Request], Awaitable[Response]]
) -> Response:
    """Turn unexpected exceptions into a 500 in the standard format.

    Implemented as middleware (registered inside CORS) instead of an ``Exception``
    handler, because Starlette runs ``Exception`` handlers outside the CORS middleware,
    which would strip CORS headers from 500 responses.
    """
    try:
        return await call_next(request)
    except Exception:  # noqa: BLE001 - last-resort handler
        log.exception("Unhandled error on %s %s", request.method, request.url.path)
        return error_response(500, "internal_error", "Internal server error")


def register_error_handlers(app: FastAPI) -> None:
    """Install all exception handlers and the catch-all middleware on ``app``.

    Must be called **before** adding CORSMiddleware so that CORS wraps the catch-all.
    """
    app.add_exception_handler(AppError, _app_error_handler)
    app.add_exception_handler(RequestValidationError, _validation_handler)
    app.add_exception_handler(StarletteHTTPException, _http_exception_handler)
    app.middleware("http")(_catch_all_middleware)

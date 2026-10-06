"""Phase 0 unit tests (no database needed)."""
from __future__ import annotations

import ssl
from datetime import datetime, timezone
from typing import Any

import pytest
from fastapi.testclient import TestClient
from pg8000.exceptions import InterfaceError

from app import db
from app.config import Settings
from app.db import ConnectionPool, parse_dsn
from app.errors import DatabaseUnavailableError
from app.main import create_app

ORIGIN = "http://localhost:5173"


# --- parse_dsn ---------------------------------------------------------------------

def test_parse_dsn_unquotes_and_defaults_to_require() -> None:
    kw = parse_dsn("postgres://us%40er:p%3Ass@db.example.com:38559/tsdb")
    assert kw["user"] == "us@er"
    assert kw["password"] == "p:ss"
    assert kw["host"] == "db.example.com"
    assert kw["port"] == 38559
    assert kw["database"] == "tsdb"
    ctx = kw["ssl_context"]
    assert ctx is not None and ctx.verify_mode == ssl.CERT_NONE and not ctx.check_hostname


def test_parse_dsn_sslmodes() -> None:
    assert parse_dsn("postgres://u:p@h/d?sslmode=disable")["ssl_context"] is None
    assert parse_dsn("postgres://u:p@h/d")["port"] == 5432
    verified = parse_dsn("postgres://u:p@h/d?sslmode=verify-full")["ssl_context"]
    assert verified.verify_mode == ssl.CERT_REQUIRED and verified.check_hostname


@pytest.mark.parametrize("bad", ["", "mysql://u:p@h/d", "postgres:///d"])
def test_parse_dsn_rejects_invalid(bad: str) -> None:
    with pytest.raises(ValueError):
        parse_dsn(bad)


# --- pool -------------------------------------------------------------------------

class FakeConn:
    def __init__(self, fail_with: Exception | None = None) -> None:
        self.fail_with = fail_with
        self.closed = False

    def run(self, sql: str, **_: Any) -> list[list[Any]]:
        if self.fail_with:
            raise self.fail_with
        return [["2.17.2", datetime(2026, 10, 6, 3, 0, tzinfo=timezone.utc)]]

    def close(self) -> None:
        self.closed = True


def test_pool_discards_broken_connection_and_creates_new(monkeypatch: pytest.MonkeyPatch) -> None:
    created: list[FakeConn] = []

    def fake_connect(dsn: str, **_: Any) -> FakeConn:
        c = FakeConn()
        created.append(c)
        return c

    monkeypatch.setattr(db, "connect", fake_connect)
    pool = ConnectionPool("postgres://u:p@h/d", 2)

    with pytest.raises(DatabaseUnavailableError):
        with pool.acquire() as conn:
            raise InterfaceError("network error")
    assert created[0].closed

    with pool.acquire() as conn:
        assert conn is created[1]
    with pool.acquire() as conn:  # healthy connection is reused
        assert conn is created[1]
    assert len(created) == 2


def test_pool_connect_failure_is_503(monkeypatch: pytest.MonkeyPatch) -> None:
    def fail(dsn: str, **_: Any) -> FakeConn:
        raise DatabaseUnavailableError("Cannot connect to the database (InterfaceError)")

    monkeypatch.setattr(db, "connect", fail)
    pool = ConnectionPool("postgres://u:p@h/d", 1)
    with pytest.raises(DatabaseUnavailableError):
        with pool.acquire():
            pass
    # the slot was released: a second attempt fails the same way instead of blocking
    with pytest.raises(DatabaseUnavailableError):
        with pool.acquire():
            pass


# --- API --------------------------------------------------------------------------

class StubPool:
    def __init__(self, conn: FakeConn | None = None, exc: Exception | None = None) -> None:
        self.conn, self.exc = conn, exc

    from contextlib import contextmanager

    @contextmanager
    def acquire(self):  # type: ignore[no-untyped-def]
        if self.exc:
            raise self.exc
        yield self.conn

    def close(self) -> None:
        pass


def _client(pool: Any) -> TestClient:
    settings = Settings(tiger_connection_string="postgres://u:p@h/d", cors_origins=ORIGIN)  # type: ignore[arg-type]
    return TestClient(create_app(settings=settings, pool=pool))


def test_health_ok() -> None:
    with _client(StubPool(conn=FakeConn())) as client:
        r = client.get("/api/health", headers={"Origin": ORIGIN})
    assert r.status_code == 200
    body = r.json()
    assert body["db"] == "ok" and body["timescaledb_version"] == "2.17.2"
    assert body["server_time"].endswith("Z")
    assert r.headers["access-control-allow-origin"] == ORIGIN


def test_health_db_down_is_503_with_error_format_and_cors() -> None:
    pool = StubPool(exc=DatabaseUnavailableError("Cannot connect to the database (InterfaceError)"))
    with _client(pool) as client:
        r = client.get("/api/health", headers={"Origin": ORIGIN})
    assert r.status_code == 503
    assert r.json() == {
        "error": {"code": "database_unavailable", "message": "Cannot connect to the database (InterfaceError)"}
    }
    assert r.headers["access-control-allow-origin"] == ORIGIN


def test_unknown_route_uses_error_format() -> None:
    with _client(StubPool(conn=FakeConn())) as client:
        r = client.get("/api/nope")
    assert r.status_code == 404
    assert r.json()["error"]["code"] == "not_found"


def test_unexpected_error_is_500_with_error_format_and_cors() -> None:
    with _client(StubPool(exc=RuntimeError("boom"))) as client:
        r = client.get("/api/health", headers={"Origin": ORIGIN})
    assert r.status_code == 500
    assert r.json() == {"error": {"code": "internal_error", "message": "Internal server error"}}
    assert r.headers["access-control-allow-origin"] == ORIGIN


def test_cors_rejects_other_origin() -> None:
    with _client(StubPool(conn=FakeConn())) as client:
        r = client.get("/api/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in r.headers

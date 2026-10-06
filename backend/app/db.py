"""Database access: connection factory and a small thread-safe connection pool (SPEC Section 8).

``pg8000.native.Connection`` is not thread-safe and has no pool, so:

* every thread uses its own connection at a time;
* read endpoints borrow from :class:`ConnectionPool` via :meth:`ConnectionPool.acquire`;
* long-running workers (simulator, benchmark, cagg refresher, admin jobs) call
  :func:`connect` to get a dedicated connection instead of using the pool.

Never log a DSN: it contains the password.
"""
from __future__ import annotations

import logging
import queue
import ssl
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse

import pg8000.native
from pg8000.exceptions import DatabaseError, InterfaceError

from app.errors import DatabaseUnavailableError

log = logging.getLogger(__name__)

Connection = pg8000.native.Connection

# Socket timeout for pooled (dashboard read) connections. Bounds how long a request can
# hang when the network to the database silently disappears. Dedicated worker connections
# pass ``timeout=None`` so long benchmark/admin statements are not cut off by the socket.
POOL_SOCKET_TIMEOUT_SECONDS = 15.0
# Pooled connections idle longer than this are pinged with ``SELECT 1`` before reuse.
POOL_VALIDATE_AFTER_IDLE_SECONDS = 30.0
# How long a request waits for a free pooled connection before failing with 503.
POOL_ACQUIRE_TIMEOUT_SECONDS = 10.0

# SQLSTATEs that mean "the connection/server is unusable" rather than "your SQL failed".
_CONNECTION_SQLSTATE_PREFIXES = ("08", "28", "53", "57P")


def parse_dsn(dsn: str) -> dict[str, Any]:
    """Parse a ``postgres://`` URL into ``pg8000.native.Connection`` keyword arguments.

    Mirrors ``connect()`` in ``migrate.py``: ``urlparse``, ``unquote`` for user/password,
    ``sslmode`` default ``require``; ``require``/``prefer``/``allow`` encrypt without
    certificate verification, ``verify-*`` verifies, ``disable`` turns SSL off.
    """
    if not dsn or not dsn.strip():
        raise ValueError("connection string is empty")
    u = urlparse(dsn.strip())
    if u.scheme not in ("postgres", "postgresql"):
        raise ValueError("connection string must start with postgres:// or postgresql://")
    if not u.hostname:
        raise ValueError("connection string has no host")

    sslmode = parse_qs(u.query).get("sslmode", ["require"])[0]
    ssl_context: ssl.SSLContext | None = None
    if sslmode != "disable":
        ssl_context = ssl.create_default_context()
        if sslmode in ("allow", "prefer", "require"):
            # same behaviour as libpq: encrypt, but do not verify the certificate
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

    return {
        "user": unquote(u.username or ""),
        "password": unquote(u.password or ""),
        "host": u.hostname,
        "port": u.port or 5432,
        "database": (u.path or "").lstrip("/") or None,
        "ssl_context": ssl_context,
    }


def connect(dsn: str, *, timeout: float | None = None, application_name: str = "vehicle-demo") -> Connection:
    """Open a new autocommit connection and apply the session settings from SPEC Section 8.

    Runs ``SET statement_timeout = 0`` and ``SET TIME ZONE 'UTC'``. Raises
    :class:`DatabaseUnavailableError` if the server cannot be reached or rejects the login.
    """
    kwargs = parse_dsn(dsn)
    try:
        conn = pg8000.native.Connection(**kwargs, timeout=timeout, application_name=application_name)
    except Exception as exc:  # noqa: BLE001 - any failure to connect means "unavailable"
        raise DatabaseUnavailableError(f"Cannot connect to the database ({type(exc).__name__})") from exc
    try:
        # pg8000.native runs in autocommit mode unless we START TRANSACTION ourselves
        conn.run("SET statement_timeout = 0")
        conn.run("SET TIME ZONE 'UTC'")
    except Exception as exc:
        close_quietly(conn)
        raise DatabaseUnavailableError(f"Database session setup failed ({type(exc).__name__})") from exc
    return conn


def close_quietly(conn: Connection | None) -> None:
    """Close ``conn`` ignoring any error (the socket may already be dead)."""
    if conn is None:
        return
    try:
        conn.close()
    except Exception:  # noqa: BLE001
        pass


def is_connection_error(exc: BaseException) -> bool:
    """Return True if ``exc`` means the connection is broken or the server is unavailable."""
    if isinstance(exc, (InterfaceError, OSError, EOFError, DatabaseUnavailableError)):
        return True
    if isinstance(exc, DatabaseError):
        sqlstate = _sqlstate(exc)
        return sqlstate is not None and sqlstate.startswith(_CONNECTION_SQLSTATE_PREFIXES)
    return False


def _sqlstate(exc: DatabaseError) -> str | None:
    """Extract the SQLSTATE (``C`` field) from a pg8000 DatabaseError, if present."""
    if exc.args and isinstance(exc.args[0], dict):
        code = exc.args[0].get("C")
        return str(code) if code else None
    return None


@dataclass
class _Pooled:
    conn: Connection
    last_used: float = field(default_factory=time.monotonic)


class ConnectionPool:
    """A bounded pool of pg8000 connections backed by a ``queue.Queue``.

    Connections are created lazily, so the app starts even when the database is down.
    At most ``size`` connections are checked out at once. A connection that fails with a
    connection error is discarded (never returned) and a fresh one is created on the next
    acquire. Any other pg8000 error also discards the connection, because its session
    state (e.g. an aborted transaction) can no longer be trusted.
    """

    def __init__(
        self,
        dsn: str,
        size: int,
        *,
        socket_timeout: float | None = POOL_SOCKET_TIMEOUT_SECONDS,
        acquire_timeout: float = POOL_ACQUIRE_TIMEOUT_SECONDS,
        validate_after_idle: float = POOL_VALIDATE_AFTER_IDLE_SECONDS,
    ) -> None:
        if size < 1:
            raise ValueError("pool size must be >= 1")
        self._dsn = dsn
        self._size = size
        self._socket_timeout = socket_timeout
        self._acquire_timeout = acquire_timeout
        self._validate_after_idle = validate_after_idle
        self._idle: queue.Queue[_Pooled] = queue.Queue(maxsize=size)
        self._slots = threading.BoundedSemaphore(size)
        self._closed = False

    @property
    def size(self) -> int:
        """Maximum number of simultaneously checked-out connections."""
        return self._size

    @contextmanager
    def acquire(self) -> Iterator[Connection]:
        """Borrow a connection for the duration of a ``with`` block.

        Raises :class:`DatabaseUnavailableError` if no connection can be obtained, or if
        the block fails with a connection error (the original error is chained).
        """
        if self._closed:
            raise DatabaseUnavailableError("Connection pool is closed")
        if not self._slots.acquire(timeout=self._acquire_timeout):
            raise DatabaseUnavailableError("Timed out waiting for a free database connection")
        item: _Pooled | None = None
        try:
            item = self._checkout()
            try:
                yield item.conn
            except BaseException as exc:
                if isinstance(exc, (DatabaseError, InterfaceError, OSError, EOFError)):
                    self._discard(item)
                    item = None
                if is_connection_error(exc) and not isinstance(exc, DatabaseUnavailableError):
                    raise DatabaseUnavailableError(
                        f"Lost connection to the database ({type(exc).__name__})"
                    ) from exc
                raise
            else:
                item.last_used = time.monotonic()
                self._checkin(item)
                item = None
        finally:
            if item is not None:  # e.g. GeneratorExit / cancellation: do not leak the slot's conn
                self._checkin(item)
            self._slots.release()

    def close(self) -> None:
        """Close all idle connections and refuse new acquisitions."""
        self._closed = True
        while True:
            try:
                item = self._idle.get_nowait()
            except queue.Empty:
                break
            close_quietly(item.conn)

    # -- internals ---------------------------------------------------------------

    def _checkout(self) -> _Pooled:
        """Return a healthy idle connection or a new one."""
        while True:
            try:
                item = self._idle.get_nowait()
            except queue.Empty:
                break
            if time.monotonic() - item.last_used < self._validate_after_idle:
                return item
            try:
                item.conn.run("SELECT 1")
                return item
            except Exception:  # noqa: BLE001 - stale connection, try the next one
                log.info("Discarding stale pooled connection")
                close_quietly(item.conn)
        return _Pooled(connect(self._dsn, timeout=self._socket_timeout, application_name="vehicle-demo-pool"))

    def _checkin(self, item: _Pooled) -> None:
        if self._closed:
            close_quietly(item.conn)
            return
        try:
            self._idle.put_nowait(item)
        except queue.Full:  # cannot happen with the semaphore, but never leak a socket
            close_quietly(item.conn)

    @staticmethod
    def _discard(item: _Pooled) -> None:
        log.warning("Discarding pooled connection after a database error")
        close_quietly(item.conn)

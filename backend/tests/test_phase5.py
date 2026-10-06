import pytest
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from pydantic import SecretStr

from app.routers.admin import (
    CHUNK_NAME_REGEX,
    select_chunks_to_compress,
    get_admin_token,
    _check_chunk,
)
from app.config import Settings

def test_chunk_name_validation():
    assert CHUNK_NAME_REGEX.match("_hyper_3_118_chunk")
    assert CHUNK_NAME_REGEX.match("_hyper_10_2_chunk")
    assert not CHUNK_NAME_REGEX.match("hyper_3_118_chunk")
    assert not CHUNK_NAME_REGEX.match("_hyper_a_b_chunk")
    assert not CHUNK_NAME_REGEX.match("_hyper_3_118_chunk_")
    assert not CHUNK_NAME_REGEX.match("some_other_name")

def test_select_chunks_to_compress():
    now = datetime(2026, 1, 10, tzinfo=timezone.utc)
    chunks = [
        {"chunk_name": "c1", "is_compressed": True, "range_end": now - timedelta(days=5)},
        {"chunk_name": "c2", "is_compressed": False, "range_end": now - timedelta(days=5)},
        {"chunk_name": "c3", "is_compressed": False, "range_end": now - timedelta(days=2)},
        {"chunk_name": "c4", "is_compressed": False, "range_end": now + timedelta(days=1)},
    ]
    # Older than 3 days
    selected = select_chunks_to_compress(chunks, now, 3)
    assert selected == ["c2"]

def test_compression_ratio_calculation():
    def get_ratio(before, after):
        if not before or not after:
            return None
        return before / after

    assert get_ratio(100, 50) == 2.0
    assert get_ratio(None, 50) is None
    assert get_ratio(100, None) is None
    assert get_ratio(0, 50) is None
    assert get_ratio(100, 0) is None

def test_admin_token_check():
    # Unset token
    settings_unset = Settings(tiger_connection_string="postgres://a:b@c/d")
    settings_unset.admin_token = None
    with pytest.raises(HTTPException) as exc:
        get_admin_token("some_token", settings_unset)
    assert exc.value.status_code == 403
    assert "unset" in exc.value.detail.lower()

    settings = Settings(tiger_connection_string="postgres://a:b@c/d")
    settings.admin_token = SecretStr("secret123")

    # Missing token
    with pytest.raises(HTTPException) as exc:
        get_admin_token(None, settings)
    assert exc.value.status_code == 403
    assert "missing" in exc.value.detail.lower()

    # Wrong token
    with pytest.raises(HTTPException) as exc:
        get_admin_token("wrong", settings)
    assert exc.value.status_code == 403
    assert "invalid" in exc.value.detail.lower()

    # Correct token
    assert get_admin_token("secret123", settings) == "secret123"

# Mock db for future-chunk refusal test
class MockConn:
    def __init__(self, rows):
        self.rows = rows
    def run(self, query, **kwargs):
        return self.rows
    def close(self):
        pass

def test_future_chunk_refusal(monkeypatch):
    import app.routers.admin
    now = datetime.now(timezone.utc)
    
    # Active chunk (range_end in the future)
    monkeypatch.setattr(app.routers.admin, "connect", lambda *a, **k: MockConn([[now + timedelta(days=1)]]))
    
    with pytest.raises(HTTPException) as exc:
        _check_chunk("_hyper_3_118_chunk", "dummy")
    assert exc.value.status_code == 422
    assert "active" in exc.value.detail.lower() or "future" in exc.value.detail.lower()

    # Old chunk
    monkeypatch.setattr(app.routers.admin, "connect", lambda *a, **k: MockConn([[now - timedelta(days=1)]]))
    _check_chunk("_hyper_3_118_chunk", "dummy") # Should not raise

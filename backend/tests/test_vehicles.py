from datetime import datetime, timezone, timedelta
import pytest
from fastapi import HTTPException
from app.routers.vehicles import get_vehicle_route
from app.db import ConnectionPool

class MockPool:
    def __init__(self):
        self.conn = MockConn()
        
    def acquire(self):
        class Ctx:
            def __init__(self, conn):
                self.conn = conn
            def __enter__(self):
                return self.conn
            def __exit__(self, *args):
                pass
        return Ctx(self.conn)

class MockConn:
    def __init__(self):
        self.rows = []
    
    def run(self, query, **kwargs):
        if "FROM vehicles WHERE id" in query:
            return [[1]]
        if "ORDER BY time DESC LIMIT 1" in query:
            return [[datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)]]
        if "telemetry_pg" in query:
            # Just return empty, we are testing the logic before this
            return []
        return []

def test_route_default_window():
    pool = MockPool()
    # No from/to provided
    res = get_vehicle_route(vehicle_id=1, from_=None, to=None, limit=2000, pool=pool)
    assert res == []

from fastapi.testclient import TestClient
from app.main import app

def test_route_limit_cap():
    with TestClient(app) as client:
        # The route returns 422 if limit > 5000
        res = client.get("/api/vehicles/1/route?limit=6000")
        assert res.status_code == 422
        assert "limit" in res.text.lower()

def test_route_24h_cap():
    pool = MockPool()
    to_dt = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
    from_dt = to_dt - timedelta(hours=25)
    with pytest.raises(HTTPException) as exc:
        get_vehicle_route(vehicle_id=1, from_=from_dt, to=to_dt, limit=2000, pool=pool)
    assert exc.value.status_code == 422
    assert "24 hours" in exc.value.detail

def test_route_invalid_range():
    pool = MockPool()
    to_dt = datetime(2026, 10, 6, 12, 0, tzinfo=timezone.utc)
    from_dt = to_dt + timedelta(hours=1)
    with pytest.raises(HTTPException) as exc:
        get_vehicle_route(vehicle_id=1, from_=from_dt, to=to_dt, limit=2000, pool=pool)
    assert exc.value.status_code == 422
    assert "Invalid time range" in exc.value.detail

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from typing import List, Optional
from datetime import datetime, timezone, timedelta
from app.deps import get_read_pool
from app.db import ConnectionPool, connect
from app.schemas import VehicleLatest, RoutePoint, HourlyData
from app.config import get_settings

router = APIRouter(prefix="/vehicles", tags=["vehicles"])

@router.get("/latest", response_model=List[VehicleLatest])
def get_latest_vehicles(response: Response, pool: ConnectionPool = Depends(get_read_pool)):
    response.headers["Cache-Control"] = "public, max-age=2"
    query = """
        SELECT v.id AS vehicle_id, v.plate_number, v.name,
               l.time, l.latitude, l.longitude, l.speed_kmh, l.heading_deg
        FROM vehicles v
        CROSS JOIN LATERAL (
            SELECT time, latitude, longitude, speed_kmh, heading_deg
            FROM telemetry_ts t
            WHERE t.vehicle_id = v.id
            ORDER BY t.time DESC
            LIMIT 1
        ) l
        WHERE v.is_active
    """
    with pool.acquire() as conn:
        rows = conn.run(query)
        
    return [
        VehicleLatest(
            vehicle_id=row[0],
            plate_number=row[1],
            name=row[2],
            time=row[3],
            latitude=row[4],
            longitude=row[5],
            speed_kmh=row[6],
            heading_deg=row[7]
        ) for row in rows
    ]

@router.get("/{vehicle_id}/route", response_model=List[RoutePoint])
def get_vehicle_route(
    vehicle_id: int, 
    from_: Optional[datetime] = Query(None, alias="from"),
    to: Optional[datetime] = None,
    limit: int = Query(2000, le=5000),
    pool: ConnectionPool = Depends(get_read_pool)
):
    with pool.acquire() as conn:
        # Check if vehicle exists
        rows = conn.run("SELECT 1 FROM vehicles WHERE id = :id", id=vehicle_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Vehicle not found")

        if to is None:
            # Get latest time for vehicle
            rows = conn.run("SELECT time FROM telemetry_pg WHERE vehicle_id = :id ORDER BY time DESC LIMIT 1", id=vehicle_id)
            if rows:
                to = rows[0][0]
            else:
                to = datetime.now(timezone.utc)
        
        if from_ is None:
            from_ = to - timedelta(hours=1)
            
        if (to - from_).total_seconds() > 24 * 3600:
            raise HTTPException(status_code=422, detail="Time range cannot exceed 24 hours")
            
        if from_ >= to:
            raise HTTPException(status_code=422, detail="Invalid time range")

        query = """
            SELECT time, latitude, longitude, speed_kmh
            FROM telemetry_pg
            WHERE vehicle_id = :id AND time >= :from AND time <= :to
            ORDER BY time DESC
            LIMIT :limit
        """
        rows = conn.run(query, id=vehicle_id, **{"from": from_.isoformat()}, to=to.isoformat(), limit=limit)
        
    # Re-order to time ascending
    points = [
        RoutePoint(time=r[0], latitude=r[1], longitude=r[2], speed_kmh=r[3])
        for r in reversed(rows)
    ]
    return points

@router.get("/{vehicle_id}/hourly", response_model=List[HourlyData])
def get_vehicle_hourly(
    vehicle_id: int,
    hours: int = Query(48, ge=1, le=720),
    pool: ConnectionPool = Depends(get_read_pool)
):
    with pool.acquire() as conn:
        rows = conn.run("SELECT 1 FROM vehicles WHERE id = :id", id=vehicle_id)
        if not rows:
            raise HTTPException(status_code=404, detail="Vehicle not found")
            
        # Get latest bucket for vehicle
        rows = conn.run("SELECT max(bucket) FROM telemetry_hourly WHERE vehicle_id = :id", id=vehicle_id)
        latest_bucket = rows[0][0] if rows and rows[0][0] else None
        
        if not latest_bucket:
            return []
            
        from_time = latest_bucket - timedelta(hours=hours)
        
        query = """
            SELECT bucket, avg_speed, max_speed, point_count
            FROM telemetry_hourly
            WHERE vehicle_id = :id AND bucket > :from_time AND bucket <= :to_time
            ORDER BY bucket ASC
        """
        rows = conn.run(query, id=vehicle_id, from_time=from_time.isoformat(), to_time=latest_bucket.isoformat())
        
    return [
        HourlyData(bucket=r[0], avg_speed=r[1], max_speed=r[2], point_count=r[3])
        for r in rows
    ]

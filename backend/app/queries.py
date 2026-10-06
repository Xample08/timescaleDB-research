"""Benchmark queries catalog (SPEC Section 11)."""

from typing import Any, Literal
from app.schemas import BenchmarkQueryDef

# The catalog
QUERIES = [
    BenchmarkQueryDef(
        id="q1",
        title="Latest position per vehicle",
        description="Finds the most recent telemetry point for every active vehicle using a LATERAL join.",
        variants=["pg", "ts"],
        sql={
            "pg": """SELECT v.id AS vehicle_id, l.time, l.latitude, l.longitude, l.speed_kmh
FROM vehicles v
CROSS JOIN LATERAL (
    SELECT time, latitude, longitude, speed_kmh
    FROM telemetry_pg t
    WHERE t.vehicle_id = v.id
    ORDER BY t.time DESC
    LIMIT 1
) l
WHERE v.is_active""",
            "ts": """SELECT v.id AS vehicle_id, l.time, l.latitude, l.longitude, l.speed_kmh
FROM vehicles v
CROSS JOIN LATERAL (
    SELECT time, latitude, longitude, speed_kmh
    FROM telemetry_ts t
    WHERE t.vehicle_id = v.id
    ORDER BY t.time DESC
    LIMIT 1
) l
WHERE v.is_active"""
        }
    ),
    BenchmarkQueryDef(
        id="q2",
        title="One vehicle route, fixed 1-day window",
        description="Retrieves a 24-hour continuous route for a single vehicle.",
        variants=["pg", "ts"],
        sql={
            "pg": """SELECT time, latitude, longitude
FROM telemetry_pg
WHERE vehicle_id = {vehicle_id} AND time >= {ref_minus_1_day} AND time < {ref}
ORDER BY time""",
            "ts": """SELECT time, latitude, longitude
FROM telemetry_ts
WHERE vehicle_id = {vehicle_id} AND time >= {ref_minus_1_day} AND time < {ref}
ORDER BY time"""
        }
    ),
    BenchmarkQueryDef(
        id="q3",
        title="Fleet daily average speed over 7 days",
        description="Calculates daily average speed across all vehicles over the last 7 days.",
        variants=["pg", "ts"],
        sql={
            "pg": """SELECT date_trunc('day', time) AS bucket, avg(speed_kmh) AS avg_speed
FROM telemetry_pg WHERE time >= {ref_minus_days} AND time < {ref} GROUP BY 1 ORDER BY 1""",
            "ts": """SELECT time_bucket('1 day', time) AS bucket, avg(speed_kmh) AS avg_speed
FROM telemetry_ts WHERE time >= {ref_minus_days} AND time < {ref} GROUP BY 1 ORDER BY 1"""
        }
    ),
    BenchmarkQueryDef(
        id="q4",
        title="Fleet hourly average speed over 7 days",
        description="Calculates hourly average speed across the fleet, using continuous aggregates for TimescaleDB.",
        variants=["pg", "ts", "ts_cagg"],
        sql={
            "pg": """SELECT date_trunc('hour', time) AS bucket, avg(speed_kmh) AS avg_speed
FROM telemetry_pg WHERE time >= {ref_minus_days_hour} AND time < {ref_hour} GROUP BY 1 ORDER BY 1""",
            "ts": """SELECT time_bucket('1 hour', time) AS bucket, avg(speed_kmh) AS avg_speed
FROM telemetry_ts WHERE time >= {ref_minus_days_hour} AND time < {ref_hour} GROUP BY 1 ORDER BY 1""",
            "ts_cagg": """SELECT bucket AS bucket,
       sum(avg_speed * point_count) / sum(point_count) AS avg_speed
FROM telemetry_hourly
WHERE bucket >= {ref_minus_days_hour} AND bucket < {ref_hour}
GROUP BY bucket ORDER BY bucket"""
        }
    )
]

def get_query_def(query_id: str) -> BenchmarkQueryDef | None:
    for q in QUERIES:
        if q.id == query_id:
            return q
    return None

def validate_table_variant(table: str) -> Literal["pg", "ts", "ts_cagg"]:
    if table not in ["pg", "ts", "ts_cagg"]:
        raise ValueError(f"Invalid table variant: {table}")
    return table  # type: ignore

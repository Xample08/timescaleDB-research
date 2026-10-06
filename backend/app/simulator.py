"""Simulator thread and movement model (SPEC Section 9)."""
from __future__ import annotations

import logging
import math
import random
import threading
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from typing import Any

from app.db import connect, DatabaseUnavailableError, close_quietly
from app.config import get_settings

log = logging.getLogger(__name__)

CENTER_LAT = -6.2000
CENTER_LON = 106.8000
MAX_RADIUS_KM = 15.0


def calculate_bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate bearing from (lat1, lon1) to (lat2, lon2) in degrees."""
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    dlon_rad = math.radians(lon2 - lon1)
    y = math.sin(dlon_rad) * math.cos(lat2_rad)
    x = math.cos(lat1_rad) * math.sin(lat2_rad) - math.sin(lat1_rad) * math.cos(lat2_rad) * math.cos(dlon_rad)
    brng = math.degrees(math.atan2(y, x))
    return (brng + 360) % 360


def calculate_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Approximate distance in km using equirectangular approximation for small distances."""
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return math.sqrt(x * x + y * y) * 6371.0


def percentile(data: list[float], p: float) -> float:
    if not data:
        return 0.0
    sorted_data = sorted(data)
    k = (len(sorted_data) - 1) * (p / 100.0)
    f = math.floor(k)
    c = math.ceil(k)
    if f == c:
        return sorted_data[int(k)]
    d0 = sorted_data[int(f)] * (c - k)
    d1 = sorted_data[int(c)] * (k - f)
    return d0 + d1


class VehicleState:
    def __init__(self, vehicle_id: int):
        self.vehicle_id = vehicle_id
        
        # Initial positions uniformly random within 10 km
        angle = random.uniform(0, 360)
        dist = random.uniform(0, 10)
        self.lat = CENTER_LAT + (dist * math.cos(math.radians(angle)) / 111.32)
        self.lon = CENTER_LON + (dist * math.sin(math.radians(angle)) / (111.32 * math.cos(math.radians(self.lat))))
        
        self.speed_kmh = random.uniform(20, 60)
        self.heading_deg = random.uniform(0, 360)
        self.altitude_m = random.uniform(5, 25)
        
        self.stop_ticks = 0

    def tick(self, dt: float) -> dict[str, Any]:
        if self.stop_ticks > 0:
            self.stop_ticks -= 1
            self.speed_kmh = 0.0
        else:
            self.heading_deg = (self.heading_deg + random.gauss(0, 10)) % 360
            self.speed_kmh = max(0.0, min(80.0, self.speed_kmh + random.gauss(0, 3)))
            
            if random.random() < 0.02:
                self.stop_ticks = random.randint(3, 10)
                self.speed_kmh = 0.0
            elif self.speed_kmh == 0.0:
                # Was stopped, now resume
                self.speed_kmh = random.uniform(20, 40)

        # Dist from center check (do it before move to adjust heading if needed)
        dist_from_center = calculate_distance(self.lat, self.lon, CENTER_LAT, CENTER_LON)
        if dist_from_center > MAX_RADIUS_KM:
            bearing_to_center = calculate_bearing(self.lat, self.lon, CENTER_LAT, CENTER_LON)
            self.heading_deg = (bearing_to_center + random.uniform(-20, 20)) % 360

        dist_km = self.speed_kmh * dt / 3600.0
        self.lat += dist_km * math.cos(math.radians(self.heading_deg)) / 111.32
        self.lon += dist_km * math.sin(math.radians(self.heading_deg)) / (111.32 * math.cos(math.radians(self.lat)))

        self.altitude_m = max(5.0, min(25.0, self.altitude_m + random.gauss(0, 1)))
        gps_accuracy_m = random.uniform(3, 15)

        return {
            "vehicle_id": self.vehicle_id,
            "latitude": round(self.lat, 6),
            "longitude": round(self.lon, 6),
            "speed_kmh": round(self.speed_kmh, 1),
            "heading_deg": round(self.heading_deg, 1),
            "altitude_m": round(self.altitude_m, 1),
            "gps_accuracy_m": round(gps_accuracy_m, 1)
        }

class CaggRefresher:
    def __init__(self):
        self.stop_event = threading.Event()
        self.thread = None

    def start(self):
        self.stop_event.clear()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def stop(self):
        self.stop_event.set()
        if self.thread and self.thread.is_alive():
            self.thread.join(timeout=2.0)

    def _run(self):
        settings = get_settings()
        interval = settings.cagg_refresh_interval_seconds
        dsn = settings.tiger_connection_string.get_secret_value() if hasattr(settings.tiger_connection_string, "get_secret_value") else settings.tiger_connection_string
        
        while not self.stop_event.is_set():
            if self.stop_event.wait(interval):
                break
                
            now_utc = datetime.now(timezone.utc)
            start = now_utc - timedelta(hours=3)
            end = now_utc
            
            conn = None
            try:
                conn = connect(dsn, application_name="cagg-refresher")
                conn.autocommit = True
                conn.run("CALL refresh_continuous_aggregate('telemetry_hourly', CAST(:start AS timestamptz), CAST(:end AS timestamptz))", start=start.isoformat(), end=end.isoformat())
                log.debug(f"Successfully refreshed telemetry_hourly from {start} to {end}")
            except Exception as e:
                # Treat refresh errors as non-fatal
                log.debug(f"Failed to refresh continuous aggregate: {e}")
            finally:
                if conn:
                    close_quietly(conn)


class Simulator:
    def __init__(self):
        self.state = "idle"
        self.config = None
        self.thread = None
        self.stop_event = threading.Event()
        self.message = None
        
        self.totals = {"rows_pg": 0, "rows_ts": 0, "errors": 0}
        self.started_at = None
        self.last_tick_at = None
        self.metrics_buffer = deque(maxlen=1000)
        self.tick_count = 0
        
        # Cumulative latency tracking
        self.pg_latencies = []
        self.ts_latencies = []
        self.cagg_refresher = CaggRefresher()

    def start(self, config, vehicles_data):
        if self.state in ("running", "stopping"):
            raise ValueError("Simulation already running")
        self.config = config
        self.state = "running"
        self.message = None
        self.stop_event.clear()
        
        self.totals = {"rows_pg": 0, "rows_ts": 0, "errors": 0}
        self.started_at = datetime.now(timezone.utc)
        self.last_tick_at = None
        self.metrics_buffer.clear()
        self.tick_count = 0
        self.pg_latencies = []
        self.ts_latencies = []
        
        self.thread = threading.Thread(target=self._run, args=(vehicles_data,), daemon=True)
        self.thread.start()
        self.cagg_refresher.start()

    def stop(self):
        if self.state == "running":
            self.state = "stopping"
            self.stop_event.set()
            self.cagg_refresher.stop()

    def _get_status(self):
        pg_recent = []
        ts_recent = []
        recent_cutoff = datetime.now(timezone.utc) - timedelta(seconds=30)
        rows_in_last_30s = 0
        
        for m in list(self.metrics_buffer)[-300:]:
            if m["time"] >= recent_cutoff:
                rows_in_last_30s += m["rows"]
            if "pg" in m["latency_ms"]:
                pg_recent.append(m["latency_ms"]["pg"])
            if "ts" in m["latency_ms"]:
                ts_recent.append(m["latency_ms"]["ts"])
                
        return {
            "state": self.state,
            "config": self.config,
            "started_at": self.started_at,
            "last_tick_at": self.last_tick_at,
            "totals": self.totals,
            "rows_per_second": rows_in_last_30s / 30.0 if self.state == "running" else 0.0,
            "latency_ms": {
                "pg": {
                    "p50": percentile(pg_recent, 50),
                    "p95": percentile(pg_recent, 95),
                    "p50_cumulative": percentile(self.pg_latencies, 50),
                    "p95_cumulative": percentile(self.pg_latencies, 95),
                },
                "ts": {
                    "p50": percentile(ts_recent, 50),
                    "p95": percentile(ts_recent, 95),
                    "p50_cumulative": percentile(self.ts_latencies, 50),
                    "p95_cumulative": percentile(self.ts_latencies, 95),
                }
            },
            "message": self.message
        }

    def _run(self, vehicles_data):
        settings = get_settings()
        dsn = settings.tiger_connection_string.get_secret_value() if hasattr(settings.tiger_connection_string, "get_secret_value") else settings.tiger_connection_string
        
        vehicles = [VehicleState(v["id"]) for v in vehicles_data]
        dt = 1.0 if self.config.mode == "burst" else self.config.interval_seconds
        last_ts = datetime.now(timezone.utc)
        
        consecutive_errors = 0
        
        while not self.stop_event.is_set():
            if self.totals["rows_pg"] >= self.config.max_rows or self.totals["rows_ts"] >= self.config.max_rows:
                self.state = "idle"
                self.message = "Auto-stopped: max_rows reached"
                break
                
            tick_start = time.time()
            self.tick_count += 1
            
            # 1. Generate data
            now_utc = datetime.now(timezone.utc)
            tick_time = max(now_utc, last_ts + timedelta(microseconds=1))
            last_ts = tick_time
            
            tick_rows = []
            for v in vehicles:
                row = v.tick(dt)
                row["time"] = tick_time.isoformat()
                tick_rows.append(row)
                
            # 2. Write data
            latency_ms = {}
            tick_errors = 0
            
            targets = self.config.targets
            if self.tick_count % 2 == 1 and len(targets) > 1:
                targets = list(reversed(targets))
                
            try:
                for target in targets:
                    table = "telemetry_pg" if target == "pg" else "telemetry_ts"
                    conn = None
                    try:
                        conn = connect(dsn, application_name=f"simulator-{target}")
                        
                        start_time = time.perf_counter()
                        
                        if self.config.mode == "per_row":
                            chunks = [[r] for r in tick_rows]
                        else:
                            chunks = [tick_rows[i:i+500] for i in range(0, len(tick_rows), 500)]
                            
                        for chunk in chunks:
                            conn.run("START TRANSACTION")
                            
                            # Build query
                            vals = []
                            kwargs = {}
                            for i, row in enumerate(chunk):
                                vals.append(f"(CAST(:t{i} AS timestamptz), :v{i}, :lat{i}, :lon{i}, CAST(:s{i} AS real), CAST(:h{i} AS real), CAST(:a{i} AS real), CAST(:g{i} AS real))")
                                kwargs[f"t{i}"] = row["time"]
                                kwargs[f"v{i}"] = row["vehicle_id"]
                                kwargs[f"lat{i}"] = row["latitude"]
                                kwargs[f"lon{i}"] = row["longitude"]
                                kwargs[f"s{i}"] = row["speed_kmh"]
                                kwargs[f"h{i}"] = row["heading_deg"]
                                kwargs[f"a{i}"] = row["altitude_m"]
                                kwargs[f"g{i}"] = row["gps_accuracy_m"]
                                
                            sql = f"""INSERT INTO {table} (time, vehicle_id, latitude, longitude, speed_kmh, heading_deg, altitude_m, gps_accuracy_m)
                                     VALUES {','.join(vals)}
                                     ON CONFLICT (vehicle_id, time) DO NOTHING"""
                            conn.run(sql, **kwargs)
                            conn.run("COMMIT")
                            
                        lat = (time.perf_counter() - start_time) * 1000.0
                        latency_ms[target] = lat
                        
                        if target == "pg":
                            self.totals["rows_pg"] += len(tick_rows)
                            self.pg_latencies.append(lat)
                        else:
                            self.totals["rows_ts"] += len(tick_rows)
                            self.ts_latencies.append(lat)
                            
                        consecutive_errors = 0
                        
                    except Exception as e:
                        if conn:
                            close_quietly(conn)
                        log.error(f"DB error writing to {table}: {e}")
                        tick_errors += 1
                        self.totals["errors"] += 1
                        consecutive_errors += 1
                    finally:
                        if conn:
                            close_quietly(conn)
                            
            except Exception as e:
                log.error(f"Unexpected error in simulator: {e}")
                tick_errors += 1
                self.totals["errors"] += 1
                consecutive_errors += 1
                
            if consecutive_errors >= 10:
                self.state = "failed"
                self.message = "Stopped due to 10 consecutive database errors"
                break
                
            self.last_tick_at = datetime.now(timezone.utc)
            self.metrics_buffer.append({
                "tick": self.tick_count,
                "time": self.last_tick_at,
                "rows": len(tick_rows),
                "latency_ms": latency_ms,
                "errors": tick_errors
            })
            log.debug(f"Tick {self.tick_count} complete. Errors: {tick_errors}")
            
            if self.config.mode != "burst":
                elapsed = time.time() - tick_start
                sleep_time = max(0.0, dt - elapsed)
                if tick_errors > 0:
                    sleep_time = max(sleep_time, min(30, 2 ** (consecutive_errors - 1)))
                if sleep_time > 0:
                    self.stop_event.wait(sleep_time)

        if self.state == "stopping":
            self.state = "idle"

_simulator_instance = Simulator()

def get_simulator() -> Simulator:
    return _simulator_instance

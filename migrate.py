#!/usr/bin/env python3
"""
Migrate the schema and seed dummy telemetry into Tiger Cloud.
Uses pg8000 (pure Python driver, no DLL needed, works with Windows Smart App Control).

Setup:
    pip install pg8000

Usage:
    python migrate.py            # schema + seed
    python migrate.py schema     # only create tables
    python migrate.py seed       # only generate data

Data is generated server-side with generate_series (no big network transfer),
inserted into telemetry_ts first, then copied into telemetry_pg per batch so
both tables hold the exact same rows.
"""
import os
import re
import ssl
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from dotenv import load_dotenv
import pg8000.native

load_dotenv()

# =====================================================================
# CONFIG
# =====================================================================
# Fill in your Tiger Cloud connection string (or set TIGER_CONNECTION_STRING)
CONNECTION_STRING = os.getenv("TIGER_CONNECTION_STRING", "")

TOTAL_ROWS = 100_000_000                # <-- how many telemetry rows to generate (per table)
NUM_VEHICLES = 100                # used only if the vehicles table is empty
SAMPLE_INTERVAL_SECONDS = 10      # time gap between points of one vehicle
BATCH_ROWS = 1_000_000            # rows per transaction

RESET_SCHEMA = True              # True = DROP all tables/views first (destructive!)
CLEAN_BEFORE_SEED = True          # True = TRUNCATE telemetry tables before seeding
REFRESH_CAGG = True               # refresh telemetry_hourly after seeding

SCHEMA_FILE = Path(__file__).with_name("schema.sql")

# =====================================================================


def connect() -> pg8000.native.Connection:
    if CONNECTION_STRING.strip() in ("", "..."):
        sys.exit("Set CONNECTION_STRING (or TIGER_CONNECTION_STRING) first.")

    u = urlparse(CONNECTION_STRING)
    sslmode = parse_qs(u.query).get("sslmode", ["require"])[0]

    ssl_context = None
    if sslmode != "disable":
        ssl_context = ssl.create_default_context()
        if sslmode in ("allow", "prefer", "require"):
            # same behaviour as libpq: encrypt, but do not verify the certificate
            ssl_context.check_hostname = False
            ssl_context.verify_mode = ssl.CERT_NONE

    conn = pg8000.native.Connection(
        user=unquote(u.username or ""),
        password=unquote(u.password or ""),
        host=u.hostname,
        port=u.port or 5432,
        database=(u.path or "").lstrip("/") or None,
        ssl_context=ssl_context,
    )
    # pg8000.native runs in autocommit mode unless we START TRANSACTION ourselves
    conn.run("SET statement_timeout = 0")
    return conn


def split_sql(text: str) -> list[str]:
    """Strip -- comments and split into single statements."""
    lines = [re.sub(r"--.*$", "", line) for line in text.splitlines()]
    return [s.strip() for s in "\n".join(lines).split(";") if s.strip()]


def run_schema(conn) -> None:
    if RESET_SCHEMA:
        print("Resetting schema...")
        conn.run("DROP MATERIALIZED VIEW IF EXISTS telemetry_hourly")
        conn.run("DROP TABLE IF EXISTS telemetry_ts, telemetry_pg, vehicles CASCADE")

    # autocommit is required: continuous aggregates cannot be created inside a transaction
    for stmt in split_sql(SCHEMA_FILE.read_text()):
        conn.run(stmt)
        print("ok:", " ".join(stmt.split())[:80])
    print("Schema ready.\n")


# rumus latitude/longitude:
# lat = -6.2000 + (id % 50) * 0.002 + 0.08 * sin(detik / 1800 + id) + noise
# lon = 106.8000 + (id % 50) * 0.002 + 0.08 * cos(detik / 2400 + id * 0.7) + noise
def insert_batch_sql(first: datetime, last: datetime, step_seconds: int) -> str:
    # No bind parameters and no "::" casts on purpose (pg8000.native treats ":" specially)
    return f"""
INSERT INTO telemetry_ts
    (time, vehicle_id, latitude, longitude, speed_kmh, heading_deg, altitude_m, gps_accuracy_m)
SELECT
    t.ts,
    v.id,
    -6.2000 + (v.id % 50) * 0.002
        + 0.08 * sin(extract(epoch FROM t.ts) / 1800.0 + v.id)
        + (random() - 0.5) * 0.0004,
    106.8000 + (v.id % 50) * 0.002
        + 0.08 * cos(extract(epoch FROM t.ts) / 2400.0 + v.id * 0.7)
        + (random() - 0.5) * 0.0004,
    round(CAST(random() * 80 AS numeric), 1),
    round(CAST(random() * 360 AS numeric), 1),
    round(CAST(5 + random() * 20 AS numeric), 1),
    round(CAST(3 + random() * 12 AS numeric), 1)
FROM generate_series(
        CAST('{first.isoformat()}' AS timestamptz),
        CAST('{last.isoformat()}' AS timestamptz),
        CAST('{step_seconds} seconds' AS interval)
     ) AS t(ts)
CROSS JOIN vehicles v
"""


def copy_batch_sql(first: datetime, end: datetime) -> str:
    return f"""
INSERT INTO telemetry_pg
SELECT * FROM telemetry_ts
WHERE time >= CAST('{first.isoformat()}' AS timestamptz)
  AND time <  CAST('{end.isoformat()}' AS timestamptz)
"""


def fmt_eta(seconds: float) -> str:
    m, s = divmod(int(seconds), 60)
    h, m = divmod(m, 60)
    return f"{h}h{m:02d}m" if h else f"{m}m{s:02d}s"


def run_seed(conn) -> None:
    n = conn.run("SELECT count(*) FROM vehicles")[0][0]
    if n == 0:
        conn.run(f"""
            INSERT INTO vehicles (plate_number, name, vehicle_type)
            SELECT 'B ' || (1000 + g) || ' ' || (ARRAY['ABC','XYZ','KLM','QRS'])[1 + g % 4],
                   'Vehicle ' || g,
                   (ARRAY['truck','car','motorcycle','van'])[1 + g % 4]
            FROM generate_series(1, {int(NUM_VEHICLES)}) AS g
        """)
        n = NUM_VEHICLES
    print(f"Vehicles: {n}")

    if CLEAN_BEFORE_SEED:
        conn.run("TRUNCATE telemetry_ts, telemetry_pg")

    total_steps = TOTAL_ROWS // n                 # points per vehicle
    steps_per_batch = max(1, BATCH_ROWS // n)
    total_rows = total_steps * n                  # rounded down to a multiple of vehicles
    step = timedelta(seconds=SAMPLE_INTERVAL_SECONDS)
    start = (datetime.now(timezone.utc) - step * total_steps).replace(microsecond=0)

    print(f"Generating {total_rows:,} rows per table "
          f"({total_steps:,} points x {n} vehicles), "
          f"time span {step * total_steps}, batches of ~{steps_per_batch * n:,} rows\n")

    done_steps = 0
    t0 = time.time()
    while done_steps < total_steps:
        steps = min(steps_per_batch, total_steps - done_steps)
        first = start + step * done_steps
        last = start + step * (done_steps + steps - 1)
        end = start + step * (done_steps + steps)

        conn.run("START TRANSACTION")
        try:
            conn.run(insert_batch_sql(first, last, SAMPLE_INTERVAL_SECONDS))
            conn.run(copy_batch_sql(first, end))
            conn.run("COMMIT")
        except Exception:
            conn.run("ROLLBACK")
            raise

        done_steps += steps
        done_rows = done_steps * n
        elapsed = time.time() - t0
        rate = done_rows / elapsed
        eta = (total_rows - done_rows) / rate
        print(f"\r{done_rows:>14,} / {total_rows:,} "
              f"({done_rows / total_rows:6.2%})  {rate:,.0f} rows/s  ETA {fmt_eta(eta)}   ",
              end="", flush=True)

    print(f"\n\nInserted in {fmt_eta(time.time() - t0)}. Running ANALYZE...")
    conn.run("ANALYZE telemetry_pg")
    conn.run("ANALYZE telemetry_ts")

    if REFRESH_CAGG:
        print("Refreshing continuous aggregate...")
        conn.run("CALL refresh_continuous_aggregate('telemetry_hourly', NULL, NULL)")
    print("Done.")


def main() -> None:
    step = sys.argv[1] if len(sys.argv) > 1 else "all"
    if step not in ("all", "schema", "seed"):
        sys.exit("Usage: python migrate.py [schema|seed|all]")

    conn = connect()
    try:
        if step in ("all", "schema"):
            run_schema(conn)
        if step in ("all", "seed"):
            run_seed(conn)
    finally:
        conn.close()


if __name__ == "__main__":
    main()

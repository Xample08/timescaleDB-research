# SPEC.md — Vehicle Tracking Demo: TimescaleDB vs PostgreSQL

Spec version 1.0 · 2026-10-06 · Audience: AI coding agents and the developer

## 0. How to use this document

- This file is the source of truth. Implement **one phase at a time** (Section 14). Do not build features from later phases.
- Keywords: **MUST** = required, **SHOULD** = strongly preferred, **MAY** = optional.
- If this spec conflicts with reality (for example a TimescaleDB view has a different column name on the installed version), follow reality, record the deviation in `README.md` under "Deviations", and do not improvise silently.
- Do **not** modify `schema.sql` or `migrate.py` unless a task explicitly says so.
- Read Section 15 (Pitfalls) before writing any database code.

## 1. Purpose

A website that demonstrates and measures the difference between **TimescaleDB** and **vanilla PostgreSQL** for vehicle tracking data (devices posting latitude/longitude continuously). It supports a research report on:

1. Inner workings of TimescaleDB (hypertable, chunks, chunk exclusion, compression, continuous aggregates) compared with plain PostgreSQL.
2. A live simulation: virtual vehicles send data every few seconds into the database.
3. A dashboard: live ingest metrics, benchmark results, storage comparison, chunk explorer.

Core idea: every simulated batch is written to **both** tables (`telemetry_pg`, `telemetry_ts`) and the latency of each write is measured separately.

## 2. Non-goals (v1)

- No user accounts or multi-user support. Single-user demo. Only admin endpoints are protected, by a token.
- No device protocol (MQTT, HTTP from real devices). The simulator is in-process.
- No schema changes and no new tables.
- No `DELETE` vs `drop_chunks` retention demo (may be added later).
- No deployment configuration (Docker, CI). Local run only.

## 3. Existing assets (do not modify)

Database: Tiger Cloud service (TimescaleDB on PostgreSQL), already provisioned. Connection string is provided via environment variable.

Existing files in the repo root: `schema.sql`, `migrate.py`. `migrate.py` creates the schema and seeds up to ~100 million rows per telemetry table (default 100 vehicles, 10-second interval, so the seeded data spans months and ends at the time the seed ran). The simulator appends **new rows after** that range.

Schema (source of truth is `schema.sql`; this is a summary):

```sql
CREATE TABLE vehicles (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plate_number  TEXT        NOT NULL UNIQUE,
    name          TEXT,
    vehicle_type  TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- plain PostgreSQL baseline
CREATE TABLE telemetry_pg (
    time TIMESTAMPTZ NOT NULL,
    vehicle_id INTEGER NOT NULL REFERENCES vehicles(id),
    latitude DOUBLE PRECISION NOT NULL,
    longitude DOUBLE PRECISION NOT NULL,
    speed_kmh REAL, heading_deg REAL, altitude_m REAL, gps_accuracy_m REAL,
    PRIMARY KEY (vehicle_id, time)
);
CREATE INDEX telemetry_pg_time_idx ON telemetry_pg (time DESC);

-- hypertable, same columns, chunk interval 1 day
CREATE TABLE telemetry_ts ( /* identical columns and PK */ );
SELECT create_hypertable('telemetry_ts', 'time', chunk_time_interval => INTERVAL '1 day');
-- compression enabled: segmentby vehicle_id, orderby time DESC (no automatic policy)

-- continuous aggregate (created WITH NO DATA, refreshed manually)
CREATE MATERIALIZED VIEW telemetry_hourly WITH (timescaledb.continuous) AS
SELECT time_bucket('1 hour', time) AS bucket, vehicle_id,
       avg(speed_kmh) AS avg_speed, max(speed_kmh) AS max_speed, count(*) AS point_count
FROM telemetry_ts GROUP BY bucket, vehicle_id WITH NO DATA;
```

Facts the implementation MUST respect:

- Primary key is `(vehicle_id, time)`. Duplicate pairs are rejected, so all inserts use `ON CONFLICT (vehicle_id, time) DO NOTHING`.
- The telemetry tables hold up to ~100 million rows. Never run `count(*)` or an unbounded `SELECT` on them (see Section 13).
- Chunk names look like `_hyper_3_118_chunk` but differ per service. Never hardcode them.

## 4. Tech stack and constraints

| Layer | Choice |
|---|---|
| Backend | Python 3.11+, FastAPI, Uvicorn, Pydantic v2, `pydantic-settings` |
| DB driver | **`pg8000` (pure Python), `pg8000.native.Connection`** |
| Frontend | React 18 + Vite + TypeScript, Tailwind CSS, TanStack Query, Recharts, react-leaflet (OpenStreetMap tiles) |
| Tests | pytest (backend), Vitest (frontend, optional) |

**The driver MUST be `pg8000`, not `psycopg`/`psycopg-binary`.** The developer's Windows machine blocks the unsigned `libpq` DLL shipped by `psycopg[binary]` (Smart App Control). Do not add psycopg, asyncpg, or any driver that ships native DLLs.

`pg8000.native.Connection` is **not thread-safe** and has no built-in pool, so the backend implements its own (Section 8). FastAPI endpoints are plain `def` (run in the threadpool), not `async def`, wherever they touch the database.

Development target is Windows (PowerShell) but the code MUST be OS-independent.

## 5. Repository layout

```
.
├── SPEC.md
├── schema.sql              (existing)
├── migrate.py              (existing)
├── backend/
│   ├── requirements.txt
│   ├── .env.example
│   ├── app/
│   │   ├── main.py             FastAPI app, CORS, router registration, lifespan
│   │   ├── config.py           Settings (pydantic-settings)
│   │   ├── db.py               connection factory + ConnectionPool
│   │   ├── errors.py           error model and handlers
│   │   ├── simulator.py        Simulator thread, movement model, metrics buffer
│   │   ├── queries.py          benchmark query catalog (Section 11)
│   │   ├── benchmark.py        benchmark runner + EXPLAIN parsing
│   │   ├── routers/
│   │   │   ├── health.py  simulation.py  vehicles.py
│   │   │   ├── benchmark.py  storage.py  admin.py
│   │   └── schemas.py          Pydantic request/response models
│   └── tests/
├── frontend/
│   ├── package.json
│   └── src/
│       ├── api.ts          typed client (types mirror Section 10)
│       ├── pages/          Simulation, Vehicles, Benchmark, Storage, Learn
│       └── components/
└── README.md               setup, run, deviations
```

## 6. Configuration (environment variables)

Loaded from `backend/.env` (never committed; provide `.env.example`).

| Variable | Default | Meaning |
|---|---|---|
| `TIGER_CONNECTION_STRING` | required | `postgres://user:pass@host:port/db?sslmode=require` |
| `READONLY_CONNECTION_STRING` | unset | Optional read-only role for dashboard reads. Falls back to the main string. |
| `ADMIN_TOKEN` | unset | If unset, all `/api/admin/*` endpoints return 403. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated. |
| `DB_POOL_SIZE` | 5 | Connections in the shared read pool. |
| `SIM_MAX_VEHICLES` | 1000 | Upper bound for `num_vehicles`. |
| `SIM_MIN_INTERVAL_SECONDS` | 1 | Lower bound for `interval_seconds`. |
| `SIM_DEFAULT_MAX_ROWS` | 1000000 | Auto-stop limit per table. |
| `BENCH_STATEMENT_TIMEOUT_SECONDS` | 120 | Per-query timeout in benchmarks. |
| `CAGG_REFRESH_INTERVAL_SECONDS` | 60 | Refresh period while the simulator runs. |

Connection string parsing MUST reuse the logic of `connect()` in `migrate.py`: `urlparse`, `unquote` for user and password, `sslmode` handling (`require`/`prefer`/`allow` = encrypted without certificate verification, `verify-*` = verified, `disable` = no SSL).

## 7. Architecture

```
Simulator thread (N virtual vehicles)
      │ every X seconds: one batch
      ▼
  Ingest (same process) ── writes to ──► telemetry_pg   (latency measured)
                          └────────────► telemetry_ts   (latency measured)
                                              ▲
React dashboard ── REST polling ──► FastAPI ──┘ reads (latest, route, hourly,
                                               benchmark, storage, chunks)
```

Processes: one FastAPI process. The simulator is a `threading.Thread` owned by a singleton `Simulator` object; it is **not** started on app startup, only by `POST /api/simulation/start`. At most one simulation runs at a time.

## 8. Database access rules

1. **Connections.** `db.py` exposes `connect(dsn)` (same behavior as `migrate.py`), executes `SET statement_timeout = 0` and `SET TIME ZONE 'UTC'` after connecting, and a `ConnectionPool` (a `queue.Queue` of connections) with an `acquire()` context manager. On any connection error the pool MUST discard the connection and create a new one. Read endpoints use the pool.
2. **Dedicated connections.** The simulator thread, the benchmark runner, the cagg refresher, and admin jobs each use their **own** connection, not the pool, so long operations never starve dashboard reads.
3. **Parameters.** Use pg8000 named parameters (`:name`, values as keyword args) for all values: `conn.run("... WHERE vehicle_id = :vid", vid=42)`.
4. **No `::` casts.** `pg8000.native` treats `:` specially. Use `CAST(x AS type)`. Never put `:` in SQL text outside string literals and named parameters.
5. **Identifiers cannot be parameters.** The only dynamic identifier is a chunk name. Validate it against `^_hyper_\d+_\d+_chunk$` and build `_timescaledb_internal.<name>` yourself.
6. **EXPLAIN and benchmark queries** are executed with values inlined through safe helpers (`int(...)` for ids, `CAST('<datetime.isoformat()>' AS timestamptz)` for times), because `EXPLAIN` may not accept bind parameters through pg8000. These values are always produced by the backend, never taken raw from the request.
7. **Transactions.** `pg8000.native` is in autocommit mode by default. For multi-statement atomicity use explicit `START TRANSACTION` / `COMMIT` / `ROLLBACK`. `refresh_continuous_aggregate` MUST run in autocommit (outside a transaction block).
8. **Timestamps** are always timezone-aware UTC in code and ISO 8601 with `Z`/offset in JSON.

## 9. Simulator

### 9.1 Configuration (request body of start)

```json
{
  "num_vehicles": 20,
  "interval_seconds": 5.0,
  "mode": "batch",
  "targets": ["pg", "ts"],
  "max_rows": 1000000
}
```

- `num_vehicles`: 1 to `SIM_MAX_VEHICLES`. Uses the first N rows of `vehicles` where `is_active`, ordered by `id`. If fewer than N exist, the start request MUST fail with a 422 explaining how many exist. The simulator never creates vehicles.
- `interval_seconds`: at least `SIM_MIN_INTERVAL_SECONDS`. Ignored in `burst`.
- `mode`:
  - `batch` (default): one multi-row `INSERT` per table per tick, then sleep until the next tick.
  - `per_row`: one `INSERT` per vehicle per table per tick (to demonstrate network round-trip cost).
  - `burst`: like `batch` but with no sleep between ticks (throughput test).
- `targets`: subset of `["pg","ts"]`, default both.
- `max_rows`: auto-stop when rows written **per table** reaches this value.

### 9.2 Movement model (per vehicle state: lat, lon, speed_kmh, heading_deg)

Constants: center `(-6.2000, 106.8000)`, max radius 15 km, initial positions uniformly random within 10 km, initial speed 20 to 60 km/h, initial heading random.

Each tick with `dt` seconds (`dt = interval_seconds`; in `burst` use a nominal `dt = 1`):

1. `heading += gauss(0, 10)` degrees, normalized to 0..360. `speed += gauss(0, 3)`, clamped to 0..80.
2. With probability 0.02 per tick a moving vehicle stops (speed 0) for a random 3 to 10 ticks, then resumes with speed 20 to 40.
3. `dist_km = speed_kmh * dt / 3600`
   `lat += dist_km * cos(rad(heading)) / 111.32`
   `lon += dist_km * sin(rad(heading)) / (111.32 * cos(rad(lat)))`
   (heading 0 = north, clockwise).
4. If the distance from the center exceeds 15 km, set heading to the bearing toward the center plus `uniform(-20, 20)` degrees.
5. `altitude_m` does a small random walk clamped to 5..25. `gps_accuracy_m = uniform(3, 15)`. `heading_deg` and `speed_kmh` stored are the values used for the movement (so data is internally consistent).
6. All rows of one tick share the timestamp `max(now_utc, last_ts + 1 microsecond)`.

Values are rounded to: latitude and longitude 6 decimals, speed/heading/altitude/accuracy 1 decimal.

### 9.3 Writing

- Statement: `INSERT INTO <table> (time, vehicle_id, latitude, longitude, speed_kmh, heading_deg, altitude_m, gps_accuracy_m) VALUES (...), (...) ON CONFLICT (vehicle_id, time) DO NOTHING`.
- Multi-row inserts are chunked to at most **500 rows per statement** (parameter limit).
- Each target table is written in its **own** transaction so latencies are independent.
- The write order alternates every tick (ts first, then pg first) to avoid ordering bias.
- Latency is measured with `time.perf_counter()` around the full write of that table for the tick (all statements of that tick).

### 9.4 Metrics

In-memory ring buffer of the last 1000 ticks. Each entry:

```json
{ "tick": 17, "time": "2026-10-06T08:00:05Z", "rows": 20,
  "latency_ms": { "pg": 12.4, "ts": 13.1 }, "errors": 0 }
```

Aggregates: total rows per table, rows/second (rolling over the last 30 seconds), p50 and p95 latency per table over the last 300 ticks and cumulative, error count, started_at, last_tick_at.

### 9.5 Resilience

- A DB error in a tick is logged and counted; the thread reconnects with exponential backoff (1, 2, 4, 8 seconds, max 30) and continues.
- After 10 consecutive failed ticks the simulation stops with state `failed` and a message.
- `stop` is cooperative and returns within one interval (use `threading.Event.wait(timeout)` instead of `sleep`).
- Application shutdown MUST stop the simulator cleanly.

### 9.6 Continuous aggregate refresh (while running)

A background task, using its own autocommit connection, runs every `CAGG_REFRESH_INTERVAL_SECONDS`:

```sql
CALL refresh_continuous_aggregate('telemetry_hourly', CAST(:start AS timestamptz), CAST(:end AS timestamptz))
```

with `start = now - 3 hours`, `end = now`. Treat a "refresh window too small" or "nothing to refresh" notice as non-fatal. The same refresh is exposed manually at `POST /api/admin/refresh-cagg`.

## 10. REST API

Base path `/api`. All responses are JSON. Errors use:

```json
{ "error": { "code": "validation_error", "message": "human readable" } }
```

HTTP statuses: 200, 202 (async job accepted), 400/422 (bad input), 403 (admin), 409 (conflict, for example simulation already running), 500, 503 (database unavailable).

### Health

- `GET /health` → `{ "db": "ok", "timescaledb_version": "2.x.y", "server_time": "..." }` (`SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'`).

### Simulation

- `POST /simulation/start` (body in 9.1) → 200 with the status object; 409 if already running.
- `POST /simulation/stop` → 200 with the status object (idempotent).
- `GET /simulation/status` →
  ```json
  { "state": "idle|running|stopping|failed",
    "config": { ... },
    "started_at": "...", "last_tick_at": "...",
    "totals": { "rows_pg": 0, "rows_ts": 0, "errors": 0 },
    "rows_per_second": 0.0,
    "latency_ms": {
      "pg": { "p50": 0, "p95": 0, "p50_cumulative": 0, "p95_cumulative": 0 },
      "ts": { "p50": 0, "p95": 0, "p50_cumulative": 0, "p95_cumulative": 0 } },
    "message": null }
  ```
- `GET /simulation/metrics?limit=300` → `{ "points": [ ...entries from 9.4... ] }`.

### Vehicles

- `GET /vehicles/latest` → latest position per active vehicle, from `telemetry_ts`, using the lateral query of Q1 (Section 11). Response: list of `{ vehicle_id, plate_number, name, time, latitude, longitude, speed_kmh, heading_deg }`. Cache 2 seconds server-side.
- `GET /vehicles/{id}/route?from=&to=&limit=2000` → points `{ time, latitude, longitude, speed_kmh }` ordered by time. Defaults: `to` = latest timestamp of that vehicle, `from` = `to` minus 1 hour. The time range MUST be bounded (maximum 24 hours) and `limit` capped at 5000. If more rows match, return the most recent `limit`.
- `GET /vehicles/{id}/hourly?hours=48` → rows from `telemetry_hourly` (`bucket`, `avg_speed`, `max_speed`, `point_count`) for the last `hours` (1..720).

### Benchmark

- `GET /benchmark/queries` → catalog from Section 11: `[{ id, title, description, variants: ["pg","ts","ts_cagg"], sql: { pg: "...", ts: "..." } }]`.
- `POST /benchmark/run` body `{ "query_ids": ["q1","q2"], "repetitions": 5, "warmup": 1, "vehicle_id": null }` → 200 with:
  ```json
  { "run_id": "...", "started_at": "...", "reference_time": "...",
    "simulation_running": false,
    "results": [
      { "query_id": "q2", "variant": "pg",
        "execution_ms": [9.9, 9.7, 9.8], "planning_ms": [0.16, 0.15, 0.15],
        "median_ms": 9.8, "min_ms": 9.7, "max_ms": 9.9,
        "rows_returned": 8062, "shared_hit_blocks": 7582, "shared_read_blocks": 0,
        "chunks_scanned": null, "error": null } ] }
  ```
  Rules: runs queries **sequentially** on a dedicated connection; only one benchmark at a time (409 otherwise); `repetitions` 1..20, `warmup` 0..3 (warmup runs are discarded); sets `statement_timeout` to `BENCH_STATEMENT_TIMEOUT_SECONDS * 1000`; a timeout produces a result with `error` set, not a failed request; if a simulation is running in `burst` mode reject with 409, otherwise run and set `simulation_running: true`. `reference_time` is `SELECT max(time) FROM telemetry_ts` read once at the start; every query window is defined relative to it so both tables read **identical** rows.
- `GET /benchmark/explain?query_id=q2&table=pg|ts` → `{ "plan_text": "...", "plan_json": {...}, "chunks_scanned": 2, "chunks_total": 116 }`. Uses `EXPLAIN (ANALYZE, BUFFERS)` for text and `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for JSON. `chunks_scanned` = number of distinct relation names matching `^_hyper_\d+_\d+_chunk$` in the plan tree. `chunks_total` from `timescaledb_information.chunks`.
- `GET /benchmark/history` → last 20 runs (kept in memory). The frontend offers CSV/JSON export.

### Storage

- `GET /storage/sizes` (cache 30 s) →
  ```json
  { "pg": { "total_bytes": 0, "table_bytes": 0, "index_bytes": 0, "approx_rows": 0 },
    "ts": { "total_bytes": 0, "table_bytes": 0, "index_bytes": 0, "toast_bytes": 0, "approx_rows": 0,
            "chunks_total": 0, "chunks_compressed": 0,
            "before_compression_bytes": null, "after_compression_bytes": null } }
  ```
  Sources: `pg_total_relation_size`, `pg_relation_size`, `pg_indexes_size`, `hypertable_size`, `hypertable_detailed_size`, `hypertable_compression_stats('telemetry_ts')`, `approximate_row_count(...)`. Never `count(*)`.
- `GET /storage/chunks?limit=200` →
  ```sql
  SELECT c.chunk_name, c.range_start, c.range_end, c.is_compressed, d.total_bytes
  FROM timescaledb_information.chunks c
  LEFT JOIN chunks_detailed_size('telemetry_ts') d ON d.chunk_name = c.chunk_name
  WHERE c.hypertable_name = 'telemetry_ts'
  ORDER BY c.range_start DESC
  LIMIT :limit
  ```
  Verify column names against the installed TimescaleDB version (see Section 0).

### Admin (header `X-Admin-Token: <ADMIN_TOKEN>` required)

- `POST /admin/compress-chunk` `{ "chunk_name": "_hyper_3_118_chunk" }` → 202 `{ "job_id": "..." }`. Runs `SELECT compress_chunk('_timescaledb_internal.<name>', if_not_compressed => true)`.
- `POST /admin/decompress-chunk` same body, using `decompress_chunk(..., if_compressed => true)`.
- `POST /admin/compress-older-than` `{ "days": 7 }` → 202, compresses all uncompressed chunks whose `range_end` is older than `now - days`.
- `POST /admin/refresh-cagg` → 200.
- `GET /admin/jobs/{job_id}` → `{ "state": "running|done|failed", "message": "...", "started_at": "...", "finished_at": "..." }`. Jobs run in a background thread on a dedicated connection, kept in memory.
- Destructive operations beyond compress/decompress (DELETE, drop_chunks, TRUNCATE) are out of scope.

## 11. Benchmark query catalog

Parameters: `ref` = reference time, `vehicle_id` (default: smallest active id), `days` = 7. Variants: `pg` runs on `telemetry_pg`, `ts` on `telemetry_ts`, `ts_cagg` on `telemetry_hourly`. Values are inlined (Section 8, rule 6).

**q1 — Latest position per vehicle** (`pg`, `ts`)
```sql
SELECT v.id AS vehicle_id, l.time, l.latitude, l.longitude, l.speed_kmh
FROM vehicles v
CROSS JOIN LATERAL (
    SELECT time, latitude, longitude, speed_kmh
    FROM {table} t
    WHERE t.vehicle_id = v.id
    ORDER BY t.time DESC
    LIMIT 1
) l
WHERE v.is_active
```

**q2 — One vehicle route, fixed 1-day window** (`pg`, `ts`)
```sql
SELECT time, latitude, longitude
FROM {table}
WHERE vehicle_id = {vehicle_id} AND time >= {ref - 1 day} AND time < {ref}
ORDER BY time
```

**q3 — Fleet daily average speed over `days`** (`pg`, `ts`)
```sql
-- pg
SELECT date_trunc('day', time) AS bucket, avg(speed_kmh) AS avg_speed
FROM telemetry_pg WHERE time >= {ref - days} AND time < {ref} GROUP BY 1 ORDER BY 1
-- ts
SELECT time_bucket('1 day', time) AS bucket, avg(speed_kmh) AS avg_speed
FROM telemetry_ts WHERE time >= {ref - days} AND time < {ref} GROUP BY 1 ORDER BY 1
```

**q4 — Fleet hourly average speed over `days`** (`pg`, `ts`, `ts_cagg`)
```sql
-- pg:  date_trunc('hour', time)   on telemetry_pg
-- ts:  time_bucket('1 hour', time) on telemetry_ts
-- ts_cagg (weighted average, point_count as weight):
SELECT bucket AS bucket,
       sum(avg_speed * point_count) / sum(point_count) AS avg_speed
FROM telemetry_hourly
WHERE bucket >= {ref - days} AND bucket < {ref}
GROUP BY bucket ORDER BY bucket
```
Before benchmarking `ts_cagg`, the runner MUST verify that `telemetry_hourly` has data covering the window (`SELECT min(bucket), max(bucket)`); if not, return that variant with `error: "continuous aggregate not refreshed for this window"` instead of misleading timings.

Each result records median, min, max, rows returned, and shared buffer hits/reads from the top plan node, parsed from `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` (`"Execution Time"`, `"Planning Time"`). The JSON may arrive as a string or an already-parsed object; handle both.

## 12. Frontend

Routes: `/simulation`, `/vehicles`, `/benchmark`, `/storage`, `/learn`. A top navigation bar links them. Clean, responsive layout, light and dark theme following the system. Every data view MUST have loading, error (with retry), and empty states. Types in `api.ts` mirror Section 10.

**Simulation page** (poll `status` and `metrics` every 2 s while `running`, every 10 s otherwise)
- Controls: vehicles (number), interval (seconds), mode (batch/per_row/burst), targets, max rows, Start/Stop buttons. Disable Start while running.
- Stat cards: state, total rows (pg and ts), rows per second, p50 and p95 latency for pg and ts, error count.
- Line chart: latency per tick, pg vs ts (two series, shared axis, ms).
- Live map (react-leaflet): markers from `/vehicles/latest` (poll 3 s while running), arrow rotated by heading, popup with plate, speed, time. Show at most 300 markers.

**Vehicles page**
- Vehicle selector, route map (polyline from `/route`, last hour by default with a time range picker limited to 24 h), speed line chart, and hourly chart from `/hourly`.

**Benchmark page** (no auto-refresh; runs only on button press)
- Query checklist from `/benchmark/queries`, repetitions, warmup, Run button with progress state.
- Grouped bar chart of median time per query and variant, with min/max shown as error bars or in a tooltip. Results table with rows returned and buffer hits/reads.
- Notice when `simulation_running` is true (results may be affected) and when a variant returned an error.
- "Show EXPLAIN" per query and table: two columns (pg and ts) with the plan text in monospace and a badge "Chunks scanned: X of Y" for ts.
- History list and export to CSV/JSON.

**Storage page** (manual Refresh button plus 30 s polling)
- Grouped/stacked bar: PostgreSQL total vs hypertable total (table and index parts), plus before/after compression when available. Show compression ratio (`before / after`) only when both values exist.
- Chunk table from `/storage/chunks`: name, range, size, compressed badge. Admin actions (compress/decompress a chunk, compress older than N days, refresh cagg) are shown only if the user enters the admin token in a settings field (kept in memory, not in localStorage); job status is polled until `done` or `failed`.

**Learn page**
- Static explanatory content (hypertable, chunks, chunk exclusion, compression with segmentby/orderby, continuous aggregates vs materialized views) written in clear English, each section linked to live data from the app (for example the chunk count and the "chunks scanned" example from q2).

## 13. Non-functional requirements

- **Performance guards.** Never `count(*)` on telemetry tables. Every telemetry read MUST have an explicit time bound or `LIMIT`. Heavy queries run only on explicit user action. Dashboard polling uses cheap queries only (`approximate_row_count`, the lateral latest-position query, `telemetry_hourly`).
- **Security.** No secrets in the repo or logs. No endpoint accepts raw SQL. Admin endpoints require the token, compared with `secrets.compare_digest`. CORS limited to configured origins. Use `READONLY_CONNECTION_STRING` for read endpoints when provided.
- **Logging.** Standard `logging`, one line per simulator tick at DEBUG, errors at ERROR. Never log the connection string.
- **Cost control.** The simulator writes to two tables and storage grows; `max_rows` auto-stop MUST be enforced.
- **Code quality.** Type hints throughout, Pydantic models for every request and response, no business logic inside routers (put it in service modules), small functions, docstrings on public functions.
- **Tests.** Unit tests (no database needed) for: movement model bounds and consistency, batch chunking (500 rows), percentile calculation, chunk-name validation, plan parsing (`chunks_scanned`, buffer sums) using saved sample JSON. Integration tests against a real database are optional and gated behind an environment variable.

## 14. Implementation phases and acceptance criteria

Implement strictly in order. Each phase must run end to end before the next starts.

**Phase 0 — Scaffolding.** Backend and frontend skeletons, config, `db.py` with connection factory and pool, error handling, `GET /api/health`, CORS, README with run instructions (`uvicorn app.main:app --reload`, `npm run dev`).
*Accepted when:* `/api/health` returns the TimescaleDB version; stopping the database connection yields a 503 with the error format; frontend shows the health status.

**Phase 1 — Simulator and ingest (backend).** `simulator.py`, movement model, dual-write, metrics, resilience, simulation endpoints.
*Accepted when:* starting 20 vehicles at 5 s for 60 seconds adds the same number of rows (about 240) to both tables; `status` shows non-zero p50 and p95 for both tables; `stop` ends the thread within one interval; restarting is possible; invalid inputs return 422; a forced DB error is counted and recovered from; unit tests for the movement model pass.

**Phase 2 — Frontend shell and Simulation page.** Routing, API client, controls, stat cards, latency chart.
*Accepted when:* starting and stopping from the UI works, cards and chart update live, and the page behaves correctly when the backend is down.

**Phase 3 — Vehicles, map, route, hourly, cagg refresh.** `vehicles` endpoints, Leaflet live map, Vehicles page, background cagg refresh while running.
*Accepted when:* markers move while a simulation runs; the route shows a continuous path; the hourly chart contains buckets from the last hours after one refresh cycle.

**Phase 4 — Benchmark.** Catalog, runner, EXPLAIN endpoint, Benchmark page, history and export.
*Accepted when:* q1 to q4 run on both tables with identical row counts per variant pair; `ts_cagg` reports a clear error when not refreshed; a query exceeding the timeout is reported without crashing; the `chunks_scanned` badge matches the plan.

**Phase 5 — Storage, chunks, admin, Learn page.** Sizes, chunk table, compress/decompress jobs, Learn content.
*Accepted when:* sizes load without scanning tables; compressing a chunk updates its badge after the job completes; admin endpoints return 403 without a valid token.

**Phase 6 — Polish and docs.** Error and empty states audit, README (setup, architecture, deviations), tests green, remove dead code.

## 15. Pitfalls checklist (read before coding)

1. Use `pg8000.native`, never psycopg or other DLL-based drivers (Windows blocks them).
2. In `pg8000.native`, `:` introduces a parameter. Use `CAST(x AS type)` instead of `::`. Keep `:` out of SQL text.
3. `pg8000.native.Connection` is not thread-safe. One connection per thread at a time.
4. Continuous aggregates cannot be refreshed or created inside a transaction block. Stay in autocommit for those calls.
5. The primary key `(vehicle_id, time)` rejects duplicates: always `ON CONFLICT DO NOTHING` for inserts.
6. Multi-row inserts must stay under the parameter limit: at most 500 rows per statement.
7. `compress_chunk` can take a long time. Run it as a background job and report status; never block a request on it.
8. Chunk names differ per service. Validate and build them dynamically, and treat `timescaledb_information` column names as version-dependent.
9. `telemetry_hourly` is empty until refreshed. Benchmark and charts must handle that explicitly.
10. Compare like with like: fixed time windows relative to one `reference_time`, identical rows on both tables, sequential runs, warmup discarded, report median plus min and max.
11. Do not claim TimescaleDB is faster for every query. Selective single-vehicle lookups are expected to perform about the same on both. The UI copy and Learn page MUST stay factual and based on measured numbers.
12. Never log or expose the connection string or admin token.

## 16. Assumptions and open items

- The Tiger Cloud service supports the TimescaleDB features used here (compression, continuous aggregates, `approximate_row_count`). Verify with `/api/health` and the first benchmark run.
- The `vehicles` table already contains at least as many active vehicles as the simulator is asked to use (the seed script creates 100 by default).
- Seeded data ends at the time the seed ran, so the first simulator rows are newer than all seeded rows.
- A read-only database role is optional; if unavailable, the main role is used for reads.
- Open for later: retention demo (`DELETE` vs `drop_chunks`), insert strategy comparison (`INSERT` vs `COPY`), Docker setup, deployment.

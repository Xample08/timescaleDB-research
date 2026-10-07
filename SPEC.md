# SPEC.md — TimescaleDB vs PostgreSQL: Simulator + Dashboard (v2)

Spec version 2.0 · 2026-10-07 · Audience: AI coding agents and the developer.
This version replaces v1 completely. Nothing from v1 (FastAPI, React phases, maps, admin jobs) applies anymore.

## 0. Rules for the AI agent (read first, obey strictly)

1. This file is the single source of truth. Implement **exactly** what is written and **nothing more**.
2. Do **not** add features, pages, routes, files, folders, abstractions, or dependencies that are not listed here. If you think something is missing, write it under `README.md` → "Suggestions" and do **not** build it.
3. If a requirement is ambiguous, implement the **minimal** interpretation, record it under `README.md` → "Assumptions", and continue. Do not stop to ask unless a step cannot proceed at all.
4. If this spec conflicts with reality (for example a TimescaleDB view column has a different name on the installed version), follow reality and record it under `README.md` → "Deviations".
5. Do not refactor, rename, or restyle anything outside the current step.
6. Do not modify `db/schema.sql` or `db/migrate.py`.
7. Work **one step at a time** (Section 9). Do not start a later step.
8. Finish every step with the report format in Section 10.
9. Keywords: **MUST** = required, **SHOULD** = strongly preferred, **MAY** = optional.
10. All UI text, code comments, and documentation are in **English**.

## 1. Goal and scope

Two **independent** web projects in one repository. They communicate only through the database.

- **Simulator**: a fleet of virtual vehicles that writes tracking data to both `telemetry_pg` (plain PostgreSQL table) and `telemetry_ts` (TimescaleDB hypertable) while a browser tab is open, and measures write latency.
- **Dashboard**: read-only. Shows the state of both tables, runs a catalog of benchmark queries on both tables (also while the simulator is writing), compares runs, and shows storage and chunk information.

Purpose: a research report comparing TimescaleDB with vanilla PostgreSQL for vehicle tracking data. All UI copy MUST be factual and neutral. Never claim one database is faster in general. Show measured numbers only.

### Out of scope (DO NOT BUILD)

Maps or Leaflet · vehicle detail or route pages · Learn or explainer pages · admin actions in the app (compress, decompress, drop chunks, refresh aggregates) · job systems · authentication other than `SIM_PASSWORD` · user accounts · i18n · theme toggle · server-side caches · WebSockets or SSE · cron jobs · ORMs · state-management libraries · CSS-in-JS · Docker · CI · deployment config files · analytics · extra pages or routes · tests other than the two test files listed in Section 2.

## 2. Repository layout (exact)

```
tsdb-demo/
├── README.md
├── SPEC.md
├── db/
│   ├── schema.sql              (existing, do not modify)
│   ├── migrate.py              (existing, do not modify)
│   └── experiments.sql         (content given in Appendix A)
├── simulator/                  → Vercel project #1 (Root Directory = simulator)
│   ├── package.json
│   ├── .env.example
│   ├── lib/
│   │   ├── db.ts               pg Pool singleton
│   │   ├── sim.ts              types, constants, presets, movement model, row building, percentile (pure, no pg import)
│   │   ├── sim.test.ts         vitest
│   │   └── format.ts           number/byte/ms formatters
│   ├── components/
│   │   ├── ui.tsx              shared UI primitives (Section 7)
│   │   ├── ControlPanel.tsx    form: presets, config, password, Start/Stop
│   │   └── MetricsPanel.tsx    stat cards + latency chart
│   └── app/
│       ├── layout.tsx
│       ├── globals.css
│       ├── page.tsx            owns state and the tick loop
│       └── api/tick/route.ts   GET = init, POST = one tick
└── dashboard/                  → Vercel project #2 (Root Directory = dashboard)
    ├── package.json
    ├── .env.example
    ├── lib/
    │   ├── db.ts               pg Pool singleton + read-only query helpers
    │   ├── bench.ts            catalog B1–B9, SQL builders, plan parsing, window math, validity (pure, no pg import)
    │   ├── bench.test.ts       vitest
    │   └── format.ts           identical copy of simulator/lib/format.ts
    ├── components/
    │   ├── ui.tsx              identical copy of simulator/components/ui.tsx
    │   ├── StatusStrip.tsx
    │   ├── BenchmarkTab.tsx
    │   ├── ProbeTab.tsx
    │   └── StorageTab.tsx
    └── app/
        ├── layout.tsx
        ├── globals.css
        ├── page.tsx            header + StatusStrip + tabs
        └── api/
            ├── status/route.ts
            ├── benchmark/route.ts
            ├── explain/route.ts
            └── storage/route.ts
```

Rules:
- Files created by `create-next-app` scaffolding (`next.config.*`, `tsconfig.json`, `postcss.config.*`, `eslint` config, `.gitignore`, `next-env.d.ts`, `public/`) are allowed and not counted. Remove unused scaffold demo content (default page content, default images, default fonts CSS).
- **No other files or folders.** Specifically no `services/`, `hooks/`, `utils/`, `store/`, `types/`, `context/` folders.
- `components/ui.tsx` and `lib/format.ts` MUST be byte-identical in both projects. If you change one, change both.

## 3. Stack, dependencies, environment

| Item | Choice |
|---|---|
| Framework | Next.js (latest stable), App Router, TypeScript with `strict: true` |
| Runtime | Node.js 20 or newer |
| Styling | Tailwind CSS as set up by `create-next-app` |
| Database driver | `pg` (node-postgres), pure JavaScript |
| Charts | `recharts` |
| Tests | `vitest` (dev dependency, only the two test files) |

**No other dependencies.** No zod, no axios, no swr, no react-query, no UI kit, no icon library, no date library (use native `Date`/`Intl`).

`package.json` scripts (both projects): `dev`, `build`, `start`, `lint`, `typecheck` (`tsc --noEmit`), `test` (`vitest run`).

Every route file MUST export: `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `maxDuration = 60`.

Environment variables (server-side only, never `NEXT_PUBLIC_`):

| Project | Variable | Required | Meaning |
|---|---|---|---|
| simulator | `DATABASE_URL` | yes | Tiger Cloud connection string. Role needs INSERT on `telemetry_pg` and `telemetry_ts`, SELECT on `vehicles` and `telemetry_ts`. |
| simulator | `SIM_PASSWORD` | yes | Password required by every simulator API call. |
| both | `DB_SSL_VERIFY` | no | `true` = verify the server certificate. Default `false`. |
| dashboard | `DATABASE_URL` | yes | Connection string. A read-only role is recommended. The app never writes. |
| dashboard | `BENCH_TIMEOUT_MS` | no | Per-query timeout for benchmark and explain. Default `15000`. |

`.env.example` in each project lists the variables with placeholder values only.

## 4. Database reference and access rules

Existing schema (source of truth: `db/schema.sql`). Summary:

- `vehicles(id, plate_number, name, vehicle_type, is_active, created_at)`
- `telemetry_pg` and `telemetry_ts` with identical columns: `time timestamptz, vehicle_id int, latitude double precision, longitude double precision, speed_kmh real, heading_deg real, altitude_m real, gps_accuracy_m real`, primary key `(vehicle_id, time)`. `telemetry_ts` is a hypertable with 1-day chunks and compression enabled (no automatic policy).
- `telemetry_hourly`: continuous aggregate over `telemetry_ts` (`bucket, vehicle_id, avg_speed, max_speed, point_count`), refreshed manually (not real-time).
- Seeded data (up to ~100 million rows per table) ends at the time the seed ran. New simulator rows are newer than all seeded rows.

Access rules (MUST):

- **D1** `lib/db.ts` creates one `pg.Pool` at module level (reused across warm invocations): `max: 3`, `idleTimeoutMillis: 10000`, `connectionTimeoutMillis: 10000`. Never create a `Client` per request.
- **D2** SSL: remove the `sslmode` query parameter from the connection string and pass `ssl: { rejectUnauthorized: false }` (equivalent to libpq `sslmode=require`), or `ssl: true` when `DB_SSL_VERIFY=true`.
- **D3** On every new connection run `SET TIME ZONE 'UTC'` (pool `connect` event).
- **D4** Table names come only from constants in code, never from the request. Request fields select a table through a whitelist (`pg` → `telemetry_pg`, `ts` → `telemetry_ts`).
- **D5** Use bind parameters (`$1`, `$2`, …) for all values, **except** EXPLAIN statements, where validated values are inlined: integers via `Number.isInteger` checks, timestamps as `CAST('<date.toISOString()>' AS timestamptz)` built from a parsed `Date`. Never inline raw request strings.
- **D6** Dashboard queries run inside `BEGIN READ ONLY; SET LOCAL statement_timeout = <BENCH_TIMEOUT_MS>; <query>; COMMIT` on a single client taken from the pool. Always release the client in `finally`. A timeout (SQLSTATE `57014`) is returned as `error: "timeout"`, not as an HTTP error.
- **D7** Never run an unbounded `count(*)` on telemetry tables. Every telemetry read has an explicit time bound or `LIMIT`. (The ingest-rate count in Section 6.2 is bounded to 30 seconds.)
- **D8** Never log or return the connection string, the password, or raw error stacks. Return error messages trimmed to 200 characters.

## 5. Simulator

### 5.1 Features

| ID | Feature |
|---|---|
| S1 | Start and Stop. Start is disabled while running. Stop takes effect within one interval. |
| S2 | Fleet config: number of vehicles and send interval (seconds). |
| S3 | Write mode: `batch`, `per_row`, `burst`. |
| S4 | Targets: write to pg, ts, or both (at least one). |
| S5 | Presets: one click fills the form (Section 5.2). |
| S6 | Auto-stop at N rows per table or M minutes. |
| S7 | Realistic movement (Section 5.4). |
| S8 | Resume from each vehicle's last stored position when starting. |
| S9 | Live metrics and a latency chart (Section 5.7). |
| S10 | Error handling with backoff, auto-stop after repeated failures. |
| S11 | Password protection on every API call. |
| S12 | "Dirty data" toggle (default off): late and duplicate rows. |

### 5.2 Limits and presets

| Field | Default | Allowed |
|---|---|---|
| Vehicles | 20 | 1 to 1000, and not more than the number of active vehicles in `vehicles` |
| Interval (s) | 5 | 1 to 60 (ignored in `burst`) |
| Mode | batch | batch, per_row, burst |
| Targets | pg and ts | non-empty subset |
| Max rows per table | 500000 | 1000 to 5000000 |
| Max minutes | 30 | 1 to 720 |
| Dirty data | off | on or off |

`per_row` mode allows **at most 50 vehicles** (UI blocks it, API returns 422).

Presets (mode, vehicles, interval): **Light** batch/20/5 s · **Medium** batch/100/2 s · **Heavy** batch/500/1 s · **Burst** burst/100/n.a. Presets change only these fields (plus mode), nothing else.

### 5.3 API contract (`app/api/tick/route.ts`)

Every call MUST send header `x-sim-password`. It is compared in constant time (`crypto.timingSafeEqual` on SHA-256 digests of both values). Wrong or missing → `401 { "error": "Invalid password" }`.

**`GET /api/tick?n=<int>` (init).** Returns the first `n` active vehicles (ordered by `id`) as initial states.

```json
{ "vehicles": [ { "id": 1, "lat": -6.2, "lon": 106.8, "speed": 32.5, "heading": 90, "alt": 12.3, "stop": 0 } ],
  "resumed": 18 }
```
- If fewer than `n` active vehicles exist → `422 { "error": "Only X active vehicles exist" }`.
- For each vehicle take the latest row from `telemetry_ts` (`CROSS JOIN LATERAL … ORDER BY time DESC LIMIT 1`). If it exists and lies within 15 km of the center, resume from its position, speed, heading, altitude (`stop = 0`). Otherwise create a random initial state (Section 5.4). `resumed` is the number of vehicles resumed from the database.

**`POST /api/tick` (one tick).**

Request:
```json
{ "vehicles": [ /* states as above */ ], "dt": 5, "mode": "batch",
  "targets": ["pg", "ts"], "dirty": false, "tickNo": 0, "lastTimestamp": null }
```
- `mode` is `batch` or `per_row` (the client maps `burst` to `batch`).
- Validation (any failure → `422`): `vehicles` length 1 to 1000; each field finite with `id` integer ≥ 1, `lat` −90..90, `lon` −180..180, `speed` 0..200, `heading` 0..360, `alt` −500..9000, `stop` integer 0..100; `dt` 0.5..60; `targets` non-empty subset of `["pg","ts"]`; `tickNo` integer ≥ 0; `lastTimestamp` null or valid ISO string; `per_row` with more than 50 vehicles is invalid.

Response (HTTP 200 even if one table failed):
```json
{ "vehicles": [ /* next states */ ], "timestamp": "2026-10-07T08:00:05.123Z",
  "attempted": 20, "inserted": { "pg": 20, "ts": 20 },
  "latencyMs": { "pg": 12.4, "ts": 13.1 },
  "late": 0, "duplicates": 0,
  "errors": { "pg": null, "ts": null } }
```
Only requested targets appear in `inserted`, `latencyMs`, `errors`.

### 5.4 Movement model (`lib/sim.ts`, pure, takes `rng: () => number` for testability)

Constants: center `(-6.2000, 106.8000)`; max radius 15 km; initial position uniformly random within 10 km; initial speed 20 to 60 km/h; initial heading random; `stop = 0`.

Each tick, per vehicle, with `dt` seconds:
1. If `stop > 0`: `speed = 0`, `stop -= 1`, and when it reaches 0 set `speed` to a random 20 to 40.
   Else: `heading += gauss(0, 10)` degrees (normalize to 0..360), `speed += gauss(0, 3)` clamped to 0..80; with probability 0.02 set `stop` to a random integer 3 to 10 and `speed = 0`.
2. `dist_km = speed * dt / 3600`
   `lat += dist_km * cos(rad(heading)) / 111.32`
   `lon += dist_km * sin(rad(heading)) / (111.32 * cos(rad(lat)))` (heading 0 = north, clockwise).
3. If the distance from the center exceeds 15 km, set `heading` to the bearing toward the center plus `uniform(-20, 20)`.
4. `alt` does a random walk of ±0.5 per tick, clamped to 5..25. `gps_accuracy_m = uniform(3, 15)` per row.
5. The stored `speed_kmh` and `heading_deg` are the values used for the movement (data is internally consistent).

Rounding for stored rows: latitude and longitude 6 decimals; speed, heading, altitude, accuracy 1 decimal.

### 5.5 Write rules (`app/api/tick/route.ts`)

- Tick timestamp: `max(Date.now(), lastTimestamp + 1 ms)`. All rows of one tick share it.
- **Dirty data** (S12, only if `dirty` is true): per row, with probability 0.02 it is a **late** row (time = tick timestamp minus `uniform(60 s, 24 h)`), and independently with probability 0.01 an exact **duplicate** of the row (same `vehicle_id` and `time`) is appended. `late` and `duplicates` in the response count them.
- Statement (table name from a constant, see D4):
  `INSERT INTO <table> (time, vehicle_id, latitude, longitude, speed_kmh, heading_deg, altitude_m, gps_accuracy_m) VALUES (...), (...) ON CONFLICT (vehicle_id, time) DO NOTHING`
- `batch`: rows are inserted in statements of at most 500 rows. `per_row`: one statement per row.
- Take **one** client from the pool for the whole tick and release it in `finally`.
- Each target table is written by its own statement(s) (separate implicit transactions) so latencies are independent.
- Order alternates: even `tickNo` writes `ts` first, odd `tickNo` writes `pg` first.
- `latencyMs[table]` = sum of `performance.now()` deltas around each `client.query` for that table (excluding connection acquisition).
- `inserted[table]` = sum of `rowCount` of its statements (conflicts are not counted). `attempted` = number of rows sent per table (including duplicates).
- If one table fails, still write the other, and return the failed table's message in `errors`.

### 5.6 Client loop (in `app/page.tsx`)

- State machine: `idle → starting → running → stopping → idle`, or `failed`.
- On Start: `GET /api/tick?n=…`, then loop. The loop is **fixed-rate with no overlap**: tick k is scheduled at `startTime + k * interval`; the next tick starts after the previous response and no earlier than its schedule. In `burst` mode the next tick starts immediately after the previous response and movement uses a nominal `dt = 1`.
- A tick is **late** if it starts more than 0.5 × interval after its schedule (not counted in burst). Count them.
- The client keeps vehicle states and `lastTimestamp` in memory and sends them with every tick.
- Failure handling: network error or HTTP 5xx → retry with backoff 1, 2, 4, 8, 16 s (max 30 s) and count an error. After **10 consecutive failures** state becomes `failed` with a message. HTTP 401 or 422 → stop immediately and show the message. A tick whose response contains a per-table error counts as an error but does not stop the loop; 10 consecutive such ticks also set `failed`.
- Auto-stop when `inserted` (max over targets) reaches Max rows, or elapsed reaches Max minutes. Show "Limit reached".
- The password lives only in React state (never `localStorage`, `sessionStorage`, cookies, or the URL).
- While running, SHOULD request a screen wake lock (`navigator.wakeLock`) and ignore failures. MUST show a banner: "Simulation runs only while this tab stays open and visible."
- A page reload resets everything to `idle`. No persistence.

### 5.7 Metrics

Keep the last 600 ticks in memory (ring buffer). Per tick: `{ tickNo, time, attempted, inserted, latencyMs, late, duplicates, errors }`.

Displayed (all labeled with units):
- State, elapsed time, ticks, late ticks, error count.
- Rows inserted: pg and ts (cumulative).
- Rows per second: pg and ts, computed over the last 30 seconds of ticks.
- Latency p50 and p95 (ms) for pg and ts over the **last 300 ticks**, using the nearest-rank method (`index = ceil(p/100 × n) − 1` on the sorted list).
- If dirty data is on: late rows, duplicate rows, and "skipped by conflict" (`attempted − inserted`).

Chart: line chart of latency per tick for pg and ts (last 300 ticks), x = tick number, y = ms.

### 5.8 Simulator UI

Layout per Section 7. Header with title "Simulator". Main area: two-column workspace — `ControlPanel` on the left (fixed 22 rem) and `MetricsPanel` filling the rest.
- `ControlPanel`: preset buttons, Vehicles, Interval, Mode (segmented control), Targets (two checkboxes), Max rows, Max minutes, Dirty data toggle, Password (`type="password"`), Start and Stop buttons, validation messages under each field.
- `MetricsPanel`: banner, status text/error message, stat-card grid, latency chart.

## 6. Dashboard

### 6.1 Features

| ID | Feature |
|---|---|
| D1 | Status strip, always visible at the top. |
| D2 | Benchmark runner: catalog B1–B9, sets Quick and Full, repetitions, warmup, vehicle selector. |
| D3 | Results as grouped bar chart and table. |
| D4 | Validity checks (row-count mismatch, stale aggregate). |
| D5 | EXPLAIN view, pg vs ts side by side. |
| D6 | Load label on every run (ingest rate before and after, chunk counts). |
| D7 | Run history in the browser and comparison of two runs. |
| D8 | Export of results as CSV and JSON. |
| D9 | Live Probe tab. |
| D10 | Storage tab: sizes, compression ratio, chunk table. |
| D11 | Loading, error, and empty states everywhere. |
| D12 | Read-only safety (Section 4: D4–D8). |

### 6.2 API contract

**`GET /api/status`** (polled by the client every 5 seconds while the tab is visible).
```json
{ "serverTime": "ISO", "timescaleVersion": "2.x.y",
  "approxRows": { "pg": 0, "ts": 0 },
  "chunks": { "total": 0, "compressed": 0 },
  "ingest": { "windowSeconds": 30, "pgRowsPerSecond": 0, "tsRowsPerSecond": 0 },
  "latest": { "pg": "ISO|null", "ts": "ISO|null", "ageSeconds": 0 },
  "safeReferenceTime": "ISO",
  "vehicles": [ { "id": 1, "name": "Vehicle 1" } ] }
```
Sources: `pg_extension.extversion`; `approximate_row_count('telemetry_pg' / 'telemetry_ts')`; `timescaledb_information.chunks` (`count(*)` and `count(*) FILTER (WHERE is_compressed)` for hypertable `telemetry_ts`); ingest rate = `count(*)` of rows with `time >= now() - interval '30 seconds'` in each table, divided by 30; `latest` = `max(time)` per table; `ageSeconds` from the newer one; `safeReferenceTime = min(latest.pg, latest.ts) − 5 seconds`; `vehicles` = active vehicles ordered by id, limit 200.

**`POST /api/benchmark`**
```json
{ "queryId": "B3", "variants": ["pg", "ts"], "refTime": "ISO", "vehicleId": 1 }
```
- `queryId` ∈ catalog; `variants` must be a non-empty subset of that query's variants and are executed **in the given order**; `refTime` optional (if absent the server computes `safeReferenceTime` itself); `vehicleId` optional integer (default: smallest active id). Validation failures → `422`.
- Response:
```json
{ "queryId": "B3", "refTime": "ISO", "note": null,
  "results": [ { "variant": "pg", "executionMs": 9.9, "planningMs": 0.16, "rowsReturned": 8062,
                 "sharedHit": 7582, "sharedRead": 0, "chunksScanned": null, "error": null } ] }
```
- Each variant runs `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <sql>` under rule D6. Parse the plan JSON (it may arrive as a string or an already-parsed object; handle both): `Execution Time`, `Planning Time`, top node `Actual Rows` (rows returned), top node `Shared Hit Blocks` and `Shared Read Blocks`. `chunksScanned` (variant `ts` only) = number of distinct relation names matching `^_hyper_\d+_\d+_chunk$` anywhere in the plan tree; `null` otherwise.

**`GET /api/explain?queryId=B3&vehicleId=1&refTime=ISO`**
```json
{ "chunksTotal": 116,
  "variants": { "pg": { "text": "…", "chunksScanned": null },
                "ts": { "text": "…", "chunksScanned": 2 } } }
```
Runs `EXPLAIN (ANALYZE, BUFFERS)` (text format) for each variant of the query under rule D6. `chunksScanned` for `ts` = distinct matches of `_hyper_\d+_\d+_chunk` in the text.

**`GET /api/storage`**
```json
{ "pg": { "totalBytes": 0, "tableBytes": 0, "indexBytes": 0 },
  "ts": { "totalBytes": 0, "tableBytes": 0, "indexBytes": 0, "toastBytes": 0,
          "beforeCompressionBytes": null, "afterCompressionBytes": null, "compressionRatio": null },
  "chunks": [ { "name": "_hyper_3_118_chunk", "rangeStart": "ISO", "rangeEnd": "ISO",
                "isCompressed": false, "totalBytes": 0 } ] }
```
Sources: `pg_total_relation_size`, `pg_relation_size`, `pg_indexes_size` for `telemetry_pg`; `hypertable_detailed_size('telemetry_ts')`; `hypertable_compression_stats('telemetry_ts')` (values are NULL when nothing is compressed: return `null`, never 0); chunks from `timescaledb_information.chunks` joined with `chunks_detailed_size('telemetry_ts')`, newest first, `LIMIT 100`. `compressionRatio = before / after` only when both are greater than 0, else `null`. Column names are version dependent: verify them against the installed version and record any difference under Deviations.

### 6.3 Benchmark catalog (`lib/bench.ts`)

Notation: `{T}` = table for the variant. `{ref}` = reference time. `{vid}` = vehicle id. `bucket_day` is `date_trunc('day', time)` for `pg` and `time_bucket('1 day', time)` for `ts`; `bucket_hour` likewise with `'hour'` and `'1 hour'`. All windows are `time >= <start> AND time < <end>`.

| ID | Title | Variants | Window |
|---|---|---|---|
| B1 | Latest position per vehicle | pg, ts | none (LATERAL with LIMIT 1) |
| B2 | One vehicle route, 1 hour | pg, ts | `[ref − 1 hour, ref)` |
| B3 | One vehicle route, 1 day | pg, ts | `[ref − 1 day, ref)` |
| B4 | One vehicle route, 7 days | pg, ts | `[ref − 7 days, ref)` |
| B5 | Fleet activity, last 15 minutes | pg, ts | `[ref − 15 min, ref)` |
| B6 | Fleet daily average speed, 7 days | pg, ts | `[ref − 7 days, ref)` |
| B7 | Fleet hourly average speed, 7 days | pg, ts, ts_cagg | see B7 below |
| B8 | Maximum speed per vehicle, 7 days | pg, ts | `[ref − 7 days, ref)` |
| B9 | Points inside a bounding box, 1 day | pg, ts | `[ref − 1 day, ref)` |

Quick set: B1, B3, B6, B7. Full set: B1–B9.

```sql
-- B1
SELECT v.id AS vehicle_id, l.time, l.latitude, l.longitude, l.speed_kmh
FROM vehicles v
CROSS JOIN LATERAL (
  SELECT t.time, t.latitude, t.longitude, t.speed_kmh
  FROM {T} t WHERE t.vehicle_id = v.id ORDER BY t.time DESC LIMIT 1
) l
WHERE v.is_active

-- B2, B3, B4 (window differs)
SELECT time, latitude, longitude FROM {T}
WHERE vehicle_id = {vid} AND time >= {start} AND time < {end}
ORDER BY time

-- B5
SELECT vehicle_id, count(*) AS points, max(time) AS last_seen, avg(speed_kmh) AS avg_speed
FROM {T} WHERE time >= {start} AND time < {end}
GROUP BY vehicle_id ORDER BY vehicle_id

-- B6
SELECT {bucket_day} AS bucket, avg(speed_kmh) AS avg_speed FROM {T}
WHERE time >= {start} AND time < {end} GROUP BY 1 ORDER BY 1

-- B7 (pg, ts)
SELECT {bucket_hour} AS bucket, avg(speed_kmh) AS avg_speed FROM {T}
WHERE time >= {start} AND time < {end} GROUP BY 1 ORDER BY 1
-- B7 (ts_cagg)
SELECT bucket, sum(avg_speed * point_count) / sum(point_count) AS avg_speed
FROM telemetry_hourly WHERE bucket >= {start} AND bucket < {end}
GROUP BY bucket ORDER BY bucket

-- B8
SELECT vehicle_id, max(speed_kmh) AS max_speed FROM {T}
WHERE time >= {start} AND time < {end} GROUP BY vehicle_id ORDER BY vehicle_id

-- B9 (fixed box: latitude -6.25..-6.15, longitude 106.75..106.85)
SELECT vehicle_id, count(*) AS points FROM {T}
WHERE time >= {start} AND time < {end}
  AND latitude BETWEEN -6.25 AND -6.15 AND longitude BETWEEN 106.75 AND 106.85
GROUP BY vehicle_id ORDER BY vehicle_id
```

**B7 window (all three variants use the same window).** `end = min(floor_to_hour(ref), (SELECT max(bucket) FROM telemetry_hourly))` (the last materialized bucket is excluded because it may be partial); `start = end − 7 days`. Before running B7 the server MUST check `SELECT min(bucket), max(bucket) FROM telemetry_hourly`: if the table is empty, or `min(bucket) > start`, or `end − start < 24 hours`, return for **every** variant `error: "continuous aggregate does not cover the window, refresh it (see db/experiments.sql)"` and no timings. When the window was clamped, set `note` to `"window end clamped to aggregate coverage: <ISO>"`.

### 6.4 Runner and validity (client side, `components/BenchmarkTab.tsx`)

- The client orchestrates. First call `/api/status` to get `safeReferenceTime`, the vehicles, and the "before" load context; use that `refTime` for every call of the run. After the run call `/api/status` again for the "after" context.
- For each repetition (warmup repetitions first, results discarded), for each selected query, call `POST /api/benchmark` with all variants of that query. **Alternate the variant order every repetition** (pg first, then ts first, …). Calls are sequential, never parallel. Show progress as `done / total` calls with a Cancel button.
- Aggregation per (query, variant): median, p95 (nearest-rank; with fewer than 20 repetitions p95 equals the max), min, max of `executionMs`; `rowsReturned`, `sharedHit`, `sharedRead`, `chunksScanned` from the last measured repetition. Errors: show the first error message and exclude the variant from the chart.
- **Validity (D4):** a query is flagged **"Row count mismatch"** when `rowsReturned` of its variants differ within the same repetition. Flagged queries stay in the table and export (`valid: false`) with a visible badge.
- Defaults: set Quick, repetitions 5, warmup 1. Allowed: repetitions 1 to 20, warmup 0 to 3.

### 6.5 Run history, compare, export (D6, D7, D8)

- A completed run is stored in `localStorage` under the key `tsdb-dashboard:runs:v1`, newest first, at most 30 runs (drop the oldest). Wrap all storage access in `try/catch` and keep working if storage is unavailable. Each run stores: `id`, `createdAt`, optional user `label`, set, repetitions, warmup, `refTime`, load context `{ before, after }` (ingest rates, chunk total and compressed, `timescaleVersion`), and the aggregated results.
- **Compare:** the user selects run A and run B. Show a table per (query, variant): median A, median B, difference in ms, and difference in percent. No color judgments (neutral styling). If a variant is missing in one run show "—".
- **Export:** buttons "Export CSV" and "Export JSON" for the current run (client-side download). CSV columns: `run_id, created_at, query_id, variant, median_ms, p95_ms, min_ms, max_ms, rows, shared_hit, shared_read, chunks_scanned, valid, ingest_pg_before, ingest_ts_before, chunks_total, chunks_compressed`.

### 6.6 Live Probe (`components/ProbeTab.tsx`, D9)

- Controls: query (B1, B2, or B5), vehicle (used by B2), interval (2, 3, 5, or 10 s), Start/Stop.
- While running, every interval call `POST /api/benchmark` with variants alternating order each call and **no `refTime`** (the server computes it, so both variants use the same window). Calls never overlap.
- Chart: line chart of the last 120 points, series pg and ts (ms, left axis) and the latest known ingest rows/s from `/api/status` polling as a dashed gray line (right axis).
- Cards: last pg ms, last ts ms, median of the window for each, current ingest rows/s.
- Probe runs only while the tab is open and the Probe tab is active. Stop automatically when the user switches tab.

### 6.7 Storage tab (`components/StorageTab.tsx`, D10)

- Cards: PostgreSQL total, hypertable total, compression ratio (or "—"), chunks compressed / total.
- Grouped bar chart: table bytes and index bytes for PostgreSQL and for the hypertable; when compression stats exist, add a bar for the hypertable after compression.
- Chunk table (newest 100): name, range start, range end, size, compressed badge.
- "Refresh" button plus automatic refresh every 30 seconds while the tab is active.

### 6.8 Dashboard UI

Layout per Section 7. Header with title "Dashboard". Below it, `StatusStrip`: six stat cards in one row (TimescaleDB version, rows pg, rows ts, chunks compressed/total, insert rate pg and ts, latest row age). Below, tabs: **Benchmark**, **Live Probe**, **Storage**.
- Benchmark tab: two-column workspace at `xl`: left controls card (fixed 22 rem: set selector, per-query checkboxes, vehicle, repetitions, warmup, Run/Cancel, progress), right content (chart, results table, EXPLAIN panel, compare card, history list, export buttons).
- Chart: grouped bar chart of median ms per query, bars per variant (pg, ts, and ts_cagg for B7), with a **log scale toggle (default on)**. Tooltip shows median, p95, min, max.
- Results table columns: Query, Variant, Median, p95, Min, Max, Rows, Shared hit, Shared read, Chunks scanned, "ts ÷ pg" (median ratio on ts rows, 2 decimals), Status badge.
- EXPLAIN: an "EXPLAIN" button per query opens a panel with pg and ts plan text side by side (monospace, scrollable) and a badge "Chunks scanned: X of Y" for ts.

## 7. UI conventions (both projects, MUST follow exactly)

### 7.1 Layout contract (fixes wasted side space)

- Page wrapper: `<main className="w-full px-4 py-4 sm:px-6 lg:px-8">`. The page, every section, card, grid, chart and table wrapper uses the **full available width**.
- **Forbidden** on page, section, card, grid, chart, and table wrappers: `max-w-*`, `container`, `mx-auto`. (`max-w-prose` is allowed only on explanatory text paragraphs inside a card.)
- Required grid recipes:
  - Stat row: `grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6`
  - Two-column workspace: `grid grid-cols-1 gap-4 xl:grid-cols-[22rem_minmax(0,1fr)]`
  - Side-by-side panels (for example pg vs ts EXPLAIN): `grid grid-cols-1 gap-4 lg:grid-cols-2`
- Every grid child that contains a chart or table has `min-w-0`.
- Charts: `ResponsiveContainer width="100%" height="100%"` inside a wrapper with a fixed height (`h-72` default, `h-80` for the main chart). Never set a fixed pixel width.
- Tables: wrapper `overflow-x-auto`, table `w-full`.
- Spacing: `gap-4` between cards, card padding `p-4`, `space-y-3` inside cards. No hero sections, no large decorative margins.
- **Measurable check:** at viewport widths 1280, 1920, and 2560 px the content spans from the left page padding to the right page padding (padding ≤ 32 px each side), there is no horizontal page scrollbar, and at 390 px everything stacks in one column.

### 7.2 Tokens

- Body: `min-h-screen bg-slate-50 text-sm text-slate-900 dark:bg-slate-950 dark:text-slate-100`. Dark mode uses Tailwind's default `dark:` variant (system preference). No theme toggle.
- Card: `rounded-lg border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900`.
- Type scale: page title `text-lg font-semibold`; card title `text-sm font-semibold`; label `text-xs text-slate-500 dark:text-slate-400`; stat value `text-2xl font-semibold tabular-nums`; table text `text-xs`, numeric columns right-aligned with `tabular-nums`.
- Inputs: height `h-9`, `rounded-md border px-2 text-sm`, full width of their container, visible focus ring.
- Buttons: height `h-9`; primary (blue-600), secondary (bordered), danger (red-600); disabled = `opacity-50 cursor-not-allowed`.
- Series colors (exported as `SERIES_COLORS` from `components/ui.tsx`, used for **every** chart): `pg: '#2563eb'`, `ts: '#f59e0b'`, `ts_cagg: '#10b981'`. Neutral/auxiliary lines: slate-400.

### 7.3 Shared components (`components/ui.tsx`, one file, named exports)

`AppHeader({ title, right? })`, `Card({ title?, right?, children })`, `StatCard({ label, value, unit?, hint? })`, `Badge({ tone: 'neutral' | 'warn' | 'error' | 'ok', children })`, `Button({ variant, ...buttonProps })`, `Field({ label, hint?, error?, children })`, `Tabs({ tabs, active, onChange })`, `Spinner`, `ErrorState({ message, onRetry? })`, `EmptyState({ title, hint? })`, `SERIES_COLORS`. Pages and feature components use these instead of re-implementing them. Do not add other shared components.

### 7.4 Formatting (`lib/format.ts`)

`formatMs(n)` → `"9.90 ms"`, and `"1.23 s"` when ≥ 1000 · `formatBytes(n)` → binary units (`KiB`, `MiB`, `GiB`) with 2 decimals · `formatInt(n)` → `en-US` thousands separators · `formatPercent(n)` → one decimal · `formatDuration(seconds)` → `"2m 05s"`. Null or undefined values render as `"—"`. Units are always shown.

### 7.5 Charts (Recharts)

Line width 2, `dot={false}`, `isAnimationActive={false}` for every series, margins `{ top: 8, right: 12, bottom: 0, left: 0 }`, axis font size 11, subtle grid (`strokeDasharray="3 3"`), legend at the top, tooltips with 2 decimals, axis titles carry units. A series always uses its `SERIES_COLORS` color.

### 7.6 States

- Loading: `Spinner` inside the card, keeping the card's minimum height so the layout does not jump.
- Error: `ErrorState` with the trimmed message and a Retry button where a retry makes sense.
- Empty: `EmptyState` with a one-line explanation.
- Every data view implements all three. Polling views keep showing the last good data and a small "Updated hh:mm:ss" or "Update failed" label when a refresh fails.
- Color is never the only signal: badges carry text.

### 7.7 Copy

English, sentence case, neutral and factual, no marketing language, no claims about superiority.

## 8. Security and performance rules

- No secrets in code, logs, client bundles, or committed files. `process.env` is read only in server files. `.env.local` is git-ignored; `.env.example` has placeholders only.
- Simulator API calls always require `SIM_PASSWORD`. The dashboard has no write path and runs all queries under D4–D8.
- Dashboard endpoints accept only whitelisted `queryId` and `variants`. No endpoint accepts SQL.
- Poll only cheap endpoints automatically (`/api/status`, `/api/storage` at their stated intervals). `/api/benchmark` and `/api/explain` run only on user action (Run, EXPLAIN) or in the Live Probe while it is active. Pause polling when `document.hidden`.
- Keep request bodies small: the simulator accepts at most 1000 vehicles per tick.

## 9. Steps and acceptance criteria

Implement strictly in order. Each step must run end to end before the next starts.

### Step 1 — Shared setup and Simulator

Scaffold both projects, but implement only the simulator in this step (the dashboard folder may contain the untouched scaffold only). Create `components/ui.tsx` and `lib/format.ts` in the simulator, then copy them to the dashboard unchanged at the end of Step 2. Implement S1–S12, `sim.test.ts`, and the README skeleton.

Tests (`lib/sim.test.ts`, seeded `rng`): movement stays within 15 km of the center and speed within 0..80 over 10,000 ticks; distance moved matches `speed × dt` within 1% for small `dt`; stop logic (speed 0 while `stop > 0`); dirty-data rates within tolerance over many rows; 500-row chunking helper; nearest-rank percentile.

Acceptance:
1. `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass in `simulator/`.
2. Preset Light for 60 seconds: `attempted` equals `inserted` for both tables on every tick, 11 to 13 ticks, latency values non-zero.
3. Database check after the run: this query returns the same set of `(time, count)` pairs on both tables:
   `SELECT time, count(*) FROM telemetry_ts WHERE time > now() - interval '3 minutes' GROUP BY time ORDER BY time` (and the same on `telemetry_pg`).
4. Wrong password: the UI shows "Invalid password" and no simulation starts. API returns 401.
5. Stop ends the loop within one interval. Starting again resumes near the last positions (`resumed` equals the number of vehicles).
6. `per_row` with more than 50 vehicles is blocked in the UI and returns 422 from the API.
7. Dirty data on (100 vehicles, 2 minutes): late and duplicate counters are above zero, no errors, and `inserted` is lower than `attempted` by the number of conflicts.
8. With an invalid `DATABASE_URL`, per-table errors are shown, the error count increases, and after 10 consecutive failed ticks the state is `failed`.
9. Layout checks of Section 7.1 pass at 390, 1280, 1920, and 2560 px.

### Step 2 — Dashboard

Implement D1–D12, `bench.test.ts`, and copy `components/ui.tsx` and `lib/format.ts` unchanged from the simulator.

Tests (`lib/bench.test.ts`): plan parsing with two inline fixtures (a hypertable plan with `ChunkAppend` over two chunks and a plain index scan), handling of JSON as string and as object; chunk-name regex and distinct counting; B7 window math (alignment, clamp, coverage errors); whitelist validation; inlining helpers reject invalid input; validity check on mismatching row counts; nearest-rank percentile.

Acceptance:
1. `typecheck`, `lint`, `test`, `build` pass in `dashboard/`.
2. Status strip shows plausible values and updates every 5 seconds; with the simulator stopped, the ingest rate falls to 0.
3. Quick set (5 repetitions) completes with progress and a Cancel button. For every pg/ts pair `rowsReturned` is equal (otherwise flagged). A variant that times out shows an error and does not break the run.
4. B7: when `telemetry_hourly` does not cover the window, all variants show the refresh message. After running Appendix A step 1, B7 returns timings for pg, ts, and ts_cagg with identical row counts.
5. EXPLAIN panel shows both plans and the "Chunks scanned: X of Y" badge matches the plan text.
6. History keeps at most 30 runs, survives reload, and Compare shows differences for two runs. CSV and JSON export contain all listed fields.
7. Live Probe: with the simulator running, the chart updates every interval and the ingest line is visible. Switching tabs stops the probe.
8. Storage tab shows sizes, `—` for the compression ratio when nothing is compressed, and a ratio after chunks are compressed with Appendix A step 3.
9. Every network call is read-only: review that all queries run under `BEGIN READ ONLY` and no endpoint accepts SQL.
10. Layout checks of Section 7.1 pass at 390, 1280, 1920, and 2560 px.

### Step 3 — Audit and README

No new features. Audit and fix only: forbidden patterns (`max-w-`, `container`, `mx-auto` on wrappers, `localStorage` in the simulator, `NEXT_PUBLIC_`), unused files, dependencies beyond Section 3, `console.log`, unused code, `ui.tsx` and `format.ts` byte-identical in both projects, `.env.example` completeness. Finish `README.md` (at most 80 lines): what it is, setup, environment variables, how to run both projects, Vercel notes (two projects from the same repository, set Root Directory to `simulator` and `dashboard`, set the environment variables, the simulator only runs while its tab is open), Assumptions, Deviations, Suggestions.

Acceptance: all checks of Steps 1 and 2 still pass, the audit list is clean, README present.

## 10. Report format (end of every step)

1. Table: requirement ID (S1–S12 or D1–D12, plus acceptance criteria numbers) → Done / Partial / Not done, with one line of evidence.
2. Files created or changed.
3. Commands run and their results (`typecheck`, `lint`, `test`, `build`).
4. Layout measurements at 1280 and 1920 px (left and right padding in px, horizontal scrollbar yes or no).
5. Assumptions and deviations recorded in README.
6. Anything you chose **not** to build because it was out of scope.

## 11. Known pitfalls (do not repeat)

1. Vercel functions are short-lived. Never keep a loop or state on the server; the simulator state lives in the browser.
2. `sslmode=require` in a `pg` connection string is stricter than libpq. Use the explicit `ssl` option from D2.
3. Insert at most 500 rows per statement and always `ON CONFLICT (vehicle_id, time) DO NOTHING`.
4. Do not trust browser-sent vehicle states: validate and clamp every field.
5. The two tables are written sequentially, so the second one lags by milliseconds. Benchmarks use `safeReferenceTime` (min of both latest timestamps minus 5 seconds) for that reason.
6. `telemetry_hourly` is not refreshed automatically. B7 must report this clearly instead of showing misleading timings.
7. Chunk names and TimescaleDB view columns differ between services and versions. Never hardcode chunk names.
8. Compare like with like: same `refTime`, same rows, sequential calls, alternating order, warmup discarded, report median plus p95, min, and max.
9. Selective single-vehicle queries are expected to perform about the same on both tables. Do not word the UI as if one table should always win.

## Appendix A — `db/experiments.sql` (create this file with exactly this content)

```sql
-- db/experiments.sql — guided experiments.
-- Run the statements manually in the Tiger Cloud SQL editor, top to bottom.
-- Statements marked DESTRUCTIVE delete data. Read the note first.

-- 1. Refresh the continuous aggregate (required before benchmark B7)
CALL refresh_continuous_aggregate('telemetry_hourly', NULL, NULL);

-- 2. Sizes (record before and after each experiment)
SELECT pg_size_pretty(pg_total_relation_size('telemetry_pg')) AS pg_total;
SELECT pg_size_pretty(total_bytes) AS ts_total FROM hypertable_detailed_size('telemetry_ts');

-- 3. Compression: compress chunks older than 2 days, then re-run sizes and the benchmarks
SELECT compress_chunk(c, if_not_compressed => true)
FROM show_chunks('telemetry_ts', older_than => INTERVAL '2 days') c;
-- Undo:
-- SELECT decompress_chunk(c, if_compressed => true) FROM show_chunks('telemetry_ts') c;

-- 4. Continuous aggregate vs materialized view: refresh cost
CREATE MATERIALIZED VIEW telemetry_hourly_mv AS
SELECT date_trunc('hour', time) AS bucket, vehicle_id,
       avg(speed_kmh) AS avg_speed, max(speed_kmh) AS max_speed, count(*) AS point_count
FROM telemetry_pg GROUP BY 1, 2;
-- Time this: full refresh of everything
REFRESH MATERIALIZED VIEW telemetry_hourly_mv;
-- Time this: incremental refresh of only the last 3 hours
CALL refresh_continuous_aggregate('telemetry_hourly', now() - INTERVAL '3 hours', now());
-- Cleanup:
-- DROP MATERIALIZED VIEW telemetry_hourly_mv;

-- 5. DESTRUCTIVE: retention, DELETE vs drop_chunks
-- Choose ONE cutoff and replace <cutoff> (for example, the oldest 10 days of data). Time each statement.
-- DELETE FROM telemetry_pg WHERE time < TIMESTAMPTZ '<cutoff>';
-- SELECT drop_chunks('telemetry_ts', older_than => TIMESTAMPTZ '<cutoff>');
-- After the DELETE, space becomes reusable after VACUUM, but the file shrinks only after VACUUM FULL.
-- VACUUM telemetry_pg;
```

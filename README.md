# Vehicle Tracking Demo: TimescaleDB vs PostgreSQL

This is a demo website that measures the difference between **TimescaleDB** and vanilla **PostgreSQL** for vehicle tracking data. Virtual vehicles generate location telemetry that is dual-written to both a standard PostgreSQL table and a TimescaleDB hypertable, allowing live comparison of ingest latencies, storage efficiency, and query performance. See [SPEC.md](SPEC.md) for detailed requirements and architecture.

## Prerequisites

- Python 3.11+
- Node.js 18+ and npm
- A Tiger Cloud (TimescaleDB) PostgreSQL service
- `schema.sql` and `migrate.py` already run to create tables and seed initial data.

## Setup and Run

### Windows (PowerShell)

**Backend:**
```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
copy .env.example .env
# Edit .env and set your TIGER_CONNECTION_STRING and other variables
uvicorn app.main:app --reload
```

**Frontend:**
```powershell
cd frontend
npm install
npm run dev
```

### Generic / Linux / macOS

**Backend:**
```bash
cd backend
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env and set your TIGER_CONNECTION_STRING
uvicorn app.main:app --reload
```

**Frontend:**
```bash
cd frontend
npm install
npm run dev
```

## Configuration

Environment variables are loaded from `backend/.env`. A template is provided in `backend/.env.example`.

| Variable | Default | Meaning |
|---|---|---|
| `TIGER_CONNECTION_STRING` | required | `postgres://user:pass@host:port/db?sslmode=require` |
| `READONLY_CONNECTION_STRING` | unset | Optional read-only role for dashboard reads. Falls back to the main string. |
| `ADMIN_TOKEN` | unset | If unset, all `/api/admin/*` endpoints return 403. |
| `CORS_ORIGINS` | `http://localhost:5173` | Comma-separated allowed origins. |
| `DB_POOL_SIZE` | 5 | Connections in the shared read pool. |
| `SIM_MAX_VEHICLES` | 1000 | Upper bound for `num_vehicles`. |
| `SIM_MIN_INTERVAL_SECONDS` | 1 | Lower bound for `interval_seconds`. |
| `SIM_DEFAULT_MAX_ROWS` | 1000000 | Auto-stop limit per table. |
| `BENCH_STATEMENT_TIMEOUT_SECONDS` | 120 | Per-query timeout in benchmarks. |
| `CAGG_REFRESH_INTERVAL_SECONDS` | 60 | Refresh period while the simulator runs. |

## Architecture Overview

```text
Simulator thread (N virtual vehicles)
      │ every X seconds: one batch
      ▼
  Ingest (same process) ── writes to ──► telemetry_pg   (latency measured)
                          └────────────► telemetry_ts   (latency measured)
                                              ▲
React dashboard ── REST polling ──► FastAPI ──┘ reads (latest, route, hourly,
                                               benchmark, storage, chunks)
```

**Components:**
- **Simulator**: Background thread that generates virtual vehicle movements and inserts them.
- **Dual-write**: Every insert goes to both tables (`telemetry_pg` and `telemetry_ts`) sequentially.
- **API Endpoints**: 
  - `/api/simulation`: Controls simulation and fetches live metrics.
  - `/api/vehicles`: Fetches latest positions and historical routes.
  - `/api/benchmark`: Runs performance comparisons.
  - `/api/storage`: Checks storage sizes and chunks.
  - `/api/admin`: Triggers manual admin tasks (compress, decompress, refresh).
- **Pages**: Simulation, Vehicles, Benchmark, Storage, Learn.

## How to use the app

1. **Run a simulation**: Go to the **Simulation** page, choose the number of vehicles, interval, mode, and target databases. Press "Start". You will see the Live Map update with moving vehicles and a latency chart showing insert performance.
2. **View vehicle stats**: Go to the **Vehicles** page, select a vehicle, and view its recent route map, speed chart, and an hourly average speed aggregation.
3. **Run a benchmark**: Go to the **Benchmark** page. Stop the simulation if you want undisturbed results. Select queries to run, number of repetitions, and warmup runs, then click "Run Benchmark".
4. **Manage Storage**: Go to the **Storage** page to see total sizes. Enter your `ADMIN_TOKEN` at the bottom to unlock Admin Actions. You can then select chunks to compress or decompress to see the space savings.

## Known Limitations

- **Synchronous Benchmark**: Benchmark runs sequentially.
- **In-Memory State**: Benchmark history and the simulation metrics ring-buffer are kept in memory and lost on backend restart.
- **Single Simulation**: Only one simulation can run at a time.
- **Authentication**: No multi-user support or general authentication. Only the admin endpoints require an `ADMIN_TOKEN`.

## Deviations from SPEC.md

The following are recorded clarifications and minor deviations from `SPEC.md` made during implementation:

1. **Extra modules**: Added `app/health.py` and `app/deps.py`. These keep the routers clean of business logic, respecting Section 13.
2. **Pool constants**: Constants for socket timeout (15s), idle check (30s), and acquire timeout (10s) are hardcoded in `db.py` to ensure fast 503 responses during outages.
3. **Discard logic**: The connection pool discards connections on *any* `pg8000` error to avoid corrupted session states. Only specific errors map to 503.
4. **Middleware 500 handler**: The catch-all 500 error handler is implemented as middleware instead of a Starlette exception handler, so it properly returns CORS headers.
5. **timescaledb_version**: May be `null` in `/api/health` if the extension is not installed, but the DB is still reported as `ok`.
6. **Frontend Dependencies**: Vite with `@tailwindcss/vite` (Tailwind v4) is used.
7. **Secret in migrate_old.py**: Unused scripts `migrate_old.py` and `migrate_with_checkpoint.py` were removed in Phase 6 as they contained hardcoded credentials and were dead code.
8. **Vehicles Route (Q2/Hourly)**: The `/api/vehicles/{id}/hourly` endpoint anchors its time window to the vehicle's most recent bucket (`SELECT max(bucket)...`) rather than `now()` so that non-simulated vehicles still show data.
9. **Benchmark CAGG Validation**: For query q4, the window is aligned to whole hours to ensure fair comparison. The benchmark runner verifies the `ts_cagg` data coverage with `SELECT min(bucket), max(bucket) FROM telemetry_hourly` before running, throwing an error if data is missing.
10. **Storage Colors**: The storage bar chart uses the same colors as PG/TS/TS_CAGG for its Table/Index/Toast bars to maintain a cohesive palette.
11. **Empty States**: Explicit `<EmptyState>` components are used in the UI for empty lists and missing data, standardizing error/empty presentation.

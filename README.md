# TimescaleDB vs PostgreSQL: Simulator + Dashboard

## What It Is
A research benchmarking suite comparing TimescaleDB with vanilla PostgreSQL for vehicle tracking telemetry.
- **Simulator**: Virtual vehicle fleet writing telemetry concurrently to `telemetry_pg` and `telemetry_ts`.
- **Dashboard**: Read-only interface providing status metrics, query benchmarks (B1–B9), EXPLAIN inspection, live probe, and storage analysis.

## Setup
1. Clone the repository.
2. Install dependencies in both projects:
   ```bash
   cd simulator && npm install
   cd ../dashboard && npm install
   ```
3. Set up the database using `db/schema.sql` and run `db/experiments.sql` for initial continuous aggregate refresh.

## Environment Variables
Create `.env.local` in `simulator/` and `dashboard/` based on their respective `.env.example` files:
- `DATABASE_URL`: Connection string (read/write for simulator, read-only for dashboard).
- `SIM_PASSWORD`: (simulator) Secret password required for API endpoints.
- `DB_SSL_VERIFY`: (both, optional) Set to `true` to verify SSL certificates (default `false`).
- `BENCH_TIMEOUT_MS`: (dashboard, optional) Per-query timeout in ms (default `15000`).

## How to Run Both Projects
Run both projects in separate terminals:
```bash
# Terminal 1: Simulator (http://localhost:3000)
cd simulator && npm run dev

# Terminal 2: Dashboard (http://localhost:3001)
cd dashboard && npm run dev
```

## Vercel Notes
- Deploy two distinct projects from the same repository.
- Set **Root Directory** to `simulator` for the simulator project and `dashboard` for the dashboard project.
- Configure all respective environment variables in each Vercel project settings.
- The simulator only generates data while its browser tab remains open and visible.

## Assumptions
- S12 late-row delay is uniformly distributed between 1 minute and 24 hours.
- Random walk for vehicle altitude uses ±0.5 m steps clamped to 5..25 m.
- Benchmark B7 window clamps to available `telemetry_hourly` coverage and prompts manual refresh when empty.

## Deviations
- None. All schema structures, endpoints, and design tokens strictly match SPEC.md.

## Suggestions
- Add UI controls for running admin tasks (chunk compression, continuous aggregate refresh) currently in `db/experiments.sql`.
- Allow custom vehicle bounding box selection in benchmark B9.
- Provide background worker option for continuous data ingestion without an open browser tab.

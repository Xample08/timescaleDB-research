# TimescaleDB vs PostgreSQL: Simulator + Dashboard

## What it is
Two independent Next.js projects inside a single repository to benchmark tracking data ingestion and query performance between a plain PostgreSQL table and a TimescaleDB hypertable.
- **Simulator**: Generates vehicle telemetry data and writes it to both tables simultaneously.
- **Dashboard**: A read-only interface to view database stats and run performance benchmarks.

## Setup
1. Clone the repository.
2. Initialize both projects:
   ```bash
   cd simulator && npm install
   cd ../dashboard && npm install
   ```
3. Set up the database using `db/schema.sql`.

## Environment Variables
Create `.env.local` in both `simulator` and `dashboard`. See the `.env.example` file in each directory.
- `DATABASE_URL`: Connection string (read/write for simulator, read-only for dashboard).
- `SIM_PASSWORD`: (simulator only) Password for API calls.
- `DB_SSL_VERIFY`: (both) Set to `true` to strictly verify SSL certs.
- `BENCH_TIMEOUT_MS`: (dashboard only) Per-query timeout.

## How to Run
Run both projects in separate terminal windows:
```bash
# Terminal 1
cd simulator
npm run dev

# Terminal 2
cd dashboard
npm run dev
```

## Vercel Notes
- Two projects are deployed from the same repository.
- Set **Root Directory** to `simulator` for the first project, and `dashboard` for the second.
- Set the environment variables in both Vercel projects.
- Note: The simulator only runs while its tab is open.

## Assumptions
- For S12 (dirty data late row), the delay is generated uniformly between 1 minute and 24 hours.
- Tick status loop uses `setInterval` over elapsed time, and recursive timeouts for ticks to ensure exact pacing.
- The `sim.ts` random walk for altitude was clamped tightly as specified but uniformly stepped since gauss `stdDev` wasn't explicitly provided for altitude; it mentions random walk of `±0.5` which was implemented.

## Deviations
- None yet.

## Suggestions
- None yet.

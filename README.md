# TimescaleDB vs PostgreSQL: Simulator + Dashboard

## What It Is
A research benchmarking suite comparing TimescaleDB with vanilla PostgreSQL for vehicle tracking telemetry.
- **Simulator**: Virtual vehicle fleet writing telemetry concurrently to `telemetry_pg` and `telemetry_ts`.
- **Dashboard**: Read-only interface providing status metrics, query benchmarks (B1â€“B9), EXPLAIN inspection, live probe, and storage analysis.

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
- Random walk for vehicle altitude uses Â±0.5 m steps clamped to 5..25 m.
- Benchmark B7 window clamps to available `telemetry_hourly` coverage and prompts manual refresh when empty.

## Deviations
- None. All schema structures, endpoints, and design tokens strictly match SPEC.md.

## Suggestions
- Add UI controls for running admin tasks (chunk compression, continuous aggregate refresh) currently in `db/experiments.sql`.
- Allow custom vehicle bounding box selection in benchmark B9.
- Provide background worker option for continuous data ingestion without an open browser tab.

## Warning scenario data

The simulator's **Warning scenarios** section enables persistent incidents independently of late/duplicate records. It defaults to a 5% chance per eligible vehicle per tick. Select which incidents to generate and adjust the thresholds:

- Speeding: above the configured limit (default 80 km/h), up to 200 km/h, for 20-90 seconds. Vehicle movement uses that speed.
- Prolonged stops: stationary positions for the configured warning duration (default 5 minutes), plus another 2-10 minutes.
- Extreme altitude: above the configured maximum (default 300 m) or below zero, for 20-90 seconds.
- Poor GPS accuracy: an error radius above the configured limit (default 50 m). Larger `gps_accuracy_m` values mean worse accuracy.

Incidents persist using telemetry timestamps, not a count of ticks. Burst mode sends more samples but does not make a five-minute stop elapse instantly. Warning counts in the simulator describe the latest generated tick, not confirmed database inserts. SQL Activity shows each insert's actual values and inserted/submitted counts. Incident state lasts for the active run; raw telemetry remains available for dashboard analysis after a refresh.

Both selected destinations receive identical scenario data in their existing columns. No schema migration is required. `db/warning-reports.sql` contains report examples for speeding, altitude, GPS quality, and contiguous stationary episodes. Use these queries in the future dashboard and evaluate alerts there; the simulator does not send notifications.

## Dashboard workspace and SQL execution

The dashboard uses the simulator's dark design: PostgreSQL is blue, TimescaleDB is teal, and continuous aggregates are purple. Drag horizontal dividers to adjust the workspace, benchmark/probe controls, or storage columns. **Reset sizes** restores defaults from `dashboard/lib/layout.ts`; vertical resizing is disabled.

The SQL execution panel stays visible on the right. It keeps session history, displays bound values, elapsed query time and returned-row counts, and highlights the current or latest database query. PostgreSQL and TimescaleDB histories are stacked; shared transaction/setup statements remain available under **Shared / session SQL**. By default the panel shows the active tab's operations; enable **Include other tabs and background status** to inspect every captured request. History is cleared by a page reload. Ordinary API clients still receive JSON unless they request the NDJSON stream.


### Dashboard warning reports

In the simulator, increase the vehicle slider/number field and press **Run simulation**. If the database has fewer active vehicles than requested, a confirmation prompt shows the current count and exact deficit. Accepting creates only the missing vehicle records, then initializes the run; cancelling creates nothing. Vehicle creation uses the simulator password and a database transaction with serialized vehicle-table writes, so repeated requests do not add surplus vehicles. Existing vehicles and telemetry are preserved. The run limit remains 1,000 vehicles (50 in per-row mode).

Benchmark query choices are grouped by workload and explain the time window, operation being tested, and returned data. B10–B14 add 24-hour speeding counts, poor-GPS counts, altitude violations, fleet speed percentiles, and telemetry gaps above 120 seconds. These use the same filters on PostgreSQL and TimescaleDB and support both benchmark execution and SQL-plan inspection. They inspect stored telemetry; they do not send warnings. The benchmark chart uses separate database bars and an independent scale per query. Optional log scaling expands small values relative to the fastest positive timing; tiny bars have a marked minimum visible width. Exact times remain authoritative. A fastest-median badge is shown only for a complete, non-empty comparison with matching output row counts. Equal medians are joint fastest; this is not a statistical significance claim.

Open **Fleet reports** in the dashboard navigation (`/reports`) for the single-page operations view. Its top navigation switches between PostgreSQL-only and TimescaleDB-only reports. The map shows each vehicle's latest stored position; selecting a marker or fleet row reveals coordinates, speed, heading, altitude, GPS accuracy, and sample time. Gray means stale telemetry; amber means an active warning. Summary metrics and the speed chart cover the last 24 hours. Lists paginate according to the space available, keeping the page within the viewport. Reports refresh every 15 seconds while visible; this can be turned off. Map tiles require access to OpenStreetMap; telemetry and warning reports remain available if tiles fail. Warning rules use the simulator defaults described below.

The Warnings tab checks stored telemetry separately for PostgreSQL (blue) and TimescaleDB (teal), with adjustable thresholds for speeding, long stops, extreme altitude and poor GPS accuracy. Defaults match the simulator: 80 km/h, 5 minutes stopped, altitude above 300 m or below zero, and GPS error above 50 m. All numeric fields are validated before querying.

Reports refresh every 30 seconds while the tab is visible, or on demand. Active warnings must match a vehicle's latest sample within the configured maximum sample gap (120 seconds by default); older matches remain historical. Moving samples or excessive gaps break stop episodes. The default lookback is 24 hours; stops spanning its beginning are measured only from samples within the window. Totals cover the whole window, while details show up to 200 matches per database, active first. Filters apply to those displayed details. Empty telemetry and database failures are shown explicitly. Warning queries also appear in the SQL execution history. These are dashboard reports; no external notifications are sent.


Benchmark measurements use `EXPLAIN (ANALYZE, BUFFERS, TIMING OFF, FORMAT JSON)` to measure total server execution with less per-node timing overhead. This excludes client/network transfer and includes EXPLAIN overhead. Warmups populate caches; query order alternates each repetition. Each variant runs under a savepoint so one failure does not abort the rest, and variants within a request share a repeatable-read snapshot. Latest-position queries respect the fixed reference time. Route auto-selection requires data from both tables in the requested window. Raw hourly comparisons do not require continuous aggregate coverage unless CAGG is selected. Failed/missing executions never enter timing distributions as zero. Every repetition is checked for output-row mismatches; empty results and detected empty telemetry scans are flagged. Matching row counts are a sanity check, not proof of identical datasets. Similar results on small indexed datasets can be legitimate; use larger histories, multi-day aggregate queries and covered CAGG windows to study workload-dependent differences.


### Resumable bulk data loader

Open **Bulk data** in the simulator navigation, or `/bulk` on the simulator server. Enter N rows per table, a dedicated fleet size, a history span, and the simulator password. Creating a dataset inserts N identical records into `telemetry_pg` and `telemetry_ts` (2N records overall), using new vehicle IDs for this job. Existing telemetry is preserved. Generated records include normal driving, speeding, stationary periods, abnormal altitude, and poor GPS error. Stop-warning duration depends on the chosen history span and sampling density.

The loader creates `simulator_bulk_jobs` automatically to store durable JSON checkpoints. Each request generates at most 270,000 records and commits both table inserts plus the checkpoint in one transaction. The default is set in `simulator/lib/bulk.ts` (`BULK_BATCH_SIZE`). Inserts use eight typed arrays with `unnest`, avoiding a large statement with thousands of individual parameters. Larger batches reduce HTTP requests and transaction overhead; actual throughput depends on the database, indexes, storage, and network. Failed transactions roll back both tables; a lost response is recovered from the committed checkpoint. Creation uses a browser-generated job ID saved before the request, so retrying creation does not create another fleet. A database advisory lock serializes requests for the same job.

**Pause loading** waits for the current request to commit or roll back and then pauses between batches. **Continue** reloads the job before starting more batches. After a refresh, crash, timeout, or network failure, enter the password again and use **Load saved checkpoint** to inspect without restarting, or **Continue** to resume. Loading runs only while the page is open; closing it may allow the in-flight batch to finish. The browser stores only the last job ID/settings, never the password. Progress counts committed rows per table and may lag if a response was lost. The activity log keeps the latest 150 local messages; the checkpoint remains in the database. Bulk generation does not refresh Timescale continuous aggregates automatically.

#### Batch-size probe

From `simulator`, run `npm run tune:bulk` (Node 22.15+). The script uses the same data generator and array SQL as the loader. It starts at 10,000 rows per table and grows by roughly 50%, stopping at a 30-second combined insertion/generation budget, a client memory guard (40% of the V8 heap limit or half of initially free RAM), a database error, or ten minutes. Test telemetry and vehicles are rolled back after every probe; identity sequences can still advance and the tests generate database/WAL load. The script never changes an existing bulk job.

Results are saved in `simulator/bulk-tuning-results.json`. To repeat the recommended size three times, run `node --experimental-strip-types --expose-gc scripts/tune-bulk.mjs --verify`; `--resume` continues growing from the previous successful size. The recommendation selects the largest batch within 5% of the best observed median throughput, requiring all its samples to take less than 21 seconds. Recommendations are not applied automatically.

On October 10, 2026, 405,000 rows per table took 25.4 seconds and 608,000 took 39.2 seconds, exceeding the 30-second operational target. The selected 270,000-row batch took 15.5–17.2 seconds across four probes. These measurements include generation and both inserts, but exclude durable commit and HTTP costs; they do not establish a PostgreSQL maximum or a guaranteed production rate. The probe process saw about 16 GB total RAM and 2 GB free. The larger default improves request overhead but pauses now wait for a larger in-flight batch.

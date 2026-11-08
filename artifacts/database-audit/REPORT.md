# New database compatibility audit

Checked on November 8, 2026, approximately 15:00-15:04 WIB (Asia/Jakarta).

The database is usable for current reads, but it does not fully match `db/schema.sql` or the current application's vehicle-creation requirements. All database operations in this audit were read-only. No index, constraint, sequence, policy, default, or application setting was changed.

Evidence: [report.json](report.json). Reusable read-only audit: [audit.cjs](audit.cjs), run from the repository root with `node artifacts/database-audit/audit.cjs`. Each audit check has a five-second statement timeout and a 1.5-second lock timeout. The audit reports configuration comparisons without recording connection strings or passwords. Application credentials are read locally from the simulator and dashboard environment files.

## Findings and recommended order

| Priority | Finding | Evidence | Impact and next step |
|---|---|---|---|
| 1 | Vehicle identity sequence is behind existing data | `vehicles.id` has `GENERATED ALWAYS AS IDENTITY`; maximum existing ID is `3400`, while `vehicles_id_seq.last_value=1` and `is_called=false`, with increment `1` | The next generated ID would be `1` at the audited state, and ID `1` already exists. Vehicle creation can fail with a duplicate primary key. Synchronize the sequence while vehicle writers are paused. |
| 1 | Two vehicle defaults are missing | `vehicles.is_active` is NOT NULL without `DEFAULT true`; `vehicles.created_at` is NOT NULL without `DEFAULT now()` | The simulator's vehicle creation, bulk loader, and probe omit `created_at`; these inserts can fail. The seed script also omits `is_active`. Restore both defaults. Existing rows are populated and are not automatically changed by setting defaults. |
| 2 | Telemetry foreign keys are missing | Neither `telemetry_pg.vehicle_id` nor `telemetry_ts.vehicle_id` has a foreign-key constraint referencing `vehicles(id)` | Unlike the repository schema, the database does not enforce the existence of referenced vehicles. This does not prove there are orphan rows. Restore constraints using a validation plan appropriate for the billion-row tables and compressed Timescale chunks. Full historical orphan checks were not run. |
| 2 | License-plate uniqueness is missing | `vehicles.plate_number` is NOT NULL, but has no unique constraint or unique index. All 3,000 existing vehicle rows were checked: zero duplicate plate groups | Duplicate plates can be inserted, contrary to `db/schema.sql`. Add the expected unique constraint after coordinating writers. |
| 2 | Dashboard query timeout is disabled | `dashboard/.env` resolves `BENCH_TIMEOUT_MS` to `0`; the database's initial `statement_timeout` is also `0` | The dashboard sets per-query `statement_timeout` from this variable. Zero allows queries to run indefinitely, tying up its three connections. Configure a positive timeout appropriate for the experiment and hosting request limits; the repository default is `15000` ms. Restart the dashboard after changing its environment. |
| 2 | Hourly aggregate does not cover the newest raw data | `telemetry_hourly` contains buckets from October 10, 2025, 22:00 WIB through October 20, 2026, 13:00 WIB; both raw tables have latest telemetry at November 8, 2026, 14:55:02 WIB | Recent raw-data windows are not available in the hourly aggregate. It is configured with `materialized_only=true`, and no automatic refresh policy for this aggregate was found. Manual refresh is consistent with the repository design, but coverage needs updating before comparing recent CAGG windows. Plan a bounded refresh window rather than automatically refreshing the full history. |
| Experiment setting | Automatic compression differs from the repository baseline | A scheduled compression policy runs every 12 hours with `compress_after='30 days'`. Of 369 telemetry chunks, 364 are already compressed | This can be intentional, but `db/schema.sql` leaves automatic compression off. Record this as a compressed-data experiment; compression may change during repeated benchmarks if the policy runs. Decide whether to keep or pause it for a controlled run. No policy was changed. |

## Confirmed correct

- Simulator and dashboard local configurations point to the same database target and use the same credentials. No overriding `.env.local` or inherited `DATABASE_URL` was found during this audit.
- PostgreSQL reports version `18.6`; TimescaleDB reports `2.31.0`. All inspected application-required database functions are available and executable by the configured role.
- `vehicles`, `telemetry_pg`, `telemetry_ts`, `telemetry_hourly`, and `simulator_bulk_jobs` exist.
- Expected column names, data types, column order, and NOT NULL requirements match the schema. The default-expression differences are listed above.
- `telemetry_pg` is a regular PostgreSQL table. It is not a Timescale hypertable.
- Both telemetry tables have valid primary-key indexes on `(vehicle_id, time)` and valid separate B-tree indexes on `(time DESC)`.
- In particular, **`telemetry_pg_time_idx` is now present, valid, ready, and live**. The previous missing-index finding has been resolved in the audited database. `EXPLAIN` now chooses `Limit -> Index Only Scan` using this index for `MAX(time)`.
- All 369 Timescale chunks have a valid primary key and a valid time-leading B-tree index. No missing chunk indexes were found by those checks.
- `telemetry_ts` is partitioned on `time` with a one-day interval. Compression is enabled, segmented by `vehicle_id`, ordered by `time DESC`, as required by the repository schema.
- `telemetry_hourly` has the correct hourly bucket, vehicle grouping, average speed, maximum speed, and point count definition. Its five output columns match application expectations. It already contains materialized data.
- The bulk checkpoint table has the expected UUID primary key and non-null JSONB state. The two inspected checkpoint records are marked completed and have processed counts equal to their planned counts.
- Required SELECT/INSERT/UPDATE privileges, schema CREATE privilege, and sequence access are available for the current application credentials. These were checked through metadata; no test writes were performed.
- Autovacuum is enabled. The PostgreSQL table and all 369 telemetry chunks have analysis history. The empty Timescale parent table's row statistics are expected: data resides in its chunks.
- No index build was in progress when checked.

## Read verification and data-comparison limits

The nine live-status query operations used by `/api/status` were replayed read-only with UTC session time and a 15-second per-statement timeout. They all succeeded, taking **3,380 ms overall** in one measurement, including network requests and transaction setup. This is a database-level verification, not an HTTP/browser end-to-end test or a performance guarantee.

Both telemetry tables returned the same earliest timestamp (`2025-10-10T15:51:36.128Z`) and latest timestamp (`2026-11-08T07:55:02.134Z`). A bounded comparison of the latest five rows for three existing vehicles found **15 matching rows per table and zero differences** across all telemetry columns.

Approximate row-count functions returned:

| Table | Approximate rows |
|---|---:|
| `telemetry_pg` | 1,001,675,840 |
| `telemetry_ts` | 999,210,241 |

These estimates differ, but they do **not** establish a missing-data problem. They come from table/chunk statistics and compression-aware estimation. The chunk live-row estimates also differ from these functions. Full exact counts, full cross-table row equality, historical foreign-key integrity, and checksums were not performed because they would scan very large histories. The matching timestamps and samples do not prove that all historical rows are identical.

## Small prerequisite repairs to review

The following SQL is a proposal only and was **not executed**. Pause vehicle creation and bulk jobs before synchronizing the sequence. Confirm current state again if another process may have changed the database since the audit.

```sql
ALTER TABLE public.vehicles
  ALTER COLUMN is_active SET DEFAULT true,
  ALTER COLUMN created_at SET DEFAULT now();

-- Existing vehicles are present; set the next generated ID after their maximum.
SELECT setval(
  pg_get_serial_sequence('public.vehicles', 'id'),
  (SELECT max(id) FROM public.vehicles),
  true
);

-- No duplicate plates were found during the audit.
ALTER TABLE public.vehicles
  ADD CONSTRAINT vehicles_plate_number_key UNIQUE (plate_number);
```

Foreign-key restoration, constraint validation over existing telemetry, aggregate refresh, and compression-policy changes should be separate operations with their load and benchmark effects considered. Re-running `db/schema.sql` or `db/migrate.py` is not the proposed repair: those scripts create existing objects and the migration defaults include destructive reset/cleanup behavior.

## References

- Repository requirements: [schema](../../db/schema.sql), [vehicle creation](../../simulator/app/api/vehicles/route.ts), [bulk creation](../../simulator/app/api/bulk/route.ts), [dashboard connection pool](../../dashboard/lib/db.ts), [status queries](../../dashboard/app/api/status/route.ts).
- PostgreSQL: [sequence behavior](https://www.postgresql.org/docs/current/functions-sequence.html), [table statistics and estimates](https://www.postgresql.org/docs/current/monitoring-stats.html).
- Tiger Data: [dimension metadata](https://www.tigerdata.com/docs/reference/timescaledb/informational-views/dimensions), [continuous aggregate metadata](https://www.tigerdata.com/docs/reference/timescaledb/informational-views/continuous_aggregates), [aggregate refresh](https://www.tigerdata.com/docs/build/continuous-aggregates/refresh-policies), [constraints on hypertables](https://www.tigerdata.com/docs/build/performance-optimization/ensure-data-integrity-with-constraints).

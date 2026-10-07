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

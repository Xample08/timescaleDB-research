// Read-only database compatibility audit. Connection strings are never reported.
const fs = require('node:fs');
const path = require('node:path');
const { parseEnv } = require('node:util');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '../..');
const { Client } = createRequire(path.join(root, 'dashboard/package.json'))('pg');
const report = { checkedAt: new Date().toISOString(), mode: 'read-only', checks: {}, configuration: {} };

function config(app) {
  const env = { ...process.env };
  const loadedFiles = [];
  for (const name of ['.env.development.local', '.env.local', '.env.development', '.env']) {
    const file = path.join(root, app, name);
    if (!fs.existsSync(file)) continue;
    loadedFiles.push(`${app}/${name}`);
    for (const [key, value] of Object.entries(parseEnv(fs.readFileSync(file, 'utf8')))) {
      if (env[key] === undefined) env[key] = value;
    }
  }
  return { env, loadedFiles };
}
const dashboard = config('dashboard');
const simulator = config('simulator');
function target(raw) {
  const u = new URL(raw);
  return { host: u.hostname, port: u.port || '5432', database: decodeURIComponent(u.pathname.slice(1)), user: decodeURIComponent(u.username), password: decodeURIComponent(u.password) };
}
const dt = target(dashboard.env.DATABASE_URL);
const st = target(simulator.env.DATABASE_URL);
report.configuration = {
  dashboardEnvFiles: dashboard.loadedFiles,
  simulatorEnvFiles: simulator.loadedFiles,
  inheritedDatabaseUrl: Boolean(process.env.DATABASE_URL),
  sameDatabaseTarget: dt.host === st.host && dt.port === st.port && dt.database === st.database,
  sameCredentials: dt.user === st.user && dt.password === st.password,
  dashboardSslVerify: dashboard.env.DB_SSL_VERIFY === 'true',
  simulatorSslVerify: simulator.env.DB_SSL_VERIFY === 'true',
  dashboardBenchTimeoutMs: Number(dashboard.env.BENCH_TIMEOUT_MS || 15000),
  dashboardExactCountTimeoutMs: Number(dashboard.env.EXACT_COUNT_TIMEOUT_MS || 1800000),
};

function clientFor(env) {
  return new Client({
    connectionString: (env.DATABASE_URL || '').replace(/[?&]sslmode=[^&]*/, '').replace(/\?$/, ''),
    ssl: env.DB_SSL_VERIFY === 'true' ? true : { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000,
    application_name: 'repository-readonly-audit',
  });
}
const client = clientFor(dashboard.env);
async function check(name, sql, values = [], connection = client) {
  const started = Date.now();
  try {
    await connection.query('BEGIN READ ONLY');
    await connection.query('SET LOCAL statement_timeout = 5000');
    await connection.query('SET LOCAL lock_timeout = 1500');
    const result = await connection.query(sql, values);
    await connection.query('COMMIT');
    report.checks[name] = { ok: true, durationMs: Date.now() - started, rows: result.rows };
    console.log(`${name}: OK (${Date.now() - started} ms; ${result.rowCount} rows)`);
    return result.rows;
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => {});
    const raw = dashboard.env.DATABASE_URL || '';
    const message = String(error.message).replaceAll(raw, '[REDACTED]').slice(0, 300);
    report.checks[name] = { ok: false, durationMs: Date.now() - started, code: error.code, message };
    console.log(`${name}: FAILED (${error.code || error.name})`);
    return null;
  }
}

const relationFilter = "c.oid IN (to_regclass('public.vehicles'),to_regclass('public.telemetry_pg'),to_regclass('public.telemetry_ts'),to_regclass('public.telemetry_hourly'),to_regclass('public.simulator_bulk_jobs'))";
const permissionSql = `SELECT n.nspname AS schema_name,c.relname,
  has_table_privilege(c.oid,'SELECT') AS can_select,
  has_table_privilege(c.oid,'INSERT') AS can_insert,
  has_table_privilege(c.oid,'UPDATE') AS can_update,
  has_table_privilege(c.oid,'DELETE') AS can_delete,
  pg_has_role(c.relowner,'USAGE') AS has_owner_role
  FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${relationFilter} ORDER BY c.relname`;

async function main() {
  const connectionStart = Date.now();
  await client.connect();
  report.connectionMs = Date.now() - connectionStart;
  report.baselineSettings = (await client.query("SELECT current_setting('statement_timeout') AS statement_timeout,current_setting('TimeZone') AS timezone")).rows[0];
  await check('server', `SELECT current_setting('server_version') AS postgres_version,
    current_setting('TimeZone') AS session_timezone,
    current_setting('search_path') AS search_path,
    current_setting('default_transaction_read_only') AS default_read_only,
    current_setting('max_connections') AS max_connections,
    current_setting('statement_timeout') AS audit_statement_timeout,
    current_setting('autovacuum') AS autovacuum,
    current_setting('autovacuum_analyze_scale_factor') AS analyze_scale_factor,
    current_setting('autovacuum_analyze_threshold') AS analyze_threshold,
    pg_database_size(current_database()) AS database_bytes`);
  await check('extensions', "SELECT extname,extversion FROM pg_extension WHERE extname IN ('timescaledb','timescaledb_toolkit') ORDER BY extname");
  await check('relations', `SELECT n.nspname AS schema_name,c.relname,c.relkind,
    c.reltuples::bigint AS estimated_rows,c.relpages,c.reloptions,
    pg_total_relation_size(c.oid) AS total_bytes,
    pg_relation_size(c.oid) AS table_bytes,pg_indexes_size(c.oid) AS index_bytes,
    c.relrowsecurity AS row_security
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE ${relationFilter} ORDER BY c.relname`);
  await check('columns', `SELECT c.relname,a.attname AS column_name,a.attnum AS position,
    format_type(a.atttypid,a.atttypmod) AS data_type,a.attnotnull AS not_null,
    a.attidentity AS identity_kind,pg_get_expr(d.adbin,d.adrelid) AS default_expression
    FROM pg_class c JOIN pg_attribute a ON a.attrelid=c.oid
    LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
    WHERE ${relationFilter} AND a.attnum>0 AND NOT a.attisdropped ORDER BY c.relname,a.attnum`);
  await check('constraints', `SELECT c.relname,k.conname,k.contype,k.convalidated,
    pg_get_constraintdef(k.oid) AS definition
    FROM pg_constraint k JOIN pg_class c ON c.oid=k.conrelid WHERE ${relationFilter} ORDER BY c.relname,k.conname`);
  await check('indexes', `SELECT c.relname,ix.relname AS index_name,am.amname AS method,
    i.indisprimary AS primary_key,i.indisunique AS unique_index,i.indisvalid AS valid,
    i.indisready AS ready,i.indislive AS live,pg_get_indexdef(i.indexrelid) AS definition,
    pg_get_indexdef(i.indexrelid,1,true) AS first_key,pg_get_expr(i.indpred,i.indrelid) AS predicate,
    pg_relation_size(ix.oid) AS index_bytes
    FROM pg_index i JOIN pg_class c ON c.oid=i.indrelid JOIN pg_class ix ON ix.oid=i.indexrelid
    JOIN pg_am am ON am.oid=ix.relam WHERE ${relationFilter} ORDER BY c.relname,ix.relname`);
  await check('statistics', `SELECT c.relname,s.n_live_tup,s.n_dead_tup,s.n_mod_since_analyze,
    s.last_analyze,s.last_autoanalyze,s.last_vacuum,s.last_autovacuum,
    s.seq_scan,s.idx_scan,c.reltuples::bigint AS estimated_rows
    FROM pg_class c LEFT JOIN pg_stat_all_tables s ON s.relid=c.oid WHERE ${relationFilter} ORDER BY c.relname`);
  await check('hypertables', "SELECT to_jsonb(h) AS info FROM timescaledb_information.hypertables h WHERE hypertable_schema='public' AND hypertable_name IN ('telemetry_ts','telemetry_pg')");
  await check('dimensions', "SELECT to_jsonb(d) AS info FROM timescaledb_information.dimensions d WHERE hypertable_schema='public' AND hypertable_name IN ('telemetry_ts','telemetry_pg')");
  const availableViews = await check('timescale_views', "SELECT table_name FROM information_schema.views WHERE table_schema='timescaledb_information' AND table_name IN ('compression_settings','hypertable_compression_settings','hypertable_columnstore_settings','continuous_aggregates','jobs','job_stats')");
  for (const name of ['compression_settings','hypertable_compression_settings','hypertable_columnstore_settings']) {
    if (availableViews?.some(x => x.table_name === name)) {
      await check(name, `SELECT to_jsonb(v) AS info FROM timescaledb_information.${name} v WHERE to_jsonb(v)->>'hypertable_name'='telemetry_ts' AND to_jsonb(v)->>'hypertable_schema'='public'`);
    }
  }
  const aggregates = await check('continuous_aggregates', "SELECT to_jsonb(a) AS info FROM timescaledb_information.continuous_aggregates a WHERE view_schema='public' AND view_name='telemetry_hourly'");
  await check('chunk_summary', `SELECT hypertable_name,count(*)::int AS chunks,
    count(*) FILTER (WHERE is_compressed)::int AS compressed_chunks,
    min(range_start) AS earliest_chunk_start,max(range_end) AS latest_chunk_end
    FROM timescaledb_information.chunks WHERE hypertable_schema='public' AND hypertable_name='telemetry_ts' GROUP BY hypertable_name`);
  await check('chunk_integrity', `WITH chunks AS (
    SELECT pc.oid FROM timescaledb_information.chunks ch
    JOIN pg_namespace ns ON ns.nspname=ch.chunk_schema
    JOIN pg_class pc ON pc.relnamespace=ns.oid AND pc.relname=ch.chunk_name
    WHERE ch.hypertable_schema='public' AND ch.hypertable_name='telemetry_ts'
  ) SELECT count(*)::int AS chunks,
    count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM pg_index i WHERE i.indrelid=chunks.oid AND i.indisprimary AND i.indisvalid))::int AS without_valid_primary_key,
    count(*) FILTER(WHERE NOT EXISTS(SELECT 1 FROM pg_index i JOIN pg_class ix ON ix.oid=i.indexrelid JOIN pg_am am ON am.oid=ix.relam
      WHERE i.indrelid=chunks.oid AND i.indisvalid AND am.amname='btree' AND i.indpred IS NULL AND pg_get_indexdef(i.indexrelid,1,true) IN ('time','"time"','time DESC','"time" DESC')))::int AS without_valid_time_index
    FROM chunks`);
  await check('chunk_statistics', `SELECT count(*)::int AS chunks,
    coalesce(sum(st.n_live_tup),0) AS estimated_live_rows,
    coalesce(sum(st.n_dead_tup),0) AS estimated_dead_rows,
    coalesce(sum(st.n_mod_since_analyze),0) AS estimated_changes_since_analyze,
    count(*) FILTER(WHERE st.last_analyze IS NULL AND st.last_autoanalyze IS NULL)::int AS chunks_never_analyzed,
    max(greatest(st.last_analyze,st.last_autoanalyze)) AS latest_analyze
    FROM timescaledb_information.chunks ch JOIN pg_namespace ns ON ns.nspname=ch.chunk_schema
    JOIN pg_class pc ON pc.relnamespace=ns.oid AND pc.relname=ch.chunk_name
    LEFT JOIN pg_stat_all_tables st ON st.relid=pc.oid
    WHERE ch.hypertable_schema='public' AND ch.hypertable_name='telemetry_ts'`);
  await check('policies', `SELECT job_id,proc_schema,proc_name,schedule_interval,scheduled,
    hypertable_schema,hypertable_name,config FROM timescaledb_information.jobs
    WHERE hypertable_name IN ('telemetry_ts','telemetry_pg','telemetry_hourly')
      OR config->>'hypertable_id' IN (SELECT id::text FROM _timescaledb_catalog.hypertable WHERE schema_name='public' AND table_name='telemetry_ts')`);
  await check('dashboard_permissions', permissionSql);
  await check('schema_permissions', "SELECT has_schema_privilege('public','USAGE') AS public_usage,has_schema_privilege('public','CREATE') AS public_create");
  await check('identity_sequence', `SELECT pg_get_serial_sequence('public.vehicles','id') AS sequence,
    has_sequence_privilege(pg_get_serial_sequence('public.vehicles','id'),'USAGE') AS can_use,
    has_sequence_privilege(pg_get_serial_sequence('public.vehicles','id'),'SELECT') AS can_read`);
  const seq = report.checks.identity_sequence?.rows?.[0]?.sequence;
  if (seq && /^[A-Za-z0-9_."]+$/.test(seq)) {
    await check('identity_position', `SELECT (SELECT max(id) FROM public.vehicles) AS max_vehicle_id,
      last_value,is_called FROM ${seq}`);
  }
  await check('vehicles_summary', 'SELECT count(*)::int AS total,count(*) FILTER(WHERE is_active)::int AS active,min(id) AS min_id,max(id) AS max_id FROM public.vehicles');
  await check('vehicle_plate_duplicates', 'SELECT count(*)::int AS duplicate_plate_groups,coalesce(sum(n-1),0)::int AS extra_duplicate_rows FROM (SELECT count(*) AS n FROM public.vehicles GROUP BY plate_number HAVING count(*)>1) d');
  await check('sequence_details', `SELECT seqstart,seqincrement,seqmax,seqmin,seqcache,seqcycle
    FROM pg_sequence WHERE seqrelid=pg_get_serial_sequence('public.vehicles','id')::regclass`);
  await check('function_support', `SELECT p.proname,pg_get_function_identity_arguments(p.oid) AS arguments,
    p.prokind,has_function_privilege(p.oid,'EXECUTE') AS can_execute
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname IN ('approximate_row_count','hypertable_detailed_size','hypertable_compression_stats','chunks_detailed_size','compress_chunk','decompress_chunk','show_chunks','refresh_continuous_aggregate','time_bucket') ORDER BY p.proname,p.oid`);
  await check('active_work', `SELECT backend_type,state,wait_event_type,
    CASE WHEN query ILIKE '%CREATE%INDEX%' THEN 'create-index'
      WHEN query ILIKE '%max(time)%' THEN 'latest-time'
      WHEN query ILIKE '%count(*)%' THEN 'count'
      WHEN query ILIKE '%INSERT%' THEN 'insert' ELSE 'other' END AS operation,
    count(*)::int AS sessions,round(max(extract(epoch FROM now()-query_start))) AS oldest_query_seconds
    FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()
    GROUP BY backend_type,state,wait_event_type,operation ORDER BY backend_type,state`);
  await check('index_build_progress', `SELECT p.command,p.phase,p.lockers_total,p.lockers_done,
    p.blocks_total,p.blocks_done,p.tuples_total,p.tuples_done,
    p.relid::regclass::text AS table_name,p.index_relid::regclass::text AS index_name
    FROM pg_stat_progress_create_index p WHERE p.datid=(SELECT oid FROM pg_database WHERE datname=current_database())`);
  for (const table of ['telemetry_pg','telemetry_ts']) {
    await check(`approximate_rows_${table}`, `SELECT approximate_row_count('public.${table}') AS estimated_rows`);
    await check(`plan_latest_${table}`, `EXPLAIN (FORMAT JSON) SELECT max(time) AS max_time FROM public.${table}`);
  }
  // Bounded reads only: no full counts, aggregate refreshes, or write operations.
  for (const table of ['telemetry_pg','telemetry_ts']) {
    const indexes = report.checks.indexes?.rows || [];
    const hasTimeIndex = indexes.some(i => i.relname === table && i.valid && i.ready && i.method === 'btree' && i.predicate === null && /^("?time"?)( DESC)?$/.test(i.first_key));
    if (hasTimeIndex) {
      await check(`latest_sample_${table}`, `SELECT time FROM public.${table} ORDER BY time DESC LIMIT 1`);
      await check(`earliest_sample_${table}`, `SELECT time FROM public.${table} ORDER BY time ASC LIMIT 1`);
    } else report.checks[`sample_${table}`] = { skipped: true, reason: 'No valid time-leading index; avoid scanning the full telemetry table.' };
  }
  if (aggregates?.length) {
    await check('continuous_aggregate_sample', 'SELECT bucket,vehicle_id,point_count FROM public.telemetry_hourly LIMIT 1');
    await check('continuous_aggregate_coverage', `SELECT
      (SELECT bucket FROM public.telemetry_hourly ORDER BY bucket ASC LIMIT 1) AS earliest_bucket,
      (SELECT bucket FROM public.telemetry_hourly ORDER BY bucket DESC LIMIT 1) AS latest_bucket`);
    const mat = aggregates[0].info;
    await check('materialization_statistics', `SELECT n.nspname,c.relname,c.reltuples::bigint AS estimated_rows,
      pg_get_viewdef('public.telemetry_hourly'::regclass,true) AS view_definition
      FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relname=$2`, [mat.materialization_hypertable_schema,mat.materialization_hypertable_name]);
  }
  await check('sample_parity', `WITH selected AS MATERIALIZED (
      SELECT id FROM public.vehicles WHERE id IN (SELECT min(id) FROM public.vehicles)
      OR id IN (SELECT max(id) FROM public.vehicles)
      OR id IN (SELECT id FROM public.vehicles ORDER BY id OFFSET 1500 LIMIT 1)
    ), pg_sample AS MATERIALIZED (
      SELECT t.* FROM selected v CROSS JOIN LATERAL
        (SELECT * FROM public.telemetry_pg WHERE vehicle_id=v.id ORDER BY time DESC LIMIT 5) t
    ), ts_sample AS MATERIALIZED (
      SELECT t.* FROM selected v CROSS JOIN LATERAL
        (SELECT * FROM public.telemetry_ts WHERE vehicle_id=v.id ORDER BY time DESC LIMIT 5) t
    ) SELECT (SELECT count(*) FROM selected)::int AS vehicles_checked,
      (SELECT count(*) FROM pg_sample)::int AS pg_sample_rows,
      (SELECT count(*) FROM ts_sample)::int AS ts_sample_rows,
      (SELECT count(*) FROM (SELECT * FROM pg_sample EXCEPT SELECT * FROM ts_sample) d)::int AS pg_only_or_different,
      (SELECT count(*) FROM (SELECT * FROM ts_sample EXCEPT SELECT * FROM pg_sample) d)::int AS ts_only_or_different`);
  await check('bulk_checkpoint_summary', `SELECT id,state->>'total' AS planned_rows_per_table,
    state->>'processed' AS committed_rows_per_table,state->>'status' AS status,
    state->>'startTime' AS start_time,state->>'endTime' AS end_time,
    jsonb_array_length(state->'vehicleIds') AS vehicles FROM public.simulator_bulk_jobs`);
  if (report.configuration.sameCredentials && report.configuration.sameDatabaseTarget) {
    report.checks.simulator_permissions = { ...report.checks.dashboard_permissions, reusedDashboardCheck: true };
  } else {
    const simClient = clientFor(simulator.env);
    try {
      await simClient.connect();
      await check('simulator_permissions', permissionSql, [], simClient);
      await check('simulator_schema_permissions', "SELECT has_schema_privilege('public','USAGE') AS public_usage,has_schema_privilege('public','CREATE') AS public_create", [], simClient);
      await check('simulator_identity_sequence_permissions', "SELECT has_sequence_privilege(pg_get_serial_sequence('public.vehicles','id'),'USAGE') AS can_use", [], simClient);
    } finally { await simClient.end().catch(() => {}); }
  }
}

main().catch(error => {
  report.fatal = { code: error.code, name: error.name };
  console.log('Audit stopped:', error.code || error.name);
}).finally(async () => {
  await client.end().catch(() => {});
  report.finishedAt = new Date().toISOString();
  fs.writeFileSync(path.join(__dirname, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log('Saved artifacts/database-audit/report.json');
});

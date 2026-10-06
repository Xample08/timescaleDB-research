-- =====================================================================
-- Vehicle Tracking: PostgreSQL vanilla vs TimescaleDB (Tiger Cloud)
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ---------------------------------------------------------------------
-- 1. Master table: vehicles
-- ---------------------------------------------------------------------
CREATE TABLE vehicles (
    id            INTEGER GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    plate_number  TEXT        NOT NULL UNIQUE,
    name          TEXT,
    vehicle_type  TEXT,
    is_active     BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2a. Telemetry: plain PostgreSQL (baseline)
-- ---------------------------------------------------------------------
CREATE TABLE telemetry_pg (
    time            TIMESTAMPTZ      NOT NULL,   -- device timestamp
    vehicle_id      INTEGER          NOT NULL REFERENCES vehicles(id),
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    speed_kmh       REAL,
    heading_deg     REAL,
    altitude_m      REAL,
    gps_accuracy_m  REAL,
    PRIMARY KEY (vehicle_id, time)
);

-- Same index that create_hypertable adds by default, so the comparison is fair
CREATE INDEX telemetry_pg_time_idx ON telemetry_pg (time DESC);

-- ---------------------------------------------------------------------
-- 2b. Telemetry: TimescaleDB hypertable (same columns)
-- ---------------------------------------------------------------------
CREATE TABLE telemetry_ts (
    time            TIMESTAMPTZ      NOT NULL,
    vehicle_id      INTEGER          NOT NULL REFERENCES vehicles(id),
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    speed_kmh       REAL,
    heading_deg     REAL,
    altitude_m      REAL,
    gps_accuracy_m  REAL,
    PRIMARY KEY (vehicle_id, time)    -- unique index must include the partition column
);

-- Partition by time, 1 day per chunk. Tune this to your service RAM.
SELECT create_hypertable('telemetry_ts', 'time', chunk_time_interval => INTERVAL '1 day');

-- ---------------------------------------------------------------------
-- 3. TimescaleDB features
-- ---------------------------------------------------------------------

-- 3a. Compression settings (policy is left off so you can compare sizes manually)
ALTER TABLE telemetry_ts SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby   = 'time DESC'
);
-- SELECT add_compression_policy('telemetry_ts', INTERVAL '7 days');
-- SELECT compress_chunk(c, if_not_compressed => true) FROM show_chunks('telemetry_ts') c;

-- 3b. Retention (left off, it would delete the generated demo data)
-- SELECT add_retention_policy('telemetry_ts', INTERVAL '90 days');

-- 3c. Continuous aggregate: hourly summary per vehicle
CREATE MATERIALIZED VIEW telemetry_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', time) AS bucket,
    vehicle_id,
    avg(speed_kmh)              AS avg_speed,
    max(speed_kmh)              AS max_speed,
    count(*)                    AS point_count
FROM telemetry_ts
GROUP BY bucket, vehicle_id
WITH NO DATA;

-- ---------------------------------------------------------------------
-- 4. Example queries for the benchmark
-- ---------------------------------------------------------------------
-- Q1: latest position per vehicle
--   SELECT DISTINCT ON (vehicle_id) * FROM telemetry_X ORDER BY vehicle_id, time DESC
-- Q2: one vehicle route in a time window
--   SELECT time, latitude, longitude FROM telemetry_X
--   WHERE vehicle_id = 42 AND time > now() - interval '1 day' ORDER BY time
-- Q3: daily average speed for the whole fleet
--   SELECT time_bucket('1 day', time) d, avg(speed_kmh) FROM telemetry_ts GROUP BY d ORDER BY d
--   (vanilla: use date_trunc('day', time))
-- Q4: size comparison
--   SELECT pg_size_pretty(pg_total_relation_size('telemetry_pg'))
--   SELECT pg_size_pretty(hypertable_size('telemetry_ts'))

-- Example dashboard reports: adjust thresholds to match simulator settings.
-- Use telemetry_pg in place of telemetry_ts to compare the baseline database.
-- Values are simulated warning thresholds, not road-specific speed limits.

-- 1. Speeding samples: default limit 80 km/h.
SELECT time, vehicle_id, speed_kmh, latitude, longitude
FROM telemetry_ts
WHERE time >= now() - interval '24 hours' AND speed_kmh > 80
ORDER BY time DESC;

-- 2. Extreme altitude samples: above 300 m or below sea level.
SELECT time, vehicle_id, altitude_m, latitude, longitude
FROM telemetry_ts
WHERE time >= now() - interval '24 hours'
  AND (altitude_m > 300 OR altitude_m < 0)
ORDER BY time DESC;

-- 3. Poor GPS samples: larger error radius means worse accuracy.
SELECT time, vehicle_id, gps_accuracy_m, latitude, longitude
FROM telemetry_ts
WHERE time >= now() - interval '24 hours' AND gps_accuracy_m > 50
ORDER BY time DESC;

-- 4. Contiguous stationary episodes observed for at least 5 minutes.
-- A moving sample or a gap > 2 minutes breaks the episode, avoiding the
-- assumption that a vehicle stayed stopped across missing telemetry.
-- The lookback may truncate episodes that started more than 24 hours ago.
WITH ordered AS (
  SELECT time, vehicle_id, speed_kmh,
         lag(time) OVER w AS previous_time,
         lag(speed_kmh) OVER w AS previous_speed
  FROM telemetry_ts
  WHERE time >= now() - interval '24 hours'
  WINDOW w AS (PARTITION BY vehicle_id ORDER BY time)
), marked AS (
  SELECT *, CASE WHEN previous_time IS NULL OR previous_speed IS NULL
       OR previous_speed > 1 OR time - previous_time > interval '2 minutes'
       THEN 1 ELSE 0 END AS new_episode
  FROM ordered
), grouped AS (
  SELECT *, sum(new_episode) OVER (
    PARTITION BY vehicle_id ORDER BY time ROWS UNBOUNDED PRECEDING
  ) AS episode
  FROM marked
)
SELECT vehicle_id, min(time) AS stopped_from, max(time) AS stopped_to,
       max(time) - min(time) AS observed_stop_duration, count(*) AS samples
FROM grouped WHERE speed_kmh <= 1
GROUP BY vehicle_id, episode
HAVING max(time) - min(time) >= interval '5 minutes'
ORDER BY stopped_to DESC;

export type WarningKind = "speeding" | "longStop" | "altitude" | "poorGps";
export type WarningTarget = "pg" | "ts";
export interface WarningSettings {
  hours: number;
  speedLimit: number;
  stopMinutes: number;
  altitudeLimit: number;
  gpsLimit: number;
  maxGapSeconds: number;
}
export const DEFAULT_WARNING_SETTINGS: WarningSettings = {
  hours: 24,
  speedLimit: 80,
  stopMinutes: 5,
  altitudeLimit: 300,
  gpsLimit: 50,
  maxGapSeconds: 120,
};
export const WARNING_FIELDS = [
  [
    "hours",
    "Lookback (hours)",
    1,
    168,
    "Time window of stored telemetry to inspect. Counts cover this whole window. Stops that began before the window are measured from the first sample inside it.",
  ],
  [
    "speedLimit",
    "Speed limit (km/h)",
    1,
    200,
    "Samples above this configured threshold are speeding warnings. Use the same simulated threshold as the simulator.",
  ],
  [
    "stopMinutes",
    "Stop warning (min)",
    1,
    720,
    "Continuous time with speed at or below 1 km/h needed for a long-stop warning. A moving sample or an excessive telemetry gap starts a new episode.",
  ],
  [
    "altitudeLimit",
    "Altitude limit (m)",
    0,
    9000,
    "Samples above this altitude or below zero are flagged. Set this to match the simulator's altitude warning threshold.",
  ],
  [
    "gpsLimit",
    "GPS error limit (m)",
    1,
    2000,
    "Samples with a GPS error radius above this value are flagged. Larger gps_accuracy_m means worse positioning accuracy.",
  ],
  [
    "maxGapSeconds",
    "Max sample gap (s)",
    1,
    3600,
    "A gap larger than this breaks a stop episode. Warnings are active only if they match the vehicle's latest sample and that sample is this recent. Default: 120 seconds.",
  ],
] as const;
export const WARNING_LABELS: Record<WarningKind, string> = {
  speeding: "Speeding",
  longStop: "Long stops",
  altitude: "Extreme altitude",
  poorGps: "Poor GPS",
};
export interface WarningEntry {
  kind: WarningKind;
  vehicleId: number;
  plate: string;
  startedAt: string;
  endedAt: string;
  value: number;
  threshold: number;
  active: boolean;
  samples: number;
}
export interface WarningReport {
  counts: Record<WarningKind, number>;
  activeCount: number;
  reports: WarningEntry[];
  sampleCount: number;
  latestTime: string | null;
  activeVehicles?: { vehicleId: number; kind: WarningKind }[];
}
export interface WarningResponse {
  serverTime: string;
  windowStart: string;
  settings: WarningSettings;
  reportLimit: number;
  results: Record<
    WarningTarget,
    { report: WarningReport | null; error: string | null }
  >;
}
export function validateWarningSettings(settings: WarningSettings) {
  const errors: Partial<Record<keyof WarningSettings, string>> = {};
  for (const [key, label, min, max] of WARNING_FIELDS)
    if (
      !Number.isInteger(settings[key]) ||
      settings[key] < min ||
      settings[key] > max
    )
      errors[key] = `${label}: enter a whole number from ${min} to ${max}.`;
  return errors;
}
export function warningSql(
  target: WarningTarget,
  settings: WarningSettings,
  now: Date,
) {
  if (target !== "pg" && target !== "ts")
    throw new Error("Invalid warning target");
  if (
    Object.keys(validateWarningSettings(settings)).length ||
    !Number.isFinite(now.getTime())
  )
    throw new Error("Invalid warning settings");
  const table = target === "pg" ? "telemetry_pg" : "telemetry_ts";
  return {
    values: [
      new Date(now.getTime() - settings.hours * 3600000),
      now,
      settings.speedLimit,
      settings.stopMinutes,
      settings.altitudeLimit,
      settings.gpsLimit,
      settings.maxGapSeconds,
    ],
    sql: `WITH base AS MATERIALIZED (
 SELECT time, vehicle_id, speed_kmh, altitude_m, gps_accuracy_m,
        max(time) OVER (PARTITION BY vehicle_id) AS latest_time,
        lag(time) OVER w AS previous_time,
        lag(speed_kmh) OVER w AS previous_speed
 FROM ${table} WHERE time >= $1 AND time <= $2
 WINDOW w AS (PARTITION BY vehicle_id ORDER BY time)
), marked AS (
 SELECT *, CASE WHEN previous_time IS NULL OR previous_speed IS NULL
   OR previous_speed > 1 OR time - previous_time > $7 * interval '1 second'
   THEN 1 ELSE 0 END AS new_episode FROM base
), grouped AS (
 SELECT *, sum(new_episode) OVER (PARTITION BY vehicle_id ORDER BY time ROWS UNBOUNDED PRECEDING) AS episode FROM marked
), stops AS (
 SELECT vehicle_id, min(time) AS started_at, max(time) AS ended_at,
   extract(epoch FROM max(time)-min(time))/60 AS value,
   max(latest_time) AS latest_time, count(*)::integer AS samples
 FROM grouped WHERE speed_kmh <= 1
 GROUP BY vehicle_id, episode
 HAVING max(time)-min(time) >= $4 * interval '1 minute'
), matches AS (
 SELECT 'speeding' AS kind, vehicle_id, time AS started_at, time AS ended_at,
   speed_kmh::double precision AS value, $3::double precision AS threshold,
   (time = latest_time AND time >= $2 - $7 * interval '1 second') AS active, 1 AS samples
 FROM base WHERE speed_kmh > $3
 UNION ALL
 SELECT 'altitude', vehicle_id, time, time, altitude_m::double precision,
   CASE WHEN altitude_m < 0 THEN 0 ELSE $5 END::double precision,
   (time = latest_time AND time >= $2 - $7 * interval '1 second'), 1
 FROM base WHERE altitude_m > $5 OR altitude_m < 0
 UNION ALL
 SELECT 'poorGps', vehicle_id, time, time, gps_accuracy_m::double precision, $6::double precision,
   (time = latest_time AND time >= $2 - $7 * interval '1 second'), 1
 FROM base WHERE gps_accuracy_m > $6
 UNION ALL
 SELECT 'longStop', vehicle_id, started_at, ended_at, value::double precision, $4::double precision,
   (ended_at = latest_time AND ended_at >= $2 - $7 * interval '1 second'), samples FROM stops
), recent AS (
 SELECT m.*, v.plate_number FROM matches m JOIN vehicles v ON v.id = m.vehicle_id
 ORDER BY active DESC, ended_at DESC, vehicle_id, kind LIMIT 200
)
SELECT jsonb_build_object(
 'counts', COALESCE((SELECT jsonb_object_agg(kind,n) FROM (SELECT kind,count(*) AS n FROM matches GROUP BY kind) c),'{}'::jsonb),
 'activeCount', (SELECT count(*) FROM matches WHERE active),
 'activeVehicles', COALESCE((SELECT jsonb_agg(jsonb_build_object('vehicleId',vehicle_id,'kind',kind)) FROM matches WHERE active),'[]'::jsonb),
 'sampleCount', (SELECT count(*) FROM base),
 'latestTime', (SELECT max(time) FROM base),
 'reports', COALESCE((SELECT jsonb_agg(jsonb_build_object('kind',kind,'vehicleId',vehicle_id,'plate',plate_number,'startedAt',started_at,'endedAt',ended_at,'value',value,'threshold',threshold,'active',active,'samples',samples) ORDER BY active DESC,ended_at DESC,vehicle_id,kind) FROM recent),'[]'::jsonb)
) AS report`,
  };
}
export function normalizeWarningReport(
  raw: Partial<WarningReport>,
): WarningReport {
  return {
    ...raw,
    counts: {
      speeding: 0,
      longStop: 0,
      altitude: 0,
      poorGps: 0,
      ...raw.counts,
    },
    activeCount: Number(raw.activeCount || 0),
    sampleCount: Number(raw.sampleCount || 0),
    latestTime: raw.latestTime || null,
    reports: raw.reports || [],
  };
}

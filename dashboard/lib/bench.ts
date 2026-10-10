export type Variant = "pg" | "ts" | "ts_cagg";

export interface QueryDef {
  id: string;
  title: string;
  variants: Variant[];
  buildSql: (
    variant: Variant,
    vid: number | null,
    refTime: Date,
    inline: boolean,
  ) => { sql: string; values: any[] };
}

const tableMap: Record<Variant, string> = {
  pg: "telemetry_pg",
  ts: "telemetry_ts",
  ts_cagg: "telemetry_hourly",
};

function formatVal(val: any, inline: boolean): string {
  if (!inline) return ""; // placeholder logic handled outside if needed
  if (val instanceof Date) {
    if (isNaN(val.getTime())) throw new Error("Invalid date");
    return `CAST('${val.toISOString()}' AS timestamptz)`;
  }
  if (typeof val === "number") {
    if (!Number.isInteger(val)) throw new Error("Value must be integer");
    return val.toString();
  }
  throw new Error("Unsupported inline type");
}

function getTable(variant: Variant) {
  const t = tableMap[variant];
  if (!t) throw new Error("Invalid variant");
  return t;
}

function fleetQuery(
  id: string,
  title: string,
  select: string,
  where = "",
  group = "",
): QueryDef {
  return {
    id,
    title,
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 86400_000);
      const from = inline ? formatVal(start, true) : "$1";
      const end = inline ? formatVal(refTime, true) : "$2";
      return {
        sql: `SELECT ${select} FROM ${getTable(variant)} WHERE time >= ${from} AND time < ${end} ${where} ${group}`,
        values: inline ? [] : [start, refTime],
      };
    },
  };
}
export const QUERY_GUIDES: Record<
  string,
  {
    category: string;
    description: string;
    tests: string;
    output: string;
    window: string;
  }
> = {
  B1: {
    category: "Live tracking",
    description: "Find the newest GPS position for every active vehicle.",
    tests: "Indexed lookup and fleet join",
    output: "One position per active vehicle with data",
    window: "Latest stored",
  },
  B2: {
    category: "Routes",
    description: "Replay a single vehicle route over one hour.",
    tests: "Vehicle + time index and ordered retrieval",
    output: "Ordered GPS points for one vehicle",
    window: "1 hour",
  },
  B3: {
    category: "Routes",
    description: "Replay a full day of a single vehicle route.",
    tests: "Larger time-range scan and ordered retrieval",
    output: "Ordered GPS points for one vehicle",
    window: "1 day",
  },
  B4: {
    category: "Routes",
    description: "Retrieve a week of route history for one vehicle.",
    tests: "Multi-day scan and Timescale chunk pruning",
    output: "Ordered GPS points for one vehicle",
    window: "7 days",
  },
  B5: {
    category: "Fleet summaries",
    description:
      "See which vehicles recently reported data and how fast they moved.",
    tests: "Time filter and per-vehicle grouping",
    output: "Point count, last seen and average speed",
    window: "15 minutes",
  },
  B6: {
    category: "Fleet summaries",
    description: "Compare daily average speeds across the fleet.",
    tests: "Daily time buckets and aggregation",
    output: "One average speed per day",
    window: "7 days",
  },
  B7: {
    category: "Fleet summaries",
    description:
      "Compare raw hourly aggregation against precomputed Timescale summaries.",
    tests: "Raw scans versus continuous aggregate reads",
    output: "One average speed per hour",
    window: "7 days / aggregate coverage",
  },
  B8: {
    category: "Fleet summaries",
    description: "Find each vehicle's highest recorded speed.",
    tests: "Grouped maximum over a broad time window",
    output: "Maximum speed per vehicle",
    window: "7 days",
  },
  B9: {
    category: "Location filters",
    description: "Count GPS samples inside a fixed Jakarta bounding box.",
    tests: "Combined time and latitude/longitude filters",
    output: "Matching point counts per vehicle",
    window: "1 day",
  },
  B10: {
    category: "Rule reporting",
    description: "Count speeding samples above 80 km/h for each vehicle.",
    tests: "Threshold filter and grouped counting",
    output: "Speeding count and peak speed",
    window: "1 day",
  },
  B11: {
    category: "Rule reporting",
    description: "Find vehicles with GPS error above 50 meters.",
    tests: "Data quality filter and grouped maximum",
    output: "Poor GPS count and worst error",
    window: "1 day",
  },
  B12: {
    category: "Rule reporting",
    description: "Find altitude samples above 300 meters or below zero.",
    tests: "Multiple threshold predicates",
    output: "Flagged count and altitude range per vehicle",
    window: "1 day",
  },
  B13: {
    category: "Fleet summaries",
    description: "Measure the fleet's median and 95th percentile speed.",
    tests: "Ordered-set aggregation and sorting",
    output: "Fleet p50 and p95 speed",
    window: "1 day",
  },
  B14: {
    category: "Data quality",
    description: "Detect missing telemetry gaps longer than 120 seconds.",
    tests: "Window functions, vehicle partitioning and sorting",
    output: "Gap count and longest gap per vehicle",
    window: "1 day / gaps within window",
  },
};
export const CATALOG: QueryDef[] = [
  {
    id: "B1",
    title: "Latest position per vehicle",
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const t = getTable(variant);
      return {
        sql: `SELECT v.id AS vehicle_id, l.time, l.latitude, l.longitude, l.speed_kmh
FROM vehicles v
CROSS JOIN LATERAL (
  SELECT t.time, t.latitude, t.longitude, t.speed_kmh
  FROM ${t} t WHERE t.vehicle_id = v.id AND t.time < ${inline ? formatVal(refTime, true) : "$1"} ORDER BY t.time DESC LIMIT 1
) l
WHERE v.is_active`,
        values: inline ? [] : [refTime],
      };
    },
  },
  {
    id: "B2",
    title: "One vehicle route, 1 hour",
    variants: ["pg", "ts"],
    buildSql: (variant, vid, refTime, inline) => {
      if (vid == null) throw new Error("vid required");
      const start = new Date(refTime.getTime() - 3600_000);
      const t = getTable(variant);
      if (inline) {
        return {
          sql: `SELECT time, latitude, longitude FROM ${t} WHERE vehicle_id = ${formatVal(vid, true)} AND time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} ORDER BY time`,
          values: [],
        };
      }
      return {
        sql: `SELECT time, latitude, longitude FROM ${t} WHERE vehicle_id = $1 AND time >= $2 AND time < $3 ORDER BY time`,
        values: [vid, start, refTime],
      };
    },
  },
  {
    id: "B3",
    title: "One vehicle route, 1 day",
    variants: ["pg", "ts"],
    buildSql: (variant, vid, refTime, inline) => {
      if (vid == null) throw new Error("vid required");
      const start = new Date(refTime.getTime() - 86400_000);
      const t = getTable(variant);
      if (inline) {
        return {
          sql: `SELECT time, latitude, longitude FROM ${t} WHERE vehicle_id = ${formatVal(vid, true)} AND time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} ORDER BY time`,
          values: [],
        };
      }
      return {
        sql: `SELECT time, latitude, longitude FROM ${t} WHERE vehicle_id = $1 AND time >= $2 AND time < $3 ORDER BY time`,
        values: [vid, start, refTime],
      };
    },
  },
  {
    id: "B4",
    title: "One vehicle route, 7 days",
    variants: ["pg", "ts"],
    buildSql: (variant, vid, refTime, inline) => {
      if (vid == null) throw new Error("vid required");
      const start = new Date(refTime.getTime() - 7 * 86400_000);
      const t = getTable(variant);
      if (inline) {
        return {
          sql: `SELECT time, latitude, longitude FROM ${t} WHERE vehicle_id = ${formatVal(vid, true)} AND time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} ORDER BY time`,
          values: [],
        };
      }
      return {
        sql: `SELECT time, latitude, longitude FROM ${t} WHERE vehicle_id = $1 AND time >= $2 AND time < $3 ORDER BY time`,
        values: [vid, start, refTime],
      };
    },
  },
  {
    id: "B5",
    title: "Fleet activity, last 15 minutes",
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 15 * 60_000);
      const t = getTable(variant);
      if (inline) {
        return {
          sql: `SELECT vehicle_id, count(*) AS points, max(time) AS last_seen, avg(speed_kmh) AS avg_speed FROM ${t} WHERE time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} GROUP BY vehicle_id ORDER BY vehicle_id`,
          values: [],
        };
      }
      return {
        sql: `SELECT vehicle_id, count(*) AS points, max(time) AS last_seen, avg(speed_kmh) AS avg_speed FROM ${t} WHERE time >= $1 AND time < $2 GROUP BY vehicle_id ORDER BY vehicle_id`,
        values: [start, refTime],
      };
    },
  },
  {
    id: "B6",
    title: "Fleet daily average speed, 7 days",
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 7 * 86400_000);
      const t = getTable(variant);
      const bucketDay =
        variant === "pg"
          ? "date_trunc('day', time)"
          : "time_bucket('1 day', time)";
      if (inline) {
        return {
          sql: `SELECT ${bucketDay} AS bucket, avg(speed_kmh) AS avg_speed FROM ${t} WHERE time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} GROUP BY 1 ORDER BY 1`,
          values: [],
        };
      }
      return {
        sql: `SELECT ${bucketDay} AS bucket, avg(speed_kmh) AS avg_speed FROM ${t} WHERE time >= $1 AND time < $2 GROUP BY 1 ORDER BY 1`,
        values: [start, refTime],
      };
    },
  },
  {
    id: "B7",
    title: "Fleet hourly average speed, 7 days",
    variants: ["pg", "ts", "ts_cagg"],
    buildSql: (variant, _vid, refTime, inline) => {
      // B7 requires window clamp logic via DB, here we assume refTime is the already clamped `end` and start = end - 7d.
      // Wait, bench API handles the clamp and passes `end` as refTime, start as `end - 7d`.
      const end = refTime;
      const start = new Date(end.getTime() - 7 * 86400_000);
      const t = getTable(variant);
      if (variant === "ts_cagg") {
        if (inline) {
          return {
            sql: `SELECT bucket, sum(avg_speed * point_count) / sum(point_count) AS avg_speed FROM ${t} WHERE bucket >= ${formatVal(start, true)} AND bucket < ${formatVal(end, true)} GROUP BY bucket ORDER BY bucket`,
            values: [],
          };
        }
        return {
          sql: `SELECT bucket, sum(avg_speed * point_count) / sum(point_count) AS avg_speed FROM ${t} WHERE bucket >= $1 AND bucket < $2 GROUP BY bucket ORDER BY bucket`,
          values: [start, end],
        };
      }
      const bucketHour =
        variant === "pg"
          ? "date_trunc('hour', time)"
          : "time_bucket('1 hour', time)";
      if (inline) {
        return {
          sql: `SELECT ${bucketHour} AS bucket, avg(speed_kmh) AS avg_speed FROM ${t} WHERE time >= ${formatVal(start, true)} AND time < ${formatVal(end, true)} GROUP BY 1 ORDER BY 1`,
          values: [],
        };
      }
      return {
        sql: `SELECT ${bucketHour} AS bucket, avg(speed_kmh) AS avg_speed FROM ${t} WHERE time >= $1 AND time < $2 GROUP BY 1 ORDER BY 1`,
        values: [start, end],
      };
    },
  },
  {
    id: "B8",
    title: "Maximum speed per vehicle, 7 days",
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 7 * 86400_000);
      const t = getTable(variant);
      if (inline) {
        return {
          sql: `SELECT vehicle_id, max(speed_kmh) AS max_speed FROM ${t} WHERE time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} GROUP BY vehicle_id ORDER BY vehicle_id`,
          values: [],
        };
      }
      return {
        sql: `SELECT vehicle_id, max(speed_kmh) AS max_speed FROM ${t} WHERE time >= $1 AND time < $2 GROUP BY vehicle_id ORDER BY vehicle_id`,
        values: [start, refTime],
      };
    },
  },
  {
    id: "B9",
    title: "Points inside a bounding box, 1 day",
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 86400_000);
      const t = getTable(variant);
      if (inline) {
        return {
          sql: `SELECT vehicle_id, count(*) AS points FROM ${t} WHERE time >= ${formatVal(start, true)} AND time < ${formatVal(refTime, true)} AND latitude BETWEEN -6.25 AND -6.15 AND longitude BETWEEN 106.75 AND 106.85 GROUP BY vehicle_id ORDER BY vehicle_id`,
          values: [],
        };
      }
      return {
        sql: `SELECT vehicle_id, count(*) AS points FROM ${t} WHERE time >= $1 AND time < $2 AND latitude BETWEEN -6.25 AND -6.15 AND longitude BETWEEN 106.75 AND 106.85 GROUP BY vehicle_id ORDER BY vehicle_id`,
        values: [start, refTime],
      };
    },
  },
];

CATALOG.push(
  fleetQuery(
    "B10",
    "Speeding violations per vehicle",
    "vehicle_id, count(*) AS violations, max(speed_kmh) AS peak_speed",
    "AND speed_kmh > 80",
    "GROUP BY vehicle_id ORDER BY vehicle_id",
  ),
  fleetQuery(
    "B11",
    "Poor GPS accuracy per vehicle",
    "vehicle_id, count(*) AS violations, max(gps_accuracy_m) AS worst_error_m",
    "AND gps_accuracy_m > 50",
    "GROUP BY vehicle_id ORDER BY vehicle_id",
  ),
  fleetQuery(
    "B12",
    "Extreme altitude per vehicle",
    "vehicle_id, count(*) AS violations, min(altitude_m) AS min_altitude, max(altitude_m) AS max_altitude",
    "AND (altitude_m > 300 OR altitude_m < 0)",
    "GROUP BY vehicle_id ORDER BY vehicle_id",
  ),
  fleetQuery(
    "B13",
    "Fleet speed percentiles",
    "percentile_cont(0.5) WITHIN GROUP (ORDER BY speed_kmh) AS p50_speed, percentile_cont(0.95) WITHIN GROUP (ORDER BY speed_kmh) AS p95_speed",
  ),
  {
    id: "B14",
    title: "Telemetry gaps per vehicle",
    variants: ["pg", "ts"],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 86400_000);
      const from = inline ? formatVal(start, true) : "$1";
      const end = inline ? formatVal(refTime, true) : "$2";
      return {
        sql: `WITH gaps AS (SELECT vehicle_id, time - lag(time) OVER (PARTITION BY vehicle_id ORDER BY time) AS gap FROM ${getTable(variant)} WHERE time >= ${from} AND time < ${end}) SELECT vehicle_id,count(*) AS gap_count, extract(epoch FROM max(gap)) AS longest_gap_seconds FROM gaps WHERE gap > interval '120 seconds' GROUP BY vehicle_id ORDER BY vehicle_id`,
        values: inline ? [] : [start, refTime],
      };
    },
  },
);

export function getQueryDef(queryId: string): QueryDef {
  const q = CATALOG.find((x) => x.id === queryId);
  if (!q) throw new Error("Invalid queryId");
  return q;
}

export function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

export function parsePlanJson(planRaw: string | any[]): {
  executionMs: number;
  planningMs: number;
  rowsReturned: number;
  sharedHit: number;
  sharedRead: number;
  chunksScanned: number | null;
  inputRows?: number;
} {
  const planArray = typeof planRaw === "string" ? JSON.parse(planRaw) : planRaw;
  const plan = planArray[0];
  const executionMs = plan["Execution Time"];
  const planningMs = plan["Planning Time"];
  const top = plan["Plan"];
  const rowsReturned = top["Actual Rows"] || 0;
  const sharedHit = top["Shared Hit Blocks"] || 0;
  const sharedRead = top["Shared Read Blocks"] || 0;
  let inputRows = 0;
  let foundInput = false;
  const scan = (node: Record<string, any>) => {
    if (
      typeof node["Relation Name"] === "string" &&
      /^(telemetry_(pg|ts|hourly)|_hyper_)/.test(node["Relation Name"])
    ) {
      foundInput = true;
      inputRows += (node["Actual Rows"] || 0) * (node["Actual Loops"] || 0);
    }
    for (const child of node.Plans || []) scan(child);
  };
  scan(top);

  let chunksScanned = 0;
  let hasChunks = false;
  const str = JSON.stringify(planArray);
  // Match distinct relation names matching ^_hyper_\d+_\d+_chunk$
  const regex = /"_hyper_\d+_\d+_chunk"/g;
  const matches = str.match(regex);
  if (matches) {
    const unique = new Set(matches);
    chunksScanned = unique.size;
    hasChunks = true;
  }
  return {
    executionMs,
    planningMs,
    rowsReturned,
    sharedHit,
    sharedRead,
    chunksScanned: hasChunks ? chunksScanned : null,
    ...(foundInput ? { inputRows } : {}),
  };
}

export function parsePlanTextChunks(text: string): number | null {
  const regex = /_hyper_\d+_\d+_chunk/g;
  const matches = text.match(regex);
  if (!matches) return null;
  return new Set(matches).size;
}

export function checkRowCountMismatch(
  variants: { variant: Variant; rowsReturned: number }[],
): boolean {
  if (variants.length <= 1) return false;
  const first = variants[0].rowsReturned;
  return variants.some((v) => v.rowsReturned !== first);
}

export function computeB7Window(
  refTime: Date,
  aggMin: Date | null,
  aggMax: Date | null,
): { start: Date; end: Date; error: string | null; note: string | null } {
  const floorRef = new Date(refTime);
  floorRef.setUTCMinutes(0, 0, 0);

  if (!aggMin || !aggMax) {
    return {
      start: floorRef,
      end: floorRef,
      error:
        "continuous aggregate does not cover the window, refresh it (see db/experiments.sql)",
      note: null,
    };
  }

  const end = new Date(Math.min(floorRef.getTime(), aggMax.getTime()));
  const start = new Date(end.getTime() - 7 * 86400_000);

  if (
    aggMin.getTime() > start.getTime() ||
    end.getTime() - start.getTime() < 86400_000
  ) {
    return {
      start,
      end,
      error:
        "continuous aggregate does not cover the window, refresh it (see db/experiments.sql)",
      note: null,
    };
  }

  let note = null;
  if (end.getTime() < floorRef.getTime()) {
    note = `window end clamped to aggregate coverage: ${end.toISOString()}`;
  }

  return { start, end, error: null, note };
}

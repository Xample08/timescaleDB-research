export type Variant = 'pg' | 'ts' | 'ts_cagg';

export interface QueryDef {
  id: string;
  title: string;
  variants: Variant[];
  buildSql: (
    variant: Variant,
    vid: number | null,
    refTime: Date,
    inline: boolean
  ) => { sql: string; values: any[] };
}

const tableMap: Record<Variant, string> = {
  pg: 'telemetry_pg',
  ts: 'telemetry_ts',
  ts_cagg: 'telemetry_hourly',
};

function formatVal(val: any, inline: boolean): string {
  if (!inline) return ''; // placeholder logic handled outside if needed
  if (val instanceof Date) {
    if (isNaN(val.getTime())) throw new Error('Invalid date');
    return `CAST('${val.toISOString()}' AS timestamptz)`;
  }
  if (typeof val === 'number') {
    if (!Number.isInteger(val)) throw new Error('Value must be integer');
    return val.toString();
  }
  throw new Error('Unsupported inline type');
}

function getTable(variant: Variant) {
  const t = tableMap[variant];
  if (!t) throw new Error('Invalid variant');
  return t;
}

export const CATALOG: QueryDef[] = [
  {
    id: 'B1',
    title: 'Latest position per vehicle',
    variants: ['pg', 'ts'],
    buildSql: (variant) => {
      const t = getTable(variant);
      return {
        sql: `SELECT v.id AS vehicle_id, l.time, l.latitude, l.longitude, l.speed_kmh
FROM vehicles v
CROSS JOIN LATERAL (
  SELECT t.time, t.latitude, t.longitude, t.speed_kmh
  FROM ${t} t WHERE t.vehicle_id = v.id ORDER BY t.time DESC LIMIT 1
) l
WHERE v.is_active`,
        values: [],
      };
    },
  },
  {
    id: 'B2',
    title: 'One vehicle route, 1 hour',
    variants: ['pg', 'ts'],
    buildSql: (variant, vid, refTime, inline) => {
      if (vid == null) throw new Error('vid required');
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
    id: 'B3',
    title: 'One vehicle route, 1 day',
    variants: ['pg', 'ts'],
    buildSql: (variant, vid, refTime, inline) => {
      if (vid == null) throw new Error('vid required');
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
    id: 'B4',
    title: 'One vehicle route, 7 days',
    variants: ['pg', 'ts'],
    buildSql: (variant, vid, refTime, inline) => {
      if (vid == null) throw new Error('vid required');
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
    id: 'B5',
    title: 'Fleet activity, last 15 minutes',
    variants: ['pg', 'ts'],
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
    id: 'B6',
    title: 'Fleet daily average speed, 7 days',
    variants: ['pg', 'ts'],
    buildSql: (variant, _vid, refTime, inline) => {
      const start = new Date(refTime.getTime() - 7 * 86400_000);
      const t = getTable(variant);
      const bucketDay = variant === 'pg' ? "date_trunc('day', time)" : "time_bucket('1 day', time)";
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
    id: 'B7',
    title: 'Fleet hourly average speed, 7 days',
    variants: ['pg', 'ts', 'ts_cagg'],
    buildSql: (variant, _vid, refTime, inline) => {
      // B7 requires window clamp logic via DB, here we assume refTime is the already clamped `end` and start = end - 7d.
      // Wait, bench API handles the clamp and passes `end` as refTime, start as `end - 7d`.
      const end = refTime;
      const start = new Date(end.getTime() - 7 * 86400_000);
      const t = getTable(variant);
      if (variant === 'ts_cagg') {
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
      const bucketHour = variant === 'pg' ? "date_trunc('hour', time)" : "time_bucket('1 hour', time)";
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
    id: 'B8',
    title: 'Maximum speed per vehicle, 7 days',
    variants: ['pg', 'ts'],
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
    id: 'B9',
    title: 'Points inside a bounding box, 1 day',
    variants: ['pg', 'ts'],
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
  }
];

export function getQueryDef(queryId: string): QueryDef {
  const q = CATALOG.find(x => x.id === queryId);
  if (!q) throw new Error('Invalid queryId');
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
} {
  const planArray = typeof planRaw === 'string' ? JSON.parse(planRaw) : planRaw;
  const plan = planArray[0];
  const executionMs = plan['Execution Time'];
  const planningMs = plan['Planning Time'];
  const top = plan['Plan'];
  const rowsReturned = top['Actual Rows'] || 0;
  const sharedHit = top['Shared Hit Blocks'] || 0;
  const sharedRead = top['Shared Read Blocks'] || 0;

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
  };
}

export function parsePlanTextChunks(text: string): number | null {
  const regex = /_hyper_\d+_\d+_chunk/g;
  const matches = text.match(regex);
  if (!matches) return null;
  return new Set(matches).size;
}

export function checkRowCountMismatch(variants: { variant: Variant, rowsReturned: number }[]): boolean {
  if (variants.length <= 1) return false;
  const first = variants[0].rowsReturned;
  return variants.some(v => v.rowsReturned !== first);
}

export function computeB7Window(
  refTime: Date,
  aggMin: Date | null,
  aggMax: Date | null
): { start: Date; end: Date; error: string | null; note: string | null } {
  const floorRef = new Date(refTime);
  floorRef.setMinutes(0, 0, 0);

  if (!aggMin || !aggMax) {
    return { start: floorRef, end: floorRef, error: "continuous aggregate does not cover the window, refresh it (see db/experiments.sql)", note: null };
  }

  const end = new Date(Math.min(floorRef.getTime(), aggMax.getTime()));
  const start = new Date(end.getTime() - 7 * 86400_000);

  if (aggMin.getTime() > start.getTime() || (end.getTime() - start.getTime()) < 86400_000) {
     return { start, end, error: "continuous aggregate does not cover the window, refresh it (see db/experiments.sql)", note: null };
  }
  
  let note = null;
  if (end.getTime() < floorRef.getTime()) {
    note = `window end clamped to aggregate coverage: ${end.toISOString()}`;
  }

  return { start, end, error: null, note };
}


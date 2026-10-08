import { withReadOnlyClient, formatError } from "@/lib/db";
import {
  warningSql,
  DEFAULT_WARNING_SETTINGS,
  normalizeWarningReport,
} from "@/lib/warnings";
import { withSqlStream } from "@/lib/sql-trace";
import type { FleetReport } from "@/lib/fleet";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: Request) {
  return withSqlStream(req, async () => {
    const target = new URL(req.url).searchParams.get("target");
    if (target !== "pg" && target !== "ts")
      return Response.json({ error: "Select pg or ts" }, { status: 422 });
    const table = target === "pg" ? "telemetry_pg" : "telemetry_ts";
    const now = new Date();
    const start = new Date(now.getTime() - 86400000);
    try {
      return await withReadOnlyClient(async (client) => {
        const vehicles = await client.query(
          `SELECT v.id, v.plate_number AS plate, v.name, v.vehicle_type AS type,
    t.time, t.latitude, t.longitude, t.speed_kmh AS speed, t.heading_deg AS heading, t.altitude_m AS altitude, t.gps_accuracy_m AS gps
    FROM vehicles v LEFT JOIN LATERAL (SELECT * FROM ${table} WHERE vehicle_id=v.id AND time <= $1 ORDER BY time DESC LIMIT 1) t ON true ORDER BY v.id`,
          [now],
        );
        const summary = await client.query(
          `SELECT count(*)::integer AS samples, avg(speed_kmh) AS "avgSpeed", max(speed_kmh) AS "maxSpeed", avg(gps_accuracy_m) AS "avgGps", min(altitude_m) AS "minAltitude", max(altitude_m) AS "maxAltitude" FROM ${table} WHERE time >= $1 AND time <= $2`,
          [start, now],
        );
        const hourly = await client.query(
          `SELECT date_trunc('hour',time) AS time,count(*)::integer AS samples,avg(speed_kmh) AS speed FROM ${table} WHERE time >= $1 AND time <= $2 GROUP BY 1 ORDER BY 1`,
          [start, now],
        );
        const query = warningSql(target, DEFAULT_WARNING_SETTINGS, now);
        const warnings = await client.query(query.sql, query.values);
        return Response.json({
          target,
          checkedAt: now.toISOString(),
          windowStart: start.toISOString(),
          vehicles: vehicles.rows,
          summary: summary.rows[0],
          hourly: hourly.rows,
          warnings: normalizeWarningReport(warnings.rows[0].report),
        } satisfies FleetReport);
      });
    } catch (error) {
      return Response.json({ error: formatError(error) }, { status: 500 });
    }
  });
}

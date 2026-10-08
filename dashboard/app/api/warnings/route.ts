import { NextResponse } from "next/server";
import { withReadOnlyClient, formatError } from "@/lib/db";
import { withSqlStream } from "@/lib/sql-trace";
import {
  DEFAULT_WARNING_SETTINGS,
  WARNING_FIELDS,
  validateWarningSettings,
  warningSql,
  normalizeWarningReport,
  WarningSettings,
  WarningResponse,
} from "@/lib/warnings";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
async function run(req: Request) {
  const params = new URL(req.url).searchParams;
  const settings = { ...DEFAULT_WARNING_SETTINGS };
  for (const [key] of WARNING_FIELDS)
    if (params.has(key))
      settings[key] = params.get(key)?.trim() ? Number(params.get(key)) : NaN;
  const errors = validateWarningSettings(settings);
  if (Object.keys(errors).length)
    return NextResponse.json(
      { error: "Invalid warning thresholds", fields: errors },
      { status: 422 },
    );
  const now = new Date();
  try {
    return await withReadOnlyClient(async (client) => {
      const results: WarningResponse["results"] = {
        pg: { report: null, error: null },
        ts: { report: null, error: null },
      };
      for (const target of ["pg", "ts"] as const) {
        await client.query("SAVEPOINT warning_target");
        try {
          const { sql, values } = warningSql(
            target,
            settings as WarningSettings,
            now,
          );
          const response = await client.query(sql, values);
          results[target].report = normalizeWarningReport(
            response.rows[0]?.report || {},
          );
          await client.query("RELEASE SAVEPOINT warning_target");
        } catch (error) {
          await client.query("ROLLBACK TO SAVEPOINT warning_target");
          await client.query("RELEASE SAVEPOINT warning_target");
          results[target].error = formatError(error);
        }
      }
      return NextResponse.json({
        serverTime: now.toISOString(),
        windowStart: new Date(
          now.getTime() - settings.hours * 3600000,
        ).toISOString(),
        settings,
        reportLimit: 200,
        results,
      } satisfies WarningResponse);
    });
  } catch (error) {
    return NextResponse.json({ error: formatError(error) }, { status: 500 });
  }
}
export async function GET(req: Request) {
  return withSqlStream(req, () => run(req));
}

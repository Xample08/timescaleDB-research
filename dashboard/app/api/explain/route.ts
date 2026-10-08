import { withSqlStream } from "@/lib/sql-trace";
import { NextResponse } from "next/server";
import { withReadOnlyClient, formatError } from "@/lib/db";
import { getQueryDef, parsePlanTextChunks, computeB7Window } from "@/lib/bench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runGET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const queryId = searchParams.get("queryId");
    const vehicleIdParam = searchParams.get("vehicleId");
    const refTimeParam = searchParams.get("refTime");

    if (!queryId)
      return NextResponse.json({ error: "missing queryId" }, { status: 422 });
    const queryDef = getQueryDef(queryId);

    const vehicleId = vehicleIdParam ? parseInt(vehicleIdParam, 10) : null;
    const refTime = refTimeParam ? new Date(refTimeParam) : new Date();

    return await withReadOnlyClient(async (client) => {
      let b7error = null;
      let safeRefTimeForB7 = refTime;

      if (queryId === "B7") {
        const aggBounds = await client.query(
          "SELECT min(bucket) as min_b, max(bucket) as max_b FROM telemetry_hourly",
        );
        const minB = aggBounds.rows[0]?.min_b
          ? new Date(aggBounds.rows[0].min_b)
          : null;
        const maxB = aggBounds.rows[0]?.max_b
          ? new Date(aggBounds.rows[0].max_b)
          : null;
        const check = computeB7Window(refTime, minB, maxB);
        if (check.error) {
          b7error = check.error;
        } else {
          safeRefTimeForB7 = check.end;
        }
      }

      // We need to find chunksTotal for the hypertable
      const chunksRes = await client.query(
        `SELECT count(*) AS total FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_ts'`,
      );
      const chunksTotal = parseInt(chunksRes.rows[0]?.total || "0", 10);

      const variantsObj: Record<string, any> = {};

      for (const variant of queryDef.variants) {
        if (b7error) {
          variantsObj[variant] = { text: b7error, chunksScanned: null };
          continue;
        }

        try {
          // true flag for inlining
          const { sql } = queryDef.buildSql(
            variant,
            vehicleId,
            queryId === "B7" ? safeRefTimeForB7 : refTime,
            true,
          );
          const explainSql = `EXPLAIN (ANALYZE, BUFFERS) ${sql}`;
          const res = await client.query(explainSql);

          const textLines = res.rows.map((r) => r["QUERY PLAN"]);
          const text = textLines.join("\n");
          const chunksScanned =
            variant === "ts" ? parsePlanTextChunks(text) : null;

          variantsObj[variant] = {
            text,
            chunksScanned,
          };
        } catch (err) {
          variantsObj[variant] = {
            text: formatError(err),
            chunksScanned: null,
          };
        }
      }

      return NextResponse.json({
        chunksTotal,
        variants: variantsObj,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message?.substring(0, 200) },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return withSqlStream(req, () => runGET(req));
}

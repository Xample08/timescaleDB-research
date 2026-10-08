import { withSqlStream } from "@/lib/sql-trace";
import { NextResponse } from "next/server";
import { withReadOnlyClient, formatError } from "@/lib/db";
import {
  getQueryDef,
  parsePlanJson,
  computeB7Window,
  Variant,
} from "@/lib/bench";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function runPOST(req: Request) {
  try {
    const body = await req.json();
    const {
      queryId,
      variants,
      refTime: bodyRefTime,
      vehicleId: bodyVehicleId,
    } = body;

    const queryDef = getQueryDef(queryId);
    if (!variants || !Array.isArray(variants) || variants.length === 0) {
      return NextResponse.json({ error: "invalid variants" }, { status: 422 });
    }
    for (const v of variants) {
      if (!queryDef.variants.includes(v)) {
        return NextResponse.json(
          { error: `invalid variant ${v}` },
          { status: 422 },
        );
      }
    }

    return await withReadOnlyClient(async (client) => {
      let refTimeStr = bodyRefTime;
      if (!refTimeStr) {
        const latestPg = await client.query(
          `SELECT max(time) AS max_time FROM telemetry_pg`,
        );
        const latestTs = await client.query(
          `SELECT max(time) AS max_time FROM telemetry_ts`,
        );
        const pgMax = latestPg.rows[0]?.max_time
          ? new Date(latestPg.rows[0].max_time)
          : null;
        const tsMax = latestTs.rows[0]?.max_time
          ? new Date(latestTs.rows[0].max_time)
          : null;
        if (pgMax && tsMax) {
          refTimeStr = new Date(
            Math.min(pgMax.getTime(), tsMax.getTime()) - 5000,
          ).toISOString();
        } else {
          refTimeStr = new Date().toISOString();
        }
      }
      const refTime = new Date(refTimeStr);

      let vehicleId = bodyVehicleId;
      if (vehicleId == null) {
        const vRes = await client.query(
          "SELECT id FROM vehicles WHERE is_active = true ORDER BY id LIMIT 1",
        );
        if (vRes.rows.length > 0) vehicleId = vRes.rows[0].id;
      }

      let b7note = null;
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
          b7note = check.note;
          safeRefTimeForB7 = check.end; // pass end as refTime
        }
      }

      const results = [];
      for (const variant of variants) {
        if (b7error) {
          results.push({
            variant,
            executionMs: 0,
            planningMs: 0,
            rowsReturned: 0,
            sharedHit: 0,
            sharedRead: 0,
            chunksScanned: null,
            error: b7error,
          });
          continue;
        }

        try {
          const { sql, values } = queryDef.buildSql(
            variant as Variant,
            vehicleId,
            queryId === "B7" ? safeRefTimeForB7 : refTime,
            false,
          );

          const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}`;
          const res = await client.query(explainSql, values);

          // Postgres plan can be returned as object or string.
          // Usually 'EXPLAIN FORMAT JSON' returns an array inside the row.
          const planData = res.rows[0]["QUERY PLAN"];
          const parsed = parsePlanJson(planData);

          results.push({
            variant,
            ...parsed,
            error: null,
          });
        } catch (err) {
          results.push({
            variant,
            executionMs: 0,
            planningMs: 0,
            rowsReturned: 0,
            sharedHit: 0,
            sharedRead: 0,
            chunksScanned: null,
            error: formatError(err),
          });
        }
      }

      return NextResponse.json({
        queryId,
        refTime: refTimeStr,
        note: b7note,
        results,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message?.substring(0, 200) },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return withSqlStream(req, () => runPOST(req));
}

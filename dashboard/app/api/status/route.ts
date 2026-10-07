import { NextResponse } from 'next/server';
import { withReadOnlyClient } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return await withReadOnlyClient(async (client) => {
      const serverTime = new Date().toISOString();

      const extRes = await client.query("SELECT extversion FROM pg_extension WHERE extname = 'timescaledb'");
      const timescaleVersion = extRes.rows[0]?.extversion || 'unknown';

      const approxPg = await client.query("SELECT approximate_row_count('telemetry_pg') AS count");
      const approxTs = await client.query("SELECT approximate_row_count('telemetry_ts') AS count");

      const chunksRes = await client.query(`
        SELECT count(*) AS total, count(*) FILTER (WHERE is_compressed) AS compressed
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'telemetry_ts'
      `);

      const ingestPg = await client.query(`
        SELECT count(*) AS count FROM telemetry_pg WHERE time >= now() - interval '30 seconds'
      `);
      const ingestTs = await client.query(`
        SELECT count(*) AS count FROM telemetry_ts WHERE time >= now() - interval '30 seconds'
      `);

      const latestPg = await client.query(`SELECT max(time) AS max_time FROM telemetry_pg`);
      const latestTs = await client.query(`SELECT max(time) AS max_time FROM telemetry_ts`);

      const vehiclesRes = await client.query(`
        SELECT id, name FROM vehicles WHERE is_active = true ORDER BY id LIMIT 200
      `);

      const pgMax = latestPg.rows[0]?.max_time ? new Date(latestPg.rows[0].max_time) : null;
      const tsMax = latestTs.rows[0]?.max_time ? new Date(latestTs.rows[0].max_time) : null;
      
      const pgMaxVal = pgMax?.getTime() || 0;
      const tsMaxVal = tsMax?.getTime() || 0;
      const newestVal = Math.max(pgMaxVal, tsMaxVal);
      const ageSeconds = newestVal ? Math.floor((Date.now() - newestVal) / 1000) : 0;
      
      let safeReferenceTime = serverTime;
      if (pgMax && tsMax) {
        const minVal = Math.min(pgMax.getTime(), tsMax.getTime());
        safeReferenceTime = new Date(minVal - 5000).toISOString();
      }

      return NextResponse.json({
        serverTime,
        timescaleVersion,
        approxRows: {
          pg: parseInt(approxPg.rows[0]?.count || '0', 10),
          ts: parseInt(approxTs.rows[0]?.count || '0', 10),
        },
        chunks: {
          total: parseInt(chunksRes.rows[0]?.total || '0', 10),
          compressed: parseInt(chunksRes.rows[0]?.compressed || '0', 10),
        },
        ingest: {
          windowSeconds: 30,
          pgRowsPerSecond: Math.round(parseInt(ingestPg.rows[0]?.count || '0', 10) / 30),
          tsRowsPerSecond: Math.round(parseInt(ingestTs.rows[0]?.count || '0', 10) / 30),
        },
        latest: {
          pg: pgMax?.toISOString() || null,
          ts: tsMax?.toISOString() || null,
          ageSeconds,
        },
        safeReferenceTime,
        vehicles: vehiclesRes.rows,
      });
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message?.substring(0, 200) }, { status: 500 });
  }
}

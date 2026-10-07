import { NextResponse } from 'next/server';
import { withReadOnlyClient } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    return await withReadOnlyClient(async (client) => {
      // PG sizes
      const pgSizes = await client.query(`
        SELECT 
          pg_total_relation_size('telemetry_pg') AS total,
          pg_relation_size('telemetry_pg') AS table,
          pg_indexes_size('telemetry_pg') AS index
      `);

      // TS detailed size
      const tsSizes = await client.query(`
        SELECT total_bytes, table_bytes, index_bytes, toast_bytes
        FROM hypertable_detailed_size('telemetry_ts')
      `);

      // TS compression stats
      let beforeCompressionBytes = null;
      let afterCompressionBytes = null;
      let compressionRatio = null;
      try {
        const tsComp = await client.query(`
          SELECT before_compression_total_bytes, after_compression_total_bytes
          FROM hypertable_compression_stats('telemetry_ts')
        `);
        if (tsComp.rows.length > 0) {
          const before = parseInt(tsComp.rows[0].before_compression_total_bytes || '0', 10);
          const after = parseInt(tsComp.rows[0].after_compression_total_bytes || '0', 10);
          if (before > 0 && after > 0) {
            beforeCompressionBytes = before;
            afterCompressionBytes = after;
            compressionRatio = before / after;
          }
        }
      } catch {
        // ignore if not available
      }

      // Chunks
      const chunksQuery = await client.query(`
        SELECT 
          c.chunk_name AS name,
          c.range_start,
          c.range_end,
          c.is_compressed,
          s.total_bytes
        FROM timescaledb_information.chunks c
        LEFT JOIN chunks_detailed_size('telemetry_ts') s 
          ON c.chunk_schema = s.chunk_schema AND c.chunk_name = s.chunk_name
        WHERE c.hypertable_name = 'telemetry_ts'
        ORDER BY c.range_start DESC
        LIMIT 100
      `);

      const chunks = chunksQuery.rows.map(r => ({
        name: r.name,
        rangeStart: r.range_start ? new Date(r.range_start).toISOString() : null,
        rangeEnd: r.range_end ? new Date(r.range_end).toISOString() : null,
        isCompressed: !!r.is_compressed,
        totalBytes: parseInt(r.total_bytes || '0', 10),
      }));

      return NextResponse.json({
        pg: {
          totalBytes: parseInt(pgSizes.rows[0]?.total || '0', 10),
          tableBytes: parseInt(pgSizes.rows[0]?.table || '0', 10),
          indexBytes: parseInt(pgSizes.rows[0]?.index || '0', 10),
        },
        ts: {
          totalBytes: parseInt(tsSizes.rows[0]?.total_bytes || '0', 10),
          tableBytes: parseInt(tsSizes.rows[0]?.table_bytes || '0', 10),
          indexBytes: parseInt(tsSizes.rows[0]?.index_bytes || '0', 10),
          toastBytes: parseInt(tsSizes.rows[0]?.toast_bytes || '0', 10),
          beforeCompressionBytes,
          afterCompressionBytes,
          compressionRatio,
        },
        chunks,
      });
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message?.substring(0, 200) }, { status: 500 });
  }
}

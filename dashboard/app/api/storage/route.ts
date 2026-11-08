import { withSqlStream } from "@/lib/sql-trace";
import { NextResponse } from "next/server";
import { withReadOnlyClient, withClient } from "@/lib/db";
import { reconstructBeforeStorage, storageSize } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runGET() {
  try {
    return await withReadOnlyClient(async (client) => {
      await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
      // PG sizes
      const pgSizes = await client.query(`
        SELECT 
          pg_total_relation_size('public.telemetry_pg') AS total,
          pg_indexes_size('public.telemetry_pg') AS index
      `);

      // TS detailed size
      const tsSizes = await client.query(`
        SELECT total_bytes, index_bytes, toast_bytes,
          pg_total_relation_size('public.telemetry_ts') AS parent_total_bytes,
          pg_indexes_size('public.telemetry_ts') AS parent_index_bytes
        FROM hypertable_detailed_size('public.telemetry_ts')
      `);

      // Chunks (no LIMIT to show all chunks)
      const chunksQuery = await client.query(`
        SELECT 
          c.chunk_schema AS schema,
          c.chunk_name AS name,
          c.range_start,
          c.range_end,
          c.is_compressed,
          s.total_bytes,
          s.index_bytes,
          h.before_compression_total_bytes,
          h.before_compression_index_bytes
        FROM timescaledb_information.chunks c
        LEFT JOIN chunks_detailed_size('public.telemetry_ts') s
          ON c.chunk_schema = s.chunk_schema AND c.chunk_name = s.chunk_name
        LEFT JOIN chunk_compression_stats('public.telemetry_ts') h
          ON c.chunk_schema = h.chunk_schema AND c.chunk_name = h.chunk_name
        WHERE c.hypertable_schema = 'public' AND c.hypertable_name = 'telemetry_ts'
        ORDER BY c.range_start DESC
      `);

      const pg = storageSize(pgSizes.rows[0]?.total, pgSizes.rows[0]?.index);
      const ts = storageSize(tsSizes.rows[0]?.total_bytes, tsSizes.rows[0]?.index_bytes);
      const parent = storageSize(tsSizes.rows[0]?.parent_total_bytes, tsSizes.rows[0]?.parent_index_bytes);
      if (!pg || !ts || !parent) throw new Error("Storage size metadata is incomplete");
      const before = reconstructBeforeStorage(ts, parent, chunksQuery.rows);

      const chunks = chunksQuery.rows.map((r) => ({
        schema: r.schema,
        name: r.name,
        rangeStart: r.range_start
          ? new Date(r.range_start).toISOString()
          : null,
        rangeEnd: r.range_end ? new Date(r.range_end).toISOString() : null,
        isCompressed: !!r.is_compressed,
        totalBytes: parseInt(r.total_bytes || "0", 10),
      }));

      return NextResponse.json({
        serverTime: new Date().toISOString(),
        pg,
        ts: {
          ...ts,
          toastBytes: parseInt(tsSizes.rows[0]?.toast_bytes || "0", 10),
          beforeCompressionBytes: before?.totalBytes ?? null,
          afterCompressionBytes: ts.totalBytes,
          beforeTableBytes: before?.tableBytes ?? null,
          beforeIndexBytes: before?.indexBytes ?? null,
          afterTableBytes: ts.tableBytes,
          afterIndexBytes: ts.indexBytes,
          beforeSizeIsEstimate: chunksQuery.rows.some(row => row.is_compressed),
          compressionRatio: before && ts.totalBytes > 0 ? before.totalBytes / ts.totalBytes : null,
        },
        chunks,
      });
    });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message?.substring(0, 200) },
      { status: 500 },
    );
  }
}

async function runPOST(req: Request) {
  try {
    const body = await req.json();
    const {
      action,
      chunkName,
      chunkSchema = "_timescaledb_internal",
      days,
    } = body;

    return await withClient(
      async (client) => {
        // 1. Single chunk compression
        if (action === "compress_chunk") {
          if (!chunkName || typeof chunkName !== "string") {
            return NextResponse.json(
              { error: "chunkName is required" },
              { status: 400 },
            );
          }
          const res = await client.query(
            `SELECT compress_chunk(format('%I.%I', $1::text, $2::text)::regclass, if_not_compressed => true)`,
            [chunkSchema, chunkName],
          );
          return NextResponse.json({
            success: true,
            action,
            chunk: chunkName,
            result: res.rows[0]?.compress_chunk || null,
          });
        }

        // 2. Single chunk decompression
        if (action === "decompress_chunk") {
          if (!chunkName || typeof chunkName !== "string") {
            return NextResponse.json(
              { error: "chunkName is required" },
              { status: 400 },
            );
          }
          const res = await client.query(
            `SELECT decompress_chunk(format('%I.%I', $1::text, $2::text)::regclass, if_compressed => true)`,
            [chunkSchema, chunkName],
          );
          return NextResponse.json({
            success: true,
            action,
            chunk: chunkName,
            result: res.rows[0]?.decompress_chunk || null,
          });
        }

        // 3. Compress all chunks
        if (action === "compress_all") {
          const res = await client.query(`
          SELECT compress_chunk(c, if_not_compressed => true)
          FROM show_chunks('telemetry_ts') c
        `);
          const affected = res.rows.filter((r) => r.compress_chunk != null);
          return NextResponse.json({
            success: true,
            action,
            count: affected.length,
            chunks: affected.map((r) => r.compress_chunk),
          });
        }

        // 4. Decompress all chunks
        if (action === "decompress_all") {
          const res = await client.query(`
          SELECT decompress_chunk(c, if_compressed => true)
          FROM show_chunks('telemetry_ts') c
        `);
          const affected = res.rows.filter((r) => r.decompress_chunk != null);
          return NextResponse.json({
            success: true,
            action,
            count: affected.length,
            chunks: affected.map((r) => r.decompress_chunk),
          });
        }

        // 5. Compress chunks older than N days
        if (action === "compress_older_than") {
          const parsedDays = Number(days);
          if (isNaN(parsedDays) || parsedDays < 0) {
            return NextResponse.json(
              { error: "Valid non-negative days value is required" },
              { status: 400 },
            );
          }
          const res = await client.query(
            `
          SELECT compress_chunk(c, if_not_compressed => true)
          FROM show_chunks('telemetry_ts', older_than => format('%s days', $1::int)::interval) c
        `,
            [Math.floor(parsedDays)],
          );
          const affected = res.rows.filter((r) => r.compress_chunk != null);
          return NextResponse.json({
            success: true,
            action,
            days: Math.floor(parsedDays),
            count: affected.length,
            chunks: affected.map((r) => r.compress_chunk),
          });
        }

        return NextResponse.json(
          { error: `Unknown action: ${action}` },
          { status: 400 },
        );
      },
      { timeoutMs: 300000 },
    );
  } catch (err: any) {
    return NextResponse.json(
      {
        error: err.message?.substring(0, 300) || "Compression operation failed",
      },
      { status: 500 },
    );
  }
}

export async function GET(req: Request) {
  return withSqlStream(req, () => runGET());
}

export async function POST(req: Request) {
  return withSqlStream(req, () => runPOST(req));
}

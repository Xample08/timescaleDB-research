import { getPool } from "@/lib/db";
import { checkPassword } from "@/lib/auth";
import {
  BulkJob,
  BULK_BATCH_SIZE,
  bulkColumns,
  bulkInsertSql,
  validateBulkInput,
} from "@/lib/bulk";
import crypto from "crypto";
import type { PoolClient } from "pg";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function ensure(client: PoolClient) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS simulator_bulk_jobs (id uuid PRIMARY KEY,state jsonb NOT NULL)`,
  );
}
async function get(
  client: PoolClient,
  id: string,
  lock = false,
): Promise<BulkJob | null> {
  const result = await client.query(
    `SELECT state FROM simulator_bulk_jobs WHERE id=$1${lock ? " FOR UPDATE" : ""}`,
    [id],
  );
  return result.rows[0]?.state || null;
}
async function save(client: PoolClient, job: BulkJob) {
  job.updatedAt = new Date().toISOString();
  await client.query(
    "UPDATE simulator_bulk_jobs SET state=$2::jsonb WHERE id=$1",
    [job.id, JSON.stringify(job)],
  );
}
export async function GET(req: Request) {
  if (!checkPassword(req))
    return Response.json({ error: "Invalid password" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") || "";
  if (!uuid.test(id))
    return Response.json({ error: "Invalid job ID" }, { status: 422 });
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await ensure(client);
    const job = await get(client, id);
    return job
      ? Response.json({ job })
      : Response.json({ error: "Job not found" }, { status: 404 });
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.substring(0, 200)
            : "Unable to load job",
      },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}
export async function POST(req: Request) {
  if (!checkPassword(req))
    return Response.json({ error: "Invalid password" }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid request" }, { status: 422 });
  }
  if (
    !body ||
    !uuid.test(body.id || "") ||
    !["create", "step", "pause", "resume"].includes(body.action)
  )
    return Response.json({ error: "Invalid job request" }, { status: 422 });
  if (
    body.action === "create" &&
    !validateBulkInput(body.total, body.vehicles, body.days)
  )
    return Response.json(
      {
        error:
          "Enter a positive safe integer for rows, 1–1,000 vehicles, and 1–365 history days",
      },
      { status: 422 },
    );
  let client: PoolClient | undefined;
  try {
    client = await getPool().connect();
    await ensure(client);
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = 45000");
    await client.query("SET LOCAL lock_timeout = 10000");
    // Serializes creation and operations for the same ID, including lost-response retries.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      body.id,
    ]);
    let job = await get(client, body.id, true);
    if (body.action === "create") {
      if (!job) {
        const count = Math.min(body.vehicles, body.total);
        const vehicles = await client.query(
          `INSERT INTO vehicles (plate_number,name,vehicle_type,is_active) SELECT $1 || '-' || n::text,'Bulk vehicle ' || n::text,'car',true FROM generate_series(1,$2::integer) n RETURNING id`,
          [`BULK-${crypto.randomUUID()}`, count],
        );
        const now = new Date();
        const end = new Date(now.getTime() - 1000);
        job = {
          id: body.id,
          total: body.total,
          processed: 0,
          vehicleIds: vehicles.rows.map((row) => row.id),
          days: body.days,
          startTime: new Date(
            end.getTime() - body.days * 86400000,
          ).toISOString(),
          endTime: end.toISOString(),
          status: "running",
          createdAt: now.toISOString(),
          updatedAt: now.toISOString(),
          lastError: null,
        };
        await client.query(
          "INSERT INTO simulator_bulk_jobs (id,state) VALUES ($1,$2::jsonb)",
          [job.id, JSON.stringify(job)],
        );
      }
    } else {
      if (!job) {
        await client.query("ROLLBACK");
        return Response.json({ error: "Job not found" }, { status: 404 });
      }
      if (body.action === "pause" && job.status !== "completed")
        job.status = "paused";
      if (body.action === "resume" && job.status !== "completed") {
        job.status = "running";
        job.lastError = null;
      }
      if (body.action === "step" && job.status === "running") {
        const count = Math.min(BULK_BATCH_SIZE, job.total - job.processed);
        if (count > 0) {
          // Eight array parameters keep the statement small even for large batches.
          // Build every column from the same rows to preserve alignment in unnest.
          const values = bulkColumns(job, count);
          for (const table of ["telemetry_pg", "telemetry_ts"] as const) {
            const result = await client.query(
              bulkInsertSql(table),
              values,
            );
            if (result.rowCount !== count)
              throw new Error(`Unexpected inserted row count in ${table}`);
          }
          job.processed += count;
        }
        if (job.processed === job.total) job.status = "completed";
      }
      await save(client, job);
    }
    await client.query("COMMIT");
    return Response.json({ job, batchSize: BULK_BATCH_SIZE });
  } catch (error) {
    await client?.query("ROLLBACK").catch(() => {});
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message.substring(0, 200)
            : "Batch failed. Resume from the saved checkpoint.",
      },
      { status: 500 },
    );
  } finally {
    client?.release();
  }
}

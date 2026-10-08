import { traceClient } from "./sql-trace";
import { Pool, PoolClient } from "pg";

const sslOption =
  process.env.DB_SSL_VERIFY === "true" ? true : { rejectUnauthorized: false };

let connectionString = process.env.DATABASE_URL || "";
if (connectionString.includes("sslmode=")) {
  connectionString = connectionString.replace(/[\?&]sslmode=[^&]*/, "");
  if (connectionString.endsWith("?"))
    connectionString = connectionString.slice(0, -1);
}

export const pool = new Pool({
  connectionString,
  max: 3,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 10000,
  ssl: sslOption,
});

pool.on("connect", (client) => {
  client.query("SET TIME ZONE 'UTC'").catch(() => {});
});

export const BENCH_TIMEOUT_MS = parseInt(
  process.env.BENCH_TIMEOUT_MS || "15000",
  10,
);

export function formatError(err: unknown): string {
  if (err && typeof err === "object" && "code" in err && err.code === "57014") {
    return "timeout";
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.substring(0, 200);
}

export async function withReadOnlyClient<T>(
  callback: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = traceClient(await pool.connect());
  try {
    await client.query("BEGIN READ ONLY");
    await client.query(`SET LOCAL statement_timeout = ${BENCH_TIMEOUT_MS}`);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function withClient<T>(
  callback: (client: PoolClient) => Promise<T>,
  options?: { timeoutMs?: number },
): Promise<T> {
  const client = traceClient(await pool.connect());
  try {
    const timeout = options?.timeoutMs || 300000;
    await client.query(`SET statement_timeout = ${timeout}`);
    return await callback(client);
  } finally {
    client.release();
  }
}

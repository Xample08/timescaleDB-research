import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
type Emit = (event: Record<string, unknown>) => void;
const context = new AsyncLocalStorage<Emit>();
export function sqlTarget(sql: string) {
  return /telemetry_pg/i.test(sql)
    ? "pg"
    : /telemetry_ts|telemetry_hourly|timescaledb|compress_chunk|decompress_chunk/i.test(
          sql,
        )
      ? "ts"
      : "system";
}
export function traceClient(client: PoolClient): PoolClient {
  return new Proxy(client, {
    get(target, property) {
      if (property !== "query") {
        const value = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      }
      return async (...args: unknown[]) => {
        const emit = context.getStore();
        if (!emit) return Reflect.apply(target.query, target, args);
        const sql =
          typeof args[0] === "string"
            ? args[0]
            : (args[0] as { text?: string })?.text || "";
        const values = Array.isArray(args[1])
          ? args[1]
          : (args[0] as { values?: unknown[] })?.values || [];
        const id = randomUUID();
        const timestamp = new Date().toISOString();
        emit({
          type: "sql",
          id,
          sql,
          values,
          target: sqlTarget(sql),
          timestamp,
          phase: "executing",
        });
        const start = performance.now();
        try {
          const result = await Reflect.apply(target.query, target, args);
          const durationMs = performance.now() - start;
          emit({
            type: "sql",
            id,
            phase: "complete",
            rowCount: result.rowCount,
            durationMs,
          });
          return result;
        } catch (error) {
          emit({
            type: "sql",
            id,
            phase: "failed",
            error:
              error instanceof Error
                ? error.message.substring(0, 200)
                : "SQL execution failed",
            durationMs: performance.now() - start,
          });
          throw error;
        }
      };
    },
  });
}
export async function withSqlStream(
  req: Request,
  handler: () => Promise<Response>,
): Promise<Response> {
  if (!req.headers.get("accept")?.includes("application/x-ndjson"))
    return handler();
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit: Emit = (event) => {
        if (!closed)
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const response = await context.run(emit, handler);
        emit({
          type: "result",
          status: response.status,
          data: await response.json(),
        });
      } catch (error) {
        emit({
          type: "result",
          status: 500,
          data: {
            error:
              error instanceof Error
                ? error.message.substring(0, 200)
                : "Request failed",
          },
        });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

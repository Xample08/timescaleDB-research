import { expect, test, vi } from "vitest";
import type { PoolClient } from "pg";
import { withSqlStream, traceClient } from "./sql-trace";
const request = (stream = true) =>
  new Request("http://localhost/api/benchmark", {
    headers: { Accept: stream ? "application/x-ndjson" : "application/json" },
  });
const parse = async (response: Response) =>
  (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
test("streams actual statements and parameters before completion", async () => {
  const query = vi.fn().mockResolvedValue({ rowCount: 2, rows: [{}, {}] });
  const client = traceClient({ query } as unknown as PoolClient);
  const response = await withSqlStream(request(), async () => {
    await client.query("SELECT * FROM telemetry_pg WHERE vehicle_id = $1", [7]);
    return Response.json({ ok: true });
  });
  const events = await parse(response);
  expect(events[0]).toMatchObject({
    type: "sql",
    phase: "executing",
    target: "pg",
    values: [7],
  });
  expect(events[0].sql).toBe(query.mock.calls[0][0]);
  expect(events[1]).toMatchObject({
    id: events[0].id,
    phase: "complete",
    rowCount: 2,
  });
  expect(events[2]).toMatchObject({
    type: "result",
    status: 200,
    data: { ok: true },
  });
});
test("query failure emits the same id and preserves error responses", async () => {
  const client = traceClient({
    query: vi.fn().mockRejectedValue(new Error("timeout")),
  } as unknown as PoolClient);
  const events = await parse(
    await withSqlStream(request(), async () => {
      try {
        await client.query("SELECT * FROM telemetry_ts");
      } catch {
        return Response.json({ error: "timeout" }, { status: 500 });
      }
      return Response.json({});
    }),
  );
  expect(events[1]).toMatchObject({
    id: events[0].id,
    phase: "failed",
    error: "timeout",
  });
  expect(events.at(-1)).toMatchObject({ status: 500 });
});
test("concurrent requests never receive each other's SQL events", async () => {
  const client = traceClient({
    query: async () => {
      await Promise.resolve();
      return { rowCount: 0 };
    },
  } as unknown as PoolClient);
  const responses = await Promise.all(
    ["telemetry_pg", "telemetry_ts"].map((table) =>
      withSqlStream(request(), async () => {
        await client.query(`SELECT * FROM ${table}`);
        return Response.json({ table });
      }),
    ),
  );
  const [pg, ts] = await Promise.all(responses.map(parse));
  expect(
    pg.filter((e) => e.type === "sql" && e.sql).map((e) => e.target),
  ).toEqual(["pg"]);
  expect(
    ts.filter((e) => e.type === "sql" && e.sql).map((e) => e.target),
  ).toEqual(["ts"]);
});
test("ordinary JSON clients remain compatible and the client is released correctly", async () => {
  const raw = {
    query: vi.fn().mockResolvedValue({ rowCount: 1 }),
    release: vi.fn(),
  };
  const client = traceClient(raw as unknown as PoolClient);
  const response = await withSqlStream(request(false), async () => {
    await client.query("SELECT 1");
    client.release();
    return Response.json({ ok: true });
  });
  expect(await response.json()).toEqual({ ok: true });
  expect(raw.release).toHaveBeenCalledOnce();
});

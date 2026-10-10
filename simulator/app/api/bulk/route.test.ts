import { beforeEach, expect, test, vi } from "vitest";
import type { BulkJob } from "@/lib/bulk";
const mocks = vi.hoisted(() => ({ query: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getPool: () => ({
    connect: async () => ({ query: mocks.query, release: mocks.release }),
  }),
}));
import { POST, GET } from "./route";
const id = "12345678-1234-1234-1234-123456789012";
let stored: BulkJob | null,
  staged: BulkJob | null,
  rows: Record<string, string[]>,
  pending: Record<string, string[]>,
  failTs: boolean;
const request = (action: string, extra = {}) =>
  new Request("http://localhost/api/bulk", {
    method: "POST",
    headers: { "x-sim-password": "test", "Content-Type": "application/json" },
    body: JSON.stringify({ id, action, ...extra }),
  });
beforeEach(() => {
  vi.stubEnv("SIM_PASSWORD", "test");
  vi.clearAllMocks();
  stored = {
    id,
    total: 3500,
    processed: 0,
    vehicleIds: [1, 2],
    days: 14,
    startTime: "2026-09-26T00:00:00Z",
    endTime: "2026-10-10T00:00:00Z",
    status: "running",
    createdAt: "",
    updatedAt: "",
    lastError: null,
  };
  rows = { pg: [], ts: [] };
  pending = { pg: [], ts: [] };
  failTs = false;
  mocks.query.mockImplementation(
    async (sql: string, values: unknown[] = []) => {
      if (sql === "BEGIN") {
        staged = stored ? structuredClone(stored) : null;
        pending = { pg: [], ts: [] };
      }
      if (sql.startsWith("SELECT state"))
        return { rows: stored ? [{ state: structuredClone(stored) }] : [] };
      if (sql.startsWith("INSERT INTO vehicles"))
        return { rows: [{ id: 1 }, { id: 2 }] };
      if (
        sql.startsWith("INSERT INTO simulator_bulk_jobs") ||
        sql.startsWith("UPDATE simulator_bulk_jobs")
      )
        staged = JSON.parse(String(values[1]));
      if (sql.startsWith("INSERT INTO telemetry_")) {
        const target = sql.includes("telemetry_pg") ? "pg" : "ts";
        if (target === "ts" && failTs) throw new Error("TS unavailable");
        for (let i = 0; i < values.length; i += 8)
          pending[target].push(`${values[i]}-${values[i + 1]}`);
        return { rowCount: values.length / 8 };
      }
      if (sql === "COMMIT") {
        stored = staged;
        rows.pg.push(...pending.pg);
        rows.ts.push(...pending.ts);
      }
      if (sql === "ROLLBACK") pending = { pg: [], ts: [] };
      return { rows: [] };
    },
  );
});
test("commits identical data and checkpoint together; final batch stops at exactly N", async () => {
  expect((await (await POST(request("step"))).json()).job.processed).toBe(2000);
  const final = await (await POST(request("step"))).json();
  expect(final.job).toMatchObject({ processed: 3500, status: "completed" });
  await POST(request("step"));
  expect(rows.pg).toEqual(rows.ts);
  expect(rows.pg).toHaveLength(3500);
  expect(new Set(rows.pg).size).toBe(3500);
});
test("second-table failure rolls back both inserts and checkpoint, then retry is safe", async () => {
  failTs = true;
  expect((await POST(request("step"))).status).toBe(500);
  expect(stored?.processed).toBe(0);
  expect(rows.pg).toHaveLength(0);
  failTs = false;
  await POST(request("step"));
  expect(stored?.processed).toBe(2000);
  expect(rows.pg).toEqual(rows.ts);
  expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
});
test("pause prevents writes until explicit resume", async () => {
  await POST(request("pause"));
  await POST(request("step"));
  expect(rows.pg).toHaveLength(0);
  expect(stored?.status).toBe("paused");
  await POST(request("resume"));
  await POST(request("step"));
  expect(rows.pg).toHaveLength(2000);
});
test("creation retry with the same ID does not create another fleet", async () => {
  stored = null;
  const payload = { total: 3500, vehicles: 2, days: 14 };
  await POST(request("create", payload));
  await POST(request("create", payload));
  expect(
    mocks.query.mock.calls.filter(([sql]) =>
      sql.startsWith("INSERT INTO vehicles"),
    ),
  ).toHaveLength(1);
});
test("recovery GET reads the database checkpoint without inserting rows", async () => {
  const response = await GET(
    new Request(`http://localhost/api/bulk?id=${id}`, {
      headers: { "x-sim-password": "test" },
    }),
  );
  expect((await response.json()).job.processed).toBe(0);
  expect(rows.pg).toHaveLength(0);
});
test("rejects unauthorized and invalid creation without database access", async () => {
  const response = await POST(
    new Request("http://localhost/api/bulk", { method: "POST", body: "{}" }),
  );
  expect(response.status).toBe(401);
  expect(
    (await POST(request("create", { total: 0, vehicles: 2, days: 14 }))).status,
  ).toBe(422);
  expect(mocks.query).not.toHaveBeenCalled();
});

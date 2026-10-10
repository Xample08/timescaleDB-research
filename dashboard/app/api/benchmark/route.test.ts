import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  withReadOnlyClient: mocks.connect,
  formatError: (e: Error) => e.message,
}));
import { POST } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockImplementation(async (callback) =>
    callback({ query: mocks.query }),
  );
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("EXPLAIN") && sql.includes("telemetry_pg"))
      throw new Error("timeout");
    if (sql.startsWith("EXPLAIN"))
      return {
        rows: [
          {
            "QUERY PLAN": [
              {
                "Execution Time": 2,
                "Planning Time": 1,
                Plan: { "Actual Rows": 10 },
              },
            ],
          },
        ],
      };
    return { rows: [] };
  });
});
test("rolls back a failed variant so the next variant can run", async () => {
  const response = await POST(
    new Request("http://localhost/api/benchmark", {
      method: "POST",
      body: JSON.stringify({
        queryId: "B1",
        variants: ["pg", "ts"],
        refTime: "2026-10-10T00:00:00Z",
      }),
    }),
  );
  const body = await response.json();
  expect(body.results[0].error).toBe("timeout");
  expect(body.results[1]).toMatchObject({ error: null, executionMs: 2 });
  expect(mocks.query).toHaveBeenCalledWith(
    "ROLLBACK TO SAVEPOINT benchmark_variant",
  );
  expect(
    mocks.query.mock.calls.find(([sql]) => sql.startsWith("EXPLAIN"))?.[0],
  ).toContain("TIMING OFF");
});
test("raw hourly comparisons do not require continuous aggregate coverage", async () => {
  const response = await POST(
    new Request("http://localhost/api/benchmark", {
      method: "POST",
      body: JSON.stringify({
        queryId: "B7",
        variants: ["ts"],
        refTime: "2026-10-10T00:00:00Z",
      }),
    }),
  );
  expect((await response.json()).results[0].error).toBeNull();
  expect(
    mocks.query.mock.calls.some(([sql]) => sql.includes("min(bucket)")),
  ).toBe(false);
});

import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  withReadOnlyClient: mocks.connect,
  formatError: (error: Error) => error.message,
}));
import { GET } from "./route";
import { DEFAULT_WARNING_SETTINGS } from "@/lib/warnings";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockImplementation(async (callback) =>
    callback({ query: mocks.query }),
  );
  mocks.query.mockResolvedValue({
    rows: [
      {
        report: {
          counts: { speeding: 3 },
          activeCount: 1,
          sampleCount: 10,
          reports: [],
        },
      },
    ],
  });
});
test("returns separate reports with defaults and a consistent time window", async () => {
  const response = await GET(new Request("http://localhost/api/warnings"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.settings).toEqual(DEFAULT_WARNING_SETTINGS);
  expect(Date.parse(body.serverTime) - Date.parse(body.windowStart)).toBe(
    24 * 3600000,
  );
  for (const target of ["pg", "ts"]) {
    expect(body.results[target]).toMatchObject({
      error: null,
      report: {
        counts: { speeding: 3, longStop: 0, altitude: 0, poorGps: 0 },
        activeCount: 1,
      },
    });
  }
  const queries = mocks.query.mock.calls.filter(([sql]) =>
    sql.startsWith("WITH"),
  );
  expect(queries).toHaveLength(2);
  expect(queries[0][1]).toEqual(queries[1][1]);
});
test.each([
  "speedLimit=",
  "hours=0",
  "stopMinutes=1.5",
  "gpsLimit=NaN",
  "maxGapSeconds=3601",
])("rejects invalid numeric input before connecting: %s", async (params) => {
  const response = await GET(
    new Request(`http://localhost/api/warnings?${params}`),
  );
  expect(response.status).toBe(422);
  expect((await response.json()).error).toBe("Invalid warning thresholds");
  expect(mocks.connect).not.toHaveBeenCalled();
});
test("recovers the transaction after one target fails and retains the other report", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM telemetry_pg"))
      throw new Error("PG table unavailable");
    return {
      rows: [
        { report: { sampleCount: 1, counts: { poorGps: 1 }, activeCount: 1 } },
      ],
    };
  });
  const body = await (
    await GET(new Request("http://localhost/api/warnings"))
  ).json();
  expect(body.results.pg).toEqual({
    report: null,
    error: "PG table unavailable",
  });
  expect(body.results.ts.report.counts.poorGps).toBe(1);
  expect(mocks.query).toHaveBeenCalledWith(
    "ROLLBACK TO SAVEPOINT warning_target",
  );
});
test("connection failure is reported as an error rather than zero warnings", async () => {
  mocks.connect.mockRejectedValueOnce(new Error("Connection unavailable"));
  const response = await GET(new Request("http://localhost/api/warnings"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "Connection unavailable" });
});

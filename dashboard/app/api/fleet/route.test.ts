import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  withReadOnlyClient: mocks.connect,
  formatError: (error: Error) => error.message,
}));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockImplementation(async (callback) =>
    callback({ query: mocks.query }),
  );
  mocks.query.mockImplementation(async (sql: string) =>
    sql.startsWith("WITH")
      ? {
          rows: [
            {
              report: {
                sampleCount: 2,
                activeCount: 1,
                activeVehicles: [{ vehicleId: 7, kind: "speeding" }],
                counts: { speeding: 1 },
              },
            },
          ],
        }
      : sql.includes("LATERAL")
        ? { rows: [{ id: 7, plate: "TEST", time: null }] }
        : sql.includes("GROUP BY")
          ? { rows: [] }
          : {
              rows: [
                {
                  samples: 2,
                  avgSpeed: 40,
                  maxSpeed: 90,
                  avgGps: 10,
                  minAltitude: 0,
                  maxAltitude: 15,
                },
              ],
            },
  );
});
test.each(["pg", "ts"])(
  "%s report queries only its selected telemetry table",
  async (target) => {
    const response = await GET(
      new Request(`http://localhost/api/fleet?target=${target}`),
    );
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.target).toBe(target);
    expect(body.vehicles[0].id).toBe(7);
    expect(body.warnings.activeVehicles).toEqual([
      { vehicleId: 7, kind: "speeding" },
    ]);
    expect(Date.parse(body.checkedAt) - Date.parse(body.windowStart)).toBe(
      86400000,
    );
    const other = target === "pg" ? "ts" : "pg";
    for (const [sql] of mocks.query.mock.calls) {
      expect(sql).toContain(`telemetry_${target}`);
      expect(sql).not.toContain(`telemetry_${other}`);
    }
  },
);
test.each(["", "target=other", "target=telemetry_pg;DROP TABLE vehicles"])(
  "rejects invalid database selection without connecting",
  async (query) => {
    const response = await GET(
      new Request(`http://localhost/api/fleet?${query}`),
    );
    expect(response.status).toBe(422);
    expect(mocks.connect).not.toHaveBeenCalled();
  },
);
test("does not disguise query errors as an empty fleet", async () => {
  mocks.query.mockRejectedValueOnce(new Error("timeout"));
  const response = await GET(
    new Request("http://localhost/api/fleet?target=ts"),
  );
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "timeout" });
});

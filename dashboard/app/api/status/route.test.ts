import { beforeEach, afterEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/db", () => ({
  BENCH_TIMEOUT_MS: 15000,
  withReadOnlyClient: mocks.connect,
}));
import { GET } from "./route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("EXACT_COUNT_TIMEOUT_MS", "");
  mocks.connect.mockImplementation(async callback => callback({ query: mocks.query }));
  mocks.query.mockImplementation(async (sql: string) => ({ rows: sql.includes("AS pg,")
    ? [{ pg: "1100000000", ts: "1100000001" }]
    : [{ count: "12" }] }));
});
afterEach(() => vi.unstubAllEnvs());

test.each([ ["", 1800000], ["600000", 600000], ["garbage", 1800000], ["0", 1800000], ["1; DROP TABLE vehicles", 1800000] ])(
  "exact counting uses a separate validated timeout (%s), then restores the benchmark timeout",
  async (setting, expected) => {
    vi.stubEnv("EXACT_COUNT_TIMEOUT_MS", setting);
    const response = await GET(new Request("http://localhost/api/status?exact=true"));
    expect(response.status).toBe(200);
    expect((await response.json()).approxRows).toEqual({ pg: 1100000000, ts: 1100000001, isExact: true });
    const statements = mocks.query.mock.calls.map(([sql]) => sql);
    const countIndex = statements.findIndex(sql => sql.includes("AS pg,"));
    expect(statements[countIndex-1]).toBe(`SET LOCAL statement_timeout = ${expected}`);
    expect(statements[countIndex+1]).toBe("SET LOCAL statement_timeout = 15000");
  },
);
test("estimated polling never enables the longer timeout or performs a full count", async () => {
  await GET(new Request("http://localhost/api/status"));
  const statements = mocks.query.mock.calls.map(([sql]) => sql);
  expect(statements.some(sql => sql.includes("SET LOCAL statement_timeout"))).toBe(false);
  expect(statements.some(sql => sql.includes("AS pg,"))).toBe(false);
  expect(statements.some(sql => sql.includes("approximate_row_count"))).toBe(true);
});
test("a count timeout returns an error without a partial count result", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("AS pg,")) throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    return { rows: [] };
  });
  const response = await GET(new Request("http://localhost/api/status?exact=true"));
  expect(response.status).toBe(500);
  expect((await response.json()).approxRows).toBeUndefined();
});

import { beforeEach, expect, test, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
  connect: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getPool: () => ({ connect: mocks.connect }) }));
import { POST } from "./route";
const request = (body: unknown, password = "test-password") =>
  new Request("http://localhost/api/vehicles", {
    method: "POST",
    headers: { "x-sim-password": password, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
beforeEach(() => {
  vi.stubEnv("SIM_PASSWORD", "test-password");
  vi.clearAllMocks();
  mocks.connect.mockResolvedValue({
    query: mocks.query,
    release: mocks.release,
  });
  mocks.query.mockImplementation(async (sql: string) =>
    sql.startsWith("SELECT count") ? { rows: [{ active: 20 }] } : { rows: [] },
  );
});
test("creates only the missing vehicles after explicit confirmation", async () => {
  const response = await POST(request({ targetCount: 25, confirmed: true }));
  expect(await response.json()).toEqual({ added: 5, activeCount: 25 });
  const insert = mocks.query.mock.calls.find(([sql]) =>
    sql.startsWith("INSERT"),
  );
  expect(insert?.[1][1]).toBe(5);
  expect(insert?.[0]).not.toContain("telemetry");
  expect(mocks.query).toHaveBeenCalledWith("COMMIT");
  expect(mocks.release).toHaveBeenCalledOnce();
});
test.each([
  { targetCount: 25 },
  { targetCount: 25, confirmed: false },
  { targetCount: 1.5, confirmed: true },
  { targetCount: 1001, confirmed: true },
])("does not write for unconfirmed or invalid input", async (body) => {
  const response = await POST(request(body));
  expect(response.status).toBe(422);
  expect(mocks.connect).not.toHaveBeenCalled();
});
test("wrong password cannot create vehicles", async () => {
  expect(
    (await POST(request({ targetCount: 25, confirmed: true }, "wrong"))).status,
  ).toBe(401);
  expect(mocks.connect).not.toHaveBeenCalled();
});
test("repeated confirmed request does not create surplus vehicles", async () => {
  const response = await POST(request({ targetCount: 20, confirmed: true }));
  expect((await response.json()).added).toBe(0);
  expect(mocks.query.mock.calls.some(([sql]) => sql.startsWith("INSERT"))).toBe(
    false,
  );
});
test("insertion failure rolls back and releases the connection", async () => {
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("INSERT")) throw new Error("Write failed");
    return { rows: [{ active: 20 }] };
  });
  expect(
    (await POST(request({ targetCount: 25, confirmed: true }))).status,
  ).toBe(500);
  expect(mocks.query).toHaveBeenCalledWith("ROLLBACK");
  expect(mocks.release).toHaveBeenCalledOnce();
});

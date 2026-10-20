import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));

vi.mock("@/lib/db", () => ({
  withClient: mocks.connect,
  formatError: (err: unknown) =>
    err instanceof Error ? err.message : String(err),
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockImplementation(async (callback: any) =>
    callback({ query: mocks.query }),
  );
});

test("refreshes continuous aggregate successfully", async () => {
  mocks.query.mockResolvedValueOnce({ rows: [] });
  const response = await POST(
    new Request("http://localhost/api/cagg/refresh", { method: "POST" }),
  );
  expect(response.status).toBe(200);
  const data = await response.json();
  expect(data).toEqual({
    success: true,
    message: "Continuous aggregate refreshed successfully",
  });
  expect(mocks.query).toHaveBeenCalledWith(
    "CALL refresh_continuous_aggregate('telemetry_hourly', NULL, NULL);",
  );
});

test("returns 500 when refresh fails", async () => {
  mocks.query.mockRejectedValueOnce(new Error("view does not exist"));
  const response = await POST(
    new Request("http://localhost/api/cagg/refresh", { method: "POST" }),
  );
  expect(response.status).toBe(500);
  const data = await response.json();
  expect(data.success).toBe(false);
  expect(data.message).toContain("view does not exist");
});

import { beforeEach, expect, test, vi } from "vitest";
import { NextRequest } from "next/server";
const { query, release } = vi.hoisted(() => ({
  query: vi.fn(),
  release: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
  getPool: () => ({ connect: async () => ({ query, release }) }),
}));
import { POST } from "./route";
const body = {
  vehicles: [
    { id: 1, lat: -6.2, lon: 106.8, speed: 20, heading: 90, alt: 10, stop: 0 },
  ],
  dt: 5,
  mode: "batch",
  targets: ["pg", "ts"],
  dirty: false,
  tickNo: 0,
};
function request(stream = true, payload = body) {
  return new NextRequest("http://localhost/api/tick", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-sim-password": "test-password",
      Accept: stream ? "application/x-ndjson" : "application/json",
    },
    body: JSON.stringify(payload),
  });
}
beforeEach(() => {
  vi.stubEnv("SIM_PASSWORD", "test-password");
  query.mockReset().mockResolvedValue({ rowCount: 1 });
  release.mockReset();
});
test("streams exact SQL in actual execution order and returns tick metrics", async () => {
  const response = await POST(request());
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(
    events.filter((e) => e.type === "query").map((e) => [e.target, e.phase]),
  ).toEqual([
    ["ts", "executing"],
    ["ts", "complete"],
    ["pg", "executing"],
    ["pg", "complete"],
  ]);
  expect(events[0].sql).toBe(query.mock.calls[0][0]);
  expect(events[2].sql).toBe(query.mock.calls[1][0]);
  expect(events.at(-1)).toMatchObject({
    type: "result",
    status: 200,
    data: { inserted: { pg: 1, ts: 1 } },
  });
  expect(release).toHaveBeenCalledOnce();
});
test("streams query failure and continues with the other destination", async () => {
  query.mockRejectedValueOnce(new Error("Insert failed"));
  const events = (await (await POST(request())).text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events).toContainEqual({
    type: "query-error",
    target: "ts",
    error: "Insert failed",
  });
  expect(events.at(-1)).toMatchObject({
    data: { errors: { ts: "Insert failed", pg: null }, inserted: { pg: 1 } },
  });
});
test("preserves JSON clients", async () => {
  const response = await POST(request(false));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ inserted: { pg: 1, ts: 1 } });
});
test("invalid numeric payload never executes SQL", async () => {
  const response = await POST(request(true, { ...body, dt: NaN }));
  const events = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(events.at(-1)).toMatchObject({ type: "result", status: 422 });
  expect(query).not.toHaveBeenCalled();
});

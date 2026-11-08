import { beforeEach, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn() }));
vi.mock("@/lib/db", () => ({ withReadOnlyClient: mocks.connect, withClient: vi.fn() }));
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.connect.mockImplementation(async callback => callback({ query: mocks.query }));
  mocks.query.mockImplementation(async (sql: string) => {
    if (sql.includes("pg_total_relation_size('public.telemetry_pg')")) {
      return { rows: [{ total: "1200", index: "400" }] };
    }
    if (sql.includes("hypertable_detailed_size(")) {
      return { rows: [{ total_bytes: "300", index_bytes: "30", toast_bytes: "200", parent_total_bytes: "10", parent_index_bytes: "4" }] };
    }
    if (sql.includes("timescaledb_information.chunks")) {
      return { rows: [
        { name: "compressed", schema: "_timescaledb_internal", is_compressed: true, total_bytes: "190", index_bytes: "19", before_compression_total_bytes: "1000", before_compression_index_bytes: "400" },
        { name: "raw", schema: "_timescaledb_internal", is_compressed: false, total_bytes: "100", index_bytes: "7", before_compression_total_bytes: null, before_compression_index_bytes: null },
      ] };
    }
    return { rows: [] };
  });
});

test("storage returns whole-hypertable before and actual whole-hypertable after, including mixed chunks", async () => {
  const response = await GET(new Request("http://localhost/api/storage"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.pg).toEqual({ totalBytes: 1200, tableBytes: 800, indexBytes: 400 });
  expect(body.ts).toMatchObject({
    totalBytes: 300, tableBytes: 270, indexBytes: 30, toastBytes: 200,
    beforeCompressionBytes: 1110, beforeTableBytes: 699, beforeIndexBytes: 411,
    afterCompressionBytes: 300, afterTableBytes: 270, afterIndexBytes: 30,
    beforeSizeIsEstimate: true, compressionRatio: 3.7,
  });
  expect(body.chunks).toHaveLength(2);
  expect(mocks.query.mock.calls[0][0]).toContain("REPEATABLE READ");
});

test("missing compressed history does not turn an incomplete baseline into a reported total", async () => {
  const original = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async (sql: string) => {
    const result = await original(sql);
    if (sql.includes("timescaledb_information.chunks")) result.rows[0].before_compression_total_bytes = null;
    return result;
  });
  const response = await GET(new Request("http://localhost/api/storage"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.ts.beforeCompressionBytes).toBeNull();
  expect(body.ts.beforeIndexBytes).toBeNull();
  expect(body.ts.compressionRatio).toBeNull();
  expect(body.ts.afterCompressionBytes).toBe(300);
});

test("database failures are reported instead of returning zero-sized charts", async () => {
  mocks.query.mockRejectedValueOnce(new Error("storage unavailable"));
  const response = await GET(new Request("http://localhost/api/storage"));
  expect(response.status).toBe(500);
  expect(await response.json()).toEqual({ error: "storage unavailable" });
});

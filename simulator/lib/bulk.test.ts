import { expect, test } from "vitest";
import { BulkJob, bulkRows, validateBulkInput } from "./bulk";
const job: BulkJob = {
  id: "12345678-1234-1234-1234-123456789012",
  total: 100000000,
  processed: 0,
  vehicleIds: [1],
  days: 1,
  startTime: "2026-10-09T00:00:00.000Z",
  endTime: "2026-10-10T00:00:00.000Z",
  status: "running",
  createdAt: "",
  updatedAt: "",
  lastError: null,
};
test("retry generation is deterministic and microsecond timestamps do not collide for large jobs", () => {
  const rows = bulkRows(job, 2000);
  expect(bulkRows(job, 2000)).toEqual(rows);
  expect(new Set(rows.map((row) => `${row[0]}-${row[1]}`)).size).toBe(2000);
  expect(String(rows[0][0])).toMatch(/\.\d{6}Z$/);
});
test("resumed batches continue the same dataset and end at the fixed reference time", () => {
  const small = { ...job, total: 5, vehicleIds: [1, 2] };
  const all = bulkRows(small, 5);
  expect(bulkRows({ ...small, processed: 3 }, 2)).toEqual(all.slice(3));
  expect(all.at(-1)?.[0]).toBe("2026-10-10T00:00:00.000000Z");
});
test("rejects empty, fractional and out-of-range settings", () => {
  expect(validateBulkInput(1, 1, 1)).toBe(true);
  for (const total of [NaN, 0, 1.5, 100000001, "10"])
    expect(validateBulkInput(total, 20, 14)).toBe(false);
  expect(validateBulkInput(100, 0, 14)).toBe(false);
  expect(validateBulkInput(100, 20, 366)).toBe(false);
});

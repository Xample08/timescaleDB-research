import { expect, test } from "vitest";
import { reconstructBeforeStorage, storageChartData, storageSize } from "./storage";

test("before includes historical compressed chunks, live raw chunks, and the parent exactly once", () => {
  const before = reconstructBeforeStorage(
    storageSize(250, 25)!,
    storageSize(10, 4)!,
    [
      { is_compressed: true, total_bytes: "90", index_bytes: "9", before_compression_total_bytes: "1000", before_compression_index_bytes: "400" },
      { is_compressed: true, total_bytes: "50", index_bytes: "5", before_compression_total_bytes: "600", before_compression_index_bytes: "200" },
      { is_compressed: false, total_bytes: "100", index_bytes: "7", before_compression_total_bytes: null, before_compression_index_bytes: null },
    ],
  );
  expect(before).toEqual({ totalBytes: 1710, indexBytes: 611, tableBytes: 1099 });
});

test("with no compressed chunks before equals the actual whole-hypertable measurement", () => {
  const current = storageSize(200, 40)!;
  expect(reconstructBeforeStorage(current, storageSize(10, 4)!, [
    { is_compressed: false, total_bytes: "190", index_bytes: "36", before_compression_total_bytes: null, before_compression_index_bytes: null },
  ])).toEqual(current);
  expect(reconstructBeforeStorage(storageSize(0, 0)!, storageSize(0, 0)!, [])).toEqual(storageSize(0, 0));
});

test.each([
  { is_compressed: true, total_bytes: "30", index_bytes: "5", before_compression_total_bytes: null, before_compression_index_bytes: "20" },
  { is_compressed: true, total_bytes: "30", index_bytes: "5", before_compression_total_bytes: "100", before_compression_index_bytes: null },
  { is_compressed: false, total_bytes: null, index_bytes: "5", before_compression_total_bytes: null, before_compression_index_bytes: null },
])("incomplete size records suppress the baseline instead of producing a partial or invented total", chunk => {
  const compressed = { is_compressed: true, total_bytes: "30", index_bytes: "5", before_compression_total_bytes: "100", before_compression_index_bytes: "20" };
  expect(reconstructBeforeStorage(storageSize(100, 20)!, storageSize(0, 0)!, [compressed, chunk])).toBeNull();
});

test("all chart categories use total minus index, so TOAST is included consistently", () => {
  const chart = storageChartData(
    { totalBytes: 1200, indexBytes: 400 },
    { totalBytes: 300, indexBytes: 30, beforeCompressionBytes: 1500, beforeIndexBytes: 500 },
  );
  expect(chart).toEqual([
    { name: "PostgreSQL", table: 800, index: 400 },
    { name: "TimescaleDB (Before)", table: 1000, index: 500 },
    { name: "TimescaleDB (After)", table: 270, index: 30 },
  ]);
  expect(chart.map(row => row.table + row.index)).toEqual([1200, 1500, 300]);
});

test("missing history leaves the actual After measurement visible without a 60/40 estimate", () => {
  expect(storageChartData(
    { totalBytes: 1200, indexBytes: 400 },
    { totalBytes: 300, indexBytes: 30, beforeCompressionBytes: null, beforeIndexBytes: null },
  )).toEqual([
    { name: "PostgreSQL", table: 800, index: 400 },
    { name: "TimescaleDB (After)", table: 270, index: 30 },
  ]);
});

test.each([[null, 0], [100, null], [100, 101], [-1, 0], ["bad", 0], ["", 0], [100, -1]])(
  "invalid size metadata (%s, %s) is not treated as zero", (total, index) => {
    expect(storageSize(total, index)).toBeNull();
  },
);

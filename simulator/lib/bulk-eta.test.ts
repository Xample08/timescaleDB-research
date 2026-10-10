import { expect, test } from "vitest";
import { estimateBulkEta, etaDuration } from "./bulk-eta";
test("ETA is based on committed rows and measured batch durations", () => {
  expect(
    estimateBulkEta(
      [
        { rows: 2000, milliseconds: 2000 },
        { rows: 1000, milliseconds: 1000 },
      ],
      6000,
    ),
  ).toMatchObject({ rowsPerSecond: 1000, remainingMs: 6000, early: true });
});
test("uses recent batches rather than stale speed and handles missing measurements", () => {
  expect(
    estimateBulkEta(
      [
        { rows: 2000, milliseconds: 1 },
        ...Array.from({ length: 10 }, () => ({
          rows: 1000,
          milliseconds: 1000,
        })),
      ],
      1000,
    )?.rowsPerSecond,
  ).toBe(1000);
  expect(estimateBulkEta([], 1000)).toBeNull();
  expect(estimateBulkEta([{ rows: 0, milliseconds: 1000 }], 1000)).toBeNull();
  expect(
    estimateBulkEta([{ rows: 1000, milliseconds: 1000 }], 0)?.remainingMs,
  ).toBe(0);
});
test("formats large jobs in days, hours and minutes", () => {
  expect(etaDuration((2 * 86400 + 3 * 3600 + 4 * 60) * 1000)).toBe("2d 3h 4m");
  expect(etaDuration(900)).toBe("1s");
});

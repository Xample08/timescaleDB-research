import { expect, test } from "vitest";
import { aggregateMeasurements, Measurement } from "./benchmark-results";
const row = (
  variant: string,
  executionMs: number,
  extra: Partial<Measurement> = {},
) => ({ variant, executionMs, rowsReturned: 10, ...extra });
test("failed runs never become zero millisecond successes or a valid winner", () => {
  const results = aggregateMeasurements(
    "B1",
    ["pg", "ts"],
    [
      [row("pg", 10), row("ts", 0, { error: "timeout" })],
      [row("pg", 12), row("ts", 2)],
    ],
  );
  expect(results[1]).toMatchObject({
    medianMs: 2,
    successfulRuns: 1,
    requestedRuns: 2,
    valid: false,
    reason: "timeout",
  });
  const failed = aggregateMeasurements(
    "B1",
    ["ts"],
    [[row("ts", 0, { error: "timeout" })]],
  );
  expect(failed[0].medianMs).toBeNull();
});
test("checks mismatches in every repetition, not just the final one", () => {
  const results = aggregateMeasurements(
    "B1",
    ["pg", "ts"],
    [
      [row("pg", 10), row("ts", 2, { rowsReturned: 9 })],
      [row("pg", 12), row("ts", 3)],
    ],
  );
  expect(results.every((r) => !r.valid)).toBe(true);
});
test("scalar aggregates over empty input are not valid performance comparisons", () => {
  const results = aggregateMeasurements(
    "B13",
    ["pg"],
    [[row("pg", 1, { rowsReturned: 1, inputRows: 0 })]],
  );
  expect(results[0]).toMatchObject({
    valid: false,
    reason: "No matching telemetry",
  });
});
test("missing repetitions and zero resolution are explicitly invalid", () => {
  expect(aggregateMeasurements("B1", ["pg"], [[]])[0].medianMs).toBeNull();
  expect(aggregateMeasurements("B1", ["pg"], [[row("pg", 0)]])[0].valid).toBe(
    false,
  );
});
test("successful runs retain actual timings and valid row counts", () => {
  expect(
    aggregateMeasurements("B1", ["pg"], [[row("pg", 5)], [row("pg", 15)]])[0]
      .medianMs,
  ).toBe(10);
  expect(
    aggregateMeasurements(
      "B1",
      ["pg"],
      [[row("pg", 5)], [row("pg", 10)], [row("pg", 20)]],
    )[0],
  ).toMatchObject({
    valid: true,
    medianMs: 10,
    p95Ms: 20,
    minMs: 5,
    maxMs: 20,
    successfulRuns: 3,
  });
});

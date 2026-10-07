import { describe, expect, test } from "vitest";
import { validateConfig, SimConfig } from "./config";
const valid: SimConfig = {
  vehicles: 20,
  interval: 5,
  mode: "batch",
  targets: ["pg", "ts"],
  maxRows: 500000,
  maxMinutes: 30,
  dirty: false,
};
describe("Run configuration validation", () => {
  test("accepts valid settings", () =>
    expect(validateConfig(valid)).toEqual({}));
  for (const key of [
    "vehicles",
    "interval",
    "maxRows",
    "maxMinutes",
  ] as const) {
    test.each([NaN, Infinity, -Infinity, 0, 1.5])(
      `rejects missing or invalid ${key}: %s`,
      (value) =>
        expect(validateConfig({ ...valid, [key]: value })).toHaveProperty(key),
    );
  }
  test("checks every missing field together", () =>
    expect(
      Object.keys(
        validateConfig({
          ...valid,
          vehicles: NaN,
          interval: NaN,
          maxRows: NaN,
          maxMinutes: NaN,
        }),
      ),
    ).toHaveLength(4));
  test("enforces the per-row fleet limit", () =>
    expect(
      validateConfig({ ...valid, mode: "per_row", vehicles: 51 }),
    ).toHaveProperty("vehicles"));
  test("requires a write destination", () =>
    expect(validateConfig({ ...valid, targets: [] })).toHaveProperty(
      "targets",
    ));
  test("accepts numeric upper limits", () =>
    expect(
      validateConfig({
        ...valid,
        vehicles: 1000,
        interval: 60,
        maxRows: 5000000,
        maxMinutes: 720,
      }),
    ).toEqual({}));
});

test("burst ignores its disabled interval while other modes require it", () => {
  expect(validateConfig({ ...valid, mode: "burst", interval: NaN })).toEqual(
    {},
  );
  expect(
    validateConfig({ ...valid, mode: "batch", interval: NaN }),
  ).toHaveProperty("interval");
});

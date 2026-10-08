import { expect, test } from "vitest";
import {
  DEFAULT_SCENARIOS,
  generateTelemetry,
  validateScenarios,
  IncidentKind,
} from "./scenarios";
import { VehicleState, CENTER_LAT, CENTER_LON } from "./sim";
const timestamp = "2026-10-07T00:00:00.000Z";
const vehicle: VehicleState = {
  id: 1,
  lat: CENTER_LAT,
  lon: CENTER_LON,
  speed: 40,
  heading: 90,
  alt: 15,
  stop: 0,
};
test.each(["speeding", "longStop", "altitude", "poorGps"] as IncidentKind[])(
  "generates persistent %s incidents",
  (kind) => {
    const cfg = { ...DEFAULT_SCENARIOS, kinds: [kind], chancePercent: 50 };
    const sample = generateTelemetry(vehicle, 5, timestamp, cfg, () => 0.25);
    expect(sample.vehicle.incident?.kind).toBe(kind);
    const later = generateTelemetry(
      sample.vehicle,
      5,
      "2026-10-07T00:00:05.000Z",
      cfg,
      () => 0.9,
    );
    expect(later.vehicle.incident).toEqual(sample.vehicle.incident);
    if (kind !== "longStop") expect(sample.warnings).toContain(kind);
  },
);
test("speeding moves the vehicle using the actual excessive speed", () => {
  const sample = generateTelemetry(
    vehicle,
    60,
    timestamp,
    { ...DEFAULT_SCENARIOS, kinds: ["speeding"], chancePercent: 50 },
    () => 0.25,
  );
  expect(sample.vehicle.speed).toBeGreaterThan(80);
  const distance = Math.hypot(
    (sample.vehicle.lat - vehicle.lat) * 111.32,
    (sample.vehicle.lon - vehicle.lon) *
      111.32 *
      Math.cos((vehicle.lat * Math.PI) / 180),
  );
  expect(distance).toBeCloseTo(sample.vehicle.speed / 60, 3);
});
test("prolonged stops remain stationary across 5 minutes, regardless of tick interval", () => {
  const cfg = {
    ...DEFAULT_SCENARIOS,
    kinds: ["longStop"] as IncidentKind[],
    chancePercent: 50,
  };
  let sample = generateTelemetry(vehicle, 1, timestamp, cfg, () => 0.25);
  expect(sample.warnings).not.toContain("longStop");
  for (let i = 1; i <= 5; i++)
    sample = generateTelemetry(
      sample.vehicle,
      60,
      new Date(Date.parse(timestamp) + i * 60000).toISOString(),
      cfg,
      () => 0.9,
    );
  expect(sample.vehicle.lat).toBe(vehicle.lat);
  expect(sample.vehicle.lon).toBe(vehicle.lon);
  expect(sample.vehicle.speed).toBe(0);
  expect(sample.warnings).toContain("longStop");
});
test("expired and disabled incidents recover to baseline", () => {
  const cfg = {
    ...DEFAULT_SCENARIOS,
    kinds: ["altitude"] as IncidentKind[],
    chancePercent: 0,
  };
  const abnormal = {
    ...vehicle,
    alt: 4000,
    incident: {
      kind: "altitude" as const,
      startedAt: timestamp,
      until: timestamp,
      value: 4000,
    },
  };
  const sample = generateTelemetry(
    abnormal,
    5,
    "2026-10-07T00:01:00Z",
    cfg,
    () => 0.9,
  );
  expect(sample.vehicle.incident).toBeUndefined();
  expect(sample.vehicle.alt).toBeLessThanOrEqual(25);
  expect(sample.warnings).toEqual([]);
  const off = generateTelemetry(
    {
      ...vehicle,
      incident: { ...abnormal.incident, until: "2026-10-07T01:00:00Z" },
    },
    5,
    timestamp,
    { ...cfg, enabled: false },
    () => 0.9,
  );
  expect(off.vehicle.incident).toBeUndefined();
});
test("extreme altitude supports both high and below-zero samples", () => {
  const cfg = {
    ...DEFAULT_SCENARIOS,
    kinds: ["altitude"] as IncidentKind[],
    chancePercent: 50,
  };
  const high = generateTelemetry(vehicle, 5, timestamp, cfg, () => 0.25);
  expect(high.vehicle.alt).toBeGreaterThan(300);
  let calls = 0;
  const low = generateTelemetry(vehicle, 5, timestamp, cfg, () =>
    ++calls === 4 ? 0.75 : 0.25,
  );
  expect(low.vehicle.alt).toBeLessThan(0);
  expect(low.warnings).toContain("altitude");
});
test("empty, non-finite, and out-of-range thresholds are rejected", () => {
  for (const value of [NaN, Infinity, 0, 201])
    expect(
      validateScenarios({ ...DEFAULT_SCENARIOS, speedLimit: value }),
    ).toHaveProperty("speedLimit");
  expect(validateScenarios({ ...DEFAULT_SCENARIOS, kinds: [] })).toHaveProperty(
    "scenarios",
  );
});

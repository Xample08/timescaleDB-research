import { expect, test } from "vitest";
import { FleetVehicle, validPosition, vehicleState } from "./fleet";
const vehicle: FleetVehicle = {
  id: 1,
  plate: "ABC",
  name: null,
  type: null,
  time: "2026-10-08T00:00:00Z",
  latitude: 0,
  longitude: 0,
  speed: 0,
  heading: null,
  altitude: null,
  gps: null,
};
test("zero coordinates are valid, missing and impossible coordinates are excluded", () => {
  expect(validPosition(vehicle)).toBe(true);
  for (const latitude of [null, NaN, 91, -91])
    expect(validPosition({ ...vehicle, latitude })).toBe(false);
  expect(validPosition({ ...vehicle, longitude: 181 })).toBe(false);
});
test("missing and stale samples cannot be mistaken for a current stopped vehicle", () => {
  const now = "2026-10-08T00:02:00Z";
  expect(vehicleState({ ...vehicle, time: null }, now)).toBe("No data");
  expect(vehicleState(vehicle, "2026-10-08T00:02:01Z")).toBe("Stale");
  expect(vehicleState(vehicle, now)).toBe("Stopped");
  expect(vehicleState({ ...vehicle, speed: 2 }, now)).toBe("Moving");
  expect(vehicleState({ ...vehicle, speed: null }, now)).toBe("Unknown speed");
});

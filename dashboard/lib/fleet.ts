import type { WarningReport, WarningTarget } from "./warnings";
export interface FleetVehicle {
  id: number;
  plate: string;
  name: string | null;
  type: string | null;
  time: string | null;
  latitude: number | null;
  longitude: number | null;
  speed: number | null;
  heading: number | null;
  altitude: number | null;
  gps: number | null;
}
export interface FleetReport {
  target: WarningTarget;
  checkedAt: string;
  windowStart: string;
  vehicles: FleetVehicle[];
  summary: {
    samples: number;
    avgSpeed: number | null;
    maxSpeed: number | null;
    avgGps: number | null;
    minAltitude: number | null;
    maxAltitude: number | null;
  };
  hourly: { time: string; samples: number; speed: number | null }[];
  warnings: WarningReport;
}
export function validPosition(v: FleetVehicle) {
  return (
    v.latitude !== null &&
    v.longitude !== null &&
    Number.isFinite(v.latitude) &&
    Number.isFinite(v.longitude) &&
    Math.abs(v.latitude) <= 90 &&
    Math.abs(v.longitude) <= 180
  );
}
export function vehicleState(v: FleetVehicle, now: string) {
  if (!v.time) return "No data";
  if (Date.parse(now) - Date.parse(v.time) > 120000) return "Stale";
  return v.speed === null
    ? "Unknown speed"
    : v.speed <= 1
      ? "Stopped"
      : "Moving";
}

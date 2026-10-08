import { advanceVehicle, getGpsAccuracy, VehicleState } from "./sim";
export type IncidentKind = "speeding" | "longStop" | "altitude" | "poorGps";
export interface ScenarioConfig {
  enabled: boolean;
  kinds: IncidentKind[];
  chancePercent: number;
  speedLimit: number;
  stopMinutes: number;
  altitudeLimit: number;
  gpsLimit: number;
}
export interface Incident {
  kind: IncidentKind;
  startedAt: string;
  until: string;
  value: number;
}
export const DEFAULT_SCENARIOS: ScenarioConfig = {
  enabled: true,
  kinds: ["speeding", "longStop", "altitude", "poorGps"],
  chancePercent: 5,
  speedLimit: 80,
  stopMinutes: 5,
  altitudeLimit: 300,
  gpsLimit: 50,
};
export const SCENARIO_FIELDS = [
  ["chancePercent", "Incident chance (%)", 0, 50],
  ["speedLimit", "Speed limit (km/h)", 30, 150],
  ["stopMinutes", "Stop warning (min)", 1, 60],
  ["altitudeLimit", "Altitude warning (m)", 30, 7000],
  ["gpsLimit", "GPS error warning (m)", 15, 500],
] as const;
export function validateScenarios(
  config: ScenarioConfig,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (
    typeof config.enabled !== "boolean" ||
    !Array.isArray(config.kinds) ||
    config.kinds.some((k) => !DEFAULT_SCENARIOS.kinds.includes(k))
  )
    errors.scenarios = "Invalid warning scenarios.";
  if (!config.enabled) return errors;
  if (!config.kinds?.length)
    errors.scenarios = "Select at least one warning scenario.";
  for (const [key, label, min, max] of SCENARIO_FIELDS)
    if (
      !Number.isInteger(config[key]) ||
      config[key] < min ||
      config[key] > max
    )
      errors[key] = `${label}: enter a whole number from ${min} to ${max}.`;
  return errors;
}
export function generateTelemetry(
  v: VehicleState,
  dt: number,
  timestamp: string,
  config: ScenarioConfig | undefined,
  rng: () => number,
) {
  const now = Date.parse(timestamp);
  let incident =
    config?.enabled &&
    v.incident &&
    config.kinds.includes(v.incident.kind) &&
    Date.parse(v.incident.until) > now
      ? v.incident
      : undefined;
  if (
    config?.enabled &&
    config.kinds.length &&
    !incident &&
    rng() * 100 < config.chancePercent
  ) {
    const kind =
      config.kinds[
        Math.min(
          config.kinds.length - 1,
          Math.floor(rng() * config.kinds.length),
        )
      ];
    const between = (min: number, max: number) => min + rng() * (max - min);
    const duration =
      kind === "longStop"
        ? config.stopMinutes * 60 + between(120, 600)
        : between(20, 90);
    const value =
      kind === "speeding"
        ? between(config.speedLimit + 10, Math.min(200, config.speedLimit + 50))
        : kind === "altitude"
          ? rng() < 0.5
            ? between(
                config.altitudeLimit + 100,
                Math.min(9000, config.altitudeLimit + 2000),
              )
            : between(-300, -50)
          : kind === "poorGps"
            ? between(config.gpsLimit + 25, config.gpsLimit + 500)
            : 0;
    incident = {
      kind,
      startedAt: timestamp,
      until: new Date(now + duration * 1000).toISOString(),
      value: Number(value.toFixed(1)),
    };
  }
  const speedOverride =
    incident?.kind === "speeding"
      ? incident.value
      : incident?.kind === "longStop"
        ? 0
        : undefined;
  const next = advanceVehicle(
    { ...v, incident, stop: speedOverride === undefined ? v.stop : 0 },
    dt,
    rng,
    speedOverride,
  );
  if (incident?.kind === "altitude") next.alt = incident.value;
  const stoppedSince =
    next.speed <= 1 ? v.stoppedSince || timestamp : undefined;
  next.stoppedSince = stoppedSince;
  const accuracy =
    incident?.kind === "poorGps" ? incident.value : getGpsAccuracy(rng);
  const warnings: IncidentKind[] = [];
  if (config?.enabled) {
    if (next.speed > config.speedLimit) warnings.push("speeding");
    if (
      stoppedSince &&
      now - Date.parse(stoppedSince) >= config.stopMinutes * 60000
    )
      warnings.push("longStop");
    if (next.alt > config.altitudeLimit || next.alt < 0)
      warnings.push("altitude");
    if (accuracy > config.gpsLimit) warnings.push("poorGps");
  }
  return { vehicle: next, accuracy, warnings };
}

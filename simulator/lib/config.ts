export type SimMode = "batch" | "per_row" | "burst";
export interface SimConfig {
  vehicles: number;
  interval: number;
  mode: SimMode;
  targets: string[];
  maxRows: number;
  maxMinutes: number;
  dirty: boolean;
}
export function validateConfig(c: SimConfig) {
  const errors: Record<string, string> = {};
  for (const [key, label, min, max] of [
    ["vehicles", "Vehicles", 1, c.mode === "per_row" ? 50 : 1000],
    ["interval", "Interval", 1, 60],
    ["maxRows", "Row limit", 1000, 5000000],
    ["maxMinutes", "Time limit", 1, 720],
  ] as const) {
    if (key === "interval" && c.mode === "burst") continue;
    if (!Number.isInteger(c[key]) || c[key] < min || c[key] > max)
      errors[key] =
        `${label}: enter a whole number from ${min.toLocaleString()} to ${max.toLocaleString()}.`;
  }
  if (!c.targets.length) errors.targets = "Select at least one database.";
  return errors;
}

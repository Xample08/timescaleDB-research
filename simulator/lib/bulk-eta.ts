export interface BatchTiming {
  rows: number;
  milliseconds: number;
}
export function estimateBulkEta(samples: BatchTiming[], remaining: number) {
  const recent = samples
    .slice(-10)
    .filter(
      (s) =>
        s.rows > 0 &&
        s.milliseconds > 0 &&
        Number.isFinite(s.rows) &&
        Number.isFinite(s.milliseconds),
    );
  const rows = recent.reduce((sum, s) => sum + s.rows, 0),
    milliseconds = recent.reduce((sum, s) => sum + s.milliseconds, 0);
  if (!rows || !milliseconds) return null;
  const rowsPerSecond = (rows / milliseconds) * 1000;
  return {
    rowsPerSecond,
    remainingMs: (Math.max(0, remaining) / rowsPerSecond) * 1000,
    averageBatchMs: milliseconds / recent.length,
    early: recent.length < 3,
  };
}
export function etaDuration(milliseconds: number) {
  if (!Number.isFinite(milliseconds)) return "Calculating...";
  let seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  if (seconds < 60) return `${seconds}s`;
  const days = Math.floor(seconds / 86400);
  seconds %= 86400;
  const hours = Math.floor(seconds / 3600);
  seconds %= 3600;
  const minutes = Math.floor(seconds / 60);
  return (
    [
      days ? `${days}d` : "",
      hours ? `${hours}h` : "",
      minutes ? `${minutes}m` : "",
    ]
      .filter(Boolean)
      .join(" ") || "Less than 1 minute"
  );
}

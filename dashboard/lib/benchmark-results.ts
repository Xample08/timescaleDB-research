import { percentile } from "./bench";
export interface Measurement {
  variant: string;
  executionMs: number;
  rowsReturned: number;
  sharedHit?: number;
  sharedRead?: number;
  chunksScanned?: number | null;
  inputRows?: number;
  error?: string | null;
}
export interface BenchmarkResult {
  queryId: string;
  variant: string;
  medianMs: number | null;
  p95Ms: number | null;
  minMs: number | null;
  maxMs: number | null;
  rowsReturned: number;
  sharedHit: number;
  sharedRead: number;
  chunksScanned: number | null;
  valid: boolean;
  reason?: string;
  successfulRuns?: number;
  requestedRuns?: number;
}
export function aggregateMeasurements(
  queryId: string,
  variants: readonly string[],
  repetitions: Measurement[][],
): BenchmarkResult[] {
  const mismatch = repetitions.some((rep) => {
    const rows = variants
      .map((variant) => rep.find((r) => r.variant === variant))
      .filter((r): r is Measurement => !!r && !r.error);
    return rows.some((r) => r.rowsReturned !== rows[0]?.rowsReturned);
  });
  return variants.map((variant) => {
    const raw = repetitions.map((rep) =>
      rep.find((r) => r.variant === variant),
    );
    const successful = raw.filter(
      (r): r is Measurement =>
        !!r && !r.error && Number.isFinite(r.executionMs) && r.executionMs >= 0,
    );
    const values = successful.map((r) => r.executionMs);
    const sorted = [...values].sort((a, b) => a - b);
    const midpoint = Math.floor(sorted.length / 2);
    const median = sorted.length
      ? sorted.length % 2
        ? sorted[midpoint]
        : (sorted[midpoint - 1] + sorted[midpoint]) / 2
      : null;
    const last = successful.at(-1);
    const failure = raw.find((r) => r?.error)?.error;
    const empty = successful.some(
      (r) => r.rowsReturned === 0 || r.inputRows === 0,
    );
    const reason =
      failure ||
      (successful.length !== repetitions.length
        ? "Incomplete measurements"
        : mismatch
          ? "Row counts differ between databases"
          : empty
            ? "No matching telemetry"
            : values.some((v) => v === 0)
              ? "Timing below measurement resolution"
              : undefined);
    return {
      queryId,
      variant,
      medianMs: median,
      p95Ms: values.length ? percentile(values, 95) : null,
      minMs: values.length ? Math.min(...values) : null,
      maxMs: values.length ? Math.max(...values) : null,
      rowsReturned: last?.rowsReturned || 0,
      sharedHit: last?.sharedHit || 0,
      sharedRead: last?.sharedRead || 0,
      chunksScanned: last?.chunksScanned ?? null,
      valid: !reason,
      reason,
      successfulRuns: successful.length,
      requestedRuns: repetitions.length,
    };
  });
}

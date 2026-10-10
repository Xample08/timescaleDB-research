import { CATALOG } from "@/lib/bench";
import { SERIES_COLORS } from "./ui";
const names = {
  pg: "PostgreSQL",
  ts: "TimescaleDB",
  ts_cagg: "Timescale CAGG",
};
type Key = keyof typeof names;
type Point = {
  name: string;
  pg?: number | null;
  ts?: number | null;
  ts_cagg?: number | null;
  eligible?: Partial<Record<Key, boolean>>;
  reasons?: Partial<Record<Key, string>>;
};
export function BenchmarkChart({
  data,
  logScale,
}: {
  data: Point[];
  logScale: boolean;
}) {
  return (
    <div className="benchmark-chart">
      <p className="helper">
        Median execution time / Lower is faster. Each query has its own scale.{" "}
        {logScale ? "Log scale expands small timings." : "Linear scale."} Tiny
        bars have a minimum visible width; exact timings are shown beside them.
        Fastest median is descriptive, not statistical significance.
      </p>
      <div className="benchmark-chart-rows">
        {data.map((row) => {
          const entries = (Object.keys(names) as Key[])
            .filter((key) => key in row)
            .map((key) => ({
              key,
              value: row[key],
              eligible: !!row.eligible?.[key],
              reason: row.reasons?.[key],
            }));
          const measured = entries.filter(
            (e) => e.value != null && Number.isFinite(e.value) && e.value > 0,
          );
          const fastest = measured.length
            ? Math.min(...measured.map((e) => e.value!))
            : 0;
          const slowest = measured.length
            ? Math.max(...measured.map((e) => e.value!))
            : 0;
          const comparable =
            entries.length > 1 && entries.every((e) => e.eligible);
          const winners = comparable
            ? entries.filter((e) => e.value === fastest)
            : [];
          const transform = (value: number) =>
            logScale ? Math.log1p(value / (fastest || 1)) : value;
          return (
            <div className="benchmark-chart-row" key={row.name}>
              <div className="benchmark-chart-label">
                <b>{row.name}</b>
                <span>{CATALOG.find((q) => q.id === row.name)?.title}</span>
              </div>
              <div className="benchmark-outcome">
                {winners.length === 1 ? (
                  <>
                    <span className="benchmark-winner">
                      Fastest median: {names[winners[0].key]}
                    </span>
                    <small>
                      {fastest > 0
                        ? `${(slowest / fastest).toFixed(2)}x faster than slowest`
                        : ""}
                    </small>
                  </>
                ) : winners.length > 1 ? (
                  <span className="benchmark-winner">Joint fastest median</span>
                ) : (
                  <span className="benchmark-ineligible">
                    No winner / incomplete, empty or invalid comparison
                  </span>
                )}
              </div>
              {entries.map((entry) => {
                const validTiming =
                  entry.value != null &&
                  Number.isFinite(entry.value) &&
                  entry.value >= 0;
                const width =
                  validTiming && slowest
                    ? (transform(entry.value!) / transform(slowest)) * 100
                    : 0;
                const winner = winners.some((e) => e.key === entry.key);
                return (
                  <div
                    key={entry.key}
                    className={`benchmark-lane ${winner ? "is-winner" : ""}`}
                  >
                    <span
                      className="benchmark-lane-name"
                      style={{ color: SERIES_COLORS[entry.key] }}
                    >
                      {names[entry.key]}
                      {winner && <b aria-label="Fastest median"> / Best</b>}
                    </span>
                    <div
                      className="benchmark-lane-track"
                      role="img"
                      aria-label={`${names[entry.key]}: ${validTiming ? entry.value!.toFixed(3) + " ms" : "unavailable"}${winner ? ", fastest median" : ""}`}
                    >
                      {validTiming && (
                        <div
                          className={`benchmark-lane-bar ${width < 3 ? "minimum-width" : ""}`}
                          style={{
                            width: `${Math.max(3, width)}%`,
                            background: SERIES_COLORS[entry.key],
                          }}
                        />
                      )}
                    </div>
                    <span className="benchmark-lane-value">
                      {validTiming
                        ? `${entry.value!.toFixed(3)} ms`
                        : "Unavailable"}
                    </span>
                    {entry.reason && (
                      <small className="benchmark-lane-reason">
                        {entry.reason}
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

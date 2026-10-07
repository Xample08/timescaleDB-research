import React from "react";
import { ResizablePanels } from "./ResizablePanels";
import { Icon } from "./Icon";
import { Badge, SERIES_COLORS } from "./ui";
import { formatMs, formatInt, formatDuration } from "@/lib/format";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
} from "recharts";
import { SimConfig } from "./ControlPanel";

export interface TickMetric {
  tickNo: number;
  time: number; // timestamp ms
  attempted: number;
  inserted: { pg?: number; ts?: number };
  latencyMs: { pg?: number; ts?: number };
  late: number;
  duplicates: number;
  errors: { pg: string | null; ts: string | null };
}

export interface MetricsState {
  status: "idle" | "starting" | "running" | "stopping" | "failed";
  message: string | null;
  elapsedSec: number;
  totalTicks: number;
  lateTicks: number;
  errorCount: number;
  insertedPg: number;
  insertedTs: number;
  lateRows: number;
  dupRows: number;
  skippedRows: number;
  ratePg: number;
  rateTs: number;
  p50Pg: number;
  p95Pg: number;
  p50Ts: number;
  p95Ts: number;
  chartData: Record<string, unknown>[]; // { tickNo, pg, ts }
}

interface Props {
  metrics: MetricsState;
  config: SimConfig;
}

export function MetricsPanel({ metrics, config }: Props) {
  const {
    status,
    message,
    elapsedSec,
    totalTicks,
    lateTicks,
    errorCount,
    insertedPg,
    insertedTs,
    ratePg,
    rateTs,
    p50Pg,
    p95Pg,
    p50Ts,
    p95Ts,
    chartData,
    lateRows,
    dupRows,
    skippedRows,
  } = metrics;

  let tone: "neutral" | "ok" | "warn" | "error" = "neutral";
  if (status === "running") tone = "ok";
  if (status === "failed") tone = "error";
  if (status === "starting" || status === "stopping") tone = "warn";

  return (
    <div className="metrics-layout">
      <div className="run-summary panel">
        <div>
          <Badge tone={tone}>
            <span className="status-dot" /> {status.toUpperCase()}
          </Badge>
          <span className="summary-message" role="status">
            {message || "Ready when you are"}
          </span>
        </div>
        <div className="summary-numbers">
          <span>
            <Icon name="clock" /> <b>{formatDuration(elapsedSec)}</b> elapsed
          </span>
          <span>
            <Icon name="refresh" /> <b>{formatInt(totalTicks)}</b> ticks
          </span>
          <span>
            <Icon name="warning" /> <b>{lateTicks}</b> late /{" "}
            <b>{errorCount}</b> errors
          </span>
        </div>
      </div>
      <ResizablePanels
        direction="vertical"
        label="Reports and latency chart"
        className="metrics-split"
        initialSizes={[45, 55]}
      >
        <ResizablePanels
          className="database-grid"
          label="Database reports"
          initialSizes={[50, 50]}
        >
          {(["pg", "ts"] as const).map((t) => {
            const pg = t === "pg";
            return (
              <section
                key={t}
                className={`database-report panel ${t} ${!config.targets.includes(t) ? "inactive" : ""}`}
              >
                <div className="database-heading">
                  <span className="database-symbol">
                    <Icon name={pg ? "database" : "bolt"} />
                  </span>
                  <div>
                    <h2>{pg ? "PostgreSQL" : "TimescaleDB"}</h2>
                    <p>
                      {pg
                        ? "Standard relational table"
                        : "Time-partitioned hypertable"}
                    </p>
                  </div>
                  <span className="database-tag">
                    {config.targets.includes(t) ? "SELECTED" : "INACTIVE"}
                  </span>
                </div>
                <div className="report-values">
                  <div>
                    <span>
                      <Icon name="download" /> Rows inserted
                    </span>
                    <strong>{formatInt(pg ? insertedPg : insertedTs)}</strong>
                    <small>
                      {formatInt(pg ? ratePg : rateTs)} rows / second
                    </small>
                  </div>
                  <div>
                    <span>
                      <Icon name="bolt" /> Median latency
                    </span>
                    <strong>{formatMs(pg ? p50Pg : p50Ts)}</strong>
                    <small>p95: {formatMs(pg ? p95Pg : p95Ts)}</small>
                  </div>
                </div>
              </section>
            );
          })}
        </ResizablePanels>
        <section className="chart-panel panel">
          <div className="chart-heading">
            <div>
              <h2>Insert latency</h2>
              <p>Compare response times across the last 300 ticks</p>
            </div>
            <div className="chart-key">
              <span className="pg">
                <span className="status-dot" /> PostgreSQL
              </span>
              <span className="ts">
                <span className="status-dot" /> TimescaleDB
              </span>
            </div>
          </div>
          <div className="latency-chart">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart
                data={chartData}
                margin={{ top: 12, right: 16, bottom: 0, left: 0 }}
              >
                <CartesianGrid
                  strokeDasharray="3 5"
                  stroke="#29364b"
                  vertical={false}
                />
                <XAxis
                  dataKey="tickNo"
                  fontSize={11}
                  stroke="#94a3b8"
                  tickLine={false}
                  axisLine={false}
                />
                <YAxis
                  fontSize={11}
                  stroke="#94a3b8"
                  tickFormatter={(v) => `${v} ms`}
                  width={58}
                  tickLine={false}
                  axisLine={false}
                />
                <Tooltip
                  labelFormatter={(lbl) => `Tick ${lbl}`}
                  contentStyle={{
                    background: "#162236",
                    border: "1px solid #334155",
                    borderRadius: 8,
                    color: "#e2e8f0",
                  }}
                  labelStyle={{ color: "#cbd5e1" }}
                />
                {config.targets.includes("pg") && (
                  <Line
                    dataKey="pg"
                    name="PostgreSQL"
                    stroke={SERIES_COLORS.pg}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}{" "}
                {config.targets.includes("ts") && (
                  <Line
                    dataKey="ts"
                    name="TimescaleDB"
                    stroke={SERIES_COLORS.ts}
                    strokeWidth={2}
                    dot={false}
                    isAnimationActive={false}
                  />
                )}
              </LineChart>
            </ResponsiveContainer>
            {!chartData.length && (
              <div className="chart-empty">
                <span>
                  <Icon name="chart" />
                </span>
                <b>Your comparison starts here</b>
                <p>Run the simulation to see live insert latency.</p>
              </div>
            )}
          </div>
        </section>
      </ResizablePanels>
      <div className="quality-strip">
        <span>
          <Icon name="check" /> Data quality
        </span>
        <span>{formatInt(lateRows)} late records</span>
        <span>{formatInt(dupRows)} duplicates</span>
        <span>{formatInt(skippedRows)} skipped</span>
        <span>
          {status === "running"
            ? "Keep this tab open while running"
            : "Identical telemetry sent to each selected database"}
        </span>
      </div>
    </div>
  );
}

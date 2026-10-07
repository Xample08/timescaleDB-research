import React from "react";
import { Card, StatCard, Badge, SERIES_COLORS } from "./ui";
import { formatMs, formatInt, formatDuration } from "@/lib/format";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
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
  const { status, message, elapsedSec, totalTicks, lateTicks, errorCount, insertedPg, insertedTs, ratePg, rateTs, p50Pg, p95Pg, p50Ts, p95Ts, chartData, lateRows, dupRows, skippedRows } = metrics;
  
  let tone: "neutral" | "ok" | "warn" | "error" = "neutral";
  if (status === "running") tone = "ok";
  if (status === "failed") tone = "error";
  if (status === "starting" || status === "stopping") tone = "warn";

  return (
    <div className="flex flex-col h-full min-h-0 min-w-0 gap-4">
      {status === "running" && (
        <div className="rounded-md bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
          Simulation runs only while this tab stays open and visible.
        </div>
      )}
      
      {message && status === "failed" && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/30 dark:text-red-300">
          {message}
        </div>
      )}
      {message && status !== "failed" && (
        <div className="rounded-md bg-slate-100 p-3 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-300">
          {message}
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6 min-w-0">
        <StatCard label="Status" value={<Badge tone={tone}>{status.toUpperCase()}</Badge>} />
        <StatCard label="Elapsed" value={formatDuration(elapsedSec)} />
        <StatCard label="Ticks" value={formatInt(totalTicks)} hint={`${lateTicks} late, ${errorCount} err`} />
        
        {config.targets.includes("pg") && (
          <StatCard label="Inserted PG" value={formatInt(insertedPg)} hint={`${formatInt(ratePg)} /s`} />
        )}
        {config.targets.includes("ts") && (
          <StatCard label="Inserted TS" value={formatInt(insertedTs)} hint={`${formatInt(rateTs)} /s`} />
        )}
        {config.targets.includes("pg") && (
          <StatCard label="Latency PG" value={formatMs(p50Pg)} hint={`p95: ${formatMs(p95Pg)}`} />
        )}
        {config.targets.includes("ts") && (
          <StatCard label="Latency TS" value={formatMs(p50Ts)} hint={`p95: ${formatMs(p95Ts)}`} />
        )}
        {config.dirty && (
          <StatCard label="Dirty Data" value={formatInt(lateRows + dupRows)} hint={`${formatInt(skippedRows)} skipped`} />
        )}
      </div>

      <Card title="Latency per tick (last 300)" className="flex-1">
        <div className="h-80 w-full min-w-0">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#cbd5e1" vertical={false} />
              <XAxis dataKey="tickNo" fontSize={11} stroke="#64748b" />
              <YAxis fontSize={11} stroke="#64748b" tickFormatter={(v) => `${v} ms`} width={60} />
              <Tooltip 
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                formatter={(val: any) => [typeof val === 'number' ? `${val.toFixed(2)} ms` : val, undefined]}
                labelFormatter={(lbl) => `Tick ${lbl}`}
                contentStyle={{ fontSize: '12px' }}
              />
              <Legend verticalAlign="top" height={36} />
              {config.targets.includes("pg") && (
                <Line type="linear" dataKey="pg" name="PostgreSQL" stroke={SERIES_COLORS.pg} strokeWidth={2} dot={false} isAnimationActive={false} />
              )}
              {config.targets.includes("ts") && (
                <Line type="linear" dataKey="ts" name="TimescaleDB" stroke={SERIES_COLORS.ts} strokeWidth={2} dot={false} isAnimationActive={false} />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

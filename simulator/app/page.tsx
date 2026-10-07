"use client";

import { Icon } from "@/components/Icon";
import React, { useState, useEffect, useRef } from "react";
import { SqlWindow, QueryEvent } from "@/components/SqlWindow";
import {
  ControlPanel,
  SimConfig,
  validateConfig,
} from "@/components/ControlPanel";
import {
  MetricsPanel,
  MetricsState,
  TickMetric,
} from "@/components/MetricsPanel";
import { VehicleState, percentile } from "@/lib/sim";

export default function SimulatorPage() {
  const [config, setConfig] = useState<SimConfig>({
    vehicles: 20,
    interval: 5,
    mode: "batch",
    targets: ["pg", "ts"],
    maxRows: 500000,
    maxMinutes: 30,
    dirty: false,
  });

  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const [queries, setQueries] = useState<Record<string, QueryEvent>>({});
  const [password, setPassword] = useState("");

  const [metrics, setMetrics] = useState<MetricsState>({
    status: "idle",
    message: null,
    elapsedSec: 0,
    totalTicks: 0,
    lateTicks: 0,
    errorCount: 0,
    insertedPg: 0,
    insertedTs: 0,
    lateRows: 0,
    dupRows: 0,
    skippedRows: 0,
    ratePg: 0,
    rateTs: 0,
    p50Pg: 0,
    p95Pg: 0,
    p50Ts: 0,
    p95Ts: 0,
    chartData: [],
  });

  const stateRef = useRef({
    status: "idle" as MetricsState["status"],
    vehicles: [] as VehicleState[],
    lastTimestamp: null as string | null,
    startTime: 0,
    tickNo: 0,
    consecutiveErrors: 0,
    stopRequested: false,
    history: [] as TickMetric[],
    wakeLock: null as unknown,
  });

  // Wake lock
  const requestWakeLock = async () => {
    if ("wakeLock" in navigator) {
      try {
        const wl = await (
          navigator as unknown as {
            wakeLock: { request: (type: string) => Promise<unknown> };
          }
        ).wakeLock.request("screen");
        stateRef.current.wakeLock = wl;
      } catch {}
    }
  };
  const releaseWakeLock = () => {
    if (stateRef.current.wakeLock) {
      (stateRef.current.wakeLock as { release: () => Promise<void> })
        .release()
        .catch(() => {});
      stateRef.current.wakeLock = null;
    }
  };

  const updateMetrics = (partial: Partial<MetricsState>) => {
    setMetrics((m) => ({ ...m, ...partial }));
    if (partial.status) {
      stateRef.current.status = partial.status;
    }
  };

  const calcStats = () => {
    const s = stateRef.current;
    const now = Date.now();
    const elapsed = s.startTime > 0 ? (now - s.startTime) / 1000 : 0;

    let totalPg = 0,
      totalTs = 0;
    let lateR = 0,
      dup = 0,
      skip = 0;

    // recent for rate
    const recentCutoff = now - 30000;
    let ratePgSum = 0,
      rateTsSum = 0;

    // latencies
    const recent300 = s.history.slice(-300);
    const latPg: number[] = [];
    const latTs: number[] = [];

    for (const h of s.history) {
      totalPg += h.inserted.pg || 0;
      totalTs += h.inserted.ts || 0;
      lateR += h.late || 0;
      dup += h.duplicates || 0;

      const attPg = h.inserted.pg !== undefined ? h.attempted : 0;
      const attTs = h.inserted.ts !== undefined ? h.attempted : 0;
      skip +=
        Math.max(0, attPg - (h.inserted.pg || 0)) +
        Math.max(0, attTs - (h.inserted.ts || 0));

      if (h.time >= recentCutoff) {
        ratePgSum += h.inserted.pg || 0;
        rateTsSum += h.inserted.ts || 0;
      }
    }

    for (const h of recent300) {
      if (h.latencyMs.pg !== undefined) latPg.push(h.latencyMs.pg);
      if (h.latencyMs.ts !== undefined) latTs.push(h.latencyMs.ts);
    }

    const ratePg = ratePgSum / 30;
    const rateTs = rateTsSum / 30;

    const p50Pg = percentile(latPg, 50);
    const p95Pg = percentile(latPg, 95);
    const p50Ts = percentile(latTs, 50);
    const p95Ts = percentile(latTs, 95);

    const chartData = recent300.map((h) => ({
      tickNo: h.tickNo,
      pg: h.latencyMs.pg,
      ts: h.latencyMs.ts,
    }));

    // Check limits
    const maxInserted = Math.max(totalPg, totalTs);
    if (s.status === "running") {
      if (
        maxInserted >= configRef.current.maxRows ||
        elapsed / 60 >= configRef.current.maxMinutes
      ) {
        stateRef.current.stopRequested = true;
        updateMetrics({ message: "Limit reached" });
      }
    }

    updateMetrics({
      elapsedSec: elapsed,
      totalTicks: s.tickNo,
      lateTicks: s.history.filter(
        (h) => (h as TickMetric & { isLateTick?: boolean }).isLateTick,
      ).length,
      errorCount: s.consecutiveErrors, // wait, spec says "error count" in metrics panel, "error count increases"
      insertedPg: totalPg,
      insertedTs: totalTs,
      lateRows: lateR,
      dupRows: dup,
      skippedRows: skip,
      ratePg,
      rateTs,
      p50Pg,
      p95Pg,
      p50Ts,
      p95Ts,
      chartData,
    });
  };

  const doTick = async (targetTime: number) => {
    const s = stateRef.current;
    if (s.status !== "running" || s.stopRequested) {
      updateMetrics({
        status: "idle",
        message: s.stopRequested
          ? metrics.message || "Stopped"
          : metrics.message,
      });
      releaseWakeLock();
      return;
    }

    // eslint-disable-next-line react-hooks/purity
    const now = Date.now();
    const isLateTick =
      config.mode !== "burst" && now - targetTime > config.interval * 500;

    try {
      const res = await fetch("/api/tick", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/x-ndjson",
          "x-sim-password": password,
        },
        body: JSON.stringify({
          vehicles: s.vehicles,
          dt: config.mode === "burst" ? 1 : config.interval,
          mode: config.mode === "burst" ? "batch" : config.mode,
          targets: config.targets,
          dirty: config.dirty,
          tickNo: s.tickNo,
          lastTimestamp: s.lastTimestamp,
        }),
      });

      if (res.status === 401 || res.status === 422) {
        const body = await res.json().catch(() => ({}));
        updateMetrics({
          status: "failed",
          message: body.error || "Client error",
        });
        releaseWakeLock();
        return;
      }

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }

      if (!res.body) throw new Error("Missing execution stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let result: { status: number; data: Record<string, unknown> } | undefined;
      while (true) {
        const { value, done } = await reader.read();
        pending += decoder.decode(value, { stream: !done });
        const lines = pending.split("\n");
        pending = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "query")
            setQueries((q) => ({ ...q, [event.target]: event }));
          if (event.type === "query-error")
            setQueries((q) => ({
              ...q,
              [event.target]: {
                ...q[event.target],
                phase: "failed",
                error: event.error,
              },
            }));
          if (event.type === "result") result = event;
        }
        if (done) break;
      }
      if (!result) throw new Error("Execution stream ended without a result");
      if (result.status === 401 || result.status === 422) {
        updateMetrics({
          status: "failed",
          message: String(result.data.error || "Invalid configuration"),
        });
        releaseWakeLock();
        return;
      }
      if (result.status !== 200)
        throw new Error(String(result.data.error || "Execution failed"));
      // The streamed result has the same payload as the JSON tick endpoint.
      const data = result.data as unknown as {
        vehicles: VehicleState[];
        timestamp: string;
        attempted: number;
        inserted: TickMetric["inserted"];
        latencyMs: TickMetric["latencyMs"];
        late: number;
        duplicates: number;
        errors: TickMetric["errors"];
      };
      s.consecutiveErrors =
        data.errors && (data.errors.pg || data.errors.ts)
          ? s.consecutiveErrors + 1
          : 0;

      if (s.consecutiveErrors >= 10) {
        updateMetrics({ status: "failed", message: "10 consecutive errors" });
        releaseWakeLock();
        return;
      }

      s.vehicles = data.vehicles;
      s.lastTimestamp = data.timestamp;

      const metric: TickMetric & { isLateTick: boolean } = {
        tickNo: s.tickNo,
        time: now,
        attempted: data.attempted,
        inserted: data.inserted,
        latencyMs: data.latencyMs,
        late: data.late,
        duplicates: data.duplicates,
        errors: data.errors,
        isLateTick,
      };

      s.history.push(metric);
      if (s.history.length > 600) s.history.shift();
      s.tickNo++;

      calcStats();

      // schedule next
      let nextTarget = targetTime + config.interval * 1000;
      if (config.mode === "burst") {
        nextTarget = new Date().getTime();
      }

      const delay = Math.max(0, nextTarget - new Date().getTime());
      setTimeout(() => doTick(nextTarget), delay);
    } catch (err: unknown) {
      s.consecutiveErrors++;
      updateMetrics({ errorCount: s.consecutiveErrors });
      if (s.consecutiveErrors >= 10) {
        updateMetrics({
          status: "failed",
          message: "10 consecutive errors: " + (err as Error).message,
        });
        releaseWakeLock();
        return;
      }

      // backoff 1, 2, 4, 8, 16
      const backoff = Math.min(30, Math.pow(2, s.consecutiveErrors - 1)) * 1000;
      setTimeout(() => doTick(targetTime + backoff), backoff);
    }
  };

  const handleStart = async () => {
    if (Object.keys(validateConfig(config)).length || !password) {
      updateMetrics({
        status: "failed",
        message:
          "Check all numeric inputs, destinations, and password before running.",
      });
      return;
    }
    setQueries({});
    updateMetrics({
      status: "starting",
      message: "Initializing...",
      chartData: [],
    });
    stateRef.current = {
      status: "starting",
      vehicles: [],
      lastTimestamp: null,
      startTime: 0,
      tickNo: 0,
      consecutiveErrors: 0,
      stopRequested: false,
      history: [],
      wakeLock: null,
    };

    try {
      const res = await fetch(`/api/tick?n=${config.vehicles}`, {
        headers: { "x-sim-password": password },
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        updateMetrics({
          status: "failed",
          message: body.error || "Initialization failed",
        });
        return;
      }
      const data = await res.json();
      stateRef.current.vehicles = data.vehicles;
      stateRef.current.status = "running";
      stateRef.current.startTime = Date.now();
      updateMetrics({
        status: "running",
        message: `Started. Resumed ${data.resumed} vehicles.`,
      });

      await requestWakeLock();

      doTick(Date.now());
    } catch (err: unknown) {
      const error = err as Error;
      updateMetrics({ status: "failed", message: error.message });
    }
  };

  const handleStop = () => {
    if (stateRef.current.status === "running") {
      updateMetrics({ status: "stopping", message: "Stopping..." });
      stateRef.current.stopRequested = true;
    }
  };

  // Update timer for elapsed
  useEffect(() => {
    const timer = setInterval(() => {
      if (stateRef.current.status === "running") {
        calcStats();
      }
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="simulator-shell">
      <header className="topbar">
        <a
          href="#simulator"
          className="brand"
          aria-label="Telemetry Lab simulator"
        >
          <span className="brand-mark">
            <Icon name="bolt" />
          </span>
          <span>
            Telemetry Lab<small>DATABASE RESEARCH</small>
          </span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#simulator" aria-current="page">
            <Icon name="simulator" />
            Simulator
          </a>
          <a href="#sql-activity">
            <Icon name="sql" />
            SQL activity
          </a>
        </nav>
        <span className="topbar-caption">
          PostgreSQL <span>vs</span> TimescaleDB
        </span>
      </header>
      <div className="page-heading" id="simulator">
        <div>
          <p className="eyebrow">LIVE INGESTION WORKSPACE</p>
          <h1>
            Fleet simulator<span> / </span>
            <small>Compare every write.</small>
          </h1>
        </div>
        <span className="environment-badge">
          <span className="status-dot" />
          Vehicle telemetry
        </span>
      </div>
      <div className="workspace-grid">
        <ControlPanel
          config={config}
          onChange={setConfig}
          password={password}
          onPasswordChange={setPassword}
          isRunning={["running", "starting", "stopping"].includes(
            metrics.status,
          )}
          onStart={handleStart}
          onStop={handleStop}
        />
        <div className="results-workspace">
          <MetricsPanel metrics={metrics} config={config} />
          <SqlWindow queries={queries} targets={config.targets} />
        </div>
      </div>
    </main>
  );
}

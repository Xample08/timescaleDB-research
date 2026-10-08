"use client";
import { useSqlFetch } from "./SqlExecution";
import { useEffect, useState } from "react";
import { StatCard, Spinner } from "./ui";
import { formatInt, formatDuration } from "@/lib/format";

export function StatusStrip() {
  const sqlFetch = useSqlFetch("Status");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Exact row count mode (count(*) vs approximate_row_count)
  const [exactMode, setExactMode] = useState(false);
  const [loadingExact, setLoadingExact] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  // Poll status periodically (5s for estimated, 20s for exact to avoid DB overhead)
  useEffect(() => {
    let mounted = true;
    let timer: any;

    const doFetch = async () => {
      if (!mounted || document.hidden) return;
      if (exactMode) setLoadingExact(true);
      try {
        const url = exactMode ? "/api/status?exact=true" : "/api/status";
        const res = await sqlFetch(url);
        const json = await res.json();
        if (!mounted) return;
        if (res.ok) {
          setData(json);
          setError(null);
          setLastUpdate(new Date());
        } else {
          setError(json.error || "Failed to fetch status");
        }
      } catch (err: any) {
        if (!mounted) return;
        setError(err.message);
      } finally {
        if (mounted && exactMode) setLoadingExact(false);
      }
    };

    doFetch();
    const intervalMs = exactMode ? 20000 : 5000;
    timer = setInterval(doFetch, intervalMs);

    const onVis = () => {
      if (!document.hidden && mounted) {
        doFetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mounted = false;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [exactMode, refreshCount]);

  const handleToggleExact = (enable: boolean) => {
    if (enable === exactMode) return;
    setExactMode(enable);
  };

  const handleRecount = () => {
    setRefreshCount((prev) => prev + 1);
  };

  if (!data && !error) {
    return (
      <div className="h-24 flex items-center justify-center border-b border-slate-200 dark:border-slate-800">
        <Spinner />
      </div>
    );
  }

  const chunksCompressed = data?.chunks?.compressed || 0;
  const chunksTotal = data?.chunks?.total || 0;
  const isExactData = !!data?.approxRows?.isExact;

  return (
    <div className="mb-4">
      {/* Top Header Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
          {error ? (
            <span className="text-red-500 font-medium">
              Update failed: {error}
            </span>
          ) : (
            lastUpdate && (
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Updated {lastUpdate.toLocaleTimeString()}
              </span>
            )
          )}

          {loadingExact && (
            <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400 font-medium ml-2 animate-pulse">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
              Calculating real count(*)...
            </span>
          )}
        </div>

        {/* Row count mode toggle */}
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-600 dark:text-slate-300">
            Row Count:
          </span>
          <div className="inline-flex rounded-lg border border-slate-200 bg-slate-100 p-0.5 dark:border-slate-700 dark:bg-slate-800">
            <button
              type="button"
              onClick={() => handleToggleExact(false)}
              disabled={loadingExact}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                !exactMode
                  ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              Estimated
            </button>
            <button
              type="button"
              onClick={() => handleToggleExact(true)}
              disabled={loadingExact}
              className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all ${
                exactMode
                  ? "bg-blue-600 text-white shadow-xs dark:bg-blue-600"
                  : "text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
              }`}
            >
              <span>Exact count(*)</span>
              {exactMode && (
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
              )}
            </button>
          </div>

          {exactMode && (
            <button
              type="button"
              onClick={handleRecount}
              disabled={loadingExact}
              title="Recalculate exact row count via count(*)"
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 shadow-xs hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700 disabled:opacity-50"
            >
              <span className={`text-xs ${loadingExact ? "animate-spin" : ""}`}>
                ↻
              </span>
              <span>Recount</span>
            </button>
          )}
        </div>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <StatCard
          label="TimescaleDB version"
          value={data?.timescaleVersion || "—"}
        />
        <StatCard
          label="Rows (PostgreSQL)"
          value={
            loadingExact ? (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
                <span className="text-lg">Counting...</span>
              </span>
            ) : data ? (
              formatInt(data.approxRows.pg)
            ) : (
              "—"
            )
          }
          hint={
            loadingExact
              ? "Calculating count(*)..."
              : isExactData
                ? "Exact count(*)"
                : "Estimated (approx)"
          }
        />
        <StatCard
          label="Rows (TimescaleDB)"
          value={
            loadingExact ? (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
                <span className="text-lg">Counting...</span>
              </span>
            ) : data ? (
              formatInt(data.approxRows.ts)
            ) : (
              "—"
            )
          }
          hint={
            loadingExact
              ? "Calculating count(*)..."
              : isExactData
                ? "Exact count(*)"
                : "Estimated (approx)"
          }
        />
        <StatCard
          label="Chunks"
          value={`${chunksCompressed} / ${chunksTotal}`}
          hint="compressed / total"
        />
        <StatCard
          label="PostgreSQL ingest"
          value={data ? formatInt(data.ingest.pgRowsPerSecond) : "--"}
          unit="rows/s"
        />
        <StatCard
          label="TimescaleDB ingest"
          value={data ? formatInt(data.ingest.tsRowsPerSecond) : "--"}
          unit="rows/s"
        />
        <StatCard
          label="Latest Row Age"
          value={data ? formatDuration(data.latest.ageSeconds) : "—"}
        />
      </div>
    </div>
  );
}

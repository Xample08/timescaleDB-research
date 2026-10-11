"use client";
import { useSqlFetch } from "./SqlExecution";
import { useEffect, useRef, useState } from "react";
import { Icon } from "./Icon";
import { StatCard, Spinner } from "./ui";
import { formatInt, formatDuration } from "@/lib/format";

interface ExactCounts {
  pg: number;
  ts: number;
  countedAt: string;
}
const exactCacheKey = "telemetry-exact-counts:v1";

export function StatusStrip() {
  const sqlFetch = useSqlFetch("Status");
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  // Exact counts are a manually refreshed snapshot, independent of live status.
  const [exactMode, setExactMode] = useState(false);
  const [loadingExact, setLoadingExact] = useState(false);
  const [exactCounts, setExactCounts] = useState<ExactCounts | null>(null);
  const [exactError, setExactError] = useState<string | null>(null);
  const exactRequest = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const cached = JSON.parse(sessionStorage.getItem(exactCacheKey) || "null");
      if (cached && Number.isSafeInteger(cached.pg) && cached.pg >= 0 &&
          Number.isSafeInteger(cached.ts) && cached.ts >= 0 &&
          Number.isFinite(Date.parse(cached.countedAt))) setExactCounts(cached);
    } catch { /* Storage may be unavailable; manual counting still works. */ }
    return () => { exactRequest.current?.abort(); };
  }, []);

  // Poll only inexpensive estimated status. Never recount on a timer or visibility change.
  useEffect(() => {
    let mounted = true;
    let timer: any;
    let fetching = false;
    const controller = new AbortController();

    const doFetch = async () => {
      if (!mounted || document.hidden || fetching) return;
      fetching = true;
      try {
        const res = await sqlFetch("/api/status", { signal: controller.signal });
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
        fetching = false;
      }
    };

    doFetch();
    timer = setInterval(doFetch, 5000);

    const onVis = () => {
      if (!document.hidden && mounted) {
        doFetch();
      }
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      mounted = false;
      controller.abort();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [sqlFetch]);

  const handleToggleExact = (enable: boolean) => {
    if (enable === exactMode) return;
    setExactMode(enable);
  };

  const handleRecount = async () => {
    if (exactRequest.current) return;
    const controller = new AbortController();
    exactRequest.current = controller;
    setLoadingExact(true);
    setExactError(null);
    try {
      const res = await sqlFetch("/api/status?exact=true", { signal: controller.signal });
      const json = await res.json();
      if (controller.signal.aborted) return;
      if (!res.ok) throw new Error(json.error || "Unable to refresh exact count");
      const snapshot = { pg: json.approxRows.pg, ts: json.approxRows.ts, countedAt: new Date().toISOString() };
      setExactCounts(snapshot);
      try { sessionStorage.setItem(exactCacheKey, JSON.stringify(snapshot)); } catch { /* Optional cache. */ }
    } catch (err) {
      if (!controller.signal.aborted)
        setExactError(err instanceof Error ? err.message : "Unable to refresh exact count");
    } finally {
      if (!controller.signal.aborted) setLoadingExact(false);
      exactRequest.current = null;
    }
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
  const rowCounts = exactMode ? exactCounts : data?.approxRows;
  const countHint = exactMode
    ? exactCounts
      ? `Exact snapshot / ${new Date(exactCounts.countedAt).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", hour12: false })} WIB`
      : "Click Refresh exact count to calculate"
    : "Estimated (approx)";

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
              <Icon name="refresh" className={loadingExact ? "animate-spin" : ""} />
              <span>{loadingExact ? "Refreshing..." : "Refresh exact count"}</span>
            </button>
          )}
        </div>
      </div>
      {exactMode && (
        <p className={`mb-2 text-xs ${exactError ? "text-red-400" : "text-slate-400"}`} role={exactError ? "alert" : undefined}>
          {exactError ? `Refresh failed: ${exactError}. Previous counts are kept.` : "Exact counts update only when you press Refresh exact count. Other status metrics stay live."}
        </p>
      )}

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-7">
        <StatCard
          label="TimescaleDB version"
          value={data?.timescaleVersion || "—"}
        />
        <StatCard
          label="Rows (PostgreSQL)"
          value={
            loadingExact && !rowCounts ? (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
                <span className="text-lg">Counting...</span>
              </span>
            ) : rowCounts ? (
              formatInt(rowCounts.pg)
            ) : (
              "Not counted"
            )
          }
          hint={
            loadingExact ? "Refreshing exact snapshot..." : countHint
          }
        />
        <StatCard
          label="Rows (TimescaleDB)"
          value={
            loadingExact && !rowCounts ? (
              <span className="flex items-center gap-1 text-blue-600 dark:text-blue-400">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent dark:border-blue-400" />
                <span className="text-lg">Counting...</span>
              </span>
            ) : rowCounts ? (
              formatInt(rowCounts.ts)
            ) : (
              "Not counted"
            )
          }
          hint={
            loadingExact ? "Refreshing exact snapshot..." : countHint
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

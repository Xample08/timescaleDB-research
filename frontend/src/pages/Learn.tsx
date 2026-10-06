import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, BenchmarkExplainResponse } from "../api";
import PageHeader from "../components/PageHeader";

export default function Learn() {
  const [explainResult, setExplainResult] = useState<BenchmarkExplainResponse | null>(null);
  const [isExplaining, setIsExplaining] = useState(false);
  const [explainError, setExplainError] = useState<string | null>(null);

  const { data: sizes } = useQuery({
    queryKey: ["storage", "sizes"],
    queryFn: api.storage.sizes,
    refetchOnWindowFocus: false,
  });

  const handleShowLiveExample = async () => {
    setIsExplaining(true);
    setExplainError(null);
    try {
      const res = await api.benchmark.explain("q2", "ts");
      setExplainResult(res);
    } catch (err: any) {
      setExplainError(err.message || "Failed to fetch explain data.");
    } finally {
      setIsExplaining(false);
    }
  };

  const currentChunkCount = sizes?.ts.chunks_total ?? "an unknown number of";

  return (
    <div className="space-y-8">
      <PageHeader title="Learn" description="How TimescaleDB works under the hood." />
      
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-slate-700 shadow-sm dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300">
        <h2 className="text-2xl font-bold mb-4 text-slate-900 dark:text-slate-100">Hypertables and Chunks</h2>
        <p className="mb-4">
          A hypertable is a PostgreSQL table that automatically partitions its data into smaller tables called chunks. 
          The data is partitioned along a time dimension (e.g., 1 day per chunk) and optionally a space dimension. 
          To the application, the hypertable appears and behaves exactly like a normal PostgreSQL table. 
          Currently, there are <strong>{currentChunkCount}</strong> chunks in the telemetry hypertable.
        </p>

        <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-900 dark:text-slate-100">Chunk Exclusion</h2>
        <p className="mb-4">
          When querying a hypertable, TimescaleDB uses the query's time constraints (e.g., <code>WHERE time &gt;= ... AND time &lt; ...</code>) 
          to determine which chunks could possibly contain matching data. It automatically excludes chunks that fall outside the query's 
          time range, avoiding the cost of scanning them entirely.
        </p>
        
        <div className="bg-slate-50 dark:bg-slate-800 p-6 rounded-lg border border-slate-200 dark:border-slate-700 my-4">
          <h3 className="font-semibold text-lg mb-2">Live Example: Chunk Exclusion</h3>
          <p className="mb-4 text-sm text-slate-600 dark:text-slate-400">
            Query 2 looks for data from a single vehicle over a fixed 1-day window. Press the button below to ask the database 
            to plan the query and report how many chunks it actually needs to scan.
          </p>
          <button
            onClick={handleShowLiveExample}
            disabled={isExplaining}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isExplaining ? "Planning..." : "Show live example"}
          </button>
          
          {explainError && <div className="mt-4 text-sm text-red-500">{explainError}</div>}
          
          {explainResult && (
            <div className="mt-4">
              <span className="inline-flex items-center rounded-md bg-emerald-50 px-2.5 py-1.5 text-sm font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20 dark:bg-emerald-900/30 dark:text-emerald-300 dark:ring-emerald-500/20">
                Chunks scanned: {explainResult.chunks_scanned} of {explainResult.chunks_total}
              </span>
              <details className="mt-2 text-xs font-mono">
                <summary className="cursor-pointer text-blue-600 dark:text-blue-400">View EXPLAIN output</summary>
                <pre className="mt-2 p-2 bg-slate-100 dark:bg-slate-950 rounded overflow-x-auto text-slate-800 dark:text-slate-200">
                  {explainResult.plan_text}
                </pre>
              </details>
            </div>
          )}
        </div>

        <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-900 dark:text-slate-100">Compression</h2>
        <p className="mb-4">
          TimescaleDB implements native columnar compression. When a chunk is compressed, multiple rows are grouped into a single row, 
          and each column's data is stored contiguously in an array. This enables type-specific compression algorithms (like delta-of-delta 
          encoding for timestamps).
        </p>
        <p className="mb-4">
          The <code>segmentby</code> parameter dictates how rows are grouped (e.g., by <code>vehicle_id</code>), ensuring that queries looking 
          for a specific vehicle can quickly locate the compressed data. The <code>orderby</code> parameter dictates how rows are sorted within 
          each segment (e.g., <code>time DESC</code>), optimizing time-based scans.
        </p>

        <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-900 dark:text-slate-100">Continuous Aggregates vs. Materialized Views</h2>
        <p className="mb-4">
          A standard PostgreSQL Materialized View recalculates its entire result set from scratch every time it is refreshed. 
          A TimescaleDB Continuous Aggregate is an incrementally updated materialized view. When refreshed, it only computes the 
          aggregates for the newly inserted or updated data, leaving the unchanged historical data alone. This significantly reduces 
          the compute cost of maintaining up-to-date dashboards.
        </p>

        <h2 className="text-2xl font-bold mb-4 mt-8 text-slate-900 dark:text-slate-100">When Vanilla PostgreSQL Is Enough</h2>
        <p className="mb-4">
          TimescaleDB adds overhead. For datasets that comfortably fit in memory, or for workloads that rarely query by time ranges 
          or perform large aggregations, vanilla PostgreSQL is highly capable. Simple single-row lookups or point queries often perform 
          similarly on both systems. TimescaleDB's advantages typically emerge when data volume grows beyond memory constraints, 
          necessitating compression and chunk exclusion to maintain performance.
        </p>
      </div>
    </div>
  );
}

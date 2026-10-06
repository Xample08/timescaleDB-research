import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api, BenchmarkRunResponse } from "../api";
import PageHeader from "../components/PageHeader";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";

export default function Benchmark() {
  const {
    data: queries,
    isLoading: queriesLoading,
    error: queriesError,
    refetch: refetchQueries,
  } = useQuery({
    queryKey: ["benchmark", "queries"],
    queryFn: api.benchmark.queries,
    staleTime: Infinity,
  });

  const { data: historyData } = useQuery({
    queryKey: ["benchmark", "history"],
    queryFn: api.benchmark.history,
  });

  const [selectedQueries, setSelectedQueries] = useState<Set<string>>(new Set());
  const [repetitions, setRepetitions] = useState(5);
  const [warmup, setWarmup] = useState(1);
  const [isRunning, setIsRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [result, setResult] = useState<BenchmarkRunResponse | null>(null);
  
  const [explainData, setExplainData] = useState<Record<string, Record<string, any>>>({});
  const [loadingExplain, setLoadingExplain] = useState<string | null>(null);
  const [showExplain, setShowExplain] = useState<string | null>(null);

  // Auto-select all queries when loaded
  useEffect(() => {
    if (queries && selectedQueries.size === 0 && !result) {
      setSelectedQueries(new Set(queries.map((q) => q.id)));
    }
  }, [queries, selectedQueries, result]);

  const handleRun = async () => {
    if (selectedQueries.size === 0) return;
    setIsRunning(true);
    setRunError(null);
    setResult(null);
    setShowExplain(null);
    setExplainData({});

    try {
      const res = await api.benchmark.run({
        query_ids: Array.from(selectedQueries),
        repetitions,
        warmup,
      });
      setResult(res);
    } catch (err: any) {
      setRunError(err.message || "Failed to run benchmark");
    } finally {
      setIsRunning(false);
    }
  };

  const handleFetchExplain = async (queryId: string, variants: string[]) => {
    if (showExplain === queryId) {
      setShowExplain(null);
      return;
    }
    
    setShowExplain(queryId);
    
    if (explainData[queryId]) return; // already loaded
    
    setLoadingExplain(queryId);
    try {
      const data: Record<string, any> = {};
      for (const variant of variants) {
        data[variant] = await api.benchmark.explain(queryId, variant);
      }
      setExplainData((prev) => ({ ...prev, [queryId]: data }));
    } catch (err: any) {
      console.error("Failed to fetch explain", err);
    } finally {
      setLoadingExplain(null);
    }
  };

  const chartData = useMemo(() => {
    if (!result) return [];
    const byQuery: Record<string, any> = {};
    
    result.results.forEach((r) => {
      if (!byQuery[r.query_id]) {
        byQuery[r.query_id] = { name: r.query_id };
      }
      byQuery[r.query_id][r.variant] = r.median_ms;
      byQuery[r.query_id][`${r.variant}_min`] = r.min_ms;
      byQuery[r.query_id][`${r.variant}_max`] = r.max_ms;
      byQuery[r.query_id][`${r.variant}_error`] = r.error;
    });

    return queries?.filter(q => byQuery[q.id]).map(q => ({
      ...byQuery[q.id],
      title: q.title
    })) || [];
  }, [result, queries]);

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-slate-800 text-white p-3 rounded-lg shadow-lg text-sm border border-slate-700">
          <p className="font-semibold mb-2">{label}</p>
          {payload.map((entry: any) => {
            const min = entry.payload[`${entry.dataKey}_min`];
            const max = entry.payload[`${entry.dataKey}_max`];
            const error = entry.payload[`${entry.dataKey}_error`];
            return (
              <div key={entry.dataKey} className="mb-1" style={{ color: entry.color }}>
                <span className="font-medium uppercase">{entry.dataKey}: </span>
                {error ? (
                  <span className="text-red-400">Error: {error}</span>
                ) : (
                  <span>{entry.value !== null ? `${entry.value.toFixed(2)} ms` : "N/A"}</span>
                )}
                {!error && min !== undefined && max !== undefined && (
                  <div className="text-xs text-slate-400 ml-6">
                    Min: {min.toFixed(2)} | Max: {max.toFixed(2)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    }
    return null;
  };

  const exportCSV = () => {
    if (!result) return;
    const headers = ["query_id", "variant", "median_ms", "min_ms", "max_ms", "rows_returned", "shared_hit", "shared_read", "chunks_scanned", "error"];
    const rows = result.results.map(r => [
      r.query_id, r.variant, r.median_ms ?? "", r.min_ms ?? "", r.max_ms ?? "",
      r.rows_returned ?? "", r.shared_hit_blocks ?? "", r.shared_read_blocks ?? "",
      r.chunks_scanned ?? "", r.error ?? ""
    ].join(","));
    
    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark_${result.run_id}.csv`;
    a.click();
  };

  const exportJSON = () => {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `benchmark_${result.run_id}.json`;
    a.click();
  };

  if (queriesLoading) return <div className="p-8"><LoadingState /></div>;
  if (queriesError) return <div className="p-8"><ErrorState error="Failed to load queries" onRetry={() => refetchQueries()} /></div>;
  if (!queries) return <div className="p-8"><EmptyState message="No queries available." /></div>;

  return (
    <div>
      <PageHeader title="Benchmark" description="Compare query performance between PostgreSQL and TimescaleDB." />
      
      <div className="flex flex-col gap-6 p-6 md:p-8">
        
        {/* Configuration Panel */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h2 className="text-lg font-semibold mb-4">Configuration</h2>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div>
              <h3 className="font-medium text-slate-700 dark:text-slate-300 mb-3">Queries</h3>
              <div className="flex flex-col gap-2">
                {queries.map((q) => (
                  <label key={q.id} className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={selectedQueries.has(q.id)}
                      onChange={(e) => {
                        const next = new Set(selectedQueries);
                        if (e.target.checked) next.add(q.id);
                        else next.delete(q.id);
                        setSelectedQueries(next);
                      }}
                    />
                    <div>
                      <div className="font-medium text-slate-900 dark:text-white">
                        {q.id.toUpperCase()}: {q.title}
                      </div>
                      <div className="text-sm text-slate-500">{q.description}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            
            <div className="flex flex-col gap-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Repetitions (1-20)
                </label>
                <input
                  type="number"
                  min={1} max={20}
                  value={repetitions}
                  onChange={(e) => setRepetitions(parseInt(e.target.value) || 1)}
                  className="w-full rounded-md border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                  Warmup Runs (0-3)
                </label>
                <input
                  type="number"
                  min={0} max={3}
                  value={warmup}
                  onChange={(e) => setWarmup(parseInt(e.target.value) || 0)}
                  className="w-full rounded-md border border-slate-300 p-2 dark:border-slate-700 dark:bg-slate-800"
                />
              </div>
              
              <div className="mt-auto pt-4">
                <button
                  onClick={handleRun}
                  disabled={isRunning || selectedQueries.size === 0}
                  className="w-full rounded-lg bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {isRunning ? "Running..." : "Run Benchmark"}
                </button>
                {runError && <div className="mt-2 text-sm text-red-500">{runError}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* Results Panel */}
        {result && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-col gap-6">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Results</h2>
              <div className="flex gap-2">
                <button onClick={exportCSV} className="text-sm px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">CSV</button>
                <button onClick={exportJSON} className="text-sm px-3 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700">JSON</button>
              </div>
            </div>
            
            {result.simulation_running && (
              <div className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm dark:bg-amber-900/30 dark:border-amber-800/50 dark:text-amber-200">
                Notice: The simulation was running during this benchmark. Results may be affected by concurrent write load.
              </div>
            )}
            
            {/* Chart */}
            <div className="h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                  <XAxis dataKey="name" />
                  <YAxis label={{ value: 'Median Time (ms)', angle: -90, position: 'insideLeft' }} />
                  <RechartsTooltip content={<CustomTooltip />} />
                  <Legend />
                  <Bar dataKey="pg" name="PostgreSQL" fill="#3b82f6" isAnimationActive={false} />
                  <Bar dataKey="ts" name="TimescaleDB" fill="#f59e0b" isAnimationActive={false} />
                  <Bar dataKey="ts_cagg" name="Timescale (CAGG)" fill="#10b981" isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            
            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-slate-500">
                    <th className="pb-2 font-medium">Query</th>
                    <th className="pb-2 font-medium">Variant</th>
                    <th className="pb-2 font-medium text-right">Median (ms)</th>
                    <th className="pb-2 font-medium text-right">Min (ms)</th>
                    <th className="pb-2 font-medium text-right">Max (ms)</th>
                    <th className="pb-2 font-medium text-right">Ratio (ts/pg)</th>
                    <th className="pb-2 font-medium text-right">Rows</th>
                    <th className="pb-2 font-medium text-right">Hit/Read</th>
                    <th className="pb-2 font-medium text-right">Scanned</th>
                  </tr>
                </thead>
                <tbody>
                  {chartData.map((d) => {
                    const qdef = queries?.find(q => q.id === d.name);
                    const q_results = result.results.filter(r => r.query_id === d.name);
                    const pg_res = q_results.find(r => r.variant === 'pg');
                    
                    return q_results.map((r, idx) => {
                      const isFirst = idx === 0;
                      let ratio = "-";
                      if (r.variant !== 'pg' && r.median_ms !== null && pg_res?.median_ms && pg_res.median_ms > 0) {
                        ratio = (r.median_ms / pg_res.median_ms).toFixed(2);
                      }
                      
                      return (
                        <tr key={`${r.query_id}-${r.variant}`} className="border-b border-slate-100 dark:border-slate-800/50 last:border-0">
                          {isFirst && (
                            <td rowSpan={q_results.length} className="py-3 font-medium align-top border-r border-slate-100 dark:border-slate-800/50 pr-2">
                              {r.query_id.toUpperCase()}
                              <div className="mt-2">
                                <button
                                  onClick={() => handleFetchExplain(r.query_id, qdef?.variants || [])}
                                  className="text-xs text-blue-600 hover:underline dark:text-blue-400"
                                >
                                  {showExplain === r.query_id ? "Hide EXPLAIN" : "Show EXPLAIN"}
                                </button>
                              </div>
                            </td>
                          )}
                          <td className="py-2 pl-2">
                            <span className="uppercase text-xs font-semibold px-2 py-1 bg-slate-100 rounded dark:bg-slate-800">{r.variant}</span>
                            {r.error && <span className="ml-2 text-red-500 text-xs">Error: {r.error}</span>}
                          </td>
                          <td className="py-2 text-right">{r.median_ms !== null ? r.median_ms.toFixed(2) : "-"}</td>
                          <td className="py-2 text-right text-slate-500">{r.min_ms !== null ? r.min_ms.toFixed(2) : "-"}</td>
                          <td className="py-2 text-right text-slate-500">{r.max_ms !== null ? r.max_ms.toFixed(2) : "-"}</td>
                          <td className="py-2 text-right font-medium">{ratio}</td>
                          <td className="py-2 text-right">{r.rows_returned ?? "-"}</td>
                          <td className="py-2 text-right text-slate-500">
                            {r.shared_hit_blocks ?? "-"}/{r.shared_read_blocks ?? "-"}
                          </td>
                          <td className="py-2 text-right">
                            {r.chunks_scanned !== null ? (
                              <span className="inline-flex items-center justify-center bg-blue-100 text-blue-800 text-[10px] font-medium px-1.5 py-0.5 rounded dark:bg-blue-900 dark:text-blue-300">
                                {r.chunks_scanned} chunks
                              </span>
                            ) : "-"}
                          </td>
                        </tr>
                      );
                    });
                  })}
                </tbody>
              </table>
            </div>
            
            {/* EXPLAIN Section */}
            {showExplain && queries && (
              <div className="mt-4 p-4 border border-slate-200 rounded-lg bg-slate-50 dark:bg-slate-900/50 dark:border-slate-800">
                <h3 className="font-semibold mb-3">EXPLAIN ({showExplain.toUpperCase()})</h3>
                {loadingExplain === showExplain ? (
                  <LoadingState />
                ) : explainData[showExplain] ? (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                    {Object.entries(explainData[showExplain]).map(([variant, data]) => (
                      <div key={variant} className="border border-slate-200 dark:border-slate-800 rounded bg-white dark:bg-slate-900 overflow-hidden flex flex-col">
                        <div className="bg-slate-100 dark:bg-slate-800 px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex justify-between items-center">
                          <span className="font-mono text-sm font-bold uppercase">{variant}</span>
                          {data.chunks_scanned !== null && data.chunks_total !== null && (
                            <span className="text-xs bg-emerald-100 text-emerald-800 px-2 py-1 rounded-full dark:bg-emerald-900/50 dark:text-emerald-300">
                              Chunks scanned: {data.chunks_scanned} of {data.chunks_total}
                            </span>
                          )}
                        </div>
                        <div className="p-3 overflow-auto max-h-96 text-xs font-mono whitespace-pre text-slate-800 dark:text-slate-300">
                          {data.plan_text || "No plan available."}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-sm text-slate-500">Failed to load EXPLAIN data.</div>
                )}
              </div>
            )}
            
          </div>
        )}
        
        {/* History Panel */}
        {historyData && historyData.length > 0 && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <h2 className="text-lg font-semibold mb-4">Past Runs (Session)</h2>
            <div className="flex flex-col gap-2">
              {historyData.map(h => (
                <div key={h.run_id} className="flex justify-between items-center text-sm py-2 border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <div>
                    <span className="text-slate-500">{new Date(h.started_at).toLocaleString()}</span>
                    <span className="mx-2 text-slate-300">|</span>
                    <span className="font-medium">{h.results.length} results</span>
                  </div>
                  <button 
                    onClick={() => setResult(h)}
                    className="text-blue-600 hover:underline dark:text-blue-400"
                  >
                    View
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

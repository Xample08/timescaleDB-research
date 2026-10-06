import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { api, ApiError } from "../api";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import LoadingState from "../components/LoadingState";
import ErrorState from "../components/ErrorState";
import EmptyState from "../components/EmptyState";

function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return "N/A";
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

export default function Storage() {
  const [adminToken, setAdminToken] = useState("");
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [jobStatusMsg, setJobStatusMsg] = useState<string | null>(null);
  const [adminError, setAdminError] = useState<string | null>(null);
  const [compressDays, setCompressDays] = useState<number>(7);

  const { data: sizes, isLoading: sizesLoading, error: sizesError, refetch: refetchSizes } =
    useQuery({
      queryKey: ["storage", "sizes"],
      queryFn: api.storage.sizes,
      refetchInterval: 30000,
    });

  const { data: chunksRes, isLoading: chunksLoading, error: chunksError, refetch: refetchChunks } =
    useQuery({
      queryKey: ["storage", "chunks"],
      queryFn: () => api.storage.chunks(200),
      refetchInterval: 30000,
    });

  // Poll job status
  useEffect(() => {
    if (!activeJobId) return;
    const interval = setInterval(async () => {
      try {
        const status = await api.admin.jobStatus(adminToken, activeJobId);
        if (status.state === "done") {
          setJobStatusMsg(`Job finished: ${status.message || "Success"}`);
          setActiveJobId(null);
          refetchSizes();
          refetchChunks();
        } else if (status.state === "failed") {
          setJobStatusMsg(`Job failed: ${status.message}`);
          setActiveJobId(null);
        } else {
          setJobStatusMsg(`Job running: ${status.message || "Working..."}`);
        }
      } catch (err) {
        if (err instanceof ApiError && err.status === 403) {
          setAdminError("Invalid or missing admin token");
          setActiveJobId(null);
        } else {
          setJobStatusMsg("Error checking job status");
        }
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeJobId, adminToken, refetchSizes, refetchChunks]);

  const handleManualRefresh = () => {
    refetchSizes();
    refetchChunks();
  };

  const startJob = async (jobFn: () => Promise<any>) => {
    setAdminError(null);
    setJobStatusMsg(null);
    if (!adminToken) {
      setAdminError("Invalid or missing admin token");
      return;
    }
    try {
      const res = await jobFn();
      if (res.job_id) {
        setActiveJobId(res.job_id);
      } else {
        setJobStatusMsg("Action completed successfully.");
        refetchSizes();
        refetchChunks();
      }
    } catch (err: any) {
      if (err instanceof ApiError) {
        if (err.status === 403) {
          setAdminError("Invalid or missing admin token");
        } else {
          setAdminError(err.message || "An error occurred");
        }
      } else {
        setAdminError(err.message || "An error occurred");
      }
    }
  };

  const renderChart = () => {
    if (!sizes) return null;
    const { pg, ts } = sizes;

    const chartData = [
      {
        name: "PostgreSQL",
        Table: pg.table_bytes,
        Index: pg.index_bytes,
        Toast: pg.toast_bytes || 0,
      },
      {
        name: "TimescaleDB",
        Table: ts.table_bytes,
        Index: ts.index_bytes,
        Toast: ts.toast_bytes || 0,
      },
    ];

    const compressionAvailable =
      ts.before_compression_bytes != null && ts.after_compression_bytes != null;
    const compressionRatio = compressionAvailable
      ? (ts.before_compression_bytes! / ts.after_compression_bytes!).toFixed(2)
      : null;

    const CustomTooltip = ({ active, payload, label }: any) => {
      if (active && payload && payload.length) {
        return (
          <div className="rounded-md border border-slate-700 bg-slate-800 p-3 text-slate-200 text-sm shadow-md">
            <p className="mb-2 font-semibold text-white">{label}</p>
            {payload.map((entry: any, index: number) => (
              <p key={index} style={{ color: entry.color }}>
                {entry.name}: {formatBytes(entry.value)}
              </p>
            ))}
          </div>
        );
      }
      return null;
    };

    return (
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-lg font-semibold dark:text-slate-200">Table Sizes</h3>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis tickFormatter={(val) => formatBytes(val)} stroke="#94a3b8" />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Bar dataKey="Table" stackId="a" fill="#3b82f6" />
                <Bar dataKey="Index" stackId="a" fill="#f59e0b" />
                <Bar dataKey="Toast" stackId="a" fill="#10b981" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
        
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
          <h3 className="mb-4 text-lg font-semibold dark:text-slate-200">Compression Impact</h3>
          {compressionAvailable ? (
            <div className="flex flex-col h-full justify-between pb-8">
              <div className="grid grid-cols-2 gap-4">
                <div className="rounded border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Before Compression</p>
                  <p className="text-xl font-bold dark:text-slate-200">
                    {formatBytes(ts.before_compression_bytes)}
                  </p>
                </div>
                <div className="rounded border border-slate-100 bg-slate-50 p-4 dark:border-slate-700 dark:bg-slate-800">
                  <p className="text-sm text-slate-500 dark:text-slate-400">After Compression</p>
                  <p className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                    {formatBytes(ts.after_compression_bytes)}
                  </p>
                </div>
              </div>
              <div className="mt-6 flex items-center justify-center">
                <div className="text-center">
                  <p className="text-sm text-slate-500 dark:text-slate-400">Compression Ratio</p>
                  <p className="text-4xl font-bold text-blue-600 dark:text-blue-400">{compressionRatio}x</p>
                </div>
              </div>
            </div>
          ) : (
            <EmptyState message="No compression data available" />
          )}
        </div>
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center justify-between">
        <PageHeader title="Storage" description="Database size comparison and chunk management." />
        <button
          onClick={handleManualRefresh}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700"
        >
          Refresh
        </button>
      </div>

      {sizesLoading && <LoadingState />}
      {sizesError && <ErrorState error={sizesError} onRetry={refetchSizes} />}

      {!sizesLoading && !sizesError && sizes && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <StatCard title="Approximate Rows (TS)" value={sizes.ts.approx_rows.toLocaleString()} />
            <StatCard title="Chunks Total" value={sizes.ts.chunks_total?.toString() || "0"} />
            <StatCard title="Chunks Compressed" value={sizes.ts.chunks_compressed?.toString() || "0"} />
          </div>

          {renderChart()}
        </>
      )}

      {/* Admin Panel */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <h3 className="mb-4 text-lg font-semibold dark:text-slate-200">Admin Actions</h3>
        <div className="flex flex-wrap items-center gap-4 mb-4">
          <input
            type="password"
            placeholder="Admin Token"
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            className="rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
          />
          <div className="flex items-center gap-2">
            <input
              type="number"
              min="1"
              max="3650"
              value={compressDays}
              onChange={(e) => setCompressDays(Number(e.target.value))}
              className="w-20 rounded border border-slate-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
            />
            <span className="text-sm dark:text-slate-400">days</span>
            <button
              onClick={() => {
                if (window.confirm(`Compress chunks older than ${compressDays} days?`)) {
                  startJob(() => api.admin.compressOlderThan(adminToken, compressDays));
                }
              }}
              disabled={!!activeJobId || !adminToken}
              className="rounded bg-emerald-600 px-4 py-2 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Compress Older Than
            </button>
          </div>
          <button
            onClick={() => startJob(() => api.admin.refreshCagg(adminToken))}
            disabled={!!activeJobId || !adminToken}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Refresh CAGG
          </button>
        </div>
        {adminError && <div className="text-sm text-red-500 mb-2">{adminError}</div>}
        {jobStatusMsg && <div className="text-sm text-blue-500 mb-2 font-mono">{jobStatusMsg}</div>}
      </div>

      {/* Chunks Table */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900 overflow-hidden">
        <div className="p-6 border-b border-slate-200 dark:border-slate-700">
          <h3 className="text-lg font-semibold dark:text-slate-200">Chunks Explorer</h3>
        </div>
        {chunksLoading && <div className="p-6"><LoadingState /></div>}
        {chunksError && <div className="p-6"><ErrorState error={chunksError} onRetry={refetchChunks} /></div>}
        
        {!chunksLoading && !chunksError && chunksRes?.chunks && (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm text-slate-500 dark:text-slate-400">
              <thead className="bg-slate-50 text-xs uppercase dark:bg-slate-800 dark:text-slate-300">
                <tr>
                  <th className="px-6 py-3">Chunk Name</th>
                  <th className="px-6 py-3">Range Start</th>
                  <th className="px-6 py-3">Range End</th>
                  <th className="px-6 py-3">Size</th>
                  <th className="px-6 py-3">Compressed</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200 dark:divide-slate-700 font-mono text-xs">
                {chunksRes.chunks.map((chunk) => (
                  <tr key={chunk.chunk_name} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-6 py-4">{chunk.chunk_name.replace("_timescaledb_internal.", "")}</td>
                    <td className="px-6 py-4">{new Date(chunk.range_start).toLocaleString()}</td>
                    <td className="px-6 py-4">{new Date(chunk.range_end).toLocaleString()}</td>
                    <td className="px-6 py-4">{formatBytes(chunk.total_bytes)}</td>
                    <td className="px-6 py-4">
                      {chunk.is_compressed ? (
                        <span className="rounded bg-emerald-100 px-2.5 py-0.5 font-medium text-emerald-800 dark:bg-emerald-900 dark:text-emerald-300">
                          Yes
                        </span>
                      ) : (
                        <span className="rounded bg-slate-100 px-2.5 py-0.5 font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-300">
                          No
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4 text-right">
                      {chunk.is_compressed ? (
                        <button
                          onClick={() => startJob(() => api.admin.decompressChunk(adminToken, chunk.chunk_name))}
                          disabled={!!activeJobId || !adminToken}
                          className="font-medium text-blue-600 hover:underline dark:text-blue-500 disabled:opacity-50"
                        >
                          Decompress
                        </button>
                      ) : (
                        <button
                          onClick={() => startJob(() => api.admin.compressChunk(adminToken, chunk.chunk_name))}
                          disabled={!!activeJobId || !adminToken}
                          className="font-medium text-blue-600 hover:underline dark:text-blue-500 disabled:opacity-50"
                        >
                          Compress
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {chunksRes.chunks.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-slate-500 font-sans">
                      No chunks found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

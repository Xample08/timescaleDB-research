"use client";
import { NumberField } from "./FormControls";
import { ResizablePanels } from "./ResizablePanels";
import { useSqlFetch } from "./SqlExecution";
import { useState, useEffect } from "react";
import {
  Card,
  StatCard,
  Badge,
  Button,
  Spinner,
  ErrorState,
  SERIES_COLORS,
} from "./ui";
import { formatBytes } from "@/lib/format";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";

type Chunk = {
  schema?: string;
  name: string;
  rangeStart: string | null;
  rangeEnd: string | null;
  isCompressed: boolean;
  totalBytes: number;
};

type Feedback = {
  type: "success" | "error" | "info";
  message: string;
};

export function StorageTab() {
  const sqlFetch = useSqlFetch("Storage");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Compression controls state
  const [olderThanDays, setOlderThanDays] = useState<number | string>(2);
  const [actionLoading, setActionLoading] = useState<string | null>(null); // 'batch' | chunkName | null
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  // Table filtering and search
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<
    "all" | "uncompressed" | "compressed"
  >("all");

  const fetchStorage = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const res = await sqlFetch("/api/storage");
      const json = await res.json();
      if (res.ok) {
        setData(json);
        setError(null);
      } else {
        setError(json.error || "Failed to fetch storage");
      }
    } catch (err: any) {
      setError(err.message);
    }
    if (!silent) setLoading(false);
  };

  useEffect(() => {
    fetchStorage();
    const timer = setInterval(() => {
      if (!document.hidden && !actionLoading) fetchStorage(true);
    }, 30000);
    return () => clearInterval(timer);
  }, [actionLoading]);

  // Execute single chunk compress/decompress
  const handleSingleChunkAction = async (chunk: Chunk) => {
    const action = chunk.isCompressed ? "decompress_chunk" : "compress_chunk";
    setActionLoading(chunk.name);
    setFeedback(null);

    try {
      const res = await sqlFetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          chunkName: chunk.name,
          chunkSchema: chunk.schema || "_timescaledb_internal",
        }),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(
          json.error ||
            `Failed to ${chunk.isCompressed ? "decompress" : "compress"} chunk`,
        );
      }

      setFeedback({
        type: "success",
        message: `Chunk ${chunk.name} ${chunk.isCompressed ? "decompressed" : "compressed"} successfully.`,
      });
      await fetchStorage(true);
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err.message || "Operation failed",
      });
    } finally {
      setActionLoading(null);
    }
  };

  // Execute batch actions (all / older than N days)
  const handleBatchAction = async (
    action: "compress_all" | "decompress_all" | "compress_older_than",
  ) => {
    const daysNum = Number(olderThanDays);

    if (action === "compress_all") {
      if (
        !window.confirm(
          "Are you sure you want to compress all uncompressed chunks? This may take several seconds.",
        )
      ) {
        return;
      }
    } else if (action === "decompress_all") {
      if (
        !window.confirm(
          "Are you sure you want to decompress ALL chunks? This will increase disk storage.",
        )
      ) {
        return;
      }
    } else if (action === "compress_older_than") {
      if (
        olderThanDays === "" ||
        !Number.isInteger(daysNum) ||
        daysNum < 0 ||
        daysNum > 36500
      ) {
        setFeedback({
          type: "error",
          message: "Please enter a valid non-negative number of days.",
        });
        return;
      }
    }

    setActionLoading("batch");
    setFeedback(null);

    try {
      const payload: any = { action };
      if (action === "compress_older_than") {
        payload.days = daysNum;
      }

      const res = await sqlFetch("/api/storage", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json();
      if (!res.ok) {
        throw new Error(json.error || "Batch operation failed");
      }

      const count = json.count ?? 0;
      if (action === "compress_older_than") {
        setFeedback({
          type: "success",
          message: `Successfully compressed ${count} chunk(s) older than ${daysNum} days.`,
        });
      } else if (action === "compress_all") {
        setFeedback({
          type: "success",
          message: `Successfully compressed ${count} chunk(s).`,
        });
      } else {
        setFeedback({
          type: "success",
          message: `Successfully decompressed ${count} chunk(s).`,
        });
      }

      await fetchStorage(true);
    } catch (err: any) {
      setFeedback({
        type: "error",
        message: err.message || "Batch operation failed",
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (error)
    return <ErrorState message={error} onRetry={() => fetchStorage()} />;
  if (!data) return <Spinner />;

  // Calculated chunk stats
  const chunks: Chunk[] = data.chunks || [];
  const chunksTotal = chunks.length;
  const chunksComp = chunks.filter((c) => c.isCompressed).length;
  const chunksUncomp = chunksTotal - chunksComp;

  // Calculate chunks matching older than N days using server reference time
  const refTimeMs = data.serverTime ? new Date(data.serverTime).getTime() : 0;
  const daysNum = Number(olderThanDays);
  const eligibleOlderCount =
    !isNaN(daysNum) && daysNum >= 0 && refTimeMs > 0
      ? chunks.filter((c) => {
          if (c.isCompressed || !c.rangeEnd) return false;
          return (
            refTimeMs - new Date(c.rangeEnd).getTime() >= daysNum * 86400000
          );
        }).length
      : 0;

  // Filtered chunks list for the table
  const filteredChunks = chunks.filter((c) => {
    if (statusFilter === "compressed" && !c.isCompressed) return false;
    if (statusFilter === "uncompressed" && c.isCompressed) return false;
    if (search.trim()) {
      const query = search.trim().toLowerCase();
      return c.name.toLowerCase().includes(query);
    }
    return true;
  });

  const chartData = [
    {
      name: "PostgreSQL",
      table: data.pg.tableBytes,
      index: data.pg.indexBytes,
    },
    {
      name: "TimescaleDB (Before)",
      table: data.ts.tableBytes,
      index: data.ts.indexBytes,
    },
  ];

  if (data.ts.afterCompressionBytes != null) {
    chartData.push({
      name: "TimescaleDB (After)",
      table: data.ts.afterCompressionBytes,
      index: data.ts.indexBytes,
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Top action row */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Storage & Compression
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Monitor hypertable storage, individual chunk states, and run
            columnar compression policies.
          </p>
        </div>
        <Button
          onClick={() => fetchStorage()}
          disabled={loading || !!actionLoading}
        >
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {/* Metric Cards */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="PostgreSQL Total"
          value={formatBytes(data.pg.totalBytes)}
        />
        <StatCard
          label="TimescaleDB Total"
          value={formatBytes(data.ts.totalBytes)}
        />
        <StatCard
          label="Compression Ratio"
          value={
            data.ts.compressionRatio
              ? `${data.ts.compressionRatio.toFixed(2)}x`
              : "—"
          }
        />
        <StatCard
          label="Chunks Compressed"
          value={`${chunksComp} / ${chunksTotal}`}
          hint={`${chunksTotal > 0 ? Math.round((chunksComp / chunksTotal) * 100) : 0}% compressed`}
        />
      </div>

      {/* Chart & Compression Controls */}
      <ResizablePanels
        className="storage-columns"
        label="Storage chart and controls"
        initialSizes={[60, 40]}
      >
        {/* Storage Size Chart */}
        <Card title="Storage Size Comparison" className="h-80 relative">
          {loading && (
            <div className="absolute inset-0 bg-white/50 z-10 dark:bg-slate-900/50" />
          )}
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={chartData}
              margin={{ top: 8, right: 12, bottom: 0, left: 0 }}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#29364b"
              />
              <XAxis dataKey="name" style={{ fontSize: 11 }} />
              <YAxis
                tickFormatter={(v) => formatBytes(v)}
                style={{ fontSize: 11 }}
                width={80}
              />
              <Tooltip
                formatter={(val: any) => formatBytes(val)}
                labelStyle={{ color: "#0f172a" }}
              />
              <Legend verticalAlign="top" height={36} />
              <Bar
                dataKey="table"
                name="Table / Total"
                fill={SERIES_COLORS.pg}
                isAnimationActive={false}
              >
                {chartData.map((row) => (
                  <Cell
                    key={row.name}
                    fill={
                      row.name.startsWith("PostgreSQL")
                        ? SERIES_COLORS.pg
                        : SERIES_COLORS.ts
                    }
                  />
                ))}
              </Bar>
              <Bar
                dataKey="index"
                name="Index"
                fill={SERIES_COLORS.ts}
                fillOpacity={0.5}
                isAnimationActive={false}
              >
                {chartData.map((row) => (
                  <Cell
                    key={row.name}
                    fill={
                      row.name.startsWith("PostgreSQL")
                        ? SERIES_COLORS.pg
                        : SERIES_COLORS.ts
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Card>

        {/* Compression Management Card */}
        <Card title="Compression Management" className="compression-card">
          <div className="space-y-4">
            {/* Feedback alert */}
            {feedback && (
              <div
                className={`flex items-start justify-between rounded-md p-2.5 text-xs ${
                  feedback.type === "success"
                    ? "bg-emerald-50 text-emerald-800 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-300 dark:border-emerald-800"
                    : feedback.type === "error"
                      ? "bg-red-50 text-red-800 border border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800"
                      : "bg-blue-50 text-blue-800 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800"
                }`}
              >
                <div className="flex items-center gap-1.5">
                  <span className="font-semibold">
                    {feedback.type === "success"
                      ? "✓"
                      : feedback.type === "error"
                        ? "⚠"
                        : "ℹ"}
                  </span>
                  <span>{feedback.message}</span>
                </div>
                <button
                  onClick={() => setFeedback(null)}
                  className="ml-2 font-bold opacity-60 hover:opacity-100"
                >
                  ✕
                </button>
              </div>
            )}

            {/* In-progress status */}
            {actionLoading && (
              <div className="flex items-center gap-2 rounded-md bg-blue-50 p-2.5 text-xs text-blue-800 border border-blue-200 dark:bg-blue-950/30 dark:text-blue-300 dark:border-blue-800 animate-pulse">
                <div className="h-3 w-3 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                <span>
                  {actionLoading === "batch"
                    ? "Executing batch compression action in database, please wait..."
                    : `Compressing/decompressing chunk ${actionLoading}...`}
                </span>
              </div>
            )}

            {/* Policy: Compress Older Than N Days */}
            <div className="compression-policy">
              <div className="compression-policy-controls">
                <NumberField
                  id="compression-days"
                  label="Older than (days)"
                  help="Compresses uncompressed TimescaleDB chunks whose range ends at least this many days before the server reference time. This changes physical storage, not telemetry values."
                  placeholder="Number of days"
                  min={0}
                  max={36500}
                  value={olderThanDays === "" ? NaN : Number(olderThanDays)}
                  onChange={(value) =>
                    setOlderThanDays(Number.isNaN(value) ? "" : value)
                  }
                  disabled={!!actionLoading}
                />

                <Button
                  variant="primary"
                  onClick={() => handleBatchAction("compress_older_than")}
                  disabled={!!actionLoading || eligibleOlderCount === 0}
                  className="h-8 text-xs px-3"
                >
                  Compress &gt; {olderThanDays || 0}d ({eligibleOlderCount})
                </Button>
              </div>
              <p className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">
                Compresses uncompressed chunks whose range end is older than{" "}
                {olderThanDays || 0} days.
              </p>
            </div>

            {/* Quick Batch Buttons */}
            <div>
              <div className="text-xs font-semibold text-slate-800 dark:text-slate-200 mb-1.5">
                Batch Hypertable Operations:
              </div>
              <div className="compression-batch-actions">
                <Button
                  variant="primary"
                  onClick={() => handleBatchAction("compress_all")}
                  disabled={!!actionLoading || chunksUncomp === 0}
                  className="h-8 text-xs"
                >
                  Compress All ({chunksUncomp})
                </Button>

                <Button
                  variant="secondary"
                  onClick={() => handleBatchAction("decompress_all")}
                  disabled={!!actionLoading || chunksComp === 0}
                  className="h-8 text-xs border-amber-300 text-amber-800 hover:bg-amber-50 dark:border-amber-700 dark:text-amber-300 dark:hover:bg-amber-950/30"
                >
                  Decompress All ({chunksComp})
                </Button>
              </div>
            </div>
          </div>
        </Card>
      </ResizablePanels>

      {/* Full-width Chunks Table */}
      <Card
        title={`Hypertable Chunks (${filteredChunks.length}${filteredChunks.length !== chunksTotal ? ` of ${chunksTotal}` : ""})`}
        right={
          <div className="flex flex-wrap items-center gap-2">
            {/* Search input */}
            <input
              type="text"
              placeholder="Filter by chunk name..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-44 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs text-slate-900 placeholder:text-slate-400 shadow-xs focus:border-blue-500 focus:outline-hidden dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100"
            />

            {/* Status filter tabs */}
            <div className="flex rounded-md bg-slate-100 p-0.5 dark:bg-slate-800 text-xs">
              <button
                onClick={() => setStatusFilter("all")}
                className={`rounded px-2 py-0.5 font-medium transition-all ${
                  statusFilter === "all"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                All ({chunksTotal})
              </button>
              <button
                onClick={() => setStatusFilter("uncompressed")}
                className={`rounded px-2 py-0.5 font-medium transition-all ${
                  statusFilter === "uncompressed"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Uncompressed ({chunksUncomp})
              </button>
              <button
                onClick={() => setStatusFilter("compressed")}
                className={`rounded px-2 py-0.5 font-medium transition-all ${
                  statusFilter === "compressed"
                    ? "bg-white text-slate-900 shadow-xs dark:bg-slate-900 dark:text-white"
                    : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                }`}
              >
                Compressed ({chunksComp})
              </button>
            </div>
          </div>
        }
        className="min-w-0"
      >
        <div className="max-h-[600px] overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 shadow-xs z-10">
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">
                  Chunk Name
                </th>
                <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">
                  Range Start
                </th>
                <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-200">
                  Range End
                </th>
                <th className="py-2.5 px-3 font-semibold text-right text-slate-700 dark:text-slate-200">
                  Size
                </th>
                <th className="py-2.5 px-3 font-semibold text-center text-slate-700 dark:text-slate-200">
                  Status
                </th>
                <th className="py-2.5 px-3 font-semibold text-center text-slate-700 dark:text-slate-200">
                  Action
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredChunks.map((c: Chunk) => {
                const isOperating = actionLoading === c.name;

                return (
                  <tr
                    key={c.name}
                    className="hover:bg-slate-50/80 transition-colors dark:hover:bg-slate-800/40"
                  >
                    <td className="py-2 px-3 font-mono text-[11px] font-medium text-slate-900 dark:text-slate-100">
                      {c.name}
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      {c.rangeStart
                        ? new Date(c.rangeStart).toLocaleString()
                        : "—"}
                    </td>
                    <td className="py-2 px-3 text-slate-600 dark:text-slate-300">
                      {c.rangeEnd ? new Date(c.rangeEnd).toLocaleString() : "—"}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-slate-700 dark:text-slate-200">
                      {formatBytes(c.totalBytes)}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {c.isCompressed ? (
                        <Badge tone="ok">Compressed</Badge>
                      ) : (
                        <Badge tone="neutral">Uncompressed</Badge>
                      )}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {c.isCompressed ? (
                        <button
                          onClick={() => handleSingleChunkAction(c)}
                          disabled={!!actionLoading}
                          className="inline-flex items-center justify-center rounded px-2.5 py-1 text-[11px] font-medium transition-colors bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-800 dark:hover:bg-amber-900/50 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isOperating ? (
                            <span className="flex items-center gap-1">
                              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-amber-600 border-t-transparent" />
                              Decompressing...
                            </span>
                          ) : (
                            "Decompress"
                          )}
                        </button>
                      ) : (
                        <button
                          onClick={() => handleSingleChunkAction(c)}
                          disabled={!!actionLoading}
                          className="inline-flex items-center justify-center rounded px-2.5 py-1 text-[11px] font-medium transition-colors bg-blue-600 text-white hover:bg-blue-700 dark:bg-blue-600 dark:hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isOperating ? (
                            <span className="flex items-center gap-1">
                              <span className="h-2.5 w-2.5 animate-spin rounded-full border border-white border-t-transparent" />
                              Compressing...
                            </span>
                          ) : (
                            "Compress"
                          )}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredChunks.length === 0 && (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-slate-500 dark:text-slate-400"
                  >
                    {search || statusFilter !== "all"
                      ? "No chunks match the current filter."
                      : "No chunks found."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

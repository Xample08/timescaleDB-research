import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { MapContainer, TileLayer, Marker, Popup } from "react-leaflet";
import L from "leaflet";
import { api, ApiError, SimulationStartRequest } from "../api";
import PageHeader from "../components/PageHeader";
import StatCard from "../components/StatCard";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";

function InfoIcon({ text }: { text: string }) {
  return (
    <span className="group relative ml-1.5 inline-flex items-center align-middle cursor-help">
      <svg className="h-4 w-4 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
      <div className="absolute bottom-full left-1/2 mb-2 hidden w-48 -translate-x-1/2 rounded-md bg-slate-800 px-2.5 py-2 text-xs font-normal text-slate-100 shadow-lg group-hover:block dark:bg-slate-700 z-10 text-center pointer-events-none">
        {text}
        <svg className="absolute top-full left-1/2 -translate-x-1/2 text-slate-800 dark:text-slate-700 h-2 w-full" viewBox="0 0 8 4" fill="currentColor" preserveAspectRatio="none" style={{ width: '8px' }}>
          <path d="M0 0l4 4 4-4H0z" />
        </svg>
      </div>
    </span>
  );
}

export default function Simulation() {
  const queryClient = useQueryClient();

  const statusQuery = useQuery({
    queryKey: ["simulation", "status"],
    queryFn: api.simulation.status,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      if (state === "running" || state === "stopping") {
        const configInterval = (query.state.data?.config?.interval_seconds || 1) * 1000;
        return Math.max(1000, configInterval);
      }
      return 10000;
    },
  });

  const metricsQuery = useQuery({
    queryKey: ["simulation", "metrics"],
    queryFn: () => api.simulation.metrics(100),
    refetchInterval: () => {
      const state = statusQuery.data?.state;
      if (state === "running" || state === "stopping") {
        const configInterval = (statusQuery.data?.config?.interval_seconds || 1) * 1000;
        return Math.max(1000, configInterval);
      }
      return 10000;
    },
  });

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", "latest"],
    queryFn: api.vehicles.latest,
    refetchInterval: () => {
      const state = statusQuery.data?.state;
      if (state === "running" || state === "stopping") {
        const configInterval = (statusQuery.data?.config?.interval_seconds || 1) * 1000;
        return Math.max(1000, configInterval);
      }
      return 15000;
    },
  });

  const startMutation = useMutation({
    mutationFn: api.simulation.start,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["simulation", "status"] });
    },
  });

  const stopMutation = useMutation({
    mutationFn: api.simulation.stop,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["simulation", "status"] });
    },
  });

  const [form, setForm] = useState<SimulationStartRequest>({
    num_vehicles: 20,
    interval_seconds: 5,
    mode: "batch",
    targets: ["pg", "ts"],
    max_rows: 100000,
  });

  const handleStart = (e: React.FormEvent) => {
    e.preventDefault();
    if (form.num_vehicles < 1 || form.interval_seconds < 1) return;
    startMutation.mutate(form);
  };

  const isRunning = statusQuery.data?.state === "running" || statusQuery.data?.state === "stopping";
  const stateLabel = statusQuery.data?.state.toUpperCase() ?? "UNKNOWN";
  
  const isBackendDown = statusQuery.isError && statusQuery.error instanceof ApiError && statusQuery.error.status === 0;

  return (
    <div>
      <PageHeader title="Simulation" description="Live insert benchmark. Watch TimescaleDB and PostgreSQL ingest data in real time." />
      
      {isBackendDown ? (
        <ErrorState error={statusQuery.error!} onRetry={() => statusQuery.refetch()} />
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Controls */}
          <div className="lg:col-span-1 space-y-6">
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-lg font-medium mb-4">Configuration</h3>
              <form onSubmit={handleStart} className="space-y-4 text-sm">
                <div>
                  <label className="flex items-center text-slate-500 mb-1">
                    Vehicles
                    <InfoIcon text="Number of virtual vehicles to simulate" />
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    value={form.num_vehicles}
                    onChange={(e) => setForm({ ...form, num_vehicles: parseInt(e.target.value) || 1 })}
                    disabled={isRunning}
                  />
                </div>
                <div>
                  <label className="flex items-center text-slate-500 mb-1">
                    Interval (s)
                    <InfoIcon text="Seconds between data points per vehicle" />
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    value={form.interval_seconds}
                    onChange={(e) => setForm({ ...form, interval_seconds: parseFloat(e.target.value) || 1 })}
                    disabled={isRunning || form.mode === "burst"}
                  />
                </div>
                <div>
                  <label className="flex items-center text-slate-500 mb-1">
                    Mode
                    <InfoIcon text="Batch (single query), Per Row (multiple queries), or Burst (max throughput)" />
                  </label>
                  <select
                    className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    value={form.mode}
                    onChange={(e) => setForm({ ...form, mode: e.target.value as any })}
                    disabled={isRunning}
                  >
                    <option value="batch">Batch (one insert per tick)</option>
                    <option value="per_row">Per Row (one insert per vehicle)</option>
                    <option value="burst">Burst (no wait between ticks)</option>
                  </select>
                </div>
                <div>
                  <label className="flex items-center text-slate-500 mb-1">
                    Max Rows
                    <InfoIcon text="Simulation will stop automatically when this limit is reached per table" />
                  </label>
                  <input
                    type="number"
                    min="1"
                    className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
                    value={form.max_rows}
                    onChange={(e) => setForm({ ...form, max_rows: parseInt(e.target.value) || 1 })}
                    disabled={isRunning}
                  />
                </div>
                <div>
                  <label className="block text-slate-500 mb-1">Targets</label>
                  <div className="flex gap-4">
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.targets.includes("pg")}
                        onChange={(e) => {
                          const tgts = e.target.checked ? [...form.targets, "pg"] : form.targets.filter((t) => t !== "pg");
                          setForm({ ...form, targets: tgts as any });
                        }}
                        disabled={isRunning}
                      />
                      PostgreSQL
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={form.targets.includes("ts")}
                        onChange={(e) => {
                          const tgts = e.target.checked ? [...form.targets, "ts"] : form.targets.filter((t) => t !== "ts");
                          setForm({ ...form, targets: tgts as any });
                        }}
                        disabled={isRunning}
                      />
                      TimescaleDB
                    </label>
                  </div>
                </div>

                {startMutation.isError && (
                  <div className="text-red-500 text-xs mt-2 bg-red-50 p-2 rounded border border-red-200">
                    {(startMutation.error as any)?.message || "Failed to start"}
                  </div>
                )}
                {stopMutation.isError && (
                  <div className="text-red-500 text-xs mt-2 bg-red-50 p-2 rounded border border-red-200">
                    {(stopMutation.error as any)?.message || "Failed to stop"}
                  </div>
                )}

                <div className="pt-4 flex gap-3">
                  <button
                    type="submit"
                    disabled={isRunning || form.targets.length === 0}
                    className="flex-1 rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-500 disabled:opacity-50"
                  >
                    Start
                  </button>
                  <button
                    type="button"
                    onClick={() => stopMutation.mutate()}
                    disabled={!isRunning}
                    className="flex-1 rounded-md bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-500 disabled:opacity-50"
                  >
                    Stop
                  </button>
                </div>
              </form>
            </div>
          </div>

          {/* Stats and Charts */}
          <div className="lg:col-span-2 space-y-6">
            {statusQuery.isPending ? (
              <LoadingState />
            ) : statusQuery.isError ? (
              <ErrorState error={statusQuery.error} onRetry={() => statusQuery.refetch()} />
            ) : (
              <>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <StatCard title="State" value={
                    <span className={stateLabel === "RUNNING" ? "text-brand-600 dark:text-brand-400" : stateLabel === "FAILED" ? "text-rose-600" : ""}>
                      {stateLabel}
                    </span>
                  } subvalue={statusQuery.data.message || undefined} />
                  <StatCard title="Rows (PG)" value={statusQuery.data.totals.rows_pg.toLocaleString()} />
                  <StatCard title="Rows (TS)" value={statusQuery.data.totals.rows_ts.toLocaleString()} />
                  <StatCard title="Rows / Sec" value={statusQuery.data.rows_per_second.toFixed(1)} />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <StatCard title="Latency PG" value={`${statusQuery.data.latency_ms.pg.p50.toFixed(1)} ms`} subvalue={`p95: ${statusQuery.data.latency_ms.pg.p95.toFixed(1)} ms`} />
                  <StatCard title="Latency TS" value={`${statusQuery.data.latency_ms.ts.p50.toFixed(1)} ms`} subvalue={`p95: ${statusQuery.data.latency_ms.ts.p95.toFixed(1)} ms`} />
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-medium mb-4">Latency Chart (ms)</h3>
                  {metricsQuery.isPending ? (
                    <LoadingState />
                  ) : metricsQuery.isError ? (
                    <ErrorState error={metricsQuery.error} />
                  ) : metricsQuery.data.points.length === 0 ? (
                    <EmptyState message="No data yet" />
                  ) : (
                    <div className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={metricsQuery.data.points.slice().reverse()} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                          <XAxis 
                            dataKey="time" 
                            tickFormatter={(v) => new Date(v as string | number).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })} 
                            stroke="#888" 
                            fontSize={12}
                          />
                          <YAxis stroke="#888" fontSize={12} />
                          <Tooltip 
                            contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                            labelFormatter={(v) => new Date(v as string | number).toLocaleTimeString()}
                          />
                          <Legend />
                          <Line type="monotone" dataKey="latency_ms.pg" name="PostgreSQL" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                          <Line type="monotone" dataKey="latency_ms.ts" name="TimescaleDB" stroke="#f59e0b" strokeWidth={2} dot={false} isAnimationActive={false} />
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>

                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
                  <h3 className="text-lg font-medium mb-4">Live Map</h3>
                  {vehiclesQuery.isPending ? (
                    <LoadingState />
                  ) : vehiclesQuery.isError ? (
                    <ErrorState error={vehiclesQuery.error} />
                  ) : vehiclesQuery.data.length === 0 ? (
                    <EmptyState message="No vehicle data" />
                  ) : (
                    <div className="h-[400px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                      <MapContainer center={[-6.2000, 106.8000]} zoom={12} scrollWheelZoom={false} style={{ height: "100%", width: "100%" }}>
                        <TileLayer
                          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                        />
                        {vehiclesQuery.data.slice(0, 300).map((v) => {
                          const ageMinutes = (Date.now() - new Date(v.time).getTime()) / 60000;
                          const isOld = ageMinutes > 2;
                          const iconHtml = `<div style="transform: rotate(${v.heading_deg}deg); font-size: 16px; color: ${isOld ? '#94a3b8' : '#3b82f6'};">&#10148;</div>`;
                          const customIcon = L.divIcon({
                            html: iconHtml,
                            className: 'custom-leaflet-icon',
                            iconSize: [20, 20],
                            iconAnchor: [10, 10]
                          });
                          
                          return (
                            <Marker key={v.vehicle_id} position={[v.latitude, v.longitude]} icon={customIcon}>
                              <Popup>
                                <div className="text-sm">
                                  <strong>{v.plate_number}</strong><br/>
                                  {v.name && <span>{v.name}<br/></span>}
                                  Speed: {v.speed_kmh} km/h<br/>
                                  Time: {new Date(v.time).toLocaleTimeString()}
                                </div>
                              </Popup>
                            </Marker>
                          );
                        })}
                      </MapContainer>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

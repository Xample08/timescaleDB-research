import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { MapContainer, TileLayer, Polyline, Marker, Popup } from "react-leaflet";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, Legend, ResponsiveContainer } from "recharts";
import { api } from "../api";
import PageHeader from "../components/PageHeader";
import ErrorState from "../components/ErrorState";
import LoadingState from "../components/LoadingState";
import EmptyState from "../components/EmptyState";
import L from "leaflet";

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

export default function Vehicles() {
  const [selectedVehicleId, setSelectedVehicleId] = useState<number | "">("");
  // Time range picker state (default last 1 hour)
  const [timeRangeHours, setTimeRangeHours] = useState<number>(1);
  const [hourlyRange, setHourlyRange] = useState<number>(48);

  const vehiclesQuery = useQuery({
    queryKey: ["vehicles", "latest"],
    queryFn: api.vehicles.latest,
  });

  const selectedVehicle = useMemo(() => {
    return vehiclesQuery.data?.find(v => v.vehicle_id === selectedVehicleId);
  }, [vehiclesQuery.data, selectedVehicleId]);

  const toTime = useMemo(() => {
    if (selectedVehicle) return new Date(selectedVehicle.time);
    return new Date();
  }, [selectedVehicle]);

  const fromTime = useMemo(() => {
    return new Date(toTime.getTime() - timeRangeHours * 3600000);
  }, [toTime, timeRangeHours]);

  const routeQuery = useQuery({
    queryKey: ["vehicles", "route", selectedVehicleId, fromTime.toISOString(), toTime.toISOString()],
    queryFn: () => api.vehicles.route(selectedVehicleId as number, fromTime.toISOString(), toTime.toISOString(), 2000),
    enabled: !!selectedVehicleId,
  });

  const hourlyQuery = useQuery({
    queryKey: ["vehicles", "hourly", selectedVehicleId, hourlyRange],
    queryFn: () => api.vehicles.hourly(selectedVehicleId as number, hourlyRange),
    enabled: !!selectedVehicleId,
  });

  return (
    <div>
      <PageHeader title="Vehicles" description="Vehicle routes and historical speed analysis." />

      <div className="mb-6 rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900 flex flex-wrap gap-4 items-end">
        <div className="flex-1 min-w-[200px]">
          <label className="block text-sm font-medium text-slate-500 mb-1">Select Vehicle</label>
          <select
            className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
            value={selectedVehicleId}
            onChange={(e) => setSelectedVehicleId(e.target.value ? parseInt(e.target.value) : "")}
          >
            <option value="">-- Select a vehicle --</option>
            {vehiclesQuery.data?.map(v => (
              <option key={v.vehicle_id} value={v.vehicle_id}>
                {v.plate_number} {v.name ? `(${v.name})` : ""}
              </option>
            ))}
          </select>
        </div>
        <div className="w-48">
          <label className="block text-sm font-medium text-slate-500 mb-1">
            Route Range (hours) <InfoIcon text="Max 24 hours" />
          </label>
          <input
            type="number"
            min="1"
            max="24"
            className="w-full rounded-md border border-slate-300 px-3 py-2 dark:border-slate-700 dark:bg-slate-800"
            value={timeRangeHours}
            onChange={(e) => setTimeRangeHours(Math.min(24, Math.max(1, parseInt(e.target.value) || 1)))}
            disabled={!selectedVehicleId}
          />
        </div>
      </div>

      {!selectedVehicleId ? (
        <EmptyState message="Please select a vehicle to view its data." />
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Map */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-lg font-medium mb-4">Route Map</h3>
              {routeQuery.isPending ? (
                <LoadingState />
              ) : routeQuery.isError ? (
                <ErrorState error={routeQuery.error} onRetry={() => routeQuery.refetch()} />
              ) : routeQuery.data.length === 0 ? (
                <EmptyState message="No route data found for this time range." />
              ) : (
                <div className="h-[400px] rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700">
                  <MapContainer 
                    center={[routeQuery.data[0].latitude, routeQuery.data[0].longitude]} 
                    zoom={13} 
                    scrollWheelZoom={false} 
                    style={{ height: "100%", width: "100%" }}
                  >
                    <TileLayer
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <Polyline 
                      positions={routeQuery.data.map(p => [p.latitude, p.longitude])} 
                      color="#3b82f6" 
                      weight={3} 
                    />
                    {selectedVehicle && (
                      <Marker 
                        position={[selectedVehicle.latitude, selectedVehicle.longitude]}
                        icon={L.divIcon({
                          html: `<div style="transform: rotate(${selectedVehicle.heading_deg}deg); font-size: 16px; color: #3b82f6;">&#10148;</div>`,
                          className: 'custom-leaflet-icon',
                          iconSize: [20, 20],
                          iconAnchor: [10, 10]
                        })}
                      >
                        <Popup>
                          <div className="text-sm">
                            <strong>{selectedVehicle.plate_number}</strong><br/>
                            Current position
                          </div>
                        </Popup>
                      </Marker>
                    )}
                  </MapContainer>
                </div>
              )}
            </div>

            {/* Speed Line Chart */}
            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
              <h3 className="text-lg font-medium mb-4">Speed (last {timeRangeHours}h)</h3>
              {routeQuery.isPending ? (
                <LoadingState />
              ) : routeQuery.isError ? (
                <ErrorState error={routeQuery.error} onRetry={() => routeQuery.refetch()} />
              ) : routeQuery.data.length === 0 ? (
                <EmptyState message="No route data found for this time range." />
              ) : (
                <div className="h-[400px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={routeQuery.data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                      <XAxis 
                        dataKey="time" 
                        tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit' })} 
                        stroke="#888" 
                        fontSize={12}
                        minTickGap={30}
                      />
                      <YAxis stroke="#888" fontSize={12} domain={[0, 'auto']} />
                      <RechartsTooltip 
                        contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                        labelFormatter={(v) => new Date(v as string | number).toLocaleTimeString()}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="speed_kmh" name="Speed (km/h)" stroke="#3b82f6" strokeWidth={2} dot={false} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Hourly Bar Chart */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-lg font-medium">Hourly Speed Stats</h3>
              <div className="flex items-center gap-2">
                <label className="text-sm text-slate-500">Range (hours):</label>
                <input
                  type="number"
                  min="1"
                  max="720"
                  className="w-24 rounded-md border border-slate-300 px-2 py-1 dark:border-slate-700 dark:bg-slate-800 text-sm"
                  value={hourlyRange}
                  onChange={(e) => setHourlyRange(Math.max(1, parseInt(e.target.value) || 48))}
                />
              </div>
            </div>
            
            {hourlyQuery.isPending ? (
              <LoadingState />
            ) : hourlyQuery.isError ? (
              <ErrorState error={hourlyQuery.error} onRetry={() => hourlyQuery.refetch()} />
            ) : hourlyQuery.data.length === 0 ? (
              <EmptyState message="The continuous aggregate has no data for this vehicle yet. Data is aggregated periodically in the background while the simulation runs." />
            ) : (
              <div className="h-[300px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyQuery.data} margin={{ top: 5, right: 5, left: -20, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" opacity={0.2} vertical={false} />
                    <XAxis 
                      dataKey="bucket" 
                      tickFormatter={(v) => {
                        const d = new Date(v);
                        return `${d.getMonth()+1}/${d.getDate()} ${d.getHours()}:00`;
                      }} 
                      stroke="#888" 
                      fontSize={12}
                    />
                    <YAxis stroke="#888" fontSize={12} />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: '#1e293b', border: 'none', borderRadius: '8px', color: '#f8fafc' }}
                      labelFormatter={(v) => new Date(v as string | number).toLocaleString()}
                    />
                    <Legend />
                    <Bar dataKey="avg_speed" name="Avg Speed (km/h)" fill="#3b82f6" isAnimationActive={false} />
                    <Bar dataKey="max_speed" name="Max Speed (km/h)" fill="#f59e0b" isAnimationActive={false} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

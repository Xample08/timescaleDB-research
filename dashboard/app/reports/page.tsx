"use client";
import dynamic from "next/dynamic";
import Link from "next/link";
import { AppNavigation } from "@/components/AppNavigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
} from "recharts";
import { Icon } from "@/components/Icon";
import { InfoTip } from "@/components/InfoTip";
import { FleetReport, vehicleState, validPosition } from "@/lib/fleet";
import { WARNING_LABELS, WarningKind } from "@/lib/warnings";
const FleetMap = dynamic(() => import("@/components/FleetMap"), {
  ssr: false,
  loading: () => <div className="report-empty">Loading map...</div>,
});
const number = (n: number | null | undefined, unit = "") =>
  n == null
    ? "Unavailable"
    : `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })}${unit}`;
const time = (value: string | null) =>
  value
    ? new Date(value).toLocaleTimeString("en-GB", {
        timeZone: "Asia/Jakarta",
        hour12: false,
      })
    : "No sample";
function useVisibleRows() {
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState(4);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(() =>
      setSize(Math.max(1, Math.floor(element.clientHeight / 40))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return { ref, size };
}
function Pager({
  page,
  total,
  size,
  onChange,
}: {
  page: number;
  total: number;
  size: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="report-pager">
      <span>
        {total} results / {page + 1}/{pages}
      </span>
      <button
        disabled={page === 0}
        onClick={() => onChange(page - 1)}
        aria-label="Previous page"
      >
        Previous
      </button>
      <button
        disabled={page + 1 >= pages}
        onClick={() => onChange(page + 1)}
        aria-label="Next page"
      >
        Next
      </button>
    </div>
  );
}
export default function ReportsPage() {
  const { ref: vehicleRowsRef, size: vehicleRowCount } = useVisibleRows();
  const { ref: warningRowsRef, size: warningRowCount } = useVisibleRows();
  const [target, setTarget] = useState<"pg" | "ts">("ts");
  const [data, setData] = useState<FleetReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [auto, setAuto] = useState(true);
  const [selected, setSelected] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const [vehiclePage, setVehiclePage] = useState(0);
  const [warningPage, setWarningPage] = useState(0);
  const [activeOnly, setActiveOnly] = useState(true);
  const [kind, setKind] = useState<WarningKind | "all">("all");
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      if (controller.signal.aborted) return;
      if (document.hidden) {
        if (auto) timer = setTimeout(load, 15000);
        return;
      }
      setLoading(true);
      try {
        const response = await fetch(`/api/fleet?target=${target}`, {
          signal: controller.signal,
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Report unavailable");
        if (!controller.signal.aborted) {
          setData(body);
          setError(null);
        }
      } catch (cause) {
        if (!controller.signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Report unavailable",
          );
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (auto) timer = setTimeout(load, 15000);
        }
      }
    };
    load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [target, refresh, auto]);
  const switchTarget = useCallback(
    (next: "pg" | "ts") => {
      if (next === target) return;
      setData(null);
      setError(null);
      setLoading(true);
      setSelected(null);
      setVehiclePage(0);
      setWarningPage(0);
      setTarget(next);
    },
    [target],
  );
  useEffect(() => {
    const read = () =>
      switchTarget(window.location.hash === "#pg" ? "pg" : "ts");
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, [switchTarget]);
  const select = useCallback((id: number) => setSelected(id), []);
  const warningIds = useMemo(
    () => [
      ...new Set(data?.warnings.activeVehicles?.map((v) => v.vehicleId) || []),
    ],
    [data],
  );
  const vehicles = useMemo(
    () =>
      data?.vehicles.filter((v) =>
        `${v.plate} ${v.id} ${v.name || ""}`
          .toLowerCase()
          .includes(search.toLowerCase()),
      ) || [],
    [data, search],
  );
  const warnings = useMemo(
    () =>
      data?.warnings.reports.filter(
        (w) => (!activeOnly || w.active) && (kind === "all" || kind === w.kind),
      ) || [],
    [data, activeOnly, kind],
  );
  const vpage = Math.min(
    vehiclePage,
    Math.max(0, Math.ceil(vehicles.length / vehicleRowCount) - 1),
  );
  const wpage = Math.min(
    warningPage,
    Math.max(0, Math.ceil(warnings.length / warningRowCount) - 1),
  );
  const focused = data?.vehicles.find((v) => v.id === selected);
  const label = target === "pg" ? "PostgreSQL" : "TimescaleDB";
  const color = target === "pg" ? "#60a5fa" : "#2dd4bf";
  const moving =
    data?.vehicles.filter((v) => vehicleState(v, data.checkedAt) === "Moving")
      .length || 0;
  const stale =
    data?.vehicles.filter((v) =>
      ["Stale", "No data"].includes(vehicleState(v, data.checkedAt)),
    ).length || 0;
  return (
    <main className={`fleet-report ${target}`}>
      <header className="topbar report-topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Icon name="bolt" />
          </span>
          <span>
            Telemetry Lab<small>FLEET REPORTING</small>
          </span>
        </Link>
        <AppNavigation section="reports" active={target} />
      </header>
      <div className="report-title">
        <div>
          <p className="eyebrow">{label.toUpperCase()} / OPERATIONS OVERVIEW</p>
          <h1>
            Fleet reporting <small>Latest positions + last 24 hours</small>
          </h1>
        </div>
        <div className="report-actions">
          <label>
            <input
              type="checkbox"
              checked={auto}
              onChange={(e) => setAuto(e.target.checked)}
            />{" "}
            Live / 15 s
          </label>
          <button disabled={loading} onClick={() => setRefresh((v) => v + 1)}>
            {loading ? "Checking..." : "Refresh"}
          </button>
          <span>
            {data
              ? `Checked ${time(data.checkedAt)} WIB`
              : "Awaiting telemetry"}
          </span>
        </div>
      </div>
      {error && (
        <div role="alert" className="report-error">
          {error}
          {data
            ? "  /  Showing the last successful report; status may be outdated."
            : "  /  No report available."}
        </div>
      )}
      <section className="report-metrics" aria-label="Fleet summary">
        {[
          [
            "Vehicles",
            number(data?.vehicles.length),
            `${moving} moving  /  ${stale} stale / no data`,
          ],
          [
            "Samples / 24 h",
            number(data?.summary.samples),
            "Stored telemetry records",
          ],
          [
            "Average speed",
            number(data?.summary.avgSpeed, " km/h"),
            `Peak ${number(data?.summary.maxSpeed, " km/h")}`,
          ],
          [
            "Altitude range",
            data
              ? `${number(data.summary.minAltitude)}  to  ${number(data.summary.maxAltitude, " m")}`
              : "Unavailable",
            "Minimum / maximum in 24 h",
          ],
          [
            "Average GPS error",
            number(data?.summary.avgGps, " m"),
            "Smaller error is better",
          ],
          [
            "Active violations",
            number(data?.warnings.activeCount),
            `${warningIds.length} affected vehicles`,
          ],
        ].map(([name, value, hint]) => (
          <article
            key={name}
            className={
              name === "Active violations" && data?.warnings.activeCount
                ? "metric-warning"
                : ""
            }
          >
            <span>{name}</span>
            <strong>{value}</strong>
            <small>{hint}</small>
          </article>
        ))}
      </section>
      <div className="report-grid">
        <section className="report-map-card report-panel">
          <div className="report-panel-heading">
            <h2>Vehicle locations</h2>
            <span>
              {data?.vehicles.filter(validPosition).length || 0} mapped{" "}
              <InfoTip
                label="Map status"
                text="Markers show the latest stored position for each vehicle in the selected database. Gray markers are older than 120 seconds; amber markers have active rule violations. Invalid or missing coordinates are excluded. Select a marker or vehicle to inspect its readings."
              />
            </span>
          </div>
          <FleetMap
            key={target}
            vehicles={data?.vehicles || []}
            checkedAt={data?.checkedAt || new Date().toISOString()}
            warningIds={warningIds}
            selected={selected}
            onSelect={select}
            target={target}
          />
          {!data?.vehicles.some(validPosition) && (
            <div className="map-empty">
              {loading
                ? "Loading vehicle positions..."
                : "No valid positions in this database"}
            </div>
          )}
          <div className="vehicle-inspector">
            {focused ? (
              <>
                <b>
                  {focused.plate}{" "}
                  <span>
                    #{focused.id} / {vehicleState(focused, data!.checkedAt)}
                  </span>
                </b>
                <div>
                  <span>
                    Speed <strong>{number(focused.speed, " km/h")}</strong>
                  </span>
                  <span>
                    Altitude <strong>{number(focused.altitude, " m")}</strong>
                  </span>
                  <span>
                    GPS error <strong>{number(focused.gps, " m")}</strong>
                  </span>
                  <span>
                    Heading <strong>{number(focused.heading, " deg")}</strong>
                  </span>
                </div>
                <small>
                  {focused.name || "Unnamed vehicle"} /{" "}
                  {focused.type || "Unspecified type"} /{" "}
                  {focused.latitude?.toFixed(5) ?? "No latitude"},{" "}
                  {focused.longitude?.toFixed(5) ?? "No longitude"} / Sample{" "}
                  {focused.time
                    ? new Date(focused.time).toLocaleString("en-GB", {
                        timeZone: "Asia/Jakarta",
                      })
                    : "unavailable"}{" "}
                  WIB
                </small>
              </>
            ) : (
              <p>
                Select a car on the map or in the fleet list to see its
                telemetry.
              </p>
            )}
          </div>
          <div className="report-trend">
            <div className="report-panel-heading">
              <h2>Speed trend</h2>
              <span>Hourly average / 24 h</span>
            </div>
            <div className="report-chart">
              {data?.hourly.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={data.hourly}>
                    <XAxis
                      dataKey="time"
                      tickFormatter={(v) => time(v).slice(0, 5)}
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      minTickGap={35}
                    />
                    <YAxis
                      tick={{ fill: "#94a3b8", fontSize: 10 }}
                      width={35}
                    />
                    <Tooltip
                      labelFormatter={(v) => time(String(v)) + " WIB"}
                      formatter={(v) => [
                        number(Number(v), " km/h"),
                        "Average speed",
                      ]}
                      contentStyle={{
                        background: "#111d2f",
                        border: "1px solid #334155",
                      }}
                    />
                    <Area
                      dataKey="speed"
                      stroke={color}
                      fill={color}
                      fillOpacity={0.15}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <p className="report-empty">
                  No speed samples in the last 24 hours.
                </p>
              )}
            </div>
          </div>
        </section>
        <div className="report-side">
          <section className="report-panel report-warning-panel">
            <div className="report-panel-heading">
              <h2>
                <Icon name="warning" /> Rule violations
              </h2>
              <InfoTip
                label="Warning rules"
                text="Rules: speed above 80 km/h; continuous stop of at least 5 minutes with gaps no longer than 120 seconds; altitude above 300 m or below zero; GPS error above 50 m. Active means the latest vehicle sample is within 120 seconds. Counts cover 24 hours; details show up to 200 matches, active first. Missing telemetry is not proof of safe driving."
              />
            </div>
            <div className="report-rule-counts">
              {(Object.keys(WARNING_LABELS) as WarningKind[]).map((k) => (
                <button
                  key={k}
                  className={kind === k ? "chosen" : ""}
                  onClick={() => {
                    setKind(kind === k ? "all" : k);
                    setWarningPage(0);
                  }}
                >
                  <span>{WARNING_LABELS[k]}</span>
                  <b>{data ? data.warnings.counts[k] : "Unavailable"}</b>
                </button>
              ))}
            </div>
            <div className="report-list-toolbar">
              <label>
                <input
                  type="checkbox"
                  checked={activeOnly}
                  onChange={(e) => {
                    setActiveOnly(e.target.checked);
                    setWarningPage(0);
                  }}
                />{" "}
                Active only
              </label>
              <span>
                {kind === "all" ? "All rules" : WARNING_LABELS[kind]} / Latest
                200
              </span>
            </div>
            <div className="report-rows" ref={warningRowsRef}>
              {warnings
                .slice(wpage * warningRowCount, (wpage + 1) * warningRowCount)
                .map((w, i) => (
                  <button
                    className="violation-row"
                    key={`${w.vehicleId}-${w.kind}-${w.endedAt}-${i}`}
                    onClick={() => select(w.vehicleId)}
                  >
                    <span
                      className={`violation-status ${w.active ? "active" : ""}`}
                    >
                      {w.active ? "Active" : "History"}
                    </span>
                    <span>
                      <b>
                        {w.plate} / {WARNING_LABELS[w.kind]}
                      </b>
                      <small>
                        {time(w.endedAt)} WIB /{" "}
                        {number(
                          w.value,
                          w.kind === "speeding"
                            ? " km/h"
                            : w.kind === "longStop"
                              ? " min"
                              : " m",
                        )}{" "}
                        {w.kind === "altitude" && w.value < 0
                          ? "<"
                          : w.kind === "longStop"
                            ? ">="
                            : ">"}{" "}
                        {w.threshold}
                      </small>
                    </span>
                  </button>
                ))}
              {!warnings.length && (
                <p className="report-empty">
                  {loading && !data
                    ? "Checking rules..."
                    : !data
                      ? "Report unavailable"
                      : !data.summary.samples
                        ? "No telemetry to assess"
                        : activeOnly
                          ? "No active violations matching this filter"
                          : "No historical matches for this rule"}
                </p>
              )}
            </div>
            <Pager
              page={wpage}
              total={warnings.length}
              size={warningRowCount}
              onChange={setWarningPage}
            />
          </section>
          <section className="report-panel report-vehicles-panel">
            <div className="report-panel-heading">
              <h2>Fleet status</h2>
              <span>{vehicles.length} vehicles</span>
            </div>
            <input
              className="fleet-search"
              aria-label="Find vehicle"
              placeholder="Find plate, ID or name..."
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setVehiclePage(0);
              }}
            />
            <div className="report-rows" ref={vehicleRowsRef}>
              {vehicles
                .slice(vpage * vehicleRowCount, (vpage + 1) * vehicleRowCount)
                .map((v) => (
                  <button
                    key={v.id}
                    className={`fleet-row ${selected === v.id ? "selected" : ""}`}
                    onClick={() => select(v.id)}
                  >
                    <span>
                      <b>{v.plate}</b>
                      <small>
                        #{v.id} / {time(v.time)} WIB
                      </small>
                    </span>
                    <span className={warningIds.includes(v.id) ? "amber" : ""}>
                      {warningIds.includes(v.id)
                        ? "Warning"
                        : vehicleState(v, data!.checkedAt)}
                      <small>{number(v.speed, " km/h")}</small>
                    </span>
                  </button>
                ))}
              {!vehicles.length && (
                <p className="report-empty">
                  {loading && !data ? "Loading fleet..." : "No vehicles found"}
                </p>
              )}
            </div>
            <Pager
              page={vpage}
              total={vehicles.length}
              size={vehicleRowCount}
              onChange={setVehiclePage}
            />
          </section>
        </div>
      </div>
      <footer className="report-footer">
        <span>
          Blue: PostgreSQL / Teal: TimescaleDB / Amber: rule violation
        </span>
        <span>Reports only / No external notifications sent</span>
      </footer>
    </main>
  );
}

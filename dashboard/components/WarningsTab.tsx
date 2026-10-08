"use client";
import React, { useCallback, useEffect, useState } from "react";
import { Card, Button, ErrorState, Spinner, EmptyState, Field } from "./ui";
import { NumberField, Checkbox } from "./FormControls";
import { ResizablePanels } from "./ResizablePanels";
import { Icon } from "./Icon";
import { useSqlFetch } from "./SqlExecution";
import { DEFAULT_LAYOUT } from "../lib/layout";
import {
  DEFAULT_WARNING_SETTINGS,
  WARNING_FIELDS,
  WARNING_LABELS,
  WarningSettings,
  WarningResponse,
  WarningKind,
  WarningEntry,
  validateWarningSettings,
} from "../lib/warnings";
function time(value: string | null) {
  return value
    ? new Date(value).toLocaleString("en-GB", {
        timeZone: "Asia/Jakarta",
        hour12: false,
      }) + " WIB"
    : "No telemetry";
}
function reading(entry: WarningEntry) {
  return `${Number(entry.value).toFixed(1)} ${entry.kind === "speeding" ? "km/h" : entry.kind === "longStop" ? "min" : "m"}`;
}
export function WarningsTab() {
  const sqlFetch = useSqlFetch("Warnings");
  const [draft, setDraft] = useState<WarningSettings>(DEFAULT_WARNING_SETTINGS);
  const [settings, setSettings] = useState<WarningSettings>(
    DEFAULT_WARNING_SETTINGS,
  );
  const [errors, setErrors] = useState<
    Partial<Record<keyof WarningSettings, string>>
  >({});
  const [data, setData] = useState<WarningResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [kind, setKind] = useState<WarningKind | "all">("all");
  const [activeOnly, setActiveOnly] = useState(false);
  const [vehicle, setVehicle] = useState("");
  const request = useCallback(
    async (signal: AbortSignal) => {
      if (document.hidden) return;
      setLoading(true);
      try {
        const params = new URLSearchParams(
          Object.entries(settings).map(([key, value]) => [key, String(value)]),
        );
        const response = await sqlFetch(`/api/warnings?${params}`, { signal });
        const body = await response.json();
        if (signal.aborted) return;
        if (!response.ok)
          throw new Error(body.error || "Warning report failed");
        setData(body);
        setError(null);
      } catch (cause) {
        if (!signal.aborted)
          setError(
            cause instanceof Error ? cause.message : "Warning report failed",
          );
      } finally {
        if (!signal.aborted) setLoading(false);
      }
    },
    [settings, sqlFetch],
  );
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let busy = false;
    const refresh = async () => {
      if (busy || controller.signal.aborted) return;
      busy = true;
      await request(controller.signal);
      busy = false;
      if (autoRefresh && !controller.signal.aborted)
        timer = setTimeout(refresh, 30000);
    };
    refresh();
    const visible = () => {
      if (!document.hidden && autoRefresh) {
        clearTimeout(timer);
        refresh();
      }
    };
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [request, autoRefresh, refreshKey]);
  const apply = () => {
    const nextErrors = validateWarningSettings(draft);
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length) {
      setData(null);
      setSettings({ ...draft });
      setRefreshKey((key) => key + 1);
    }
  };
  const active = Math.max(
    data?.results.pg.report?.activeCount || 0,
    data?.results.ts.report?.activeCount || 0,
  );
  const known = !!data && !!data.results.pg.report && !!data.results.ts.report;
  const hasSamples =
    !!data &&
    Object.values(data.results).some(
      (result) => (result.report?.sampleCount || 0) > 0,
    );
  return (
    <ResizablePanels
      className="tab-columns"
      label="Warning settings and reports"
      initialSizes={DEFAULT_LAYOUT.tab}
    >
      <Card title="Warning thresholds">
        <p className="helper">
          Match these thresholds to your simulator. Reports inspect actual
          stored samples.
        </p>
        <div className="warning-settings-fields">
          {WARNING_FIELDS.map(([key, label, min, max, help]) => (
            <NumberField
              key={key}
              id={`warning-${key}`}
              label={label}
              placeholder={`${min} - ${max}`}
              min={min}
              max={max}
              help={help}
              value={draft[key]}
              onChange={(value) =>
                setDraft((previous) => ({ ...previous, [key]: value }))
              }
              error={errors[key]}
            />
          ))}
        </div>
        <Checkbox
          checked={autoRefresh}
          onChange={setAutoRefresh}
          help="Refreshes the applied report every 30 seconds while this tab is open and visible. Requests never overlap."
        >
          Auto-refresh every 30 s
        </Checkbox>
        <Button
          variant="primary"
          className="w-full"
          onClick={apply}
          disabled={loading}
        >
          Apply & check warnings
        </Button>
        <Button
          className="w-full"
          onClick={() => setRefreshKey((key) => key + 1)}
          disabled={loading}
        >
          {loading ? "Checking..." : "Refresh applied report"}
        </Button>
        <p className="helper">
          No external messages are sent. Warnings are shown here in the
          dashboard.
        </p>
      </Card>
      <div className="warning-results">
        {error && <ErrorState message={error} />}{" "}
        {!data && !error && <Spinner />}
        {data && (
          <>
            <div
              className={`warning-banner ${active ? "has-warning" : known && hasSamples ? "clear" : "unknown"}`}
              role="status"
            >
              <Icon
                name={
                  active ? "warning" : known && hasSamples ? "check" : "warning"
                }
              />
              <div>
                <b>
                  {active
                    ? `Active warnings found (${data.results.pg.report?.activeCount ?? "unavailable"} PG / ${data.results.ts.report?.activeCount ?? "unavailable"} TS)`
                    : !known
                      ? "Warning check incomplete"
                      : !hasSamples
                        ? "No telemetry to assess"
                        : "No active warnings"}
                </b>
                <p>
                  {!known
                    ? "A database report is unavailable. Successful results are shown below."
                    : "Historical matches remain in the report even after a vehicle returns to normal."}
                </p>
              </div>
              {loading && <span>Refreshing...</span>}
            </div>
            <div className="report-window">
              <span>Checked {time(data.serverTime)}</span>
              <span>Lookback: {data.settings.hours} hours</span>
            </div>
            <div className="warning-summary-grid">
              {(["pg", "ts"] as const).map((target) => {
                const report = data.results[target].report;
                return (
                  <section
                    key={target}
                    className={`warning-database-summary ${target}`}
                  >
                    <h2>
                      <Icon name={target === "pg" ? "database" : "bolt"} />
                      {target === "pg" ? "PostgreSQL" : "TimescaleDB"}
                    </h2>
                    {data.results[target].error ? (
                      <p className="field-error">
                        {data.results[target].error}
                      </p>
                    ) : (
                      <>
                        <div className="warning-counts">
                          {(Object.keys(WARNING_LABELS) as WarningKind[]).map(
                            (type) => (
                              <div key={type}>
                                <span>{WARNING_LABELS[type]}</span>
                                <b
                                  className={
                                    report?.counts[type] ? "has-warning" : ""
                                  }
                                >
                                  {(report?.counts[type] || 0).toLocaleString()}
                                </b>
                              </div>
                            ),
                          )}
                        </div>
                        <p>
                          {report?.activeCount || 0} active /{" "}
                          {report?.sampleCount.toLocaleString() || 0} samples
                          inspected
                        </p>
                        <p>Latest: {time(report?.latestTime || null)}</p>
                      </>
                    )}
                  </section>
                );
              })}
            </div>
            <Card title="Warning details">
              <div className="warning-filters">
                <Field
                  label="Warning type"
                  hint="Filter the displayed warning details by rule."
                >
                  <select
                    value={kind}
                    onChange={(event) =>
                      setKind(event.target.value as WarningKind | "all")
                    }
                  >
                    <option value="all">All warning types</option>
                    {(Object.keys(WARNING_LABELS) as WarningKind[]).map(
                      (type) => (
                        <option key={type} value={type}>
                          {WARNING_LABELS[type]}
                        </option>
                      ),
                    )}
                  </select>
                </Field>
                <Field
                  label="Vehicle"
                  hint="Find warning details by vehicle ID or plate number."
                >
                  <input
                    placeholder="ID or plate"
                    value={vehicle}
                    onChange={(event) => setVehicle(event.target.value)}
                  />
                </Field>
                <Checkbox checked={activeOnly} onChange={setActiveOnly}>
                  Active only
                </Checkbox>
              </div>
              <p className="helper">
                Speed, altitude and GPS totals count flagged samples; long stops
                count continuous episodes. Showing up to {data.reportLimit}{" "}
                newest matches per database, with active warnings first. Totals
                cover the full window. Filters apply to these displayed matches.
              </p>
              {(["pg", "ts"] as const).map((target) => {
                const report = data.results[target].report;
                const entries =
                  report?.reports.filter(
                    (entry) =>
                      (kind === "all" || entry.kind === kind) &&
                      (!activeOnly || entry.active) &&
                      (!vehicle.trim() ||
                        String(entry.vehicleId).includes(vehicle.trim()) ||
                        entry.plate
                          .toLowerCase()
                          .includes(vehicle.trim().toLowerCase())),
                  ) || [];
                return (
                  <section key={target} className="warning-detail-section">
                    <h3 className={`variant-badge ${target}`}>
                      {target === "pg" ? "PostgreSQL" : "TimescaleDB"}
                    </h3>
                    {!report ? (
                      <p className="field-error">Report unavailable</p>
                    ) : !entries.length ? (
                      <EmptyState
                        title={
                          report.sampleCount
                            ? "No matching warnings"
                            : "No telemetry in this time window"
                        }
                        hint={
                          report.sampleCount
                            ? "Adjust filters or thresholds to inspect other matches."
                            : "Run the simulator or increase the lookback window."
                        }
                      />
                    ) : (
                      <div className="overflow-x-auto">
                        <table className="w-full text-left text-xs">
                          <thead>
                            <tr>
                              <th>Status</th>
                              <th>Warning</th>
                              <th>Vehicle</th>
                              <th>Observed</th>
                              <th>Threshold</th>
                              <th>From (WIB)</th>
                              <th>Last (WIB)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {entries.map((entry, index) => (
                              <tr
                                key={`${entry.kind}-${entry.vehicleId}-${entry.endedAt}-${index}`}
                                className={`result-row ${target}`}
                              >
                                <td>
                                  <span
                                    className={`warning-status ${entry.active ? "active" : ""}`}
                                  >
                                    {entry.active ? "Active" : "Historical"}
                                  </span>
                                </td>
                                <td>{WARNING_LABELS[entry.kind]}</td>
                                <td>
                                  {entry.plate} / #{entry.vehicleId}
                                </td>
                                <td>{reading(entry)}</td>
                                <td>
                                  {entry.kind === "longStop"
                                    ? ">="
                                    : entry.kind === "altitude" &&
                                        entry.value < 0
                                      ? "<"
                                      : ">"}{" "}
                                  {entry.threshold}{" "}
                                  {entry.kind === "speeding"
                                    ? "km/h"
                                    : entry.kind === "longStop"
                                      ? "min"
                                      : "m"}
                                </td>
                                <td>{time(entry.startedAt)}</td>
                                <td>{time(entry.endedAt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                );
              })}
            </Card>
          </>
        )}
      </div>
    </ResizablePanels>
  );
}

import React, { useId } from "react";
import { InfoTip } from "./InfoTip";
import { Icon } from "./Icon";

/**
 * ui.tsx - Shared UI primitives
 *
 * Exports:
 *
 * - AppHeader: Page header.
 *   Props: { title: ReactNode, right?: ReactNode }
 *   Example: <AppHeader title="Simulator" />
 *
 * - Card: Basic container.
 *   Props: { title?: string, right?: ReactNode, children: ReactNode }
 *   Example: <Card title="Settings"><p>Content</p></Card>
 *
 * - StatCard: Shows a single statistic.
 *   Props: { label: string, value: string | ReactNode, unit?: string, hint?: string }
 *   Example: <StatCard label="Lat" value="12.4" unit="ms" />
 *
 * - Badge: Small status indicator.
 *   Props: { tone: 'neutral' | 'warn' | 'error' | 'ok', children: ReactNode }
 *   Example: <Badge tone="ok">Connected</Badge>
 *
 * - Button: Action button.
 *   Props: { variant?: 'primary' | 'secondary' | 'danger', ...buttonProps }
 *   Example: <Button variant="primary" onClick={fn}>Save</Button>
 *
 * - Field: Form field wrapper with label and hints.
 *   Props: { label: string, hint?: string, error?: string, children: ReactNode }
 *   Example: <Field label="Max rows" error="Too large"><input /></Field>
 *
 * - Tabs: Tab navigation.
 *   Props: { tabs: { id: string, label: string }[], active: string, onChange: (id: string) => void }
 *   Example: <Tabs tabs={[{id: 'a', label: 'A'}]} active="a" onChange={set} />
 *
 * - Spinner: Loading indicator.
 *   Example: <Spinner />
 *
 * - ErrorState: Standardized error display.
 *   Props: { message: string, onRetry?: () => void }
 *   Example: <ErrorState message="Failed to load" onRetry={refetch} />
 *
 * - EmptyState: Display for no data.
 *   Props: { title: string, hint?: string }
 *   Example: <EmptyState title="No runs yet" />
 *
 * - SERIES_COLORS: Object with colors for pg, ts, ts_cagg.
 */

export const SERIES_COLORS = {
  pg: "#60a5fa",
  ts: "#2dd4bf",
  ts_cagg: "#a78bfa",
};

export function AppHeader({
  title,
  right,
}: {
  title: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900 sm:px-6 lg:px-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      {right && <div>{right}</div>}
    </header>
  );
}

export function Card({
  title,
  right,
  className = "",
  children,
}: {
  title?: string;
  right?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={`dashboard-card flex min-h-0 min-w-0 flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 ${className}`}
    >
      {(title || right) && (
        <div className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold">{title}</h2>}
          {right && <div>{right}</div>}
        </div>
      )}
      <div className="flex-1 space-y-3">{children}</div>
    </div>
  );
}

export function StatCard({
  label,
  value,
  unit,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  hint?: string;
}) {
  const target = /PostgreSQL|\bPG\b/i.test(label)
    ? "pg"
    : /Timescale|Hypertable|Compression|Chunks|\bTS\b/i.test(label)
      ? "ts"
      : "neutral";
  return (
    <div
      className={`dashboard-stat ${target} flex flex-col rounded-lg border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900`}
    >
      <div className="stat-label">
        <Icon
          name={
            target === "pg" ? "database" : target === "ts" ? "bolt" : "chart"
          }
        />
        {label}
      </div>
      <div className="mt-1 flex items-baseline gap-1">
        <div className="text-2xl font-semibold tabular-nums">{value}</div>
        {unit && (
          <div className="text-xs text-slate-500 dark:text-slate-400">
            {unit}
          </div>
        )}
      </div>
      {hint && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </div>
      )}
    </div>
  );
}

export function Badge({
  tone,
  children,
}: {
  tone: "neutral" | "warn" | "error" | "ok";
  children: React.ReactNode;
}) {
  const base =
    "inline-flex items-center rounded px-2 py-0.5 text-xs font-medium";
  const colors = {
    neutral:
      "bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300",
    warn: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300",
    error: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300",
    ok: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300",
  };
  return <span className={`${base} ${colors[tone]}`}>{children}</span>;
}

export function Button({
  variant = "secondary",
  className = "",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  const base =
    "inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const variants = {
    primary: "bg-blue-600 text-white hover:bg-blue-700",
    secondary:
      "border border-slate-200 bg-white text-slate-900 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700",
    danger: "bg-red-600 text-white hover:bg-red-700",
  };
  return (
    <button
      className={`${base} ${variants[variant]} ${className}`}
      {...props}
    />
  );
}

const FIELD_HELP: Record<string, string> = {
  Set: "Quick selects B1, B3, B6 and B7. Full selects all benchmark queries. Customize the selection below.",
  Repetitions:
    "Measured runs per selected query, from 1 to 20. The chart uses the median and p95 across these runs.",
  Warmup:
    "Unmeasured runs before collecting results, from 0 to 3. Warmups allow database caches to settle.",
  "Vehicle ID (optional)":
    "Vehicle used for route queries. Leave empty to let the server choose the first active vehicle.",
  Query:
    "Query repeatedly measured by Live Probe. Each sample compares PostgreSQL and TimescaleDB.",
  "Vehicle ID (for B2)":
    "Vehicle to inspect for the B2 route query. It is ignored for fleet-wide queries.",
  "Interval (s)":
    "Seconds between live probe samples. Short intervals increase database load.",
  "Run A": "The saved baseline benchmark run for the comparison table.",
  "Run B":
    "The saved benchmark run compared against Run A. Positive differences mean Run B took longer.",
};
export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  const id = useId();
  const child = React.isValidElement<
    React.InputHTMLAttributes<HTMLInputElement>
  >(children)
    ? React.cloneElement(children, {
        id,
        placeholder:
          children.props.placeholder ||
          (label.includes("optional")
            ? "Auto-select vehicle"
            : `Enter ${label.toLowerCase()}`),
        "aria-invalid": !!error,
      })
    : children;
  return (
    <div className="dashboard-field">
      <div className="floating-field">
        {child}
        <label htmlFor={id}>{label}</label>
        <InfoTip
          label={label}
          text={
            FIELD_HELP[label] ||
            hint ||
            `Select ${label.toLowerCase()} to update the displayed comparison.`
          }
        />
      </div>
      {error && (
        <small className="field-error" role="alert">
          {error}
        </small>
      )}
      {hint && !error && <p className="helper">{hint}</p>}
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="flex space-x-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all ${
            active === t.id
              ? "bg-white text-slate-900 shadow dark:bg-slate-900 dark:text-white"
              : "text-slate-600 hover:bg-slate-200/50 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Spinner() {
  return (
    <div className="flex h-full w-full items-center justify-center p-4">
      <div className="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-blue-600 dark:border-slate-600 dark:border-t-blue-500"></div>
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900/50 dark:bg-red-900/10">
      <div className="text-sm text-red-800 dark:text-red-300">{message}</div>
      {onRetry && (
        <Button variant="secondary" onClick={onRetry} className="mt-4">
          Retry
        </Button>
      )}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-slate-300 p-8 text-center dark:border-slate-700">
      <div className="text-sm font-medium text-slate-900 dark:text-slate-100">
        {title}
      </div>
      {hint && (
        <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">
          {hint}
        </div>
      )}
    </div>
  );
}

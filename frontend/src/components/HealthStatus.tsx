import { useQuery } from "@tanstack/react-query";
import { api, ApiError, API_BASE_URL } from "../api";

type Tone = "ok" | "warn" | "down" | "idle";

const toneStyles: Record<Tone, { dot: string; ring: string; label: string }> = {
  ok: { dot: "bg-emerald-400", ring: "ring-emerald-400/30", label: "text-emerald-600 dark:text-emerald-400" },
  warn: { dot: "bg-amber-400", ring: "ring-amber-400/30", label: "text-amber-600 dark:text-amber-400" },
  down: { dot: "bg-rose-500", ring: "ring-rose-500/30", label: "text-rose-600 dark:text-rose-400" },
  idle: { dot: "bg-slate-400", ring: "ring-slate-400/30", label: "text-slate-500" },
};

function StatusDot({ tone }: { tone: Tone }) {
  const s = toneStyles[tone];
  return (
    <span className={`relative inline-flex size-3 rounded-full ring-4 ${s.ring}`}>
      <span className={`absolute inset-0 rounded-full ${s.dot} ${tone === "ok" ? "animate-pulse-soft" : ""}`} />
    </span>
  );
}

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-xl border border-slate-200/70 bg-white/60 p-4 transition hover:border-brand-500/50 dark:border-slate-800 dark:bg-slate-900/50">
      <dt className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className={`mt-1 truncate text-lg font-semibold ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}

function describeError(err: unknown): { title: string; detail: string; tone: Tone } {
  if (err instanceof ApiError) {
    if (err.status === 0) return { title: "Backend unreachable", detail: err.message, tone: "down" };
    if (err.status === 503) return { title: "Database unavailable", detail: `${err.code}: ${err.message}`, tone: "warn" };
    return { title: `Error ${err.status}`, detail: `${err.code}: ${err.message}`, tone: "down" };
  }
  return { title: "Unexpected error", detail: String(err), tone: "down" };
}

/** Health card: polls GET /api/health and shows loading, ok, and error (with retry) states. */
export default function HealthStatus() {
  const q = useQuery({
    queryKey: ["health"],
    queryFn: api.health,
    refetchInterval: 10_000,
    retry: false,
  });

  const err = q.isError ? describeError(q.error) : null;
  const tone: Tone = q.isPending ? "idle" : err ? err.tone : "ok";
  const title = q.isPending ? "Checking…" : err ? err.title : "Database connected";

  return (
    <section
      id="health-status"
      aria-live="polite"
      className="rounded-2xl border border-slate-200/70 bg-white/70 p-6 shadow-xl shadow-slate-900/5 backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/60 dark:shadow-black/30"
    >
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <StatusDot tone={tone} />
          <div>
            <h2 className="text-sm font-medium text-slate-500">System health</h2>
            <p className={`text-xl font-semibold ${toneStyles[tone].label}`}>{title}</p>
          </div>
        </div>
        <button
          id="health-retry"
          type="button"
          onClick={() => q.refetch()}
          disabled={q.isFetching}
          className="rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-brand-500 active:scale-95 disabled:cursor-wait disabled:opacity-60"
        >
          {q.isFetching ? "Checking…" : err ? "Retry" : "Refresh"}
        </button>
      </header>

      {q.isPending && (
        <div className="mt-6 grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-20 animate-pulse rounded-xl bg-slate-200/70 dark:bg-slate-800/70" />
          ))}
        </div>
      )}

      {err && (
        <div
          id="health-error"
          role="alert"
          className="mt-6 rounded-xl border border-rose-300/60 bg-rose-50/80 p-4 text-sm text-rose-800 dark:border-rose-500/30 dark:bg-rose-950/40 dark:text-rose-200"
        >
          <p className="font-mono">{err.detail}</p>
          <p className="mt-1 text-xs opacity-75">API: {API_BASE_URL} · retrying every 10 s</p>
        </div>
      )}

      {q.isSuccess && (
        <dl className="mt-6 grid gap-3 sm:grid-cols-3">
          <Field label="Database" value={q.data.db.toUpperCase()} />
          <Field label="TimescaleDB" value={q.data.timescaledb_version ?? "not installed"} mono />
          <Field label="Server time (UTC)" value={new Date(q.data.server_time).toISOString().replace("T", " ").slice(0, 19)} mono />
        </dl>
      )}
    </section>
  );
}

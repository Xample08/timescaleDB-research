"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { NumberField } from "@/components/FormControls";
import { Icon } from "@/components/Icon";
import { BulkJob, validateBulkInput } from "@/lib/bulk";
import { BatchTiming, estimateBulkEta, etaDuration } from "@/lib/bulk-eta";
const storageKey = "telemetry-bulk-job:v1";
type Saved = { id: string; total: number; vehicles: number; days: number };
type Phase =
  | "idle"
  | "creating"
  | "running"
  | "pausing"
  | "paused"
  | "recovering"
  | "error"
  | "completed";
export default function BulkPage() {
  const [total, setTotal] = useState(100000),
    [vehicles, setVehicles] = useState(20),
    [days, setDays] = useState(14),
    [password, setPassword] = useState("");
  const [saved, setSaved] = useState<Saved | null>(null),
    [job, setJob] = useState<BulkJob | null>(null),
    [phase, setPhase] = useState<Phase>("idle"),
    [error, setError] = useState("");
  const [logs, setLogs] = useState<
    { time: string; text: string; tone: string }[]
  >([]);
  const control = useRef({ pause: false, active: false, alive: true });
  const [timings, setTimings] = useState<BatchTiming[]>([]);
  const [lastCommitAt, setLastCommitAt] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (phase !== "running" && phase !== "pausing") return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [phase]);
  const terminal = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const log = (text: string, tone = "info") =>
    setLogs((previous) =>
      [
        ...previous,
        {
          time: new Date().toLocaleTimeString("en-GB", {
            timeZone: "Asia/Jakarta",
            hour12: false,
          }),
          text,
          tone,
        },
      ].slice(-150),
    );
  useEffect(() => {
    const lifecycle = control.current;
    lifecycle.alive = true;
    const load = setTimeout(() => {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const value = JSON.parse(raw);
          if (
            value?.id &&
            validateBulkInput(value.total, value.vehicles, value.days)
          ) {
            setSaved(value);
            setTotal(value.total);
            setVehicles(value.vehicles);
            setDays(value.days);
            setPhase("paused");
            setLogs([
              {
                time: "RECOVERY",
                text: "Saved job found. Enter your password, then load its checkpoint or Continue. Nothing restarts automatically.",
                tone: "info",
              },
            ]);
          }
        }
      } catch {
        setError(
          "Unable to read the local checkpoint. Browser storage may be unavailable.",
        );
      }
    }, 0);
    return () => {
      clearTimeout(load);
      lifecycle.alive = false;
      lifecycle.pause = true;
    };
  }, []);
  useEffect(() => {
    if (follow.current && terminal.current)
      terminal.current.scrollTop = terminal.current.scrollHeight;
  }, [logs]);
  const api = async (action: string, record: Saved) => {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 60000);
    try {
      const response = await fetch(
        action === "load" ? `/api/bulk?id=${record.id}` : "/api/bulk",
        {
          method: action === "load" ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            "x-sim-password": password,
          },
          body:
            action === "load"
              ? undefined
              : JSON.stringify({ ...record, action }),
          signal: abort.signal,
        },
      );
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Request failed");
      return body.job as BulkJob;
    } finally {
      clearTimeout(timeout);
    }
  };
  const fail = (cause: unknown) => {
    if (!control.current.alive) return;
    const message =
      cause instanceof Error ? cause.message : "Request interrupted";
    setError(message);
    setPhase("error");
    log(
      `${message}. Processing stopped. Continue reloads the database checkpoint before writing more rows.`,
      "error",
    );
  };
  const process = async (record: Saved, initial: BulkJob) => {
    let current = initial;
    setTimings([]);
    setLastCommitAt(0);
    setJob(current);
    while (
      current.status === "running" &&
      control.current.alive &&
      !control.current.pause
    ) {
      setPhase("running");
      log(
        `Generating the next batch after row ${current.processed.toLocaleString("en-US")}; inserting identical data into PostgreSQL and TimescaleDB...`,
      );
      const before = current.processed;
      const started = performance.now();
      current = await api("step", record);
      if (!control.current.alive) return;
      if (current.processed > before) {
        const timing = {
          rows: current.processed - before,
          milliseconds: performance.now() - started,
        };
        setTimings((previous) => [...previous, timing].slice(-10));
        const committed = Date.now();
        setLastCommitAt(committed);
        setNow(committed);
      }
      setJob(current);
      log(
        `COMMIT confirmed / ${current.processed.toLocaleString("en-US")} of ${current.total.toLocaleString("en-US")} rows saved in EACH table. Checkpoint persisted.`,
        "success",
      );
    }
    if (!control.current.alive) return;
    if (current.status === "completed") {
      setPhase("completed");
      log(
        `DONE / ${current.total.toLocaleString("en-US")} rows in PostgreSQL + ${current.total.toLocaleString("en-US")} rows in TimescaleDB.`,
        "success",
      );
    } else {
      if (current.status !== "paused") current = await api("pause", record);
      setJob(current);
      setPhase("paused");
      log(
        "PAUSED / Current batch finished. Both tables and the checkpoint are consistent. Continue when ready.",
        "info",
      );
    }
  };
  const start = async (resume = false) => {
    if (control.current.active) return;
    if (!password || !validateBulkInput(total, vehicles, days)) {
      setError("Enter your password and valid whole-number settings.");
      return;
    }
    control.current.active = true;
    control.current.pause = false;
    setError("");
    setTimings([]);
    setLastCommitAt(0);
    let record = saved;
    try {
      if (!resume || !record) {
        record = { id: crypto.randomUUID(), total, vehicles, days };
        localStorage.setItem(storageKey, JSON.stringify(record));
        setSaved(record);
        setJob(null);
        setLogs([]);
      }
      setPhase(resume ? "recovering" : "creating");
      log(
        resume
          ? "Recovering the saved job and its last committed checkpoint..."
          : "Creating a durable job and a dedicated vehicle fleet...",
      );
      // Creation is idempotent: the same ID returns the existing job after a lost response.
      let current = await api("create", record);
      if (current.status !== "completed") current = await api("resume", record);
      if (!control.current.alive) return;
      log(
        `Job ${current.id} / ${current.vehicleIds.length} vehicles / historical data over ${current.days} days.`,
      );
      await process(record, current);
    } catch (cause) {
      fail(cause);
    } finally {
      control.current.active = false;
    }
  };
  const recover = async () => {
    if (!saved || !password || control.current.active) {
      if (!password) setError("Enter your password to load the saved job.");
      return;
    }
    control.current.active = true;
    setPhase("recovering");
    setError("");
    setTimings([]);
    setLastCommitAt(0);
    try {
      let current = await api("load", saved);
      if (current.status === "running") current = await api("pause", saved);
      setJob(current);
      setPhase(current.status === "completed" ? "completed" : "paused");
      log(
        `Checkpoint loaded / ${current.processed.toLocaleString("en-US")} rows per table. No new telemetry was inserted.`,
        "success",
      );
    } catch (cause) {
      fail(cause);
    } finally {
      control.current.active = false;
    }
  };
  const busy = ["creating", "running", "pausing", "recovering"].includes(phase);
  const processed = job?.processed || 0,
    target = job?.total || saved?.total || total;
  const percentage =
    Number.isFinite(target) && target > 0
      ? Math.min(100, (processed / target) * 100)
      : 0;
  const eta = estimateBulkEta(timings, Math.max(0, target - processed));
  const measuring = phase === "running" || phase === "pausing";
  const stalled =
    measuring &&
    eta &&
    now - lastCommitAt > Math.max(5000, eta.averageBatchMs * 3);
  const finishAt = eta && lastCommitAt ? lastCommitAt + eta.remainingMs : null;
  const timeLeft = eta
    ? Math.max(eta.averageBatchMs, (finishAt || now) - now)
    : 0;
  const etaText =
    phase === "completed"
      ? "Complete"
      : phase === "paused"
        ? "Paused"
        : phase === "error"
          ? "Resume to estimate"
          : phase === "pausing"
            ? "Pausing safely..."
            : stalled
              ? "Waiting for batch..."
              : measuring && eta
                ? `About ${etaDuration(timeLeft)}`
                : measuring || phase === "creating" || phase === "recovering"
                  ? "Calculating..."
                  : "Starts after first batch";
  const stage =
    phase === "running"
      ? "Generating and writing the next atomic batch"
      : phase === "pausing"
        ? "Finishing the current batch before pausing"
        : phase === "creating"
          ? "Preparing job and vehicles"
          : phase === "recovering"
            ? "Reading durable checkpoint"
            : phase === "completed"
              ? "All requested rows committed to both tables"
              : phase === "error"
                ? "Interrupted / Ready to recover"
                : phase === "paused"
                  ? "Paused / Checkpoint can be continued"
                  : "Configure your dataset and start";
  return (
    <main className="simulator-shell bulk-shell">
      <header className="topbar">
        <Link href="/" className="brand">
          <span className="brand-mark">
            <Icon name="bolt" />
          </span>
          <span>
            Telemetry Lab<small>DATA GENERATOR</small>
          </span>
        </Link>
        <nav aria-label="Main navigation">
          <Link href="/">Simulator</Link>
          <Link href="/bulk" aria-current="page">
            Bulk data
          </Link>
        </nav>
      </header>
      <div className="page-heading">
        <div>
          <p className="eyebrow">DURABLE DATA LOADER</p>
          <h1>
            Bulk data <small>Same data. Both tables.</small>
          </h1>
        </div>
        <span className={`bulk-status ${phase}`}>{phase.toUpperCase()}</span>
      </div>
      <div className="bulk-grid">
        <section className="bulk-card bulk-settings">
          <h2>Dataset settings</h2>
          <p className="helper">
            N means rows added to <b>each</b> table. This creates a dedicated
            fleet and historical telemetry, including speeding, stops, altitude
            and poor-GPS scenarios.
          </p>
          <NumberField
            id="bulk-total"
            label="Rows per table"
            placeholder="e.g. 100000"
            min={1}
            value={total}
            onChange={setTotal}
            disabled={busy || !!saved}
            help="Adds exactly this many new rows to each table, for twice as many records overall. Existing telemetry is preserved. There is no configured row limit."
          />
          <NumberField
            id="bulk-vehicles"
            label="Dedicated vehicles"
            placeholder="e.g. 20"
            min={1}
            max={1000}
            value={vehicles}
            onChange={setVehicles}
            disabled={busy || !!saved}
            help="Creates a new fleet for this job, up to the requested number or total rows, whichever is smaller. Dedicated IDs avoid timestamp collisions with other jobs and live simulation."
          />
          <NumberField
            id="bulk-days"
            label="History span (days)"
            placeholder="e.g. 14"
            min={1}
            max={365}
            value={days}
            onChange={setDays}
            disabled={busy || !!saved}
            help="Spreads timestamps across this many days, ending just before job creation. Pausing and resuming preserve this original window."
          />
          <div className="floating-field">
            <input
              id="bulk-password"
              type="password"
              placeholder="Enter simulator password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              autoComplete="current-password"
            />
            <label htmlFor="bulk-password">Access password</label>
          </div>
          <div className="bulk-estimate">
            <b>
              {Number.isFinite(target)
                ? (target * 2).toLocaleString("en-US")
                : "—"}
            </b>
            <span>total records across both tables</span>
          </div>
          {!saved ? (
            <button
              className="bulk-primary"
              onClick={() => start()}
              disabled={busy}
            >
              Create dataset
            </button>
          ) : (
            <>
              <button
                className="bulk-primary"
                onClick={() => start(true)}
                disabled={busy || phase === "completed"}
              >
                {phase === "error" ? "Retry / Continue" : "Continue"}
              </button>
              <button onClick={recover} disabled={busy}>
                Load saved checkpoint
              </button>
            </>
          )}
          {saved && !busy && (
            <button
              onClick={() => {
                localStorage.removeItem(storageKey);
                setSaved(null);
                setJob(null);
                setTimings([]);
                setLastCommitAt(0);
                setPhase("idle");
                setError("");
                setLogs([]);
              }}
            >
              Set up a new job
            </button>
          )}
          <p className="helper">
            Keep this page open while loading. After a refresh, browser crash or
            network failure, enter your password and Continue. Your password is
            never saved.
          </p>
        </section>
        <div className="bulk-main">
          <section className="bulk-card bulk-progress">
            <div className="bulk-progress-heading">
              <div>
                <h2>{stage}</h2>
                <p>
                  {processed.toLocaleString("en-US")} /{" "}
                  {Number.isFinite(target)
                    ? target.toLocaleString("en-US")
                    : "—"}{" "}
                  rows committed per table
                </p>
              </div>
              <strong>
                {percentage.toFixed(percentage > 0 && percentage < 1 ? 2 : 1)}%
              </strong>
            </div>
            <div
              className={`bulk-progress-track ${busy ? "working" : ""}`}
              role="progressbar"
              aria-label="Rows committed to both tables"
              aria-valuemin={0}
              aria-valuemax={Number.isFinite(target) ? target : 0}
              aria-valuenow={processed}
              aria-valuetext={`${processed} of ${target} rows committed in each table`}
            >
              <div style={{ width: `${percentage}%` }} />
            </div>
            <div className="bulk-db-counts">
              <span className="pg">
                <Icon name="database" />
                PostgreSQL <b>{processed.toLocaleString("en-US")}</b>
              </span>
              <span className="ts">
                <Icon name="bolt" />
                TimescaleDB <b>{processed.toLocaleString("en-US")}</b>
              </span>
            </div>
            <div className="bulk-eta" aria-label="Estimated completion">
              <div>
                <span>
                  <Icon name="clock" />
                  Time remaining
                </span>
                <strong>{etaText}</strong>
                <small>
                  {eta?.early && measuring
                    ? "Early estimate / improves after a few batches"
                    : "Based on the latest 10 committed batches"}
                </small>
              </div>
              <div>
                <span>Loading rate / per table</span>
                <strong>
                  {eta
                    ? `${Math.round(eta.rowsPerSecond).toLocaleString("en-US")} rows/s`
                    : "Measuring..."}
                </strong>
                <small>Includes writing both tables and network time</small>
              </div>
              <div>
                <span>Estimated finish</span>
                <strong>
                  {phase === "running" &&
                  !stalled &&
                  finishAt &&
                  Number.isFinite(finishAt) &&
                  Math.abs(finishAt) < 8640000000000000
                    ? `${new Date(finishAt).toLocaleString("en-GB", { timeZone: "Asia/Jakarta", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} WIB`
                    : phase === "completed"
                      ? "Finished"
                      : phase === "paused" || phase === "pausing"
                        ? "Updates on Continue"
                        : "Awaiting estimate"}
                </strong>
                <small>May change with database load</small>
              </div>
            </div>
            {busy && (
              <button
                className="bulk-pause"
                disabled={phase === "pausing"}
                onClick={() => {
                  control.current.pause = true;
                  setPhase("pausing");
                  log(
                    "Pause requested / Waiting for the current batch to commit or roll back.",
                  );
                }}
              >
                <Icon name="stop" />
                {phase === "pausing" ? "Pausing safely..." : "Pause loading"}
              </button>
            )}
            {error && (
              <p className="bulk-error" role="alert">
                {error} The database checkpoint is authoritative; the displayed
                count may lag after a lost response.
              </p>
            )}
            {job && (
              <p className="bulk-job-id">
                Job {job.id} / Updated{" "}
                {new Date(job.updatedAt).toLocaleString("en-GB", {
                  timeZone: "Asia/Jakarta",
                })}{" "}
                WIB
              </p>
            )}
          </section>
          <section className="bulk-card bulk-terminal">
            <div className="bulk-terminal-heading">
              <span>
                <Icon name="sql" />
                Execution log
              </span>
              <small>WIB / latest 150 messages</small>
            </div>
            <div
              ref={terminal}
              className="bulk-log"
              role="log"
              aria-label="Data loading activity"
              aria-live="polite"
              onScroll={(e) => {
                const el = e.currentTarget;
                follow.current =
                  el.scrollHeight - el.scrollTop - el.clientHeight < 40;
              }}
            >
              {logs.length ? (
                logs.map((entry, index) => (
                  <div className={entry.tone} key={index}>
                    <time>{entry.time}</time>
                    <span>{entry.text}</span>
                  </div>
                ))
              ) : (
                <p>Ready. Configure the dataset and click Create dataset.</p>
              )}
            </div>
            <p className="bulk-log-footer">
              Progress advances only after both inserts and the checkpoint
              commit. Pauses take effect between batches.
            </p>
          </section>
        </div>
      </div>
    </main>
  );
}

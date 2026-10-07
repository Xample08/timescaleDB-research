import React from "react";
import { Icon } from "./Icon";
export interface QueryEvent {
  target: string;
  sql: string;
  rows: number;
  phase: "executing" | "complete" | "failed";
  error?: string;
}
export function SqlWindow({
  queries,
  targets,
}: {
  queries: Record<string, QueryEvent>;
  targets: string[];
}) {
  return (
    <section
      id="sql-activity"
      tabIndex={-1}
      className="sql-window"
      aria-label="Live SQL execution"
    >
      <div className="sql-heading">
        <span>
          <Icon name="sql" /> Live SQL{" "}
          <small>Actual parameterized INSERT statements</small>
        </span>
      </div>
      <div className="sql-targets">
        {(["pg", "ts"] as const).map((t) => {
          const enabled = targets.includes(t);
          const q = enabled ? queries[t] : undefined;
          return (
            <div
              key={t}
              className={`sql-query ${t} ${enabled ? q?.phase || "waiting" : "disabled"}`}
            >
              <div className="sql-query-title">
                <b>{t === "pg" ? "PostgreSQL" : "TimescaleDB"}</b>
                <span role="status">
                  {!enabled
                    ? "Disabled"
                    : q
                      ? `${q.phase === "executing" ? "Executing" : q.phase === "failed" ? "! Failed" : "Complete"} / ${q.rows} rows`
                      : "Waiting for next INSERT"}
                </span>
              </div>
              {q ? (
                <pre tabIndex={0}>
                  <code>
                    {q.sql
                      .replace(" (time", "\n(time")
                      .replace(" VALUES ", "\nVALUES\n")
                      .replace(" ON CONFLICT", "\nON CONFLICT")}
                  </code>
                </pre>
              ) : (
                <p>
                  {enabled
                    ? "Queries appear here when the server starts writing."
                    : "Destination disabled. Enable it in simulation controls."}
                </p>
              )}
              {q?.error && <p role="alert">{q.error}</p>}
            </div>
          );
        })}
      </div>
    </section>
  );
}

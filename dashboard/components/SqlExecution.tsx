"use client";
import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { SqlRecord, updateSqlHistory, displaySql } from "../lib/sql-history";
import { Icon } from "./Icon";
const SqlContext = createContext<{
  history: SqlRecord[];
  record: (event: Partial<SqlRecord> & { id: string }, source: string) => void;
}>({ history: [], record: () => {} });
export function SqlExecutionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [history, setHistory] = useState<SqlRecord[]>([]);
  const record = useCallback(
    (event: Partial<SqlRecord> & { id: string }, source: string) =>
      setHistory((h) => updateSqlHistory(h, event, source)),
    [],
  );
  const value = useMemo(() => ({ history, record }), [history, record]);
  return <SqlContext.Provider value={value}>{children}</SqlContext.Provider>;
}
export function useSqlFetch(source: string) {
  const { record } = useContext(SqlContext);
  return useCallback(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const headers = new Headers(init?.headers);
      headers.set("Accept", "application/x-ndjson");
      const response = await fetch(input, { ...init, headers });
      if (
        !response.headers
          .get("content-type")
          ?.includes("application/x-ndjson") ||
        !response.body
      )
        return response;
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = "";
      let result: { status: number; data: unknown } | undefined;
      const active = new Set<string>();
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          const lines = pending.split("\n");
          pending = lines.pop() || "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const event = JSON.parse(line);
            if (event.type === "sql") {
              if (event.phase === "executing") active.add(event.id);
              else active.delete(event.id);
              record(event, source);
            }
            if (event.type === "result") result = event;
          }
          if (done) break;
        }
        if (!result) throw new Error("SQL stream ended without a result");
        return new Response(JSON.stringify(result.data), {
          status: result.status,
          headers: { "Content-Type": "application/json" },
        });
      } catch (error) {
        for (const id of active)
          record(
            {
              id,
              phase: "failed",
              error: "Execution status unavailable: connection interrupted",
            },
            source,
          );
        throw error;
      } finally {
        reader.releaseLock();
      }
    },
    [record, source],
  );
}
function HistoryGroup({
  target,
  records,
  latest,
}: {
  target: SqlRecord["target"];
  records: SqlRecord[];
  latest?: string;
}) {
  const [page, setPage] = useState(0);
  const entries = records.slice(page * 10, page * 10 + 10);
  return (
    <section className={`sql-history-group ${target}`}>
      <div className="sql-query-title">
        <b>
          <Icon
            name={
              target === "pg"
                ? "database"
                : target === "ts"
                  ? "bolt"
                  : "settings"
            }
          />
          {target === "pg"
            ? "PostgreSQL"
            : target === "ts"
              ? "TimescaleDB"
              : "Shared / session SQL"}
        </b>
        <span>{records.length} queries</span>
      </div>
      <div className="history-pagination">
        <button onClick={() => setPage(0)} disabled={!page}>
          Latest
        </button>
        <button onClick={() => setPage(Math.max(0, page - 1))} disabled={!page}>
          Newer
        </button>
        <button
          onClick={() => setPage(page + 1)}
          disabled={(page + 1) * 10 >= records.length}
        >
          Older
        </button>
      </div>
      <div className="sql-history-list">
        {entries.map((q) => (
          <article
            key={q.id}
            className={`sql-query ${target} ${q.phase} ${q.id === latest ? "highlighted" : ""}`}
          >
            <div className="query-meta">
              <b>
                {q.id === latest
                  ? q.phase === "executing"
                    ? "Executing now"
                    : "Latest query"
                  : q.source}
              </b>
              <time>
                {new Date(q.timestamp).toLocaleTimeString("en-GB", {
                  timeZone: "Asia/Jakarta",
                  hour12: false,
                })}{" "}
                WIB
              </time>
            </div>
            <div className="query-result">
              {q.source} / {q.phase}
              {q.durationMs !== undefined
                ? ` / ${q.durationMs.toFixed(2)} ms`
                : ""}
              {q.rowCount !== undefined && q.rowCount !== null
                ? ` / ${q.rowCount} returned`
                : ""}
            </div>
            <pre tabIndex={0}>
              <code>{displaySql(q.sql, q.values)}</code>
            </pre>
            {q.error && <p role="alert">{q.error}</p>}
          </article>
        ))}
        {!records.length && (
          <p className="sql-empty">
            Queries appear here when an operation runs.
          </p>
        )}
      </div>
    </section>
  );
}
export function SqlExecutionView({ source }: { source: string }) {
  const { history } = useContext(SqlContext);
  const [includeBackground, setIncludeBackground] = useState(false);
  const filtered = history.filter(
    (q) => includeBackground || q.source === source,
  );
  const databaseQueries = filtered.filter((q) => q.target !== "system");
  const latest =
    databaseQueries.findLast((q) => q.phase === "executing") ||
    databaseQueries.at(-1) ||
    filtered.at(-1);
  return (
    <aside
      className="sql-window dashboard-sql"
      aria-label="SQL execution history"
    >
      <div className="sql-heading">
        <span>
          <Icon name="sql" />
          SQL execution
        </span>
        <span className="query-total">{filtered.length} queries</span>
      </div>
      <p className="sql-description">
        Actual queries with bound values. Current or latest execution is
        highlighted.
      </p>
      <label className="background-toggle">
        <input
          type="checkbox"
          checked={includeBackground}
          onChange={(e) => setIncludeBackground(e.target.checked)}
        />
        Include other tabs and background status
      </label>
      <div className="dashboard-sql-groups">
        {(["pg", "ts"] as const).map((target) => (
          <HistoryGroup
            key={target + source + includeBackground}
            target={target}
            records={filtered.filter((q) => q.target === target).reverse()}
            latest={latest?.id}
          />
        ))}
        <details className="shared-sql">
          <summary>
            Shared / session SQL (
            {filtered.filter((q) => q.target === "system").length})
          </summary>
          <HistoryGroup
            target="system"
            records={filtered.filter((q) => q.target === "system").reverse()}
            latest={latest?.id}
          />
        </details>
      </div>
    </aside>
  );
}

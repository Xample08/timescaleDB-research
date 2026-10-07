import React, { useState } from "react";
import { ResizablePanels } from "./ResizablePanels";
import { Icon } from "./Icon";
import { QueryRecord, renderSql } from "../lib/query-history";
const PAGE_SIZE = 20;
function DatabaseHistory({
  target,
  enabled,
  queries,
  highlighted,
}: {
  target: string;
  enabled: boolean;
  queries: QueryRecord[];
  highlighted?: string;
}) {
  const [offset, setOffset] = useState(0);
  const page = queries.slice(
    Math.min(offset, Math.max(0, queries.length - 1)),
    offset + PAGE_SIZE,
  );
  return (
    <div className={`sql-history-column ${target}`}>
      <div className="sql-query-title">
        <b>
          <Icon name={target === "pg" ? "database" : "bolt"} />
          {target === "pg" ? "PostgreSQL" : "TimescaleDB"}
        </b>
        <span>{enabled ? `${queries.length} queries` : "Disabled"}</span>
      </div>
      <div className="history-pagination">
        <button disabled={!offset} onClick={() => setOffset(0)}>
          Latest
        </button>
        <button
          disabled={!offset}
          onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
        >
          Newer
        </button>
        <button
          disabled={offset + PAGE_SIZE >= queries.length}
          onClick={() => setOffset(offset + PAGE_SIZE)}
        >
          Older
        </button>
      </div>
      <div className="sql-history-list">
        {page.map((q) => (
          <article
            key={q.id}
            className={`sql-query ${target} ${q.phase} ${q.id === highlighted ? "highlighted" : ""}`}
          >
            <div className="query-meta">
              <b>
                {q.id === highlighted
                  ? q.phase === "executing"
                    ? "Executing now"
                    : "Latest query"
                  : `Tick ${q.tickNo + 1}`}
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
              {q.phase === "failed"
                ? "Failed"
                : q.phase === "executing"
                  ? `Inserting ${q.rows} rows`
                  : `${q.inserted ?? 0} inserted / ${q.rows} submitted`}
            </div>
            <pre tabIndex={0}>
              <code>{renderSql(q.sql, q.params)}</code>
            </pre>
            {q.error && <p role="alert">{q.error}</p>}
          </article>
        ))}
        {!queries.length && (
          <div
            className={`sql-query ${target} ${enabled ? "waiting" : "disabled"}`}
          >
            <p>
              {enabled
                ? "Executed INSERT queries and their actual values will appear here."
                : "Enable this destination in simulation controls."}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
export function SqlWindow({
  queries,
  targets,
}: {
  queries: QueryRecord[];
  targets: string[];
}) {
  const latest =
    queries.findLast((q) => q.phase === "executing") || queries.at(-1);
  return (
    <section
      id="sql-activity"
      tabIndex={-1}
      className="sql-window"
      aria-label="Live SQL execution"
    >
      <div className="sql-heading">
        <span>
          <Icon name="sql" /> SQL activity
          <small>All INSERT queries this session</small>
        </span>
        <span className="query-total">{queries.length} queries</span>
      </div>
      <p className="sql-description">
        Actual submitted values. The highlighted query is executing or was the
        latest to run.
      </p>
      <ResizablePanels
        className="sql-targets"
        direction="vertical"
        label="SQL history"
        initialSizes={[50, 50]}
      >
        {(["pg", "ts"] as const).map((t) => (
          <DatabaseHistory
            key={t}
            target={t}
            enabled={targets.includes(t)}
            queries={queries.filter((q) => q.target === t).reverse()}
            highlighted={latest?.id}
          />
        ))}
      </ResizablePanels>
    </section>
  );
}

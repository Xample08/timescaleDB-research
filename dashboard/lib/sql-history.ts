export interface SqlRecord {
  id: string;
  sql: string;
  values: unknown[];
  target: "pg" | "ts" | "system";
  timestamp: string;
  phase: "executing" | "complete" | "failed";
  source: string;
  durationMs?: number;
  rowCount?: number | null;
  error?: string;
}
export function updateSqlHistory(
  history: SqlRecord[],
  event: Partial<SqlRecord> & { id: string },
  source: string,
) {
  const index = history.findIndex((q) => q.id === event.id);
  if (index < 0)
    return event.phase === "executing"
      ? [...history, { ...event, source } as SqlRecord]
      : history;
  const next = history.slice();
  next[index] = { ...next[index], ...event };
  return next;
}
export function displaySql(sql: string, values: unknown[]) {
  return sql.replace(/\$(\d+)/g, (placeholder, index) => {
    const value = values[Number(index) - 1];
    if (value === undefined) return placeholder;
    if (value === null) return "NULL";
    if (typeof value === "number") return String(value);
    if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
    return (
      "'" +
      (typeof value === "string" ? value : JSON.stringify(value)).replace(
        /'/g,
        "''",
      ) +
      "'"
    );
  });
}

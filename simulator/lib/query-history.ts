export interface QueryRecord {
  id: string;
  target: string;
  sql: string;
  params: (string | number)[];
  rows: number;
  tickNo: number;
  timestamp: string;
  phase: "executing" | "complete" | "failed";
  inserted?: number;
  error?: string;
}
export type QueryUpdate = Partial<QueryRecord> & {
  id: string;
  type: "query" | "query-error";
};
export function updateQueryHistory(
  history: QueryRecord[],
  event: QueryUpdate,
): QueryRecord[] {
  const index = history.findIndex((q) => q.id === event.id);
  if (index < 0)
    return event.phase === "executing"
      ? [...history, event as QueryRecord]
      : history;
  const next = history.slice();
  next[index] = {
    ...next[index],
    ...event,
    phase:
      event.type === "query-error"
        ? "failed"
        : event.phase || next[index].phase,
  };
  return next;
}
export function renderSql(sql: string, params: (string | number)[]) {
  return (
    sql
      .replace(/\$(\d+)/g, (placeholder, n) => {
        const value = params[Number(n) - 1];
        return value === undefined
          ? placeholder
          : typeof value === "number"
            ? String(value)
            : "'" + value.replace(/'/g, "''") + "'";
      })
      .replace(" (time", "\n(time")
      .replace(" VALUES ", "\nVALUES\n")
      .replace(/\), \(/g, "),\n(")
      .replace(" ON CONFLICT", "\nON CONFLICT") + ";"
  );
}

import { expect, test } from "vitest";
import { QueryRecord, updateQueryHistory, renderSql } from "./query-history";
const q: QueryRecord = {
  id: "one",
  target: "pg",
  sql: "INSERT VALUES ($1, $2)",
  params: ["2026-10-07T00:00:00Z", 42],
  rows: 1,
  tickNo: 0,
  timestamp: "2026-10-07T00:00:00Z",
  phase: "executing",
};
test("completion updates one entry without losing its values", () => {
  const history = updateQueryHistory([], { ...q, type: "query" });
  const completed = updateQueryHistory(history, {
    id: q.id,
    type: "query",
    phase: "complete",
    inserted: 1,
  });
  expect(completed).toHaveLength(1);
  expect(completed[0]).toMatchObject({ ...q, phase: "complete", inserted: 1 });
  expect(history[0].phase).toBe("executing");
});
test("history retains queries beyond a display page", () => {
  let history: QueryRecord[] = [];
  for (let i = 0; i < 55; i++)
    history = updateQueryHistory(history, {
      ...q,
      id: String(i),
      type: "query",
    });
  expect(history).toHaveLength(55);
});
test("query errors retain the attempted SQL and values", () => {
  expect(
    updateQueryHistory([q], {
      id: q.id,
      type: "query-error",
      error: "Failed",
    })[0],
  ).toMatchObject({ params: q.params, phase: "failed", error: "Failed" });
});
test("renders actual values with SQL quoting and correct parameter indexes", () => {
  expect(
    renderSql("INSERT VALUES ($1, $2, $10)", [
      "O'Neil",
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
      99,
    ]),
  ).toBe("INSERT\nVALUES\n('O''Neil', 1, 99);");
});

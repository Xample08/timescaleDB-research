import { expect, test } from "vitest";
import { updateSqlHistory, displaySql, SqlRecord } from "./sql-history";
const record: SqlRecord = {
  id: "one",
  sql: "SELECT $1",
  values: [42],
  target: "pg",
  timestamp: "2026-10-08T00:00:00Z",
  phase: "executing",
  source: "Benchmark",
};
test("completion updates the existing record and retains values", () => {
  const history = updateSqlHistory([], record, "Benchmark");
  expect(
    updateSqlHistory(
      history,
      { id: "one", phase: "complete", durationMs: 1 },
      "Benchmark",
    ),
  ).toEqual([{ ...record, phase: "complete", durationMs: 1 }]);
});
test("full session history is retained", () => {
  let history: SqlRecord[] = [];
  for (let i = 0; i < 55; i++)
    history = updateSqlHistory(
      history,
      { ...record, id: String(i) },
      "Benchmark",
    );
  expect(history).toHaveLength(55);
});
test("display substitutes parameter indexes and quotes actual values", () => {
  expect(
    displaySql("SELECT $1, $2, $3, $10", [
      "O'Neil",
      null,
      true,
      0,
      0,
      0,
      0,
      0,
      0,
      99,
    ]),
  ).toBe("SELECT 'O''Neil', NULL, TRUE, 99");
});

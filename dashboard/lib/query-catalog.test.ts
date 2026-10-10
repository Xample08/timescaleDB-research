import { expect, test } from "vitest";
import { CATALOG, QUERY_GUIDES, getQueryDef, Variant } from "./bench";
test("each selectable query has explanatory content and a unique identifier", () => {
  expect(new Set(CATALOG.map((q) => q.id)).size).toBe(CATALOG.length);
  for (const query of CATALOG) {
    expect(QUERY_GUIDES[query.id]).toMatchObject({
      category: expect.any(String),
      description: expect.any(String),
      tests: expect.any(String),
      output: expect.any(String),
      window: expect.any(String),
    });
  }
});
test.each(["B10", "B11", "B12", "B13", "B14"])(
  "%s builds equivalent bounded queries for both databases and EXPLAIN mode",
  (id) => {
    const query = getQueryDef(id);
    const now = new Date("2026-10-10T12:00:00Z");
    for (const variant of ["pg", "ts"] as const) {
      const parameterized = query.buildSql(variant, null, now, false);
      expect(parameterized.values).toEqual([
        new Date("2026-10-09T12:00:00Z"),
        now,
      ]);
      expect(parameterized.sql).toContain(`telemetry_${variant}`);
      const inline = query.buildSql(variant, null, now, true);
      expect(inline.values).toEqual([]);
      const expanded = parameterized.sql
        .replace("$1", "CAST('2026-10-09T12:00:00.000Z' AS timestamptz)")
        .replace("$2", "CAST('2026-10-10T12:00:00.000Z' AS timestamptz)");
      expect(inline.sql).toBe(expanded);
      expect(inline.sql).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER)\b/);
    }
    expect(() =>
      query.buildSql("unsafe_table" as Variant, null, now, false),
    ).toThrow("Invalid variant");
  },
);

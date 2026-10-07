import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { ControlPanel } from "./ControlPanel";
import { SqlWindow } from "./SqlWindow";
import { SimConfig } from "../lib/config";
const config: SimConfig = {
  vehicles: 20,
  interval: 5,
  mode: "batch",
  targets: ["pg", "ts"],
  maxRows: 500000,
  maxMinutes: 30,
  dirty: false,
};
const noop = () => {};
function renderControls(mode: SimConfig["mode"]) {
  return renderToStaticMarkup(
    <ControlPanel
      config={{ ...config, mode }}
      onChange={noop}
      password=""
      onPasswordChange={noop}
      isRunning={false}
      onStart={noop}
      onStop={noop}
    />,
  );
}
test("burst disables only the interval while editing", () => {
  const html = renderControls("burst");
  expect(html.match(/<input[^>]*id="sim-interval"[^>]*>/)?.[0]).toContain(
    'disabled=""',
  );
  expect(html.match(/<input[^>]*id="sim-maxMinutes"[^>]*>/)?.[0]).not.toContain(
    'disabled=""',
  );
  expect(
    renderControls("batch").match(/<input[^>]*id="sim-interval"[^>]*>/)?.[0],
  ).not.toContain('disabled=""');
});
test.each([["ts"], ["pg"], ["ts", "pg"], []])(
  "keeps database slots fixed for selected targets %j",
  (...targets: string[]) => {
    const html = renderToStaticMarkup(
      <SqlWindow targets={targets} queries={{}} />,
    );
    expect(html.indexOf("PostgreSQL")).toBeLessThan(
      html.indexOf("TimescaleDB"),
    );
    expect(html).toContain("sql-query pg");
    expect(html).toContain("sql-query ts");
  },
);
test("disabled databases do not show old executing queries", () => {
  const html = renderToStaticMarkup(
    <SqlWindow
      targets={["ts"]}
      queries={{
        pg: { target: "pg", sql: "OLD INSERT", rows: 1, phase: "executing" },
      }}
    />,
  );
  expect(html).toContain("Disabled");
  expect(html).not.toContain("OLD INSERT");
  expect(html).not.toContain("Executing");
});
test("form inputs have placeholders and associated internal labels", () => {
  const html = renderControls("batch");
  for (const key of [
    "vehicles",
    "interval",
    "maxRows",
    "maxMinutes",
    "password",
  ]) {
    expect(html).toContain(`for="sim-${key}"`);
    expect(
      html.match(new RegExp(`<input[^>]*id="sim-${key}"[^>]*>`))?.[0],
    ).toContain("placeholder=");
  }
});

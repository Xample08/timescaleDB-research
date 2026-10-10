import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { getHeapStatistics } from "node:v8";
import { freemem } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { bulkColumns, bulkInsertSql } from "../lib/bulk.ts";

// Probe real tables one transaction at a time. All test telemetry and vehicles roll back.
for (const file of [".env.local", ".env"]) {
  try { process.loadEnvFile(file); } catch (error) { if (error.code !== "ENOENT") throw error; }
}
const client = new Client({
  connectionString: (process.env.DATABASE_URL || "")
    .replace(/[?&]sslmode=[^&]*/, "").replace(/\?$/, ""),
  ssl: process.env.DB_SSL_VERIFY === "true" ? true : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000,
});
const budgetMs = 30000; // Both inserts + generation; leaves room in the 60s HTTP deadline.
const memoryBudget = Math.min(getHeapStatistics().heap_size_limit * 0.4, freemem() * 0.5);
const resume = process.argv.includes("--resume");
const verify = process.argv.includes("--verify");
const prior = resume || verify ? JSON.parse(await readFile("bulk-tuning-results.json", "utf8")) : null;
const results = prior?.results || [];
const failedCounts = prior?.failedCounts || [];
let limit = "", recommended = prior?.largestWithinBudget || 0;
let verificationCount = 0;
let cancelled = false;
process.once("SIGINT", () => { cancelled = true; });
let previousRss = process.memoryUsage().rss;
const started = Date.now();
try {
  await client.connect();
  for (let count = verify ? prior.recommended : resume ? Math.ceil(recommended * 1.5 / 1000) * 1000 : 10000; ; count = verify ? count : Math.ceil(count * 1.5 / 1000) * 1000) {
    if (cancelled) { limit = "Stopped after rolling back the current probe"; break; }
    if (verify && (!count || verificationCount >= 3)) { limit = prior.limit; break; }
    global.gc?.();
    const rss = process.memoryUsage().rss;
    const projected = Math.max(1024 * count, (previousRss - rss) * 1.5);
    if (rss + projected > memoryBudget) {
      limit = `Client memory budget (${Math.round(memoryBudget / 1048576)} MiB)`;
      break;
    }
    if (Date.now() - started > 10 * 60 * 1000) {
      limit = "10-minute probe time budget (not a database maximum)";
      break;
    }
    console.log(`PROBE ${count.toLocaleString("en-US")} rows per table`);
    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL statement_timeout = 30000");
      await client.query("SET LOCAL lock_timeout = 5000");
      const vehicles = await client.query(
        "INSERT INTO vehicles (plate_number,name,vehicle_type,is_active) SELECT $1 || '-' || n,'Batch probe','car',true FROM generate_series(1,20) n RETURNING id",
        [`PROBE-${randomUUID()}`],
      );
      const end = new Date(Date.now() - 1000);
      const job = { total: count, processed: 0, vehicleIds: vehicles.rows.map(row => row.id),
        startTime: new Date(end.getTime() - 14 * 86400000).toISOString(), endTime: end.toISOString() };
      const t0 = performance.now();
      const values = bulkColumns(job, count);
      const generatedMs = performance.now() - t0;
      const pg0 = performance.now();
      const pg = await client.query(bulkInsertSql("telemetry_pg"), values);
      const pgMs = performance.now() - pg0;
      const ts0 = performance.now();
      const ts = await client.query(bulkInsertSql("telemetry_ts"), values);
      const tsMs = performance.now() - ts0;
      if (pg.rowCount !== count || ts.rowCount !== count) throw new Error("Inserted row count mismatch");
      const elapsedMs = performance.now() - t0;
      previousRss = process.memoryUsage().rss;
      const result = { count, generatedMs: Math.round(generatedMs), pgMs: Math.round(pgMs),
        tsMs: Math.round(tsMs), elapsedMs: Math.round(elapsedMs),
        rowsPerSecondPerTable: Math.round(count * 1000 / elapsedMs), rssMiB: Math.round(previousRss / 1048576) };
      results.push(result);
      console.log(JSON.stringify(result));
      if (elapsedMs >= budgetMs) { limit = "30-second combined batch time budget"; break; }
      if (!verify) recommended = count;
      verificationCount++;
    } catch (error) {
      failedCounts.push(count);
      limit = `Probe failed: ${error.code || error.name}`;
      console.log(limit);
      break;
    } finally {
      await client.query("ROLLBACK");
    }
  }
} finally {
  await client.end();
  // Keep headroom; rollback probes exclude durable commit costs and can warm caches.
  const groups = new Map();
  for (const result of results) {
    const group = groups.get(result.count) || [];
    group.push(result);
    groups.set(result.count, group);
  }
  const safe = [...groups].filter(([count, group]) => !failedCounts.includes(count) && count <= recommended && group.every(r => r.elapsedMs < budgetMs * 0.7));
  const candidates = safe.map(([count, group]) => {
    const rates = group.map(r => r.rowsPerSecondPerTable).sort((a,b) => a-b);
    const middle = Math.floor(rates.length / 2);
    return { count, rate: rates.length % 2 ? rates[middle] : (rates[middle-1] + rates[middle]) / 2 };
  });
  const fastest = Math.max(0, ...candidates.map(row => row.rate));
  // Prefer fewer requests when throughput is within 5% of the observed best.
  const best = candidates.filter(row => row.rate >= fastest * 0.95)
    .sort((a,b) => b.count-a.count)[0];
  const report = { testedAt: new Date().toISOString(), results, failedCounts, limit,
    largestWithinBudget: recommended, recommended: best?.count || 0,
    memoryBudgetMiB: Math.round(memoryBudget / 1048576),
    notes: "Rollback probes: no test telemetry retained; excludes commit cost; timings depend on load and cache. RSS is an end-of-insert snapshot, not peak memory. Select the largest batch within 5% of the best median throughput, with every successful sample below 21s. Limits are operational budgets, not PostgreSQL row limits." };
  await writeFile("bulk-tuning-results.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ limit, largestWithinBudget: recommended, recommended: report.recommended }));
}

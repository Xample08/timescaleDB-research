import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import {
  generateTelemetry,
  validateScenarios,
  ScenarioConfig,
  DEFAULT_SCENARIOS,
} from "@/lib/scenarios";
import { getPool } from "@/lib/db";
import { createRandomInitialState, VehicleState, chunkArray } from "@/lib/sim";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

function checkPassword(req: NextRequest): boolean {
  const reqPwd = req.headers.get("x-sim-password") || "";
  const sysPwd = process.env.SIM_PASSWORD || "";

  const reqHash = crypto.createHash("sha256").update(reqPwd).digest();
  const sysHash = crypto.createHash("sha256").update(sysPwd).digest();

  if (reqHash.length !== sysHash.length) return false;
  return crypto.timingSafeEqual(reqHash, sysHash);
}

export async function GET(req: NextRequest) {
  if (!checkPassword(req)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  const url = new URL(req.url);
  const n = parseInt(url.searchParams.get("n") || "0", 10);
  if (isNaN(n) || n < 1 || n > 1000) {
    return NextResponse.json({ error: "Invalid n" }, { status: 422 });
  }

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();

    // Get n active vehicles
    const vRes = await client.query(
      "SELECT id FROM vehicles WHERE is_active = true ORDER BY id LIMIT $1",
      [n],
    );
    if (vRes.rows.length < n) {
      return NextResponse.json(
        { error: `Only ${vRes.rows.length} active vehicles exist` },
        { status: 422 },
      );
    }

    const vehicles: VehicleState[] = [];
    let resumed = 0;

    for (const row of vRes.rows) {
      const id = row.id;
      // Get last position
      const lastRes = await client.query(
        `
        SELECT time, latitude, longitude, speed_kmh, heading_deg, altitude_m
        FROM telemetry_ts
        WHERE vehicle_id = $1
        ORDER BY time DESC LIMIT 1
      `,
        [id],
      );

      let state: VehicleState | null = null;
      if (lastRes.rows.length > 0) {
        const last = lastRes.rows[0];
        // Check distance to center (using basic dist formula or just check bounds)
        // Actually, just let's use the distance formula
        const dLat = ((last.latitude - -6.2) * Math.PI) / 180;
        const dLon = ((last.longitude - 106.8) * Math.PI) / 180;
        const a =
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos((-6.2 * Math.PI) / 180) *
            Math.cos((last.latitude * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
        const dist = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

        if (dist <= 15) {
          state = {
            id,
            lat: last.latitude,
            lon: last.longitude,
            speed: last.speed_kmh,
            heading: last.heading_deg,
            alt: last.altitude_m,
            stop: 0,
          };
          resumed++;
        }
      }

      if (!state) {
        state = createRandomInitialState(id, Math.random);
      }
      vehicles.push(state);
    }

    return NextResponse.json({ vehicles, resumed });
  } catch (error: unknown) {
    return NextResponse.json(
      { error: String((error as Error).message).substring(0, 200) },
      { status: 500 },
    );
  } finally {
    if (client) client.release();
  }
}

async function runTick(
  req: NextRequest,
  emit: (event: Record<string, unknown>) => void = () => {},
) {
  if (!checkPassword(req)) {
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 422 });
  }

  const {
    vehicles,
    dt,
    mode,
    targets,
    dirty,
    tickNo,
    lastTimestamp,
    scenarios,
  } = body;

  if (
    scenarios !== undefined &&
    (!scenarios ||
      typeof scenarios !== "object" ||
      Object.keys(validateScenarios(scenarios)).length)
  )
    return NextResponse.json(
      { error: "Invalid warning scenario settings" },
      { status: 422 },
    );
  // Validation
  if (
    !Array.isArray(vehicles) ||
    vehicles.length < 1 ||
    vehicles.length > 1000
  ) {
    return NextResponse.json({ error: "Invalid vehicles" }, { status: 422 });
  }
  if (!Number.isFinite(dt) || dt < 0.5 || dt > 60) {
    return NextResponse.json({ error: "Invalid dt" }, { status: 422 });
  }
  if (mode !== "batch" && mode !== "per_row") {
    return NextResponse.json({ error: "Invalid mode" }, { status: 422 });
  }
  if (
    !Array.isArray(targets) ||
    targets.length === 0 ||
    !targets.every((t) => t === "pg" || t === "ts")
  ) {
    return NextResponse.json({ error: "Invalid targets" }, { status: 422 });
  }
  if (mode === "per_row" && vehicles.length > 50) {
    return NextResponse.json(
      { error: "per_row mode allows at most 50 vehicles" },
      { status: 422 },
    );
  }
  if (!Number.isInteger(tickNo) || tickNo < 0) {
    return NextResponse.json({ error: "Invalid tickNo" }, { status: 422 });
  }

  let tsDate = new Date();
  if (lastTimestamp) {
    const lastD = new Date(lastTimestamp);
    if (!isNaN(lastD.getTime())) {
      tsDate = new Date(Math.max(Date.now(), lastD.getTime() + 1));
    }
  }
  const timestampIso = tsDate.toISOString();

  // Validate vehicles
  for (const v of vehicles) {
    if (
      !v ||
      [v.id, v.lat, v.lon, v.speed, v.heading, v.alt, v.stop].some(
        (value) => !Number.isFinite(value),
      )
    )
      return NextResponse.json(
        { error: "Invalid vehicle data" },
        { status: 422 },
      );
    if (
      v.incident &&
      (!DEFAULT_SCENARIOS.kinds.includes(v.incident.kind) ||
        !Number.isFinite(v.incident.value) ||
        v.incident.value < -500 ||
        v.incident.value > 9000 ||
        !Number.isFinite(Date.parse(v.incident.startedAt)) ||
        !Number.isFinite(Date.parse(v.incident.until)) ||
        (v.incident.kind === "speeding" &&
          (v.incident.value < 0 || v.incident.value > 200)) ||
        (v.incident.kind === "longStop" && v.incident.value !== 0) ||
        (v.incident.kind === "poorGps" && v.incident.value < 0))
    )
      return NextResponse.json(
        { error: "Invalid incident state" },
        { status: 422 },
      );
    if (
      v.stoppedSince !== undefined &&
      !Number.isFinite(Date.parse(v.stoppedSince))
    )
      return NextResponse.json(
        { error: "Invalid stop timestamp" },
        { status: 422 },
      );
    if (
      typeof v.id !== "number" ||
      v.id < 1 ||
      typeof v.lat !== "number" ||
      v.lat < -90 ||
      v.lat > 90 ||
      typeof v.lon !== "number" ||
      v.lon < -180 ||
      v.lon > 180 ||
      typeof v.speed !== "number" ||
      v.speed < 0 ||
      v.speed > 200 ||
      typeof v.heading !== "number" ||
      v.heading < 0 ||
      v.heading > 360 ||
      typeof v.alt !== "number" ||
      v.alt < -500 ||
      v.alt > 9000 ||
      typeof v.stop !== "number" ||
      v.stop < 0 ||
      v.stop > 100
    ) {
      return NextResponse.json(
        { error: "Invalid vehicle data" },
        { status: 422 },
      );
    }
  }

  const generated = vehicles.map((v: VehicleState) =>
    generateTelemetry(
      v,
      dt,
      timestampIso,
      scenarios as ScenarioConfig | undefined,
      Math.random,
    ),
  );
  const nextVehicles = generated.map(
    (sample: ReturnType<typeof generateTelemetry>) => sample.vehicle,
  );
  const warnings = { speeding: 0, longStop: 0, altitude: 0, poorGps: 0 };
  for (const sample of generated)
    for (const kind of sample.warnings)
      warnings[kind as keyof typeof warnings]++;

  // Build rows to insert
  const rowsToInsert: (string | number)[][] = [];
  let lateCount = 0;
  let dupCount = 0;

  for (const sample of generated) {
    const v = sample.vehicle;
    let t = timestampIso;
    if (dirty && Math.random() < 0.02) {
      const delay = 60000 + Math.random() * (86400000 - 60000);
      t = new Date(tsDate.getTime() - delay).toISOString();
      lateCount++;
    }
    const acc = sample.accuracy;
    const row = [t, v.id, v.lat, v.lon, v.speed, v.heading, v.alt, acc];
    rowsToInsert.push(row);

    if (dirty && Math.random() < 0.01) {
      rowsToInsert.push([...row]); // exact duplicate
      dupCount++;
    }
  }

  const tableMap: Record<string, string> = {
    pg: "telemetry_pg",
    ts: "telemetry_ts",
  };
  const attempted = rowsToInsert.length;
  const inserted: Record<string, number> = {};
  const latencyMs: Record<string, number> = {};
  const errors: Record<string, string | null> = {};

  const order =
    tickNo % 2 === 0
      ? targets.includes("ts")
        ? ["ts", "pg"]
        : ["pg"]
      : targets.includes("pg")
        ? ["pg", "ts"]
        : ["ts"];
  const actualOrder = order.filter((t) => targets.includes(t));

  const pool = getPool();
  let client;
  try {
    client = await pool.connect();

    for (const t of actualOrder) {
      inserted[t] = 0;
      latencyMs[t] = 0;
      errors[t] = null;

      const tableName = tableMap[t];
      let queryId = "";
      try {
        if (mode === "batch") {
          const chunks = chunkArray(rowsToInsert, 500);
          for (const chunk of chunks) {
            const values = [];
            let sql = `INSERT INTO ${tableName} (time, vehicle_id, latitude, longitude, speed_kmh, heading_deg, altitude_m, gps_accuracy_m) VALUES `;
            const paramStrings = [];
            let i = 1;
            for (const r of chunk) {
              paramStrings.push(
                `($${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++}, $${i++})`,
              );
              values.push(...r);
            }
            sql +=
              paramStrings.join(", ") +
              " ON CONFLICT (vehicle_id, time) DO NOTHING";
            queryId = crypto.randomUUID();
            emit({
              type: "query",
              id: queryId,
              timestamp: new Date().toISOString(),
              target: t,
              sql,
              rows: chunk.length,
              params: values,
              tickNo,
              phase: "executing",
            });
            const s1 = performance.now();
            const res = await client.query(sql, values);
            const e1 = performance.now();
            emit({
              type: "query",
              id: queryId,
              timestamp: new Date().toISOString(),
              target: t,
              inserted: res.rowCount || 0,
              phase: "complete",
            });
            latencyMs[t] += e1 - s1;
            inserted[t] += res.rowCount || 0;
          }
        } else {
          // per_row
          for (const r of rowsToInsert) {
            const sql = `INSERT INTO ${tableName} (time, vehicle_id, latitude, longitude, speed_kmh, heading_deg, altitude_m, gps_accuracy_m) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (vehicle_id, time) DO NOTHING`;
            queryId = crypto.randomUUID();
            emit({
              type: "query",
              id: queryId,
              timestamp: new Date().toISOString(),
              target: t,
              sql,
              rows: 1,
              params: r,
              tickNo,
              phase: "executing",
            });
            const s1 = performance.now();
            const res = await client.query(sql, r);
            const e1 = performance.now();
            emit({
              type: "query",
              id: queryId,
              target: t,
              inserted: res.rowCount || 0,
              phase: "complete",
            });
            latencyMs[t] += e1 - s1;
            inserted[t] += res.rowCount || 0;
          }
        }
      } catch (err: unknown) {
        errors[t] = String((err as Error).message).substring(0, 200);
        emit({ type: "query-error", id: queryId, target: t, error: errors[t] });
      }
    }
  } catch (error: unknown) {
    // Top level error
    return NextResponse.json(
      { error: String((error as Error).message).substring(0, 200) },
      { status: 500 },
    );
  } finally {
    if (client) client.release();
  }

  // Formatting latency to 1 decimal for consistency with spec (wait, "latencyMs: { pg: 12.4 }" -> we can just leave it as float or round it)
  for (const k in latencyMs) {
    latencyMs[k] = Number(latencyMs[k].toFixed(1));
  }

  return NextResponse.json({
    warnings,
    vehicles: nextVehicles,
    timestamp: timestampIso,
    attempted,
    inserted,
    latencyMs,
    late: lateCount,
    duplicates: dupCount,
    errors,
  });
}

export async function POST(req: NextRequest) {
  if (!req.headers.get("accept")?.includes("application/x-ndjson"))
    return runTick(req);
  if (!checkPassword(req))
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  const encoder = new TextEncoder();
  let closed = false;
  const stream = new ReadableStream({
    async start(controller) {
      const emit = (event: Record<string, unknown>) => {
        if (!closed)
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      try {
        const response = await runTick(req, emit);
        emit({
          type: "result",
          status: response.status,
          data: await response.json(),
        });
      } catch (error) {
        emit({
          type: "result",
          status: 500,
          data: {
            error: error instanceof Error ? error.message : "Execution failed",
          },
        });
      } finally {
        if (!closed) {
          closed = true;
          controller.close();
        }
      }
    },
    cancel() {
      closed = true;
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

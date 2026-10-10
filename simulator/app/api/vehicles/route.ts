import { NextResponse } from "next/server";
import crypto from "crypto";
import { checkPassword } from "@/lib/auth";
import { getPool } from "@/lib/db";
export const runtime = "nodejs";
export async function POST(req: Request) {
  if (!checkPassword(req))
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  let body;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 422 });
  }
  if (
    !body ||
    body.confirmed !== true ||
    !Number.isInteger(body.targetCount) ||
    body.targetCount < 1 ||
    body.targetCount > 1000
  )
    return NextResponse.json(
      { error: "Confirm creation and provide a vehicle count from 1 to 1000" },
      { status: 422 },
    );
  const client = await getPool()
    .connect()
    .catch(() => null);
  if (!client)
    return NextResponse.json(
      { error: "Database connection failed" },
      { status: 500 },
    );
  try {
    await client.query("BEGIN");
    await client.query("LOCK TABLE vehicles IN SHARE ROW EXCLUSIVE MODE");
    const count = await client.query(
      "SELECT count(*)::integer AS active FROM vehicles WHERE is_active = true",
    );
    const missing = Math.max(0, body.targetCount - count.rows[0].active);
    if (missing)
      await client.query(
        `INSERT INTO vehicles (plate_number,name,vehicle_type,is_active)
      SELECT $1 || '-' || n::text, 'Simulated vehicle ' || n::text, 'car', true FROM generate_series(1,$2::integer) n`,
        [`SIM-${crypto.randomUUID()}`, missing],
      );
    await client.query("COMMIT");
    return NextResponse.json({
      added: missing,
      activeCount: count.rows[0].active + missing,
    });
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message.substring(0, 200)
            : "Vehicle creation failed",
      },
      { status: 500 },
    );
  } finally {
    client.release();
  }
}

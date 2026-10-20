import { withSqlStream } from "@/lib/sql-trace";
import { NextResponse } from "next/server";
import { withClient, formatError } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function runPOST() {
  try {
    return await withClient(
      async (client) => {
        await client.query(
          "CALL refresh_continuous_aggregate('telemetry_hourly', NULL, NULL);",
        );
        return NextResponse.json({
          success: true,
          message: "Continuous aggregate refreshed successfully",
        });
      },
      { timeoutMs: 300000 },
    );
  } catch (err: unknown) {
    const message =
      formatError(err) || "Failed to refresh continuous aggregate";
    return NextResponse.json(
      {
        success: false,
        error: message,
        message,
      },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  return withSqlStream(req, () => runPOST());
}

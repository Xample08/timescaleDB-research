export interface BulkJob {
  id: string;
  total: number;
  processed: number;
  vehicleIds: number[];
  days: number;
  startTime: string;
  endTime: string;
  status: "running" | "paused" | "completed";
  createdAt: string;
  updatedAt: string;
  lastError: string | null;
}
// Selected from rollback probes of both tables; keep headroom for durable commits.
export const BULK_BATCH_SIZE = 270000;
export function bulkInsertSql(table: "telemetry_pg" | "telemetry_ts") {
  return `INSERT INTO ${table} (time,vehicle_id,latitude,longitude,speed_kmh,heading_deg,altitude_m,gps_accuracy_m)
          SELECT * FROM unnest($1::timestamptz[],$2::integer[],$3::double precision[],$4::double precision[],$5::real[],$6::real[],$7::real[],$8::real[])`;
}
export function bulkColumns(job: BulkJob, count: number): unknown[][] {
  const rows = bulkRows(job, count);
  return Array.from({ length: 8 }, (_, col) => rows.map((row) => row[col]));
}
export function validateBulkInput(
  total: unknown,
  vehicles: unknown,
  days: unknown,
) {
  return (
    Number.isSafeInteger(total) &&
    Number(total) >= 1 &&
    Number.isInteger(vehicles) &&
    Number(vehicles) >= 1 &&
    Number(vehicles) <= 1000 &&
    Number.isInteger(days) &&
    Number(days) >= 1 &&
    Number(days) <= 365
  );
}
// All fields are a function of the durable job and row index: a retry generates exactly the same rows.
export function bulkRows(job: BulkJob, count: number): unknown[][] {
  const start = Date.parse(job.startTime),
    end = Date.parse(job.endTime);
  const ticks = Math.ceil(job.total / job.vehicleIds.length);
  return Array.from({ length: count }, (_, offset) => {
    const index = job.processed + offset;
    const vehicle = index % job.vehicleIds.length;
    const tick = Math.floor(index / job.vehicleIds.length);
    const fraction = ticks <= 1 ? 1 : tick / (ticks - 1);
    const phase = tick * 0.04 + vehicle * 1.7;
    const incident = Math.floor(tick / 80 + vehicle) % 12;
    const speed =
      incident === 0
        ? 0
        : incident === 1
          ? 105 + Math.sin(phase) * 12
          : 40 + Math.sin(phase) * 22;
    const micros = Math.round(start * 1000 + (end - start) * 1000 * fraction);
    const timestamp = new Date(Math.floor(micros / 1000))
      .toISOString()
      .replace("Z", `${String(micros % 1000).padStart(3, "0")}Z`);
    return [
      timestamp,
      job.vehicleIds[vehicle],
      Number((-6.2 + Math.sin(phase) * 0.045).toFixed(6)),
      Number((106.8 + Math.cos(phase) * 0.045).toFixed(6)),
      Number(speed.toFixed(1)),
      Number(((((phase * 180) / Math.PI) % 360) + 360).toFixed(1)) % 360,
      incident === 2 ? 450 : incident === 3 ? -15 : 15,
      incident === 4 ? 120 : 8,
    ];
  });
}

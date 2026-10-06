/**
 * Typed API client. Types mirror SPEC Section 10; later phases add endpoints here.
 */

export const API_BASE_URL: string =
  (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/$/, "") ?? "http://localhost:8000/api";

/** Body of every non-2xx response. */
export interface ErrorResponse {
  error: { code: string; message: string };
}

/** GET /api/health */
export interface HealthResponse {
  db: "ok";
  timescaledb_version: string | null;
  server_time: string;
}

/** Error thrown by the client. `status` is 0 when the backend could not be reached. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function isErrorResponse(value: unknown): value is ErrorResponse {
  const e = (value as ErrorResponse | null)?.error;
  return typeof e?.code === "string" && typeof e?.message === "string";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE_URL}${path}`, {
      ...init,
      headers: { Accept: "application/json", ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
    });
  } catch {
    throw new ApiError(0, "network_error", `Backend not reachable at ${API_BASE_URL}`);
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    if (isErrorResponse(body)) throw new ApiError(res.status, body.error.code, body.error.message);
    throw new ApiError(res.status, "http_error", `HTTP ${res.status}`);
  }
  return body as T;
}

/** POST /api/simulation/start */
export interface SimulationStartRequest {
  num_vehicles: number;
  interval_seconds: number;
  mode: "batch" | "per_row" | "burst";
  targets: Array<"pg" | "ts">;
  max_rows: number;
}

export interface SimulationStatus {
  state: "idle" | "running" | "stopping" | "failed";
  config: SimulationStartRequest;
  started_at: string | null;
  last_tick_at: string | null;
  totals: {
    rows_pg: number;
    rows_ts: number;
    errors: number;
  };
  rows_per_second: number;
  latency_ms: {
    pg: { p50: number; p95: number; p50_cumulative: number; p95_cumulative: number; };
    ts: { p50: number; p95: number; p50_cumulative: number; p95_cumulative: number; };
  };
  message: string | null;
}

export interface MetricPoint {
  tick: number;
  time: string;
  rows: number;
  latency_ms: { pg: number; ts: number; };
  errors: number;
}

export interface SimulationMetrics {
  points: MetricPoint[];
}

export interface VehicleLatest {
  vehicle_id: number;
  plate_number: string;
  name: string | null;
  time: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
  heading_deg: number;
}

export interface RoutePoint {
  time: string;
  latitude: number;
  longitude: number;
  speed_kmh: number;
}

export interface HourlyData {
  bucket: string;
  avg_speed: number | null;
  max_speed: number | null;
  point_count: number;
}

export interface BenchmarkQueryDef {
  id: string;
  title: string;
  description: string;
  variants: Array<"pg" | "ts" | "ts_cagg">;
  sql: Record<string, string>;
}

export interface BenchmarkRunRequest {
  query_ids: string[];
  repetitions: number;
  warmup: number;
  vehicle_id?: number | null;
}

export interface BenchmarkResult {
  query_id: string;
  variant: "pg" | "ts" | "ts_cagg";
  execution_ms: number[];
  planning_ms: number[];
  median_ms: number | null;
  min_ms: number | null;
  max_ms: number | null;
  rows_returned: number | null;
  shared_hit_blocks: number | null;
  shared_read_blocks: number | null;
  chunks_scanned: number | null;
  error: string | null;
}

export interface BenchmarkRunResponse {
  run_id: string;
  started_at: string;
  reference_time: string | null;
  simulation_running: boolean;
  results: BenchmarkResult[];
}

export interface BenchmarkExplainResponse {
  plan_text: string;
  plan_json: Record<string, any> | any[];
  chunks_scanned: number | null;
  chunks_total: number | null;
}

export interface StorageSizeDetails {
  total_bytes: number;
  table_bytes: number;
  index_bytes: number;
  toast_bytes: number | null;
  approx_rows: number;
  chunks_total: number | null;
  chunks_compressed: number | null;
  before_compression_bytes: number | null;
  after_compression_bytes: number | null;
}

export interface StorageSizesResponse {
  pg: StorageSizeDetails;
  ts: StorageSizeDetails;
}

export interface ChunkItem {
  chunk_name: string;
  range_start: string;
  range_end: string;
  is_compressed: boolean;
  total_bytes: number | null;
}

export interface StorageChunksResponse {
  chunks: ChunkItem[];
}

export interface AdminJobAccepted {
  job_id: string;
}

export interface AdminJobResponse {
  state: "running" | "done" | "failed";
  message: string | null;
  started_at: string;
  finished_at: string | null;
}

export const api = {
  health: () => request<HealthResponse>("/health"),
  simulation: {
    start: (config: SimulationStartRequest) =>
      request<SimulationStatus>("/simulation/start", {
        method: "POST",
        body: JSON.stringify(config),
      }),
    stop: () => request<SimulationStatus>("/simulation/stop", { method: "POST" }),
    status: () => request<SimulationStatus>("/simulation/status"),
    metrics: (limit = 300) => request<SimulationMetrics>(`/simulation/metrics?limit=${limit}`),
  },
  vehicles: {
    latest: () => request<VehicleLatest[]>("/vehicles/latest"),
    route: (id: number, from?: string, to?: string, limit = 2000) => {
      const params = new URLSearchParams({ limit: limit.toString() });
      if (from) params.append("from", from);
      if (to) params.append("to", to);
      return request<RoutePoint[]>(`/vehicles/${id}/route?${params.toString()}`);
    },
    hourly: (id: number, hours = 48) => request<HourlyData[]>(`/vehicles/${id}/hourly?hours=${hours}`),
  },
  benchmark: {
    queries: () => request<BenchmarkQueryDef[]>("/benchmark/queries"),
    run: (req: BenchmarkRunRequest) =>
      request<BenchmarkRunResponse>("/benchmark/run", {
        method: "POST",
        body: JSON.stringify(req),
      }),
    explain: (query_id: string, table: string) =>
      request<BenchmarkExplainResponse>(`/benchmark/explain?query_id=${query_id}&table=${table}`),
    history: () => request<BenchmarkRunResponse[]>("/benchmark/history"),
  },
  storage: {
    sizes: () => request<StorageSizesResponse>("/storage/sizes"),
    chunks: (limit = 200) => request<StorageChunksResponse>(`/storage/chunks?limit=${limit}`),
  },
  admin: {
    compressChunk: (token: string, chunk_name: string) =>
      request<AdminJobAccepted>("/admin/compress-chunk", {
        method: "POST",
        headers: { "X-Admin-Token": token },
        body: JSON.stringify({ chunk_name }),
      }),
    decompressChunk: (token: string, chunk_name: string) =>
      request<AdminJobAccepted>("/admin/decompress-chunk", {
        method: "POST",
        headers: { "X-Admin-Token": token },
        body: JSON.stringify({ chunk_name }),
      }),
    compressOlderThan: (token: string, days: number) =>
      request<AdminJobAccepted>("/admin/compress-older-than", {
        method: "POST",
        headers: { "X-Admin-Token": token },
        body: JSON.stringify({ days }),
      }),
    refreshCagg: (token: string, hours: number = 3) =>
      request<{ status: string }>("/admin/refresh-cagg", {
        method: "POST",
        headers: { "X-Admin-Token": token },
        body: JSON.stringify({ hours }),
      }),
    jobStatus: (token: string, job_id: string) =>
      request<AdminJobResponse>(`/admin/jobs/${job_id}`, {
        headers: { "X-Admin-Token": token },
      }),
  },
};

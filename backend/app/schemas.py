"""Pydantic request/response models (SPEC Section 10). Later phases add their models here."""
from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    code: str = Field(examples=["validation_error"])
    message: str = Field(examples=["human readable"])


class ErrorResponse(BaseModel):
    """Body of every non-2xx response."""

    error: ErrorDetail


class HealthResponse(BaseModel):
    """``GET /api/health``."""

    db: Literal["ok"]
    timescaledb_version: str | None = Field(
        description="extversion of the timescaledb extension; null if it is not installed",
        examples=["2.17.2"],
    )
    server_time: datetime = Field(description="Database server time (UTC, ISO 8601)")


class SimulationConfig(BaseModel):
    num_vehicles: int = Field(ge=1, examples=[20])
    interval_seconds: float = Field(ge=1.0, examples=[5.0])
    mode: Literal["batch", "per_row", "burst"] = "batch"
    targets: list[Literal["pg", "ts"]] = Field(default_factory=lambda: ["pg", "ts"])
    max_rows: int = Field(ge=1, examples=[1000000])


class SimulationTotals(BaseModel):
    rows_pg: int = 0
    rows_ts: int = 0
    errors: int = 0


class SimulationLatencyPercentiles(BaseModel):
    p50: float = 0.0
    p95: float = 0.0
    p50_cumulative: float = 0.0
    p95_cumulative: float = 0.0


class SimulationLatencyMetrics(BaseModel):
    pg: SimulationLatencyPercentiles
    ts: SimulationLatencyPercentiles


class SimulationStatusResponse(BaseModel):
    state: Literal["idle", "running", "stopping", "failed"]
    config: SimulationConfig | None = None
    started_at: datetime | None = None
    last_tick_at: datetime | None = None
    totals: SimulationTotals
    rows_per_second: float = 0.0
    latency_ms: SimulationLatencyMetrics
    message: str | None = None


class SimulationTickMetric(BaseModel):
    tick: int
    time: datetime
    rows: int
    latency_ms: dict[str, float]
    errors: int


class SimulationMetricsResponse(BaseModel):
    points: list[SimulationTickMetric]


class VehicleLatest(BaseModel):
    vehicle_id: int
    plate_number: str
    name: str | None = None
    time: datetime
    latitude: float
    longitude: float
    speed_kmh: float
    heading_deg: float


class RoutePoint(BaseModel):
    time: datetime
    latitude: float
    longitude: float
    speed_kmh: float


class HourlyData(BaseModel):
    bucket: datetime
    avg_speed: float | None = None
    max_speed: float | None = None
    point_count: int


class BenchmarkQueryDef(BaseModel):
    id: str
    title: str
    description: str
    variants: list[Literal["pg", "ts", "ts_cagg"]]
    sql: dict[str, str]


class BenchmarkRunRequest(BaseModel):
    query_ids: list[str] = Field(min_length=1)
    repetitions: int = Field(ge=1, le=20, default=5)
    warmup: int = Field(ge=0, le=3, default=1)
    vehicle_id: int | None = None


class BenchmarkResult(BaseModel):
    query_id: str
    variant: Literal["pg", "ts", "ts_cagg"]
    execution_ms: list[float]
    planning_ms: list[float]
    median_ms: float | None
    min_ms: float | None
    max_ms: float | None
    rows_returned: int | None
    shared_hit_blocks: int | None
    shared_read_blocks: int | None
    chunks_scanned: int | None
    error: str | None


class BenchmarkRunResponse(BaseModel):
    run_id: str
    started_at: datetime
    reference_time: datetime | None
    simulation_running: bool
    results: list[BenchmarkResult]


class BenchmarkExplainResponse(BaseModel):
    plan_text: str
    plan_json: dict | list
    chunks_scanned: int | None
    chunks_total: int | None


class StorageSizeDetails(BaseModel):
    total_bytes: int
    table_bytes: int
    index_bytes: int
    toast_bytes: int | None = None
    approx_rows: int
    chunks_total: int | None = None
    chunks_compressed: int | None = None
    before_compression_bytes: int | None = None
    after_compression_bytes: int | None = None


class StorageSizesResponse(BaseModel):
    pg: StorageSizeDetails
    ts: StorageSizeDetails


class ChunkItem(BaseModel):
    chunk_name: str
    range_start: datetime
    range_end: datetime
    is_compressed: bool
    total_bytes: int | None = None


class StorageChunksResponse(BaseModel):
    chunks: list[ChunkItem]


class AdminJobAccepted(BaseModel):
    job_id: str


class AdminJobResponse(BaseModel):
    state: Literal["running", "done", "failed"]
    message: str | None = None
    started_at: datetime
    finished_at: datetime | None = None


class CompressChunkRequest(BaseModel):
    chunk_name: str


class CompressOlderThanRequest(BaseModel):
    days: int = Field(ge=1, le=3650)


class RefreshCaggRequest(BaseModel):
    hours: int = Field(default=3, ge=1, le=720)

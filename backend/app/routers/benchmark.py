import json
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from app.benchmark import get_history, run_benchmark
from app.db import ConnectionPool
from app.queries import QUERIES, get_query_def, validate_table_variant
from app.schemas import (
    BenchmarkExplainResponse,
    BenchmarkQueryDef,
    BenchmarkRunRequest,
    BenchmarkRunResponse,
)

router = APIRouter(prefix="/benchmark", tags=["Benchmark"])

@router.get("/queries", response_model=list[BenchmarkQueryDef])
def get_queries():
    return QUERIES

@router.post("/run", response_model=BenchmarkRunResponse)
def run_benchmark_endpoint(req: BenchmarkRunRequest):
    for qid in req.query_ids:
        if not get_query_def(qid):
            raise HTTPException(status_code=400, detail=f"Invalid query ID: {qid}")
            
    run_id = str(uuid.uuid4())
    try:
        resp = run_benchmark(req, run_id)
        return resp
    except ValueError as e:
        raise HTTPException(status_code=409, detail=str(e))

@router.get("/explain", response_model=BenchmarkExplainResponse)
def explain_query(
    request: Request,
    query_id: str = Query(...),
    table: str = Query(...)
):
    try:
        table_variant = validate_table_variant(table)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
        
    qdef = get_query_def(query_id)
    if not qdef:
        raise HTTPException(status_code=400, detail=f"Invalid query ID: {query_id}")
        
    raw_sql = qdef.sql.get(table_variant)
    if not raw_sql:
        raise HTTPException(status_code=400, detail=f"Query {query_id} does not support variant {table_variant}")
        
    pool: ConnectionPool = request.app.state.read_pool
    
    with pool.acquire() as conn:
        ref_row = conn.run("SELECT max(time) FROM telemetry_ts")
        reference_time = ref_row[0][0] if ref_row and ref_row[0] else None
        
        # We need mock values for explain if db is empty
        ref_str = "now()"
        ref_minus_1_day = "now() - interval '1 day'"
        ref_minus_days = "now() - interval '7 days'"
        ref_hour_str = "date_trunc('hour', now())"
        ref_minus_days_hour_str = "date_trunc('hour', now()) - interval '7 days'"
        
        if reference_time:
            from datetime import timedelta, timezone
            if reference_time.tzinfo is None:
                reference_time = reference_time.replace(tzinfo=timezone.utc)
            ref_str = f"CAST('{reference_time.isoformat()}' AS timestamptz)"
            ref_minus_1_day = f"CAST('{(reference_time - timedelta(days=1)).isoformat()}' AS timestamptz)"
            ref_minus_days = f"CAST('{(reference_time - timedelta(days=7)).isoformat()}' AS timestamptz)"
            ref_hour = reference_time.replace(minute=0, second=0, microsecond=0)
            ref_hour_str = f"CAST('{ref_hour.isoformat()}' AS timestamptz)"
            ref_minus_days_hour = ref_hour - timedelta(days=7)
            ref_minus_days_hour_str = f"CAST('{ref_minus_days_hour.isoformat()}' AS timestamptz)"
            
        v_row = conn.run("SELECT id FROM vehicles WHERE is_active ORDER BY id LIMIT 1")
        vid = v_row[0][0] if v_row else 1
        
        sql = raw_sql.format(
            ref=ref_str,
            ref_minus_1_day=ref_minus_1_day,
            ref_minus_days=ref_minus_days,
            ref_hour=ref_hour_str,
            ref_minus_days_hour=ref_minus_days_hour_str,
            vehicle_id=str(int(vid))
        )
        
        # Get text
        try:
            res_text = conn.run(f"EXPLAIN (ANALYZE, BUFFERS) {sql}")
            plan_text = "\n".join([r[0] for r in res_text])
        except Exception as e:
            plan_text = str(e)
            
        # Get JSON
        try:
            res_json = conn.run(f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}")
            plan_json_val = res_json[0][0]
            if isinstance(plan_json_val, str):
                plan_json = json.loads(plan_json_val)
            else:
                plan_json = plan_json_val
        except Exception:
            plan_json = {}
            
        chunks_scanned = None
        chunks_total = None
        
        if table_variant in ["ts", "ts_cagg"] and plan_json:
            from app.benchmark import extract_chunks_scanned
            chunks_scanned = extract_chunks_scanned(plan_json)
            
            try:
                ct_row = conn.run("SELECT count(*) FROM timescaledb_information.chunks WHERE hypertable_name = 'telemetry_ts'")
                chunks_total = ct_row[0][0] if ct_row else 0
            except Exception:
                pass
                
        return BenchmarkExplainResponse(
            plan_text=plan_text,
            plan_json=plan_json,
            chunks_scanned=chunks_scanned,
            chunks_total=chunks_total
        )

@router.get("/history", response_model=list[BenchmarkRunResponse])
def get_benchmark_history():
    return get_history()

import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from typing import Any

import pg8000.native

from app.config import get_settings
from app.db import connect
from app.queries import get_query_def
from app.schemas import BenchmarkResult, BenchmarkRunRequest, BenchmarkRunResponse
from app.simulator import get_simulator

log = logging.getLogger(__name__)

# Global state for history and locking
_benchmark_lock = threading.Lock()
_history: list[BenchmarkRunResponse] = []
MAX_HISTORY = 20

def get_history() -> list[BenchmarkRunResponse]:
    return list(_history)

def parse_plan_json(plan: dict | list) -> tuple[float, float, int, int, int]:
    """Extract (execution_ms, planning_ms, returned_rows, shared_hit, shared_read) from JSON plan."""
    if isinstance(plan, list):
        plan = plan[0]
    
    execution_time = plan.get("Execution Time", 0.0)
    planning_time = plan.get("Planning Time", 0.0)
    
    top_node = plan.get("Plan", {})
    rows = top_node.get("Actual Rows", 0)
    shared_hit = top_node.get("Shared Hit Blocks", 0)
    shared_read = top_node.get("Shared Read Blocks", 0)
    
    return execution_time, planning_time, rows, shared_hit, shared_read

def extract_chunks_scanned(plan: dict | list) -> int:
    """Recursively search for chunk relation names matching ^_hyper_\d+_\d+_chunk$."""
    import re
    chunk_pattern = re.compile(r"^_hyper_\d+_\d+_chunk$")
    scanned_chunks = set()

    def walk(node: dict):
        if not isinstance(node, dict):
            return
        rel_name = node.get("Relation Name")
        if rel_name and chunk_pattern.match(rel_name):
            scanned_chunks.add(rel_name)
        
        for key, value in node.items():
            if isinstance(value, dict):
                walk(value)
            elif isinstance(value, list):
                for item in value:
                    if isinstance(item, dict):
                        walk(item)

    if isinstance(plan, list):
        walk(plan[0])
    else:
        walk(plan)
    
    return len(scanned_chunks)

def run_benchmark(req: BenchmarkRunRequest, run_id: str) -> BenchmarkRunResponse:
    if not _benchmark_lock.acquire(blocking=False):
        raise ValueError("Benchmark already running")
    
    try:
        sim = get_simulator()
        if sim.state == "running" and sim.config and sim.config.mode == "burst":
            raise ValueError("Cannot run benchmark while simulation is in burst mode")
        
        simulation_running = sim.state == "running"
        settings = get_settings()
        
        started_at = datetime.now(timezone.utc)
        results: list[BenchmarkResult] = []
        
        # 1. Connect
        conn = connect(settings.tiger_connection_string.get_secret_value())
        try:
            # 2. Get reference time
            ref_row = conn.run("SELECT max(time) FROM telemetry_ts")
            reference_time = ref_row[0][0] if ref_row and ref_row[0] else None
            
            if not reference_time:
                # empty DB, use current time
                reference_time = started_at
            
            # Ensure it is timezone aware
            if reference_time.tzinfo is None:
                reference_time = reference_time.replace(tzinfo=timezone.utc)

            # Precalculate variables
            ref_str = f"CAST('{reference_time.isoformat()}' AS timestamptz)"
            ref_minus_1_day = f"CAST('{(reference_time - timedelta(days=1)).isoformat()}' AS timestamptz)"
            ref_minus_days = f"CAST('{(reference_time - timedelta(days=7)).isoformat()}' AS timestamptz)"
            
            # For q4 aligned to hour
            ref_hour = reference_time.replace(minute=0, second=0, microsecond=0)
            ref_hour_str = f"CAST('{ref_hour.isoformat()}' AS timestamptz)"
            ref_minus_days_hour = ref_hour - timedelta(days=7)
            ref_minus_days_hour_str = f"CAST('{ref_minus_days_hour.isoformat()}' AS timestamptz)"

            # Get smallest active vehicle ID if not provided
            vid = req.vehicle_id
            if vid is None:
                v_row = conn.run("SELECT id FROM vehicles WHERE is_active ORDER BY id LIMIT 1")
                if v_row:
                    vid = v_row[0][0]
                else:
                    vid = 1
            vid_str = str(int(vid))
            
            timeout_ms = settings.bench_statement_timeout_seconds * 1000

            for query_id in req.query_ids:
                qdef = get_query_def(query_id)
                if not qdef:
                    continue
                
                for variant in qdef.variants:
                    raw_sql = qdef.sql.get(variant)
                    if not raw_sql:
                        continue
                    
                    sql = raw_sql.format(
                        ref=ref_str,
                        ref_minus_1_day=ref_minus_1_day,
                        ref_minus_days=ref_minus_days,
                        ref_hour=ref_hour_str,
                        ref_minus_days_hour=ref_minus_days_hour_str,
                        vehicle_id=vid_str
                    )
                    
                    # For ts_cagg q4, check coverage first
                    if variant == "ts_cagg":
                        cov_rows = conn.run("SELECT min(bucket), max(bucket) FROM telemetry_hourly")
                        min_b = cov_rows[0][0] if cov_rows and cov_rows[0] else None
                        max_b = cov_rows[0][1] if cov_rows and cov_rows[0] else None
                        
                        has_coverage = False
                        if min_b and max_b:
                            if min_b <= ref_minus_days_hour and max_b >= (ref_hour - timedelta(hours=1)):
                                has_coverage = True
                                
                        if not has_coverage:
                            results.append(BenchmarkResult(
                                query_id=query_id,
                                variant=variant,
                                execution_ms=[],
                                planning_ms=[],
                                median_ms=None,
                                min_ms=None,
                                max_ms=None,
                                rows_returned=None,
                                shared_hit_blocks=None,
                                shared_read_blocks=None,
                                chunks_scanned=None,
                                error="continuous aggregate not refreshed for this window"
                            ))
                            continue
                            
                    explain_sql = f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}"
                    
                    exec_times = []
                    plan_times = []
                    last_rows = None
                    last_hit = None
                    last_read = None
                    last_chunks = None
                    error_msg = None
                    
                    for run_idx in range(req.warmup + req.repetitions):
                        is_warmup = run_idx < req.warmup
                        
                        try:
                            conn.run(f"SET statement_timeout = {timeout_ms}")
                            res = conn.run(explain_sql)
                            
                            plan_str_or_dict = res[0][0]
                            if isinstance(plan_str_or_dict, str):
                                plan = json.loads(plan_str_or_dict)
                            else:
                                plan = plan_str_or_dict
                            
                            et, pt, rows, hit, read = parse_plan_json(plan)
                            chunks = None
                            if variant in ["ts", "ts_cagg"]:
                                chunks = extract_chunks_scanned(plan)
                                
                            if not is_warmup:
                                exec_times.append(et)
                                plan_times.append(pt)
                                last_rows = rows
                                last_hit = hit
                                last_read = read
                                last_chunks = chunks
                                
                        except pg8000.native.DatabaseError as e:
                            # pg8000 sets e.args[0] to the dict of error fields
                            err_dict = e.args[0] if e.args else {}
                            if isinstance(err_dict, dict) and err_dict.get("C") == "57014":
                                error_msg = "query timeout"
                            else:
                                error_msg = str(e)
                            break
                        except Exception as e:
                            error_msg = str(e)
                            break
                        finally:
                            try:
                                conn.run("SET statement_timeout = 0")
                            except Exception:
                                pass # ignore cleanup errors
                                
                    if error_msg:
                        results.append(BenchmarkResult(
                            query_id=query_id,
                            variant=variant,
                            execution_ms=[],
                            planning_ms=[],
                            median_ms=None,
                            min_ms=None,
                            max_ms=None,
                            rows_returned=None,
                            shared_hit_blocks=None,
                            shared_read_blocks=None,
                            chunks_scanned=None,
                            error=error_msg
                        ))
                    else:
                        exec_times.sort()
                        if exec_times:
                            n = len(exec_times)
                            if n % 2 == 1:
                                median = exec_times[n // 2]
                            else:
                                median = (exec_times[n // 2 - 1] + exec_times[n // 2]) / 2
                            min_val = exec_times[0]
                            max_val = exec_times[-1]
                        else:
                            median = min_val = max_val = None
                            
                        results.append(BenchmarkResult(
                            query_id=query_id,
                            variant=variant,
                            execution_ms=exec_times,
                            planning_ms=plan_times,
                            median_ms=median,
                            min_ms=min_val,
                            max_ms=max_val,
                            rows_returned=last_rows,
                            shared_hit_blocks=last_hit,
                            shared_read_blocks=last_read,
                            chunks_scanned=last_chunks,
                            error=None
                        ))
        finally:
            conn.close()
            
        resp = BenchmarkRunResponse(
            run_id=run_id,
            started_at=started_at,
            reference_time=reference_time,
            simulation_running=simulation_running,
            results=results
        )
        _history.insert(0, resp)
        del _history[MAX_HISTORY:]
        return resp
        
    finally:
        _benchmark_lock.release()

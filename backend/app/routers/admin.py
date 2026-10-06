import re
import secrets
import threading
import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, Dict

from fastapi import APIRouter, Depends, HTTPException, Header, Request, status

from app.schemas import (
    AdminJobAccepted,
    AdminJobResponse,
    CompressChunkRequest,
    CompressOlderThanRequest,
    RefreshCaggRequest
)
from app.db import connect
from app.config import get_settings, Settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/admin", tags=["admin"])

CHUNK_NAME_REGEX = re.compile(r"^_hyper_\d+_\d+_chunk$")

class JobState:
    def __init__(self):
        self.job_id: Optional[str] = None
        self.state: str = "done"
        self.message: Optional[str] = None
        self.started_at: Optional[datetime] = None
        self.finished_at: Optional[datetime] = None
        self._lock = threading.Lock()

    def start_job(self) -> str:
        with self._lock:
            if self.state == "running":
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A job is already running")
            self.job_id = str(uuid.uuid4())
            self.state = "running"
            self.message = "Job started"
            self.started_at = datetime.now(timezone.utc)
            self.finished_at = None
            return self.job_id

    def set_done(self, message: str):
        with self._lock:
            self.state = "done"
            self.message = message
            self.finished_at = datetime.now(timezone.utc)

    def set_failed(self, message: str):
        with self._lock:
            self.state = "failed"
            self.message = message
            self.finished_at = datetime.now(timezone.utc)

global_job_state = JobState()
jobs_history: Dict[str, AdminJobResponse] = {}

def get_admin_token(x_admin_token: str = Header(None), settings: Settings = Depends(get_settings)):
    if not settings.admin_token or not settings.admin_token.get_secret_value():
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin token is unset on server"
        )
    if not x_admin_token:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Missing X-Admin-Token header"
        )
    if not secrets.compare_digest(x_admin_token, settings.admin_token.get_secret_value()):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Invalid admin token"
        )
    return x_admin_token


def _run_compress_chunk(job_id: str, chunk_name: str, dsn: str):
    try:
        conn = connect(dsn, application_name="admin-compress")
        try:
            conn.run(f"SELECT compress_chunk('_timescaledb_internal.{chunk_name}', if_not_compressed => true)")
            global_job_state.set_done(f"Compressed chunk {chunk_name}")
        finally:
            conn.close()
    except Exception as e:
        log.exception("Error in compress_chunk")
        global_job_state.set_failed(str(e))
    finally:
        with global_job_state._lock:
            jobs_history[job_id] = AdminJobResponse(
                state=global_job_state.state,
                message=global_job_state.message,
                started_at=global_job_state.started_at,
                finished_at=global_job_state.finished_at
            )


def _run_decompress_chunk(job_id: str, chunk_name: str, dsn: str):
    try:
        conn = connect(dsn, application_name="admin-decompress")
        try:
            conn.run(f"SELECT decompress_chunk('_timescaledb_internal.{chunk_name}', if_compressed => true)")
            global_job_state.set_done(f"Decompressed chunk {chunk_name}")
        finally:
            conn.close()
    except Exception as e:
        log.exception("Error in decompress_chunk")
        global_job_state.set_failed(str(e))
    finally:
        with global_job_state._lock:
            jobs_history[job_id] = AdminJobResponse(
                state=global_job_state.state,
                message=global_job_state.message,
                started_at=global_job_state.started_at,
                finished_at=global_job_state.finished_at
            )


def select_chunks_to_compress(chunks: list[dict], now: datetime, days: int) -> list[str]:
    threshold = now - timedelta(days=days)
    return [
        c["chunk_name"] for c in chunks
        if not c.get("is_compressed") and c["range_end"] < threshold
    ]

def _run_compress_older_than(job_id: str, days: int, dsn: str):
    try:
        conn = connect(dsn, application_name="admin-compress-older")
        try:
            query = """
            SELECT chunk_name, range_end, is_compressed
            FROM timescaledb_information.chunks
            WHERE hypertable_name = 'telemetry_ts'
            """
            rows = conn.run(query)
            chunks = [
                {"chunk_name": r[0], "range_end": r[1], "is_compressed": r[2]}
                for r in rows
            ]
            now = datetime.now(timezone.utc)
            to_compress = select_chunks_to_compress(chunks, now, days)
            
            if not to_compress:
                global_job_state.set_done("nothing to compress")
            else:
                total = len(to_compress)
                for i, chunk in enumerate(to_compress):
                    with global_job_state._lock:
                        global_job_state.message = f"{i}/{total}"
                    
                    conn.run(f"SELECT compress_chunk('_timescaledb_internal.{chunk}', if_not_compressed => true)")
                
                global_job_state.set_done(f"Compressed {total} chunks")
        finally:
            conn.close()
    except Exception as e:
        log.exception("Error in compress_older_than")
        global_job_state.set_failed(str(e))
    finally:
        with global_job_state._lock:
            jobs_history[job_id] = AdminJobResponse(
                state=global_job_state.state,
                message=global_job_state.message,
                started_at=global_job_state.started_at,
                finished_at=global_job_state.finished_at
            )


def _check_chunk(chunk_name: str, dsn: str):
    if not CHUNK_NAME_REGEX.match(chunk_name):
        raise HTTPException(status_code=422, detail="Invalid chunk name format")
        
    conn = connect(dsn, application_name="admin-check")
    try:
        query = """
        SELECT range_end FROM timescaledb_information.chunks 
        WHERE chunk_name = :chunk_name AND hypertable_name = 'telemetry_ts'
        """
        rows = conn.run(query, chunk_name=chunk_name)
        if not rows:
            raise HTTPException(status_code=404, detail="Chunk not found")
        
        range_end = rows[0][0]
        now = datetime.now(timezone.utc)
        if range_end > now:
            raise HTTPException(status_code=422, detail="Cannot compress the active (future) chunk")
    finally:
        conn.close()

@router.post("/compress-chunk", response_model=AdminJobAccepted, status_code=202)
def compress_chunk(req: CompressChunkRequest, settings: Settings = Depends(get_settings), token: str = Depends(get_admin_token)):
    _check_chunk(req.chunk_name, settings.write_dsn)
    
    job_id = global_job_state.start_job()
    threading.Thread(target=_run_compress_chunk, args=(job_id, req.chunk_name, settings.write_dsn), daemon=True).start()
    return AdminJobAccepted(job_id=job_id)

@router.post("/decompress-chunk", response_model=AdminJobAccepted, status_code=202)
def decompress_chunk(req: CompressChunkRequest, settings: Settings = Depends(get_settings), token: str = Depends(get_admin_token)):
    # Validate format only
    if not CHUNK_NAME_REGEX.match(req.chunk_name):
        raise HTTPException(status_code=422, detail="Invalid chunk name format")
        
    job_id = global_job_state.start_job()
    threading.Thread(target=_run_decompress_chunk, args=(job_id, req.chunk_name, settings.write_dsn), daemon=True).start()
    return AdminJobAccepted(job_id=job_id)

@router.post("/compress-older-than", response_model=AdminJobAccepted, status_code=202)
def compress_older_than(req: CompressOlderThanRequest, settings: Settings = Depends(get_settings), token: str = Depends(get_admin_token)):
    job_id = global_job_state.start_job()
    threading.Thread(target=_run_compress_older_than, args=(job_id, req.days, settings.write_dsn), daemon=True).start()
    return AdminJobAccepted(job_id=job_id)

@router.post("/refresh-cagg", status_code=200)
def refresh_cagg(req: RefreshCaggRequest = None, settings: Settings = Depends(get_settings), token: str = Depends(get_admin_token)):
    if req is None:
        req = RefreshCaggRequest()
        
    conn = connect(settings.write_dsn, application_name="admin-refresh-cagg")
    try:
        now = datetime.now(timezone.utc)
        start = now - timedelta(hours=req.hours)
        conn.run(
            "CALL refresh_continuous_aggregate('telemetry_hourly', CAST(:start AS timestamptz), CAST(:end AS timestamptz))",
            start=start.isoformat(), end=now.isoformat()
        )
    finally:
        conn.close()
    return {"status": "ok"}

@router.get("/jobs/{job_id}", response_model=AdminJobResponse)
def get_job_status(job_id: str, token: str = Depends(get_admin_token)):
    with global_job_state._lock:
        if global_job_state.job_id == job_id:
            return AdminJobResponse(
                state=global_job_state.state,
                message=global_job_state.message,
                started_at=global_job_state.started_at,
                finished_at=global_job_state.finished_at
            )
        if job_id in jobs_history:
            return jobs_history[job_id]
            
    raise HTTPException(status_code=404, detail="Job not found")

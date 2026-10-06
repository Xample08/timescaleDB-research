"""Simulation REST API endpoints (SPEC Section 10)."""
from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException, Request

from app.schemas import SimulationConfig, SimulationStatusResponse, SimulationMetricsResponse
from app.simulator import get_simulator
from app.config import get_settings

log = logging.getLogger(__name__)

router = APIRouter(prefix="/simulation", tags=["simulation"])


@router.post("/start", response_model=SimulationStatusResponse)
def start_simulation(config: SimulationConfig, request: Request) -> Any:
    sim = get_simulator()
    if sim.state in ("running", "stopping"):
        raise HTTPException(status_code=409, detail={"error": {"code": "conflict", "message": "Simulation already running"}})
        
    settings = get_settings()
    if config.num_vehicles > settings.sim_max_vehicles:
        raise HTTPException(status_code=422, detail={"error": {"code": "validation_error", "message": f"num_vehicles exceeds SIM_MAX_VEHICLES ({settings.sim_max_vehicles})"}})
    if config.interval_seconds < settings.sim_min_interval_seconds:
        raise HTTPException(status_code=422, detail={"error": {"code": "validation_error", "message": f"interval_seconds is below SIM_MIN_INTERVAL_SECONDS ({settings.sim_min_interval_seconds})"}})
        
    pool = request.app.state.read_pool
    try:
        with pool.acquire() as conn:
            res = conn.run("SELECT id FROM vehicles WHERE is_active ORDER BY id LIMIT :num", num=config.num_vehicles)
            vehicles_data = [{"id": r[0]} for r in res]
            
            if len(vehicles_data) < config.num_vehicles:
                raise HTTPException(status_code=422, detail={"error": {"code": "validation_error", "message": f"Requested {config.num_vehicles} vehicles but only {len(vehicles_data)} are active"}})
                
    except HTTPException:
        raise
    except Exception as e:
        log.error(f"Failed to fetch vehicles: {e}")
        raise HTTPException(status_code=503, detail={"error": {"code": "db_error", "message": "Database unavailable"}})
        
    sim.start(config, vehicles_data)
    return sim._get_status()


@router.post("/stop", response_model=SimulationStatusResponse)
def stop_simulation() -> Any:
    sim = get_simulator()
    sim.stop()
    return sim._get_status()


@router.get("/status", response_model=SimulationStatusResponse)
def get_simulation_status() -> Any:
    sim = get_simulator()
    return sim._get_status()


@router.get("/metrics", response_model=SimulationMetricsResponse)
def get_simulation_metrics(limit: int = 300) -> Any:
    sim = get_simulator()
    points = list(sim.metrics_buffer)[-limit:]
    return {"points": points}

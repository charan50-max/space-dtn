from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from backend.app.services.traffic_service import traffic_service


router = APIRouter(
    prefix="/api/traffic",
    tags=["Traffic"],
)


class TrafficRequest(BaseModel):
    simulation_id: str = "traffic-demo"


class TrafficRunRequest(BaseModel):
    simulation_id: str = "traffic-demo"
    max_steps: int = Field(default=100, ge=1, le=1000)


@router.get("/source")
def get_source():
    try:
        return traffic_service.source_data()
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@router.post("/start")
def start_traffic(request: TrafficRequest):
    try:
        return traffic_service.start_cycle(
            simulation_id=request.simulation_id,
            reset=True,
        )
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404,
            detail=str(exc),
        )


@router.post("/step")
def step_traffic(request: TrafficRequest):
    return traffic_service.step(
        simulation_id=request.simulation_id,
    )


@router.post("/run")
def run_traffic(request: TrafficRunRequest):
    return traffic_service.run_until_complete(
        simulation_id=request.simulation_id,
        max_steps=request.max_steps,
    )


@router.get("/state")
def traffic_state(
    simulation_id: str = "traffic-demo",
):
    return traffic_service.state(simulation_id)


@router.post("/reset")
def reset_traffic(request: TrafficRequest):
    return traffic_service.reset(
        simulation_id=request.simulation_id,
    )

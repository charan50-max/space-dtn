from fastapi import APIRouter, Query

from backend.app.services.simulation_service import (
    simulation_service,
)
from backend.app.dtn.graph_check import resilience_report


router = APIRouter(
    prefix="/api/network",
    tags=["Network"],
)


@router.get("")
def get_network(
    simulation_id: str = "default"
):
    state = simulation_service.snapshot(
        simulation_id
    )
    return state["network"]


@router.get("/resilience")
def get_resilience(
    simulation_id: str = "default",
    source: str = Query(default="GS-1"),
    target: str = Query(default="GS-2"),
):
    simulator = simulation_service.get(simulation_id)
    return resilience_report(simulator.network, source=source, target=target)
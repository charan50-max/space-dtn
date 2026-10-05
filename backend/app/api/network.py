from fastapi import APIRouter

from backend.app.services.simulation_service import (
    simulation_service,
)


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
from typing import Literal

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field

from backend.app.services.simulation_service import (
    simulation_service,
    comparison_service,
)
from backend.app.services.benchmark_service import (
    ScoreBankUnavailable,
    benchmark_service,
)


router = APIRouter(
    prefix="/api/simulation",
    tags=["Simulation"],
)


class SimulationRequest(BaseModel):
    simulation_id: str = "default"


class LinkLatencyRequest(BaseModel):
    simulation_id: str = "default"
    link_id: str
    delta: int = Field(default=1, ge=-99, le=99)


class LinkLatencySetRequest(BaseModel):
    simulation_id: str = "default"
    link_id: str
    latency: int = Field(default=2, ge=1, le=100)


class LinkCongestionRequest(BaseModel):
    simulation_id: str = "default"
    link_id: str
    delta: float = Field(default=10.0, ge=-100, le=100)


class LinkCongestionSetRequest(BaseModel):
    simulation_id: str = "default"
    link_id: str
    congestion: float = Field(default=0.0, ge=0, le=100)


class LinkRequest(BaseModel):
    simulation_id: str = "default"
    link_id: str


class ReplayRequest(BaseModel):
    simulation_id: str = "default"
    message_id: str


class CorruptRequest(BaseModel):
    simulation_id: str = "default"
    message_id: str


@router.get("/state")
def get_state(simulation_id: str = "default"):
    return simulation_service.snapshot(simulation_id)


@router.post("/step")
def step(request: SimulationRequest):
    return simulation_service.step(request.simulation_id)


@router.post("/reset")
def reset(request: SimulationRequest):
    return simulation_service.reset(request.simulation_id)


@router.post("/link/latency")
def adjust_latency(request: LinkLatencyRequest):
    return simulation_service.adjust_latency(
        request.simulation_id,
        request.link_id,
        request.delta,
    )


@router.post("/link/latency/set")
def set_latency(request: LinkLatencySetRequest):
    return simulation_service.set_latency(
        request.simulation_id,
        request.link_id,
        request.latency,
    )


@router.post("/link/congestion")
def adjust_congestion(request: LinkCongestionRequest):
    return simulation_service.adjust_congestion(
        request.simulation_id,
        request.link_id,
        request.delta,
    )


@router.post("/link/congestion/set")
def set_congestion(request: LinkCongestionSetRequest):
    return simulation_service.set_congestion(
        request.simulation_id,
        request.link_id,
        request.congestion,
    )


@router.post("/link/reset")
def reset_link(request: LinkRequest):
    return simulation_service.reset_link_conditions(
        request.simulation_id,
        request.link_id,
    )


# Duplicate-detection demo: replay a copy of a delivered message.
@router.post("/replay")
def replay(request: ReplayRequest):
    return simulation_service.replay_bundle(
        request.simulation_id,
        request.message_id,
    )


# Integrity demo: corrupt an in-flight message. The destination's SHA-256
# check fails and the message is dropped.
@router.post("/corrupt")
def corrupt(request: CorruptRequest):
    return simulation_service.corrupt_message(
        request.simulation_id,
        request.message_id,
    )


# Backward-compatible routes. They now map to the latency boundary/reset
# instead of maintaining an independent binary disruption state.
@router.post("/disrupt")
def disrupt(request: LinkRequest):
    return simulation_service.disrupt_link(
        request.simulation_id,
        request.link_id,
    )


@router.post("/restore")
def restore(request: LinkRequest):
    return simulation_service.restore_link(
        request.simulation_id,
        request.link_id,
    )


# ------------------------------------------------------------------
# BASELINE vs SPACE DTN COMPARISON
#
# One scripted scenario, run on three simulators in lockstep:
#   baseline : FIFO queue + static contact-plan routing
#   reroute  : FIFO queue + disruption-aware routing
#   adaptive : TinyML priority queue + disruption-aware routing
# ------------------------------------------------------------------
@router.get("/compare/state")
def compare_state():
    return comparison_service.snapshot()


@router.post("/compare/reset")
def compare_reset():
    return comparison_service.reset()


@router.post("/compare/step")
def compare_step():
    return comparison_service.step()


@router.post("/compare/run")
def compare_run():
    return comparison_service.run_to_end()


# ------------------------------------------------------------------
# STATISTICAL BENCHMARK
#
# Every strategy runs on identical seeded traffic and identical seeded
# random link outages / congestion bursts, repeated over many seeds.
# Returns means, standard deviations and 95% confidence intervals.
# ------------------------------------------------------------------
@router.get("/compare/benchmark")
def compare_benchmark(
    seeds: int = Query(default=20, ge=1, le=200),
    base_seed: int = Query(default=1, ge=0),
    messages: int = Query(default=36, ge=6, le=300),
    outages: int = Query(default=4, ge=0, le=12),
    congestion_events: int = Query(default=3, ge=0, le=12),
    link_capacity: int = Query(default=2, ge=1, le=20),
    buffer_capacity: int = Query(default=10, ge=2, le=100),
    ttl: int = Query(default=30, ge=5, le=200),
    include_runs: bool = False,
    # Where priority scores come from: real TinyML outputs (default),
    # a perfect oracle (upper bound) or random scores (lower bound).
    classifier: Literal["tinyml", "oracle", "random"] = "tinyml",
    urgent_fraction: float = Query(default=0.20, ge=0.01, le=0.9),
):
    try:
        return benchmark_service.run(
            seeds=seeds,
            base_seed=base_seed,
            messages=messages,
            outages=outages,
            congestion_events=congestion_events,
            link_capacity=link_capacity,
            buffer_capacity=buffer_capacity,
            ttl=ttl,
            include_runs=include_runs,
            classifier=classifier,
            urgent_fraction=urgent_fraction,
        )
    except ScoreBankUnavailable as exc:
        raise HTTPException(status_code=503, detail=str(exc))


# Same benchmark once per priority source (tinyml / oracle / random),
# reporting only what priority scheduling changes (adaptive vs reroute).
@router.get("/compare/benchmark/priority-sources")
def compare_priority_sources(
    seeds: int = Query(default=20, ge=1, le=100),
    base_seed: int = Query(default=1, ge=0),
    messages: int = Query(default=36, ge=6, le=300),
    outages: int = Query(default=4, ge=0, le=12),
    congestion_events: int = Query(default=3, ge=0, le=12),
    link_capacity: int = Query(default=2, ge=1, le=20),
    buffer_capacity: int = Query(default=10, ge=2, le=100),
    ttl: int = Query(default=30, ge=5, le=200),
    urgent_fraction: float = Query(default=0.20, ge=0.01, le=0.9),
):
    return benchmark_service.run_priority_sources(
        seeds=seeds,
        base_seed=base_seed,
        messages=messages,
        outages=outages,
        congestion_events=congestion_events,
        link_capacity=link_capacity,
        buffer_capacity=buffer_capacity,
        ttl=ttl,
        urgent_fraction=urgent_fraction,
    )

import pytest
from backend.app.dtn.network import SpaceNetwork
from backend.app.dtn.disruptions import DisruptionSchedule
from backend.app.services.benchmark_service import benchmark_service


def test_disruption_schedule_determinism():
    """Verify identical seed yields identical DisruptionSchedule events and windows."""
    network = SpaceNetwork()
    link_ids = list(network.links.keys())

    sched_a = DisruptionSchedule(link_ids, seed=42, horizon=30, outages=4, congestion_events=3)
    sched_b = DisruptionSchedule(link_ids, seed=42, horizon=30, outages=4, congestion_events=3)

    assert sched_a.outage_windows == sched_b.outage_windows
    assert sched_a.congestion_windows == sched_b.congestion_windows
    assert dict(sched_a.events) == dict(sched_b.events)


def test_benchmark_run_determinism():
    """Verify that running the benchmark with the same base_seed produces identical summary results."""
    res_1 = benchmark_service.run(
        seeds=3,
        base_seed=101,
        messages=12,
        outages=2,
        congestion_events=2,
        classifier="oracle",
    )
    res_2 = benchmark_service.run(
        seeds=3,
        base_seed=101,
        messages=12,
        outages=2,
        congestion_events=2,
        classifier="oracle",
    )

    for strat in ("baseline", "reroute", "adaptive", "spray"):
        assert res_1["summary"][strat]["delivery_rate"]["mean"] == res_2["summary"][strat]["delivery_rate"]["mean"]
        assert res_1["summary"][strat]["urgent_avg_delay"]["mean"] == res_2["summary"][strat]["urgent_avg_delay"]["mean"]
        assert res_1["summary"][strat]["transmissions"]["mean"] == res_2["summary"][strat]["transmissions"]["mean"]

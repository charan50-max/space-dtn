import pytest
from backend.app.dtn.simulator import DTNSimulator


def test_static_baseline_waits_while_adaptive_detours():
    """Verify that the static plan baseline waits (stores) when its planned link fails, whereas adaptive detours."""
    plan = ["GS-1", "SAT-1", "SAT-3", "SAT-5", "GS-2"]

    sim_base = DTNSimulator("baseline", contact_plan=plan)
    sim_adapt = DTNSimulator("adaptive")

    msg_base = sim_base.add_message("GS-1", "GS-2", "payload", priority_score=80.0, ttl=40)
    msg_adapt = sim_adapt.add_message("GS-1", "GS-2", "payload", priority_score=80.0, ttl=40)

    # Advance until SAT-3 is reached (2 ticks: GS-1 -> SAT-1 -> SAT-3)
    for _ in range(2):
        sim_base.step()
        sim_adapt.step()

    assert msg_base.current_node == "SAT-3"
    assert msg_adapt.current_node == "SAT-3"

    # Disrupt L4 (SAT-3 <-> SAT-5)
    sim_base.disrupt_link("L4")
    sim_adapt.disrupt_link("L4")

    # Step at tick 3
    sim_base.step()
    sim_adapt.step()

    # The baseline's static plan only goes via L4, so it must store at SAT-3
    assert msg_base.current_node == "SAT-3"
    assert msg_base.status == "stored"
    assert msg_base.stored_ticks > 0

    # The adaptive router recalculates from live topology and detours away from SAT-3 (e.g. to SAT-2)
    assert msg_adapt.current_node != "SAT-3"
    assert "L4" not in msg_adapt.route

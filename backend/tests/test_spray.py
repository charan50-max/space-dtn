import pytest
from backend.app.dtn.simulator import DTNSimulator


def test_spray_and_wait_copy_bounds_and_delivery():
    """Verify that spray-and-wait does not exceed L copies in the network and delivers exactly once."""
    L = 4
    sim = DTNSimulator("spray", spray_copies=L)

    msg = sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="scientific payload",
        priority_score=50.0,
        ttl=40,
    )

    for _ in range(30):
        sim.step()
        if msg.bundle_id in sim.delivered_ids:
            break

    # Exactly one delivery registered
    assert msg.bundle_id in sim.delivered_ids
    assert sim.total_delivered == 1

    # Total copies per bundle stay within L plus the final delivery copy (project_plan.md 2.1 & 7.1)
    bundle_messages = [m for m in sim.messages.values() if m.bundle_id == msg.bundle_id]
    assert len(bundle_messages) <= L + 1

    # Verify overhead ratio was tracked
    stats = sim.statistics()
    assert stats["transmissions"] >= 1
    assert stats["overhead_ratio"] >= 1.0

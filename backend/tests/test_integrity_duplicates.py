import pytest
from backend.app.dtn.simulator import DTNSimulator


def test_duplicate_bundle_rejection():
    """Verify that a duplicate bundle is rejected and does not increase delivered count."""
    sim = DTNSimulator("adaptive")
    msg = sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="telemetry payload",
        priority_score=90.0,
        ttl=20,
    )

    # Run until delivered
    for _ in range(15):
        sim.step()
        if msg.status == "delivered":
            break

    assert msg.status == "delivered"
    assert sim.total_delivered == 1
    assert sim.total_duplicates == 0

    # Replay duplicate
    replayed = sim.replay_bundle(msg.id)
    assert replayed is True
    assert sim.total_duplicates == 1
    assert sim.total_delivered == 1  # Delivered count remains 1


def test_corrupted_bundle_dropped_on_integrity_check():
    """Verify that a bundle corrupted in transit fails SHA-256 and is dropped."""
    sim = DTNSimulator("adaptive")
    msg = sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="clean sensor data",
        priority_score=90.0,
        ttl=20,
    )

    # Corrupt payload
    sim.corrupt_message(msg.id)
    assert msg.tampered is True

    # Advance until delivered or dropped
    for _ in range(15):
        sim.step()
        if msg.status in ("delivered", "dropped"):
            break

    assert msg.status == "dropped"
    assert msg.reject_reason == "integrity"
    assert sim.integrity_failures == 1
    assert sim.total_delivered == 0


def test_clean_retransmission_delivered_after_corruption():
    """Verify that if an initial message is corrupted, a clean retransmitted copy can be delivered."""
    sim = DTNSimulator("adaptive")
    msg = sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="mission critical observation",
        priority_score=95.0,
        ttl=25,
    )

    # Corrupt original
    sim.corrupt_message(msg.id)

    # Schedule clean duplicate at t+1
    sim.schedule_duplicate(msg.id, delay=1)

    for _ in range(20):
        sim.step()

    # The original was dropped due to corruption
    assert msg.status == "dropped"
    assert msg.reject_reason == "integrity"

    # The clean retransmitted copy should be delivered
    delivered_msgs = [m for m in sim.messages.values() if m.status == "delivered"]
    assert len(delivered_msgs) == 1
    assert delivered_msgs[0].copy_of == msg.bundle_id

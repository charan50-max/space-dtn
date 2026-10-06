import pytest
from backend.app.dtn.simulator import DTNSimulator


def test_monotonic_sequence_numbering():
    """Verify that per-source messages receive monotonically increasing sequence numbers."""
    sim = DTNSimulator("adaptive")
    m1 = sim.add_message("GS-1", "GS-2", "p1")
    m2 = sim.add_message("GS-1", "GS-2", "p2")
    m3 = sim.add_message("SAT-1", "GS-2", "p3")
    m4 = sim.add_message("GS-1", "GS-2", "p4")

    assert m1.seq_no == 1
    assert m2.seq_no == 2
    assert m3.seq_no == 1  # SAT-1 has its own counter
    assert m4.seq_no == 3


def test_sequence_gap_detection():
    """Verify that arriving bundles out of order trigger sequence gap detection at destination."""
    sim = DTNSimulator("adaptive")
    # Manually inject messages with explicit sequence numbers simulating a lost packet (seq 1, then seq 3)
    m1 = sim.add_message("GS-1", "GS-2", "p1", seq_no=1, ttl=20)
    m3 = sim.add_message("GS-1", "GS-2", "p3", seq_no=3, ttl=20)

    # Deliver m1 directly
    m1.current_node = "GS-2"
    sim._deliver(m1)
    assert sim.sequence_gaps == 0

    # Deliver m3 directly (missing seq 2)
    m3.current_node = "GS-2"
    sim._deliver(m3)
    assert sim.sequence_gaps == 1


def test_custody_transfer_handover_and_acknowledgement():
    """Verify custody transfer tracking, next-hop custody handover, and final custody acknowledgement."""
    sim = DTNSimulator("adaptive")
    msg = sim.add_message("GS-1", "GS-2", "custody payload", priority_score=85.0, ttl=30)

    # Step 1: Forwarded GS-1 -> SAT-1
    sim.step()
    assert msg.custody_holder == "SAT-1"
    assert msg.custody_acked is False

    # Advance until delivered at GS-2
    for _ in range(15):
        sim.step()
        if msg.status == "delivered":
            break

    assert msg.status == "delivered"
    assert msg.custody_holder == "GS-2"
    assert msg.custody_acked is True

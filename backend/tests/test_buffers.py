import pytest
from backend.app.dtn.simulator import DTNSimulator
from backend.app.dtn.message import DTNMessage
from collections import Counter


def test_eviction_only_at_or_above_eviction_margin():
    """Verify that in adaptive mode, eviction only occurs if priority margin >= EVICTION_MARGIN."""
    sim = DTNSimulator("adaptive", buffer_capacity=2)
    margin = sim.EVICTION_MARGIN

    # Resident 1 with score 40
    res_1 = DTNMessage(
        id="M1",
        source="SAT-1",
        destination="GS-2",
        payload="res1",
        priority_score=40.0,
        current_node="SAT-1",
    )
    # Incoming 1 with score 50 (difference 10 < margin)
    inc_low = DTNMessage(
        id="M2",
        source="GS-1",
        destination="GS-2",
        payload="inc_low",
        priority_score=40.0 + margin - 5.0,
        current_node="GS-1",
    )
    occupancy = Counter({"SAT-1": 2})
    active = [res_1]

    # Should NOT make room
    room_made = sim._make_room("SAT-1", inc_low, active, occupancy)
    assert room_made is False
    assert res_1.status not in sim.TERMINAL

    # Incoming 2 with score >= 40 + margin
    inc_high = DTNMessage(
        id="M3",
        source="GS-1",
        destination="GS-2",
        payload="inc_high",
        priority_score=40.0 + margin + 5.0,
        current_node="GS-1",
    )

    room_made = sim._make_room("SAT-1", inc_high, active, occupancy)
    assert room_made is True
    assert res_1.status == "dropped"
    assert res_1.reject_reason == "buffer_evicted"


def test_replicating_strategy_never_drops_last_copy():
    """Verify that in replicating strategies, _evict_redundant never evicts the sole remaining copy of a bundle."""
    sim = DTNSimulator("spray", buffer_capacity=2)

    msg_a = DTNMessage(
        id="MSG-A",
        source="SAT-1",
        destination="GS-2",
        payload="data_a",
        bundle_id="BUNDLE-A",
        current_node="SAT-1",
    )
    incoming = DTNMessage(
        id="MSG-INC",
        source="GS-1",
        destination="GS-2",
        payload="data_inc",
        bundle_id="BUNDLE-INC",
        current_node="GS-1",
    )

    occupancy = Counter({"SAT-1": 2})
    # alive count for BUNDLE-A is 1 (only one copy left in network)
    alive = Counter({"BUNDLE-A": 1})
    pool = [msg_a]

    # Cannot evict msg_a because it is the sole remaining copy
    evicted = sim._evict_redundant("SAT-1", incoming, pool, occupancy, alive)
    assert evicted is False
    assert msg_a.status not in sim.TERMINAL

    # If alive count is 2 (e.g. another copy exists elsewhere in network)
    alive["BUNDLE-A"] = 2
    evicted_2 = sim._evict_redundant("SAT-1", incoming, pool, occupancy, alive)
    assert evicted_2 is True
    assert msg_a.status == "rejected"
    assert msg_a.reject_reason == "buffer_evicted"

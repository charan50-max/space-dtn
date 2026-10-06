import pytest
from backend.app.dtn.simulator import DTNSimulator


def test_urgency_metrics_with_dataset_proxy_label():
    """Verify that when true_urgent is provided, statistics() scores on true_urgent regardless of predicted class."""
    sim = DTNSimulator("adaptive")

    # Message 1: predicted LOW, but true_urgent=True
    msg_1 = sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="p1",
        priority_score=10.0,
        priority_class="LOW",
        true_urgent=True,
    )
    # Message 2: predicted HIGH, but true_urgent=False
    msg_2 = sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="p2",
        priority_score=90.0,
        priority_class="HIGH",
        true_urgent=False,
    )

    stats = sim.statistics()
    assert stats["urgent_label_source"] == "dataset_label"
    assert stats["urgent_total"] == 1  # Only msg_1 is true_urgent
    assert stats["predicted_urgent_total"] == 1  # msg_2 was predicted HIGH


def test_urgency_metrics_fallback_to_predicted_class():
    """Verify that when true_urgent is None, statistics() falls back to predicted class."""
    sim = DTNSimulator("adaptive")

    sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="p1",
        priority_score=85.0,
        priority_class="HIGH",
        true_urgent=None,
    )
    sim.add_message(
        source="GS-1",
        destination="GS-2",
        payload="p2",
        priority_score=15.0,
        priority_class="LOW",
        true_urgent=None,
    )

    stats = sim.statistics()
    assert stats["urgent_label_source"] == "predicted_class"
    assert stats["urgent_total"] == 1

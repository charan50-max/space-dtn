import pytest
import networkx as nx
from backend.app.dtn.network import SpaceNetwork
from backend.app.dtn.router import DTNRouter
from backend.app.dtn.graph_check import (
    to_networkx,
    verify_router_against_networkx,
    shortest_cost,
    resilience_report,
)


def test_dtn_router_nominal_matches_networkx():
    """Verify DTNRouter.find_nominal_route cost matches nx.shortest_path_length across all node pairs."""
    network = SpaceNetwork()
    result = verify_router_against_networkx(network)
    assert result["verified"] is True
    assert result["tested_pairs"] == 45
    assert result["mismatch_count"] == 0


def test_live_routing_never_uses_inactive_link():
    """Verify that when a link is disrupted/inactive, live route recalculation avoids it."""
    network = SpaceNetwork()
    router = DTNRouter(network)

    # L4 connects SAT-3 and SAT-5
    link_l4 = network.links["L4"]
    assert link_l4 is not None

    # Deactivate / disrupt L4
    network.set_link_status("L4", False)
    assert link_l4.active is False

    # Check route from SAT-3 to SAT-5
    route = router.find_route("SAT-3", "SAT-5", priority_score=50.0)
    assert route is not None
    # Verify neither (SAT-3, SAT-5) nor (SAT-5, SAT-3) is in the hops
    hops = list(zip(route, route[1:]))
    assert ("SAT-3", "SAT-5") not in hops
    assert ("SAT-5", "SAT-3") not in hops


def test_graph_check_resilience_report():
    """Verify topological resilience calculations from graph_check."""
    network = SpaceNetwork()
    report = resilience_report(network, source="GS-1", target="GS-2")

    assert report["source"] == "GS-1"
    assert report["target"] == "GS-2"
    assert report["nominal_latency"] is not None
    assert report["path_resilience"]["edge_connectivity"] >= 1
    assert len(report["critical_links"]) > 0
    assert report["global_resilience"]["total_nodes"] == 9

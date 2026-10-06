from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple
import networkx as nx

from backend.app.dtn.network import SpaceNetwork, MAX_LATENCY


def to_networkx(
    network: SpaceNetwork,
    weight: str = "latency",
    use_base: bool = False,
    include_inactive: bool = False,
) -> nx.Graph:
    """
    Build a NetworkX Graph from a SpaceNetwork instance.

    Args:
        network: The SpaceNetwork instance.
        weight: The edge attribute to use as weight (default: "latency").
        use_base: If True, uses link.base_latency instead of live latency.
        include_inactive: If True, includes links even if inactive/disrupted.
    """
    graph = nx.Graph()

    for node_id, node in network.nodes.items():
        graph.add_node(
            node_id,
            id=node.id,
            name=node.name,
            node_type=node.node_type,
            x=node.x,
            y=node.y,
            buffer_capacity=node.buffer_capacity,
            buffer_cost=node.buffer_cost,
        )

    for link_id, link in network.links.items():
        if not include_inactive and not link.active:
            continue

        latency = link.base_latency if (use_base and link.base_latency is not None) else link.latency

        graph.add_edge(
            link.source,
            link.target,
            id=link_id,
            link_id=link_id,
            latency=latency,
            bandwidth=link.bandwidth,
            effective_bandwidth=link.effective_bandwidth,
            congestion=link.congestion,
            active=link.active,
        )

    return graph


def shortest_cost(
    network: SpaceNetwork,
    source: str,
    target: str,
    use_base: bool = False,
) -> Optional[float]:
    """Calculate shortest path cost using NetworkX Dijkstra."""
    graph = to_networkx(network, weight="latency", use_base=use_base, include_inactive=use_base)
    try:
        return float(nx.shortest_path_length(graph, source, target, weight="latency"))
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def shortest_path(
    network: SpaceNetwork,
    source: str,
    target: str,
    use_base: bool = False,
) -> Optional[List[str]]:
    """Find the shortest path node sequence using NetworkX."""
    graph = to_networkx(network, weight="latency", use_base=use_base, include_inactive=use_base)
    try:
        return list(nx.shortest_path(graph, source, target, weight="latency"))
    except (nx.NetworkXNoPath, nx.NodeNotFound):
        return None


def verify_router_against_networkx(network: SpaceNetwork) -> Dict[str, Any]:
    """
    Verify DTNRouter.find_nominal_route against NetworkX shortest_path_length
    for every pair of nodes in the network.
    """
    from backend.app.dtn.router import DTNRouter

    router = DTNRouter(network)
    base_graph = to_networkx(network, weight="latency", use_base=True, include_inactive=True)

    tested_pairs = 0
    mismatches = []

    node_ids = sorted(network.nodes.keys())
    for i, src in enumerate(node_ids):
        for dst in node_ids[i:]:
            tested_pairs += 1
            nominal_route = router.find_nominal_route(src, dst)

            if src == dst:
                continue

            try:
                nx_cost = nx.shortest_path_length(base_graph, src, dst, weight="latency")
                has_nx_path = True
            except (nx.NetworkXNoPath, nx.NodeNotFound):
                has_nx_path = False
                nx_cost = None

            if not has_nx_path:
                if nominal_route is not None:
                    mismatches.append({
                        "pair": [src, dst],
                        "issue": "NetworkX found no path, but DTNRouter found route",
                        "router_route": nominal_route,
                    })
                continue

            if nominal_route is None:
                mismatches.append({
                    "pair": [src, dst],
                    "issue": "NetworkX found path, but DTNRouter returned None",
                    "nx_cost": nx_cost,
                })
                continue

            # Compute cost of nominal_route
            route_cost = 0
            for u, v in zip(nominal_route, nominal_route[1:]):
                link = network.find_link(u, v)
                latency = link.base_latency if (link and link.base_latency) else (link.latency if link else 0)
                route_cost += latency

            if route_cost != nx_cost:
                mismatches.append({
                    "pair": [src, dst],
                    "issue": "Cost mismatch",
                    "router_cost": route_cost,
                    "nx_cost": nx_cost,
                    "nominal_route": nominal_route,
                })

    return {
        "verified": len(mismatches) == 0,
        "tested_pairs": tested_pairs,
        "mismatch_count": len(mismatches),
        "mismatches": mismatches,
    }


def resilience_report(
    network: SpaceNetwork,
    source: str = "GS-1",
    target: str = "GS-2",
) -> Dict[str, Any]:
    """
    Comprehensive topological resilience and vulnerability analysis:
    - Bridges (single links whose failure disconnects the entire graph)
    - Articulation points (single nodes whose failure disconnects the entire graph)
    - Edge & node connectivity between source and target
    - Minimum edge cut (smallest set of links whose removal isolates source from target)
    - Edge-disjoint paths between source and target
    - Per-link criticality ranking (latency penalty or disconnection if link fails)
    """
    # Healthy base graph
    base_graph = to_networkx(network, weight="latency", use_base=True, include_inactive=True)

    # Global structural properties
    bridges = [list(bridge) for bridge in nx.bridges(base_graph)]
    articulation_points = list(nx.articulation_points(base_graph))

    has_base_path = nx.has_path(base_graph, source, target)
    nominal_latency = (
        nx.shortest_path_length(base_graph, source, target, weight="latency")
        if has_base_path
        else None
    )
    nominal_path = (
        list(nx.shortest_path(base_graph, source, target, weight="latency"))
        if has_base_path
        else None
    )

    # Edge connectivity & disjoint paths between source and target
    if has_base_path:
        edge_conn = nx.edge_connectivity(base_graph, source, target)
        node_conn = nx.node_connectivity(base_graph, source, target)
        min_edge_cut = [list(e) for e in nx.minimum_edge_cut(base_graph, source, target)]
        disjoint_paths = [
            list(p) for p in nx.edge_disjoint_paths(base_graph, source, target)
        ]
    else:
        edge_conn = 0
        node_conn = 0
        min_edge_cut = []
        disjoint_paths = []

    # Per-link criticality analysis
    link_criticality = []

    for link_id, link in network.links.items():
        g_sub = base_graph.copy()
        if g_sub.has_edge(link.source, link.target):
            g_sub.remove_edge(link.source, link.target)

        is_connected = nx.has_path(g_sub, source, target)
        if not is_connected:
            extra_latency = None
            criticality_score = 999.0
            status = "DISCONNECTS_NETWORK"
            new_path = None
            new_cost = None
        else:
            new_cost = nx.shortest_path_length(g_sub, source, target, weight="latency")
            new_path = list(nx.shortest_path(g_sub, source, target, weight="latency"))
            extra_latency = round(new_cost - nominal_latency, 2) if nominal_latency is not None else 0
            criticality_score = extra_latency
            if extra_latency > 0:
                status = f"+{extra_latency}ms_DELAY"
            else:
                status = "REDUNDANT"

        link_criticality.append({
            "link_id": link_id,
            "source": link.source,
            "target": link.target,
            "base_latency": link.base_latency or link.latency,
            "active": link.active,
            "live_latency": link.latency,
            "live_congestion": link.congestion,
            "disconnects": not is_connected,
            "extra_latency": extra_latency,
            "criticality_score": criticality_score,
            "status": status,
            "alternate_path": new_path,
            "alternate_cost": new_cost,
            "is_on_nominal_path": (
                bool(nominal_path and any(
                    (link.source == nominal_path[i] and link.target == nominal_path[i+1]) or
                    (link.target == nominal_path[i] and link.source == nominal_path[i+1])
                    for i in range(len(nominal_path) - 1)
                ))
            ),
        })

    # Sort links by criticality: first ones that disconnect, then by extra_latency descending
    link_criticality.sort(
        key=lambda item: (-1 if item["disconnects"] else 0, -(item["extra_latency"] or 0), item["link_id"])
    )

    # Top critical links
    most_critical = [
        item for item in link_criticality
        if item["disconnects"] or (item["extra_latency"] is not None and item["extra_latency"] > 0)
    ]

    return {
        "source": source,
        "target": target,
        "nominal_path": nominal_path,
        "nominal_latency": nominal_latency,
        "global_resilience": {
            "bridges": bridges,
            "bridge_count": len(bridges),
            "articulation_points": articulation_points,
            "articulation_point_count": len(articulation_points),
            "total_nodes": len(network.nodes),
            "total_links": len(network.links),
            "active_links": network.active_link_count(),
        },
        "path_resilience": {
            "edge_connectivity": edge_conn,
            "node_connectivity": node_conn,
            "minimum_edge_cut": min_edge_cut,
            "edge_disjoint_paths": disjoint_paths,
            "disjoint_paths_count": len(disjoint_paths),
        },
        "critical_links": most_critical,
        "all_link_criticality": link_criticality,
    }

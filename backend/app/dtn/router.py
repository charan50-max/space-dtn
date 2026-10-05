import heapq
from typing import List, Optional, Tuple

from backend.app.dtn.network import SpaceNetwork, Link


class DTNRouter:
    """
    Adaptive DTN router.

    Instead of routing on latency alone, every candidate link receives a
    dynamic cost based on:

        latency + congestion + downstream buffer cost

    TinyML message priority changes the weights. High-priority messages
    prefer low-latency / low-congestion paths, while lower-priority traffic
    can tolerate more delay and avoid expensive buffer nodes.

    The route is recalculated from the message's CURRENT node on every tick,
    using live link state. This is what makes it "disruption-aware".
    """

    def __init__(self, network: SpaceNetwork):
        self.network = network

    @staticmethod
    def _priority_level(priority_score: float) -> float:
        return max(0.0, min(1.0, float(priority_score) / 100.0))

    def link_cost(
        self,
        link: Link,
        next_node_id: str,
        priority_score: float = 50.0,
    ) -> float:
        priority = self._priority_level(priority_score)
        node = self.network.nodes[next_node_id]

        # High priority -> latency/congestion matter more.
        latency_weight = 1.0 + (1.5 * priority)
        congestion_weight = 1.0 + priority

        # Lower priority traffic is more willing to trade time for buffer
        # efficiency; high priority traffic still pays the buffer cost.
        buffer_weight = 1.5 - (0.5 * priority)

        latency_cost = link.latency * latency_weight

        # Congestion is nonlinear: heavily congested links become rapidly
        # unattractive instead of changing cost only linearly.
        congestion_ratio = link.congestion / 100.0
        congestion_cost = (
            link.latency
            * (congestion_ratio ** 2)
            * 8.0
            * congestion_weight
        )

        buffer_cost = node.buffer_cost * buffer_weight

        return latency_cost + congestion_cost + buffer_cost

    def find_route(
        self,
        source: str,
        destination: str,
        priority_score: float = 50.0,
    ) -> Optional[List[str]]:

        if source == destination:
            return [source]

        queue: List[Tuple[float, str, List[str]]] = [
            (0.0, source, [source])
        ]
        visited = set()

        while queue:
            cost, current, path = heapq.heappop(queue)

            if current in visited:
                continue

            visited.add(current)

            if current == destination:
                return path

            for neighbor, link in self.network.get_neighbors(current):
                if neighbor in visited:
                    continue

                edge_cost = self.link_cost(
                    link,
                    next_node_id=neighbor,
                    priority_score=priority_score,
                )

                heapq.heappush(
                    queue,
                    (
                        cost + edge_cost,
                        neighbor,
                        path + [neighbor],
                    ),
                )

        return None


class StaticPlanRouter:
    """
    BASELINE router: a simplified model of contact-plan routing.

    Paths are computed ONCE, when the network is healthy, using latency only.
    They are never recomputed. At each hop the bundle follows the plan; if the
    planned next hop is currently unusable, the bundle waits (is stored)
    until the link returns, even if another path exists.

    This models how a pre-computed contact plan behaves when an unplanned
    outage happens. It is a deliberate simplification, not a full
    implementation of Contact Graph Routing.

    Priority is ignored by this router.
    """

    def __init__(self, network: SpaceNetwork):
        self.network = network
        self.plan = {}

        node_ids = list(network.nodes.keys())
        for src in node_ids:
            for dst in node_ids:
                self.plan[(src, dst)] = self._plan_route(src, dst)

    def _plan_route(self, source: str, destination: str) -> Optional[List[str]]:
        if source == destination:
            return [source]

        queue: List[Tuple[float, str, List[str]]] = [
            (0.0, source, [source])
        ]
        visited = set()

        while queue:
            cost, current, path = heapq.heappop(queue)

            if current in visited:
                continue

            visited.add(current)

            if current == destination:
                return path

            for neighbor, link in self.network.get_neighbors(current):
                if neighbor not in visited:
                    heapq.heappush(
                        queue,
                        (cost + link.latency, neighbor, path + [neighbor]),
                    )

        return None

    def set_planned_path(self, path: List[str]) -> None:
        """
        Install an operator-published contact plan for one path.

        Every suffix of the path is registered too, so hop-by-hop
        forwarding keeps following the same plan from each intermediate
        node. Use this when several paths tie on latency and the plan
        should name one explicitly.
        """
        for node_a, node_b in zip(path, path[1:]):
            if self.network.find_link(node_a, node_b) is None:
                raise ValueError(f"No link between {node_a} and {node_b}")

        destination = path[-1]
        for index in range(len(path) - 1):
            self.plan[(path[index], destination)] = list(path[index:])

    def find_route(
        self,
        source: str,
        destination: str,
        priority_score: float = 50.0,
    ) -> Optional[List[str]]:
        route = self.plan.get((source, destination))

        if not route or len(route) < 2:
            return route

        # Follow the plan only if the planned next hop is usable right now.
        usable_neighbors = {
            neighbor for neighbor, _ in self.network.get_neighbors(source)
        }

        return route if route[1] in usable_neighbors else None

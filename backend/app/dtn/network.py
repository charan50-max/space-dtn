from dataclasses import dataclass, asdict
from typing import Dict, List, Optional, Tuple

from backend.app.dtn.node import Node


# ============================================================
# LINK / NETWORK PARAMETERS
# ============================================================

MIN_LATENCY = 1
MAX_LATENCY = 100          # 100 ms = effectively disrupted
MAX_CONGESTION = 100.0


@dataclass
class Link:
    id: str
    source: str
    target: str
    latency: int
    bandwidth: float
    active: bool = True
    congestion: float = 0.0
    base_latency: Optional[int] = None
    windows: Optional[List[Tuple[int, int]]] = None

    def is_planned_up(self, tick: int) -> bool:
        if self.windows is None:
            return True
        return any(start <= tick <= end for start, end in self.windows)

    def __post_init__(self):
        if self.base_latency is None:
            self.base_latency = self.latency

        self.latency = self._clamp_latency(self.latency)
        self.congestion = self._clamp_congestion(self.congestion)
        self._sync_status()

    @staticmethod
    def _clamp_latency(value) -> int:
        return max(
            MIN_LATENCY,
            min(MAX_LATENCY, int(round(float(value))))
        )

    @staticmethod
    def _clamp_congestion(value) -> float:
        return round(
            max(0.0, min(MAX_CONGESTION, float(value))),
            1,
        )

    def _sync_status(self):
        # Maximum latency represents a link that is no longer usable.
        self.active = self.latency < MAX_LATENCY

    @property
    def link_status(self) -> str:
        if not self.active:
            return "UNUSABLE"
        if self.congestion >= 80:
            return "SEVERE_CONGESTION"
        if self.congestion >= 50:
            return "CONGESTED"
        return "ACTIVE"

    @property
    def effective_bandwidth(self) -> float:
        return round(
            self.bandwidth * (1.0 - self.congestion / 100.0),
            2,
        )

    def set_latency(self, latency) -> int:
        self.latency = self._clamp_latency(latency)
        self._sync_status()
        return self.latency

    def adjust_latency(self, delta: int) -> int:
        return self.set_latency(self.latency + int(delta))

    def set_congestion(self, congestion) -> float:
        self.congestion = self._clamp_congestion(congestion)
        return self.congestion

    def adjust_congestion(self, delta: float) -> float:
        return self.set_congestion(self.congestion + float(delta))

    def reset_conditions(self):
        self.set_latency(self.base_latency or MIN_LATENCY)
        self.set_congestion(0.0)

    def to_dict(self):
        data = asdict(self)
        data.update(
            {
                "active": self.active,
                "status": self.link_status,
                "effective_bandwidth": self.effective_bandwidth,
                "windows": self.windows,
                "min_latency": MIN_LATENCY,
                "max_latency": MAX_LATENCY,
                "max_congestion": MAX_CONGESTION,
            }
        )
        return data


class SpaceNetwork:

    def __init__(self):
        self.clock: int = 0
        self.nodes: Dict[str, Node] = {}
        self.links: Dict[str, Link] = {}
        self._create_default_network()

    def _create_default_network(self):

        # Preset buffer costs are routing costs, not buffer capacities.
        # Higher cost means the routing engine prefers not to use that
        # node for forwarding/storage when alternatives are available.
        self.nodes = {
            "GS-1": Node(
                id="GS-1", name="Ground Station Alpha", node_type="ground",
                x=8, y=78, buffer_capacity=40, buffer_cost=5.0,
            ),
            "SAT-1": Node(
                id="SAT-1", name="Satellite 1", node_type="satellite",
                x=22, y=52, buffer_capacity=6, buffer_cost=10.0,
            ),
            "SAT-2": Node(
                id="SAT-2", name="Satellite 2", node_type="satellite",
                x=40, y=28, buffer_capacity=5, buffer_cost=14.0,
            ),
            "SAT-3": Node(
                id="SAT-3", name="Satellite 3", node_type="satellite",
                x=58, y=52, buffer_capacity=6, buffer_cost=12.0,
            ),
            "SAT-4": Node(
                id="SAT-4", name="Satellite 4", node_type="satellite",
                x=40, y=72, buffer_capacity=4, buffer_cost=22.0,
            ),
            "SAT-5": Node(
                id="SAT-5", name="Satellite 5", node_type="satellite",
                x=76, y=28, buffer_capacity=6, buffer_cost=16.0,
            ),
            "SAT-6": Node(
                id="SAT-6", name="Satellite 6", node_type="satellite",
                x=22, y=28, buffer_capacity=5, buffer_cost=15.0,
            ),
            "SAT-7": Node(
                id="SAT-7", name="Satellite 7", node_type="satellite",
                x=76, y=72, buffer_capacity=5, buffer_cost=15.0,
            ),
            "GS-2": Node(
                id="GS-2", name="Ground Station Beta", node_type="ground",
                x=92, y=72, buffer_capacity=40, buffer_cost=5.0,
            ),
        }

        self.links = {
            "L1": Link("L1", "GS-1", "SAT-1", 2, 100),
            "L2": Link("L2", "SAT-1", "SAT-2", 3, 80),
            "L3": Link("L3", "SAT-2", "SAT-3", 3, 80),
            "L4": Link("L4", "SAT-3", "SAT-5", 2, 90),
            "L5": Link("L5", "SAT-5", "GS-2", 2, 100),
            "L6": Link("L6", "SAT-1", "SAT-4", 2, 70),
            "L7": Link("L7", "SAT-4", "SAT-3", 2, 70),
            "L8": Link("L8", "SAT-2", "SAT-4", 2, 60),
            "L9": Link("L9", "GS-1", "SAT-6", 2, 85),
            "L10": Link("L10", "SAT-2", "SAT-5", 2, 90),
            "L11": Link("L11", "SAT-1", "SAT-3", 3, 80),
            "L12": Link("L12", "SAT-6", "SAT-2", 2, 75),
            "L13": Link("L13", "SAT-5", "SAT-7", 2, 80),
            "L14": Link("L14", "SAT-7", "GS-2", 2, 95),
            "L15": Link("L15", "SAT-3", "SAT-7", 3, 70),
            "L16": Link("L16", "SAT-6", "SAT-4", 2, 65),
        }

    def get_neighbors(
        self,
        node_id: str,
        include_inactive: bool = False,
    ) -> List[tuple]:
        neighbors = []

        for link in self.links.values():
            # Latency at MAX_LATENCY is the simulation's disruption state.
            if not include_inactive:
                if not link.active or not link.is_planned_up(self.clock):
                    continue

            if link.source == node_id:
                neighbors.append((link.target, link))
            elif link.target == node_id:
                neighbors.append((link.source, link))

        return neighbors

    def find_link(self, node_a: str, node_b: str) -> Optional[Link]:
        for link in self.links.values():
            if (
                (link.source == node_a and link.target == node_b)
                or (link.source == node_b and link.target == node_a)
            ):
                return link
        return None

    def get_link(self, link_id: str) -> Optional[Link]:
        return self.links.get(link_id)

    def set_link_latency(self, link_id: str, latency) -> Optional[Link]:
        link = self.links.get(link_id)
        if link is None:
            return None
        link.set_latency(latency)
        return link

    def adjust_link_latency(self, link_id: str, delta: int) -> Optional[Link]:
        link = self.links.get(link_id)
        if link is None:
            return None
        link.adjust_latency(delta)
        return link

    def set_link_congestion(self, link_id: str, congestion) -> Optional[Link]:
        link = self.links.get(link_id)
        if link is None:
            return None
        link.set_congestion(congestion)
        return link

    def adjust_link_congestion(self, link_id: str, delta: float) -> Optional[Link]:
        link = self.links.get(link_id)
        if link is None:
            return None
        link.adjust_congestion(delta)
        return link

    # Backward-compatible method. The old binary control is now represented
    # by moving latency to/from the maximum latency boundary.
    def set_link_status(self, link_id: str, active: bool) -> bool:
        link = self.links.get(link_id)
        if link is None:
            return False

        if active:
            link.set_latency(link.base_latency or MIN_LATENCY)
        else:
            link.set_latency(MAX_LATENCY)
        return True

    def reset_link_conditions(self, link_id: str) -> bool:
        link = self.links.get(link_id)
        if link is None:
            return False
        link.reset_conditions()
        return True

    def active_link_count(self) -> int:
        return sum(1 for link in self.links.values() if link.active)

    def total_link_count(self) -> int:
        return len(self.links)

    def average_latency(self) -> float:
        links = list(self.links.values())
        return round(
            sum(link.latency for link in links) / len(links),
            2,
        ) if links else 0.0

    def average_congestion(self) -> float:
        links = list(self.links.values())
        return round(
            sum(link.congestion for link in links) / len(links),
            2,
        ) if links else 0.0

    def to_dict(self):
        return {
            "clock": self.clock,
            "nodes": [node.to_dict() for node in self.nodes.values()],
            "links": [link.to_dict() for link in self.links.values()],
            "parameters": {
                "min_latency": MIN_LATENCY,
                "max_latency": MAX_LATENCY,
                "max_congestion": MAX_CONGESTION,
                "buffer_costs": {
                    node_id: node.buffer_cost
                    for node_id, node in self.nodes.items()
                },
            },
        }

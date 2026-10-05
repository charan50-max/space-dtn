from dataclasses import dataclass, asdict


@dataclass
class Node:
    id: str
    name: str
    node_type: str
    x: float
    y: float
    status: str = "online"
    buffer_capacity: int = 100
    buffer_cost: float = 10.0

    def to_dict(self):
        return asdict(self)

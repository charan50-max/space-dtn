from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List

from backend.app.core.state import simulation_store
from backend.app.services.priority_service import priority_service


PROJECT_ROOT = Path(__file__).resolve().parents[3]
TRAFFIC_FILE = (
    PROJECT_ROOT
    / "tinyml"
    / "data"
    / "generated"
    / "traffic_cycle.json"
)

# Retransmissions injected into every traffic cycle. A sender that missed an
# acknowledgement sends the same bundle again, so the network carries real
# duplicate copies that the destination must detect and reject.
DUPLICATE_OFFSET = 3     # first retransmitted packet (0-based index)
DUPLICATE_STRIDE = 14    # then every 14th packet after that
DUPLICATE_DELAY = 4      # ticks between the original and its copy

# In-transit corruption injected into every traffic cycle. The payload is
# altered but its SHA-256 hash is not, so the destination's integrity check
# must fail and drop the bundle. Set CORRUPT_STRIDE to 0 to disable.
CORRUPT_OFFSET = 10      # first corrupted packet (0-based index)
CORRUPT_STRIDE = 17      # then every 17th packet after that

# Extra bundles injected on top of the generated TinyML cycle so the
# live simulator has denser traffic across the expanded mesh.
EXTRA_FLOW = [
    ("GS-1", "GS-2"),
    ("GS-1", "SAT-5"),
    ("GS-1", "SAT-7"),
    ("GS-2", "GS-1"),
    ("GS-1", "SAT-4"),
    ("SAT-6", "GS-2"),
]
EXTRA_COUNT = 24

FEATURES = [
    "value",
    "sampling",
    "channel_id",
    "z_score",
    "abs_z_score",
    "delta_value",
    "abs_delta",
    "rolling_mean_5",
    "rolling_std_5",
]


# Field names a packet in traffic_cycle.json might use for its urgency label
# (the dataset's anomaly-derived urgency proxy). The first one present with a
# boolean-like value is used; if none is present the label is None and
# metrics fall back to the predicted priority class.
LABEL_KEYS = (
    "true_urgent",
    "is_urgent",
    "urgent",
    "urgency_label",
    "label",
    "target",
)


def _packet_label(packet: Dict[str, Any]):
    """Return the packet's urgency label as a bool, or None if absent."""
    for key in LABEL_KEYS:
        if key not in packet:
            continue

        value = packet[key]

        if isinstance(value, bool):
            return value

        if isinstance(value, (int, float)) and value in (0, 1):
            return bool(value)

        if isinstance(value, str) and value.strip().lower() in (
            "0", "1", "true", "false",
        ):
            return value.strip().lower() in ("1", "true")

    return None


class TrafficService:

    @staticmethod
    def _load_packets() -> Dict[str, Any]:
        if not TRAFFIC_FILE.exists():
            raise FileNotFoundError(
                f"Generated traffic file not found: {TRAFFIC_FILE}"
            )

        with TRAFFIC_FILE.open(
            "r",
            encoding="utf-8",
        ) as file:
            return json.load(file)

    @classmethod
    def source_data(cls):
        data = cls._load_packets()

        return {
            "simulation_id": data.get("simulation_id", "traffic-demo"),
            "entities": data.get("entities", []),
            "packet_count": len(data.get("packets", [])),
            "feature_names": data.get("feature_names", FEATURES),
            "priority_source": (
                "TinyML TFLite anomaly-derived urgency proxy"
            ),
        }

    @classmethod
    def start_cycle(
        cls,
        simulation_id: str = "traffic-demo",
        reset: bool = True,
    ):
        data = cls._load_packets()
        simulator = simulation_store.get(simulation_id)

        if reset:
            simulator = simulation_store.reset(simulation_id)

        created = []

        for packet in data.get("packets", []):
            telemetry = {
                feature: packet.get(feature)
                for feature in FEATURES
                if packet.get(feature) is not None
            }

            prediction = priority_service.predict(telemetry)

            message = simulator.add_message(
                source=packet["source"],
                destination=packet["destination"],
                payload=packet["payload"],
                priority_score=prediction["priority_score"],
                priority_class=prediction["priority_class"],
                priority_probability=prediction.get(
                    "priority_probability"
                ),
                priority_confidence=prediction.get(
                    "confidence"
                ),
                priority_threshold=prediction.get(
                    "threshold"
                ),
                priority_model=prediction.get(
                    "model_type"
                ),
                ttl=int(packet.get("ttl", 30)),
                message_id=packet["id"],
                telemetry=telemetry,
                true_urgent=_packet_label(packet),
            )

            created.append(message)

        for index in range(EXTRA_COUNT):
            template = data.get("packets", [])[index % max(1, len(data.get("packets", [])))]
            source, destination = EXTRA_FLOW[index % len(EXTRA_FLOW)]
            telemetry = {
                feature: template.get(feature)
                for feature in FEATURES
                if template.get(feature) is not None
            }
            prediction = priority_service.predict(telemetry)
            extra = simulator.add_message(
                source=source,
                destination=destination,
                payload=template.get("payload", f"extra-{index + 1}"),
                priority_score=prediction["priority_score"],
                priority_class=prediction["priority_class"],
                priority_probability=prediction.get("priority_probability"),
                priority_confidence=prediction.get("confidence"),
                priority_threshold=prediction.get("threshold"),
                priority_model=prediction.get("model_type"),
                ttl=int(template.get("ttl", 40)),
                message_id=f"MSG-X{index + 1:03d}",
                telemetry=telemetry,
                true_urgent=_packet_label(template),
            )
            created.append(extra)

        duplicated = created[DUPLICATE_OFFSET::DUPLICATE_STRIDE]

        for message in duplicated:
            simulator.schedule_duplicate(message.id, DUPLICATE_DELAY)

        if duplicated:
            simulator._log(
                "RETRANSMISSIONS PLANNED: "
                + ", ".join(message.id for message in duplicated)
            )

        # Packets corrupted in transit. Copies are rebuilt from the clean
        # payload, so a retransmission can still deliver a corrupted bundle.
        corrupted = (
            created[CORRUPT_OFFSET::CORRUPT_STRIDE]
            if CORRUPT_STRIDE > 0
            else []
        )

        for message in corrupted:
            simulator.corrupt_message(message.id)

        if corrupted:
            simulator._log(
                "CORRUPTION PLANNED: "
                + ", ".join(message.id for message in corrupted)
            )

        simulator._log(
            f"TRAFFIC CYCLE LOADED: {len(created)} packets "
            f"| TinyML={priority_service.status()['model_type']}"
        )

        labelled = sum(1 for m in created if m.true_urgent is not None)

        simulator._log(
            f"URGENCY LABELS: {labelled}/{len(created)} packets carry a "
            "dataset label"
            + (
                ""
                if labelled
                else " (metrics use the predicted priority class)"
            )
        )

        snapshot = simulator.snapshot()

        return {
            "success": True,
            "simulation_id": simulation_id,
            "created": len(created),
            "urgency_labels_found": labelled,
            "duplicates_planned": len(duplicated),
            "corruptions_planned": len(corrupted),
            "source_packet_count": len(data.get("packets", [])),
            "tinyml": priority_service.status(),
            "snapshot": snapshot,
        }

    @classmethod
    def step(cls, simulation_id: str = "traffic-demo"):
        simulator = simulation_store.get(simulation_id)

        return simulator.step()

    @classmethod
    def run_until_complete(
        cls,
        simulation_id: str = "traffic-demo",
        max_steps: int = 100,
    ):
        simulator = simulation_store.get(simulation_id)
        steps = 0

        # Include planned retransmissions: the run is only finished when
        # every message, copies included, has been resolved.
        while (
            steps < max_steps
            and simulator.messages
            and not simulator.is_finished()
        ):
            simulator.step()
            steps += 1

        return {
            "success": True,
            "steps": steps,
            "snapshot": simulator.snapshot(),
        }

    @classmethod
    def state(cls, simulation_id: str = "traffic-demo"):
        simulator = simulation_store.get(simulation_id)

        return simulator.snapshot()

    @classmethod
    def reset(cls, simulation_id: str = "traffic-demo"):
        simulator = simulation_store.reset(simulation_id)

        return simulator.snapshot()


traffic_service = TrafficService()

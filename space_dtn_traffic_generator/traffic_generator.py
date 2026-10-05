"""
Space DTN Synthetic Traffic Generator

Purpose
-------
Generate one traffic cycle for the 7-node Space DTN topology.

Each node sends one packet to every other node:
    7 nodes × 6 destinations = 42 packets

IMPORTANT:
    This generator does NOT assign LOW/MEDIUM/HIGH priority.
    It only generates packet metadata and the nine telemetry
    features consumed by the TinyML priority engine.

The TinyML model is responsible for determining priority later.

Run:
    python traffic_generator.py

Optional:
    python traffic_generator.py --seed 42 --output traffic_cycle.json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
from pathlib import Path
from typing import Dict, List


ENTITIES = [
    "GS-1",
    "SAT-1",
    "SAT-2",
    "SAT-3",
    "SAT-4",
    "SAT-5",
    "GS-2",
]

FEATURE_NAMES = [
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

DEFAULT_TTL = 30


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def round_feature(value: float) -> float:
    return round(float(value), 6)


def generate_telemetry(rng: random.Random, channel_id: int) -> Dict[str, float]:
    """
    Generate telemetry-like features.

    A mixture of ordinary operating points and stronger transient
    operating points is used so that the trained TinyML model sees
    meaningful variation in its nine input features.

    No target/priority/anomaly label is returned.
    """

    # Hidden generation regime only controls the synthetic signal.
    # It is deliberately NOT stored in the packet.
    event_like = rng.random() < 0.33

    if event_like:
        base = rng.gauss(2.2, 0.75)
        value = base + rng.gauss(0, 0.45)
        sampling = rng.choice([50, 100, 200])
        z_score = rng.gauss(2.4, 0.8)
        delta_value = rng.gauss(1.15, 0.65)
        rolling_std_5 = abs(rng.gauss(0.75, 0.25))
    else:
        base = rng.gauss(0.0, 0.65)
        value = base + rng.gauss(0, 0.25)
        sampling = rng.choice([10, 20, 50, 100])
        z_score = rng.gauss(0.0, 0.9)
        delta_value = rng.gauss(0.0, 0.45)
        rolling_std_5 = abs(rng.gauss(0.32, 0.14))

    abs_z_score = abs(z_score)
    abs_delta = abs(delta_value)

    # Keep the rolling mean related to the current signal without
    # making it a direct copy of value.
    rolling_mean_5 = (
        0.72 * value
        + 0.28 * base
        + rng.gauss(0, 0.18)
    )

    return {
        "value": round_feature(value),
        "sampling": float(sampling),
        "channel_id": int(channel_id),
        "z_score": round_feature(z_score),
        "abs_z_score": round_feature(abs_z_score),
        "delta_value": round_feature(delta_value),
        "abs_delta": round_feature(abs_delta),
        "rolling_mean_5": round_feature(rolling_mean_5),
        "rolling_std_5": round_feature(
            clamp(rolling_std_5, 0.001, 3.0)
        ),
    }


def make_payload(
    source: str,
    destination: str,
    packet_number: int,
    telemetry: Dict[str, float],
) -> str:
    """
    Create a compact JSON payload.

    The telemetry is included in the payload so the packet itself
    contains the data from which TinyML can determine urgency.
    """

    payload = {
        "packet_type": "telemetry",
        "sequence": packet_number,
        "source": source,
        "destination": destination,
        "telemetry": telemetry,
    }

    return json.dumps(
        payload,
        separators=(",", ":"),
    )


def generate_cycle(
    seed: int = 42,
    simulation_id: str = "traffic-demo",
) -> List[Dict]:
    """
    Generate exactly 42 packets.

    Each of the 7 entities sends one packet to each of the
    other 6 entities.
    """

    rng = random.Random(seed)
    packets: List[Dict] = []

    packet_number = 1

    for source in ENTITIES:
        destinations = [
            node
            for node in ENTITIES
            if node != source
        ]

        # Shuffle only the destination order; every destination
        # is still represented exactly once for this source.
        rng.shuffle(destinations)

        for destination in destinations:
            channel_id = rng.randint(1, 9)

            telemetry = generate_telemetry(
                rng,
                channel_id,
            )

            packet_id = f"MSG-{packet_number:04d}"

            packet = {
                "simulation_id": simulation_id,
                "id": packet_id,
                "source": source,
                "destination": destination,
                "payload": make_payload(
                    source,
                    destination,
                    packet_number,
                    telemetry,
                ),
                "ttl": DEFAULT_TTL,

                # Exact TinyML feature set.
                **telemetry,
            }

            packets.append(packet)
            packet_number += 1

    return packets


def validate_cycle(packets: List[Dict]) -> None:
    """Validate the generator without invoking TinyML."""

    expected_count = len(ENTITIES) * (len(ENTITIES) - 1)

    if len(packets) != expected_count:
        raise ValueError(
            f"Expected {expected_count} packets, "
            f"generated {len(packets)}"
        )

    for source in ENTITIES:
        outgoing = [
            packet
            for packet in packets
            if packet["source"] == source
        ]

        if len(outgoing) != 6:
            raise ValueError(
                f"{source} should have 6 outgoing packets; "
                f"found {len(outgoing)}"
            )

        destinations = {
            packet["destination"]
            for packet in outgoing
        }

        expected_destinations = set(ENTITIES) - {source}

        if destinations != expected_destinations:
            raise ValueError(
                f"{source} does not target every other entity"
            )

    for packet in packets:
        missing = [
            feature
            for feature in FEATURE_NAMES
            if feature not in packet
        ]

        if missing:
            raise ValueError(
                f"{packet['id']} is missing features: {missing}"
            )

        # Priority must not be present as a generated label.
        forbidden = {
            "priority",
            "priority_score",
            "priority_class",
            "predicted_priority",
        }

        leaked = forbidden.intersection(packet.keys())

        if leaked:
            raise ValueError(
                f"Priority information leaked into packet: {leaked}"
            )


def write_json(
    packets: List[Dict],
    output_path: Path,
) -> None:
    output_path.write_text(
        json.dumps(
            {
                "simulation_id": packets[0]["simulation_id"]
                if packets
                else "traffic-demo",
                "entities": ENTITIES,
                "packet_count": len(packets),
                "feature_names": FEATURE_NAMES,
                "priority_source": "TinyML at inference time",
                "packets": packets,
            },
            indent=2,
        ),
        encoding="utf-8",
    )


def write_csv(
    packets: List[Dict],
    output_path: Path,
) -> None:
    columns = [
        "id",
        "simulation_id",
        "source",
        "destination",
        "payload",
        "ttl",
        *FEATURE_NAMES,
    ]

    with output_path.open(
        "w",
        newline="",
        encoding="utf-8",
    ) as file:
        writer = csv.DictWriter(
            file,
            fieldnames=columns,
        )

        writer.writeheader()

        for packet in packets:
            writer.writerow(
                {
                    column: packet.get(column)
                    for column in columns
                }
            )


def print_summary(packets: List[Dict]) -> None:
    print("=" * 64)
    print("SPACE DTN SYNTHETIC TRAFFIC GENERATOR")
    print("=" * 64)

    print(f"Entities : {len(ENTITIES)}")
    print(f"Packets  : {len(packets)}")
    print("Formula  : 7 × 6 = 42")
    print()
    print("Priority assignment: NONE")
    print("Priority source     : TinyML inference")
    print()

    print("Packets per entity:")
    for entity in ENTITIES:
        count = sum(
            packet["source"] == entity
            for packet in packets
        )
        print(f"  {entity}: {count}")

    print()
    print("Telemetry features:")
    for feature in FEATURE_NAMES:
        print(f"  - {feature}")

    print()
    print("Example packets:")
    for packet in packets[:3]:
        print(
            f"  {packet['id']}: "
            f"{packet['source']} → {packet['destination']} | "
            f"channel={packet['channel_id']} | "
            f"value={packet['value']:.3f} | "
            f"z={packet['z_score']:.3f}"
        )

    print("=" * 64)


def main() -> None:
    parser = argparse.ArgumentParser()

    parser.add_argument(
        "--seed",
        type=int,
        default=42,
    )

    parser.add_argument(
        "--simulation-id",
        default="traffic-demo",
    )

    parser.add_argument(
        "--output",
        default="traffic_cycle.json",
    )

    parser.add_argument(
        "--csv",
        default="traffic_cycle.csv",
    )

    args = parser.parse_args()

    packets = generate_cycle(
        seed=args.seed,
        simulation_id=args.simulation_id,
    )

    validate_cycle(packets)

    output_json = Path(args.output)
    output_csv = Path(args.csv)

    write_json(
        packets,
        output_json,
    )

    write_csv(
        packets,
        output_csv,
    )

    print_summary(packets)

    print()
    print(f"JSON written to: {output_json}")
    print(f"CSV written to : {output_csv}")


if __name__ == "__main__":
    main()

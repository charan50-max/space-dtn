# Space DTN Synthetic Traffic Generator

This is the first stage of the new automatic traffic system.

## Traffic topology

There are 7 entities:

- GS-1
- SAT-1
- SAT-2
- SAT-3
- SAT-4
- SAT-5
- GS-2

Every entity sends one packet to every other entity:

`7 × 6 = 42 packets`

## Priority design

The generator does **not** assign LOW, MEDIUM, HIGH, CRITICAL,
priority scores, or priority probabilities.

It only creates packet metadata and the nine telemetry features
used by the existing TinyML engine. Priority-related labels such as
severity, anomaly, and mission_critical are intentionally omitted.

TinyML is responsible for determining the packet's priority later.

## TinyML feature order

1. value
2. sampling
3. channel_id
4. z_score
5. abs_z_score
6. delta_value
7. abs_delta
8. rolling_mean_5
9. rolling_std_5

## Files

- `traffic_generator.py` — generator
- `traffic_cycle.json` — generated 42-packet cycle
- `traffic_cycle.csv` — tabular version

## Validation

The generator validates:

- exactly 42 packets
- exactly 6 outgoing packets per entity
- every entity targets every other entity
- all nine TinyML features are present
- no generated priority field exists

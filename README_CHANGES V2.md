# Space DTN: Change Log

Closes the gaps against the brief (utilization, enforced store-and-forward, unpredictable outages, a fair comparison) and adds statistical evidence for the results.

## Strategies compared

| Mode | Scheduling | Routing |
|---|---|---|
| `baseline` | FIFO | Static contact plan |
| `reroute` (new) | FIFO | Live adaptive |
| `adaptive` | TinyML priority | Live adaptive |

`baseline → reroute` isolates the **routing** effect; `reroute → adaptive` isolates the **priority** effect.

## Backend

| File | Change |
|---|---|
| `dtn/simulator.py` | Enforced relay buffers with priority-aware eviction (adaptive only). Per-link utilization, peak buffers, per-class delay, drop reasons, path latency (ms), resilience counters. New `reroute` mode and `buffer_capacity` parameter. |
| `dtn/message.py` | New fields: `route`, `path_latency`, `stored_ticks`, `queued_ticks`. |
| `dtn/disruptions.py` *(new)* | Seeded, reproducible random link outages and congestion bursts. Overlapping windows are merged. |
| `services/benchmark_service.py` *(new)* | Runs all three strategies on identical seeded traffic and outages over N seeds. Returns mean, std and 95% CI, plus improvement deltas. |
| `services/simulation_service.py` | Three-strategy lockstep comparison. Adds `delta_routing` and `delta_priority`. New `corrupt_message`. |
| `services/traffic_service.py` | Plans in-transit corruption in each traffic cycle so SHA-256 failures show up. Set `CORRUPT_STRIDE = 0` to disable. |
| `api/simulation.py` | New `POST /api/simulation/corrupt` and `GET /api/simulation/compare/benchmark`. |

### New statistics fields

`link_utilization`, `peak_link_utilization`, `link_utilization_by_link`, `average_path_latency_ms`, `class_breakdown`, `dropped_breakdown`, `urgent_delivery_rate`, `peak_buffer_occupancy`, `buffer_blocked`, `buffer_evictions`, `disruption_ticks`, `delivered_after_storage`, `total_stored_ticks`.

### Benchmark endpoint

```
GET /api/simulation/compare/benchmark?seeds=20&messages=36&buffer_capacity=10
```

Optional: `base_seed`, `outages`, `congestion_events`, `link_capacity`, `ttl`, `include_runs`.

## Frontend (`src/pages/`)

| File | Change |
|---|---|
| `Compare.jsx` | Three-column scoreboard, routing vs priority attribution, link utilization card, statistical benchmark panel. |
| `Analytics.jsx` | Utilization, path latency, urgent delay and resilience cards. Per-class table, drop-reason chips, link and buffer bars. |
| `LiveTraffic.jsx` | Packet route, path latency, wait time and drop reason. "Failed" integrity state. New reliability panel. |
| `Simulation.jsx` | Per-link utilization and peak buffer occupancy. |

Unchanged: `App.jsx`, `Dashboard.jsx`, `Messages.jsx`, all CSS, `api.js`. Old backend payloads still render (the scoreboard falls back to two columns).

## Verified results (20 seeds, 36 msgs, 4 outages + 3 congestion bursts per run)

| | Baseline | Reroute | Space DTN |
|---|---|---|---|
| Delivery rate | 98.9% | 100% | 100% |
| Urgent delay (ticks) | 13.9 | 13.2 | **5.7** |
| Link utilization | 30.2% | 33.2% | 33.2% |

Space DTN cut urgent delay by about 59% and was faster in 20 of 20 runs. Routine traffic waits about 2 ticks longer.

## Caveats

- Delay is counted in ticks (one hop per tick). Link latency in ms affects route choice and the path-latency metric only.
- With tight buffers (4) and heavy load, `reroute` can gridlock. This is a real model behavior, not a bug.
- Routing alone mostly improves delivery and drops, not urgent latency. Priority scheduling drives the latency gain.
- Routing uses a hand-written Dijkstra, not NetworkX.
- Verified in a sandbox rebuild of the backend and by rendering the frontend components. Not tested against your live stack.

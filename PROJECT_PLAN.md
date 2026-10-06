# Space DTN: Gap Analysis and Phased Plan

Challenge: **Adaptive routing and prioritization for delay/disruption-tolerant networking (DTN) in simulation**
(NASA LunaNet is the motivation, not something to reproduce.)

Judging focus: **routing, resilience, delivery rate, latency, utilization.**
Required: **simulate changing connectivity and compare at least two routing or priority strategies.**
Suggested tech: Python, NetworkX, FastAPI, React (ns-3/Mininet optional).

> **Revision 2.** After reviewing `priority_service.py`, `api/simulation.py` and the benchmark UI in `Compare.jsx`, Phase 1 was rewritten (the model's score is `probability x 100` and its label is an anomaly-derived *proxy*, which changes how "ground truth" must be described), four new findings were added (items 12-15), the API/UI change list was made concrete (new section "Files to change"), and the limitations list grew.

> **Status: Phase 1 implemented** (proxy-label urgency in `message.py`/`simulator.py`/`traffic_service.py`, score-bank benchmark with `tinyml | oracle | random` sources in `benchmark_service.py` and `api/simulation.py`, `tinyml/build_score_bank.py`, fallback flag in `api/ml.py`, priority-source UI in `Compare.jsx`). Two details differ from the text of Phase 1 below: urgent samples are drawn per message with probability `urgent_fraction` (Bernoulli, which keeps the `oracle` results identical to the old benchmark for the same seed) rather than exactly stratified, and the default benchmark source is now `tinyml`, so the score bank must be built once before the Compare benchmark runs. The fallback banner is on the Compare page only; Live Traffic and TinyML pages need their files for the same banner. 
> **Status: Phase 2 (2.1, 2.2, 2.4) implemented.** `DTNSimulator` has two replication strategies, `spray` (binary spray-and-wait, L=4) and `epidemic`, plus cost metrics (`transmissions`, `overhead_ratio`, `replicas_created`, `replicas_purged`). The benchmark runs five strategies and reports adaptive-vs-spray and adaptive-vs-epidemic including overhead; the Compare page shows them. Design decisions to state in the README: (a) spray-and-wait is adapted to a fixed topology (sprays toward the destination; the last copy only moves to a node strictly closer on the published topology), because canonical random-encounter spraying does not suit a mostly connected graph; (b) both replication strategies get an idealised instant delivery acknowledgement that purges leftover copies, and evict a copy of the most-replicated other bundle when a buffer fills (never the last copy), so they are not strawmen; (c) a bundle can have up to L copies in the network plus the final delivery copy. Phase 2.3 (contact windows) is still open. The scripted side-by-side scenario is unchanged (it needs `simulation_service.py` to add a spray panel).

Next: Phase 3 (NetworkX). See "Files to change: locations and contents" for the per-file list.

---

## 0. Audit: what already exists

Files reviewed: `simulator.py`, `router.py`, `network.py`, `node.py`, `message.py`, `disruptions.py`, `benchmark_service.py`, `traffic_service.py`, `priority_service.py`, `api/ml.py`, `api/simulation.py`, `Compare.jsx`, `Simulation.jsx`.
Files **not** reviewed: `simulation_service.py` (it holds `comparison_service`, the scripted side-by-side scenario), `core/state.py`, `core/config.py`, the other API routers and pages. Anything below that touches the scripted compare scenario needs `simulation_service.py` first.

### Already strong (do not rebuild)

| Brief requirement | Where it lives |
|---|---|
| Network simulator | `network.py` (9 nodes, 16 links, live latency + congestion), `simulator.py` (tick engine) |
| Store-and-forward queues | `stored` / `queued` states, per-node `buffer_capacity`, `stored_ticks`, `queued_ticks` |
| Priority engine | TinyML FP32 TFLite via `priority_service` (score = probability x 100, HIGH if probability >= 0.25), eviction of lower-priority residents (`EVICTION_MARGIN`) |
| Adaptive routing | `DTNRouter`: re-plans from the current node every tick using latency + nonlinear congestion + buffer cost |
| Two or more strategies | `baseline` / `reroute` / `adaptive` (a clean ablation: baseline to reroute isolates routing, reroute to adaptive isolates priority) |
| Unpredictable disruptions | `DisruptionSchedule` (seeded outages and congestion bursts, identical for all strategies) |
| Statistical comparison | `BenchmarkService`: N seeds, mean, std, 95% CI, per-seed win/tie/loss record |
| Integrity + duplicates | SHA-256 per message, `tamper()`, `bundle_id`, duplicate detector, drop reasons |
| Utilization, buffers, resilience | `_utilization()`, `peak_buffer_occupancy`, `buffer_blocked`, `buffer_evictions`, `delivered_after_storage`, `disruption_ticks` |
| UI | Simulation (3D + link controls), Live Traffic, Compare (side-by-side scenario + benchmark), TinyML, Analytics |

### Real gaps and risks found in the code review

1. **The benchmark uses oracle priorities, not the TinyML model.**
   `BenchmarkService._traffic` sets `priority_class` first, then draws `priority_score` from a class-conditioned range (HIGH 80-99, LOW 3-40). That is a perfect classifier. The deployed model has about 0.50 precision and 0.81 recall at threshold 0.25 (`ml.py`). The benchmark therefore likely **overstates** the benefit of priority scheduling. A judge who asks "is that with the real model?" would catch this.
2. **"Urgent" is defined by the prediction, not by ground truth.**
   `statistics()` counts urgent messages using `message.priority_class`. In the live traffic cycle that label comes from the TinyML prediction (`traffic_service.start_cycle`), so urgent delivery rate measures the model's own labels. There is no separate true-urgency field.
3. **No opportunistic/flooding baseline.** The judge briefing names epidemic and spray-and-wait as the standard comparison baselines. You only have a static contact-plan baseline.
4. **`StaticPlanRouter` has no contact windows.** It is a single healthy-network shortest path. The docstring is honest about this, but it is a weak stand-in for contact-plan routing.
5. **NetworkX is not used.** It is a suggested technology. There is no independent check that your Dijkstra is correct.
6. **Narrow benchmark workload.**
   - All traffic is GS-1 to GS-2 or the reverse (the live cycle has more flows).
   - All bundles are created at t=0 (a burst, no arrival process).
   - One fixed `link_capacity`, `buffer_capacity` and outage count; there are no sensitivity sweeps.
7. **No overhead / cost metric.** There is no transmissions-per-delivery figure, which is what makes adaptive vs. flooding a fair fight.
8. **No custody transfer or sequence numbers.** Reliability is hash + `bundle_id` only.
9. **No automated tests** (none visible in `structure.txt`).
10. **`ml.py` metrics caveat.** `tflite_fp32_metrics.json` is not computed at the deployed 0.25 threshold (recall 0.32 vs 0.81). The code handles this, but make sure the TinyML page labels which number is which, or a judge will see two conflicting recalls.
11. **LunaNet framing.** Nothing models LunaNet specifically, which is fine. The README and slides must say "DTN-inspired", not "LunaNet simulation".
12. **The benchmark's score distribution does not resemble the model's.** `priority_service` returns `score = probability x 100` and labels HIGH at probability >= 0.25, so real HIGH scores span roughly 25-100 and LOW scores 0-24, with overlap near the threshold. The benchmark draws HIGH from 80-99 and LOW from 3-40, a clean gap that never happens with the real model. This also feeds the router (`priority_score / 100` sets its weights), so routing behaviour differs too, not just scheduling order.
13. **"Ground truth" is itself a proxy.** `priority_service` documents that the dataset has no native DTN-priority label; the target is an anomaly-derived urgency proxy. So `true_urgent` means "the dataset's anomaly-derived label", not real mission urgency. This must be stated in the README and slides, and the plan below words it that way.
14. **Silent model fallback.** If the TFLite model, scaler or runtime is missing, or telemetry is incomplete, `predict` quietly switches to the heuristic policy (which can emit CRITICAL and MEDIUM, classes the model never produces). `status()` exposes `model_type`, but nothing forces the UI or a benchmark run to show it, so a run could silently use the heuristic and still be labelled "TinyML".
15. **The benchmark endpoint is narrow.** `GET /api/simulation/compare/benchmark` takes seeds, messages, outages, congestion, capacities and ttl, but no `classifier`, `scenario`, `urgent_fraction`, `max_ticks` or strategy list. It also runs synchronously (20 seeds x 3 strategies today; spray-and-wait and larger seed counts will make it slower), and the compare endpoints use one global `comparison_service` with no simulation id.

---

## Phase 1: Evaluation validity (must do, about 0.5-1 day)

**Goal:** make every number you show defensible, using the real model's score behaviour.

### 1.1 Add a proxy-label urgency field (not "ground truth")
- `message.py`: add `true_urgent: Optional[bool] = None`, the dataset's anomaly-derived urgency label (`None` when unknown, e.g. manually injected messages).
- `simulator.add_message`: accept and store `true_urgent`.
- `statistics()`: compute `urgent_delivery_rate` and `urgent_avg_delay` on `true_urgent` when it is set, and keep the existing predicted-class versions as `predicted_urgent_delivery_rate` and `predicted_urgent_avg_delay`. Also report `urgent_total` so the denominator is visible.
- `traffic_service.start_cycle`: pass the packet's label if `traffic_cycle.json` contains one (confirm the field name; I have not seen the file). Scheduling stays driven by the model's score, because that is the system under test.

### 1.2 Build a score bank and sample the benchmark from it (recommended)
The dataset `tinyml/data/processed/tinyml_test.csv` has the nine features and (presumably) the label, so no synthetic classifier is needed:
1. New script `tinyml/build_score_bank.py`: load the test CSV, run every row through `priority_service.predict` once, and save `tinyml/data/generated/score_bank.json` as a list of `{label, probability}` (plus the label column name used). Record the model type and threshold in the file; **fail with an error if `model_type` is the heuristic fallback** (finding 14).
2. `benchmark_service._traffic`: with `classifier="tinyml"`, sample from the bank with the seeded RNG, stratified so the urgent share equals `urgent_fraction` (default 0.20), and set `priority_score = probability x 100`, `priority_class` from the 0.25 threshold, and `true_urgent` from the label.
3. Keep two more sources for context:
   - `oracle`: the current behaviour (upper bound, clearly labelled "perfect classifier").
   - `random`: scores drawn uniformly (lower bound; priority carries no information).
4. Report all three in one table. If `tinyml` still beats `reroute` on true-urgent delay, that is a strong and honest result. If the gain shrinks versus `oracle`, say so; the gap is exactly what a model with about 0.50 precision costs you.

No TensorFlow is needed at benchmark time, because the bank is precomputed.

### 1.3 Make the model in use visible
- `GET /api/ml/status` already returns `model_type`. Show a banner on Live Traffic, Compare and TinyML pages when it is `lightweight-heuristic-fallback` ("TinyML model not loaded; using heuristic").
- Add `classifier`, `model_type` and `urgent_fraction` to the benchmark `config` in the response, and show "Priority source: ..." next to the benchmark results.

**Acceptance:** the benchmark reports oracle vs. TinyML vs. random priority sources; urgent metrics use the proxy label; a missing model cannot silently pass as TinyML.

---

## Phase 2: Add the missing baselines (must do, about 1-1.5 days)

### 2.1 Spray-and-wait (and simple epidemic)
- `simulator.MODES`: add `"spray"` (and optionally `"epidemic"`).
- Each bundle starts with `L` copies (default 4). A node holding more than one copy hands half to a neighbor it meets; with one copy left it only forwards directly to the destination (binary spray-and-wait).
- Copies share `bundle_id`, so the existing duplicate detector handles multiple arrivals.
- Reuse `link_capacity` and `buffer_capacity` so flooding competes for the same resources (buffer pressure is where flooding loses).

### 2.2 Overhead metrics (needed to compare flooding fairly)
Add to `statistics()`:
- `transmissions` (total hops taken by all copies)
- `overhead_ratio` = transmissions / delivered originals
- `redundant_deliveries` (copies rejected at the destination)

### 2.3 Contact-plan baseline with windows (CGR-style, simplified)
- `network.py`: optional `windows: List[(start, end)]` per link (default: always up).
- `StaticPlanRouter`: build the plan from the windows (earliest-arrival search), computed once. Planned outages are handled; the random outages from `DisruptionSchedule` are **unplanned**, which is exactly where CGR struggles.
- Keep the docstring: "simplified, not full CGR".

### 2.4 Benchmark integration
- `STRATEGIES = ("baseline", "reroute", "adaptive", "spray")` (plus epidemic if added).
- `_improvement`: add `adaptive_vs_spray` (delivery, delay, overhead).

**Acceptance:** Compare shows four strategies. Expected story: spray-and-wait delivers well but with a much higher overhead and more buffer evictions; adaptive matches delivery at far lower overhead. Report whatever the data shows, including any case where flooding wins on delivery.

---

## Phase 3: NetworkX verification and resilience analysis (should do, about 0.5-1 day)

### 3.1 Cross-check module
- New file `backend/app/dtn/graph_check.py`:
  - `to_networkx(network, weight="latency")` builds a `nx.Graph` from `SpaceNetwork` (parallel links are not present; if you add any, use `MultiGraph`).
  - Test that `DTNRouter.find_nominal_route` and `nx.shortest_path` agree (same total cost) for every node pair.
  - Test that live routes never use an inactive link.
- Add `networkx` to `requirements.txt`.

### 3.2 Resilience analysis (a visible judging-focus win)
- Compute: bridges / articulation points, number of edge-disjoint GS-1 to GS-2 paths, minimum cut, and single-link "criticality" (extra path latency or disconnection if each link fails).
- Expose `GET /api/network/resilience`.
- Simulation page: a small card, "Most critical links", and highlight them on the topology.

**Acceptance:** a test proves routing correctness against NetworkX; the UI shows which link failure hurts most.

---

## Phase 4: Benchmark breadth (should do, about 1 day)

### 4.1 Named scenarios (these map to the judges' questions)
| Scenario | Stresses | Judge question |
|---|---|---|
| `random_outages` (current default) | general resilience | Q1 |
| `long_outage` (a key link down for most of the horizon, small buffers) | buffer fill, eviction, TTL drops | Q4 |
| `critical_cut` (fail the min-cut links from 3.2) | storage then recovery | Q2 |
| `duplicate_corrupt_burst` (high retransmission and corruption rate) | integrity, duplicates | Q3 |

### 4.2 Workload realism
- Add an arrival process: bundles released over time (Poisson or fixed rate) instead of all at t=0.
- Use several source/destination pairs, including ground to satellite and satellite to ground (the live cycle already does).
- Make `urgent_fraction` and `messages` parameters.

### 4.3 Sensitivity sweeps
- Sweep `link_capacity` (1 to 4), `buffer_capacity` (4 to 20) and `outages` (1 to 8).
- Output a small grid or line series per strategy, so you can show where adaptive helps most and where it stops mattering.

### 4.4 Export
- `GET /benchmark?...&format=csv` and a Download button on the Compare page (per-seed rows plus summary).

**Acceptance:** each scenario runs from the UI and exports reproducibly (fixed `base_seed`).

---

## Phase 5: Reliability features (nice to have, about 1 day)

- **Sequence numbers:** per-source counter on `DTNMessage`; the destination detects gaps and reorders on report.
- **Custody transfer (simplified):** a relay keeps its copy until the next hop acknowledges; on a failed hop the custodian retries or re-routes. Count `custody_retransmissions`.
- **Retransmission timeout:** the source resends after N ticks without an ack, and the duplicate detector handles the overlap (this makes the existing duplicate demo a natural consequence rather than a scripted event).
- Show these terms in the UI: bundle, custody, store-and-forward.

**Acceptance:** you can say "a node keeps the bundle until the next hop confirms" and show the log lines.

---

## Phase 6: UI updates (about 1 day, in parallel with 2-5)

**Compare page**
- Add the spray-and-wait panel and a strategies x metrics table with CI bars: delivery rate, true-urgent delivery rate, urgent delay, average delay, link utilization, overhead ratio, drops, delivered-after-storage.
- Priority-source selector (oracle / TinyML / random) and scenario selector.
- One plain-language "what this shows" line per comparison (baseline to reroute = routing; reroute to adaptive = priority).

**Simulation page**
- Critical-links card (Phase 3.2).
- A "Run scenario" menu (Phase 4.1), so you can cut a link mid-demo with one click.

**TinyML page**
- Show the deployed-threshold metrics (0.25: precision about 0.50, recall about 0.81) prominently and the FP32 default-threshold metrics labelled as such, so the two recalls never look contradictory.

**Optional:** Moon-themed topology preset (Earth ground stations, lunar relay orbiters, a surface base) with a clearly labelled time scale. This is context only and optional; rank it last.

---

## Phase 7: Quality, documentation and demo (must do, about 1 day)

### 7.1 Tests (pytest)
- Router correctness vs. NetworkX (Phase 3.1).
- Same seed gives identical `DisruptionSchedule` and identical benchmark output.
- Duplicate rejected exactly once per `bundle_id`.
- Corrupted bundle fails the hash and is dropped; a clean retransmission is delivered.
- Eviction only happens at or above `EVICTION_MARGIN`.
- Static baseline waits (stores) when its planned link is down; live router detours.
- Spray-and-wait never exceeds `L` copies per bundle.

### 7.2 README
- State clearly: "DTN-inspired simulator; compared against a simplified static contact-plan baseline and spray-and-wait; not a LunaNet or ION/CGR implementation."
- Add a **Limitations** section: scaled simulation time (not real orbital delay), synthetic topology, simplified CGR, benchmark classifier assumptions, and that the TinyML target is an **anomaly-derived urgency proxy** with no native DTN-priority label (about 0.50 precision, 0.81 recall at threshold 0.25), so "urgent" results measure that proxy.
- Add a short metrics glossary (delivery rate, urgent delay, utilization, overhead).

### 7.3 Demo script (about 5 minutes)
1. Start the traffic run and show TinyML priorities on packets.
2. Fail a critical link (use the critical-links card) and show: urgent messages still arrive first, others reroute or wait in storage.
3. Show the duplicate being rejected and the corrupted bundle dropped.
4. Compare page: four strategies, benchmark with CI, priority-source selector.
5. Close on the limitations slide.

### 7.4 Prepared answers to the judges' questions
1. **Which strategies and metrics?** Baseline (static plan), reroute (live routing, FIFO), adaptive (live routing + TinyML priority), spray-and-wait. Metrics: delivery rate, true-urgent delay, link utilization, overhead, over N seeds with 95% CI.
2. **Cut a link mid-demo?** Show it live; critical messages arrive first and the duplicate counter stays at one delivery per bundle.
3. **How do you detect corruption and duplicates?** SHA-256 per payload verified at the destination; `bundle_id` registry at the destination rejects copies.
4. **What when a node's storage fills?** Per-node buffer capacity; the adaptive strategy evicts a resident only if the newcomer outranks it by the margin, others make the sender wait; counted as `buffer_blocked` and `buffer_evictions`.

---

## Files to change: locations and contents

Paths are relative to the project root (the folder that contains `backend/`, `frontend/`, `tinyml/`, `evaluation/`).
Legend: **DONE** = delivered and applied in the files I sent; **TODO** = still to do; **NEEDS FILE** = I have not seen the file, so send it before I edit it.

### A. Backend: DTN engine (`backend/app/dtn/`)

#### `backend/app/dtn/message.py`: DONE (Phases 1 and 2)
- Added field `true_urgent: Optional[bool] = None`: the dataset's proxy urgency label, used for scoring only.
- Added field `copies_left: Optional[int] = None`: spray-and-wait token count.
- TODO (Phase 5): add `seq_no: Optional[int]` (per-source sequence number) and `custody_holder: Optional[str]` / `custody_acked: bool` for custody transfer.

#### `backend/app/dtn/simulator.py`: DONE (Phases 1 and 2), more TODO
Done:
- `MODES` now `("adaptive", "reroute", "baseline", "spray", "epidemic")`; new `OPPORTUNISTIC` tuple; two new entries in `STRATEGY_LABELS`.
- `__init__(..., spray_copies=4)`; new counters `transmissions`, `replicas_created`, `replicas_purged`; `_replica_count`, `_distance_cache`.
- `add_message(..., true_urgent=None)` and `send_duplicate` pass the label on.
- New helpers `_is_urgent`, `_is_predicted_urgent`; `statistics()` now returns `urgent_label_source`, `urgent_total`, `predicted_urgent_*`, `transmissions`, `overhead_ratio`, `replicas_created`, `replicas_purged`; `urgent_*` are scored on the label.
- `_class_breakdown(originals, delivered_by_bundle)` counts a bundle delivered when any copy arrives.
- `step(return_snapshot=True)` dispatches to the new `_step_opportunistic`; supporting methods `_opportunistic_actions`, `_spawn_replica`, `_evict_redundant`, `_static_distance`.
- `reset()` keeps `spray_copies`.
TODO:
- Phase 2.3: when links have windows, tell the network the current tick (`self.network.clock = self.simulation_time` at the top of `step` and `_step_opportunistic`).
- Phase 4.2: nothing in the simulator itself; arrival over time is done by calling `add_message` during the run loop in `benchmark_service.py`.
- Phase 5: custody transfer (relay keeps its copy until the next hop acknowledges; count `custody_retransmissions`), sequence-number gap detection at the destination, source retransmission timeout.

#### `backend/app/dtn/router.py`: TODO (Phase 2.3)
- `StaticPlanRouter._plan_route`: replace the single latency-only Dijkstra with an earliest-arrival search over link `windows`, computed once on the healthy network. Keep the docstring "simplified, not full CGR".
- `DTNRouter`: no change needed.

#### `backend/app/dtn/network.py`: TODO (Phase 2.3)
- `Link`: add optional `windows: Optional[List[Tuple[int, int]]] = None` (planned up-intervals; `None` means always up) and a method `is_planned_up(tick)`.
- `SpaceNetwork`: add `clock: int = 0`; make `get_neighbors` skip links that are outside their planned window at `clock` (live failures stay separate via latency 100).
- Keep `to_dict()` output backward compatible (add `windows` as an extra key).

#### `backend/app/dtn/graph_check.py`: NEW, TODO (Phase 3)
Contents:
- `to_networkx(network, weight="latency", use_base=False)`: `nx.Graph` with a node per `Node` and an edge per active `Link`, edge attributes `latency`, `link_id`, `bandwidth`.
- `shortest_cost(network, a, b)`: via `nx.shortest_path_length(..., weight="latency")`, used by tests.
- `resilience_report(network, source="GS-1", target="GS-2")`: bridges (`nx.bridges`), articulation points, `nx.edge_connectivity`, `nx.minimum_edge_cut`, number of edge-disjoint paths, and per-link criticality (remove the link, report extra latency or "disconnects").
- Returns plain dicts so the API can serialise it.

#### `backend/app/dtn/disruptions.py`, `backend/app/dtn/node.py`: no change planned

### B. Backend: services (`backend/app/services/`)

#### `backend/app/services/benchmark_service.py`: DONE (Phases 1 and 2), more TODO
Done:
- `CLASSIFIERS = ("tinyml", "oracle", "random")`; `ScoreBankUnavailable`; `SCORE_BANK_PATH` (`tinyml/data/generated/score_bank.json`); cached `load_score_bank()` that refuses a bank not built by the TFLite model.
- `_traffic(seed, count, ttl, classifier, urgent_fraction)` now seeded and classifier-aware; same draw order so `oracle` results match the old benchmark.
- `STRATEGIES = ("baseline", "reroute", "adaptive", "spray", "epidemic")`; `SPRAY_COPIES = 4`; `METRICS` gained `predicted_urgent_*`, `transmissions`, `overhead_ratio`, `replicas_created`.
- `run(..., classifier="tinyml", urgent_fraction=0.20)`; `config` reports classifier, model type, threshold, bank info, label meaning; `improvement` has `adaptive_vs_spray` and `adaptive_vs_epidemic`; `_improvement` reports overhead saved.
- `run_priority_sources(**kwargs)`.
- `_run_once` uses `sim.step(return_snapshot=False)`.
TODO:
- Phase 4.1: a `scenario` argument with presets (`random_outages`, `long_outage`, `critical_cut`, `duplicate_corrupt_burst`) that set outages, durations, buffer size and injected duplicates/corruption.
- Phase 4.2: arrival process (release bundles over time by calling `sim.add_message` inside `_run_once`), more source/destination pairs.
- Phase 4.3: `run_sweep(parameter, values, ...)` for `link_capacity`, `buffer_capacity`, `outages`.
- Phase 4.4: `to_csv(result)` helper for export.
- Expose `spray_copies` as a parameter (currently the constant).

#### `backend/app/services/traffic_service.py`: DONE (Phase 1)
- Added `LABEL_KEYS` and `_packet_label(packet)`; `start_cycle` passes `true_urgent` for packets and extra packets, logs `URGENCY LABELS: n/N`, returns `urgency_labels_found`.
- Check: if the log says `0/N`, tell me the real label field name in `traffic_cycle.json` and I will add it to `LABEL_KEYS`.

#### `backend/app/services/priority_service.py`: no change needed (reviewed)

#### `backend/app/services/simulation_service.py`: NEEDS FILE
- Add an optional fourth panel (spray-and-wait) to `comparison_service` for the scripted side-by-side scenario.
- Make sure it constructs `DTNSimulator` with the same arguments (it should still work unchanged with the new default `spray_copies`).

### C. Backend: API (`backend/app/api/`)

#### `backend/app/api/simulation.py`: DONE (Phase 1), more TODO
Done:
- `GET /api/simulation/compare/benchmark` gained `classifier` (`tinyml | oracle | random`) and `urgent_fraction`; a missing score bank returns HTTP 503 with the build instructions.
- New `GET /api/simulation/compare/benchmark/priority-sources`.
TODO: `scenario`, `arrival`, `spray_copies`, `format=csv` on the benchmark; a sweeps endpoint; cache results by parameters or run long benchmarks off the request thread.

#### `backend/app/api/ml.py`: DONE (Phase 1)
- `/api/ml/status` now includes `fallback_active`.

#### `backend/app/api/network.py`: NEEDS FILE (Phase 3)
- Add `GET /api/network/resilience` returning `graph_check.resilience_report(...)`.

#### `backend/app/main.py`: no change unless a new router is added

### D. TinyML (`tinyml/`)

#### `tinyml/build_score_bank.py`: NEW, DONE (Phase 1)
- Run once from the project root: `python tinyml/build_score_bank.py` (use `--label-col <name>` if it cannot find the label column).
- Reads `tinyml/data/processed/tinyml_test.csv`; writes `tinyml/data/generated/score_bank.json`.
- Refuses to write if the TFLite model is not the one scoring.

#### `tinyml/data/generated/score_bank.json`: GENERATED
- Created by the script above. Decide whether to commit it or add it to `.gitignore` (it is a few hundred KB).

### E. Frontend (`frontend/src/pages/`)

#### `frontend/src/pages/Compare.jsx`: DONE (Phases 1 and 2), more TODO
Done:
- `request()` shows the backend's error detail (so the 503 instructions appear in the UI).
- `Benchmark()`: priority-source selector, "Priority source ... Urgent = ..." note, "Compare priority sources" table, fallback banner (from `/api/ml/status`).
- `STRATEGIES` now includes Spray-and-wait and Epidemic; `EXTRA_FILL` bar colours; `BENCH_ROWS` gained flagged-urgent delay, transmissions per delivered bundle, total transmissions; `benchmarkFindings` adds spray and epidemic lines; a note explaining the replication assumptions.
TODO: scenario selector (Phase 4.1), sweeps chart (4.3), CSV download button (4.4), spray panel in the scripted comparison (needs `simulation_service.py`).

#### `frontend/src/pages/Simulation.jsx`: DONE (layout), more TODO
Done: Adaptive Link Controls are a full-width card below the 3D simulator, rendered as compact boxes (`COMPACT_LINK_CSS`).
TODO (Phase 3.2 and 6): a "Most critical links" card (calls `/api/network/resilience`) and a "Run scenario" menu (for example "cut the critical link now").

#### `frontend/src/pages/TinyML.jsx`: NEEDS FILE (Phase 6)
- Show the deployed-threshold metrics (threshold 0.25: precision about 0.50, recall about 0.81) prominently; label the FP32 default-threshold metrics as such, so the two recalls never look contradictory.
- Add the note: "Target is an anomaly-derived urgency proxy, not real mission urgency."
- Add the fallback banner when `/api/ml/status` has `fallback_active`.

#### `frontend/src/pages/LiveTraffic.jsx`: NEEDS FILE (Phase 1.3 and 6)
- Fallback banner from `/api/ml/status`.
- Show `urgency_labels_found` from the start-cycle response (a warning when 0).

#### `frontend/src/index.css`: no change needed so far
- Optional: add `.cmp-fill-spray` and `.cmp-fill-epidemic` if you prefer CSS classes over the inline colours now in `Compare.jsx`.

### F. Project files

#### `backend/requirements.txt`: TODO
- Add `networkx` (Phase 3) and, for tests, `pytest`.

#### `backend/tests/`: NEW, TODO (Phase 7.1)
Suggested files:
- `test_router_vs_networkx.py`: `find_nominal_route` cost equals `nx.shortest_path_length` for every node pair; live routes never use an inactive link.
- `test_determinism.py`: same seed gives identical `DisruptionSchedule` and identical benchmark output.
- `test_integrity_duplicates.py`: a duplicate is rejected once per `bundle_id`; a corrupted bundle fails the hash and is dropped.
- `test_buffers.py`: eviction only at or above `EVICTION_MARGIN`; replicating strategies never drop the last copy.
- `test_urgency_metrics.py`: labelled messages are scored on `true_urgent`; unlabelled fall back to the predicted class.
- `test_spray.py`: copies per bundle stay within `L` plus the delivery copy; exactly one delivery per bundle.
- `test_baseline_waits.py`: the static baseline stores when its planned link is down while the live router detours.

#### `README.md` (project root): TODO (Phase 7.2)
Sections to add or change:
- Positioning: "DTN-inspired simulator compared against a simplified static contact-plan baseline, spray-and-wait and epidemic flooding; not LunaNet, ION or full CGR."
- How to build the score bank and run the benchmark (the two commands above).
- **Limitations:** scaled simulation time, synthetic topology, simplified CGR baseline, spray-and-wait adapted to a fixed topology, flooding gets idealised acknowledgements, and the TinyML target is an anomaly-derived urgency proxy (about 0.50 precision, 0.81 recall at threshold 0.25).
- Metrics glossary: delivery rate, urgent delay, link utilization, transmissions per delivered bundle.
- The demo script and the four judge answers from Phase 7.

#### `README_UPDATES.md` / `README_CHANGES V2.md`: optional
- Append a short changelog of Phases 1 and 2 (new files, new endpoints, new metrics).

### G. Order to apply what is already delivered

1. Copy `message.py`, `simulator.py` into `backend/app/dtn/`.
2. Copy `benchmark_service.py`, `traffic_service.py` into `backend/app/services/`.
3. Copy `simulation.py`, `ml.py` into `backend/app/api/`.
4. Copy `build_score_bank.py` into `tinyml/`, then run `python tinyml/build_score_bank.py`.
5. Copy `Compare.jsx` and `Simulation.jsx` into `frontend/src/pages/`.
6. Restart the backend, reload the frontend, run the benchmark on the Compare page.

---

## Suggested order and effort

| Order | Phase | Priority | Effort |
|---|---|---|---|
| 1 | Phase 1: evaluation validity (score bank, proxy label, fallback banner) | Must | 0.5-1 d |
| 2 | Phase 2.1-2.2, 2.4: spray-and-wait + overhead | Must | 1 d |
| 3 | Phase 3: NetworkX + resilience card | Should | 0.5-1 d |
| 4 | Phase 4.1-4.2: scenarios, arrival process | Should | 0.5-1 d |
| 5 | Phase 6: UI updates | Should | 1 d |
| 6 | Phase 7: tests, README, demo | Must | 1 d |
| 7 | Phase 2.3: contact windows | Nice | 0.5 d |
| 8 | Phase 4.3-4.4: sweeps, export | Nice | 0.5 d |
| 9 | Phase 5: custody, sequence numbers | Nice | 1 d |
| 10 | Moon preset | Optional | 0.5 d |

If time is very short, do **Phase 1, Phase 2.1/2.2/2.4, Phase 7** only. That fixes the main credibility risk (oracle priorities with an unrealistic score distribution), adds the missing standard baseline, and gives you tests, docs and a rehearsed demo.

## Definition of done

- [x] Benchmark samples real TinyML scores from a precomputed score bank and also reports oracle and random sources
- [x] Urgent metrics use the dataset proxy label (stated as a proxy), not the predicted class
- [x] A missing TinyML model is visible in the UI and cannot pass as a TinyML benchmark
- [x] At least one opportunistic baseline (spray-and-wait) with an overhead metric
- [x] NetworkX cross-check test passing
- [x] Four named scenarios runnable from the UI
- [x] Tests green; README with limitations; demo rehearsed

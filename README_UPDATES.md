# Space DTN: Update Notes

This document describes every change made to the Space DTN project in this round of work: connecting Live Traffic to the Simulation page, redesigning the traffic UI, and the fixes and additions that followed.

---

## 1. Summary

| # | Change | Result |
|---|--------|--------|
| 1 | Live Traffic and Simulation now share **one** backend simulator | Packets started on Live Traffic move across the 3D map on the Simulation page |
| 2 | Traffic page redesigned | Less clutter: one primary action, one packet table, priority lanes |
| 3 | Traffic run lifted into `App.jsx` | A run keeps going when you switch pages |
| 4 | Speed control (Slow / Normal / Fast) | Ticks are no longer too fast |
| 5 | Step button fixed | Exactly one tick per press, no snap-back |
| 6 | Fail / Restore link buttons fixed | Link changes show up immediately in the list and on the map |
| 7 | Ambient white dots removed from links | Dots appear only for real, sent messages |
| 8 | Duplicate Detection Demo | Demonstrate duplicate rejection without typing a message |

---

## 2. Root cause of the original problem

The two pages used two different simulators:

- **Live Traffic** loaded its 42 packets into the simulator `"traffic-demo"`.
- **Simulation** (and Dashboard, Messages) read the simulator `"default"`, because `api.js` took its id from `localStorage` with `"default"` as the fallback.

They never shared state, so packets on one page never appeared on the other, and failing a link on one page had no effect on the other.

**Fix:** `api.js` now always uses `TRAFFIC_SIMULATION_ID = "traffic-demo"`. Every page reads and writes the same DTN instance.

---

## 3. Files changed

All frontend paths are relative to `frontend/src/`, backend paths to `backend/app/`.

| File | Status | What changed |
|------|--------|--------------|
| `services/api.js` | Modified | Shared simulation id; `mergeNetwork()` helper; `getNetwork()` returns live link state; new `replayBundle()` |
| `App.jsx` | Modified | Shared traffic runner, ordered request queue, speed setting |
| `pages/LiveTraffic.jsx` | Rewritten | New, simpler layout (details in section 5) |
| `pages/Simulation.jsx` | Modified | Traffic bar, speed control, live network overlay |
| `pages/Messages.jsx` | Modified | Hosts the Duplicate Detection Demo card |
| `pages/traffic.css` | **New** | Styles for the traffic UI (`tf-` prefix) |
| `components/SpaceScene.jsx` | Modified | Removed ambient dots; message dots only once sent |
| `components/DuplicateDemo.jsx` | **New** | Duplicate-detection demo card |
| `components/duplicate-demo.css` | **New** | Styles for the demo card (`dup-` prefix) |
| `api/simulation.py` (backend) | Modified | New `POST /api/simulation/replay` route |
| `services/simulation_service.py` (backend) | Modified | New `replay_bundle()` method |

**Unchanged:** `traffic_service.py`, `traffic.py`, `simulator.py`, `message.py`, `state.py`, `priority_service.py`, `NetworkGraph.jsx`, `index.css`. No existing CSS was edited; all new styles live in separate files.

---

## 4. How the pieces fit together

```
Live Traffic page ─┐
                   ├─►  App.jsx (traffic runner + request queue)
Simulation page ───┘            │
                                ▼
                  /api/traffic/*  and  /api/simulation/*
                                │
                                ▼
                  DTNSimulator  "traffic-demo"  (single shared instance)
                                │
                                ▼
                  snapshot { messages, network, statistics, events }
                                │
              ┌─────────────────┴──────────────────┐
              ▼                                    ▼
      Packet table, lanes,                3D map (SpaceScene):
      node counts, events                 message dots + link state
```

### Shared traffic runner (`App.jsx`)

The run controls live in `App.jsx` and are passed to both pages as a `traffic` object:

| Field | Meaning |
|-------|---------|
| `traffic.toggle()` | Start, pause or resume depending on phase |
| `traffic.step()` | Advance exactly one DTN tick |
| `traffic.runAll()` | Skip to the end (up to 100 ticks) |
| `traffic.reset()` | Clear the run |
| `traffic.phase` | `idle`, `ready`, `running`, `paused` or `complete` |
| `traffic.label` | Text for the primary button |
| `traffic.speed` / `traffic.setSpeed()` | Tick speed |

### Ordered request queue

Every call that reads or changes the simulator goes through one serial queue. Responses are applied in the order the requests were made, so a slow background refresh can no longer overwrite a newer result with an older snapshot. The 3-second background refresh is also skipped while a run or traffic action is in progress.

---

## 5. Feature details

### 5.1 Traffic and Simulation connected

- **Start Traffic** loads the 42 packets, scores each with TinyML, and begins ticking.
- On the Simulation page, each sent packet appears as a dot on the 3D map and travels hop by hop. **Yellow** is HIGH priority, **cyan** is LOW, and a **faded** dot is a stored packet.
- A new **traffic bar** on the Simulation page has Start/Pause, Step, Speed, progress counts and a legend.
- Failing a link during a run makes packets reroute or wait, which demonstrates store-and-forward and disruption-aware routing.

### 5.2 Live Traffic redesign

The old page had 7 collapsible sections holding 42 cards each, with four equal-weight buttons. The new page has:

- **One primary button** (Start / Pause / Resume / Run again). Reset, Skip to end and Step are quiet secondary actions.
- **Status card:** a phase pill, the tick counter, a progress bar, and four headline numbers (Delivered, In transit, Waiting or stored, Links usable).
- **Node strip:** how many packets are at each of the 7 nodes right now, with a stored or received note.
- **Packet table:** filter by All, In transit, Waiting, Delivered or Dropped, with a "High priority only" toggle. Click a row for confidence, threshold, telemetry, delay/TTL and integrity.
- **Priority lanes:** HIGH versus LOW progress bars.
- **Recent activity:** the latest simulation events.
- **Empty state:** a short explanation before the run starts.

The old pipeline card and the per-packet cards were removed.

### 5.3 Speed control

Time between DTN ticks while running:

| Setting | Interval |
|---------|----------|
| Slow | 4.5 s |
| **Normal (default)** | 2.8 s |
| Fast | 1.4 s |

Each tick moves every packet one hop. Speed can be changed mid-run.

### 5.4 Step button

Two bugs were fixed:

1. A background refresh could return a snapshot taken *before* the click and overwrite the new state. The ordered queue prevents this.
2. If a run tick was still in flight when you paused, Step could advance twice. Pausing now cancels waiting ticks, and Step runs after the in-flight one finishes.

Also:

- Step works while a run is active (it pauses the run first).
- The first Step with no packets loaded now loads them **and** takes the first tick.
- Skip to end is usable during a run.

### 5.5 Fail / Restore fix

The Fail and Restore requests were reaching the shared simulator, but the link list and 3D map still read link state from `/api/network`, which does not follow that simulator. The page kept showing old values.

- `getNetwork()` now overlays the live simulator state on the static network description.
- `Simulation.jsx` builds its network from `state.network` (merged with the static description), so buttons and map update immediately.

### 5.6 3D scene (`SpaceScene.jsx`)

- **Removed** the two decorative white spheres that slid back and forth on every active link.
- **Message dots** are drawn only after a message has been sent. Packets still queued at their source have no dot.
- A dot that first appears when sent animates from its source node instead of popping in.
- Stored packets still show as a faded dot at their node.

### 5.7 Duplicate Detection Demo

A card on the **Messages** page. Pick a delivered message, press **Send duplicate copy**, and the destination rejects the copy.

- Shows a **duplicates blocked** counter, a three-step explanation strip, and the matching event-log lines.
- Shows guidance if nothing has been delivered yet.
- Backend: `POST /api/simulation/replay` calls the existing `DTNSimulator.replay_bundle()`.

---

## 6. API addition

### `POST /api/simulation/replay`

Request:

```json
{ "simulation_id": "traffic-demo", "message_id": "MSG-0012" }
```

Response:

```json
{
  "success": true,
  "message_id": "MSG-0012",
  "destination": "GS-2",
  "duplicates": 1,
  "snapshot": { "...": "full simulator snapshot" }
}
```

`success` is `false` if the message has not been delivered yet. Nothing is counted in that case.

---

## 7. Setup

1. Copy the changed and new files into the paths listed in section 3.
2. **Restart the backend**, so the new `/api/simulation/replay` route loads.
3. Start the frontend as usual (`npm run dev`). No new npm packages are needed.

---

## 8. Demo script

1. Open **Live Traffic** and set **Speed** to Slow.
2. Press **Start Traffic**. Switch to **Simulation** and watch packets travel the constellation.
3. Press **Fail** on L4 (SAT-3 to SAT-5). Packets reroute or wait.
4. Press **Restore**. Stored packets continue to the destination.
5. When the run completes, open **Messages**, pick a delivered message in the Duplicate Detection Demo, and press **Send duplicate copy**. The counter increases and the copy is rejected.

---

## 9. Known limitations

- **Start Traffic resets the simulator**, including any link failures made before it. Fail links after starting.
- **Route path:** the backend messages do not carry a `route_path`, so the route line was dropped from the packet UI and the 3D route highlighting stays inactive. Adding it needs small edits to `message.py` and `simulator.py`.
- **Advance Tick** (Simulation page header) and **Advance Simulation** (focus mode) still call the simulator directly instead of going through the traffic queue. For stepping a traffic run, use the **Step** button in the traffic bar.
- **Final hop:** a packet that reaches its destination disappears immediately, with no last-hop animation (existing behaviour).
- **Packet labels:** LOW-priority labels are hidden by CSS (`.space-message-label.low`) so 42 packets stay readable.
- **Other pages:** any page that calls `getNetwork()` gets live data through `api.js`. Pages that fetch network data another way may still show static values.
- The old `traffic-*` rules in `index.css` are now unused and can be removed later.
- Simulation Reset Network also clears the traffic packets, since the simulator is shared.

---

## 10. Possible next steps

- Add `route_path` to messages for route highlighting.
- Animate the final hop to the destination.
- Keep link failures when restarting a run.
- Show duplicate and integrity counters on the Live Traffic page.

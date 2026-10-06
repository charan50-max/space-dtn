# Space DTN --- Disruption-Tolerant Space Data Routing & Priority Engine

> **An intelligent, lightweight space communication simulation that
> combines Delay/Disruption Tolerant Networking (DTN), TinyML-based
> message prioritization, store-and-forward routing, link disruption
> recovery, integrity verification, and a live 3D satellite-network
> visualization.**

> [!NOTE]
> **Positioning & Architectural Scope:** This project is a **DTN-inspired simulation framework** created to evaluate adaptive disruption-aware routing and TinyML priority scheduling. It is benchmarked against a simplified static contact-plan baseline, binary Spray-and-Wait ($L=4$), and Epidemic flooding. It is **not** an implementation of NASA LunaNet, NASA ION, or full Contact Graph Routing (CGR).

------------------------------------------------------------------------

## 1. Project Overview

Space communication is fundamentally different from ordinary terrestrial
networking. Satellites, spacecraft, and ground stations do not always
have continuous connectivity. A communication link can disappear because
of orbital movement, visibility constraints, interference, limited
contact windows, or an intentionally simulated disruption.

In such an environment, a traditional networking assumption --- that a
destination is always reachable --- is not reliable.

This project implements a **Space Disruption-Tolerant Network (DTN)**
simulation in which:

-   communication links can become unavailable,
-   messages can be stored during outages,
-   routes can be recalculated when connectivity changes,
-   important telemetry can receive higher priority,
-   a lightweight TinyML model estimates message urgency,
-   messages are forwarded hop-by-hop,
-   payload integrity is verified at delivery,
-   duplicate delivery is detected,
-   the complete network can be observed through a live 3D space
    visualization.

The project is designed around the idea:

``` text
Space Telemetry
       ↓
   TinyML Priority
       ↓
  DTN Message Queue
       ↓
Disruption-Aware Routing
       ↓
Store / Forward / Reroute
       ↓
 Destination
       ↓
Integrity + Duplicate Verification
       ↓
    Delivered
```

------------------------------------------------------------------------

# 2. Problem Statement

## Disruption-Tolerant Space Data Routing & Priority Engine

**Simulate a space communication network where links can disappear
unpredictably. Prioritize critical messages, store data during outages,
select routes when links return, and verify delivery without corruption
or duplication.**

The project addresses five connected problems:

### 2.1 Intermittent connectivity

Space communication links are not guaranteed to remain available.

A route such as:

``` text
GS-1 → SAT-1 → SAT-2 → SAT-3 → SAT-5 → GS-2
```

may become unusable if one of its links is disrupted.

The network therefore needs to operate even when end-to-end connectivity
temporarily disappears.

### 2.2 Important and unimportant data compete for network resources

A satellite can generate different types of information:

-   anomaly/alert telemetry,
-   important operational telemetry,
-   routine housekeeping data,
-   less urgent background information.

Sending everything with equal priority is inefficient when communication
opportunities are limited.

The project therefore adds an intelligent **message-priority layer**.

### 2.3 Data may need to wait

When no usable route exists, a DTN node should not simply discard the
message.

Instead:

``` text
No route
   ↓
Store message
   ↓
Wait for connectivity
   ↓
Route becomes available
   ↓
Forward message
```

This is the store-and-forward principle used by the simulation.

### 2.4 Routes can change

A disruption should not permanently stop the mission.

For example:

``` text
Normal route:
GS-1 → SAT-1 → SAT-2 → SAT-3 → GS-2

After L1 disruption:
GS-1
  X
SAT-1 → SAT-4 → SAT-3 → GS-2
```

The router can select another available path.

### 2.5 Successful arrival is not enough

The system also needs to verify that:

-   the payload was not corrupted,
-   the message was not delivered twice.

The simulation therefore tracks:

``` text
payload_hash
integrity_verified
duplicate_detected
```

------------------------------------------------------------------------

# 3. Proposed Solution

The project combines four major layers.

## Layer 1 --- Space Network Simulation

The network contains:

-   5 satellites,
-   2 ground stations,
-   10 communication links.

Current logical topology:

``` text
GS-1 ── L1 ── SAT-1
             │
       ┌─────┴─────┐
       │           │
      L2          L6
       │           │
     SAT-2       SAT-4
       │          │ │
      L3         L8 L7
       │          │ │
     SAT-3 ───────┘ │
       │             │
      L4             L9
       │             │
     SAT-5 ── L5 ── GS-2
       │
      L10
       │
     GS-2
```

The exact routing decision depends on which links are currently active.

------------------------------------------------------------------------

## Layer 2 --- TinyML Priority Engine

Telemetry-derived features are passed into a compact machine-learning
model.

The model estimates:

``` text
priority_probability
```

which becomes a DTN priority score:

``` text
priority_score = probability × 100
```

The current deployment threshold is:

``` text
threshold = 0.25
```

Therefore:

``` text
probability >= 0.25 → HIGH
probability < 0.25  → LOW
```

The threshold is configurable and should not be treated as a universal
operational threshold.

------------------------------------------------------------------------

## Layer 3 --- DTN Routing

Messages are:

1.  created,
2.  prioritized,
3.  placed in the DTN system,
4.  routed using currently active links,
5.  forwarded one hop per simulation tick,
6.  stored when no route is available,
7.  forwarded again after connectivity returns.

Messages are processed using descending priority score.

This means a higher-priority message is considered before a
lower-priority message when both are active.

------------------------------------------------------------------------

## Layer 4 --- Verification

When a message reaches its destination:

1.  its payload hash is checked,
2.  integrity is marked verified when the hash matches,
3.  duplicate delivery is checked,
4.  the message is marked delivered.

The frontend removes a delivered packet from the active 3D packet
animation.

------------------------------------------------------------------------

# 4. Why DTN?

Conventional IP-style networking generally assumes that a usable
end-to-end path is available when communication is required.

That assumption is weak for highly intermittent space networks.

DTN changes the model:

``` text
Traditional:
Source ───────────────── Destination

DTN:
Source → Node → Store → Node → Store → Node → Destination
```

A DTN node can hold information until another communication opportunity
becomes available.

This is especially suitable for a simulation where:

-   links disappear,
-   links return,
-   routes change,
-   communication opportunities are intermittent.

------------------------------------------------------------------------

# 5. Why Add Message Prioritization?

Not every piece of satellite data has the same operational value.

For example:

``` text
HIGH:
Anomalous or potentially important telemetry

LOW:
Routine housekeeping data
```

If communication capacity is temporarily constrained, priority-aware
routing provides a mechanism for the network to process more important
data first.

The current simulator sorts active messages by:

``` python
active_messages.sort(
    key=lambda message: (
        -message.priority_score,
        message.created_at,
    )
)
```

Therefore the TinyML output directly influences DTN processing order.

------------------------------------------------------------------------

# 6. Why TinyML Instead of a Large ML Model?

This is one of the central design decisions of the project.

The intended environment is not a high-end server. A real spacecraft or
edge device can have strict limitations involving:

-   memory,
-   CPU,
-   power,
-   storage,
-   communication bandwidth,
-   inference latency.

A large model may provide additional complexity that is unnecessary for
this particular binary priority task.

We therefore chose **TinyML**.

## TinyML design goals

The model should be:

-   small,
-   fast,
-   memory-efficient,
-   deployable on constrained hardware,
-   suitable for local inference,
-   independent of continuous cloud connectivity.

The final model is exported to **TensorFlow Lite**.

Architecture:

``` text
9 input features
      ↓
Dense(16, ReLU)
      ↓
Dense(8, ReLU)
      ↓
Dense(1, Sigmoid)
      ↓
Priority probability
```

This is intentionally much smaller than a transformer, large neural
network, or cloud-scale inference pipeline.

------------------------------------------------------------------------

# 7. Why Local TinyML Inference Matters for Space Networking

A major design principle is:

> **The priority decision should be possible near the data source.**

Instead of:

``` text
Satellite
   ↓
Send telemetry to Earth
   ↓
Cloud/server
   ↓
Large ML model
   ↓
Return priority
```

the intended TinyML architecture is:

``` text
Satellite / Edge Node
        ↓
   TinyML inference
        ↓
   Local priority
        ↓
   DTN routing
```

This reduces dependence on a continuously available backhaul connection.

That is particularly relevant to a disruption-tolerant network, because
the network is specifically designed to tolerate communication outages.

------------------------------------------------------------------------

# 8. Dataset

The original satellite telemetry dataset contained:

-   **303,493 telemetry rows**
-   **9 channels**
-   **2,123 channel-segment groups**
-   a binary `anomaly` field.

The original dataset did **not** contain a native DTN priority label.

Therefore we did not claim that the dataset directly represented message
priority.

Instead, we defined a documented proxy:

``` text
anomaly = 1 → high urgency / priority
anomaly = 0 → normal / low priority
```

This is a project-defined mapping for the priority-engine experiment.

It should not be interpreted as a native label supplied by the original
satellite dataset.

------------------------------------------------------------------------

# 9. Synthetic TinyML Dataset

Because the original telemetry dataset did not directly provide a DTN
priority target, a controlled 200,000-sample dataset was generated for
the TinyML pipeline.

Dataset:

``` text
Total samples:       200,000
Training samples:    160,000
Testing samples:      40,000
```

Class distribution:

``` text
Normal / LOW:       134,015  (67.0075%)
Anomalous / HIGH:    65,985  (32.9925%)
```

The generation process was designed to avoid directly mixing the same
complete source segment between training and testing.

The data was split using complete channel/segment groups before
sampling, followed by empirical resampling and small channel-aware
perturbations.

------------------------------------------------------------------------

# 10. TinyML Features

The final model uses exactly these nine features, in this order:

``` text
1. value
2. sampling
3. channel_id
4. z_score
5. abs_z_score
6. delta_value
7. abs_delta
8. rolling_mean_5
9. rolling_std_5
```

Metadata such as:

``` text
timestamp
segment
group_id
anomaly
priority
```

is not directly passed as a model feature.

------------------------------------------------------------------------

# 11. EDA Findings

Exploratory data analysis was performed before model deployment.

Dataset quality:

``` text
Rows:              200,000
Features:                9
Missing cells:            0
Duplicates:               0
```

Strongest absolute Pearson correlations with the target included:

``` text
sampling          0.210225
rolling_mean_5    0.196320
value             0.195479
channel_id        0.195409
rolling_std_5     0.131914
abs_delta         0.109138
abs_z_score       0.097550
z_score           0.043259
delta_value       0.000712
```

Mutual-information analysis showed additional nonlinear usefulness,
particularly for:

``` text
rolling_std_5
rolling_mean_5
channel_id
value
delta_value
abs_delta
```

The near-zero linear correlation of `delta_value` did not mean that the
feature was useless; its mutual information was non-zero.

------------------------------------------------------------------------

# 12. Baseline Model Comparison

Several lightweight classical models were evaluated.

  -------------------------------------------------------------------------------------
  Model          Accuracy   Precision    Recall        F1   ROC-AUC    PR-AUC   Approx.
                                                                                  Model
                                                                                   Size
  ------------ ---------- ----------- --------- --------- --------- --------- ---------
  Logistic         0.6764      0.5221    0.1834    0.2715    0.7179    0.5067   1.92 KB
  Regression                                                                  

  Decision         0.7492      0.7913    0.3221    0.4578    0.7849    0.6423  20.90 KB
  Tree                                                                        

  Random           0.7471      0.7759    0.3242    0.4573    0.7893    0.6593 978.77 KB
  Forest                                                                      

  Extra Trees      0.7377      0.7849    0.2783    0.4110    0.7853    0.6431 856.74 KB
  -------------------------------------------------------------------------------------

The classical models demonstrated that the problem is learnable, but the
ensemble models are substantially larger than the compact neural/TFLite
deployment target.

------------------------------------------------------------------------

# 13. Final TinyML Model

The selected deployment model is a compact TensorFlow model exported to
TensorFlow Lite.

Architecture:

``` text
Input: 9 features
       ↓
Dense 16 + ReLU
       ↓
Dense 8 + ReLU
       ↓
Dense 1 + Sigmoid
```

Training configuration:

``` text
Optimizer:       Adam
Loss:            Binary Cross Entropy
Epochs:          30
Batch size:      128
Validation:      15%
```

The training pipeline standardizes the features using a `StandardScaler`
fitted only on the training data.

------------------------------------------------------------------------

# 14. TFLite Results

## FP32 TFLite

``` text
Accuracy:      73.76%
Precision:     72.91%
Recall:        32.11%
F1:            44.58%
PR-AUC:        62.52%
Model size:     3.52 KB
```

## INT8 TFLite

``` text
Accuracy:      71.04%
Precision:     58.10%
Recall:        42.67%
F1:            49.20%
PR-AUC:        58.19%
Model size:     3.59 KB
```

The INT8 model was not smaller in this particular tiny network because
FlatBuffer/quantization overhead is significant relative to the already
very small FP32 model.

Therefore the current integration uses:

``` text
TFLite FP32
```

rather than assuming that INT8 is automatically better.

------------------------------------------------------------------------

# 15. Threshold Optimization

The raw sigmoid output is converted into a priority class using a
configurable threshold.

Threshold testing showed:

## FP32 --- threshold 0.25

``` text
Precision:       50.10%
Recall:          81.21%
F1:              61.97%
False-negative rate: 18.79%
```

This was selected as the initial DTN candidate because it provided the
highest tested F1 while also providing more than 80% recall with at
least 50% precision.

This threshold is a **project configuration**, not a universal rule.

It should eventually be tuned using mission-specific costs for:

-   false negatives,
-   false positives,
-   buffer capacity,
-   communication cost,
-   message urgency.

------------------------------------------------------------------------

# 16. TinyML Runtime Integration

The backend priority service was rewritten to use the deployed TFLite
model.

Model files:

``` text
tinyml/models/
├── tinyml_model.keras
├── tinyml_model_fp32.tflite
├── tinyml_model_int8.tflite
└── feature_scaler.json
```

The service:

1.  loads the scaler,
2.  validates feature order,
3.  loads the TFLite interpreter,
4.  checks the expected input dimension,
5.  constructs the nine-feature vector,
6.  scales it,
7.  runs TFLite inference,
8.  handles model input/output types,
9.  returns the probability and priority classification.

Runtime interpreter fallback order:

``` text
ai_edge_litert
      ↓
tflite_runtime
      ↓
tensorflow Lite
```

This makes the service more flexible across deployment environments.

------------------------------------------------------------------------

# 17. TinyML API Output

The priority service returns information such as:

``` json
{
  "priority_score": 91.71,
  "priority_class": "HIGH",
  "confidence": 0.9171,
  "priority_probability": 0.9171,
  "threshold": 0.25,
  "model_type": "tflite_fp32"
}
```

The score is then stored inside the DTN message.

------------------------------------------------------------------------

# 18. Actual TinyML Integration Test

A telemetry vector:

``` json
{
  "value": 0.1,
  "sampling": 1.0,
  "channel_id": 1,
  "z_score": 2.0,
  "abs_z_score": 2.0,
  "delta_value": 0.1,
  "abs_delta": 0.1,
  "rolling_mean_5": 0.2,
  "rolling_std_5": 0.05
}
```

produced:

``` text
Priority probability: 0.9171
Priority score:       91.71
Priority class:       HIGH
Model type:           tflite_fp32
```

A second telemetry vector produced:

``` text
Priority probability: 0
Priority score:       0
Priority class:       LOW
Model type:           tflite_fp32
```

This demonstrated that the backend was actually executing the TFLite
model rather than merely assigning a hard-coded priority.

------------------------------------------------------------------------

# 19. DTN Message Integration

The message creation API calls the priority service.

Conceptually:

``` text
POST /api/messages
       ↓
Telemetry
       ↓
priority_service.predict()
       ↓
TinyML probability
       ↓
priority_score
priority_class
       ↓
DTN Message
       ↓
Simulation
```

Example message:

``` json
{
  "id": "MSG-0002",
  "source": "SAT-1",
  "destination": "GS-2",
  "payload": "HIGH PRIORITY TELEMETRY",
  "priority_score": 91.71,
  "priority_class": "HIGH"
}
```

------------------------------------------------------------------------

# 20. DTN Network Topology

Current nodes:

  Node    Type        Role
  ------- ----------- ----------------------
  GS-1    Ground      Ground Station Alpha
  SAT-1   Satellite   Satellite 1
  SAT-2   Satellite   Satellite 2
  SAT-3   Satellite   Satellite 3
  SAT-4   Satellite   Satellite 4
  SAT-5   Satellite   Satellite 5
  GS-2    Ground      Ground Station Beta

Current links:

  Link   Source   Target     Latency   Bandwidth
  ------ -------- -------- --------- -----------
  L1     GS-1     SAT-1            2         100
  L2     SAT-1    SAT-2            3          80
  L3     SAT-2    SAT-3            3          80
  L4     SAT-3    SAT-5            2          90
  L5     SAT-5    GS-2             2         100
  L6     SAT-1    SAT-4            2          70
  L7     SAT-4    SAT-3            2          70
  L8     SAT-2    SAT-4            2          60
  L9     SAT-4    GS-2             4          80
  L10    SAT-3    GS-2             3         100

Links have an active/disrupted state.

------------------------------------------------------------------------

# 21. Store-and-Forward Demonstration

The most important DTN demonstration performed so far was deliberately
disrupting:

``` text
L1: GS-1 → SAT-1
```

Before disruption:

``` text
GS-1 → SAT-1
```

After disruption:

``` text
GS-1 X SAT-1
```

`MSG-0001` could no longer leave GS-1.

Instead of being dropped:

``` text
MSG-0001
status: stored
current_node: GS-1
```

This demonstrated DTN buffering.

------------------------------------------------------------------------

# 22. Alternate Route Demonstration

While L1 was disrupted, messages originating from SAT-1 were still able
to use another path.

For example:

``` text
SAT-1
  ↓
SAT-4
  ↓
GS-2
```

Both the HIGH and LOW messages were successfully delivered through this
alternate path.

This demonstrates that a disrupted route does not necessarily imply
mission-wide communication failure.

------------------------------------------------------------------------

# 23. Link Restoration Demonstration

After restoring L1:

``` text
GS-1 ── SAT-1
```

the stored message became routable again.

It then moved hop-by-hop:

``` text
GS-1
 ↓
SAT-1
 ↓
SAT-4
 ↓
GS-2
```

The simulation used one DTN hop per simulation tick.

This makes the forwarding process visible and deterministic for
demonstration.

------------------------------------------------------------------------

# 24. Final End-to-End Simulation Result

The completed test contained three messages.

Final state:

``` text
Total messages:        3
Delivered:             3
Stored:                0
Dropped:               0
Duplicates:            0
Integrity failures:    0
Delivery rate:        100%
Network availability: 100%
Average delay:          3
Average hops:           2.33
```

The messages were:

### MSG-0001

``` text
GS-1 → GS-2
Priority: LOW
Hops: 3
Delay: 5
Status: delivered
Integrity: verified
Duplicate: false
```

### MSG-0002

``` text
SAT-1 → GS-2
Priority: HIGH
Score: 91.71
Hops: 2
Delay: 2
Status: delivered
Integrity: verified
Duplicate: false
```

### MSG-0003

``` text
SAT-1 → GS-2
Priority: LOW
Score: 0
Hops: 2
Delay: 2
Status: delivered
Integrity: verified
Duplicate: false
```

This is the strongest end-to-end validation achieved so far.

------------------------------------------------------------------------

# 25. Frontend --- 3D Space Command Center

The frontend provides a live visual representation of the network.

The current visualization contains:

-   realistic Earth GLB model,
-   satellite GLB model,
-   five orbital planes,
-   moving satellites,
-   two ground stations,
-   satellite-to-satellite communication links,
-   satellite-to-ground communication arcs,
-   active/disrupted link states,
-   message markers,
-   priority labels,
-   live simulation statistics,
-   simulation controls,
-   fullscreen/focus mode.

------------------------------------------------------------------------

# 26. Satellite Orbits

Each satellite has a deliberately separated orbital plane.

The frontend uses predefined orbital parameters for:

``` text
SAT-1
SAT-2
SAT-3
SAT-4
SAT-5
```

The satellites slowly move around their orbital paths.

The intention is not to model exact real orbital mechanics, but to
provide a clear visual simulation of a dynamic space network.

------------------------------------------------------------------------

# 27. Dynamic Communication Links

Communication links are calculated from the current
satellite/ground-station positions.

Satellite-to-satellite links are represented as dynamic straight beams.

Satellite-to-ground links use elevated quadratic arcs so that the
communication path remains visually visible instead of passing through
the Earth model.

The important property is:

> **The links move with the satellites.**

Therefore a link is not a fixed 2D line drawn over a static background.

------------------------------------------------------------------------

# 28. Link Disruption Visualization

Active links are shown using the normal communication-beam appearance.

Disrupted links are shown differently.

The backend is the source of truth:

``` text
active: true
active: false
```

The frontend converts this into the corresponding visual link state.

This allows the user to demonstrate:

``` text
Normal network
     ↓
Disrupt L1
     ↓
L1 visually changes
     ↓
DTN route changes
     ↓
Restore L1
     ↓
L1 becomes available
```

------------------------------------------------------------------------

# 29. Packet Movement Visualization

The frontend now visualizes an actual DTN message transition.

When the backend reports:

``` text
current_node: SAT-1
```

and later:

``` text
current_node: SAT-4
```

the frontend does not simply teleport the packet.

It animates:

``` text
SAT-1 ● ───────────────→ ● SAT-4
          MSG-XXXX
```

using the actual source and destination node positions.

Ground links follow their curved communication path.

This makes the 3D animation correspond to the backend DTN state.

------------------------------------------------------------------------

# 30. Packet Removal After Delivery

A delivered packet should not remain floating around the network.

The frontend therefore filters out:

``` text
status = delivered
status = dropped
```

from the active 3D message list.

The behaviour is:

``` text
Message created
     ↓
Packet appears
     ↓
Packet moves
     ↓
Destination reached
     ↓
Backend: delivered
     ↓
Packet removed from animation
```

The communication-link particles remain because they represent active
communication links, not individual DTN messages.

------------------------------------------------------------------------

# 31. Fullscreen Simulation Mode

The 3D simulation supports a focus/fullscreen-style view.

The simulation controls are intended to remain available inside this
view, including:

``` text
Advance Simulation
```

This is important for demonstrations because the user should not need to
exit the 3D view to advance the backend simulation.

------------------------------------------------------------------------

# 32. Backend Architecture

Current backend structure:

``` text
backend/
├── .env
├── .env.example
├── requirements.txt
└── app/
    ├── api/
    │   ├── messages.py
    │   ├── ml.py
    │   ├── network.py
    │   └── simulation.py
    │
    ├── core/
    │   ├── config.py
    │   └── state.py
    │
    ├── dtn/
    │   ├── message.py
    │   ├── network.py
    │   ├── node.py
    │   ├── router.py
    │   └── simulator.py
    │
    ├── services/
    │   ├── priority_service.py
    │   └── simulation_service.py
    │
    └── main.py
```

------------------------------------------------------------------------

# 33. Backend Responsibilities

## API layer

Handles HTTP requests for:

``` text
messages
ML
network
simulation
```

## DTN layer

Handles:

``` text
message representation
nodes
network topology
routing
simulation ticks
```

## Services

The service layer connects:

``` text
API
 ↓
TinyML
 ↓
DTN simulation
```

This keeps the routing engine separate from the web API.

------------------------------------------------------------------------

# 34. Frontend Architecture

Current frontend structure:

``` text
frontend/
├── public/
│   └── models/
│       ├── earth.glb
│       └── satellite.glb
│
└── src/
    ├── components/
    │   ├── MetricCard.jsx
    │   ├── NetworkGraph.jsx
    │   ├── Sidebar.jsx
    │   ├── SpaceScene.jsx
    │   └── StatusBadge.jsx
    │
    ├── pages/
    │   ├── Analytics.jsx
    │   ├── Dashboard.jsx
    │   ├── Messages.jsx
    │   ├── Simulation.jsx
    │   └── TinyML.jsx
    │
    ├── services/
    │   └── api.js
    │
    ├── App.jsx
    ├── index.css
    └── main.jsx
```

------------------------------------------------------------------------

# 35. Frontend Pages

## Dashboard

Provides the command-center overview:

-   network availability,
-   message count,
-   delivery rate,
-   simulation time,
-   3D network,
-   recent messages,
-   mission actions.

## Simulation

Provides simulation controls and network activity.

## Messages

Provides message-related information.

## TinyML

Provides visibility into the priority model.

## Analytics

Provides simulation/network metrics.

------------------------------------------------------------------------

# 36. API-Driven Frontend

The frontend is designed to use the backend as the source of truth.

Important operations include:

``` text
Get network state
Get simulation state
Advance simulation
Reset simulation
Disrupt link
Restore link
Create message
Predict priority
Get TinyML status
```

This is important because the frontend should not independently invent
whether a message has been delivered or whether a link is active.

------------------------------------------------------------------------

# 37. Complete System Architecture

``` text
                         SPACE DTN SYSTEM
┌───────────────────────────────────────────────────────────┐
│                        FRONTEND                           │
│                                                           │
│  React + Three.js + React Three Fiber + Drei             │
│                                                           │
│  Dashboard | Simulation | Messages | TinyML | Analytics  │
│                         │                                 │
│                    REST API calls                         │
└─────────────────────────┬─────────────────────────────────┘
                          │
                          ▼
┌───────────────────────────────────────────────────────────┐
│                       FASTAPI                             │
│                                                           │
│  /messages   /ml   /network   /simulation                │
└─────────────┬───────────────────────┬─────────────────────┘
              │                       │
              ▼                       ▼
┌──────────────────────┐    ┌──────────────────────────────┐
│     TinyML Engine    │    │        DTN Simulator         │
│                      │    │                              │
│  TFLite FP32         │    │ Nodes                        │
│  9 features          │    │ Links                        │
│  StandardScaler      │    │ Router                       │
│  Threshold 0.25      │    │ Store-and-forward            │
└──────────┬───────────┘    │ Simulation ticks             │
           │                └──────────────┬───────────────┘
           │                               │
           └──────────────┬────────────────┘
                          ▼
                 Priority-aware DTN
                          │
                          ▼
                Integrity Verification
                          │
                          ▼
                      Delivered
```

------------------------------------------------------------------------

# 38. What Makes This Approach Different?

The project is not intended to claim that DTN, routing, or TinyML
individually are new technologies.

The contribution is the **integration of these ideas into one
demonstrable space-network system**.

The project combines:

``` text
DTN
+
Dynamic link disruption
+
Priority-aware forwarding
+
TinyML inference
+
Store-and-forward
+
Route recovery
+
Integrity verification
+
Duplicate detection
+
3D visualization
```

into a single workflow.

------------------------------------------------------------------------

# 39. Comparison With More Conventional Approaches

  ----------------------------------------------------------------------------------------------------------
  Approach           Disruption     Message Priority       Local         Store-and-Forward   3D Mission
                     Handling                              Lightweight                       Visualization
                                                           ML                                
  ------------------ -------------- ---------------------- ------------- ------------------- ---------------
  Conventional       Limited        Usually                Not inherent  Limited             No
  always-connected                  application-specific                                     
  networking                                                                                 

  Basic DTN routing  Yes            Not necessarily        No            Yes                 No
                                    intelligent                                              

  DTN + rule-based   Yes            Rules                  No            Yes                 Usually no
  priority                                                                                   

  Heavy cloud ML +   Depends on     Yes                    No            Depends on network  Not inherent
  networking         connectivity                                                            

  **This project**   **Yes**        **TinyML-assisted**    **Yes**       **Yes**             **Yes**
  ----------------------------------------------------------------------------------------------------------

The project's advantage is therefore architectural: it brings together
functions that are often treated separately.

------------------------------------------------------------------------

# 40. Why the Solution Is Suitable for Constrained Space/Edge Systems

The design emphasizes:

### Low model footprint

The FP32 TFLite model is approximately:

``` text
3.52 KB
```

in the measured deployment artifact.

### Low inference complexity

The network contains only:

``` text
9 → 16 → 8 → 1
```

neural units.

### Local decision making

Priority can be estimated without requiring a large remote inference
service.

### DTN compatibility

If connectivity disappears, the DTN system can store the message instead
of requiring immediate end-to-end communication.

### Separation of concerns

The TinyML model does not need to understand routing.

It only provides:

``` text
priority probability
```

The DTN routing engine remains responsible for deciding how the message
moves.

------------------------------------------------------------------------

# 41. Important Design Decision: TinyML Does Not Replace the Router

A key architectural principle is:

``` text
TinyML = priority decision

Router = path decision
```

The model does not decide:

``` text
SAT-1 → SAT-4
```

The router decides the path based on network connectivity.

TinyML decides how urgent the message is.

This separation makes the system easier to reason about and extend.

------------------------------------------------------------------------

# 42. Current Metrics

The simulation tracks:

``` text
simulation_time
total_messages
delivered
dropped
stored
critical_messages
duplicates
integrity_failures
delivery_rate
active_links
total_links
network_availability
average_delay
average_hops
```

One current naming limitation is:

``` text
critical_messages
```

while the deployed TinyML classifier currently uses:

``` text
HIGH
LOW
```

The dashboard can therefore show zero `critical_messages` even when a
HIGH-priority message exists.

A future refinement should expose:

``` text
high_priority_messages
low_priority_messages
```

or explicitly define the relationship between HIGH and CRITICAL.

This should be fixed rather than silently changing the meaning of an
existing metric.

------------------------------------------------------------------------

# 43. Testing Performed

The project has been tested at multiple levels.

## Dataset level

-   missing-value check,
-   duplicate check,
-   class-distribution analysis,
-   correlation analysis,
-   mutual-information analysis,
-   train/test separation.

## ML level

-   baseline model comparison,
-   TensorFlow model training,
-   FP32 TFLite conversion,
-   INT8 TFLite conversion,
-   inference testing,
-   threshold optimization.

## API level

Verified:

``` text
/api/ml/status
/api/messages/predict
/api/messages
```

with actual telemetry inputs.

## DTN level

Verified:

``` text
message creation
priority assignment
link disruption
store-and-forward
alternate route
link restoration
multi-hop forwarding
delivery
integrity verification
duplicate detection
```

## End-to-end level

Successfully achieved:

``` text
100% delivery
0 duplicates
0 integrity failures
0 dropped messages
```

for the demonstrated three-message scenario.

------------------------------------------------------------------------

# 44. Example End-to-End Scenario

Suppose a satellite produces telemetry.

### Step 1 --- Telemetry

``` text
Telemetry
   ↓
9 engineered features
```

### Step 2 --- TinyML

``` text
TFLite
   ↓
probability = 0.9171
```

### Step 3 --- Priority

``` text
score = 91.71
class = HIGH
```

### Step 4 --- Message

``` text
SAT-1 → GS-2
```

### Step 5 --- Link disruption

``` text
SAT-1 → SAT-2  unavailable
```

### Step 6 --- Route selection

``` text
SAT-1 → SAT-4 → GS-2
```

### Step 7 --- Packet movement

The frontend shows the packet moving through the communication links.

### Step 8 --- Delivery

``` text
GS-2
 ↓
integrity verified
 ↓
duplicate = false
 ↓
delivered
```

### Step 9 --- Visualization cleanup

The delivered packet disappears from the active 3D animation.

------------------------------------------------------------------------

# 45. Repository Structure

A recommended complete repository structure is:

``` text
space_dtn/
│
├── backend/
│   ├── .env
│   ├── .env.example
│   ├── requirements.txt
│   │
│   └── app/
│       ├── api/
│       │   ├── messages.py
│       │   ├── ml.py
│       │   ├── network.py
│       │   └── simulation.py
│       │
│       ├── core/
│       │   ├── config.py
│       │   └── state.py
│       │
│       ├── dtn/
│       │   ├── message.py
│       │   ├── network.py
│       │   ├── node.py
│       │   ├── router.py
│       │   └── simulator.py
│       │
│       ├── services/
│       │   ├── priority_service.py
│       │   └── simulation_service.py
│       │
│       └── main.py
│
├── frontend/
│   ├── public/
│   │   └── models/
│   │       ├── earth.glb
│   │       └── satellite.glb
│   │
│   └── src/
│       ├── components/
│       ├── pages/
│       ├── services/
│       ├── App.jsx
│       ├── index.css
│       └── main.jsx
│
├── tinyml/
│   ├── data/
│   │   ├── raw/
│   │   └── processed/
│   │
│   ├── models/
│   │   ├── tinyml_model.keras
│   │   ├── tinyml_model_fp32.tflite
│   │   ├── tinyml_model_int8.tflite
│   │   └── feature_scaler.json
│   │
│   ├── generate_tinyml_dataset.py
│   ├── train_tinyml_tflite.py
│   └── optimize_tinyml_threshold.py
│
├── evaluation/
│   ├── metrics/
│   ├── plots/
│   └── reports/
│
└── README.md
```

------------------------------------------------------------------------

# 46. Running the Project

## Backend

From the backend directory:

``` bash
cd backend
```

Install the backend dependencies:

``` bash
pip install -r requirements.txt
```

Start FastAPI:

``` bash
uvicorn app.main:app --reload
```

The API can then be tested using the FastAPI/Swagger documentation.

Typical development URL:

``` text
http://127.0.0.1:8000/docs
```

------------------------------------------------------------------------

## Frontend

From the frontend directory:

``` bash
cd frontend
npm install
npm run dev
```

The frontend connects to the backend through the API service
configuration.

Make sure the backend is running before testing live simulation
operations.

------------------------------------------------------------------------

# 47. Demonstration Procedure

A good project demonstration can follow this exact sequence.

## Part 1 --- Show the network

Open the dashboard.

Show:

``` text
Earth
Satellites
Orbital planes
Ground stations
Communication links
```

## Part 2 --- Show TinyML

Open the TinyML page.

Explain:

``` text
Telemetry
→ feature extraction
→ TFLite
→ probability
→ HIGH/LOW priority
```

## Part 3 --- Create messages

Create:

``` text
HIGH PRIORITY TELEMETRY
LOW PRIORITY HOUSEKEEPING DATA
```

Show their different priority scores.

## Part 4 --- Disrupt a link

Disrupt:

``` text
L1
GS-1 → SAT-1
```

Show that the affected message becomes stored.

## Part 5 --- Show alternate routing

Advance the simulation.

Show the packet using:

``` text
SAT-1 → SAT-4 → GS-2
```

## Part 6 --- Restore the link

Restore L1.

Advance the simulation.

Show the stored message leaving GS-1.

## Part 7 --- Verify delivery

Show:

``` text
Delivered
Integrity verified
No duplicate
```

## Part 8 --- 3D visualization

Use fullscreen/focus mode.

Show the packet moving along the communication link.

After delivery:

``` text
packet disappears
```

This makes the relationship between backend state and frontend
visualization easy to demonstrate.

------------------------------------------------------------------------

# 48. Limitations

The current system is a research/prototype simulation rather than a
flight-ready space networking system.

## 48.1 Synthetic ML data

The final 200k TinyML dataset is synthetic/resampled from the source
telemetry distribution.

Final deployment validation should use untouched real telemetry or a
separate mission dataset.

## 48.2 Proxy priority label

The original dataset did not contain a native DTN urgency label.

Therefore:

``` text
anomaly → high urgency
normal → low urgency
```

is a project-defined proxy.

A real deployment should use mission-defined priority labels.

## 48.3 Simplified orbital mechanics

The frontend uses predefined orbital planes and slow deterministic
motion.

It is designed for visualization rather than precise orbital
propagation.

## 48.4 Simplified network model

The topology is simulated.

A real space network would need additional considerations such as:

-   contact windows,
-   Doppler effects,
-   propagation delay,
-   link budget,
-   antenna pointing,
-   packet loss,
-   radiation effects,
-   power constraints,
-   real orbital ephemerides.

## 48.5 Simplified priority policy

The current model is binary:

``` text
HIGH
LOW
```

A real mission may require:

``` text
CRITICAL
HIGH
MEDIUM
LOW
```

with different routing and buffering policies.

## 48.6 TinyML model validation

The current performance should not be interpreted as proof of mission
readiness.

Real deployment requires validation against representative operational
telemetry and hardware constraints.

------------------------------------------------------------------------

# 49. Future Improvements

## 49.1 Better mission-specific priority labels

Build labels based on actual mission rules:

``` text
critical fault
safety event
anomaly
routine telemetry
housekeeping
```

## 49.2 Multi-class priority

Move from:

``` text
HIGH / LOW
```

to:

``` text
CRITICAL / HIGH / MEDIUM / LOW
```

## 49.3 Hardware deployment

Deploy the TFLite model to a constrained edge platform or
microcontroller.

Measure:

``` text
RAM
Flash
CPU time
energy
latency
```

## 49.4 More realistic routing

Introduce:

-   link latency,
-   bandwidth constraints,
-   queue capacity,
-   contact windows,
-   congestion,
-   packet loss,
-   route cost.

## 49.5 Priority-aware buffer management

If a node buffer becomes full:

``` text
CRITICAL
   ↓
HIGH
   ↓
MEDIUM
   ↓
LOW
```

could determine which messages remain buffered.

## 49.6 Dynamic link prediction

A future model could predict upcoming connectivity windows.

## 49.7 Mission-scale simulation

Increase the network from:

``` text
5 satellites
```

to:

``` text
50 / 100 / 500+ nodes
```

and evaluate scalability.

## 49.8 Real telemetry validation

Use a separate untouched telemetry dataset to measure generalization.

## 49.9 Better analytics

Add:

-   throughput,
-   latency distribution,
-   packet delivery ratio,
-   buffer occupancy,
-   link utilization,
-   priority-specific delivery rate,
-   false-negative rate,
-   false-positive rate,
-   energy/inference cost.

------------------------------------------------------------------------

# 50. Key Project Contribution

The central idea of this project is:

> **Use a compact TinyML model at the edge of a disruption-tolerant
> space network to identify higher-urgency telemetry, then use DTN
> store-and-forward routing to preserve and deliver information despite
> changing connectivity.**

The model does not replace the network.

The network does not replace the model.

They work together:

``` text
TinyML
"How important is this data?"

        +

DTN Router
"Where can this data go right now?"

        +

Store-and-Forward
"What should we do if there is no route?"

        +

Integrity Verification
"Did the correct data arrive?"

        +

3D Visualization
"Can we see the mission state?"
```

------------------------------------------------------------------------

# 51. Current Project Status

## Completed

-   [x] Space DTN problem definition
-   [x] DTN node/network model
-   [x] Dynamic link states
-   [x] Disruption simulation
-   [x] Link restoration
-   [x] Store-and-forward behavior
-   [x] Alternate routing
-   [x] Hop-by-hop simulation
-   [x] Message priority integration
-   [x] Satellite telemetry dataset analysis
-   [x] 200k TinyML dataset generation
-   [x] EDA
-   [x] Baseline ML comparison
-   [x] Compact neural model
-   [x] FP32 TFLite conversion
-   [x] INT8 TFLite conversion
-   [x] Threshold optimization
-   [x] TFLite backend integration
-   [x] `/api/ml/status` validation
-   [x] `/api/messages/predict` validation
-   [x] TinyML → DTN message integration
-   [x] Priority-aware message processing
-   [x] Payload hashing
-   [x] Integrity verification
-   [x] Duplicate detection
-   [x] End-to-end DTN test
-   [x] 3D Earth model
-   [x] 3D satellite models
-   [x] Moving orbital planes
-   [x] Dynamic communication beams
-   [x] Ground-station links
-   [x] Backend-driven message visualization
-   [x] Packet hop animation
-   [x] Packet removal after delivery
-   [x] Fullscreen/focus simulation controls

## Next major work

-   [ ] Improve HIGH/CRITICAL metric definitions
-   [ ] Connect all frontend controls cleanly to live backend state
-   [ ] Add richer event visualization
-   [ ] Add buffer/queue visualization
-   [ ] Add mission analytics
-   [ ] Validate on untouched real telemetry
-   [ ] Evaluate on constrained hardware
-   [ ] Improve routing cost model
-   [ ] Add realistic contact windows and link behavior
-   [ ] Prepare final evaluation/report/demo

------------------------------------------------------------------------

# 52. Final Summary

This project demonstrates a complete prototype of a
**Disruption-Tolerant Space Data Routing & Priority Engine**.

The system combines:

``` text
Satellite Telemetry
        ↓
Feature Engineering
        ↓
TinyML
        ↓
Priority Score
        ↓
DTN Message
        ↓
Dynamic Network
        ↓
Disruption
        ↓
Store / Reroute
        ↓
Link Restoration
        ↓
Hop-by-Hop Forwarding
        ↓
Integrity Verification
        ↓
Duplicate Detection
        ↓
Successful Delivery
        ↓
3D Mission Visualization
```

The most important demonstrated result is that the system can maintain
communication despite a simulated link outage while prioritizing
messages and preserving data until a route becomes available.

The current three-message end-to-end test achieved:

``` text
100% delivery
0 dropped
0 duplicates
0 integrity failures
```

The project is therefore a strong prototype foundation for a larger
research system involving **TinyML + DTN + intelligent space-network
routing**.

------------------------------------------------------------------------

## Project Keywords

``` text
Space Networking
Disruption Tolerant Networking
DTN
TinyML
TensorFlow Lite
Satellite Communication
Telemetry
Priority Engine
Store-and-Forward
Delay Tolerant Networking
Edge AI
Onboard AI
Satellite Routing
Dynamic Routing
Network Resilience
Message Prioritization
Integrity Verification
Duplicate Detection
Three.js
React
FastAPI
Python
Machine Learning
```

------------------------------------------------------------------------

# 53. Evaluation, Precomputed Score Bank & Pytest Suite

### 53.1 Precomputing the TinyML Score Bank
To evaluate benchmarks using real model behavior without loading TensorFlow inside the Monte Carlo benchmark loop, a precomputed score bank is generated from the test dataset:

```bash
python tinyml/build_score_bank.py
```
This processes `tinyml/data/processed/tinyml_test.csv` (40,000 samples) through the deployed FP32 TFLite model, outputting `tinyml/data/generated/score_bank.json` with documented precision (50.1%) and recall (81.2%) at decision threshold 0.25. If the model is not found, the script will intentionally fail rather than silently falling back to heuristics.

### 53.2 Automated Test Suite (Pytest)
A full automated test suite verifies simulator correctness, determinism, buffer boundaries, reliability features, and NetworkX alignment:

```bash
pytest backend/tests -v
```
Verified components:
1. `test_router_vs_networkx.py`: 45/45 node pairs nominal Dijkstra cost agreement, active link filtering, and resilience reporting.
2. `test_determinism.py`: Disruption schedule and benchmark summary determinism across seeds.
3. `test_integrity_duplicates.py`: SHA-256 corrupted payload rejection, duplicate suppression (1 delivery per bundle), clean retransmission delivery.
4. `test_buffers.py`: Priority-aware eviction strictly at $\ge \text{EVICTION\_MARGIN}$, and protected last-copy replication safety.
5. `test_urgency_metrics.py`: Urgency metric scoring on dataset proxy labels with graceful fallback.
6. `test_spray.py`: Binary token handoff, copy bounds ($\le L+1$ across lifecycle), and exactly one delivery.
7. `test_baseline_waits.py`: Contact-plan waiting under failure vs. live adaptive detours.
8. `test_reliability.py`: Per-source sequence numbering, destination sequence gap detection, and custody handover tracking.

------------------------------------------------------------------------

# 54. Limitations & Explicit Disclosures

To ensure scientific honesty and transparency when presenting to judges:

1. **Scaled Simulation Time:** Ticks represent discrete forwarding steps and scaled simulation time, not literal orbital ephemerides or physical propagation delays (e.g., light-travel time to Mars/Moon).
2. **Synthetic Topology:** The 9-node constellation (2 ground stations, 7 satellite relays) models multi-path mesh dynamics and orbital corridors, but is synthetic rather than an exact satellite constellation orbit.
3. **Simplified Contact Plan Baseline:** The baseline router models static contact plans by precomputing paths on the planned network and holding data during unplanned disruptions. It is a simplified baseline, not full NASA ION or CGR.
4. **Replication Baseline Adaptation:** Standard Spray-and-Wait is designed for mobile ad-hoc random encounters. In this mostly-connected mesh, it is adapted so copies spray toward the destination, and single tokens only advance if closer to the target. Additionally, both Spray-and-Wait and Epidemic receive idealized instant delivery acknowledgments to prune obsolete copies and prevent strawman buffer choking.
5. **Urgency is an Anomaly Proxy:** The training dataset does not have a native space mission DTN priority label. Urgency is trained on an anomaly-detection proxy. At the deployed 0.25 threshold, the model delivers ~0.50 precision and ~0.81 recall, trading off false alarms to ensure urgent events are caught.

------------------------------------------------------------------------

# 55. DTN Metrics Glossary

| Metric | Definition | Significance |
|---|---|---|
| **Delivery Rate (%)** | Ratio of unique original bundles delivered to total bundles generated. | Primary reliability metric. |
| **Urgent Delay (ticks)** | Mean simulation ticks from creation to delivery for bundles tagged with the proxy urgency label. | Speed of critical message handling under contention. |
| **Average Delay (ticks)** | Mean delivery delay across all delivered bundles regardless of priority. | Global latency across routine and urgent traffic. |
| **Link Utilization (%)** | Ratio of link transmission slots used to slots available while the link is active. | Capacity efficiency and avoidance of network idling. |
| **Transmissions** | Total hops traversed across all bundle copies and replicas. | Network and radio energy expenditure. |
| **Overhead Ratio** | Total transmissions divided by delivered original bundles. | Baseline & Adaptive = ~1.0–2.5x; Spray & Epidemic = 5.0–15.0x+. |
| **Buffer Blocked** | Count of forwarding attempts delayed because downstream relay storage was full. | Measures relay buffer congestion pressure. |
| **Buffer Evictions** | Lower-priority residents dropped from full buffers to make room for higher-priority newcomers ($\ge \text{EVICTION\_MARGIN}$). | Priority engine buffer management under stress. |
| **Custody Retransmissions** | Retransmissions or store-and-forward retries executed by custody holders. | Demonstrates hop-by-hop reliable custody transfer. |
| **Sequence Gaps** | Missing bundle sequence numbers detected at destination upon bundle arrival. | Measures out-of-order and dropped packet boundaries per source. |

------------------------------------------------------------------------

# 56. 5-Minute Demo Script

1. **Live Traffic & TinyML Priorities (1 min):**
   - Open **Live Traffic** page. Click *Start Traffic*.
   - Point out TinyML scoring: packets receive probability scores, with $\ge 0.25$ labeled HIGH.
   - Show how HIGH packets move to the front of transmission queues and arrive with lower latency.
2. **Topological Resilience & Mid-Run Link Failure (1 min):**
   - Switch to **Simulation** page. Point out the *Topological Resilience & Most Critical Links* card.
   - Click *Cut Min-Cut Link (L5)* or *Break Transit Link (L4)*.
   - Show in 3D that urgent packets detour via alternate satellite corridors (e.g., SAT-2/SAT-5), while routine packets buffer in store-and-forward storage.
3. **Integrity & Duplicate Replay (1 min):**
   - Click *Replay Duplicate* on an already delivered packet: destination rejects it with `duplicate` status; delivered count does not change.
   - Corrupt an in-flight packet: destination verifies SHA-256, flags integrity mismatch, and drops the payload.
4. **Compare Page & Benchmark (1.5 min):**
   - Navigate to **Compare**. Show the 4-way scripted comparison: Baseline (stalls on broken link) vs FIFO vs Space DTN (expedites urgent) vs Spray-and-Wait (replicates).
   - Scroll to **Statistical Benchmark**: select *Scenario* (e.g., `long_outage` or `critical_cut`), click *Run Benchmark*.
   - Review 95% Confidence Intervals across 5 strategies: Space DTN achieves competitive delivery with $\sim 1.5\text{x}$ overhead, whereas Spray/Epidemic consume $\sim 6\text{x}–12\text{x}$ transmissions.
   - Click *Compare priority sources* to demonstrate TinyML vs Oracle (upper bound) vs Random (lower bound).
   - Click *Export CSV* to show reproducible data export.
5. **Closing on Limitations (30 sec):**
   - Open the **TinyML** page, show the explicit threshold justification ($\text{recall} = 81.2\%$), and articulate the anomaly-proxy framing.

------------------------------------------------------------------------

# 57. Prepared Answers to Judges' Questions

### Q1: Which strategies and metrics did you compare, and how did you ensure statistical validity?
**Answer:** We compare five strategies:
1. *Baseline*: Static contact-plan routing with FIFO queues.
2. *Reroute*: Live disruption-aware routing with FIFO queues (isolating routing benefit).
3. *Space DTN (Adaptive)*: Live disruption-aware routing with TinyML priority scheduling (isolating priority benefit).
4. *Spray-and-Wait ($L=4$)*: Controlled opportunistic flooding.
5. *Epidemic*: Uncontrolled flooding.
We evaluate Delivery Rate, Urgent Delay, Link Utilization, and Overhead Ratio (transmissions per delivery) over $N \ge 20$ identical pseudo-random seeds with 95% Confidence Intervals.

### Q2: What happens if a critical link is cut mid-transmission?
**Answer:** The simulator detects the link outage on the next tick. The static baseline cannot adapt and stores messages at the boundary node. Space DTN recalculates shortest-cost paths incorporating latency, congestion, and buffer availability, detouring urgent data around the failure while buffering routine packets if capacity is constrained.

### Q3: How do you detect data corruption and duplicate arrivals?
**Answer:** Every bundle carries a cryptographic SHA-256 payload digest and a unique `bundle_id`. When a bundle reaches its destination, the payload is hashed and compared to the digest; corruptions are dropped with an `integrity` failure event. The destination maintains a delivered `bundle_id` registry; any subsequent arrival is rejected as a `duplicate`, preventing duplicate processing.

### Q4: What happens when a relay node's storage buffer fills up?
**Answer:** Each satellite relay has a finite `buffer_capacity`. In FIFO/Baseline, full buffers block incoming transmissions (`buffer_blocked`). In Space DTN, the adaptive priority engine evaluates incoming bundles against resident bundles: if an incoming bundle outranks the lowest-priority resident by at least `EVICTION_MARGIN` (20 points), the resident is evicted to make room (`buffer_evicted`), guaranteeing urgent telemetry is never blocked by routine housekeeping data.

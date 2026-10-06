import { useEffect, useMemo, useState } from "react";
import NetworkGraph from "../components/NetworkGraph";
import "./traffic.css";

import {
  getNetwork,
  mergeNetwork,
  stepSimulation,
  resetSimulation,
  adjustLinkLatency,
  adjustLinkCongestion,
  resetLinkConditions,
  getResilience,
  disruptLink,
  restoreLink as apiRestoreLink,
  setLinkCongestion,
  replayBundle,
} from "../services/api";

const LATENCY_STEP = 1;
const CONGESTION_STEP = 10;
const MAX_LATENCY = 100;

const PHASE_TEXT = {
  idle: "Idle",
  ready: "Ready",
  running: "Running",
  paused: "Paused",
  complete: "Complete",
};

// The Adaptive Link Controls card spans the full page width below the 3D
// simulator. Each link is a compact box and the boxes flow into as many
// columns as fit, so the card uses its width instead of stacking tall rows.
const COMPACT_LINK_CSS = `
  .link-list.adaptive-link-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(290px, 1fr));
    gap: 12px;
  }
  .link-control.link-control-compact {
    grid-template-columns: 1fr 1fr;
    align-content: start;
    gap: 10px 12px;
    padding: 12px 14px;
  }
  .link-control.link-control-compact .link-info {
    grid-column: 1 / -1;
  }
  .link-control.link-control-compact .link-info + .link-adjust-column {
    border-left: 0;
    padding-left: 0;
  }
  .link-control.link-control-compact .link-adjust-column {
    padding-left: 12px;
    border-left: 1px solid rgba(183, 202, 226, 0.08);
  }
  .link-control.link-control-compact .link-state-actions {
    margin-top: 0;
    padding-top: 10px;
  }
  .link-control.link-control-compact .link-state-buttons .secondary-button {
    min-width: 64px;
    padding: 0 10px;
  }
  .scenario-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    background: rgba(18, 28, 45, 0.7);
    border: 1px solid rgba(88, 166, 255, 0.2);
    border-radius: 8px;
    padding: 10px 14px;
    margin-bottom: 16px;
  }
  .scenario-toolbar .scenario-title {
    font-size: 0.8rem;
    font-weight: 700;
    color: #58a6ff;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    margin-right: 6px;
  }
  .resilience-summary-bar {
    display: flex;
    flex-wrap: wrap;
    gap: 16px;
    padding: 10px 14px;
    background: rgba(255, 255, 255, 0.03);
    border-radius: 6px;
    margin-bottom: 14px;
    font-size: 0.85rem;
  }
  .resilience-summary-bar span strong {
    color: #58a6ff;
    margin-left: 4px;
  }
  .resilience-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 12px;
  }
  .resilience-badge {
    display: inline-block;
    padding: 2px 7px;
    border-radius: 4px;
    font-size: 0.72rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .resilience-badge.critical {
    background: rgba(248, 81, 73, 0.2);
    color: #f85149;
    border: 1px solid rgba(248, 81, 73, 0.4);
  }
  .resilience-badge.delay {
    background: rgba(210, 153, 34, 0.2);
    color: #e3b341;
    border: 1px solid rgba(210, 153, 34, 0.4);
  }
  .resilience-badge.redundant {
    background: rgba(46, 160, 67, 0.2);
    color: #3fb950;
    border: 1px solid rgba(46, 160, 67, 0.4);
  }
  .critical-link-card {
    background: rgba(13, 21, 37, 0.6);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .critical-link-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .critical-link-endpoints {
    font-size: 0.95rem;
    font-weight: 600;
    color: #f0f6fc;
  }
  .critical-link-alt {
    font-size: 0.78rem;
    color: #8b949e;
  }
`;

// Traffic controls for the shared run. These drive the same backend
// simulator as the Live Traffic page, so packets show up on the map below.
function TrafficBar({ state, traffic, navigate }) {
  const packets = state?.messages || [];
  const total = packets.length;
  const count = (test) => packets.filter(test).length;

  const delivered = count((p) => p.status === "delivered");
  const dropped = count((p) => p.status === "dropped");
  const rejected = count((p) => p.status === "rejected");
  const moving = count((p) => p.status === "in_transit");
  const waiting = count((p) => p.status === "queued" || p.status === "stored");
  const high = count((p) => ["HIGH", "CRITICAL"].includes(p.priority_class));
  const progress = total
    ? Math.round(((delivered + dropped + rejected) / total) * 100)
    : 0;

  return (
    <section className="tf-simbar">
      <div className="tf-simbar-main">
        <span className={`tf-phase ${traffic.phase}`}>
          <i />
          {PHASE_TEXT[traffic.phase]}
        </span>

        <button
          className="primary-button"
          onClick={traffic.toggle}
          disabled={traffic.busy}
        >
          {traffic.label}
        </button>

        <button
          className="tf-ghost"
          onClick={traffic.step}
          disabled={traffic.busy}
          title="Advance exactly one simulation tick"
        >
          Step
        </button>

        <div className="tf-speed" title="Time between simulation ticks">
          <span>Speed</span>
          {["slow", "normal", "fast"].map((key) => (
            <button
              key={key}
              className={traffic.speed === key ? "active" : ""}
              onClick={() => traffic.setSpeed(key)}
            >
              {key}
            </button>
          ))}
        </div>

        <div className="tf-simbar-progress">
          <div className="tf-progress small">
            <div style={{ width: `${progress}%` }} />
          </div>
          <small>
            {total
              ? `${delivered}/${total} delivered · ${moving} moving · ${waiting} waiting${
                  rejected ? ` · ${rejected} duplicates rejected` : ""
                } · ${high} high priority`
              : "Start traffic to release the telemetry packets onto the map"}
          </small>
        </div>

        <div className="tf-legend">
          <span className="high">HIGH</span>
          <span className="low">LOW</span>
          <span className="stored">Stored</span>
        </div>

        <button className="tf-link" onClick={() => navigate?.("live-traffic")}>
          Packet details →
        </button>
      </div>

      {traffic.error && <div className="tf-alert">{traffic.error}</div>}
    </section>
  );
}

function Simulation({ state, refreshState, traffic, navigate }) {
  const [baseNetwork, setNetwork] = useState(null);
  const [resilience, setResilience] = useState(null);
  const [busy, setBusy] = useState(false);

  // Link state always comes from the shared simulator snapshot, so Fail,
  // Restore and the +/- buttons are reflected immediately.
  const network = useMemo(
    () => mergeNetwork(baseNetwork, state?.network),
    [baseNetwork, state?.network]
  );

  const links = network?.links || [];
  const stats = state?.statistics || {};
  const parameters = network?.parameters || {};
  const maxLatency = parameters.max_latency || MAX_LATENCY;

  useEffect(() => {
    loadNetwork();
  }, []);

  async function loadNetwork() {
    try {
      const [netData, resData] = await Promise.all([
        getNetwork(),
        getResilience().catch(() => null),
      ]);
      setNetwork(netData);
      if (resData) setResilience(resData);
    } catch (err) {
      console.error(err);
    }
  }

  async function resetAllLinkConditions() {
    for (const link of links) {
      await resetLinkConditions(link.id);
    }
  }

  // Fail: push latency straight to the maximum so the link becomes unusable.
  async function failLink(link) {
    const delta = maxLatency - Number(link.latency || 0);
    if (delta > 0) {
      await adjustLinkLatency(link.id, delta);
    }
  }

  // Restore: reset the link to its preset latency and congestion.
  async function restoreLink(link) {
    await resetLinkConditions(link.id);
  }

  async function runAction(action) {
    try {
      setBusy(true);
      await action();
      await loadNetwork();
      await refreshState();
    } catch (err) {
      console.error(err);
      alert(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function injectScenario(type) {
    await runAction(async () => {
      if (type === "cut_l5") {
        await disruptLink("L5");
      } else if (type === "cut_l4") {
        await disruptLink("L4");
      } else if (type === "congest_l10") {
        await setLinkCongestion("L10", 80);
      } else if (type === "replay_dup") {
        const delivered = (state?.messages || []).find(
          (m) => m.status === "delivered" && !m.copy_of
        );
        if (delivered) {
          await replayBundle(delivered.id);
        } else {
          alert("No delivered bundle available to replay. Start traffic first!");
        }
      } else if (type === "reset_all") {
        await resetAllLinkConditions();
      }
    });
  }

  return (
    <>
      <style>{COMPACT_LINK_CSS}</style>
      <div className="page-header">
        <div>
          <div className="eyebrow">Network Simulation</div>
          <h1 className="page-title">Adaptive Network Simulator</h1>
          <p className="page-description">
            Start the traffic run, then break a link with one click or change
            latency and congestion step by step. A failed link becomes
            unusable, and the DTN router reroutes or stores packets without
            any manual intervention. Latency is scaled simulation time, not
            real orbital delay.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => runAction(() => resetSimulation())}
          >
            Reset Network
          </button>

          <button
            className="primary-button"
            disabled={busy}
            onClick={() => runAction(() => stepSimulation())}
          >
            Advance Tick
          </button>
        </div>
      </div>

      <div className="metric-grid">
        <div className="metric-card">
          <div className="metric-label">Simulation Time</div>
          <div className="metric-value">T+{stats.simulation_time || 0}</div>
          <div className="metric-foot">current simulation tick</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Usable Links</div>
          <div className="metric-value">
            {stats.active_links || 0}/{stats.total_links || 0}
          </div>
          <div className="metric-foot">latency below maximum</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Avg Latency</div>
          <div className="metric-value">
            {Number(stats.average_link_latency || 0).toFixed(1)} sim-ms
          </div>
          <div className="metric-foot">scaled simulation time</div>
        </div>

        <div className="metric-card">
          <div className="metric-label">Avg Congestion</div>
          <div className="metric-value">
            {Number(stats.average_link_congestion || 0).toFixed(0)}%
          </div>
          <div className="metric-foot">network load indicator</div>
        </div>
      </div>

      {traffic && (
        <TrafficBar state={state} traffic={traffic} navigate={navigate} />
      )}

      <div className="scenario-toolbar">
        <span className="scenario-title">⚡ Named Scenarios & Quick Disruptions:</span>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => injectScenario("cut_l5")}
          title="Cut access link L5 (SAT-5 ↔ GS-2). Stresses min-cut resilience & forces store-and-forward"
        >
          Cut Min-Cut Link (L5)
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => injectScenario("cut_l4")}
          title="Cut primary transit link L4 (SAT-3 ↔ SAT-5). Forces adaptive routing detour"
        >
          Break Transit Link (L4)
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => injectScenario("congest_l10")}
          title="Surge congestion on L10 to 80%. Demonstrates nonlinear congestion avoidance"
        >
          Congest Detour (L10 80%)
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => injectScenario("replay_dup")}
          title="Re-send a copy of an already delivered bundle to test duplicate detection"
        >
          Replay Duplicate
        </button>
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => injectScenario("reset_all")}
        >
          Restore All Links
        </button>
      </div>

      <div className="dashboard-grid">
        <section className="card network-host-card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">Live Network Topology</h2>
              <p className="card-subtitle">
                Links respond to their current latency and availability state.
              </p>
            </div>
          </div>

          <NetworkGraph
            network={network}
            state={state}
            onAdvance={() => runAction(() => stepSimulation())}
            busy={busy}
            interactive
          />
        </section>

        <section className="card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">Topological Resilience & Most Critical Links (NetworkX Cross-Check)</h2>
              <p className="card-subtitle">
                NetworkX graph analysis: edge connectivity, minimum cut, and per-link criticality ranking.
              </p>
            </div>
          </div>

          <div className="card-body">
            {resilience && (
              <div className="resilience-summary-bar">
                <span>Bridges: <strong>{resilience.global_resilience?.bridge_count ?? 0} (biconnected mesh)</strong></span>
                <span>Articulation Points: <strong>{resilience.global_resilience?.articulation_points?.join(", ") || "None"}</strong></span>
                <span>Edge Connectivity: <strong>{resilience.path_resilience?.edge_connectivity ?? 2}</strong></span>
                <span>Disjoint Paths: <strong>{resilience.path_resilience?.disjoint_paths_count ?? 2}</strong></span>
                <span>Minimum Edge Cut: <strong>{resilience.path_resilience?.minimum_edge_cut?.map((e) => e.join(" ↔ ")).join("; ") || "L5"}</strong></span>
              </div>
            )}

            <div className="resilience-grid">
              {(resilience?.critical_links || []).slice(0, 6).map((item) => {
                const liveLink = links.find((l) => l.id === item.link_id);
                const isDown = !liveLink?.active || (liveLink?.latency || 0) >= maxLatency;
                const isDelay = item.extra_latency && item.extra_latency > 0;
                const badgeClass = item.disconnects ? "critical" : (isDelay ? "delay" : "redundant");

                return (
                  <div className="critical-link-card" key={item.link_id}>
                    <div className="critical-link-header">
                      <span className="critical-link-endpoints">{item.link_id}: {item.source} ↔ {item.target}</span>
                      <span className={`resilience-badge ${badgeClass}`}>{item.status}</span>
                    </div>
                    <div className="critical-link-alt">
                      {item.alternate_path ? (
                        <span>Detour: {item.alternate_path.join(" → ")} ({item.alternate_cost}ms)</span>
                      ) : (
                        <span>No alternate path exists (Graph disconnected)</span>
                      )}
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 4 }}>
                      <span style={{ fontSize: "0.75rem", color: isDown ? "#f85149" : "#3fb950" }}>
                        Status: <strong>{isDown ? "UNUSABLE" : "ACTIVE"}</strong>
                      </span>
                      {liveLink && (
                        <button
                          className="secondary-button"
                          style={{ padding: "2px 8px", fontSize: "0.75rem", minWidth: 64 }}
                          disabled={busy}
                          onClick={() => runAction(() => isDown ? restoreLink(liveLink) : failLink(liveLink))}
                        >
                          {isDown ? "Restore" : "Cut Link"}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card full-width">
          <div className="card-header adaptive-link-header">
            <div>
              <h2 className="card-title">Adaptive Link Controls</h2>
              <p className="card-subtitle">
                Fail a link to see messages reroute or wait. Restore it to
                watch stored messages continue.
              </p>
            </div>

            <button
              className="secondary-button adaptive-reset-all"
              disabled={busy || links.length === 0}
              onClick={() => runAction(() => resetAllLinkConditions())}
            >
              Reset All Links
            </button>
          </div>

          <div className="card-body">
            <div className="link-list adaptive-link-grid">
              {links.map((link) => {
                const unusable = !link.active || link.latency >= maxLatency;

                return (
                  <div className="link-control link-control-compact" key={link.id}>
                    <div className="link-info">
                      <div className="link-name">
                        {link.id} · {link.status || (unusable ? "UNUSABLE" : "ACTIVE")}
                      </div>
                      <div className="link-route">
                        {link.source} → {link.target} · {link.bandwidth} Mbps
                        {stats.link_utilization_by_link?.[link.id] && (
                          <>
                            {" "}
                            · util{" "}
                            {Number(
                              stats.link_utilization_by_link[link.id].utilization
                            ).toFixed(0)}
                            %
                          </>
                        )}
                      </div>
                    </div>

                    <div className="link-adjust-column">
                      <div className="link-adjust-label">LATENCY</div>
                      <div className="link-adjust-value">
                        {link.latency} <span>sim-ms</span>
                        <small>/ {maxLatency}</small>
                      </div>
                      <div className="link-adjust-buttons">
                        <button
                          className="secondary-button"
                          disabled={busy || link.latency <= 1}
                          onClick={() =>
                            runAction(() => adjustLinkLatency(link.id, -LATENCY_STEP))
                          }
                          title="Decrease latency"
                        >
                          −
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy || link.latency >= maxLatency}
                          onClick={() =>
                            runAction(() => adjustLinkLatency(link.id, LATENCY_STEP))
                          }
                          title="Increase latency"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="link-adjust-column">
                      <div className="link-adjust-label">CONGESTION</div>
                      <div className="link-adjust-value">
                        {Number(link.congestion || 0).toFixed(0)}<span>%</span>
                      </div>
                      <div className="link-adjust-buttons">
                        <button
                          className="secondary-button"
                          disabled={busy || Number(link.congestion || 0) <= 0}
                          onClick={() =>
                            runAction(() => adjustLinkCongestion(link.id, -CONGESTION_STEP))
                          }
                          title="Decrease congestion"
                        >
                          −
                        </button>
                        <button
                          className="secondary-button"
                          disabled={busy || Number(link.congestion || 0) >= 100}
                          onClick={() =>
                            runAction(() => adjustLinkCongestion(link.id, CONGESTION_STEP))
                          }
                          title="Increase congestion"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    <div className="link-state-actions">
                      <span className="link-adjust-label">LINK STATE</span>

                      <div className="link-state-buttons">
                        <button
                          className="secondary-button link-fail-button"
                          disabled={busy || unusable}
                          onClick={() => runAction(() => failLink(link))}
                          title="Make this link unusable"
                        >
                          Fail
                        </button>
                        <button
                          className="secondary-button link-restore-button"
                          disabled={busy}
                          onClick={() => runAction(() => restoreLink(link))}
                          title="Reset this link to its preset conditions"
                        >
                          Restore
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">Preset Buffer Costs</h2>
              <p className="card-subtitle">
                Static node costs used by adaptive route selection, and the
                most messages each relay has held at once.
              </p>
            </div>
          </div>

          <div className="card-body">
            <div className="link-list">
              {(network?.nodes || []).map((node) => (
                <div className="link-control" key={node.id}>
                  <div className="link-info">
                    <div className="link-name">{node.id}</div>
                    <div className="link-route">{node.name}</div>
                  </div>
                  <div className="link-state">
                    <span className="buffer-cost-value">
                      Buffer cost
                      <strong>{Number(node.buffer_cost || 0).toFixed(0)}</strong>
                    </span>
                    <span className="buffer-capacity">
                      Peak held {stats.peak_buffer_occupancy?.[node.id] ?? 0} /{" "}
                      {stats.buffer_capacity || node.buffer_capacity}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">Simulation Events</h2>
              <p className="card-subtitle">
                Network-condition and routing activity.
              </p>
            </div>
          </div>

          <div className="card-body">
            {(state?.events || []).length === 0 ? (
              <div className="empty-state">No events recorded.</div>
            ) : (
              <div className="event-list">
                {state.events.map((event, index) => (
                  <div className="event-item" key={`${event.time}-${index}`}>
                    <div className="event-time">T+{event.time}</div>
                    <div
                      className={`event-text${
                        String(event.event || "").startsWith("REROUTE")
                          ? " event-reroute"
                          : ""
                      }`}
                    >
                      {event.event}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export default Simulation;

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

// Traffic controls for the shared run. These drive the same backend
// simulator as the Live Traffic page, so packets show up on the map below.
function TrafficBar({ state, traffic, navigate }) {
  const packets = state?.messages || [];
  const total = packets.length;
  const count = (test) => packets.filter(test).length;

  const delivered = count((p) => p.status === "delivered");
  const dropped = count((p) => p.status === "dropped");
  const moving = count((p) => p.status === "in_transit");
  const waiting = count((p) => p.status === "queued" || p.status === "stored");
  const high = count((p) => ["HIGH", "CRITICAL"].includes(p.priority_class));
  const progress = total ? Math.round(((delivered + dropped) / total) * 100) : 0;

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
              ? `${delivered}/${total} delivered · ${moving} moving · ${waiting} waiting · ${high} high priority`
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
      const data = await getNetwork();
      setNetwork(data);
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

  return (
    <>
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

      <div className="dashboard-grid">
        <section className="card network-host-card">
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

        <section className="card">
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
            <div className="link-list">
              {links.map((link) => {
                const unusable = !link.active || link.latency >= maxLatency;

                return (
                  <div className="link-control" key={link.id}>
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
                    <div className="event-text">{event.event}</div>
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

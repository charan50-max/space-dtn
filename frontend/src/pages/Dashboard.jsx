import { useEffect, useState } from "react";

import MetricCard from "../components/MetricCard";
import NetworkGraph from "../components/NetworkGraph";
import StatusBadge from "../components/StatusBadge";

import {
  getNetwork,
  stepSimulation,
  resetSimulation,
} from "../services/api";

function Dashboard({ state, refreshState, navigate }) {
  const [network, setNetwork] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getNetwork()
      .then(setNetwork)
      .catch((err) => console.error(err));
  }, []);

  const stats = state?.statistics || {};
  const messages = state?.messages || [];
  const events = state?.events || [];

  async function handleStep() {
    try {
      setBusy(true);
      await stepSimulation();
      await refreshState();
      const nextNetwork = await getNetwork();
      if (nextNetwork) setNetwork(nextNetwork);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  async function handleReset() {
    try {
      setBusy(true);
      await resetSimulation();
      await refreshState();
      const nextNetwork = await getNetwork();
      if (nextNetwork) setNetwork(nextNetwork);
    } catch (err) {
      console.error(err);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">Mission Control</div>
          <h1 className="page-title">Space DTN Command Center</h1>
          <p className="page-description">
            Monitor disruption-tolerant communication, message priority,
            routing and delivery across the simulated space network.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="secondary-button"
            onClick={handleReset}
            disabled={busy}
          >
            Reset
          </button>

          <button
            className="secondary-button"
            onClick={handleStep}
            disabled={busy}
          >
            {busy ? "Running..." : "Advance Simulation"}
          </button>

          <button
            className="primary-button"
            onClick={() => navigate("compare")}
          >
            Run Comparison Demo
          </button>
        </div>
      </div>

      {messages.length === 0 && (
        <section className="card" style={{ marginBottom: 20 }}>
          <div
            className="card-body"
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 16,
              flexWrap: "wrap",
            }}
          >
            <div>
              <h2 className="card-title">Start with the guided demo</h2>
              <p className="card-subtitle">
                Watch the same messages and the same link failure run through a
                fixed-plan network and through Space DTN, side by side.
              </p>
            </div>

            <button
              className="primary-button"
              onClick={() => navigate("compare")}
            >
              Start Guided Demo
            </button>
          </div>
        </section>
      )}

      <div className="metric-grid">
        <MetricCard
          label="Network Availability"
          value={`${Number(stats.network_availability || 0).toFixed(0)}%`}
          foot={`${stats.active_links || 0}/${stats.total_links || 0} links active`}
        />
        <MetricCard
          label="Messages"
          value={stats.total_messages || 0}
          foot={`${messages.filter((message) => String(message.priority_class || "").toUpperCase() === "HIGH").length} high priority`}
        />
        <MetricCard
          label="Delivery Rate"
          value={`${Number(stats.delivery_rate || 0).toFixed(0)}%`}
          foot={`${stats.delivered || 0} delivered`}
        />
        <MetricCard
          label="Simulation Time"
          value={stats.simulation_time || 0}
          foot="simulation ticks"
        />
      </div>

      <div className="dashboard-grid">
        <section className="card network-host-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Space Communication Network</h2>
              <p className="card-subtitle">
                Live satellite and ground-station topology
              </p>
            </div>

            <button
              className="secondary-button"
              onClick={() => navigate("simulation")}
            >
              Open Simulation
            </button>
          </div>

          <NetworkGraph network={network} state={state} onAdvance={handleStep} busy={busy} interactive />
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Mission Actions</h2>
              <p className="card-subtitle">Control the simulation</p>
            </div>
          </div>

          <div className="card-body">
            <div className="quick-actions">
              <button className="action-card" onClick={() => navigate("simulation")}>
                <div className="action-title">Disrupt Links</div>
                <div className="action-text">
                  Simulate unpredictable communication outages.
                </div>
              </button>

              <button className="action-card" onClick={() => navigate("messages")}>
                <div className="action-title">Send Message</div>
                <div className="action-text">
                  Create and prioritize mission data.
                </div>
              </button>

              <button className="action-card" onClick={() => navigate("tinyml")}>
                <div className="action-title">TinyML Engine</div>
                <div className="action-text">
                  Inspect the lightweight priority model.
                </div>
              </button>

              <button className="action-card" onClick={() => navigate("analytics")}>
                <div className="action-title">Analytics</div>
                <div className="action-text">
                  Review delivery and network metrics.
                </div>
              </button>
            </div>

            <div style={{ height: 18 }} />

            <div className="card">
              <div className="card-header">
                <div>
                  <h3 className="card-title">Latest Messages</h3>
                </div>
              </div>

              <div className="table-wrapper">
                {messages.length === 0 ? (
                  <div className="empty-state">No messages in the simulation.</div>
                ) : (
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Priority</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {messages.slice(0, 5).map((message) => (
                        <tr key={message.id}>
                          <td className="mono">{message.id}</td>
                          <td
                            className={`priority-${String(
                              message.priority_class || "low"
                            ).toLowerCase()}`}
                          >
                            {message.priority_class}
                          </td>
                          <td>
                            <StatusBadge status={message.status} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">Event Stream</h2>
              <p className="card-subtitle">Recent DTN simulation events</p>
            </div>
          </div>

          <div className="card-body">
            {events.length === 0 ? (
              <div className="empty-state">No simulation events yet.</div>
            ) : (
              <div className="event-list">
                {events.slice(0, 10).map((event, index) => (
                  <div
                    className="event-item"
                    key={`${event.time}-${index}`}
                  >
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

export default Dashboard;

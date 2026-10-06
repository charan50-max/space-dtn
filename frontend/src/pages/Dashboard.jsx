import { useEffect, useMemo, useState } from "react";

import NetworkGraph from "../components/NetworkGraph";
import { EventTimeline, MetricStrip, PageHeader, SignatureFlow } from "../components/mission/ui";
import { getMLStatus, getNetwork } from "../services/api";
import { countNodes } from "../lib/network.js";
import { fmt, na, pct, urgencyPct } from "../lib/values.js";
import { classifyEvent } from "../lib/events.js";

function Dashboard({ state, refreshState, navigate, traffic }) {
  const [network, setNetwork] = useState(null);
  const [ml, setMl] = useState(null);

  useEffect(() => {
    getNetwork().then(setNetwork).catch(() => {});
    getMLStatus().then(setMl).catch(() => {});
  }, [state]);

  const stats = state?.statistics || {};
  const messages = state?.messages || [];
  const events = state?.events || [];
  const counts = countNodes(network || state?.network);
  const liveNetwork = network || state?.network;

  const latestMessage = [...messages].reverse().find((m) => !m.copy_of) || null;
  const latestHighRisk = (liveNetwork?.links || [])
    .slice()
    .sort((a, b) => Number(b.congestion || 0) - Number(a.congestion || 0))[0];

  const signature = useMemo(() => {
    const riskLink = latestHighRisk;
    const critical = messages.find((m) =>
      ["HIGH", "CRITICAL"].includes(String(m.priority_class || "").toUpperCase())
    );
    const stored = messages.find((m) => m.status === "stored");
    const delivered = messages.find((m) => m.status === "delivered" && m.integrity_verified);

    return [
      {
        label: "PREDICT",
        detail: riskLink
          ? `${fmt(riskLink.congestion, 0)}% congestion on ${riskLink.id}`
          : "No link telemetry yet",
      },
      {
        label: "PROTECT",
        detail: critical
          ? `${critical.id} ${critical.priority_class}`
          : "No prioritized message yet",
      },
      {
        label: "ROUTE",
        detail: stored
          ? `${stored.id} buffered at ${stored.current_node}`
          : events.some((e) => String(e.event).startsWith("REROUTE"))
          ? "Alternate path selected"
          : "Live routing idle",
      },
      {
        label: "RECOVER",
        detail: delivered
          ? `${delivered.id} integrity verified`
          : "Waiting for delivery",
      },
    ];
  }, [latestHighRisk, messages, events]);

  const recent = events.filter((event) =>
    [
      "sent",
      "priority",
      "risk",
      "down",
      "buffer",
      "reroute",
      "delivered",
      "integrity",
      "duplicate",
      "info",
    ].includes(classifyEvent(event.event))
  );

  return (
    <>
      <PageHeader
        eyebrow="Mission Control"
        title="Can space data survive a disruption?"
        subtitle="Monitor how SOYUZ predicts, prioritizes and recovers data across an unstable space network."
        actions={
          <>
            <button
              className="primary-button"
              onClick={async () => {
                await traffic?.toggle?.();
                navigate("simulation");
              }}
              disabled={traffic?.busy}
            >
              Start Simulation
            </button>
            <button className="secondary-button" onClick={() => navigate("compare")}>
              Open Compare
            </button>
          </>
        }
      />

      <MetricStrip
        items={[
          { label: "Satellites", value: counts.satellites || "N/A" },
          { label: "Ground Stations", value: counts.stations || "N/A" },
          { label: "Links", value: counts.links || "N/A" },
          { label: "Active Links", value: `${stats.active_links ?? "N/A"}/${stats.total_links ?? "N/A"}` },
          { label: "Buffered", value: na(stats.stored) },
          { label: "Delivered", value: na(stats.delivered) },
          { label: "Delivery Rate", value: pct(stats.delivery_rate) },
        ]}
      />

      <SignatureFlow steps={signature} />

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">TinyML Priority Engine</h2>
              <p className="card-subtitle">How important is this message?</p>
            </div>
          </div>
          <div className="card-body">
            <div className="mission-kv"><span>Model</span><strong>{ml?.model_format || ml?.model_type || "N/A"}</strong></div>
            <div className="mission-kv"><span>Current message</span><strong>{latestMessage?.id || "N/A"}</strong></div>
            <div className="mission-kv">
              <span>Urgency</span>
              <strong>{urgencyPct(latestMessage) != null ? `${urgencyPct(latestMessage)}%` : "N/A"}</strong>
            </div>
            <div className="mission-kv"><span>Priority</span><strong>{latestMessage?.priority_class || "N/A"}</strong></div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Predictive Link-Risk</h2>
              <p className="card-subtitle">How risky is this communication link?</p>
            </div>
          </div>
          <div className="card-body">
            {latestHighRisk ? (
              <>
                <div className="mission-kv">
                  <span>Current link</span>
                  <strong>{latestHighRisk.source} → {latestHighRisk.target}</strong>
                </div>
                <div className="mission-kv">
                  <span>Risk</span>
                  <strong>{fmt(latestHighRisk.congestion, 0, "%")}</strong>
                </div>
                <div className="mission-kv">
                  <span>Classification</span>
                  <strong>
                    {Number(latestHighRisk.congestion) >= 80
                      ? "HIGH"
                      : Number(latestHighRisk.congestion) >= 50
                      ? "MEDIUM"
                      : "LOW"}
                  </strong>
                </div>
                <p className="card-subtitle" style={{ marginTop: 10 }}>
                  Simulated from live congestion and latency. Not orbital failure prediction.
                </p>
              </>
            ) : (
              <div className="empty-state">Unavailable</div>
            )}
          </div>
        </section>

        <section className="card network-host-card">
          <div className="card-header">
            <div>
              <h2 className="card-title">Live Network</h2>
              <p className="card-subtitle">
                {counts.satellites} satellites · {counts.stations} ground stations · {counts.links} links
              </p>
            </div>
            <button className="primary-button" onClick={() => navigate("simulation")}>
              Open Live Simulation
            </button>
          </div>
          <NetworkGraph network={liveNetwork} state={state} compact />
        </section>

        <section className="card full-width">
          <EventTimeline events={recent} />
          <div style={{ marginTop: 12 }}>
            <button className="secondary-button" onClick={refreshState}>
              Refresh
            </button>
          </div>
        </section>
      </div>
    </>
  );
}

export default Dashboard;

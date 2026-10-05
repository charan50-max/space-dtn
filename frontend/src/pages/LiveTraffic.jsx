import { useEffect, useMemo, useState } from "react";

import { getTrafficSource } from "../services/api";
import useArrivals from "../components/useArrivals";
import "./traffic.css";
import "../components/dtn-callouts.css";

const NODES = [
  "GS-1",
  "SAT-1",
  "SAT-2",
  "SAT-3",
  "SAT-4",
  "SAT-5",
  "SAT-6",
  "SAT-7",
  "GS-2",
];

const STATUS = {
  queued: { label: "Queued", group: "waiting" },
  stored: { label: "Stored", group: "waiting" },
  in_transit: { label: "In transit", group: "moving" },
  delivered: { label: "Delivered", group: "delivered" },
  dropped: { label: "Dropped", group: "dropped" },
  // A retransmitted copy refused by the duplicate detector. It is finished,
  // and it is not a lost packet, so it has its own group.
  rejected: { label: "Rejected", group: "rejected" },
};

const FILTERS = [
  ["all", "All"],
  ["moving", "In transit"],
  ["waiting", "Waiting"],
  ["delivered", "Delivered"],
  ["dropped", "Dropped"],
  ["copies", "Duplicates"],
];

const PHASE_TEXT = {
  idle: "Idle",
  ready: "Ready",
  running: "Running",
  paused: "Paused",
  complete: "Complete",
};

// Why a packet ended without being delivered.
const REASONS = {
  ttl: "TTL expired",
  integrity: "SHA-256 mismatch: corrupted in transit",
  buffer_evicted: "Evicted from a full buffer by higher-priority data",
  duplicate: "Duplicate of an already delivered bundle",
  expired: "Retransmitted copy expired",
};

const groupOf = (packet) => STATUS[packet.status]?.group || "waiting";

// Retransmitted copies are not extra packets: they are tracked separately so
// they never change the totals, lanes or progress bar.
const isCopy = (packet) => Boolean(packet.copy_of);

const isHigh = (packet) =>
  ["HIGH", "CRITICAL"].includes(String(packet.priority_class).toUpperCase());

function fmt(value, digits = 2) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : "—";
}

function PacketRow({ packet, open, onToggle }) {
  const group = groupOf(packet);
  const high = isHigh(packet);
  const t = packet.telemetry || {};
  const copy = isCopy(packet);

  return (
    <div className={`tf-row ${open ? "open" : ""} ${copy ? "copy" : ""}`}>
      <button type="button" className="tf-row-main" onClick={onToggle}>
        <span className="tf-id">
          {packet.id}
          {copy && <em className="dtn-copy-tag">copy</em>}
        </span>

        <span className="tf-route">
          {packet.source} <i>→</i> {packet.destination}
        </span>

        <span className={`tf-prio ${high ? "high" : "low"}`}>
          <b>{high ? "HIGH" : "LOW"}</b>
          {fmt(packet.priority_score, 0)}
        </span>

        <span className="tf-where">{packet.current_node || packet.source}</span>

        <span
          className={`tf-status ${group}`}
          title={REASONS[packet.reject_reason] || undefined}
        >
          {STATUS[packet.status]?.label || packet.status}
        </span>

        <span className="tf-hops">{packet.hops ?? 0}</span>
      </button>

      {open && (
        <div className="tf-detail">
          <div>
            <span>Model confidence</span>
            <strong>{fmt(Number(packet.priority_probability) * 100, 1)}%</strong>
          </div>
          <div>
            <span>Threshold</span>
            <strong>{fmt(packet.priority_threshold, 2)}</strong>
          </div>
          <div>
            <span>Value</span>
            <strong>{fmt(t.value)}</strong>
          </div>
          <div>
            <span>Z-score</span>
            <strong>{fmt(t.z_score)}</strong>
          </div>
          <div>
            <span>Channel</span>
            <strong>{t.channel_id ?? "—"}</strong>
          </div>
          <div>
            <span>Rolling σ5</span>
            <strong>{fmt(t.rolling_std_5)}</strong>
          </div>
          <div>
            <span>Delay / TTL</span>
            <strong>
              {packet.delay ?? 0} / {packet.ttl ?? "—"}
            </strong>
          </div>
          {copy && (
            <div>
              <span>Copy of</span>
              <strong>{packet.copy_of}</strong>
            </div>
          )}
          <div>
            <span>Integrity</span>
            <strong>
              {packet.integrity_verified
                ? "Verified"
                : packet.reject_reason === "integrity"
                ? "Failed"
                : packet.status === "rejected"
                ? "Not checked"
                : "Pending"}
            </strong>
          </div>
          <div>
            <span>Path latency</span>
            <strong>{packet.path_latency ?? 0} sim-ms</strong>
          </div>
          <div>
            <span>Waited</span>
            <strong>
              {packet.stored_ticks ?? 0} stored · {packet.queued_ticks ?? 0} queued
            </strong>
          </div>
          {packet.reject_reason && (
            <div>
              <span>Outcome</span>
              <strong>
                {REASONS[packet.reject_reason] || packet.reject_reason}
              </strong>
            </div>
          )}
          {Array.isArray(packet.route) && packet.route.length > 0 && (
            <div style={{ gridColumn: "1 / -1" }}>
              <span>Route taken</span>
              <strong>{packet.route.join(" → ")}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function LiveTraffic({ state, traffic, navigate }) {
  const [source, setSource] = useState(null);
  const [filter, setFilter] = useState("all");
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [openId, setOpenId] = useState(null);

  useEffect(() => {
    getTrafficSource()
      .then(setSource)
      .catch(() => {});
  }, []);

  const allMessages = useMemo(() => state?.messages || [], [state?.messages]);
  const packets = useMemo(
    () => allMessages.filter((message) => !isCopy(message)),
    [allMessages]
  );
  const copies = useMemo(() => allMessages.filter(isCopy), [allMessages]);

  // Messages that just reached their destination (or duplicates that were
  // just rejected), announced for a few seconds.
  const { arrivals } = useArrivals(state?.messages);
  const arrivedAt = useMemo(
    () =>
      Object.fromEntries(
        arrivals
          .filter((event) => event.kind === "reached")
          .map((event) => [event.node, true])
      ),
    [arrivals]
  );

  const events = state?.events || [];
  const stats = state?.statistics || {};
  const total = packets.length;
  const planned = total || source?.packet_count || 42;

  const counts = useMemo(() => {
    const result = {
      all: total,
      moving: 0,
      waiting: 0,
      delivered: 0,
      dropped: 0,
      rejected: 0,
      copies: copies.length,
    };
    packets.forEach((packet) => {
      const group = groupOf(packet);
      if (group in result) result[group] += 1;
    });
    return result;
  }, [packets, copies, total]);

  // "Duplicates" is only offered while there are copies to show.
  const activeFilter = filter === "copies" && copies.length === 0 ? "all" : filter;

  const lanes = useMemo(() => {
    const build = (high) => {
      const lane = packets.filter((packet) => isHigh(packet) === high);
      return {
        total: lane.length,
        delivered: lane.filter((p) => p.status === "delivered").length,
        moving: lane.filter((p) => p.status === "in_transit").length,
        waiting: lane.filter((p) => groupOf(p) === "waiting").length,
      };
    };
    return { high: build(true), low: build(false) };
  }, [packets]);

  const nodeLoad = useMemo(() => {
    const load = Object.fromEntries(
      NODES.map((node) => [node, { here: 0, stored: 0, received: 0 }])
    );

    packets.forEach((packet) => {
      const node = packet.current_node || packet.source;
      if (!load[node]) return;

      if (packet.status === "delivered") {
        load[node].received += 1;
      } else if (packet.status !== "dropped") {
        load[node].here += 1;
        if (packet.status === "stored") load[node].stored += 1;
      }
    });

    return load;
  }, [packets]);

  const visible = useMemo(() => {
    const pool = activeFilter === "copies" ? copies : packets;

    return pool.filter(
      (packet) =>
        (activeFilter === "all" ||
          activeFilter === "copies" ||
          groupOf(packet) === activeFilter) &&
        (!onlyHigh || isHigh(packet))
    );
  }, [packets, copies, activeFilter, onlyHigh]);

  const finished = counts.delivered + counts.dropped + counts.rejected;
  const progress = total ? Math.round((finished / total) * 100) : 0;
  const hasPackets = traffic.hasPackets;

  return (
    <div className="tf-page">
      <div className="page-header">
        <div>
          <div className="eyebrow">Mission Traffic</div>
          <h1 className="page-title">Live Traffic</h1>
          <p className="page-description">
            {planned} telemetry packets are scored by TinyML, then routed
            through the same network you see on the Simulation page.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="tf-ghost"
            onClick={traffic.reset}
            disabled={traffic.busy || !hasPackets}
          >
            Reset
          </button>
          <button
            className="tf-ghost"
            onClick={traffic.runAll}
            disabled={traffic.busy}
          >
            Skip to end
          </button>
          <button
            className="tf-ghost"
            onClick={traffic.step}
            disabled={traffic.busy}
            title="Advance exactly one simulation tick"
          >
            Step
          </button>
          <button
            className="primary-button"
            onClick={traffic.toggle}
            disabled={traffic.busy}
          >
            {traffic.label}
          </button>
        </div>
      </div>

      {traffic.error && (
        <div className="tf-alert">
          <strong>Traffic backend problem.</strong> {traffic.error}
        </div>
      )}

      <section className="tf-hero">
        <div className="tf-hero-top">
          <span className={`tf-phase ${traffic.phase}`}>
            <i />
            {PHASE_TEXT[traffic.phase]}
          </span>

          <span className="tf-hero-time">
            T+{stats.simulation_time ?? state?.time ?? 0}
          </span>

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

          <button
            className="tf-link"
            onClick={() => navigate("simulation")}
          >
            Watch on 3D map →
          </button>
        </div>

        <div className="tf-progress">
          <div style={{ width: `${progress}%` }} />
        </div>

        <div className="tf-hero-stats">
          <div>
            <strong>
              {counts.delivered}
              <small>/{total || planned}</small>
            </strong>
            <span>Delivered</span>
          </div>
          <div>
            <strong>{counts.moving}</strong>
            <span>In transit</span>
          </div>
          <div>
            <strong>{counts.waiting}</strong>
            <span>Waiting or stored</span>
          </div>
          <div>
            <strong>
              {stats.active_links ?? 0}
              <small>/{stats.total_links ?? 0}</small>
            </strong>
            <span>Links usable</span>
          </div>
        </div>
      </section>

      {!hasPackets ? (
        <section className="tf-empty">
          <h2>{planned} packets are ready to launch</h2>
          <p>
            Press <strong>Start Traffic</strong>. Each packet is classified as
            HIGH or LOW priority, then forwarded hop by hop. HIGH packets go
            first when links are busy, and packets wait safely when a link
            fails.
          </p>
        </section>
      ) : (
        <>
          <section className="tf-nodes">
            {NODES.map((node) => {
              const load = nodeLoad[node];
              return (
                <div
                  key={node}
                  className={`tf-node ${load.here ? "busy" : ""} ${
                    load.stored ? "stored" : ""
                  } ${arrivedAt[node] ? "arrived" : ""}`}
                >
                  <span>{node}</span>
                  <strong>{load.here}</strong>
                  <small>
                    {load.stored
                      ? `${load.stored} stored`
                      : load.received
                      ? `${load.received} received`
                      : "packets here"}
                  </small>
                </div>
              );
            })}
          </section>

          <div className="tf-columns">
            <section className="tf-panel tf-table-panel">
              <div className="tf-panel-head">
                <h2>Packets</h2>

                <div className="tf-filters">
                  {FILTERS.filter(
                    ([key]) => key === "all" || counts[key] > 0
                  ).map(([key, text]) => (
                    <button
                      key={key}
                      className={activeFilter === key ? "active" : ""}
                      onClick={() => setFilter(key)}
                    >
                      {text} <b>{counts[key]}</b>
                    </button>
                  ))}

                  <label className="tf-check">
                    <input
                      type="checkbox"
                      checked={onlyHigh}
                      onChange={(event) => setOnlyHigh(event.target.checked)}
                    />
                    High priority only
                  </label>
                </div>
              </div>

              <div className="tf-table-head">
                <span>ID</span>
                <span>Route</span>
                <span>Priority</span>
                <span>Now at</span>
                <span>Status</span>
                <span>Hops</span>
              </div>

              <div className="tf-table-body">
                {visible.length === 0 ? (
                  <div className="tf-none">No packets match this filter.</div>
                ) : (
                  visible.map((packet) => (
                    <PacketRow
                      key={packet.id}
                      packet={packet}
                      open={openId === packet.id}
                      onToggle={() =>
                        setOpenId(openId === packet.id ? null : packet.id)
                      }
                    />
                  ))
                )}
              </div>
            </section>

            <aside className="tf-side">
              <section className="tf-panel">
                <div className="tf-panel-head">
                  <h2>Priority lanes</h2>
                </div>

                {[
                  ["high", "HIGH", lanes.high],
                  ["low", "LOW", lanes.low],
                ].map(([key, text, lane]) => (
                  <div className={`tf-lane ${key}`} key={key}>
                    <div className="tf-lane-top">
                      <b>{text}</b>
                      <span>
                        {lane.delivered}/{lane.total} delivered
                      </span>
                    </div>
                    <div className="tf-progress small">
                      <div
                        style={{
                          width: `${
                            lane.total ? (lane.delivered / lane.total) * 100 : 0
                          }%`,
                        }}
                      />
                    </div>
                    <small>
                      {lane.moving} moving · {lane.waiting} waiting
                    </small>
                  </div>
                ))}
              </section>

              <section className="tf-panel">
                <div className="tf-panel-head">
                  <h2>Duplicate detection</h2>
                </div>

                <div className="dtn-dupstat">
                  <div>
                    <strong>{stats.copies_sent ?? copies.length}</strong>
                    <span>copies sent</span>
                  </div>
                  <div>
                    <strong>{stats.duplicates ?? 0}</strong>
                    <span>blocked</span>
                  </div>
                  <div>
                    <strong>{stats.pending_duplicates ?? 0}</strong>
                    <span>still to send</span>
                  </div>
                </div>
              </section>

              <section className="tf-panel">
                <div className="tf-panel-head">
                  <h2>Reliability &amp; resilience</h2>
                </div>

                <div className="dtn-dupstat">
                  <div>
                    <strong>{stats.corrupted ?? 0}</strong>
                    <span>corrupted</span>
                  </div>
                  <div>
                    <strong>{stats.integrity_failures ?? 0}</strong>
                    <span>caught by SHA-256</span>
                  </div>
                  <div>
                    <strong>{stats.delivered_after_storage ?? 0}</strong>
                    <span>survived storage</span>
                  </div>
                </div>

                <div className="dtn-dupstat" style={{ marginTop: 10 }}>
                  <div>
                    <strong>
                      {Number(stats.link_utilization ?? 0).toFixed(0)}%
                    </strong>
                    <span>link utilization</span>
                  </div>
                  <div>
                    <strong>{stats.buffer_blocked ?? 0}</strong>
                    <span>buffer waits</span>
                  </div>
                  <div>
                    <strong>{stats.buffer_evictions ?? 0}</strong>
                    <span>evictions</span>
                  </div>
                </div>
              </section>

              <section className="tf-panel">
                <div className="tf-panel-head">
                  <h2>Recent activity</h2>
                </div>

                {events.length === 0 ? (
                  <div className="tf-none">Nothing yet.</div>
                ) : (
                  <ul className="tf-events">
                    {events.slice(0, 7).map((event, index) => (
                      <li key={`${event.time}-${index}`}>
                        <span>T+{event.time}</span>
                        {event.event}
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </aside>
          </div>
        </>
      )}

      {arrivals.length > 0 && (
        <div className="dtn-toast-stack">
          {arrivals.slice(-3).map((event) => (
            <div className={`dtn-toast ${event.kind}`} key={event.key}>
              {event.kind === "duplicate" ? (
                <>
                  <b>DUPLICATE REJECTED</b>
                  <strong>{event.id}</strong>
                  <span>at {event.node}</span>
                </>
              ) : (
                <>
                  <b>{"\u2713"} REACHED</b>
                  <strong>{event.id}</strong>
                  <span>
                    {event.node}
                    {event.delay != null ? ` \u00b7 ${event.delay} ticks` : ""}
                  </span>
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default LiveTraffic;

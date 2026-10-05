const CLASS_COLUMNS = [
  ["total", "Messages"],
  ["delivered", "Delivered"],
  ["dropped", "Dropped"],
  ["delivery_rate", "Delivery %"],
  ["avg_delay", "Avg delay"],
  ["max_delay", "Max delay"],
];

const DROP_REASONS = {
  ttl: "TTL expired",
  integrity: "SHA-256 mismatch (corrupted)",
  buffer_evicted: "Evicted from a full buffer",
  unknown: "Other",
};

const ANALYTICS_CSS = `
.an-util-row { display: grid; grid-template-columns: 120px 1fr 120px; gap: 12px; align-items: center; padding: 7px 0; border-top: 1px solid rgba(255,255,255,0.06); font-size: 13px; }
.an-util-row:first-child { border-top: 0; }
.an-util-row small { display: block; font-size: 10px; opacity: 0.6; }
.an-track { height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
.an-fill { height: 100%; border-radius: inherit; background: #22d3ee; transition: width 0.5s ease; }
.an-fill.warm { background: #fbbf24; }
.an-fill.hot { background: #f87171; }
.an-util-row em { font-style: normal; text-align: right; font-size: 12px; opacity: 0.8; }
.an-empty { font-size: 13px; opacity: 0.65; padding: 6px 0; }
.an-chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 14px; }
.an-chip { padding: 8px 12px; border-radius: 10px; border: 1px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.03); font-size: 12px; }
.an-chip strong { display: block; font-size: 18px; }
`;

function Analytics({ state }) {
  const stats = state?.statistics || {};
  const classBreakdown = stats.class_breakdown || {};
  const utilization = stats.link_utilization_by_link || {};
  const peakBuffer = stats.peak_buffer_occupancy || {};
  const dropped = stats.dropped_breakdown || {};

  const links = Object.fromEntries(
    (state?.network?.links || []).map((link) => [link.id, link])
  );

  const linkIds = Object.keys(utilization).sort(
    (x, y) => Number(x.replace(/\D/g, "")) - Number(y.replace(/\D/g, ""))
  );

  const bufferLimit = Number(stats.buffer_capacity || 0);
  const nodeIds = (state?.network?.nodes || []).map((node) => node.id);

  const metrics = [
    {
      label: "Delivery Rate",
      value: Number(stats.delivery_rate || 0),
      unit: "%",
    },
    {
      label: "Network Availability",
      value: Number(
        stats.network_availability || 0
      ),
      unit: "%",
    },
    {
      label: "Average Delay",
      value: Number(stats.average_delay || 0),
      unit: "ticks",
    },
    {
      label: "Average Hops",
      value: Number(stats.average_hops || 0),
      unit: "hops",
    },
    {
      label: "Link Utilization",
      value: Number(stats.link_utilization || 0),
      unit: "%",
      foot: "link slots used while up",
    },
    {
      label: "Path Latency",
      value: Number(stats.average_path_latency_ms || 0),
      unit: " sim-ms",
      foot: "summed over each route",
    },
    {
      label: "Urgent Delay",
      value: Number(stats.urgent_avg_delay || 0),
      unit: " ticks",
      foot: `${stats.urgent_delivered || 0} urgent delivered`,
    },
    {
      label: "Delivered After Storage",
      value: Number(stats.delivered_after_storage || 0),
      unit: " msgs",
      digits: 0,
      foot: "rode out an outage",
    },
  ];

  const counts = [
    ["Delivered", stats.delivered || 0],
    ["Stored", stats.stored || 0],
    ["Dropped", stats.dropped || 0],
    ["Duplicates", stats.duplicates || 0],
    [
      "Integrity Failures",
      stats.integrity_failures || 0,
    ],
  ];

  const maxCount = Math.max(
    ...counts.map(([, value]) => Number(value)),
    1
  );

  return (
    <>
      <style>{ANALYTICS_CSS}</style>

      <div className="page-header">
        <div>
          <div className="eyebrow">
            Performance Analytics
          </div>

          <h1 className="page-title">
            DTN Network Analytics
          </h1>

          <p className="page-description">
            Observe message delivery, communication availability,
            routing efficiency and reliability during simulation.
          </p>
        </div>
      </div>

      <div className="metric-grid">
        {metrics.map((metric) => (
          <div
            className="metric-card"
            key={metric.label}
          >
            <div className="metric-label">
              {metric.label}
            </div>

            <div className="metric-value">
              {metric.value.toFixed(
                metric.digits ?? (metric.unit === "%" ? 1 : 2)
              )}
              {metric.unit}
            </div>

            <div className="metric-foot">
              {metric.foot || "current simulation"}
            </div>
          </div>
        ))}
      </div>

      <div className="analytics-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Message Outcomes
              </h2>

              <p className="card-subtitle">
                Current simulation distribution
              </p>
            </div>
          </div>

          <div className="card-body">
            <div className="bar-chart">
              {counts.map(([label, value]) => {
                const numericValue = Number(value);

                const height =
                  numericValue === 0
                    ? 2
                    : (numericValue / maxCount) * 150;

                return (
                  <div
                    className="bar-column"
                    key={label}
                  >
                    <div className="bar-value">
                      {numericValue}
                    </div>

                    <div
                      className="bar"
                      style={{
                        height: `${height}px`,
                      }}
                    />

                    <div className="bar-label">
                      {label}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Reliability Indicators
              </h2>

              <p className="card-subtitle">
                Integrity and duplicate protection
              </p>
            </div>
          </div>

          <div className="card-body">
            <div className="metric-list">
              <div className="metric-mini">
                <div className="metric-mini-label">
                  Integrity Failures
                </div>

                <div className="metric-mini-value">
                  {stats.integrity_failures || 0}
                </div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">
                  Duplicate Deliveries
                </div>

                <div className="metric-mini-value">
                  {stats.duplicates || 0}
                </div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">
                  Critical Messages
                </div>

                <div className="metric-mini-value">
                  {stats.critical_messages || 0}
                </div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">
                  Simulation Time
                </div>

                <div className="metric-mini-value">
                  T+{stats.simulation_time || 0}
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Delivery by Priority Class
              </h2>

              <p className="card-subtitle">
                Priority scheduling shows up here: urgent
                traffic should arrive sooner, at some cost to
                routine traffic.
              </p>
            </div>
          </div>

          <div className="card-body">
            {Object.keys(classBreakdown).length === 0 ? (
              <div className="an-empty">
                No messages yet.
              </div>
            ) : (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Class</th>
                      {CLASS_COLUMNS.map(([key, label]) => (
                        <th key={key}>{label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(classBreakdown).map(
                      ([name, row]) => (
                        <tr key={name}>
                          <td>
                            <strong>{name}</strong>
                          </td>
                          {CLASS_COLUMNS.map(([key]) => (
                            <td key={key}>{row[key]}</td>
                          ))}
                        </tr>
                      )
                    )}
                  </tbody>
                </table>
              </div>
            )}

            {Object.keys(dropped).length > 0 && (
              <div className="an-chips">
                {Object.entries(dropped).map(
                  ([reason, count]) => (
                    <div className="an-chip" key={reason}>
                      <strong>{count}</strong>
                      {DROP_REASONS[reason] || reason}
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Link Utilization
              </h2>

              <p className="card-subtitle">
                Slots used out of slots available while each
                link was up.
              </p>
            </div>
          </div>

          <div className="card-body">
            {linkIds.length === 0 ? (
              <div className="an-empty">
                Utilization appears once traffic is moving.
              </div>
            ) : (
              linkIds.map((id) => {
                const item = utilization[id];
                const value = Number(item.utilization || 0);
                const link = links[id];

                return (
                  <div className="an-util-row" key={id}>
                    <span>
                      <strong>{id}</strong>
                      {link && (
                        <small>
                          {link.source} – {link.target}
                        </small>
                      )}
                    </span>

                    <div className="an-track">
                      <div
                        className={`an-fill ${
                          value >= 90
                            ? "hot"
                            : value >= 60
                            ? "warm"
                            : ""
                        }`}
                        style={{
                          width: `${Math.min(100, value)}%`,
                        }}
                      />
                    </div>

                    <em>
                      {value.toFixed(0)}% · peak{" "}
                      {item.peak_load}
                    </em>
                  </div>
                );
              })
            )}
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Store-and-Forward Buffers
              </h2>

              <p className="card-subtitle">
                Most messages each relay held at once, against
                its buffer limit.
              </p>
            </div>
          </div>

          <div className="card-body">
            {nodeIds.map((id) => {
              const held = Number(peakBuffer[id] || 0);
              const percent = bufferLimit
                ? Math.min(100, (held / bufferLimit) * 100)
                : 0;

              return (
                <div className="an-util-row" key={id}>
                  <span>
                    <strong>{id}</strong>
                  </span>

                  <div className="an-track">
                    <div
                      className={`an-fill ${
                        percent >= 90
                          ? "hot"
                          : percent >= 60
                          ? "warm"
                          : ""
                      }`}
                      style={{ width: `${percent}%` }}
                    />
                  </div>

                  <em>
                    {held} / {bufferLimit || "—"}
                  </em>
                </div>
              );
            })}

            <div className="an-chips">
              <div className="an-chip">
                <strong>{stats.buffer_blocked || 0}</strong>
                sends blocked by a full buffer
              </div>

              <div className="an-chip">
                <strong>{stats.buffer_evictions || 0}</strong>
                low-priority evictions
              </div>

              <div className="an-chip">
                <strong>
                  {stats.disruption_ticks || 0}
                </strong>
                ticks with a link down
              </div>

              <div className="an-chip">
                <strong>
                  {stats.total_stored_ticks || 0}
                </strong>
                message-ticks held in storage
              </div>
            </div>
          </div>
        </section>

        <section className="card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                DTN Performance Interpretation
              </h2>

              <p className="card-subtitle">
                What these metrics represent
              </p>
            </div>
          </div>

          <div className="card-body">
            <div className="dashboard-grid">
              <div>
                <div className="metric-label">
                  DELIVERY
                </div>

                <p className="page-description">
                  Delivery rate measures the proportion of
                  messages that successfully reach their
                  destination.
                </p>
              </div>

              <div>
                <div className="metric-label">
                  AVAILABILITY
                </div>

                <p className="page-description">
                  Network availability reflects the proportion of
                  communication links currently operational.
                </p>
              </div>

              <div>
                <div className="metric-label">
                  ROUTING
                </div>

                <p className="page-description">
                  Average hops indicates how many forwarding
                  operations are required to move messages through
                  the network.
                </p>
              </div>

              <div>
                <div className="metric-label">
                  INTEGRITY
                </div>

                <p className="page-description">
                  SHA-256 payload verification helps detect
                  corruption, while duplicate tracking prevents
                  repeated delivery from being counted as a
                  successful unique message.
                </p>
              </div>

              <div>
                <div className="metric-label">
                  UTILIZATION
                </div>

                <p className="page-description">
                  Link utilization is the share of link slots
                  used while a link was up. Low values mean idle
                  capacity; very high values mean contention,
                  where priority decides who goes first.
                </p>
              </div>

              <div>
                <div className="metric-label">
                  STORE-AND-FORWARD
                </div>

                <p className="page-description">
                  Messages with no usable route wait in a relay
                  buffer and continue when a link returns.
                  Delivered After Storage counts the bundles that
                  survived an outage this way.
                </p>
              </div>
            </div>
          </div>
        </section>
      </div>
    </>
  );
}

export default Analytics;
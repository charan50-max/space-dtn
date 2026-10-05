import { useEffect, useState } from "react";

import StatusBadge from "../components/StatusBadge";

// This page talks to the compare endpoints directly so it does not depend
// on api.js. If api.js uses a different base URL, change it here too.
const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const COMPARE_URL = `${API_BASE}/api/simulation/compare`;

const FALLBACK_POSITIONS = {
  "GS-1": [10, 82],
  "SAT-1": [25, 55],
  "SAT-2": [45, 30],
  "SAT-3": [65, 55],
  "SAT-4": [45, 75],
  "SAT-5": [82, 30],
  "GS-2": [90, 75],
};

const DONE = ["delivered", "dropped"];

async function request(path, method = "GET") {
  const response = await fetch(`${COMPARE_URL}${path}`, { method });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }

  return response.json();
}

// ------------------------------------------------------------------
// Narration: one plain sentence describing what is happening right now
// ------------------------------------------------------------------

function narrate(data) {
  const { scenario, baseline, adaptive, finished } = data;
  const tick = adaptive.time;
  const bStats = baseline.statistics;
  const aStats = adaptive.statistics;

  const link = adaptive.network.links.find(
    (item) => item.id === scenario.fail_link
  );
  const failedLink = link
    ? `${scenario.fail_link} (${link.source} to ${link.target})`
    : scenario.fail_link;

  if (finished) {
    return (
      `Finished. The urgent message arrived after ${aStats.urgent_avg_delay} ticks ` +
      `with Space DTN and ${bStats.urgent_avg_delay} ticks with the baseline. ` +
      `Both networks delivered every message.`
    );
  }

  if (tick === 0) {
    return (
      `${scenario.message_count} messages are waiting at ${scenario.source}: ` +
      `five low-priority and one urgent message that was queued last. ` +
      `Each link carries ${scenario.link_capacity} messages per tick. ` +
      `Press Step or Play.`
    );
  }

  if (tick < scenario.fail_tick) {
    return (
      "Both networks send over the same links. The baseline sends in arrival " +
      "order, so the urgent message is still at the back of its queue. " +
      "Space DTN sent it first."
    );
  }

  if (tick < scenario.restore_tick) {
    return (
      `Link ${failedLink} has failed. The baseline's plan has no other route, ` +
      `so its messages wait in storage. Space DTN recalculates from live link ` +
      `state and sends traffic around the failure.`
    );
  }

  const adaptiveDone = aStats.delivered === aStats.total_messages;

  return (
    `Link ${scenario.fail_link} is back. The baseline resumes and works through ` +
    `its queue in order. ` +
    (adaptiveDone
      ? "Space DTN has already delivered everything."
      : "Space DTN is still finishing its deliveries.")
  );
}

// ------------------------------------------------------------------
// Small network drawing: links change colour, messages show as counts
// ------------------------------------------------------------------

function MiniNetwork({ sim, urgentId }) {
  const nodes = sim.network.nodes;
  const links = sim.network.links;
  const messages = sim.messages;

  const position = {};
  nodes.forEach((node) => {
    const fallback = FALLBACK_POSITIONS[node.id] || [50, 50];
    position[node.id] = [
      Number.isFinite(node.x) ? node.x : fallback[0],
      Number.isFinite(node.y) ? node.y : fallback[1],
    ];
  });

  const waitingAt = {};
  const deliveredAt = {};

  messages.forEach((message) => {
    // The replayed duplicate is not one of the six scenario messages.
    if (message.copy_of) return;

    if (message.status === "delivered") {
      deliveredAt[message.current_node] =
        (deliveredAt[message.current_node] || 0) + 1;
    } else if (message.status !== "dropped") {
      waitingAt[message.current_node] =
        (waitingAt[message.current_node] || 0) + 1;
    }
  });

  const urgent = messages.find((message) => message.id === urgentId);

  function linkColour(link) {
    if (!link.active) return "#f87171";
    if (link.congestion >= 50) return "#fbbf24";
    return "rgba(34, 211, 238, 0.55)";
  }

  return (
    <svg
      className="cmp-network"
      viewBox="0 0 100 100"
      role="img"
      aria-label="Network state"
    >
      {links.map((link) => {
        const from = position[link.source];
        const to = position[link.target];
        if (!from || !to) return null;

        const midX = (from[0] + to[0]) / 2;
        const midY = (from[1] + to[1]) / 2;

        return (
          <g key={link.id}>
            <line
              x1={from[0]}
              y1={from[1]}
              x2={to[0]}
              y2={to[1]}
              stroke={linkColour(link)}
              strokeWidth={link.active ? 0.7 : 1}
              strokeDasharray={link.active ? undefined : "2 1.5"}
            />
            {!link.active && (
              <text
                x={midX}
                y={midY - 1.5}
                textAnchor="middle"
                fontSize="3.2"
                fill="#f87171"
                fontWeight="700"
              >
                {link.id} down
              </text>
            )}
          </g>
        );
      })}

      {nodes.map((node) => {
        const [x, y] = position[node.id];
        const isGround = node.node_type === "ground";
        const waiting = waitingAt[node.id] || 0;
        const delivered = deliveredAt[node.id] || 0;
        const hasUrgent =
          urgent &&
          urgent.current_node === node.id &&
          urgent.status !== "dropped";

        return (
          <g key={node.id}>
            {hasUrgent && (
              <circle
                cx={x}
                cy={y}
                r="7"
                fill="none"
                stroke={urgent.status === "delivered" ? "#34d399" : "#fbbf24"}
                strokeWidth="1"
              />
            )}

            <circle
              cx={x}
              cy={y}
              r="4.2"
              fill={isGround ? "#a78bfa" : "#e2e8f0"}
              stroke="#0b1020"
              strokeWidth="0.8"
            />

            <text
              x={x}
              y={y + 10.5}
              textAnchor="middle"
              fontSize="3.4"
              fill="#cbd5e1"
              fontWeight="600"
            >
              {node.id}
            </text>

            {waiting > 0 && (
              <g>
                <circle cx={x + 5} cy={y - 5} r="2.8" fill="#fbbf24" />
                <text
                  x={x + 5}
                  y={y - 3.9}
                  textAnchor="middle"
                  fontSize="3.2"
                  fill="#0b1020"
                  fontWeight="800"
                >
                  {waiting}
                </text>
              </g>
            )}

            {delivered > 0 && (
              <g>
                <circle cx={x - 5} cy={y - 5} r="2.8" fill="#34d399" />
                <text
                  x={x - 5}
                  y={y - 3.9}
                  textAnchor="middle"
                  fontSize="3.2"
                  fill="#0b1020"
                  fontWeight="800"
                >
                  {delivered}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ------------------------------------------------------------------
// One side of the comparison
// ------------------------------------------------------------------

function ModePanel({ title, subtitle, sim, urgentId, tone }) {
  const stats = sim.statistics;
  const urgent = sim.messages.find((message) => message.id === urgentId);

  let urgentText = "not created";
  if (urgent) {
    urgentText =
      urgent.status === "delivered"
        ? `arrived after ${urgent.delay} ticks`
        : `${urgent.status.replace("_", " ")} at ${urgent.current_node}`;
  }

  return (
    <section className={`card cmp-panel cmp-${tone}`}>
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="card-body">
        <MiniNetwork sim={sim} urgentId={urgentId} />

        <div className="cmp-legend">
          <span>
            <i className="cmp-dot cmp-dot-wait" /> waiting at node
          </span>
          <span>
            <i className="cmp-dot cmp-dot-done" /> delivered
          </span>
          <span>
            <i className="cmp-ring" /> urgent message
          </span>
        </div>

        <div className="cmp-urgent-line">
          <span>Urgent message</span>
          <strong>{urgentText}</strong>
        </div>

        <div className="cmp-mini-stats">
          <div>
            <small>Delivered</small>
            <strong>
              {stats.delivered}/{stats.total_messages}
            </strong>
          </div>
          <div>
            <small>In storage</small>
            <strong>{stats.stored}</strong>
          </div>
          <div>
            <small>Dropped</small>
            <strong>{stats.dropped}</strong>
          </div>
          <div>
            <small>Duplicates rejected</small>
            <strong>{stats.duplicates}</strong>
          </div>
        </div>

        <div className="table-wrapper">
          <table className="data-table">
            <thead>
              <tr>
                <th>Message</th>
                <th>Priority</th>
                <th>Now at</th>
                <th>Status</th>
                <th>Ticks</th>
              </tr>
            </thead>
            <tbody>
              {sim.messages
                .filter((message) => !message.copy_of)
                .map((message) => (
                <tr key={message.id}>
                  <td className="mono">{message.id}</td>
                  <td>
                    {message.priority_class} · {Math.round(message.priority_score)}
                  </td>
                  <td>{message.current_node}</td>
                  <td>
                    <StatusBadge status={message.status} />
                  </td>
                  <td>{message.delay}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="cmp-events">
          {sim.events.slice(0, 5).map((event, index) => (
            <div className="cmp-event" key={`${event.time}-${index}`}>
              <span>T+{event.time}</span>
              {event.event}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// Scoreboard
// ------------------------------------------------------------------

const STRATEGIES = [
  ["baseline", "Baseline"],
  ["reroute", "FIFO + live routing"],
  ["adaptive", "Space DTN"],
];

const signed = (value) => {
  if (value === null || value === undefined) return "—";
  const number = Number(value);
  return `${number > 0 ? "+" : ""}${number}`;
};

function Scoreboard({ data }) {
  // "reroute" is missing if the backend predates the three-strategy update.
  const columns = STRATEGIES.filter(([key]) => data[key]);

  const rows = [
    [
      "Urgent message arrives (ticks)",
      (s) => (s.urgent_delivered ? s.urgent_avg_delay : "waiting"),
    ],
    [
      "Average delivery time (ticks)",
      (s) => (s.delivered ? Number(s.average_delay).toFixed(1) : "none yet"),
    ],
    ["Delivered", (s) => `${s.delivered}/${s.total_messages}`],
    ["Dropped", (s) => s.dropped],
    ["Duplicate copies rejected", (s) => s.duplicates],
    [
      "Link utilization (%)",
      (s) => Number(s.link_utilization ?? 0).toFixed(1),
    ],
    [
      "Average path latency (sim-ms)",
      (s) =>
        s.delivered ? Number(s.average_path_latency_ms ?? 0).toFixed(1) : "none yet",
    ],
    [
      "Delivered after waiting in storage",
      (s) => s.delivered_after_storage ?? 0,
    ],
  ];

  const routingSaved = data.delta_routing?.urgent_delay_saved;
  const prioritySaved = data.delta_priority?.urgent_delay_saved;
  const hasAttribution =
    typeof routingSaved === "number" && typeof prioritySaved === "number";

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Scoreboard</h2>
          <p className="card-subtitle">
            Same messages, same link failure, different decisions.
          </p>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="data-table">
          <thead>
            <tr>
              <th>Measure</th>
              {columns.map(([key, label]) => (
                <th key={key}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, read]) => (
              <tr key={label}>
                <td>{label}</td>
                {columns.map(([key]) => (
                  <td key={key}>
                    {key === "adaptive" ? (
                      <strong>{read(data[key].statistics)}</strong>
                    ) : (
                      read(data[key].statistics)
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data.finished && data.delta.urgent_delay_saved !== null && (
        <div className="card-body cmp-result">
          The urgent message arrived {data.delta.urgent_delay_saved} ticks
          sooner and average delivery was {data.delta.average_delay_saved}{" "}
          ticks faster.{" "}
          {data.delta.delivery_rate_gain === 0
            ? "Delivery rate was the same: the gain is time, not lost data."
            : `Delivery rate changed by ${signed(data.delta.delivery_rate_gain)} points.`}
          {hasAttribution && (
            <>
              {" "}
              Where it comes from: live routing alone moved the urgent message{" "}
              {Math.abs(routingSaved)} ticks {routingSaved >= 0 ? "sooner" : "later"}
              , and priority scheduling a further {Math.abs(prioritySaved)} ticks{" "}
              {prioritySaved >= 0 ? "sooner" : "later"}.
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------------
// Link utilization: slots used / slots available while the link was up
// ------------------------------------------------------------------

function UtilizationCard({ data }) {
  const columns = STRATEGIES.filter(([key]) => data[key]);
  const reference = data.adaptive.statistics.link_utilization_by_link;

  if (!reference) return null;

  const linkIds = Object.keys(reference).sort(
    (a, b) => Number(a.replace(/\D/g, "")) - Number(b.replace(/\D/g, ""))
  );

  const links = Object.fromEntries(
    data.adaptive.network.links.map((link) => [link.id, link])
  );

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Link utilization</h2>
          <p className="card-subtitle">
            Share of link slots actually used while each link was up. Idle
            links are wasted capacity; a busy detour link shows rerouting at
            work.
          </p>
        </div>
      </div>

      <div className="card-body">
        <div className="cmp-util-head">
          <span />
          {columns.map(([key, label]) => (
            <div key={key} className={`cmp-util-title cmp-fill-${key}-text`}>
              {label}
              <strong>
                {Number(data[key].statistics.link_utilization ?? 0).toFixed(1)}%
              </strong>
            </div>
          ))}
        </div>

        {linkIds.map((id) => {
          const link = links[id];

          return (
            <div className="cmp-util-row" key={id}>
              <span className="cmp-util-link">
                {id}
                {link && (
                  <small>
                    {link.source} – {link.target}
                  </small>
                )}
              </span>

              {columns.map(([key]) => {
                const item =
                  data[key].statistics.link_utilization_by_link?.[id] || {};
                const value = Number(item.utilization || 0);

                return (
                  <div className="cmp-util-cell" key={key}>
                    <div className="cmp-barwrap">
                      <div
                        className={`cmp-barfill cmp-fill-${key}`}
                        style={{ width: `${Math.min(100, value)}%` }}
                      />
                    </div>
                    <em>{value.toFixed(0)}%</em>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// Statistical benchmark: many seeded random outage patterns
// ------------------------------------------------------------------

const BENCH_ROWS = [
  ["urgent_avg_delay", "Urgent message delay (ticks)"],
  ["average_delay", "Average delay (ticks)"],
  ["delivery_rate", "Delivery rate (%)"],
  ["urgent_delivery_rate", "Urgent delivery rate (%)"],
  ["link_utilization", "Link utilization (%)"],
  ["average_path_latency_ms", "Path latency (sim-ms)"],
  ["dropped", "Messages dropped"],
  ["buffer_blocked", "Sends blocked by full buffers"],
  ["buffer_evictions", "Low-priority evictions"],
  ["delivered_after_storage", "Delivered after waiting in storage"],
];

const plusMinus = (stat) => {
  if (!stat || stat.mean === null || stat.mean === undefined) return "—";
  return stat.ci95 > 0 ? `${stat.mean} ± ${stat.ci95}` : `${stat.mean}`;
};

function benchmarkFindings(result) {
  const { adaptive_vs_baseline: ab, reroute_vs_baseline: rb, adaptive_vs_reroute: ar } =
    result.improvement;

  const record = (item) => {
    const r = item.urgent_delay_seed_record;
    const n = r.wins + r.ties + r.losses;
    return n ? `${r.wins} of ${n} runs` : null;
  };

  const lines = [];

  if (ab.urgent_delay_reduction_pct !== null) {
    lines.push(
      `Space DTN delivers urgent messages ${ab.urgent_delay_reduction_pct}% sooner than the baseline` +
        (record(ab) ? ` (faster in ${record(ab)})` : "") +
        `, and moves delivery rate by ${signed(ab.delivery_rate_gain_pp)} points.`
    );
  }

  if (rb.urgent_delay_saved_ticks !== null) {
    lines.push(
      `Routing effect (FIFO order, live routing vs the fixed plan): urgent delay changes by ${signed(
        -rb.urgent_delay_saved_ticks
      )} ticks (negative is faster), delivery rate ${signed(rb.delivery_rate_gain_pp)} points, ${
        rb.drops_avoided
      } fewer drops per run.`
    );
  }

  if (ar.urgent_delay_saved_ticks !== null) {
    const low = {
      adaptive: result.summary.adaptive.class_avg_delay?.LOW,
      reroute: result.summary.reroute.class_avg_delay?.LOW,
    };
    const cost =
      low.adaptive != null && low.reroute != null
        ? Math.round((low.adaptive - low.reroute) * 100) / 100
        : null;

    lines.push(
      `Priority effect (adding TinyML scheduling on top of live routing): urgent messages arrive ${ar.urgent_delay_saved_ticks} ticks sooner` +
        (cost !== null
          ? `, while routine messages wait ${Math.abs(cost)} ticks ${
              cost >= 0 ? "longer" : "less"
            }. That is the trade-off.`
          : ".")
    );
  }

  return lines;
}

function Benchmark() {
  const [params, setParams] = useState({
    seeds: 20,
    messages: 36,
    buffer_capacity: 10,
  });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  function change(event) {
    const { name, value } = event.target;
    setParams((current) => ({ ...current, [name]: Number(value) }));
  }

  async function run() {
    try {
      setBusy(true);
      setError("");
      const query = new URLSearchParams(params).toString();
      setResult(await request(`/benchmark?${query}`, "GET"));
    } catch (err) {
      console.error(err);
      setError(err.message || "Benchmark failed.");
    } finally {
      setBusy(false);
    }
  }

  const classes = result
    ? Object.keys(result.summary.adaptive.class_avg_delay || {})
    : [];

  const maxDelay = result
    ? Math.max(
        1,
        ...STRATEGIES.flatMap(([key]) =>
          classes.map((name) => result.summary[key].class_avg_delay[name] || 0)
        )
      )
    : 1;

  return (
    <section className="card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Statistical benchmark</h2>
          <p className="card-subtitle">
            One scripted failure proves a point; this tests it. Every strategy
            faces identical seeded traffic and identical random link outages
            and congestion bursts, repeated over many runs.
          </p>
        </div>

        <button className="primary-button" onClick={run} disabled={busy}>
          {busy ? "Running…" : result ? "Run again" : "Run benchmark"}
        </button>
      </div>

      <div className="card-body">
        <div className="cmp-bench-controls">
          <label>
            <span>Runs (random seeds)</span>
            <select name="seeds" value={params.seeds} onChange={change}>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
          </label>

          <label>
            <span>Messages per run</span>
            <select name="messages" value={params.messages} onChange={change}>
              <option value={24}>24</option>
              <option value={36}>36</option>
              <option value={60}>60</option>
            </select>
          </label>

          <label>
            <span>Relay buffer size</span>
            <select
              name="buffer_capacity"
              value={params.buffer_capacity}
              onChange={change}
            >
              <option value={10}>Roomy (10)</option>
              <option value={4}>Tight (4)</option>
            </select>
          </label>
        </div>

        {error && <div className="cmp-error">{error}</div>}

        {!result && !error && (
          <div className="cmp-note">
            Press Run benchmark. Results are means with a 95% confidence
            interval across runs.
          </div>
        )}

        {result && (
          <>
            <div className="cmp-note">
              {result.config.seeds} runs · {result.config.messages} messages ·{" "}
              {result.config.outages_per_run} random outages and{" "}
              {result.config.congestion_events_per_run} congestion bursts per
              run · link capacity {result.config.link_capacity} · relay buffer{" "}
              {result.config.buffer_capacity}
            </div>

            <div className="table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Measure (mean ± 95% CI)</th>
                    {STRATEGIES.map(([key, label]) => (
                      <th key={key}>{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {BENCH_ROWS.map(([metric, label]) => (
                    <tr key={metric}>
                      <td>{label}</td>
                      {STRATEGIES.map(([key]) => (
                        <td key={key}>
                          {key === "adaptive" ? (
                            <strong>{plusMinus(result.summary[key][metric])}</strong>
                          ) : (
                            plusMinus(result.summary[key][metric])
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {classes.length > 0 && (
              <div className="cmp-classbars">
                {classes.map((name) => (
                  <div className="cmp-classgroup" key={name}>
                    <h4>{name} messages: average delay (ticks)</h4>

                    {STRATEGIES.map(([key, label]) => {
                      const value = result.summary[key].class_avg_delay[name];

                      return (
                        <div className="cmp-barrow" key={key}>
                          <span>{label}</span>
                          <div className="cmp-barwrap">
                            <div
                              className={`cmp-barfill cmp-fill-${key}`}
                              style={{
                                width: `${
                                  value == null ? 0 : (value / maxDelay) * 100
                                }%`,
                              }}
                            />
                          </div>
                          <strong>{value ?? "—"}</strong>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            )}

            <ul className="cmp-findings">
              {benchmarkFindings(result).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            {result.config.buffer_capacity <= 4 && (
              <div className="cmp-note">
                With tight buffers, FIFO with live routing can gridlock: full
                buffers fill with messages that cannot move, and nothing
                evicts them. Priority-aware eviction is what keeps the Space
                DTN strategy moving.
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------------
// Page
// ------------------------------------------------------------------

function Compare() {
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState("");

  async function act(path, method = "POST") {
    try {
      setBusy(true);
      setError("");
      setData(await request(path, method));
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not reach the comparison service.");
      setPlaying(false);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    act("/state", "GET");
  }, []);

  // Play: one tick every 1.1 s until the scenario finishes.
  useEffect(() => {
    if (!playing || !data || busy) return undefined;

    if (data.finished) {
      setPlaying(false);
      return undefined;
    }

    const timer = setTimeout(() => act("/step"), 1100);
    return () => clearTimeout(timer);
  }, [playing, data, busy]);

  const finished = Boolean(data?.finished);

  return (
    <>
      <style>{COMPARE_CSS}</style>

      <div className="page-header">
        <div>
          <div className="eyebrow">Baseline vs Space DTN</div>
          <h1 className="page-title">What changes when a link fails</h1>
          <p className="page-description">
            The same six messages and the same link failure, run through two
            networks. One follows a fixed plan and sends in arrival order. The
            other reads live link state and sends urgent data first. A third
            strategy, FIFO with live routing, sits in the scoreboard so you can
            see how much comes from routing and how much from priority.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              setPlaying(false);
              act("/reset");
            }}
          >
            Reset
          </button>

          <button
            className="secondary-button"
            disabled={busy || finished || playing}
            onClick={() => act("/step")}
          >
            Step
          </button>

          <button
            className="secondary-button"
            disabled={busy || finished}
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? "Pause" : "Play"}
          </button>

          <button
            className="primary-button"
            disabled={busy || finished}
            onClick={() => {
              setPlaying(false);
              act("/run");
            }}
          >
            Run to the end
          </button>
        </div>
      </div>

      {error && (
        <div className="cmp-error">
          {error} Check that the backend is running at {API_BASE}.
        </div>
      )}

      {!data && !error && <div className="empty-state">Loading scenario…</div>}

      {data && (
        <>
          <div className="cmp-narration">
            <span className="cmp-tick">T+{data.adaptive.time}</span>
            <p>{narrate(data)}</p>
          </div>

          <div className="cmp-grid">
            <ModePanel
              title="Baseline"
              subtitle="Fixed plan, arrival order"
              sim={data.baseline}
              urgentId={data.scenario.urgent_id}
              tone="baseline"
            />
            <ModePanel
              title="Space DTN"
              subtitle="Live routing, TinyML priority"
              sim={data.adaptive}
              urgentId={data.scenario.urgent_id}
              tone="adaptive"
            />
          </div>

          <Scoreboard data={data} />

          <UtilizationCard data={data} />

          <Benchmark />

          <section className="card">
            <div className="card-header">
              <div>
                <h2 className="card-title">How the two networks decide</h2>
                <p className="card-subtitle">
                  What each side does when the same event happens.
                </p>
              </div>
            </div>

            <div className="card-body cmp-explain">
              <div>
                <h3>Baseline: current practice, simplified</h3>
                <ul>
                  <li>
                    Routes come from a plan made in advance for a healthy
                    network.
                  </li>
                  <li>
                    If a planned link is down, bundles wait in storage until
                    it returns.
                  </li>
                  <li>Bundles go out in the order they arrived.</li>
                </ul>
              </div>

              <div>
                <h3>Space DTN</h3>
                <ul>
                  <li>
                    Recalculates the route from the current node using live
                    latency, congestion and buffer cost.
                  </li>
                  <li>
                    A small TinyML model scores urgency, so urgent data takes
                    the first link slots.
                  </li>
                  <li>
                    Every delivery is checked for integrity, and duplicate
                    copies are rejected.
                  </li>
                </ul>
              </div>
            </div>

            <div className="card-body cmp-caveat">
              The baseline models a contact plan that has not yet been updated
              after an unplanned outage. Real operators can publish a new plan;
              this shows the gap before they do. It is a simplified model, not
              NASA ION or ESA software. Priority scores in this scenario are
              fixed inputs so the run repeats exactly; live TinyML scoring is
              on the Live Traffic page. Latency is scaled simulation time. The
              benchmark below repeats the comparison over many seeded random
              outage patterns so the result does not hinge on one scenario.
            </div>
          </section>
        </>
      )}
    </>
  );
}

const COMPARE_CSS = `
.cmp-util-head, .cmp-util-row {
  display: grid;
  grid-template-columns: 130px repeat(3, minmax(0, 1fr));
  gap: 14px; align-items: center;
}
.cmp-util-head { margin-bottom: 10px; }
.cmp-util-title { font-size: 12px; font-weight: 700; display: flex; flex-direction: column; gap: 2px; }
.cmp-util-title strong { font-size: 18px; color: inherit; }
.cmp-util-row { padding: 6px 0; border-top: 1px solid rgba(255,255,255,0.06); }
.cmp-util-link { font-size: 13px; font-weight: 700; }
.cmp-util-link small { display: block; font-size: 10px; font-weight: 500; opacity: 0.6; }
.cmp-util-cell { display: flex; align-items: center; gap: 8px; }
.cmp-util-cell em { font-style: normal; font-size: 11px; min-width: 32px; text-align: right; opacity: 0.8; }
.cmp-barwrap { flex: 1; height: 8px; border-radius: 999px; background: rgba(255,255,255,0.08); overflow: hidden; }
.cmp-barfill { height: 100%; border-radius: inherit; transition: width 0.5s ease; }
.cmp-fill-baseline { background: #94a3b8; }
.cmp-fill-reroute { background: #a78bfa; }
.cmp-fill-adaptive { background: #22d3ee; }
.cmp-fill-baseline-text { color: #94a3b8; }
.cmp-fill-reroute-text { color: #a78bfa; }
.cmp-fill-adaptive-text { color: #22d3ee; }
@media (max-width: 800px) {
  .cmp-util-head, .cmp-util-row { grid-template-columns: 70px repeat(3, minmax(0, 1fr)); gap: 8px; }
}
.cmp-bench-controls { display: flex; flex-wrap: wrap; gap: 14px; margin-bottom: 14px; }
.cmp-bench-controls label { display: flex; flex-direction: column; gap: 6px; min-width: 160px; }
.cmp-bench-controls span { font-size: 10px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; opacity: 0.6; }
.cmp-bench-controls select {
  min-height: 40px; padding: 0 10px; border-radius: 10px;
  border: 1px solid rgba(255,255,255,0.12); background: #000; color: inherit;
}
.cmp-note { font-size: 13px; line-height: 1.6; opacity: 0.7; margin: 10px 0; }
.cmp-classbars { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px; margin: 18px 0 6px; }
@media (max-width: 900px) { .cmp-classbars { grid-template-columns: 1fr; } }
.cmp-classgroup h4 { margin: 0 0 10px; font-size: 13px; }
.cmp-barrow { display: grid; grid-template-columns: 140px 1fr 42px; gap: 10px; align-items: center; padding: 4px 0; font-size: 12px; }
.cmp-barrow strong { text-align: right; }
.cmp-findings { margin: 14px 0 4px; padding-left: 18px; line-height: 1.65; font-size: 14px; }
.cmp-narration {
  display: flex;
  gap: 16px;
  align-items: center;
  padding: 16px 20px;
  margin-bottom: 20px;
  border: 1px solid rgba(34, 211, 238, 0.28);
  border-radius: 14px;
  background: rgba(34, 211, 238, 0.06);
}
.cmp-narration p { margin: 0; line-height: 1.55; font-size: 15px; }
.cmp-tick {
  flex: none;
  font-weight: 800;
  font-size: 18px;
  color: #22d3ee;
  min-width: 64px;
}
.cmp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 20px;
}
@media (max-width: 1100px) { .cmp-grid { grid-template-columns: 1fr; } }
.cmp-panel.cmp-baseline { border-top: 3px solid #94a3b8; }
.cmp-panel.cmp-adaptive { border-top: 3px solid #22d3ee; }
.cmp-network { width: 100%; max-height: 300px; display: block; }
.cmp-legend {
  display: flex; flex-wrap: wrap; gap: 16px;
  font-size: 12px; opacity: 0.75; margin: 6px 0 14px;
}
.cmp-legend span { display: inline-flex; align-items: center; gap: 6px; }
.cmp-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.cmp-dot-wait { background: #fbbf24; }
.cmp-dot-done { background: #34d399; }
.cmp-ring {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid #fbbf24; display: inline-block;
}
.cmp-urgent-line {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 10px 14px; margin-bottom: 12px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  border-radius: 10px; background: rgba(251, 191, 36, 0.06);
  font-size: 14px;
}
.cmp-mini-stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 10px; margin-bottom: 14px;
}
.cmp-mini-stats div {
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}
.cmp-mini-stats small { display: block; font-size: 11px; opacity: 0.65; }
.cmp-mini-stats strong { font-size: 18px; }
.cmp-events { margin-top: 14px; display: grid; gap: 4px; }
.cmp-event { font-size: 12px; opacity: 0.8; }
.cmp-event span { color: #22d3ee; margin-right: 8px; font-weight: 700; }
.cmp-result { font-size: 15px; line-height: 1.55; }
.cmp-explain {
  display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 24px;
}
@media (max-width: 900px) { .cmp-explain { grid-template-columns: 1fr; } }
.cmp-explain h3 { margin: 0 0 8px; font-size: 15px; }
.cmp-explain ul { margin: 0; padding-left: 18px; line-height: 1.6; font-size: 14px; }
.cmp-caveat { font-size: 13px; line-height: 1.6; opacity: 0.7; }
.cmp-error {
  padding: 12px 16px; margin-bottom: 16px; border-radius: 10px;
  border: 1px solid rgba(248, 113, 113, 0.5);
  background: rgba(248, 113, 113, 0.08); font-size: 14px;
}
`;

export default Compare;

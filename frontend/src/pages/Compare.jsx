import { useCallback, useEffect, useRef, useState } from "react";

// This page talks to the compare endpoints directly so it does not depend
// on api.js. If api.js uses a different base URL, change it here too.
const API_BASE = import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";
const COMPARE_URL = `${API_BASE}/api/simulation/compare`;

const FALLBACK_POSITIONS = {
  "GS-1": [8, 78],
  "SAT-1": [22, 52],
  "SAT-2": [40, 28],
  "SAT-3": [58, 52],
  "SAT-4": [40, 72],
  "SAT-5": [76, 28],
  "SAT-6": [22, 28],
  "SAT-7": [76, 72],
  "GS-2": [92, 72],
};

async function request(path, method = "GET") {
  const response = await fetch(`${COMPARE_URL}${path}`, { method });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status}) for ${path}`);
  }

  return response.json();
}

// ------------------------------------------------------------------
// Scenario phase helpers
// ------------------------------------------------------------------

function activeChips(data) {
  if (!data) return [];
  const { scenario, baseline, adaptive, finished } = data;
  const tick = adaptive.time;
  const chips = [];

  chips.push({ id: "plan", label: "Fixed plan", on: true, tone: "muted" });
  chips.push({ id: "live", label: "Live routing", on: true, tone: "cyan" });
  chips.push({ id: "fifo", label: "FIFO", on: true, tone: "muted" });
  chips.push({ id: "priority", label: "Priority", on: tick > 0 || finished, tone: "amber" });

  const linkDown =
    tick >= scenario.fail_tick && tick < scenario.restore_tick && !finished;
  chips.push({ id: "down", label: `${scenario.fail_link} down`, on: linkDown, tone: "red" });

  const congested =
    tick >= (scenario.congest_tick ?? scenario.fail_tick) &&
    tick < (scenario.congest_clear_tick ?? scenario.restore_tick) &&
    !finished;
  chips.push({
    id: "congest",
    label: `${scenario.congest_link || "L10"} congested`,
    on: congested,
    tone: "amber",
  });

  const stored =
    (baseline.statistics.stored || 0) > 0 || (adaptive.statistics.stored || 0) > 0;
  chips.push({ id: "storage", label: "In storage", on: stored, tone: "violet" });

  const dupes =
    (baseline.statistics.duplicates || 0) > 0 ||
    (adaptive.statistics.duplicates || 0) > 0;
  chips.push({ id: "dup", label: "Duplicate rejected", on: dupes, tone: "green" });

  return chips;
}

// ------------------------------------------------------------------
// Narration
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

  const congestLink = scenario.congest_link || "L10";

  if (finished) {
    const bothFull =
      bStats.delivered === bStats.total_messages &&
      aStats.delivered === aStats.total_messages;
    return (
      `Finished. The urgent message arrived after ${aStats.urgent_avg_delay} ticks ` +
      `with Space DTN and ${bStats.urgent_avg_delay} ticks with the baseline. ` +
      (bothFull
        ? "Both networks delivered every message."
        : `Baseline delivered ${bStats.delivered}/${bStats.total_messages}; ` +
          `Space DTN delivered ${aStats.delivered}/${aStats.total_messages}.`)
    );
  }

  if (tick === 0) {
    return (
      `${scenario.message_count} messages wait at ${scenario.source}: ` +
      `mostly low-priority traffic and an urgent message queued last. ` +
      `Each link carries ${scenario.link_capacity} messages per tick. ` +
      `Press Simulate to watch the run.`
    );
  }

  if (tick < scenario.fail_tick) {
    return (
      "Both networks use the same healthy links. The baseline sends in arrival " +
      "order, so the urgent message stays at the back of its queue. " +
      "Space DTN sent the urgent message first."
    );
  }

  if (tick < scenario.restore_tick) {
    return (
      `Link ${failedLink} has failed and ${congestLink} is congested. ` +
      `The baseline's fixed plan has no other route, so messages wait in storage. ` +
      `Space DTN recalculates from live latency, congestion and buffer cost, ` +
      `and steers around the outage.`
    );
  }

  const adaptiveDone = aStats.delivered === aStats.total_messages;
  const dupes = aStats.duplicates || 0;

  return (
    `Link ${scenario.fail_link} is back and congestion cleared. ` +
    `The baseline resumes its plan in arrival order. ` +
    (adaptiveDone
      ? "Space DTN has already delivered everything."
      : "Space DTN is still finishing deliveries.") +
    (dupes > 0 ? " A replayed urgent copy was rejected as a duplicate." : "")
  );
}

// ------------------------------------------------------------------
// Network drawing
// ------------------------------------------------------------------

function MiniNetwork({ sim, urgentId, plan, tone }) {
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
  const hopEdges = new Set();

  messages.forEach((message) => {
    if (message.copy_of) return;

        if (message.status === "delivered") {
      deliveredAt[message.current_node] =
        (deliveredAt[message.current_node] || 0) + 1;
    } else if (
      message.status !== "dropped" &&
      message.status !== "rejected"
    ) {
      waitingAt[message.current_node] =
        (waitingAt[message.current_node] || 0) + 1;
    }

    const path = message.route || [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const a = path[i];
      const b = path[i + 1];
      hopEdges.add(`${a}|${b}`);
      hopEdges.add(`${b}|${a}`);
    }
  });

  const planEdges = new Set();
  if (plan) {
    for (let i = 0; i < plan.length - 1; i += 1) {
      planEdges.add(`${plan[i]}|${plan[i + 1]}`);
      planEdges.add(`${plan[i + 1]}|${plan[i]}`);
    }
  }

  const urgent = messages.find((message) => message.id === urgentId);

  function linkColour(link) {
    if (!link.active) return "#f87171";
    if (link.congestion >= 50) return "#fbbf24";
    if (hopEdges.has(`${link.source}|${link.target}`)) {
      return tone === "adaptive" ? "#22d3ee" : "#94a3b8";
    }
    return "rgba(148, 163, 184, 0.28)";
  }

  function linkWidth(link) {
    if (!link.active) return 1.2;
    if (hopEdges.has(`${link.source}|${link.target}`)) return 1.1;
    if (planEdges.has(`${link.source}|${link.target}`)) return 0.85;
    return 0.55;
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
        const onPlan = planEdges.has(`${link.source}|${link.target}`);
        const used = hopEdges.has(`${link.source}|${link.target}`);

        return (
          <g key={link.id}>
            {onPlan && link.active && !used && (
              <line
                x1={from[0]}
                y1={from[1]}
                x2={to[0]}
                y2={to[1]}
                stroke="rgba(167, 139, 250, 0.35)"
                strokeWidth="1.6"
                strokeLinecap="round"
              />
            )}
            <line
              x1={from[0]}
              y1={from[1]}
              x2={to[0]}
              y2={to[1]}
              stroke={linkColour(link)}
              strokeWidth={linkWidth(link)}
              strokeDasharray={link.active ? undefined : "2 1.5"}
              strokeLinecap="round"
              className={
                !link.active
                  ? "cmp-link-down"
                  : link.congestion >= 50
                    ? "cmp-link-congest"
                    : undefined
              }
            />
            {!link.active && (
              <text
                x={midX}
                y={midY - 1.5}
                textAnchor="middle"
                fontSize="2.8"
                fill="#f87171"
                fontWeight="700"
                className="cmp-pulse-text"
              >
                {link.id} down
              </text>
            )}
            {link.active && link.congestion >= 50 && (
              <text
                x={midX}
                y={midY - 1.5}
                textAnchor="middle"
                fontSize="2.6"
                fill="#fbbf24"
                fontWeight="700"
              >
                {link.id} busy
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
                r="6.5"
                fill="none"
                stroke={urgent.status === "delivered" ? "#34d399" : "#fbbf24"}
                strokeWidth="1.1"
                className="cmp-urgent-pulse"
              />
            )}

            <circle
              cx={x}
              cy={y}
              r="3.6"
              fill={isGround ? "#a78bfa" : "#e2e8f0"}
              stroke="#0b1020"
              strokeWidth="0.7"
            />

            <text
              x={x}
              y={y + 8.8}
              textAnchor="middle"
              fontSize="2.9"
              fill="#cbd5e1"
              fontWeight="600"
            >
              {node.id}
            </text>

            {waiting > 0 && (
              <g>
                <circle cx={x + 4.2} cy={y - 4.2} r="2.4" fill="#fbbf24" />
                <text
                  x={x + 4.2}
                  y={y - 3.3}
                  textAnchor="middle"
                  fontSize="2.7"
                  fill="#0b1020"
                  fontWeight="800"
                >
                  {waiting}
                </text>
              </g>
            )}

            {delivered > 0 && (
              <g>
                <circle cx={x - 4.2} cy={y - 4.2} r="2.4" fill="#34d399" />
                <text
                  x={x - 4.2}
                  y={y - 3.3}
                  textAnchor="middle"
                  fontSize="2.7"
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
// Compact side panel
// ------------------------------------------------------------------

function ModePanel({ title, subtitle, sim, urgentId, tone, plan }) {
  const stats = sim.statistics;
  const urgent = sim.messages.find((message) => message.id === urgentId);

  let urgentText = "not created";
  if (urgent) {
    urgentText =
      urgent.status === "delivered"
        ? `arrived after ${urgent.delay} ticks`
        : `${urgent.status.replace("_", " ")} at ${urgent.current_node}`;
  }

  const dupFlash = (stats.duplicates || 0) > 0;

  return (
    <section className={`card cmp-panel cmp-${tone}`}>
      <div className="card-header">
        <div>
          <h2 className="card-title">{title}</h2>
          <p className="card-subtitle">{subtitle}</p>
        </div>
      </div>

      <div className="card-body cmp-panel-body">
        <MiniNetwork
          sim={sim}
          urgentId={urgentId}
          plan={plan}
          tone={tone}
        />

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
          <div className={dupFlash ? "cmp-dup-flash" : undefined}>
            <small>Duplicates rejected</small>
            <strong>{stats.duplicates}</strong>
          </div>
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
    <section className="card cmp-metrics-card">
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
// Link utilization
// ------------------------------------------------------------------

function UtilizationCard({ data, animateBars }) {
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
    <section className="card cmp-metrics-card">
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
                        className={`cmp-barfill cmp-fill-${key}${
                          animateBars ? "" : " cmp-barfill-instant"
                        }`}
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
// Statistical benchmark
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
    <section className="card cmp-metrics-card">
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
  const [animateBars, setAnimateBars] = useState(true);
  const playRef = useRef(false);
  const busyRef = useRef(false);

  const act = useCallback(async (path, method = "POST") => {
    try {
      busyRef.current = true;
      setBusy(true);
      setError("");
      const json = await request(path, method);
      setData(json);
      return json;
    } catch (err) {
      console.error(err);
      setError(err.message || "Could not reach the comparison service.");
      playRef.current = false;
      setPlaying(false);
      return null;
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      act("/state", "GET");
    }, 0);
    return () => clearTimeout(timer);
  }, [act]);

  // Play: one tick every 1.1 s until the scenario finishes.
  useEffect(() => {
    playRef.current = playing;
    if (!playing) return undefined;

    let cancelled = false;
    let timer;

    const tick = async () => {
      if (cancelled || !playRef.current || busyRef.current) return;

      const json = await act("/step");
      if (cancelled || !playRef.current) return;

      if (json?.finished) {
        playRef.current = false;
        setPlaying(false);
        return;
      }

      timer = setTimeout(tick, 1100);
    };

    timer = setTimeout(tick, 1100);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [playing, act]);

  const finished = Boolean(data?.finished);
  const chips = activeChips(data);
  const plan = data?.scenario?.baseline_plan;

  return (
    <>
      <style>{COMPARE_CSS}</style>

      <div className="page-header">
        <div>
          <div className="eyebrow">Baseline vs Space DTN</div>
          <h1 className="page-title">What changes when a link fails</h1>
          <p className="page-description">
            Watch the same messages cross a richer mesh. Baseline follows a
            fixed plan and arrival order. Space DTN reroutes live and sends
            urgent data first. Metrics below stay the same — press Simulate
            to see why they move.
          </p>
        </div>

        <div className="header-actions">
          <button
            className="secondary-button"
            disabled={busy}
            onClick={() => {
              playRef.current = false;
              setPlaying(false);
              setAnimateBars(false);
              act("/reset").then(() => {
                requestAnimationFrame(() => setAnimateBars(true));
              });
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

          {playing ? (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => {
                playRef.current = false;
                setPlaying(false);
              }}
            >
              Pause
            </button>
          ) : (
            <button
              className="primary-button"
              disabled={busy || finished}
              onClick={() => setPlaying(true)}
            >
              Simulate
            </button>
          )}

          <button
            className="secondary-button"
            disabled={busy || finished || playing}
            onClick={() => {
              playRef.current = false;
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
          <div className="cmp-hero">
            <div className="cmp-narration">
              <span className="cmp-tick">T+{data.adaptive.time}</span>
              <p>{narrate(data)}</p>
            </div>

            <div className="cmp-chips" aria-label="Active conditions">
              {chips.map((chip) => (
                <span
                  key={chip.id}
                  className={`cmp-chip cmp-chip-${chip.tone}${
                    chip.on ? " is-on" : ""
                  }`}
                >
                  {chip.label}
                </span>
              ))}
            </div>

            <div className="cmp-legend cmp-legend-shared">
              <span>
                <i className="cmp-dot cmp-dot-wait" /> waiting at node
              </span>
              <span>
                <i className="cmp-dot cmp-dot-done" /> delivered
              </span>
              <span>
                <i className="cmp-ring" /> urgent message
              </span>
              <span>
                <i className="cmp-line cmp-line-plan" /> baseline plan
              </span>
              <span>
                <i className="cmp-line cmp-line-used" /> path used
              </span>
              <span>
                <i className="cmp-line cmp-line-down" /> link down
              </span>
              <span>
                <i className="cmp-line cmp-line-busy" /> congested
              </span>
            </div>

            <div className="cmp-grid">
              <ModePanel
                title="Baseline"
                subtitle="Fixed plan, arrival order"
                sim={data.baseline}
                urgentId={data.scenario.urgent_id}
                tone="baseline"
                plan={plan}
              />
              <ModePanel
                title="Space DTN"
                subtitle="Live routing, TinyML priority"
                sim={data.adaptive}
                urgentId={data.scenario.urgent_id}
                tone="adaptive"
                plan={plan}
              />
            </div>

            <p className="cmp-caveat">
              Priority scores in this scenario are fixed so the run repeats
              exactly; live TinyML scoring is on the Live Traffic page.
              Latency is scaled simulation time. The scoreboard below includes
              FIFO with live routing so you can separate routing from priority.
              The benchmark further down repeats the comparison over many seeded
              random outage patterns.
            </p>
          </div>

          <div className="cmp-metrics">
            <Scoreboard data={data} />
            <UtilizationCard data={data} animateBars={animateBars} />
            <Benchmark />
          </div>
        </>
      )}
    </>
  );
}

const COMPARE_CSS = `
@keyframes cmp-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
@keyframes cmp-ring-pulse {
  0%, 100% { stroke-opacity: 1; }
  50% { stroke-opacity: 0.35; }
}
@keyframes cmp-dup-glow {
  0%, 100% { box-shadow: none; }
  50% { box-shadow: 0 0 0 1px rgba(52, 211, 153, 0.45); }
}

.cmp-hero {
  margin-bottom: 28px;
}
.cmp-metrics {
  display: grid;
  gap: 20px;
}
.cmp-metrics-card {
  border: 1px solid rgba(255, 255, 255, 0.08);
}

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
.cmp-barfill-instant { transition: none !important; }
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
  margin-bottom: 14px;
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

.cmp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 12px;
}
.cmp-chip {
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.1);
  opacity: 0.35;
  transition: opacity 0.25s ease, border-color 0.25s ease, background 0.25s ease;
}
.cmp-chip.is-on { opacity: 1; }
.cmp-chip-muted.is-on {
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.45);
  background: rgba(148, 163, 184, 0.1);
}
.cmp-chip-cyan.is-on {
  color: #22d3ee;
  border-color: rgba(34, 211, 238, 0.45);
  background: rgba(34, 211, 238, 0.1);
}
.cmp-chip-amber.is-on {
  color: #fbbf24;
  border-color: rgba(251, 191, 36, 0.45);
  background: rgba(251, 191, 36, 0.1);
}
.cmp-chip-red.is-on {
  color: #f87171;
  border-color: rgba(248, 113, 113, 0.5);
  background: rgba(248, 113, 113, 0.12);
  animation: cmp-pulse 1.4s ease-in-out infinite;
}
.cmp-chip-violet.is-on {
  color: #a78bfa;
  border-color: rgba(167, 139, 250, 0.45);
  background: rgba(167, 139, 250, 0.12);
}
.cmp-chip-green.is-on {
  color: #34d399;
  border-color: rgba(52, 211, 153, 0.5);
  background: rgba(52, 211, 153, 0.12);
  animation: cmp-pulse 1.4s ease-in-out infinite;
}

.cmp-legend-shared {
  display: flex; flex-wrap: wrap; gap: 14px 18px;
  font-size: 12px; opacity: 0.78; margin: 0 0 16px;
}
.cmp-legend-shared span { display: inline-flex; align-items: center; gap: 6px; }
.cmp-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; }
.cmp-dot-wait { background: #fbbf24; }
.cmp-dot-done { background: #34d399; }
.cmp-ring {
  width: 12px; height: 12px; border-radius: 50%;
  border: 2px solid #fbbf24; display: inline-block;
}
.cmp-line {
  width: 18px; height: 0;
  border-top: 2px solid currentColor;
  display: inline-block;
}
.cmp-line-plan { color: rgba(167, 139, 250, 0.8); border-top-width: 3px; }
.cmp-line-used { color: #22d3ee; }
.cmp-line-down { color: #f87171; border-top-style: dashed; }
.cmp-line-busy { color: #fbbf24; }

.cmp-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
  margin-bottom: 14px;
}
@media (max-width: 1100px) { .cmp-grid { grid-template-columns: 1fr; } }
.cmp-panel.cmp-baseline { border-top: 3px solid #94a3b8; }
.cmp-panel.cmp-adaptive { border-top: 3px solid #22d3ee; }
.cmp-panel-body { display: flex; flex-direction: column; gap: 12px; }
.cmp-network { width: 100%; height: auto; aspect-ratio: 1.35 / 1; max-height: 380px; display: block; }
.cmp-urgent-pulse { animation: cmp-ring-pulse 1.2s ease-in-out infinite; }
.cmp-pulse-text { animation: cmp-pulse 1.4s ease-in-out infinite; }
.cmp-link-down { filter: drop-shadow(0 0 1px rgba(248, 113, 113, 0.6)); }
.cmp-link-congest { filter: drop-shadow(0 0 1px rgba(251, 191, 36, 0.5)); }

.cmp-urgent-line {
  display: flex; justify-content: space-between; gap: 12px;
  padding: 10px 14px;
  border: 1px solid rgba(251, 191, 36, 0.35);
  border-radius: 10px; background: rgba(251, 191, 36, 0.06);
  font-size: 14px;
}
.cmp-mini-stats {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 10px;
}
@media (max-width: 700px) {
  .cmp-mini-stats { grid-template-columns: repeat(2, 1fr); }
}
.cmp-mini-stats div {
  padding: 10px 12px; border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
}
.cmp-mini-stats small { display: block; font-size: 11px; opacity: 0.65; }
.cmp-mini-stats strong { font-size: 18px; }
.cmp-dup-flash {
  border-color: rgba(52, 211, 153, 0.45) !important;
  background: rgba(52, 211, 153, 0.08) !important;
  animation: cmp-dup-glow 1.6s ease-in-out infinite;
}
.cmp-result { font-size: 15px; line-height: 1.55; }
.cmp-caveat { font-size: 13px; line-height: 1.6; opacity: 0.7; margin: 0; }
.cmp-error {
  padding: 12px 16px; margin-bottom: 16px; border-radius: 10px;
  border: 1px solid rgba(248, 113, 113, 0.5);
  background: rgba(248, 113, 113, 0.08); font-size: 14px;
}
`;

export default Compare;

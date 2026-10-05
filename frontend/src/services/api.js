const API_URL =
  import.meta.env.VITE_API_URL || "http://127.0.0.1:8000";

// One shared simulator for the whole app. Live Traffic, Simulation,
// Messages and Dashboard all read and write this same DTN instance, so a
// packet released on one page is the same packet drawn on the 3D map.
export const TRAFFIC_SIMULATION_ID = "traffic-demo";

const getSimulationId = () => TRAFFIC_SIMULATION_ID;

async function request(endpoint, options = {}) {
  const response = await fetch(`${API_URL}${endpoint}`, {
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    let message = `API request failed: ${response.status}`;
    try {
      const error = await response.json();
      message = error.detail || message;
    } catch {
      // Keep the default message.
    }
    throw new Error(message);
  }

  return response.json();
}

// ------------------------------------------------------------
// Existing simulation API
// ------------------------------------------------------------

export async function getState() {
  const simulationId = getSimulationId();
  return request(
    `/api/simulation/state?simulation_id=${encodeURIComponent(simulationId)}`
  );
}

export async function stepSimulation() {
  return request("/api/simulation/step", {
    method: "POST",
    body: JSON.stringify({ simulation_id: getSimulationId() }),
  });
}

export async function resetSimulation() {
  return request("/api/simulation/reset", {
    method: "POST",
    body: JSON.stringify({ simulation_id: getSimulationId() }),
  });
}

export async function adjustLinkLatency(linkId, delta) {
  return request("/api/simulation/link/latency", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      link_id: linkId,
      delta,
    }),
  });
}

export async function setLinkLatency(linkId, latency) {
  return request("/api/simulation/link/latency/set", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      link_id: linkId,
      latency,
    }),
  });
}

export async function adjustLinkCongestion(linkId, delta) {
  return request("/api/simulation/link/congestion", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      link_id: linkId,
      delta,
    }),
  });
}

export async function setLinkCongestion(linkId, congestion) {
  return request("/api/simulation/link/congestion/set", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      link_id: linkId,
      congestion,
    }),
  });
}

export async function resetLinkConditions(linkId) {
  return request("/api/simulation/link/reset", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      link_id: linkId,
    }),
  });
}

export async function disruptLink(linkId) {
  return setLinkLatency(linkId, 100);
}

export async function restoreLink(linkId) {
  return resetLinkConditions(linkId);
}

// Overlay the live link/node state of the shared simulator on top of the
// static network description, so latency, congestion and failed links are
// always current.
export function mergeNetwork(base, live) {
  if (!live) return base || null;
  if (!base) return live;

  const mergeList = (baseList = [], liveList = []) => {
    const liveById = Object.fromEntries(
      liveList.map((item) => [item.id, item])
    );

    return (baseList.length ? baseList : liveList).map((item) => ({
      ...item,
      ...(liveById[item.id] || {}),
    }));
  };

  return {
    ...base,
    parameters: live.parameters ?? base.parameters,
    nodes: mergeList(base.nodes, live.nodes),
    links: mergeList(base.links, live.links),
  };
}

export async function getNetwork() {
  const [base, live] = await Promise.all([
    request("/api/network"),
    getState().catch(() => null),
  ]);

  return mergeNetwork(base, live?.network);
}

export async function getMessages() {
  const simulationId = getSimulationId();
  return request(
    `/api/messages?simulation_id=${encodeURIComponent(simulationId)}`
  );
}

export async function predictPriority(data) {
  return request("/api/messages/predict", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function createMessage(data) {
  return request("/api/messages", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      ...data,
    }),
  });
}

// Duplicate-detection demo: send a copy of a delivered message again.
export async function replayBundle(messageId) {
  return request("/api/simulation/replay", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: getSimulationId(),
      message_id: messageId,
    }),
  });
}

export async function getMLStatus() {
  return request("/api/ml/status");
}

export async function getMLMetrics() {
  return request("/api/ml/metrics");
}

// ------------------------------------------------------------
// Stage 3 automatic traffic API
// ------------------------------------------------------------

export async function getTrafficSource() {
  return request("/api/traffic/source");
}

export async function startTraffic(
  simulationId = TRAFFIC_SIMULATION_ID
) {
  return request("/api/traffic/start", {
    method: "POST",
    body: JSON.stringify({ simulation_id: simulationId }),
  });
}

export async function stepTraffic(
  simulationId = TRAFFIC_SIMULATION_ID
) {
  return request("/api/traffic/step", {
    method: "POST",
    body: JSON.stringify({ simulation_id: simulationId }),
  });
}

export async function runTraffic(
  simulationId = TRAFFIC_SIMULATION_ID,
  maxSteps = 100
) {
  return request("/api/traffic/run", {
    method: "POST",
    body: JSON.stringify({
      simulation_id: simulationId,
      max_steps: maxSteps,
    }),
  });
}

export async function getTrafficState(
  simulationId = TRAFFIC_SIMULATION_ID
) {
  return request(
    `/api/traffic/state?simulation_id=${encodeURIComponent(simulationId)}`
  );
}

export async function resetTraffic(
  simulationId = TRAFFIC_SIMULATION_ID
) {
  return request("/api/traffic/reset", {
    method: "POST",
    body: JSON.stringify({ simulation_id: simulationId }),
  });
}

export async function checkBackend() {
  try {
    await request("/api/network");
    return true;
  } catch {
    return false;
  }
}

export { API_URL };

// Designated disruption demo links from the existing simulator:
// L4 is the primary transit hop SAT-3 ↔ SAT-5.
// L5 is the GS-2 access / min-cut hop SAT-5 ↔ GS-2.
export const DISRUPTION_CANDIDATES = ["L4", "L5"];

export function isDisruptionCandidate(linkId) {
  return DISRUPTION_CANDIDATES.includes(linkId);
}

export function maxLatencyOf(network) {
  return Number(network?.parameters?.max_latency || 100);
}

export function isLinkDown(link, network) {
  if (!link) return false;
  if (link.active === false) return true;
  return Number(link.latency || 0) >= maxLatencyOf(network);
}

export function describeLinkRisk(link, network, utilization) {
  if (!link) {
    return {
      risk: null,
      classification: "N/A",
      source: "Unavailable",
      horizon: "N/A",
    };
  }

  const down = isLinkDown(link, network);
  const congestion = Number(link.congestion);
  const util = Number(utilization);

  if (down) {
    return {
      risk: 100,
      classification: "HIGH",
      source: "Live link state (unusable / max latency)",
      horizon: "N/A",
    };
  }

  const risk = Number.isFinite(congestion) ? congestion : null;
  let classification = "LOW";
  const status = String(link.status || "").toUpperCase();

  if (status === "SEVERE_CONGESTION" || (risk !== null && risk >= 80)) {
    classification = "HIGH";
  } else if (status === "CONGESTED" || (risk !== null && risk >= 50)) {
    classification = "MEDIUM";
  }

  return {
    risk,
    classification,
    utilization: Number.isFinite(util) ? util : null,
    source: "Live simulator telemetry (congestion / latency)",
    horizon: "N/A",
  };
}

export function countNodes(network) {
  const nodes = network?.nodes || [];
  return {
    satellites: nodes.filter((node) => node.node_type === "satellite").length,
    stations: nodes.filter((node) => node.node_type === "ground").length,
    links: (network?.links || []).length,
  };
}

export function buffersByNode(messages) {
  const buckets = {};

  (messages || []).forEach((message) => {
    if (String(message.status).toLowerCase() !== "stored") return;
    const node = message.current_node || message.source;
    if (!buckets[node]) buckets[node] = [];
    buckets[node].push(message);
  });

  Object.values(buckets).forEach((list) => {
    list.sort(
      (a, b) => Number(b.priority_score || 0) - Number(a.priority_score || 0)
    );
  });

  return buckets;
}

export const MESSAGE_TYPES = [
  {
    id: "mission-critical",
    label: "Mission Critical",
    severity: "critical",
    mission_critical: true,
    anomaly: false,
  },
  {
    id: "health",
    label: "Spacecraft Health",
    severity: "high",
    mission_critical: false,
    anomaly: true,
  },
  {
    id: "command",
    label: "Command",
    severity: "high",
    mission_critical: true,
    anomaly: false,
  },
  {
    id: "navigation",
    label: "Navigation",
    severity: "medium",
    mission_critical: false,
    anomaly: false,
  },
  {
    id: "science",
    label: "Science Data",
    severity: "normal",
    mission_critical: false,
    anomaly: false,
  },
  {
    id: "telemetry",
    label: "Telemetry",
    severity: "normal",
    mission_critical: false,
    anomaly: false,
  },
  {
    id: "routine",
    label: "Routine",
    severity: "low",
    mission_critical: false,
    anomaly: false,
  },
];

export const DROP_REASONS = {
  ttl: "TTL expired",
  integrity: "SHA-256 mismatch (corrupted)",
  buffer_evicted: "Buffer full",
  duplicate: "Packet ID already processed",
  expired: "Retransmitted copy expired",
  unknown: "Other",
};

export function routeText(message) {
  const path = message?.route_path?.length
    ? message.route_path
    : message?.route;
  if (Array.isArray(path) && path.length > 0) return path.join(" → ");
  if (message?.source && message?.destination) {
    return `${message.source} → ${message.destination}`;
  }
  return "N/A";
}

export function integrityText(message) {
  if (!message) return "N/A";
  if (message.integrity_verified) return "Verified";
  if (message.reject_reason === "integrity") return "Failed";
  if (message.status === "rejected") return "Not checked";
  if (message.status === "dropped") return "Unavailable";
  return "Pending";
}

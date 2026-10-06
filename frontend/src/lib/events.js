export function classifyEvent(text) {
  const event = String(text || "");
  const upper = event.toUpperCase();

  if (upper.includes("DUPLICATE")) return "duplicate";
  if (upper.includes("INTEGRITY")) return "integrity";
  if (upper.includes("REROUTE") || upper.includes("RECALCUL")) return "reroute";
  if (upper.includes("STORED") || upper.includes("STORAGE") || upper.includes("BUFFER")) {
    return "buffer";
  }
  if (upper.includes("UNUSABLE") || upper.includes("DISRUPT") || upper.includes("FAILED")) {
    return "down";
  }
  if (upper.includes("RESTOR") || upper.includes("RESET")) return "restore";
  if (upper.includes("DELIVER")) return "delivered";
  if (upper.includes("HIGH") || upper.includes("PRIORITY") || upper.includes("URGENT")) {
    return "priority";
  }
  if (upper.includes("CONGEST") || upper.includes("RISK")) return "risk";
  return "info";
}

export function countReroutes(events) {
  return (events || []).filter((event) =>
    String(event.event || "").toUpperCase().startsWith("REROUTE")
  ).length;
}

export function latestOf(messages, test) {
  const list = (messages || []).filter(test);
  return list[0] || list[list.length - 1] || null;
}

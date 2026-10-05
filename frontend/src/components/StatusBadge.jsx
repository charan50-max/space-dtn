function StatusBadge({ status }) {
  const normalized = String(status || "unknown").toLowerCase();

  let className = "status-badge";

  if (normalized === "delivered") {
    className += " status-delivered";
  } else if (
    normalized === "stored" ||
    normalized === "queued"
  ) {
    className += " status-stored";
  } else if (normalized === "dropped") {
    className += " status-dropped";
  }

  return (
    <span className={className}>
      {normalized}
    </span>
  );
}

export default StatusBadge;
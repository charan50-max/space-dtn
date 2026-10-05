function MetricCard({ label, value, foot }) {
  return (
    <div className="metric-card">
      <div className="metric-label">{label}</div>

      <div className="metric-value">{value}</div>

      {foot && <div className="metric-foot">{foot}</div>}
    </div>
  );
}

export default MetricCard;
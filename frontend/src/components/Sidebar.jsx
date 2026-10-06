function Sidebar({ page, navigate, state }) {
  const items = [
    ["compare", "Compare"],
    ["dashboard", "Dashboard"],
    ["simulation", "Simulation"],
    ["messages", "Messages"],
    ["tinyml", "TinyML"],
    ["analytics", "Analytics"],
    ["live-traffic", "Live Traffic"],
  ];

  const availability =
    state?.statistics?.network_availability ?? 0;

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-orbit">
          <div className="brand-core" />
        </div>

        <div>
          <div className="brand-title">SOYUZ</div>
          <div className="brand-subtitle">SPACE DTN</div>
          <div className="brand-subtitle">
            ROUTING & PRIORITY ENGINE
          </div>
        </div>
      </div>

      <div className="nav-label">Mission Control</div>

      <nav className="nav-list">
        {items.map(([id, label]) => (
          <button
            key={id}
            className={`nav-button ${
              page === id ? "active" : ""
            }`}
            onClick={() => navigate(id)}
          >
            <span className="nav-icon" />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-status">
        <div className="sidebar-status-row">
          <div className="status-online">
            <span className="status-dot" />
            Network
          </div>

          <span className="status-value">
            {availability.toFixed(0)}%
          </span>
        </div>
      </div>
    </aside>
  );
}

export default Sidebar;
export function PageHeader({ eyebrow, title, subtitle, actions }) {
  return (
    <div className="page-header mission-header">
      <div>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-description">{subtitle}</p>}
      </div>
      {actions && <div className="header-actions">{actions}</div>}
    </div>
  );
}

export function MetricStrip({ items }) {
  return (
    <div className="mission-strip">
      {items.map((item) => (
        <div className="mission-strip-item" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value ?? "N/A"}</strong>
        </div>
      ))}
    </div>
  );
}

export function EventTimeline({ events, empty = "No live events yet." }) {
  const list = events || [];

  return (
    <section className="mission-timeline">
      <div className="mission-kicker">LIVE EVENTS</div>
      {list.length === 0 ? (
        <div className="empty-state">{empty}</div>
      ) : (
        <ol>
          {list.slice(0, 14).map((event, index) => (
            <li key={`${event.time}-${index}`}>
              <time>T+{event.time}</time>
              <span>{event.event}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

export function SignatureFlow({ steps }) {
  return (
    <div className="mission-signature">
      {steps.map((step, index) => (
        <div className="mission-signature-step" key={step.label}>
          <b>{step.label}</b>
          <span>{step.detail ?? "N/A"}</span>
          {index < steps.length - 1 && <i>↓</i>}
        </div>
      ))}
    </div>
  );
}

export function Drawer({ open, title, onClose, children, side = "right" }) {
  if (!open) return null;

  return (
    <aside className={`mission-drawer ${side}`}>
      <header>
        <strong>{title}</strong>
        <button type="button" className="tf-ghost" onClick={onClose}>
          Close
        </button>
      </header>
      <div className="mission-drawer-body">{children}</div>
    </aside>
  );
}

export function Kv({ label, value }) {
  return (
    <div className="mission-kv">
      <span>{label}</span>
      <strong>{value ?? "N/A"}</strong>
    </div>
  );
}

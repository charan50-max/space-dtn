import { useEffect, useState } from "react";

import StatusBadge from "../components/StatusBadge";
import DuplicateDemo from "../components/DuplicateDemo";
import "../components/dtn-callouts.css";

import {
  createMessage,
  getMessages,
  predictPriority,
} from "../services/api";

function Messages({ state, refreshState }) {
  const [messages, setMessages] = useState([]);

  const [form, setForm] = useState({
    source: "GS-1",
    destination: "GS-2",
    payload: "",
    severity: "normal",
    mission_critical: false,
    ttl: 20,
    anomaly: false,
  });

  const [prediction, setPrediction] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    loadMessages();
  }, [state]);

  async function loadMessages() {
    try {
      const data = await getMessages();

      if (Array.isArray(data)) {
        setMessages(data);
      } else {
        setMessages(data.messages || []);
      }
    } catch (err) {
      console.error(err);
    }
  }

  function updateField(event) {
    const { name, value, type, checked } = event.target;

    setForm((current) => ({
      ...current,
      [name]: type === "checkbox" ? checked : value,
    }));
  }

  async function handlePredict(event) {
    event.preventDefault();

    try {
      const result = await predictPriority({
        source: form.source,
        destination: form.destination,
        payload: form.payload,
        severity: form.severity,
        mission_critical: form.mission_critical,
        ttl: Number(form.ttl),
        anomaly: form.anomaly,
      });

      setPrediction(result);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleCreate(event) {
    event.preventDefault();

    if (!form.payload.trim()) {
      alert("Please enter a message payload.");
      return;
    }

    try {
      setSubmitting(true);

      await createMessage({
        ...form,
        ttl: Number(form.ttl),
      });

      setForm((current) => ({
        ...current,
        payload: "",
      }));

      setPrediction(null);

      await refreshState();
      await loadMessages();
    } catch (err) {
      alert(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  const currentMessages =
    state?.messages?.length > 0
      ? state.messages
      : messages;

  return (
    <>
      <div className="page-header">
        <div>
          <div className="eyebrow">
            Message Operations
          </div>

          <h1 className="page-title">
            Message Priority & Delivery
          </h1>

          <p className="page-description">
            Create spacecraft data messages and let the priority
            engine determine which information should receive
            transmission preference.
          </p>
        </div>
      </div>

      <div className="dashboard-grid">
        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Create Space Message
              </h2>

              <p className="card-subtitle">
                Priority prediction happens before insertion.
              </p>
            </div>
          </div>

          <div className="card-body">
            <form onSubmit={handleCreate}>
              <div className="form-grid">
                <div className="form-field">
                  <label className="form-label">
                    Source
                  </label>

                  <select
                    className="form-select"
                    name="source"
                    value={form.source}
                    onChange={updateField}
                  >
                    <option>GS-1</option>
                    <option>SAT-1</option>
                    <option>SAT-2</option>
                    <option>SAT-3</option>
                    <option>SAT-4</option>
                    <option>SAT-5</option>
                    <option>SAT-6</option>
                    <option>SAT-7</option>
                    <option>GS-2</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    Destination
                  </label>

                  <select
                    className="form-select"
                    name="destination"
                    value={form.destination}
                    onChange={updateField}
                  >
                    <option>GS-1</option>
                    <option>SAT-1</option>
                    <option>SAT-2</option>
                    <option>SAT-3</option>
                    <option>SAT-4</option>
                    <option>SAT-5</option>
                    <option>SAT-6</option>
                    <option>SAT-7</option>
                    <option>GS-2</option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    Severity
                  </label>

                  <select
                    className="form-select"
                    name="severity"
                    value={form.severity}
                    onChange={updateField}
                  >
                    <option value="normal">Normal</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High</option>
                    <option value="critical">
                      Critical
                    </option>
                  </select>
                </div>

                <div className="form-field">
                  <label className="form-label">
                    TTL
                  </label>

                  <input
                    className="form-input"
                    type="number"
                    min="1"
                    max="1000"
                    name="ttl"
                    value={form.ttl}
                    onChange={updateField}
                  />
                </div>

                <div className="form-field full">
                  <label className="form-label">
                    Payload
                  </label>

                  <textarea
                    className="form-textarea"
                    name="payload"
                    value={form.payload}
                    onChange={updateField}
                    placeholder="Enter spacecraft telemetry, command data, scientific data..."
                  />
                </div>

                <div className="form-field full">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      name="mission_critical"
                      checked={form.mission_critical}
                      onChange={updateField}
                    />

                    Mission-critical message
                  </label>
                </div>

                <div className="form-field full">
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      name="anomaly"
                      checked={form.anomaly}
                      onChange={updateField}
                    />

                    Associated with detected anomaly
                  </label>
                </div>

                <div className="form-field">
                  <button
                    className="secondary-button"
                    type="button"
                    onClick={handlePredict}
                  >
                    Predict Priority
                  </button>
                </div>

                <div className="form-field">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={submitting}
                  >
                    {submitting
                      ? "Creating..."
                      : "Create Message"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </section>

        <section className="card">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Priority Decision
              </h2>

              <p className="card-subtitle">
                Lightweight priority engine output
              </p>
            </div>
          </div>

          <div className="card-body">
            {!prediction ? (
              <div className="empty-state">
                Run a priority prediction to see the result.
              </div>
            ) : (
              <>
                <div className="metric-card">
                  <div className="metric-label">
                    Priority Score
                  </div>

                  <div className="metric-value">
                    {Number(
                      prediction.priority_score || 0
                    ).toFixed(1)}
                  </div>

                  <div className="metric-foot">
                    out of 100
                  </div>
                </div>

                <div style={{ height: 12 }} />

                <div className="card">
                  <div className="card-body">
                    <div className="metric-label">
                      Priority Class
                    </div>

                    <div
                      className={`metric-value priority-${String(
                        prediction.priority_class || "low"
                      ).toLowerCase()}`}
                    >
                      {prediction.priority_class}
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        </section>

        <div className="full-width">
          <DuplicateDemo state={state} refreshState={refreshState} />
        </div>

        <section className="card full-width">
          <div className="card-header">
            <div>
              <h2 className="card-title">
                Message Queue
              </h2>

              <p className="card-subtitle">
                Current messages in the DTN simulation.
              </p>
            </div>
          </div>

          <div className="table-wrapper">
            {currentMessages.length === 0 ? (
              <div className="empty-state">
                No messages have been created.
              </div>
            ) : (
              <table className="data-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Route</th>
                    <th>Priority</th>
                    <th>Status</th>
                    <th>Node</th>
                    <th>Hops</th>
                    <th>Integrity</th>
                  </tr>
                </thead>

                <tbody>
                  {currentMessages.map((message) => (
                    <tr key={message.id}>
                      <td className="mono">
                        {message.id}
                        {message.copy_of && (
                          <em className="dtn-copy-tag">copy</em>
                        )}
                      </td>

                      <td className="mono">
                        {message.source} →{" "}
                        {message.destination}
                      </td>

                      <td
                        className={`priority-${String(
                          message.priority_class || "low"
                        ).toLowerCase()}`}
                      >
                        {message.priority_class}
                        {" · "}
                        {message.priority_score}
                      </td>

                      <td>
                        {message.status === "rejected" ? (
                          <span className="dtn-badge rejected">
                            Rejected
                          </span>
                        ) : (
                          <StatusBadge
                            status={message.status}
                          />
                        )}
                      </td>

                      <td>{message.current_node}</td>

                      <td>{message.hops}</td>

                      <td>
                        {message.integrity_verified
                          ? "✓ Verified"
                          : message.status === "rejected"
                          ? "—"
                          : "Pending"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>
    </>
  );
}

export default Messages;
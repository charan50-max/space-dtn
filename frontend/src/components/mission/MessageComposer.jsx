import { useState } from "react";
import { createMessage, predictPriority } from "../../services/api";
import { MESSAGE_TYPES } from "../../lib/network.js";
import { urgencyPct } from "../../lib/values.js";

const SOURCES = ["SAT-1", "SAT-2", "SAT-3", "SAT-4", "SAT-5", "SAT-6", "SAT-7"];
const DESTINATIONS = ["GS-1", "GS-2"];

export default function MessageComposer({ onSent, onBusy }) {
  const [form, setForm] = useState({
    source: "SAT-1",
    destination: "GS-2",
    type: "mission-critical",
    payload: "Critical spacecraft telemetry",
  });
  const [prediction, setPrediction] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const preset = MESSAGE_TYPES.find((item) => item.id === form.type) || MESSAGE_TYPES[0];

  function update(event) {
    const { name, value } = event.target;
    setForm((current) => ({ ...current, [name]: value }));
    setPrediction(null);
  }

  const payload = {
    source: form.source,
    destination: form.destination,
    payload: form.payload,
    severity: preset.severity,
    mission_critical: preset.mission_critical,
    anomaly: preset.anomaly,
    ttl: 30,
  };

  async function send() {
    if (!form.payload.trim()) {
      setError("Payload required.");
      return;
    }

    try {
      setBusy(true);
      onBusy?.(true);
      setError("");
      const result = await createMessage(payload);
      setPrediction(result.prediction || null);
      await onSent?.(result);
    } catch (err) {
      setError(err.message || "Send failed.");
    } finally {
      setBusy(false);
      onBusy?.(false);
    }
  }

  async function preview() {
    try {
      setBusy(true);
      setError("");
      setPrediction(await predictPriority(payload));
    } catch (err) {
      setError(err.message || "Predict failed.");
    } finally {
      setBusy(false);
    }
  }

  const urgency = prediction
    ? urgencyPct({
        priority_probability: prediction.priority_probability,
        priority_score: prediction.priority_score,
      })
    : null;

  return (
    <div className="mission-composer">
      <label>
        <span>SOURCE</span>
        <select name="source" value={form.source} onChange={update}>
          {SOURCES.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      <label>
        <span>DESTINATION</span>
        <select name="destination" value={form.destination} onChange={update}>
          {DESTINATIONS.map((id) => (
            <option key={id}>{id}</option>
          ))}
        </select>
      </label>
      <label>
        <span>MESSAGE TYPE</span>
        <select name="type" value={form.type} onChange={update}>
          {MESSAGE_TYPES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </label>
      <label className="full">
        <span>PAYLOAD</span>
        <textarea name="payload" value={form.payload} onChange={update} rows={3} />
      </label>

      {prediction && (
        <div className="mission-priority-flash">
          <span>TINYML URGENCY {urgency ?? "N/A"}{urgency != null ? "%" : ""}</span>
          <strong>{prediction.priority_class || "N/A"}</strong>
        </div>
      )}

      {error && <div className="tf-alert">{error}</div>}

      <div className="mission-composer-actions">
        <button type="button" className="secondary-button" onClick={preview} disabled={busy}>
          Predict
        </button>
        <button type="button" className="primary-button" onClick={send} disabled={busy}>
          {busy ? "Sending..." : "Send Message"}
        </button>
      </div>
    </div>
  );
}

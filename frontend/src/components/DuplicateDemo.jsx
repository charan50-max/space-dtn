import { useMemo, useState } from "react";

import { replayBundle } from "../services/api";
import "./duplicate-demo.css";

/*
 * Duplicate-detection demo.
 *
 * Pick a message that has already been delivered and send another copy of
 * it to the destination. The DTN duplicate detector recognises the message
 * ID, rejects the copy, and the "duplicates blocked" counter goes up. No
 * message needs to be typed.
 */
export default function DuplicateDemo({ state, refreshState }) {
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const delivered = useMemo(
    () =>
      (state?.messages || []).filter(
        (message) => message.status === "delivered"
      ),
    [state?.messages]
  );

  const activeId = delivered.some((message) => message.id === selected)
    ? selected
    : delivered[0]?.id || "";

  const activeMessage = delivered.find((message) => message.id === activeId);
  const duplicates = state?.statistics?.duplicates ?? 0;

  const log = (state?.events || [])
    .filter((event) => /duplicate/i.test(event.event))
    .slice(0, 4);

  async function sendDuplicate() {
    if (!activeId || busy) return;

    setBusy(true);

    try {
      const response = await replayBundle(activeId);

      setResult(
        response.success
          ? {
              ok: true,
              text: `Copy of ${activeId} reached ${
                response.destination || "the destination"
              } and was rejected as a duplicate.`,
            }
          : {
              ok: false,
              text: `${activeId} has not been delivered yet, so there is nothing to duplicate.`,
            }
      );

      await refreshState?.();
    } catch (error) {
      console.error(error);
      setResult({ ok: false, text: error.message || "Request failed." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card dup-card">
      <div className="card-header">
        <div>
          <h2 className="card-title">Duplicate Detection Demo</h2>
          <p className="card-subtitle">
            Re-send a copy of a delivered message and watch the destination
            reject it.
          </p>
        </div>

        <div className="dup-counter">
          <strong>{duplicates}</strong>
          <span>duplicates blocked</span>
        </div>
      </div>

      <div className="card-body">
        {delivered.length === 0 ? (
          <div className="dup-empty">
            No delivered messages yet. Open <strong>Live Traffic</strong>, press
            Start Traffic (or Skip to end), then come back and replay any
            delivered message.
          </div>
        ) : (
          <>
            <div className="dup-controls">
              <label>
                <span>DELIVERED MESSAGE</span>
                <select
                  value={activeId}
                  onChange={(event) => setSelected(event.target.value)}
                >
                  {delivered.map((message) => (
                    <option key={message.id} value={message.id}>
                      {message.id} · {message.source} → {message.destination} ·{" "}
                      {message.priority_class}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="primary-button"
                onClick={sendDuplicate}
                disabled={busy || !activeId}
              >
                {busy ? "Sending..." : "Send duplicate copy"}
              </button>
            </div>

            {activeMessage && (
              <div className="dup-steps">
                <div>
                  <b>1</b>
                  <span>{activeMessage.id} already delivered</span>
                </div>
                <i>→</i>
                <div>
                  <b>2</b>
                  <span>Same ID arrives again at {activeMessage.destination}</span>
                </div>
                <i>→</i>
                <div>
                  <b>3</b>
                  <span>Duplicate detector rejects it</span>
                </div>
              </div>
            )}

            {result && (
              <div className={`dup-result ${result.ok ? "ok" : "bad"}`}>
                {result.text}
              </div>
            )}

            {log.length > 0 && (
              <ul className="dup-log">
                {log.map((event, index) => (
                  <li key={`${event.time}-${index}`}>
                    <span>T+{event.time}</span>
                    {event.event}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </section>
  );
}

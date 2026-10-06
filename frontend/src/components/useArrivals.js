import { useEffect, useRef, useState } from "react";

/*
 * Announces messages the moment they reach their destination.
 *
 * It compares each new snapshot with the previous one and reports:
 *   "reached"   - a message became delivered
 *   "duplicate" - a retransmitted copy was rejected by the duplicate detector
 *
 * Nothing is announced for the first snapshot, after a reset, or when a run is
 * skipped to the end, so opening a page mid-run never replays old arrivals.
 *
 * Returns:
 *   arrivals   events still on screen (a few seconds each)
 *   landingIds ids of messages whose last hop is still animating, so the 3D
 *              scene can finish drawing the dot travelling into the node
 *   history    the most recent events, newest first, until the next reset
 */

const TERMINAL = new Set(["delivered", "dropped", "rejected"]);

const CALLOUT_MS = 3500;
const LANDING_MS = 1100;
const HISTORY_SIZE = 6;
const BULK_LIMIT = 5; // more new arrivals than this at once = fast-forward

const normalise = (status) => String(status || "").toLowerCase();

function makeEvent(kind, message, counter) {
  return {
    key: `${kind}-${message.id}-${counter}`,
    kind,
    id: message.id,
    node: message.current_node || message.destination,
    delay: Number.isFinite(Number(message.delay)) ? Number(message.delay) : null,
    verified: Boolean(message.integrity_verified),
    copyOf: message.copy_of || null,
    reason: message.reject_reason || (message.ttl <= 0 ? "TTL expired" : "dropped"),
    priority: message.priority_class || "LOW",
  };
}

export default function useArrivals(messages) {
  const [arrivals, setArrivals] = useState([]);
  const [landingIds, setLandingIds] = useState(() => new Set());
  const [history, setHistory] = useState([]);

  const seenRef = useRef(null); // Map of message id -> status
  const timersRef = useRef(new Set());
  const counterRef = useRef(0);

  useEffect(
    () => () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current.clear();
    },
    []
  );

  function later(callback, delay) {
    const timer = setTimeout(() => {
      timersRef.current.delete(timer);
      callback();
    }, delay);
    timersRef.current.add(timer);
  }

  useEffect(() => {
    const list = Array.isArray(messages) ? messages : [];
    const current = new Map(
      list.map((message) => [message.id, normalise(message.status)])
    );
    const previous = seenRef.current;

    // First snapshot, or the first one after an empty simulator: remember it
    // without announcing anything.
    if (previous === null || previous.size === 0) {
      seenRef.current = current;
      return;
    }

    // A reset or a restarted run: something finished is no longer finished.
    const restarted =
      current.size < previous.size ||
      list.some((message) => {
        const before = previous.get(message.id);
        return (
          before &&
          TERMINAL.has(before) &&
          !TERMINAL.has(normalise(message.status))
        );
      });

    if (restarted) {
      seenRef.current = current;
      setArrivals([]);
      setHistory([]);
      setLandingIds(new Set());
      return;
    }

    const fresh = [];

    list.forEach((message) => {
      const status = normalise(message.status);

      if (previous.get(message.id) === status) return;

      counterRef.current += 1;

      if (status === "delivered") {
        fresh.push(makeEvent("reached", message, counterRef.current));
      } else if (status === "rejected" && message.reject_reason === "duplicate") {
        fresh.push(makeEvent("duplicate", message, counterRef.current));
      } else if (status === "dropped") {
        fresh.push(makeEvent("dropped", message, counterRef.current));
      }
    });

    seenRef.current = current;

    if (fresh.length === 0) return;

    // Skip-to-end style jumps: keep the log short and skip the callouts.
    if (fresh.length > BULK_LIMIT) {
      setHistory((old) => [...fresh.slice(-3).reverse(), ...old].slice(0, HISTORY_SIZE));
      return;
    }

    setHistory((old) => [...[...fresh].reverse(), ...old].slice(0, HISTORY_SIZE));
    setArrivals((old) => [...old, ...fresh]);

    const reachedIds = fresh
      .filter((event) => event.kind === "reached")
      .map((event) => event.id);

    if (reachedIds.length) {
      setLandingIds((old) => new Set([...old, ...reachedIds]));

      later(() => {
        setLandingIds((old) => {
          const next = new Set(old);
          reachedIds.forEach((id) => next.delete(id));
          return next;
        });
      }, LANDING_MS);
    }

    later(() => {
      const gone = new Set(fresh.map((event) => event.key));
      setArrivals((old) => old.filter((event) => !gone.has(event.key)));
    }, CALLOUT_MS);
  }, [messages]);

  return { arrivals, landingIds, history };
}

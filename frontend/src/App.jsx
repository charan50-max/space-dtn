import { useEffect, useRef, useState } from "react";

import Sidebar from "./components/Sidebar";

import Dashboard from "./pages/Dashboard";
import Compare from "./pages/Compare";
import Simulation from "./pages/Simulation";
import Messages from "./pages/Messages";
import TinyML from "./pages/TinyML";
import Analytics from "./pages/Analytics";
import LiveTraffic from "./pages/LiveTraffic";

import {
  getState,
  startTraffic as apiStartTraffic,
  stepTraffic as apiStepTraffic,
  runTraffic as apiRunTraffic,
  resetTraffic as apiResetTraffic,
} from "./services/api";

// Milliseconds between DTN ticks while traffic is running.
// Each tick moves every packet one hop, so a longer delay = calmer motion.
const SPEEDS = { slow: 4500, normal: 2800, fast: 1400 };
const DEFAULT_SPEED = "normal";

const isDone = (message) =>
  message.status === "delivered" || message.status === "dropped";

function summarize(snapshot) {
  const list = snapshot?.messages || [];
  return {
    hasPackets: list.length > 0,
    complete: list.length > 0 && list.every(isDone),
  };
}

function getCurrentPage() {
  const hash = window.location.hash.replace("#", "");

  if (
    hash === "dashboard" ||
    hash === "compare" ||
    hash === "simulation" ||
    hash === "messages" ||
    hash === "tinyml" ||
    hash === "analytics" ||
    hash === "live-traffic"
  ) {
    return hash;
  }

  // The comparison demo is the landing page.
  return "compare";
}

function App() {
  const [page, setPage] = useState(getCurrentPage());
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // ----------------------------------------------------------
  // Shared traffic runner (lives here so a run survives page changes).
  //
  // Every backend call that reads or changes the simulator goes through
  // one serial queue. That guarantees responses are applied in the order
  // the requests were made, so a slow background refresh can never
  // overwrite a newer Step result with an older snapshot.
  // ----------------------------------------------------------
  const [running, setRunning] = useState(false);
  const [trafficBusy, setTrafficBusy] = useState(false);
  const [trafficError, setTrafficError] = useState("");
  const [speed, setSpeed] = useState(DEFAULT_SPEED);

  const runningRef = useRef(false);
  const busyRef = useRef(false);
  const tickPendingRef = useRef(false);
  const snapshotRef = useRef(null);
  const queueRef = useRef(Promise.resolve());

  function enqueue(task) {
    const run = queueRef.current.then(task);
    queueRef.current = run.catch(() => {});
    return run;
  }

  function put(snapshot) {
    snapshotRef.current = snapshot;
    setState(snapshot);
  }

  function setRun(value) {
    runningRef.current = value;
    setRunning(value);
  }

  const { hasPackets, complete } = summarize(state);
  const simTime = state?.time ?? 0;

  let phase = "idle";
  if (running) phase = "running";
  else if (complete) phase = "complete";
  else if (hasPackets && simTime > 0) phase = "paused";
  else if (hasPackets) phase = "ready";

  const label =
    phase === "running"
      ? "Pause"
      : phase === "complete"
      ? "Run again"
      : phase === "paused"
      ? "Resume"
      : "Start Traffic";

  useEffect(() => {
    const handleHashChange = () => {
      setPage(getCurrentPage());
    };

    window.addEventListener("hashchange", handleHashChange);

    return () => {
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, []);

  async function fetchState() {
    try {
      setError("");
      const data = await getState();
      put(data);
    } catch (err) {
      console.error(err);
      setError(err.message || "Unable to connect to Space DTN backend.");
    } finally {
      setLoading(false);
    }
  }

  // Pages call this after their own actions (link fail/restore, etc.).
  function refreshState() {
    return enqueue(fetchState);
  }

  useEffect(() => {
    refreshState();

    const interval = setInterval(() => {
      // Skip background refreshes while traffic is running or a traffic
      // action is in progress; those calls already return fresh state.
      if (!runningRef.current && !busyRef.current) {
        refreshState();
      }
    }, 3000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick loop: one backend DTN tick per interval while running.
  useEffect(() => {
    if (!running) return undefined;

    const timer = setInterval(() => {
      if (tickPendingRef.current) return;
      tickPendingRef.current = true;

      enqueue(async () => {
        // Paused (or Step pressed) while this tick was waiting: skip it.
        if (!runningRef.current) return;

        try {
          const next = await apiStepTraffic();
          put(next);

          if (summarize(next).complete) {
            setRun(false);
          }
        } catch (err) {
          console.error(err);
          setRun(false);
          setTrafficError(err.message || "Traffic step failed.");
        }
      }).finally(() => {
        tickPendingRef.current = false;
      });
    }, SPEEDS[speed]);

    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [running, speed]);

  function guarded(task) {
    busyRef.current = true;
    setTrafficBusy(true);
    setTrafficError("");

    return enqueue(task)
      .catch((err) => {
        console.error(err);
        setRun(false);
        setTrafficError(err.message || "Traffic request failed.");
      })
      .finally(() => {
        busyRef.current = false;
        setTrafficBusy(false);
      });
  }

  async function loadPackets() {
    const started = await apiStartTraffic();
    put(started.snapshot);
  }

  const traffic = {
    running,
    busy: trafficBusy,
    error: trafficError,
    hasPackets,
    complete,
    phase,
    label,
    speed,
    setSpeed,

    // Start, resume, or pause depending on the current phase.
    toggle: () => {
      if (runningRef.current) {
        setRun(false);
        return undefined;
      }

      return guarded(async () => {
        const current = summarize(snapshotRef.current);

        if (!current.hasPackets || current.complete) {
          await loadPackets();
        }

        setRun(true);
      });
    },

    // Advance exactly one DTN tick. Works while running too: it pauses
    // the run first, then applies one tick after any queued tick is done.
    step: () => {
      setRun(false);

      return guarded(async () => {
        const current = summarize(snapshotRef.current);

        if (!current.hasPackets || current.complete) {
          await loadPackets();
        }

        put(await apiStepTraffic());
      });
    },

    runAll: () => {
      setRun(false);

      return guarded(async () => {
        const current = summarize(snapshotRef.current);

        if (!current.hasPackets || current.complete) {
          await loadPackets();
        }

        const result = await apiRunTraffic(undefined, 100);
        put(result.snapshot);
      });
    },

    reset: () => {
      setRun(false);

      return guarded(async () => {
        put(await apiResetTraffic());
      });
    },
  };

  function navigate(target) {
    window.location.hash = target;
    setPage(target);
  }

  function renderPage() {
    if (loading && !state) {
      return (
        <div className="loading-screen">
          <div className="loader-ring" />
          <p>Connecting to Space DTN...</p>
        </div>
      );
    }

    if (error && !state) {
      return (
        <div className="error-screen">
          <div className="error-icon">!</div>

          <h2>Backend connection failed</h2>

          <p>{error}</p>

          <button className="primary-button" onClick={refreshState}>
            Retry Connection
          </button>

          <div className="connection-command">
            <span>Backend:</span>
            <code>http://127.0.0.1:8000</code>
          </div>
        </div>
      );
    }

    switch (page) {
      case "compare":
        return <Compare />;

      case "simulation":
        return (
          <Simulation
            state={state}
            refreshState={refreshState}
            traffic={traffic}
            navigate={navigate}
          />
        );

      case "messages":
        return (
          <Messages
            state={state}
            refreshState={refreshState}
          />
        );

      case "tinyml":
        return <TinyML />;

      case "analytics":
        return <Analytics state={state} />;

      case "live-traffic":
        return (
          <LiveTraffic
            state={state}
            traffic={traffic}
            navigate={navigate}
          />
        );

      case "dashboard":
        return (
          <Dashboard
            state={state}
            refreshState={refreshState}
            navigate={navigate}
          />
        );

      default:
        return <Compare />;
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        page={page}
        navigate={navigate}
        state={state}
      />

      <main className="main-content">
        {renderPage()}
      </main>
    </div>
  );
}

export default App;

import React, { useEffect, useState } from "react";
import {
  Eye,
  EyeOff,
  Maximize2,
  Minimize2,
} from "lucide-react";
import SpaceScene from "./SpaceScene";

export default function NetworkGraph({
  network,
  state,
  onAdvance,
  busy = false,
  selectedLinkId,
  onSelectLink,
  compact = false,
}) {
  const [focusMode, setFocusMode] = useState(false);

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === "Escape") {
        setFocusMode(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, []);

  useEffect(() => {
    document.body.classList.toggle(
      "simulation-focus-active",
      focusMode
    );

    return () => {
      document.body.classList.remove("simulation-focus-active");
    };
  }, [focusMode]);

  return (
    <section
      className={
        focusMode
          ? "network-card network-card-focus"
          : "network-card"
      }
    >
      {!compact && (
      <div className="network-header">
        <div>
          <div className="network-title">Space Network</div>
          <div className="network-subtitle">
            Live orbital topology
          </div>
        </div>

        <div className="network-header-actions">
          <button
            type="button"
            className="simulation-focus-button"
            onClick={() => setFocusMode((current) => !current)}
            title={focusMode ? "Exit simulation view" : "Focus simulation"}
            aria-label={focusMode ? "Exit simulation view" : "Focus simulation"}
          >
            {focusMode ? (
              <>
                <Minimize2 size={15} />
                <span>Exit</span>
              </>
            ) : (
              <>
                <Maximize2 size={15} />
                <span>Focus</span>
              </>
            )}
          </button>

          <button
            type="button"
            className="simulation-focus-button"
            onClick={() => setFocusMode((current) => !current)}
            title={focusMode ? "Show dashboard" : "Hide dashboard"}
            aria-label={focusMode ? "Show dashboard" : "Hide dashboard"}
          >
            {focusMode ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
      </div>
      )}

      <div className="network-3d-container">
        <SpaceScene
          network={network}
          state={state}
          selectedLinkId={selectedLinkId}
          onSelectLink={onSelectLink}
        />
      </div>

      {focusMode && (
        <>
          <div className="focus-mode-label">
            SIMULATION VIEW
            <span>Press ESC to exit</span>
          </div>

          <div className="focus-simulation-controls">
            <div className="focus-simulation-status">
              <span className="focus-status-dot" />
              T+{state?.statistics?.simulation_time ?? state?.time ?? 0}
              <span className="focus-status-separator">•</span>
              {state?.statistics?.delivery_rate ?? 0}% delivered
            </div>

            <button
              type="button"
              className="focus-advance-button"
              onClick={onAdvance}
              disabled={!onAdvance || busy}
            >
              {busy ? "RUNNING..." : "ADVANCE SIMULATION"}
            </button>
          </div>
        </>
      )}
    </section>
  );
}

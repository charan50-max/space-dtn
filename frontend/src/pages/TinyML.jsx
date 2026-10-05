import { useEffect, useState } from "react";

import {
  getMLStatus,
  getMLMetrics,
} from "../services/api";


function TinyML() {

  const [status, setStatus] = useState(null);
  const [metrics, setMetrics] = useState(null);
  const [loading, setLoading] = useState(true);


  // ============================================================
  // LOAD TINYML STATUS + METRICS
  // ============================================================

  useEffect(() => {

    async function load() {

      try {

        const [statusData, metricData] =
          await Promise.all([
            getMLStatus(),
            getMLMetrics(),
          ]);

        setStatus(statusData);
        setMetrics(metricData);

      } catch (err) {

        console.error(
          "Failed to load TinyML information:",
          err
        );

      } finally {

        setLoading(false);

      }

    }

    load();

  }, []);


  // ============================================================
  // LOADING
  // ============================================================

  if (loading) {

    return (
      <div className="loading-screen">
        <div className="loader-ring" />
        <p>Loading TinyML information...</p>
      </div>
    );

  }


  // ============================================================
  // BACKEND STATUS
  //
  // /api/ml/status returns model_loaded, model_type, model_format,
  // priority_threshold, feature_count and features. Older shapes
  // ("loaded", "threshold") are still accepted.
  // ============================================================

  const modelLoaded =
    status?.model_loaded ??
    status?.loaded ??
    false;

  const modelType =
    status?.model_type ||
    "unknown";

  const modelFormat =
    status?.model_format ||
    "TensorFlow Lite";

  const featureCount =
    status?.feature_count ??
    status?.features?.length ??
    0;

  const threshold =
    status?.priority_threshold ??
    status?.threshold ??
    0.25;


  // ============================================================
  // METRICS
  //
  // metricValues      : file metrics, computed at the training
  //                     default cut-off (NOT the deployed 0.25)
  // deployedMetrics   : precision / recall / F1 at the deployed
  //                     threshold
  // ============================================================

  const rawMetrics =
    metrics || {};

  const metricValues =
    rawMetrics.fp32 ||
    rawMetrics.metrics ||
    rawMetrics;

  const deployedMetrics =
    rawMetrics.deployed_threshold_metrics ||
    null;


  function isNumber(value) {
    return typeof value === "number" && !Number.isNaN(value);
  }

  function formatMetric(value) {
    return isNumber(value) ? value.toFixed(3) : "—";
  }

  function formatPercent(value) {
    return isNumber(value) ? `${(value * 100).toFixed(1)}%` : "—";
  }

  function missedUrgent(values) {
    if (!values) return null;
    if (isNumber(values.false_negative_rate)) return values.false_negative_rate;
    if (isNumber(values.recall)) return 1 - values.recall;
    return null;
  }

  // Threshold-independent: describe how well the model ranks samples,
  // whatever cut-off is chosen.
  const rankingMetrics = [
    ["ROC-AUC", metricValues.roc_auc],
    ["PR-AUC", metricValues.pr_auc],
  ];

  const comparisonRows = [
    [
      "Precision (HIGH decisions that were urgent)",
      formatMetric(metricValues.precision),
      formatMetric(deployedMetrics?.precision),
    ],
    [
      "Recall (urgent samples caught)",
      formatMetric(metricValues.recall),
      formatMetric(deployedMetrics?.recall),
    ],
    [
      "F1 score",
      formatMetric(metricValues.f1),
      formatMetric(deployedMetrics?.f1),
    ],
    [
      "Urgent samples missed",
      formatPercent(missedUrgent(metricValues)),
      formatPercent(missedUrgent(deployedMetrics)),
    ],
  ];

  const modelSize = isNumber(metricValues.model_size_kb)
    ? `${metricValues.model_size_kb.toFixed(2)} KB`
    : "—";

  const inferenceTime = isNumber(metricValues.inference_per_sample_ms)
    ? `${metricValues.inference_per_sample_ms.toFixed(3)} ms`
    : "—";


  // ============================================================
  // RENDER
  // ============================================================

  return (
    <>

      {/* ======================================================
          PAGE HEADER
      ====================================================== */}

      <div className="page-header">

        <div>

          <div className="eyebrow">
            Edge Intelligence
          </div>

          <h1 className="page-title">
            TinyML Priority Engine
          </h1>

          <p className="page-description">

            A lightweight machine-learning layer designed
            to prioritize important spacecraft messages
            without requiring a resource-heavy model.

          </p>

        </div>

      </div>


      {/* ======================================================
          HERO
      ====================================================== */}

      <div className="ml-hero">

        {/* MODEL STATUS */}

        <section className="card ml-status-box">

          <div className="ml-status-title">

            {modelLoaded
              ? "TinyML Priority Engine Active"
              : "TinyML model unavailable"}

          </div>

          <div className="ml-status-description">

            {modelLoaded

              ? (
                <>
                  The backend is running the trained{" "}
                  <strong>{modelType}</strong>{" "}
                  model for spacecraft message priority
                  inference.

                  {modelFormat && (
                    <>
                      {" "}
                      Runtime format:{" "}
                      <strong>{modelFormat}</strong>.
                    </>
                  )}

                  {" "}
                  The current decision threshold is{" "}
                  <strong>{Number(threshold).toFixed(2)}</strong>.
                </>
              )

              : (
                <>
                  The trained TinyML model is currently
                  unavailable. The backend may fall back
                  to the lightweight deterministic priority
                  policy.
                </>
              )}

          </div>

          <div className="ml-indicator">

            <span className="ml-indicator-dot" />

            {modelLoaded
              ? "TinyML inference active"
              : "Fallback priority engine active"}

          </div>

        </section>


        {/* MODEL CONFIGURATION */}

        <section className="card">

          <div className="card-header">
            <div>
              <h2 className="card-title">
                Model Configuration
              </h2>
            </div>
          </div>

          <div className="card-body">

            <div className="metric-list">

              <div className="metric-mini">
                <div className="metric-mini-label">Model</div>
                <div className="metric-mini-value">{modelType}</div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">Features</div>
                <div className="metric-mini-value">{featureCount}</div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">Format</div>
                <div className="metric-mini-value">{modelFormat}</div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">Threshold</div>
                <div className="metric-mini-value">
                  {Number(threshold).toFixed(2)}
                </div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">Model size</div>
                <div className="metric-mini-value">{modelSize}</div>
              </div>

              <div className="metric-mini">
                <div className="metric-mini-label">Inference</div>
                <div className="metric-mini-value">{inferenceTime}</div>
              </div>

            </div>

            <p className="card-subtitle" style={{ marginTop: 12 }}>
              Inference time is per sample, measured on a development
              CPU rather than flight hardware.
            </p>

          </div>

        </section>

      </div>


      {/* ======================================================
          EVALUATION METRICS
      ====================================================== */}

      <section className="card">

        <div className="card-header">

          <div>

            <h2 className="card-title">
              Evaluation Metrics
            </h2>

            <p className="card-subtitle">

              Held-out test dataset, FP32 TensorFlow Lite
              classifier. Precision, recall and F1 change with
              the decision threshold, so both cut-offs are shown.

            </p>

          </div>

        </div>

        <div className="card-body">

          <div className="metric-list">

            {rankingMetrics.map(([label, value]) => (
              <div className="metric-mini" key={label}>
                <div className="metric-mini-label">{label}</div>
                <div className="metric-mini-value">
                  {formatMetric(value)}
                </div>
              </div>
            ))}

          </div>

          <p className="card-subtitle" style={{ margin: "10px 0 18px" }}>
            ROC-AUC and PR-AUC do not depend on the threshold.
            They describe how well the model ranks urgent samples
            above routine ones.
          </p>

          <div className="table-wrapper">

            <table className="data-table">

              <thead>
                <tr>
                  <th>Measure</th>
                  <th>Default cut-off</th>
                  <th>
                    Deployed (≥ {Number(threshold).toFixed(2)})
                  </th>
                </tr>
              </thead>

              <tbody>
                {comparisonRows.map(([label, defaultValue, deployedValue]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td>{defaultValue}</td>
                    <td>
                      <strong>{deployedValue}</strong>
                    </td>
                  </tr>
                ))}
              </tbody>

            </table>

          </div>

          {deployedMetrics?.source && (
            <p className="card-subtitle" style={{ marginTop: 10 }}>
              Deployed-threshold source: {deployedMetrics.source}
            </p>
          )}

        </div>

      </section>


      <div style={{ height: 16 }} />


      {/* ======================================================
          WHY THIS THRESHOLD
      ====================================================== */}

      <section className="card">

        <div className="card-header">
          <div>
            <h2 className="card-title">
              Why the threshold is {Number(threshold).toFixed(2)}
            </h2>
          </div>
        </div>

        <div className="card-body">

          <div className="dashboard-grid">

            <div>

              <div className="metric-label">THE TRADE-OFF</div>

              <p className="page-description">

                A lower threshold marks more messages HIGH. The
                engine catches more urgent telemetry, and more
                routine messages are marked HIGH by mistake.

              </p>

            </div>

            <div>

              <div className="metric-label">WHY IT IS WORTH IT HERE</div>

              <p className="page-description">

                A missed urgent message waits behind routine data.
                A false alarm only moves one message earlier in the
                queue. Neither drops data, so the threshold favours
                recall.

              </p>

            </div>

          </div>

        </div>

      </section>


      <div style={{ height: 16 }} />


      {/* ======================================================
          DEPLOYMENT STATUS
      ====================================================== */}

      <section className="card">

        <div className="card-header">
          <div>
            <h2 className="card-title">
              TinyML Deployment Status
            </h2>
          </div>
        </div>

        <div className="card-body">

          <div className="dashboard-grid">

            <div>

              <div className="metric-label">MODEL STATUS</div>

              <p className="page-description">

                {modelLoaded

                  ? (
                    <>
                      <strong>Loaded and ready.</strong>{" "}
                      The FastAPI backend has successfully
                      loaded the trained TensorFlow Lite
                      model and feature scaler.
                    </>
                  )

                  : (
                    <>
                      The trained model is currently
                      unavailable and the backend may use
                      the lightweight fallback policy.
                    </>
                  )}

              </p>

            </div>

            <div>

              <div className="metric-label">INPUT FEATURES</div>

              <p className="page-description">

                The classifier uses{" "}
                <strong>{featureCount}</strong>{" "}
                telemetry features:

                <br />

                value, sampling, channel ID,
                z-score, absolute z-score,
                delta value, absolute delta,
                rolling mean and rolling standard deviation.

              </p>

            </div>

            <div>

              <div className="metric-label">PRIORITY DECISION</div>

              <p className="page-description">

                A telemetry priority probability of{" "}
                <strong>≥ {Number(threshold).toFixed(2)}</strong>{" "}
                is classified as{" "}
                <strong>HIGH</strong>{" "}
                priority.

              </p>

            </div>

            <div>

              <div className="metric-label">RUNTIME PIPELINE</div>

              <p className="page-description">

                Satellite telemetry → feature engineering
                → scaler → FP32 TFLite model → priority
                probability → DTN priority queue.

              </p>

            </div>

          </div>

        </div>

      </section>


      <div style={{ height: 16 }} />


      {/* ======================================================
          WHY TINYML + LIMITATIONS
      ====================================================== */}

      <section className="card">

        <div className="card-header">
          <div>
            <h2 className="card-title">
              Resource-Efficient Design
            </h2>
          </div>
        </div>

        <div className="card-body">

          <div className="dashboard-grid">

            <div>

              <div className="metric-label">WHY TINYML?</div>

              <p className="page-description">

                Space and edge devices have constrained
                compute, memory and power resources.
                The priority engine therefore favours
                compact models that can make decisions
                close to the data source.

              </p>

            </div>

            <div>

              <div className="metric-label">TRAINING PIPELINE</div>

              <p className="page-description">

                Dataset → feature engineering →
                lightweight classifier → evaluation →
                TensorFlow Lite model → FastAPI inference →
                DTN priority queue.

              </p>

            </div>

            <div>

              <div className="metric-label">WHAT THE LABEL MEANS</div>

              <p className="page-description">

                The telemetry dataset has no native DTN priority
                label. The model is trained on an anomaly-derived
                urgency proxy. Labels from real mission operations
                are the next step.

              </p>

            </div>

          </div>

        </div>

      </section>

    </>

  );

}


export default TinyML;

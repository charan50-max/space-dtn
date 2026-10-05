import csv
import json
from pathlib import Path

from fastapi import APIRouter

from backend.app.core.config import (
    METRICS_PATH,
)

from backend.app.services.priority_service import (
    priority_service,
    PRIORITY_THRESHOLD,
)


router = APIRouter(
    prefix="/api/ml",
    tags=["TinyML"],
)


# ============================================================
# PROJECT PATHS
# ============================================================

# ml.py is located at:
#
# space_dtn/
# └── backend/
#     └── app/
#         └── api/
#             └── ml.py
#
# Therefore parents[3] = space_dtn/

PROJECT_ROOT = (
    Path(__file__)
    .resolve()
    .parents[3]
)


EVALUATION_METRICS_DIR = (
    PROJECT_ROOT
    / "evaluation"
    / "metrics"
)


FP32_METRICS_PATH = (
    EVALUATION_METRICS_DIR
    / "tflite_fp32_metrics.json"
)


TRAINING_SUMMARY_PATH = (
    PROJECT_ROOT
    / "evaluation"
    / "tflite_training_summary.json"
)


THRESHOLD_RESULTS_PATH = (
    EVALUATION_METRICS_DIR
    / "threshold_results.csv"
)


# Metrics recorded in priority_service.py when the 0.25 threshold was
# selected (FP32 model). Used ONLY if threshold_results.csv is missing or
# cannot be read, and reported with a different "source" label.
_DOCUMENTED_DEPLOYED_METRICS = {
    "precision": 0.5010,
    "recall": 0.8121,
    "f1": 0.6197,
}


# Keys copied from a metrics file into the API response.
_METRIC_KEYS = [
    "accuracy",
    "balanced_accuracy",
    "precision",
    "recall",
    "f1",
    "roc_auc",
    "pr_auc",
    "macro_f1",
    "model_size_kb",
    "model_size_bytes",
    "inference_per_sample_ms",
    "predictions_per_second",
    "true_negative",
    "false_positive",
    "false_negative",
    "true_positive",
    "false_positive_rate",
    "false_negative_rate",
]


# ============================================================
# MODEL STATUS
# ============================================================

@router.get("/status")
def ml_status():

    status = dict(priority_service.status())

    # priority_service reports "threshold"; the TinyML page reads
    # "priority_threshold", "model_format" and "feature_count".
    status["priority_threshold"] = status.get(
        "threshold",
        PRIORITY_THRESHOLD,
    )

    status["model_format"] = "TensorFlow Lite"

    status["feature_count"] = len(
        status.get("features", [])
    )

    return status


# ============================================================
# FIND METRICS FILE
# ============================================================

def _find_metrics_file():

    # 1. Preferred: evaluation/metrics/tflite_fp32_metrics.json
    if FP32_METRICS_PATH.exists():
        return FP32_METRICS_PATH

    # 2. Configured backend path (compatibility fallback)
    if METRICS_PATH.exists():
        return METRICS_PATH

    # 3. Complete training summary
    if TRAINING_SUMMARY_PATH.exists():
        return TRAINING_SUMMARY_PATH

    return None


def _pick(source: dict) -> dict:
    return {key: source.get(key) for key in _METRIC_KEYS}


# ============================================================
# METRICS AT THE DEPLOYED DECISION THRESHOLD
#
# tflite_fp32_metrics.json is NOT computed at the deployed 0.25
# threshold (its recall is 0.32, while threshold optimisation recorded
# 0.81 at 0.25). Precision, recall and F1 all depend on the threshold,
# so the page needs the numbers for the threshold actually in use.
# ============================================================

def _to_float(value):

    try:
        number = float(value)
    except (TypeError, ValueError):
        return None

    if number != number:  # NaN
        return None

    return number


_ALIASES = {
    "accuracy": ("accuracy",),
    "precision": ("precision",),
    "recall": ("recall", "tpr"),
    "f1": ("f1", "f1_score"),
    "false_negative_rate": ("false_negative_rate", "fnr"),
    "false_positive_rate": ("false_positive_rate", "fpr"),
}


def _deployed_threshold_metrics():

    threshold = float(PRIORITY_THRESHOLD)

    if THRESHOLD_RESULTS_PATH.exists():

        try:
            with open(
                THRESHOLD_RESULTS_PATH,
                "r",
                encoding="utf-8",
                newline="",
            ) as file:
                rows = [
                    {
                        str(key).strip().lower().replace(" ", "_"): value
                        for key, value in row.items()
                        if key
                    }
                    for row in csv.DictReader(file)
                ]

            # If the file holds several models, prefer the FP32 TFLite one.
            if any("model" in row for row in rows):
                preferred = [
                    row
                    for row in rows
                    if "fp32" in str(row.get("model", "")).lower()
                    or "tflite" in str(row.get("model", "")).lower()
                ]
                rows = preferred or rows

            for row in rows:
                row_threshold = _to_float(row.get("threshold"))

                if (
                    row_threshold is None
                    or abs(row_threshold - threshold) > 1e-6
                ):
                    continue

                metrics = {
                    "threshold": threshold,
                    "source": "threshold_results.csv",
                }

                for name, aliases in _ALIASES.items():
                    for alias in aliases:
                        value = _to_float(row.get(alias))
                        if value is not None:
                            metrics[name] = value
                            break

                if "precision" in metrics and "recall" in metrics:
                    return metrics

        except Exception as exc:
            print(f"Could not read threshold_results.csv: {exc}")

    return {
        "threshold": threshold,
        "source": "documented in priority_service.py",
        **_DOCUMENTED_DEPLOYED_METRICS,
    }


# ============================================================
# MODEL EVALUATION METRICS
# ============================================================

@router.get("/metrics")
def ml_metrics():

    metrics_path = _find_metrics_file()

    # --------------------------------------------------------
    # No metrics found
    # --------------------------------------------------------

    if metrics_path is None:

        return {
            "available": False,

            "message": (
                "No trained TinyML evaluation "
                "metrics were found."
            ),

            "checked_paths": [
                str(FP32_METRICS_PATH),
                str(METRICS_PATH),
                str(TRAINING_SUMMARY_PATH),
            ],
        }

    try:

        with open(
            metrics_path,
            "r",
            encoding="utf-8",
        ) as file:

            metrics = json.load(file)

        if not isinstance(metrics, dict):
            raise ValueError("Metrics file is not a JSON object.")

        deployed = {
            "deployed_threshold": float(PRIORITY_THRESHOLD),
            "deployed_threshold_metrics": _deployed_threshold_metrics(),
        }

        # ----------------------------------------------------
        # Direct FP32 metrics file (tflite_fp32_metrics.json)
        # ----------------------------------------------------

        if "fp32" not in metrics:

            return {
                "available": True,
                "source": str(metrics_path),
                "model": metrics.get("model", "TensorFlow Lite FP32"),
                **_pick(metrics),
                **deployed,
            }

        # ----------------------------------------------------
        # Complete training summary (tflite_training_summary.json)
        # ----------------------------------------------------

        fp32 = metrics["fp32"]

        return {
            "available": True,
            "source": str(metrics_path),
            "model": fp32.get("model", "TensorFlow Lite FP32"),
            **_pick(fp32),

            # Complete model comparison for the frontend if needed.
            "fp32": fp32,
            "int8": metrics.get("int8"),
            "features": metrics.get("features", []),
            "dataset": metrics.get("dataset", {}),
            "architecture": metrics.get("architecture", {}),
            "quantization": metrics.get("quantization", {}),

            **deployed,
        }

    except Exception as exc:

        return {
            "available": False,
            "message": str(exc),
            "source": str(metrics_path),
        }

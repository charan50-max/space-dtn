"""
Build the TinyML score bank used by the statistical benchmark.

Runs every row of the held-out test set through the DEPLOYED priority
service (FP32 TFLite model + scaler + threshold) once, and stores the
resulting probabilities, split by the dataset's urgency label:

    tinyml/data/generated/score_bank.json

The benchmark then samples from this file instead of inventing scores, so
its priority behaviour matches the real model (including its mistakes).
No TensorFlow / TFLite runtime is needed at benchmark time.

Usage (from the project root):

    python tinyml/build_score_bank.py
    python tinyml/build_score_bank.py --label-col is_anomaly
    python tinyml/build_score_bank.py --max-rows 50000

Notes
-----
* The label is the dataset's anomaly-derived urgency PROXY. It is not real
  mission urgency; there is no native DTN-priority label in the dataset.
* The script refuses to write a bank if any row was scored by the heuristic
  fallback instead of the TFLite model.
"""

from __future__ import annotations

import argparse
import csv
import json
import random
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]

if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

from backend.app.services.priority_service import (  # noqa: E402
    FEATURES,
    PRIORITY_THRESHOLD,
    priority_service,
)

DEFAULT_INPUT = (
    PROJECT_ROOT / "tinyml" / "data" / "processed" / "tinyml_test.csv"
)
DEFAULT_OUTPUT = (
    PROJECT_ROOT / "tinyml" / "data" / "generated" / "score_bank.json"
)

# Column names tried (in order) when --label-col is not given.
LABEL_CANDIDATES = (
    "true_urgent",
    "is_urgent",
    "urgent",
    "urgency",
    "label",
    "target",
    "is_anomaly",
    "anomaly",
    "y",
)

BOOL_VALUES = {"0", "1", "true", "false", "0.0", "1.0"}


def parse_bool(value: str):
    text = str(value).strip().lower()

    if text not in BOOL_VALUES:
        return None

    return text in ("1", "true", "1.0")


def pick_label_column(header, rows, requested):
    if requested:
        if requested not in header:
            raise SystemExit(
                f"Label column {requested!r} not found. "
                f"Columns: {', '.join(header)}"
            )
        return requested

    lowered = {name.strip().lower(): name for name in header}

    for candidate in LABEL_CANDIDATES:
        if candidate in lowered:
            return lowered[candidate]

    # Otherwise accept a single non-feature column holding only 0/1 values.
    extra = [name for name in header if name not in FEATURES]
    binary = []

    for name in extra:
        values = {str(row.get(name, "")).strip().lower() for row in rows[:500]}
        if values and values <= BOOL_VALUES:
            binary.append(name)

    if len(binary) == 1:
        return binary[0]

    raise SystemExit(
        "Could not tell which column is the urgency label.\n"
        f"Columns: {', '.join(header)}\n"
        "Re-run with --label-col <column name>."
    )


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--label-col", default=None)
    parser.add_argument(
        "--max-rows",
        type=int,
        default=40000,
        help="Randomly subsample to this many rows (0 = use all).",
    )
    parser.add_argument("--seed", type=int, default=7)
    args = parser.parse_args()

    status = priority_service.status()

    if not status["model_loaded"] or status["model_type"] != "tflite_fp32":
        raise SystemExit(
            "The TFLite model is not loaded, so scores would come from the "
            f"heuristic fallback.\nReason: {status['model_error']}\n"
            "Fix the model/runtime first, then re-run."
        )

    if not args.input.exists():
        raise SystemExit(f"Input file not found: {args.input}")

    with args.input.open("r", encoding="utf-8", newline="") as file:
        reader = csv.DictReader(file)
        header = [name.strip() for name in (reader.fieldnames or [])]
        rows = [
            {str(key).strip(): value for key, value in row.items() if key}
            for row in reader
        ]

    missing = [name for name in FEATURES if name not in header]

    if missing:
        raise SystemExit(f"Input is missing feature columns: {missing}")

    label_col = pick_label_column(header, rows, args.label_col)

    if args.max_rows and len(rows) > args.max_rows:
        rng = random.Random(args.seed)
        rows = rng.sample(rows, args.max_rows)

    urgent_probs, routine_probs = [], []
    skipped = 0
    tp = fp = fn = tn = 0

    for index, row in enumerate(rows, start=1):
        label = parse_bool(row.get(label_col, ""))

        if label is None:
            skipped += 1
            continue

        try:
            telemetry = {name: float(row[name]) for name in FEATURES}
        except (TypeError, ValueError):
            skipped += 1
            continue

        prediction = priority_service.predict(telemetry)

        if prediction["model_type"] != "tflite_fp32":
            raise SystemExit(
                f"Row {index} was scored by {prediction['model_type']!r}, "
                "not the TFLite model. Aborting; no bank written."
            )

        probability = float(prediction["priority_probability"])
        predicted_high = prediction["priority_class"] == "HIGH"

        (urgent_probs if label else routine_probs).append(
            round(probability, 4)
        )

        if label and predicted_high:
            tp += 1
        elif label:
            fn += 1
        elif predicted_high:
            fp += 1
        else:
            tn += 1

        if index % 5000 == 0:
            print(f"  scored {index}/{len(rows)} rows")

    total = len(urgent_probs) + len(routine_probs)

    if not urgent_probs or not routine_probs:
        raise SystemExit(
            "The label column produced only one class. "
            f"Check --label-col (used {label_col!r})."
        )

    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0

    bank = {
        "model_type": status["model_type"],
        "threshold": PRIORITY_THRESHOLD,
        "label_column": label_col,
        "label_meaning": "dataset anomaly-derived urgency proxy",
        "source_file": str(args.input.relative_to(PROJECT_ROOT))
        if args.input.is_relative_to(PROJECT_ROOT)
        else str(args.input),
        "rows": total,
        "skipped_rows": skipped,
        "prevalence": round(len(urgent_probs) / total, 4),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "built_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "urgent_probabilities": urgent_probs,
        "routine_probabilities": routine_probs,
    }

    args.output.parent.mkdir(parents=True, exist_ok=True)

    with args.output.open("w", encoding="utf-8") as file:
        json.dump(bank, file)

    print()
    print(f"Wrote {args.output}")
    print(
        f"  rows={total}  urgent={len(urgent_probs)} "
        f"({bank['prevalence'] * 100:.1f}%)  label column={label_col!r}"
    )
    print(
        f"  at threshold {PRIORITY_THRESHOLD}: precision={precision:.4f}  "
        f"recall={recall:.4f}"
    )
    print(
        "  Compare with evaluation/metrics/threshold_results.csv "
        "(expected about precision 0.50, recall 0.81 for the FP32 model)."
    )


if __name__ == "__main__":
    main()

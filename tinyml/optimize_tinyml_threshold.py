"""
Space DTN TinyML - Threshold Optimization
------------------------------------------

Evaluates decision thresholds for the trained FP32 and INT8
TensorFlow Lite models.

Models:
    tinyml/models/tinyml_model_fp32.tflite
    tinyml/models/tinyml_model_int8.tflite

Data:
    tinyml/data/processed/tinyml_test.csv

Outputs:
    evaluation/metrics/threshold_results.csv
    evaluation/metrics/threshold_recommendations.json
    evaluation/plots/threshold_precision_recall.png
    evaluation/plots/threshold_f1.png
    evaluation/plots/threshold_false_negative_rate.png
    evaluation/plots/threshold_dtn_tradeoff.png
    evaluation/reports/threshold_optimization_report.md

Run:
    python tinyml/optimize_tinyml_threshold.py
"""

from pathlib import Path
import json
import time

import numpy as np
import pandas as pd
import matplotlib.pyplot as plt
import tensorflow as tf

from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    balanced_accuracy_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
)


# ============================================================
# PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

TEST_PATH = (
    PROJECT_ROOT
    / "tinyml"
    / "data"
    / "processed"
    / "tinyml_test.csv"
)

MODELS_DIR = (
    PROJECT_ROOT
    / "tinyml"
    / "models"
)

EVALUATION_DIR = (
    PROJECT_ROOT
    / "evaluation"
)

METRICS_DIR = EVALUATION_DIR / "metrics"
PLOTS_DIR = EVALUATION_DIR / "plots"
REPORTS_DIR = EVALUATION_DIR / "reports"

for directory in [
    METRICS_DIR,
    PLOTS_DIR,
    REPORTS_DIR,
]:
    directory.mkdir(
        parents=True,
        exist_ok=True,
    )


# ============================================================
# CONFIGURATION
# ============================================================

FEATURES = [
    "value",
    "sampling",
    "channel_id",
    "z_score",
    "abs_z_score",
    "delta_value",
    "abs_delta",
    "rolling_mean_5",
    "rolling_std_5",
]

TARGET = "priority"

THRESHOLDS = np.round(
    np.arange(
        0.10,
        0.651,
        0.05,
    ),
    2,
)

# The previous training script saved the scaler here.
SCALER_PATH = MODELS_DIR / "feature_scaler.json"

FP32_MODEL_PATH = (
    MODELS_DIR
    / "tinyml_model_fp32.tflite"
)

INT8_MODEL_PATH = (
    MODELS_DIR
    / "tinyml_model_int8.tflite"
)


# ============================================================
# LOAD DATA
# ============================================================

print("=" * 72)
print("SPACE DTN - TINYML THRESHOLD OPTIMIZATION")
print("=" * 72)

print("\n[1/6] Loading test data...")

test_df = pd.read_csv(TEST_PATH)

X_raw = (
    test_df[FEATURES]
    .astype(np.float32)
    .values
)

y_test = (
    test_df[TARGET]
    .astype(np.int32)
    .values
)

with open(
    SCALER_PATH,
    "r",
    encoding="utf-8",
) as f:
    scaler_data = json.load(f)

means = np.asarray(
    scaler_data["mean"],
    dtype=np.float32,
)

scales = np.asarray(
    scaler_data["scale"],
    dtype=np.float32,
)

X_test = (
    (X_raw - means) / scales
).astype(np.float32)

print(
    f"Test samples: {len(X_test):,}"
)


# ============================================================
# TFLITE INFERENCE
# ============================================================

def get_tflite_probabilities(
    model_path,
    X,
):
    """Run actual TFLite inference and return probabilities."""

    interpreter = tf.lite.Interpreter(
        model_path=str(model_path)
    )

    interpreter.allocate_tensors()

    input_details = (
        interpreter.get_input_details()
    )

    output_details = (
        interpreter.get_output_details()
    )

    input_info = input_details[0]
    output_info = output_details[0]

    input_index = input_info["index"]
    output_index = output_info["index"]

    input_dtype = input_info["dtype"]
    output_dtype = output_info["dtype"]

    input_scale, input_zero = (
        input_info["quantization"]
    )

    output_scale, output_zero = (
        output_info["quantization"]
    )

    probabilities = []

    for sample in X:

        sample = sample.reshape(
            1,
            -1,
        ).astype(np.float32)

        if input_dtype == np.int8:

            sample = (
                sample / input_scale
                + input_zero
            )

            sample = np.clip(
                sample,
                -128,
                127,
            ).astype(np.int8)

        interpreter.set_tensor(
            input_index,
            sample,
        )

        interpreter.invoke()

        output = interpreter.get_tensor(
            output_index
        )

        if output_dtype == np.int8:

            probability = (
                output.astype(np.float32)
                - output_zero
            ) * output_scale

        else:

            probability = (
                output.astype(np.float32)
            )

        probabilities.append(
            float(
                probability.reshape(-1)[0]
            )
        )

    return np.asarray(
        probabilities,
        dtype=np.float32,
    )


# ============================================================
# LOAD MODEL PROBABILITIES
# ============================================================

print("\n[2/6] Running FP32 TFLite inference...")

fp32_prob = get_tflite_probabilities(
    FP32_MODEL_PATH,
    X_test,
)

print("\n[3/6] Running INT8 TFLite inference...")

int8_prob = get_tflite_probabilities(
    INT8_MODEL_PATH,
    X_test,
)


# ============================================================
# METRIC CALCULATION
# ============================================================

def calculate_threshold_metrics(
    probabilities,
    y_true,
    threshold,
    model_name,
):

    predictions = (
        probabilities >= threshold
    ).astype(np.int32)

    accuracy = accuracy_score(
        y_true,
        predictions,
    )

    precision = precision_score(
        y_true,
        predictions,
        zero_division=0,
    )

    recall = recall_score(
        y_true,
        predictions,
        zero_division=0,
    )

    f1 = f1_score(
        y_true,
        predictions,
        zero_division=0,
    )

    macro_f1 = f1_score(
        y_true,
        predictions,
        average="macro",
        zero_division=0,
    )

    balanced_accuracy = (
        balanced_accuracy_score(
            y_true,
            predictions,
        )
    )

    cm = confusion_matrix(
        y_true,
        predictions,
    )

    tn, fp, fn, tp = cm.ravel()

    fpr = (
        fp / (fp + tn)
        if (fp + tn) > 0
        else 0
    )

    fnr = (
        fn / (fn + tp)
        if (fn + tp) > 0
        else 0
    )

    predicted_high_rate = (
        np.mean(predictions)
    )

    # Space DTN interpretation:
    #
    # false negative = urgent/anomalous telemetry
    #                  incorrectly treated as normal
    #
    # false positive = normal telemetry
    #                  promoted to high priority
    #
    # We therefore track both explicitly.

    return {
        "model": model_name,
        "threshold": float(threshold),
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "macro_f1": float(macro_f1),
        "balanced_accuracy": float(
            balanced_accuracy
        ),
        "true_negative": int(tn),
        "false_positive": int(fp),
        "false_negative": int(fn),
        "true_positive": int(tp),
        "false_positive_rate": float(fpr),
        "false_negative_rate": float(fnr),
        "predicted_high_priority_rate": float(
            predicted_high_rate
        ),
    }


# ============================================================
# EVALUATE ALL THRESHOLDS
# ============================================================

print("\n[4/6] Evaluating thresholds...")

rows = []

for model_name, probabilities in [
    (
        "TensorFlow Lite FP32",
        fp32_prob,
    ),
    (
        "TensorFlow Lite INT8",
        int8_prob,
    ),
]:

    for threshold in THRESHOLDS:

        rows.append(
            calculate_threshold_metrics(
                probabilities,
                y_test,
                threshold,
                model_name,
            )
        )

results_df = pd.DataFrame(rows)

results_df.to_csv(
    METRICS_DIR
    / "threshold_results.csv",
    index=False,
)


# ============================================================
# SELECT USEFUL OPERATING POINTS
# ============================================================

def choose_operating_points(
    model_results,
):
    """
    Produce several useful operating points.

    These are not universal 'best' thresholds.
    They represent different engineering priorities.
    """

    # Highest F1
    best_f1 = model_results.loc[
        model_results["f1"].idxmax()
    ]

    # Highest recall while keeping precision >= 0.50
    precision_constrained = (
        model_results[
            model_results["precision"] >= 0.50
        ]
    )

    if len(precision_constrained) > 0:
        best_recall_50p = (
            precision_constrained.loc[
                precision_constrained["recall"].idxmax()
            ]
        )
    else:
        best_recall_50p = None

    # Highest recall while keeping FPR <= 0.20
    fpr_constrained = (
        model_results[
            model_results["false_positive_rate"]
            <= 0.20
        ]
    )

    if len(fpr_constrained) > 0:
        best_recall_20fpr = (
            fpr_constrained.loc[
                fpr_constrained["recall"].idxmax()
            ]
        )
    else:
        best_recall_20fpr = None

    # Lowest threshold where recall reaches 50%
    recall_50 = (
        model_results[
            model_results["recall"] >= 0.50
        ]
    )

    if len(recall_50) > 0:
        recall_50_point = (
            recall_50.sort_values(
                "threshold"
            ).iloc[0]
        )
    else:
        recall_50_point = None

    def row_to_dict(row):
        if row is None:
            return None

        return {
            key: (
                value.item()
                if isinstance(
                    value,
                    np.generic,
                )
                else value
            )
            for key, value in row.to_dict().items()
        }

    return {
        "highest_f1": row_to_dict(
            best_f1
        ),
        "highest_recall_precision_at_least_50pct": (
            row_to_dict(
                best_recall_50p
            )
        ),
        "highest_recall_fpr_at_most_20pct": (
            row_to_dict(
                best_recall_20fpr
            )
        ),
        "first_threshold_reaching_50pct_recall": (
            row_to_dict(
                recall_50_point
            )
        ),
    }


recommendations = {}

for model_name in results_df["model"].unique():

    model_results = results_df[
        results_df["model"] == model_name
    ].copy()

    recommendations[
        model_name
    ] = choose_operating_points(
        model_results
    )


with open(
    METRICS_DIR
    / "threshold_recommendations.json",
    "w",
    encoding="utf-8",
) as f:

    json.dump(
        recommendations,
        f,
        indent=4,
    )


# ============================================================
# PLOTS
# ============================================================

print("\n[5/6] Generating threshold plots...")


def plot_two_models(
    x,
    y_column,
    ylabel,
    title,
    filename,
):

    plt.figure(figsize=(10, 6))

    for model_name in results_df["model"].unique():

        subset = results_df[
            results_df["model"] == model_name
        ]

        plt.plot(
            subset["threshold"],
            subset[y_column],
            marker="o",
            label=model_name,
        )

    plt.xlabel("Decision Threshold")
    plt.ylabel(ylabel)
    plt.title(title)
    plt.grid(alpha=0.25)
    plt.legend()
    plt.tight_layout()

    plt.savefig(
        PLOTS_DIR / filename,
        dpi=200,
    )

    plt.close()


plot_two_models(
    THRESHOLDS,
    "precision",
    "Precision",
    "Precision vs Decision Threshold",
    "threshold_precision.png",
)

plot_two_models(
    THRESHOLDS,
    "recall",
    "Recall",
    "Recall vs Decision Threshold",
    "threshold_recall.png",
)

plot_two_models(
    THRESHOLDS,
    "f1",
    "F1 Score",
    "F1 Score vs Decision Threshold",
    "threshold_f1.png",
)

plot_two_models(
    THRESHOLDS,
    "false_negative_rate",
    "False Negative Rate",
    "False Negative Rate vs Decision Threshold",
    "threshold_false_negative_rate.png",
)

plot_two_models(
    THRESHOLDS,
    "predicted_high_priority_rate",
    "Fraction Classified as High Priority",
    "DTN Priority Load vs Decision Threshold",
    "threshold_dtn_priority_load.png",
)


# Combined precision-recall trade-off
plt.figure(figsize=(10, 6))

for model_name in results_df["model"].unique():

    subset = results_df[
        results_df["model"] == model_name
    ]

    plt.plot(
        subset["recall"],
        subset["precision"],
        marker="o",
        label=model_name,
    )

    for _, row in subset.iterrows():

        if row["threshold"] in [0.20, 0.30, 0.40, 0.50]:
            plt.annotate(
                f"{row['threshold']:.2f}",
                (
                    row["recall"],
                    row["precision"],
                ),
            )

plt.xlabel("Recall")
plt.ylabel("Precision")
plt.title(
    "Precision-Recall Operating Trade-off"
)
plt.grid(alpha=0.25)
plt.legend()
plt.tight_layout()

plt.savefig(
    PLOTS_DIR
    / "threshold_precision_recall_tradeoff.png",
    dpi=200,
)

plt.close()


# ============================================================
# REPORT
# ============================================================

print("\n[6/6] Creating threshold report...")

report_path = (
    REPORTS_DIR
    / "threshold_optimization_report.md"
)

with open(
    report_path,
    "w",
    encoding="utf-8",
) as report:

    report.write(
        "# Space DTN TinyML Threshold Optimization\n\n"
    )

    report.write(
        "## Objective\n\n"
    )

    report.write(
        "The default classification threshold of 0.50 "
        "was evaluated against alternative thresholds "
        "to understand the trade-off between detecting "
        "high-priority telemetry and unnecessarily "
        "promoting normal telemetry to high priority.\n\n"
    )

    report.write(
        "## DTN Interpretation\n\n"
    )

    report.write(
        "- **False Negative:** anomalous/high-priority "
        "telemetry classified as normal.\n"
        "- **False Positive:** normal telemetry promoted "
        "to high priority.\n"
        "- **Predicted high-priority rate:** fraction of "
        "telemetry that would enter the high-priority "
        "transmission path.\n\n"
    )

    for model_name in recommendations:

        report.write(
            f"## {model_name}\n\n"
        )

        model_results = results_df[
            results_df["model"] == model_name
        ]

        report.write(
            "| Threshold | Precision | Recall | F1 | "
            "FNR | FPR | High Priority Rate |\n"
        )

        report.write(
            "|---:|---:|---:|---:|---:|---:|---:|\n"
        )

        for _, row in model_results.iterrows():

            report.write(
                f"| {row['threshold']:.2f} | "
                f"{row['precision']:.4f} | "
                f"{row['recall']:.4f} | "
                f"{row['f1']:.4f} | "
                f"{row['false_negative_rate']:.4f} | "
                f"{row['false_positive_rate']:.4f} | "
                f"{row['predicted_high_priority_rate']:.4f} |\n"
            )

        report.write("\n")

        points = recommendations[
            model_name
        ]

        report.write(
            "### Operating Points\n\n"
        )

        for label, row in points.items():

            report.write(
                f"**{label}:**\n\n"
            )

            if row is None:
                report.write(
                    "No threshold in the tested range "
                    "satisfied this condition.\n\n"
                )
            else:

                report.write(
                    f"- Threshold: `{row['threshold']:.2f}`\n"
                    f"- Precision: `{row['precision']:.4f}`\n"
                    f"- Recall: `{row['recall']:.4f}`\n"
                    f"- F1: `{row['f1']:.4f}`\n"
                    f"- False-negative rate: "
                    f"`{row['false_negative_rate']:.4f}`\n"
                    f"- False-positive rate: "
                    f"`{row['false_positive_rate']:.4f}`\n\n"
                )

    report.write(
        "## Engineering Note\n\n"
    )

    report.write(
        "There is no universally correct threshold for the "
        "Space DTN priority engine. The threshold should be "
        "selected according to the communication budget and "
        "the operational cost of missing urgent telemetry "
        "versus promoting additional normal telemetry.\n\n"
    )

    report.write(
        "The threshold selected here should therefore be "
        "treated as an engineering operating point rather "
        "than a claim that it is universally optimal.\n"
    )


# ============================================================
# CONSOLE SUMMARY
# ============================================================

print("\n" + "=" * 72)
print("THRESHOLD OPTIMIZATION COMPLETE")
print("=" * 72)

for model_name in recommendations:

    print(f"\n{model_name}")

    points = recommendations[
        model_name
    ]

    for label, row in points.items():

        if row is None:
            print(
                f"  {label}: no matching threshold"
            )
        else:
            print(
                f"  {label}: "
                f"threshold={row['threshold']:.2f}, "
                f"precision={row['precision']:.4f}, "
                f"recall={row['recall']:.4f}, "
                f"F1={row['f1']:.4f}, "
                f"FNR={row['false_negative_rate']:.4f}"
            )

print("\nResults:")
print(
    METRICS_DIR
    / "threshold_results.csv"
)

print("\nDone.")

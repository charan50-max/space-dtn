# tinyml/train_tinyml.py

from pathlib import Path
import json
import time
import sys
import platform

import joblib
import numpy as np
import pandas as pd
import matplotlib.pyplot as plt

from sklearn.linear_model import LogisticRegression
from sklearn.tree import DecisionTreeClassifier
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score,
    precision_score,
    recall_score,
    f1_score,
    balanced_accuracy_score,
    roc_auc_score,
    average_precision_score,
    confusion_matrix,
    classification_report,
    roc_curve,
    precision_recall_curve,
)


# ============================================================
# 1. PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

TRAIN_PATH = PROJECT_ROOT / "tinyml" / "data" / "processed" / "tinyml_train.csv"
TEST_PATH = PROJECT_ROOT / "tinyml" / "data" / "processed" / "tinyml_test.csv"

EVALUATION_DIR = PROJECT_ROOT / "evaluation"

METRICS_DIR = EVALUATION_DIR / "metrics"
PLOTS_DIR = EVALUATION_DIR / "plots"
MODELS_DIR = EVALUATION_DIR / "models"
REPORTS_DIR = EVALUATION_DIR / "reports"

for directory in [
    EVALUATION_DIR,
    METRICS_DIR,
    PLOTS_DIR,
    MODELS_DIR,
    REPORTS_DIR,
]:
    directory.mkdir(parents=True, exist_ok=True)


# ============================================================
# 2. CONFIGURATION
# ============================================================

RANDOM_STATE = 42

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


# ============================================================
# 3. LOAD DATA
# ============================================================

print("=" * 70)
print("SPACE DTN - TINYML TRAINING")
print("=" * 70)

print("\n[1/7] Loading datasets...")

if not TRAIN_PATH.exists():
    raise FileNotFoundError(
        f"Training dataset not found:\n{TRAIN_PATH}"
    )

if not TEST_PATH.exists():
    raise FileNotFoundError(
        f"Testing dataset not found:\n{TEST_PATH}"
    )

train_df = pd.read_csv(TRAIN_PATH)
test_df = pd.read_csv(TEST_PATH)

print(f"Training samples : {len(train_df):,}")
print(f"Testing samples  : {len(test_df):,}")
print(f"Features         : {len(FEATURES)}")


# ============================================================
# 4. VALIDATE DATA
# ============================================================

print("\n[2/7] Validating dataset...")

required_columns = FEATURES + [TARGET]

for column in required_columns:
    if column not in train_df.columns:
        raise ValueError(
            f"Missing column '{column}' in training dataset."
        )

    if column not in test_df.columns:
        raise ValueError(
            f"Missing column '{column}' in testing dataset."
        )

X_train = train_df[FEATURES].copy()
y_train = train_df[TARGET].astype(int).copy()

X_test = test_df[FEATURES].copy()
y_test = test_df[TARGET].astype(int).copy()

# Check missing values
if X_train.isnull().sum().sum() > 0:
    raise ValueError("Training data contains missing feature values.")

if X_test.isnull().sum().sum() > 0:
    raise ValueError("Testing data contains missing feature values.")

print("Dataset validation: PASSED")

print("\nTraining class distribution:")
print(y_train.value_counts().sort_index())

print("\nTesting class distribution:")
print(y_test.value_counts().sort_index())


# ============================================================
# 5. DEFINE TINYML MODELS
# ============================================================

print("\n[3/7] Preparing TinyML candidate models...")

models = {
    "Logistic Regression": Pipeline(
        [
            ("scaler", StandardScaler()),
            (
                "classifier",
                LogisticRegression(
                    max_iter=1000,
                    random_state=RANDOM_STATE,
                    class_weight=None,
                ),
            ),
        ]
    ),

    "Decision Tree": DecisionTreeClassifier(
        max_depth=8,
        min_samples_leaf=10,
        random_state=RANDOM_STATE,
        class_weight=None,
    ),

    "Random Forest": RandomForestClassifier(
        n_estimators=50,
        max_depth=8,
        min_samples_leaf=5,
        random_state=RANDOM_STATE,
        n_jobs=-1,
        class_weight=None,
    ),

    "Extra Trees": ExtraTreesClassifier(
        n_estimators=50,
        max_depth=8,
        min_samples_leaf=5,
        random_state=RANDOM_STATE,
        n_jobs=-1,
        class_weight=None,
    ),
}


# ============================================================
# 6. HELPER FUNCTIONS
# ============================================================

def measure_model_size(model, path):
    """
    Save model temporarily and measure serialized size.
    """
    joblib.dump(model, path)
    size_bytes = path.stat().st_size

    return {
        "model_size_bytes": int(size_bytes),
        "model_size_kb": round(size_bytes / 1024, 2),
        "model_size_mb": round(size_bytes / (1024 * 1024), 4),
    }


def measure_inference_time(model, X):
    """
    Measure prediction latency.

    Uses a small batch repeatedly to obtain a stable estimate.
    """
    sample_size = min(1000, len(X))
    X_sample = X.iloc[:sample_size]

    # Warm-up
    model.predict(X_sample)

    repetitions = 20

    start = time.perf_counter()

    for _ in range(repetitions):
        model.predict(X_sample)

    elapsed = time.perf_counter() - start

    total_predictions = repetitions * sample_size

    latency_ms = (elapsed / repetitions) * 1000
    per_sample_ms = (elapsed / total_predictions) * 1000

    return {
        "inference_batch_size": sample_size,
        "inference_latency_ms": round(latency_ms, 4),
        "inference_per_sample_ms": round(per_sample_ms, 6),
        "predictions_per_second": round(
            1000 / per_sample_ms, 2
        ) if per_sample_ms > 0 else None,
    }


def get_model_complexity(model):
    """
    Extract simple resource-complexity information.
    """

    complexity = {}

    # Pipeline / Logistic Regression
    if isinstance(model, Pipeline):
        classifier = model.named_steps["classifier"]

        if isinstance(classifier, LogisticRegression):
            complexity["model_type"] = "LogisticRegression"
            complexity["coefficient_count"] = int(
                np.prod(classifier.coef_.shape)
            )
            complexity["intercept_count"] = int(
                np.prod(classifier.intercept_.shape)
            )

        return complexity

    # Decision Tree
    if isinstance(model, DecisionTreeClassifier):
        complexity["model_type"] = "DecisionTree"
        complexity["tree_count"] = 1
        complexity["max_depth"] = int(model.get_depth())
        complexity["node_count"] = int(model.tree_.node_count)
        complexity["leaf_count"] = int(
            model.get_n_leaves()
        )

        return complexity

    # Random Forest / Extra Trees
    if isinstance(
        model,
        (RandomForestClassifier, ExtraTreesClassifier),
    ):
        complexity["model_type"] = type(model).__name__
        complexity["tree_count"] = int(len(model.estimators_))
        complexity["max_depth"] = int(
            max(
                tree.get_depth()
                for tree in model.estimators_
            )
        )
        complexity["total_nodes"] = int(
            sum(
                tree.tree_.node_count
                for tree in model.estimators_
            )
        )
        complexity["total_leaves"] = int(
            sum(
                tree.get_n_leaves()
                for tree in model.estimators_
            )
        )

        return complexity

    return complexity


def get_feature_importance(model):

    if isinstance(model, Pipeline):

        classifier = model.named_steps["classifier"]

        if hasattr(classifier, "coef_"):
            importance = np.abs(
                classifier.coef_[0]
            )

            return pd.DataFrame(
                {
                    "feature": FEATURES,
                    "importance": importance,
                }
            ).sort_values(
                "importance",
                ascending=False,
            )

    if hasattr(model, "feature_importances_"):

        return pd.DataFrame(
            {
                "feature": FEATURES,
                "importance": model.feature_importances_,
            }
        ).sort_values(
            "importance",
            ascending=False,
        )

    return None


# ============================================================
# 7. TRAIN MODELS
# ============================================================

print("\n[4/7] Training models...")
print("-" * 70)

results = {}
predictions = {}

for model_name, model in models.items():

    safe_name = (
        model_name.lower()
        .replace(" ", "_")
    )

    print(f"\nTraining {model_name}...")

    start_time = time.perf_counter()

    model.fit(X_train, y_train)

    training_time = (
        time.perf_counter() - start_time
    )

    # Predictions
    y_pred = model.predict(X_test)

    if hasattr(model, "predict_proba"):
        y_probability = model.predict_proba(X_test)[:, 1]
    else:
        y_probability = model.decision_function(X_test)

    # Metrics
    accuracy = accuracy_score(y_test, y_pred)

    precision = precision_score(
        y_test,
        y_pred,
        zero_division=0,
    )

    recall = recall_score(
        y_test,
        y_pred,
        zero_division=0,
    )

    f1 = f1_score(
        y_test,
        y_pred,
        zero_division=0,
    )

    macro_f1 = f1_score(
        y_test,
        y_pred,
        average="macro",
        zero_division=0,
    )

    balanced_accuracy = balanced_accuracy_score(
        y_test,
        y_pred,
    )

    roc_auc = roc_auc_score(
        y_test,
        y_probability,
    )

    pr_auc = average_precision_score(
        y_test,
        y_probability,
    )

    cm = confusion_matrix(
        y_test,
        y_pred,
    )

    tn, fp, fn, tp = cm.ravel()

    false_positive_rate = (
        fp / (fp + tn)
        if (fp + tn) > 0
        else 0
    )

    false_negative_rate = (
        fn / (fn + tp)
        if (fn + tp) > 0
        else 0
    )

    # Save model
    model_path = (
        MODELS_DIR /
        f"{safe_name}.joblib"
    )

    size_info = measure_model_size(
        model,
        model_path,
    )

    inference_info = measure_inference_time(
        model,
        X_test,
    )

    complexity_info = get_model_complexity(
        model
    )

    # Feature importance
    importance_df = get_feature_importance(model)

    if importance_df is not None:

        importance_path = (
            METRICS_DIR /
            f"{safe_name}_feature_importance.csv"
        )

        importance_df.to_csv(
            importance_path,
            index=False,
        )

        # Feature importance plot
        plt.figure(figsize=(9, 6))

        plot_df = importance_df.sort_values(
            "importance",
            ascending=True,
        )

        plt.barh(
            plot_df["feature"],
            plot_df["importance"],
        )

        plt.xlabel("Importance")
        plt.ylabel("Feature")
        plt.title(
            f"{model_name} - Feature Importance"
        )

        plt.tight_layout()

        plt.savefig(
            PLOTS_DIR /
            f"feature_importance_{safe_name}.png",
            dpi=200,
        )

        plt.close()

    # Store results
    metrics = {
        "model": model_name,

        "accuracy": round(
            accuracy, 6
        ),

        "precision": round(
            precision, 6
        ),

        "recall": round(
            recall, 6
        ),

        "f1": round(
            f1, 6
        ),

        "macro_f1": round(
            macro_f1, 6
        ),

        "balanced_accuracy": round(
            balanced_accuracy, 6
        ),

        "roc_auc": round(
            roc_auc, 6
        ),

        "pr_auc": round(
            pr_auc, 6
        ),

        "true_negative": int(tn),
        "false_positive": int(fp),
        "false_negative": int(fn),
        "true_positive": int(tp),

        "false_positive_rate": round(
            false_positive_rate,
            6,
        ),

        "false_negative_rate": round(
            false_negative_rate,
            6,
        ),

        "training_time_seconds": round(
            training_time,
            4,
        ),

        **size_info,
        **inference_info,
        **complexity_info,

        "training_samples": int(
            len(X_train)
        ),

        "testing_samples": int(
            len(X_test)
        ),

        "feature_count": len(FEATURES),

        "features": FEATURES,
    }

    results[model_name] = metrics

    predictions[model_name] = {
        "y_pred": y_pred,
        "y_probability": y_probability,
    }

    # Save individual JSON
    with open(
        METRICS_DIR /
        f"{safe_name}_metrics.json",
        "w",
        encoding="utf-8",
    ) as f:

        json.dump(
            metrics,
            f,
            indent=4,
        )

    # Confusion matrix
    plt.figure(figsize=(6, 5))

    plt.imshow(
        cm,
        interpolation="nearest",
    )

    plt.title(
        f"{model_name} - Confusion Matrix"
    )

    plt.colorbar()

    plt.xticks(
        [0, 1],
        ["Normal", "High Priority"],
    )

    plt.yticks(
        [0, 1],
        ["Normal", "High Priority"],
    )

    plt.xlabel("Predicted")
    plt.ylabel("Actual")

    for i in range(2):
        for j in range(2):

            plt.text(
                j,
                i,
                str(cm[i, j]),
                ha="center",
                va="center",
            )

    plt.tight_layout()

    plt.savefig(
        PLOTS_DIR /
        f"confusion_matrix_{safe_name}.png",
        dpi=200,
    )

    plt.close()

    print(
        f"Accuracy : {accuracy:.4f} | "
        f"Precision: {precision:.4f} | "
        f"Recall  : {recall:.4f} | "
        f"F1      : {f1:.4f} | "
        f"PR-AUC  : {pr_auc:.4f}"
    )


# ============================================================
# 8. MODEL COMPARISON
# ============================================================

print("\n[5/7] Creating model comparison...")

comparison_df = pd.DataFrame(
    results.values()
)

# Put the most important columns first
preferred_columns = [
    "model",
    "accuracy",
    "precision",
    "recall",
    "f1",
    "macro_f1",
    "balanced_accuracy",
    "roc_auc",
    "pr_auc",
    "false_positive_rate",
    "false_negative_rate",
    "training_time_seconds",
    "model_size_kb",
    "inference_per_sample_ms",
    "predictions_per_second",
    "tree_count",
    "max_depth",
    "node_count",
    "total_nodes",
]

existing_columns = [
    c for c in preferred_columns
    if c in comparison_df.columns
]

remaining_columns = [
    c for c in comparison_df.columns
    if c not in existing_columns
]

comparison_df = comparison_df[
    existing_columns + remaining_columns
]

comparison_path = (
    METRICS_DIR /
    "model_comparison.csv"
)

comparison_df.to_csv(
    comparison_path,
    index=False,
)

print("\nMODEL COMPARISON")
print(
    comparison_df[
        [
            "model",
            "accuracy",
            "precision",
            "recall",
            "f1",
            "macro_f1",
            "roc_auc",
            "pr_auc",
            "model_size_kb",
            "inference_per_sample_ms",
        ]
    ].to_string(index=False)
)


# ============================================================
# 9. SELECT MODEL
# ============================================================

# For Space DTN, missing a high-priority/anomalous
# message is more important than simply maximizing accuracy.
#
# Therefore the selection metric is:
#
#     60% F1
#     40% Recall
#
# This is NOT a universal ML rule. It is chosen specifically
# for this DTN priority-engine experiment.

comparison_df["selection_score"] = (
    0.60 * comparison_df["f1"]
    +
    0.40 * comparison_df["recall"]
)

best_row = comparison_df.sort_values(
    "selection_score",
    ascending=False,
).iloc[0]

best_model_name = best_row["model"]

best_model = models[best_model_name]

best_model_source = (
    MODELS_DIR /
    (
        best_model_name
        .lower()
        .replace(" ", "_")
        + ".joblib"
    )
)

best_model_path = (
    MODELS_DIR /
    "best_model.joblib"
)

joblib.dump(
    best_model,
    best_model_path,
)

print(
    f"\nSelected model: {best_model_name}"
)

print(
    "Selection is based on F1 + recall "
    "because high-priority false negatives "
    "are important for the Space DTN use case."
)


# ============================================================
# 10. ROC CURVES
# ============================================================

print("\nCreating ROC and Precision-Recall curves...")

plt.figure(figsize=(9, 7))

for model_name, prediction in predictions.items():

    fpr, tpr, _ = roc_curve(
        y_test,
        prediction["y_probability"],
    )

    auc_value = results[model_name]["roc_auc"]

    plt.plot(
        fpr,
        tpr,
        label=f"{model_name} (AUC={auc_value:.3f})",
    )

plt.plot(
    [0, 1],
    [0, 1],
    linestyle="--",
)

plt.xlabel("False Positive Rate")
plt.ylabel("True Positive Rate")

plt.title(
    "TinyML Model ROC Curves"
)

plt.legend()

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "roc_curves.png",
    dpi=200,
)

plt.close()


# ============================================================
# 11. PRECISION-RECALL CURVES
# ============================================================

plt.figure(figsize=(9, 7))

for model_name, prediction in predictions.items():

    precision_curve, recall_curve, _ = (
        precision_recall_curve(
            y_test,
            prediction["y_probability"],
        )
    )

    pr_auc = results[model_name]["pr_auc"]

    plt.plot(
        recall_curve,
        precision_curve,
        label=f"{model_name} (AP={pr_auc:.3f})",
    )

plt.xlabel("Recall")
plt.ylabel("Precision")

plt.title(
    "TinyML Model Precision-Recall Curves"
)

plt.legend()

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "precision_recall_curves.png",
    dpi=200,
)

plt.close()


# ============================================================
# 12. METRIC COMPARISON GRAPH
# ============================================================

metric_columns = [
    "accuracy",
    "precision",
    "recall",
    "f1",
    "macro_f1",
    "roc_auc",
    "pr_auc",
]

plot_df = comparison_df.set_index(
    "model"
)[metric_columns]

plt.figure(figsize=(12, 7))

plot_df.plot(
    kind="bar",
)

plt.ylim(0, 1)

plt.ylabel("Score")

plt.xlabel("Model")

plt.title(
    "TinyML Model Performance Comparison"
)

plt.xticks(
    rotation=20,
    ha="right",
)

plt.legend(
    bbox_to_anchor=(1.02, 1),
    loc="upper left",
)

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "model_comparison.png",
    dpi=200,
)

plt.close()


# ============================================================
# 13. MODEL SIZE COMPARISON
# ============================================================

plt.figure(figsize=(9, 6))

plt.bar(
    comparison_df["model"],
    comparison_df["model_size_kb"],
)

plt.ylabel("Model Size (KB)")
plt.xlabel("Model")

plt.title(
    "TinyML Model Storage Size Comparison"
)

plt.xticks(
    rotation=20,
    ha="right",
)

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "model_size_comparison.png",
    dpi=200,
)

plt.close()


# ============================================================
# 14. INFERENCE TIME COMPARISON
# ============================================================

plt.figure(figsize=(9, 6))

plt.bar(
    comparison_df["model"],
    comparison_df[
        "inference_per_sample_ms"
    ],
)

plt.ylabel(
    "Inference Time per Sample (ms)"
)

plt.xlabel("Model")

plt.title(
    "TinyML Inference Latency Comparison"
)

plt.xticks(
    rotation=20,
    ha="right",
)

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "inference_time_comparison.png",
    dpi=200,
)

plt.close()


# ============================================================
# 15. SAVE COMPLETE TRAINING SUMMARY
# ============================================================

print("\n[6/7] Saving training summary...")

best_metrics = results[best_model_name]

summary = {
    "project": "Space DTN - Disruption Tolerant Space Data Routing",
    "task": "TinyML message priority classification",

    "target": {
        "name": TARGET,
        "class_0": "Normal / Low Priority",
        "class_1": "Anomalous / High Priority",
        "note": (
            "Priority is a derived proxy from the source "
            "satellite anomaly label. The original dataset "
            "does not contain a native DTN priority label."
        ),
    },

    "dataset": {
        "training_samples": len(train_df),
        "testing_samples": len(test_df),
        "feature_count": len(FEATURES),
        "features": FEATURES,
    },

    "models_evaluated": list(models.keys()),

    "selection_rule": (
        "0.60 * F1 + 0.40 * Recall"
    ),

    "selected_model": best_model_name,

    "selected_model_metrics": best_metrics,

    "system": {
        "python_version": sys.version,
        "platform": platform.platform(),
        "processor": platform.processor(),
    },

    "resource_metrics": {
        "model_size_kb": best_metrics[
            "model_size_kb"
        ],
        "inference_per_sample_ms": best_metrics[
            "inference_per_sample_ms"
        ],
        "predictions_per_second": best_metrics[
            "predictions_per_second"
        ],
    },
}

with open(
    EVALUATION_DIR /
    "training_summary.json",
    "w",
    encoding="utf-8",
) as f:

    json.dump(
        summary,
        f,
        indent=4,
        default=str,
    )


# ============================================================
# 16. GENERATE MARKDOWN REPORT
# ============================================================

print("[7/7] Generating training report...")

report_path = (
    REPORTS_DIR /
    "training_report.md"
)

with open(
    report_path,
    "w",
    encoding="utf-8",
) as report:

    report.write(
        "# Space DTN TinyML Training Report\n\n"
    )

    report.write(
        "## 1. Objective\n\n"
    )

    report.write(
        "Train and evaluate lightweight machine-learning "
        "models for classifying satellite telemetry into "
        "normal/low-priority and anomalous/high-priority "
        "data for the Space DTN priority engine.\n\n"
    )

    report.write(
        "## 2. Important Target Definition\n\n"
    )

    report.write(
        "The original satellite dataset does not contain "
        "a native DTN priority label. Therefore, the "
        "`anomaly` label is used as a documented proxy:\n\n"
    )

    report.write(
        "- `0` = Normal / Low Priority\n"
        "- `1` = Anomalous / High Priority\n\n"
    )

    report.write(
        "This means the trained model predicts telemetry "
        "urgency, which can subsequently be mapped to "
        "DTN transmission priority.\n\n"
    )

    report.write(
        "## 3. Features\n\n"
    )

    for feature in FEATURES:
        report.write(
            f"- `{feature}`\n"
        )

    report.write("\n")

    report.write(
        "## 4. Models Evaluated\n\n"
    )

    for model_name in models:
        report.write(
            f"- {model_name}\n"
        )

    report.write("\n")

    report.write(
        "## 5. Model Performance\n\n"
    )

    report.write(
        "| Model | Accuracy | Precision | Recall | "
        "F1 | Macro F1 | ROC-AUC | PR-AUC | "
        "Size KB | Inference ms |\n"
    )

    report.write(
        "|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n"
    )

    for _, row in comparison_df.iterrows():

        report.write(
            f"| {row['model']} | "
            f"{row['accuracy']:.4f} | "
            f"{row['precision']:.4f} | "
            f"{row['recall']:.4f} | "
            f"{row['f1']:.4f} | "
            f"{row['macro_f1']:.4f} | "
            f"{row['roc_auc']:.4f} | "
            f"{row['pr_auc']:.4f} | "
            f"{row['model_size_kb']:.2f} | "
            f"{row['inference_per_sample_ms']:.6f} |\n"
        )

    report.write("\n")

    report.write(
        "## 6. Selected Model\n\n"
    )

    report.write(
        f"**{best_model_name}** was selected using the "
        "Space DTN-oriented selection score:\n\n"
    )

    report.write(
        "`0.60 × F1 + 0.40 × Recall`\n\n"
    )

    report.write(
        "Recall is given additional importance because a "
        "false negative means an anomalous/high-priority "
        "telemetry message could be incorrectly treated "
        "as normal and receive lower transmission priority.\n\n"
    )

    report.write(
        "## 7. Resource Efficiency\n\n"
    )

    report.write(
        f"- Model size: "
        f"{best_metrics['model_size_kb']:.2f} KB\n"
    )

    report.write(
        f"- Inference latency: "
        f"{best_metrics['inference_per_sample_ms']:.6f} ms/sample\n"
    )

    report.write(
        f"- Predictions/sec: "
        f"{best_metrics['predictions_per_second']:.2f}\n"
    )

    if "tree_count" in best_metrics:
        report.write(
            f"- Trees: "
            f"{best_metrics['tree_count']}\n"
        )

    if "max_depth" in best_metrics:
        report.write(
            f"- Maximum tree depth: "
            f"{best_metrics['max_depth']}\n"
        )

    if "total_nodes" in best_metrics:
        report.write(
            f"- Total tree nodes: "
            f"{best_metrics['total_nodes']}\n"
        )

    report.write("\n")

    report.write(
        "## 8. Generated Evaluation Artifacts\n\n"
    )

    report.write(
        "- Model comparison CSV\n"
        "- Individual model metric JSON files\n"
        "- Confusion matrices\n"
        "- ROC curves\n"
        "- Precision-Recall curves\n"
        "- Feature importance plots\n"
        "- Model-size comparison\n"
        "- Inference-time comparison\n"
        "- Serialized trained models\n"
        "- Training summary JSON\n"
    )

    report.write("\n")

    report.write(
        "## 9. Validation Limitation\n\n"
    )

    report.write(
        "The training and testing datasets are synthetic "
        "samples generated from the original satellite "
        "telemetry distribution. Segment groups were "
        "separated before synthetic sampling to reduce "
        "train/test leakage. However, final deployment "
        "validation should also be performed against "
        "untouched real satellite segments or a separate "
        "mission dataset.\n"
    )


# ============================================================
# 17. FINAL OUTPUT
# ============================================================

print("\n" + "=" * 70)
print("TRAINING COMPLETE")
print("=" * 70)

print(
    f"\nBest model: {best_model_name}"
)

print(
    f"F1 Score: {best_metrics['f1']:.4f}"
)

print(
    f"Recall: {best_metrics['recall']:.4f}"
)

print(
    f"PR-AUC: {best_metrics['pr_auc']:.4f}"
)

print(
    f"Model size: "
    f"{best_metrics['model_size_kb']:.2f} KB"
)

print(
    f"Inference: "
    f"{best_metrics['inference_per_sample_ms']:.6f} ms/sample"
)

print(
    f"\nEvaluation results saved to:"
)

print(
    EVALUATION_DIR
)

print("\nGenerated:")
print("  evaluation/metrics/")
print("  evaluation/plots/")
print("  evaluation/models/")
print("  evaluation/reports/")
print("  evaluation/training_summary.json")

print("\nDone.")
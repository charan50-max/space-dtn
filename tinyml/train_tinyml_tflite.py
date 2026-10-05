"""
Space DTN TinyML Training Pipeline
----------------------------------
Train a compact TensorFlow/Keras classifier and convert it to:
    1. FP32 TensorFlow Lite
    2. INT8 TensorFlow Lite

Expected project structure:

space_dtn/
├── tinyml/
│   ├── data/
│   │   └── processed/
│   │       ├── tinyml_train.csv
│   │       └── tinyml_test.csv
│   ├── models/
│   └── train_tinyml_tflite.py
└── evaluation/

Run from project root:
    python tinyml/train_tinyml_tflite.py

Install if required:
    pip install tensorflow pandas numpy scikit-learn matplotlib joblib
"""

from pathlib import Path
import json
import platform
import sys
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
    classification_report,
    roc_curve,
    precision_recall_curve,
)


# ============================================================
# 1. PROJECT PATHS
# ============================================================

PROJECT_ROOT = Path(__file__).resolve().parents[1]

TRAIN_PATH = (
    PROJECT_ROOT
    / "tinyml"
    / "data"
    / "processed"
    / "tinyml_train.csv"
)

TEST_PATH = (
    PROJECT_ROOT
    / "tinyml"
    / "data"
    / "processed"
    / "tinyml_test.csv"
)

# Models ONLY go here.
MODELS_DIR = (
    PROJECT_ROOT
    / "tinyml"
    / "models"
)

# Results / metrics / graphs ONLY go here.
EVALUATION_DIR = (
    PROJECT_ROOT
    / "evaluation"
)

METRICS_DIR = EVALUATION_DIR / "metrics"
PLOTS_DIR = EVALUATION_DIR / "plots"
REPORTS_DIR = EVALUATION_DIR / "reports"

for directory in [
    MODELS_DIR,
    EVALUATION_DIR,
    METRICS_DIR,
    PLOTS_DIR,
    REPORTS_DIR,
]:
    directory.mkdir(parents=True, exist_ok=True)


# ============================================================
# 2. CONFIGURATION
# ============================================================

SEED = 42

np.random.seed(SEED)
tf.random.set_seed(SEED)

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

# Small network intentionally chosen for TinyML.
HIDDEN_1 = 16
HIDDEN_2 = 8

EPOCHS = 30
BATCH_SIZE = 128

# Used for INT8 representative calibration.
CALIBRATION_SAMPLES = 10000


# ============================================================
# 3. LOAD DATA
# ============================================================

print("=" * 72)
print("SPACE DTN - TENSORFLOW LITE TINYML TRAINING")
print("=" * 72)

print("\n[1/9] Loading datasets...")

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

required_columns = FEATURES + [TARGET]

for column in required_columns:
    if column not in train_df.columns:
        raise ValueError(
            f"Missing '{column}' in training data."
        )

    if column not in test_df.columns:
        raise ValueError(
            f"Missing '{column}' in testing data."
        )

X_train = train_df[FEATURES].astype(np.float32).values
y_train = train_df[TARGET].astype(np.float32).values

X_test = test_df[FEATURES].astype(np.float32).values
y_test = test_df[TARGET].astype(np.int32).values

print(f"Training samples: {len(X_train):,}")
print(f"Testing samples : {len(X_test):,}")
print(f"Features        : {len(FEATURES)}")


# ============================================================
# 4. STANDARDIZATION
# ============================================================
# The scaler is fitted only on training data.
#
# IMPORTANT:
# The scaler parameters are part of the deployment pipeline.
# They are saved separately so the backend/edge device can
# apply exactly the same transformation before inference.
# ============================================================

print("\n[2/9] Standardizing features...")

from sklearn.preprocessing import StandardScaler

scaler = StandardScaler()

X_train_scaled = scaler.fit_transform(
    X_train
).astype(np.float32)

X_test_scaled = scaler.transform(
    X_test
).astype(np.float32)

# Save scaler parameters as JSON.
scaler_data = {
    "features": FEATURES,
    "mean": scaler.mean_.tolist(),
    "scale": scaler.scale_.tolist(),
}

with open(
    MODELS_DIR / "feature_scaler.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        scaler_data,
        f,
        indent=4,
    )


# ============================================================
# 5. BUILD SMALL NEURAL NETWORK
# ============================================================

print("\n[3/9] Building compact neural network...")

model = tf.keras.Sequential(
    [
        tf.keras.layers.Input(
            shape=(len(FEATURES),),
            name="telemetry_features",
        ),

        tf.keras.layers.Dense(
            HIDDEN_1,
            activation="relu",
            name="dense_16",
        ),

        tf.keras.layers.Dense(
            HIDDEN_2,
            activation="relu",
            name="dense_8",
        ),

        tf.keras.layers.Dense(
            1,
            activation="sigmoid",
            name="priority_probability",
        ),
    ],
    name="SpaceDTN_TinyML_Priority",
)

model.compile(
    optimizer=tf.keras.optimizers.Adam(
        learning_rate=0.001
    ),
    loss="binary_crossentropy",
    metrics=[
        tf.keras.metrics.BinaryAccuracy(
            name="accuracy"
        ),
        tf.keras.metrics.Precision(
            name="precision"
        ),
        tf.keras.metrics.Recall(
            name="recall"
        ),
        tf.keras.metrics.AUC(
            name="roc_auc"
        ),
        tf.keras.metrics.AUC(
            name="pr_auc",
            curve="PR",
        ),
    ],
)

model.summary()


# ============================================================
# 6. TRAIN
# ============================================================

print("\n[4/9] Training TinyML neural network...")

start_train = time.perf_counter()

history = model.fit(
    X_train_scaled,
    y_train,
    validation_split=0.15,
    epochs=EPOCHS,
    batch_size=BATCH_SIZE,
    shuffle=True,
    verbose=1,
)

training_time = time.perf_counter() - start_train

# Save native Keras model.
keras_path = MODELS_DIR / "tinyml_model.keras"
model.save(keras_path)

# Save training history.
history_path = METRICS_DIR / "training_history.json"

with open(
    history_path,
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        {
            key: [float(x) for x in values]
            for key, values in history.history.items()
        },
        f,
        indent=4,
    )


# ============================================================
# 7. TRAINING CURVES
# ============================================================

print("\n[5/9] Generating training curves...")

# Accuracy
plt.figure(figsize=(9, 6))

plt.plot(
    history.history["accuracy"],
    label="Training Accuracy",
)

plt.plot(
    history.history["val_accuracy"],
    label="Validation Accuracy",
)

plt.xlabel("Epoch")
plt.ylabel("Accuracy")
plt.title("TinyML Training vs Validation Accuracy")
plt.legend()
plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "training_accuracy.png",
    dpi=200,
)

plt.close()

# Loss
plt.figure(figsize=(9, 6))

plt.plot(
    history.history["loss"],
    label="Training Loss",
)

plt.plot(
    history.history["val_loss"],
    label="Validation Loss",
)

plt.xlabel("Epoch")
plt.ylabel("Binary Cross-Entropy Loss")
plt.title("TinyML Training vs Validation Loss")
plt.legend()
plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "training_loss.png",
    dpi=200,
)

plt.close()


# ============================================================
# 8. TFLITE CONVERSION
# ============================================================

print("\n[6/9] Converting model to TensorFlow Lite...")

# ------------------------------
# FP32 TFLite
# ------------------------------

fp32_path = (
    MODELS_DIR
    / "tinyml_model_fp32.tflite"
)

converter = tf.lite.TFLiteConverter.from_keras_model(
    model
)

fp32_tflite = converter.convert()

fp32_path.write_bytes(fp32_tflite)

print(
    f"FP32 TFLite size: "
    f"{fp32_path.stat().st_size / 1024:.2f} KB"
)


# ------------------------------
# INT8 TFLite
# ------------------------------

print("Creating INT8 quantized model...")

calibration_data = X_train_scaled

if len(calibration_data) > CALIBRATION_SAMPLES:
    rng = np.random.default_rng(SEED)

    indices = rng.choice(
        len(calibration_data),
        CALIBRATION_SAMPLES,
        replace=False,
    )

    calibration_data = calibration_data[indices]


def representative_dataset():
    for sample in calibration_data:
        yield [
            sample.reshape(1, -1).astype(
                np.float32
            )
        ]


int8_path = (
    MODELS_DIR
    / "tinyml_model_int8.tflite"
)

converter = tf.lite.TFLiteConverter.from_keras_model(
    model
)

converter.optimizations = [
    tf.lite.Optimize.DEFAULT
]

converter.representative_dataset = (
    representative_dataset
)

# Force integer operators.
converter.target_spec.supported_ops = [
    tf.lite.OpsSet.TFLITE_BUILTINS_INT8
]

# Fully integer input/output.
converter.inference_input_type = tf.int8
converter.inference_output_type = tf.int8

int8_tflite = converter.convert()

int8_path.write_bytes(int8_tflite)

print(
    f"INT8 TFLite size: "
    f"{int8_path.stat().st_size / 1024:.2f} KB"
)


# ============================================================
# 9. TFLITE INFERENCE + METRICS
# ============================================================

print("\n[7/9] Evaluating FP32 and INT8 TFLite models...")


def evaluate_tflite(
    model_path,
    X_data,
    y_data,
    model_name,
):
    """Run actual TFLite inference and calculate metrics."""

    interpreter = tf.lite.Interpreter(
        model_path=str(model_path)
    )

    interpreter.allocate_tensors()

    input_details = interpreter.get_input_details()
    output_details = interpreter.get_output_details()

    input_index = input_details[0]["index"]
    output_index = output_details[0]["index"]

    input_dtype = input_details[0]["dtype"]
    output_dtype = output_details[0]["dtype"]

    input_scale, input_zero = (
        input_details[0]["quantization"]
    )

    output_scale, output_zero = (
        output_details[0]["quantization"]
    )

    probabilities = []

    start = time.perf_counter()

    for sample in X_data:

        sample = sample.reshape(
            1,
            -1,
        ).astype(np.float32)

        if input_dtype == np.int8:

            if input_scale == 0:
                raise RuntimeError(
                    "Invalid INT8 input quantization scale."
                )

            sample = (
                sample / input_scale
                + input_zero
            )

            sample = np.clip(
                sample,
                -128,
                127,
            ).astype(np.int8)

        else:
            sample = sample.astype(
                input_dtype
            )

        interpreter.set_tensor(
            input_index,
            sample,
        )

        interpreter.invoke()

        output = interpreter.get_tensor(
            output_index
        )

        if output_dtype == np.int8:

            if output_scale == 0:
                raise RuntimeError(
                    "Invalid INT8 output quantization scale."
                )

            probability = (
                output.astype(np.float32)
                - output_zero
            ) * output_scale

        else:
            probability = output.astype(
                np.float32
            )

        probabilities.append(
            float(probability.reshape(-1)[0])
        )

    elapsed = time.perf_counter() - start

    probabilities = np.asarray(
        probabilities
    )

    probabilities = np.clip(
        probabilities,
        0.0,
        1.0,
    )

    predictions = (
        probabilities >= 0.5
    ).astype(np.int32)

    accuracy = accuracy_score(
        y_data,
        predictions,
    )

    precision = precision_score(
        y_data,
        predictions,
        zero_division=0,
    )

    recall = recall_score(
        y_data,
        predictions,
        zero_division=0,
    )

    f1 = f1_score(
        y_data,
        predictions,
        zero_division=0,
    )

    macro_f1 = f1_score(
        y_data,
        predictions,
        average="macro",
        zero_division=0,
    )

    balanced_accuracy = balanced_accuracy_score(
        y_data,
        predictions,
    )

    roc_auc = roc_auc_score(
        y_data,
        probabilities,
    )

    pr_auc = average_precision_score(
        y_data,
        probabilities,
    )

    cm = confusion_matrix(
        y_data,
        predictions,
    )

    tn, fp, fn, tp = cm.ravel()

    fpr = (
        fp / (fp + tn)
        if fp + tn > 0
        else 0
    )

    fnr = (
        fn / (fn + tp)
        if fn + tp > 0
        else 0
    )

    return {
        "model": model_name,
        "accuracy": float(accuracy),
        "precision": float(precision),
        "recall": float(recall),
        "f1": float(f1),
        "macro_f1": float(macro_f1),
        "balanced_accuracy": float(
            balanced_accuracy
        ),
        "roc_auc": float(roc_auc),
        "pr_auc": float(pr_auc),
        "true_negative": int(tn),
        "false_positive": int(fp),
        "false_negative": int(fn),
        "true_positive": int(tp),
        "false_positive_rate": float(fpr),
        "false_negative_rate": float(fnr),
        "inference_total_seconds": float(
            elapsed
        ),
        "inference_per_sample_ms": float(
            elapsed / len(X_data) * 1000
        ),
        "predictions_per_second": float(
            len(X_data) / elapsed
        ),
        "model_size_bytes": int(
            model_path.stat().st_size
        ),
        "model_size_kb": float(
            model_path.stat().st_size / 1024
        ),
        "input_dtype": str(input_dtype),
        "output_dtype": str(output_dtype),
        "input_shape": [
            int(x)
            for x in input_details[0]["shape"]
        ],
        "output_shape": [
            int(x)
            for x in output_details[0]["shape"]
        ],
        "input_quantization_scale": float(
            input_scale
        ),
        "input_quantization_zero_point": int(
            input_zero
        ),
        "output_quantization_scale": float(
            output_scale
        ),
        "output_quantization_zero_point": int(
            output_zero
        ),
    }, predictions, probabilities, cm


fp32_metrics, fp32_pred, fp32_prob, fp32_cm = (
    evaluate_tflite(
        fp32_path,
        X_test_scaled,
        y_test,
        "TensorFlow Lite FP32",
    )
)

int8_metrics, int8_pred, int8_prob, int8_cm = (
    evaluate_tflite(
        int8_path,
        X_test_scaled,
        y_test,
        "TensorFlow Lite INT8",
    )
)


# ============================================================
# 10. SAVE METRICS
# ============================================================

print("\n[8/9] Saving metrics and evaluation results...")

all_metrics = pd.DataFrame(
    [
        fp32_metrics,
        int8_metrics,
    ]
)

all_metrics.to_csv(
    METRICS_DIR / "tflite_model_comparison.csv",
    index=False,
)

with open(
    METRICS_DIR / "tflite_fp32_metrics.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        fp32_metrics,
        f,
        indent=4,
    )

with open(
    METRICS_DIR / "tflite_int8_metrics.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        int8_metrics,
        f,
        indent=4,
    )


# ============================================================
# 11. CONFUSION MATRICES
# ============================================================

def save_confusion_matrix(
    cm,
    title,
    filename,
):
    plt.figure(figsize=(6, 5))

    plt.imshow(
        cm,
        interpolation="nearest",
    )

    plt.title(title)
    plt.colorbar()

    plt.xticks(
        [0, 1],
        [
            "Normal",
            "High Priority",
        ],
    )

    plt.yticks(
        [0, 1],
        [
            "Normal",
            "High Priority",
        ],
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
        PLOTS_DIR / filename,
        dpi=200,
    )

    plt.close()


save_confusion_matrix(
    fp32_cm,
    "TensorFlow Lite FP32 Confusion Matrix",
    "confusion_matrix_tflite_fp32.png",
)

save_confusion_matrix(
    int8_cm,
    "TensorFlow Lite INT8 Confusion Matrix",
    "confusion_matrix_tflite_int8.png",
)


# ============================================================
# 12. ROC CURVE
# ============================================================

plt.figure(figsize=(9, 7))

for name, probabilities, metrics in [
    (
        "TFLite FP32",
        fp32_prob,
        fp32_metrics,
    ),
    (
        "TFLite INT8",
        int8_prob,
        int8_metrics,
    ),
]:
    fpr, tpr, _ = roc_curve(
        y_test,
        probabilities,
    )

    plt.plot(
        fpr,
        tpr,
        label=(
            f"{name} "
            f"(AUC={metrics['roc_auc']:.4f})"
        ),
    )

plt.plot(
    [0, 1],
    [0, 1],
    linestyle="--",
)

plt.xlabel("False Positive Rate")
plt.ylabel("True Positive Rate")
plt.title("TFLite ROC Curve")
plt.legend()
plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "tflite_roc_curve.png",
    dpi=200,
)

plt.close()


# ============================================================
# 13. PRECISION-RECALL CURVE
# ============================================================

plt.figure(figsize=(9, 7))

for name, probabilities, metrics in [
    (
        "TFLite FP32",
        fp32_prob,
        fp32_metrics,
    ),
    (
        "TFLite INT8",
        int8_prob,
        int8_metrics,
    ),
]:
    precision_curve, recall_curve, _ = (
        precision_recall_curve(
            y_test,
            probabilities,
        )
    )

    plt.plot(
        recall_curve,
        precision_curve,
        label=(
            f"{name} "
            f"(AP={metrics['pr_auc']:.4f})"
        ),
    )

plt.xlabel("Recall")
plt.ylabel("Precision")
plt.title(
    "TFLite Precision-Recall Curve"
)
plt.legend()
plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "tflite_precision_recall_curve.png",
    dpi=200,
)

plt.close()


# ============================================================
# 14. FP32 VS INT8 COMPARISON GRAPH
# ============================================================

comparison_metrics = [
    "accuracy",
    "precision",
    "recall",
    "f1",
    "macro_f1",
    "roc_auc",
    "pr_auc",
]

comparison_values = pd.DataFrame(
    {
        "FP32": [
            fp32_metrics[m]
            for m in comparison_metrics
        ],
        "INT8": [
            int8_metrics[m]
            for m in comparison_metrics
        ],
    },
    index=comparison_metrics,
)

comparison_values.plot(
    kind="bar",
    figsize=(11, 7),
)

plt.ylim(0, 1)

plt.ylabel("Score")
plt.xlabel("Metric")
plt.title(
    "TensorFlow Lite FP32 vs INT8"
)

plt.xticks(
    rotation=30,
    ha="right",
)

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "tflite_fp32_vs_int8.png",
    dpi=200,
)

plt.close()


# ============================================================
# 15. MODEL SIZE GRAPH
# ============================================================

plt.figure(figsize=(8, 6))

plt.bar(
    [
        "TFLite FP32",
        "TFLite INT8",
    ],
    [
        fp32_metrics["model_size_kb"],
        int8_metrics["model_size_kb"],
    ],
)

plt.ylabel("Model Size (KB)")
plt.title(
    "TFLite Model Size: FP32 vs INT8"
)

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "tflite_model_size.png",
    dpi=200,
)

plt.close()


# ============================================================
# 16. INFERENCE LATENCY GRAPH
# ============================================================

plt.figure(figsize=(8, 6))

plt.bar(
    [
        "TFLite FP32",
        "TFLite INT8",
    ],
    [
        fp32_metrics[
            "inference_per_sample_ms"
        ],
        int8_metrics[
            "inference_per_sample_ms"
        ],
    ],
)

plt.ylabel(
    "Inference Time (ms/sample)"
)

plt.title(
    "TFLite Inference Latency"
)

plt.tight_layout()

plt.savefig(
    PLOTS_DIR / "tflite_inference_latency.png",
    dpi=200,
)

plt.close()


# ============================================================
# 17. DETERMINE QUANTIZATION CHANGE
# ============================================================

size_reduction_percent = (
    1
    -
    (
        int8_metrics["model_size_bytes"]
        /
        fp32_metrics["model_size_bytes"]
    )
) * 100

f1_change = (
    int8_metrics["f1"]
    -
    fp32_metrics["f1"]
)

recall_change = (
    int8_metrics["recall"]
    -
    fp32_metrics["recall"]
)


# ============================================================
# 18. SAVE COMPLETE SUMMARY
# ============================================================

summary = {
    "project": (
        "Space DTN - Disruption Tolerant "
        "Space Data Routing & Priority Engine"
    ),

    "task": (
        "TinyML satellite telemetry "
        "priority classification"
    ),

    "target_definition": {
        "source_label": "anomaly",
        "derived_target": "priority",
        "class_0": "Normal / Low Priority",
        "class_1": "Anomalous / High Priority",
        "note": (
            "The source dataset has no native DTN priority "
            "label. Anomaly is used as a documented urgency "
            "proxy."
        ),
    },

    "features": FEATURES,

    "dataset": {
        "training_samples": int(len(X_train)),
        "testing_samples": int(len(X_test)),
        "training_high_priority_rate": float(
            np.mean(y_train)
        ),
        "testing_high_priority_rate": float(
            np.mean(y_test)
        ),
    },

    "architecture": {
        "input_features": len(FEATURES),
        "hidden_layer_1": HIDDEN_1,
        "hidden_layer_2": HIDDEN_2,
        "output_units": 1,
        "output_activation": "sigmoid",
        "optimizer": "Adam",
        "loss": "binary_crossentropy",
        "epochs": EPOCHS,
        "batch_size": BATCH_SIZE,
    },

    "training": {
        "training_time_seconds": float(
            training_time
        ),
        "tensorflow_version": tf.__version__,
        "python_version": sys.version,
        "platform": platform.platform(),
    },

    "models": {
        "keras": str(keras_path),
        "fp32_tflite": str(fp32_path),
        "int8_tflite": str(int8_path),
    },

    "fp32": fp32_metrics,
    "int8": int8_metrics,

    "quantization": {
        "size_reduction_percent": float(
            size_reduction_percent
        ),
        "f1_change": float(f1_change),
        "recall_change": float(recall_change),
    },

    "deployment_note": (
        "INT8 TFLite is the intended TinyML deployment "
        "candidate because integer quantization can reduce "
        "model storage and support constrained inference. "
        "Actual hardware validation should be performed "
        "on the intended edge/space-class processor."
    ),
}

with open(
    EVALUATION_DIR / "tflite_training_summary.json",
    "w",
    encoding="utf-8",
) as f:
    json.dump(
        summary,
        f,
        indent=4,
    )


# ============================================================
# 19. MARKDOWN REPORT
# ============================================================

report_path = (
    REPORTS_DIR
    / "tflite_training_report.md"
)

with open(
    report_path,
    "w",
    encoding="utf-8",
) as report:

    report.write(
        "# Space DTN TinyML - TensorFlow Lite Report\n\n"
    )

    report.write(
        "## 1. Objective\n\n"
    )

    report.write(
        "Train a compact neural-network classifier for "
        "satellite telemetry urgency and convert it to "
        "TensorFlow Lite for resource-constrained "
        "deployment.\n\n"
    )

    report.write(
        "## 2. Target\n\n"
    )

    report.write(
        "- `0` = Normal / Low Priority\n"
        "- `1` = Anomalous / High Priority\n\n"
    )

    report.write(
        "The original satellite dataset does not contain "
        "a native DTN priority label. The anomaly label is "
        "therefore used as a documented urgency proxy.\n\n"
    )

    report.write(
        "## 3. Input Features\n\n"
    )

    for feature in FEATURES:
        report.write(
            f"- `{feature}`\n"
        )

    report.write("\n")

    report.write(
        "## 4. Neural Network\n\n"
    )

    report.write(
        f"- Input: {len(FEATURES)} features\n"
        f"- Hidden layer 1: Dense({HIDDEN_1}, ReLU)\n"
        f"- Hidden layer 2: Dense({HIDDEN_2}, ReLU)\n"
        "- Output: Dense(1, Sigmoid)\n"
        "- Optimizer: Adam\n"
        "- Loss: Binary Cross-Entropy\n\n"
    )

    report.write(
        "## 5. FP32 vs INT8\n\n"
    )

    report.write(
        "| Metric | FP32 | INT8 |\n"
        "|---|---:|---:|\n"
    )

    for metric in [
        "accuracy",
        "precision",
        "recall",
        "f1",
        "macro_f1",
        "balanced_accuracy",
        "roc_auc",
        "pr_auc",
    ]:
        report.write(
            f"| {metric} | "
            f"{fp32_metrics[metric]:.6f} | "
            f"{int8_metrics[metric]:.6f} |\n"
        )

    report.write("\n")

    report.write(
        "| Resource Metric | FP32 | INT8 |\n"
        "|---|---:|---:|\n"
    )

    report.write(
        f"| Model size (KB) | "
        f"{fp32_metrics['model_size_kb']:.2f} | "
        f"{int8_metrics['model_size_kb']:.2f} |\n"
    )

    report.write(
        f"| Inference (ms/sample) | "
        f"{fp32_metrics['inference_per_sample_ms']:.6f} | "
        f"{int8_metrics['inference_per_sample_ms']:.6f} |\n"
    )

    report.write(
        f"| Predictions/sec | "
        f"{fp32_metrics['predictions_per_second']:.2f} | "
        f"{int8_metrics['predictions_per_second']:.2f} |\n"
    )

    report.write("\n")

    report.write(
        f"INT8 model size reduction: "
        f"**{size_reduction_percent:.2f}%**.\n\n"
    )

    report.write(
        f"F1 change after quantization: "
        f"**{f1_change:+.6f}**.\n\n"
    )

    report.write(
        f"Recall change after quantization: "
        f"**{recall_change:+.6f}**.\n\n"
    )

    report.write(
        "## 6. Model Files\n\n"
        "- `tinyml_model.keras` - original Keras model\n"
        "- `tinyml_model_fp32.tflite` - FP32 TFLite model\n"
        "- `tinyml_model_int8.tflite` - INT8 TFLite model\n"
        "- `feature_scaler.json` - feature normalization parameters\n\n"
    )

    report.write(
        "## 7. Evaluation Files\n\n"
        "All metrics, graphs and reports are stored under "
        "`evaluation/`.\n\n"
    )

    report.write(
        "## 8. Deployment Consideration\n\n"
        "The INT8 model is the intended TinyML candidate. "
        "Final deployment claims should be validated on the "
        "actual target processor because desktop Python "
        "inference latency is not equivalent to embedded "
        "hardware latency.\n"
    )


# ============================================================
# 20. FINAL CONSOLE OUTPUT
# ============================================================

print("\n" + "=" * 72)
print("TENSORFLOW LITE TINYML TRAINING COMPLETE")
print("=" * 72)

print("\nMODEL FILES:")
print(f"  {keras_path}")
print(f"  {fp32_path}")
print(f"  {int8_path}")
print(f"  {MODELS_DIR / 'feature_scaler.json'}")

print("\nEVALUATION:")
print(f"  {EVALUATION_DIR}")

print("\nFP32:")
print(
    f"  Accuracy : {fp32_metrics['accuracy']:.4f}"
)
print(
    f"  Precision: {fp32_metrics['precision']:.4f}"
)
print(
    f"  Recall   : {fp32_metrics['recall']:.4f}"
)
print(
    f"  F1       : {fp32_metrics['f1']:.4f}"
)
print(
    f"  PR-AUC   : {fp32_metrics['pr_auc']:.4f}"
)
print(
    f"  Size     : {fp32_metrics['model_size_kb']:.2f} KB"
)

print("\nINT8:")
print(
    f"  Accuracy : {int8_metrics['accuracy']:.4f}"
)
print(
    f"  Precision: {int8_metrics['precision']:.4f}"
)
print(
    f"  Recall   : {int8_metrics['recall']:.4f}"
)
print(
    f"  F1       : {int8_metrics['f1']:.4f}"
)
print(
    f"  PR-AUC   : {int8_metrics['pr_auc']:.4f}"
)
print(
    f"  Size     : {int8_metrics['model_size_kb']:.2f} KB"
)

print(
    f"\nINT8 size reduction: "
    f"{size_reduction_percent:.2f}%"
)

print("\nDone.")

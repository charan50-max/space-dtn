"""
Space DTN - TinyML Priority Service
-----------------------------------

Connects the trained TensorFlow Lite telemetry classifier to the
DTN message-priority pipeline.

Deployment artifacts expected:

    tinyml/models/
        tinyml_model_fp32.tflite
        tinyml_model_int8.tflite
        feature_scaler.json

The current DTN deployment uses the FP32 TFLite model with the
validated decision threshold of 0.25.

Important:
- The original telemetry dataset has no native DTN-priority label.
- The trained target is an anomaly-derived urgency proxy.
- If all nine telemetry features are present, TFLite inference is used.
- If telemetry is incomplete/unavailable, the existing lightweight
  heuristic policy is used instead of inventing missing telemetry.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np


# ============================================================
# PROJECT PATHS
# ============================================================

# priority_service.py:
# space_dtn/backend/app/services/priority_service.py
#
# parents[0] -> services
# parents[1] -> app
# parents[2] -> backend
# parents[3] -> space_dtn

PROJECT_ROOT = Path(__file__).resolve().parents[3]

MODELS_DIR = (
    PROJECT_ROOT
    / "tinyml"
    / "models"
)

FP32_MODEL_PATH = (
    MODELS_DIR
    / "tinyml_model_fp32.tflite"
)

INT8_MODEL_PATH = (
    MODELS_DIR
    / "tinyml_model_int8.tflite"
)

SCALER_PATH = (
    MODELS_DIR
    / "feature_scaler.json"
)


# ============================================================
# TINYML CONFIGURATION
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

# Selected during threshold optimization.
# FP32 @ 0.25:
# Precision = 0.5010
# Recall    = 0.8121
# F1        = 0.6197
PRIORITY_THRESHOLD = 0.25

MODEL_NAME = "tinyml_model_fp32.tflite"


class PriorityService:

    def __init__(self):
        self.interpreter = None
        self.scaler = None
        self.model_loaded = False
        self.model_error: Optional[str] = None

        self.input_details = None
        self.output_details = None

        self._load_scaler()
        self._load_model()

    # ========================================================
    # RUNTIME LOADING
    # ========================================================

    def _load_scaler(self):
        """Load training-time standardization parameters."""

        if not SCALER_PATH.exists():
            self.model_error = (
                f"Scaler file not found: {SCALER_PATH}"
            )
            return

        try:
            with open(
                SCALER_PATH,
                "r",
                encoding="utf-8",
            ) as file:
                scaler_data = json.load(file)

            saved_features = scaler_data.get(
                "features",
                []
            )

            if saved_features != FEATURES:
                raise ValueError(
                    "feature_scaler.json feature order does not "
                    "match the deployed TinyML feature order."
                )

            self.scaler = {
                "mean": np.asarray(
                    scaler_data["mean"],
                    dtype=np.float32,
                ),
                "scale": np.asarray(
                    scaler_data["scale"],
                    dtype=np.float32,
                ),
            }

            if (
                len(self.scaler["mean"]) != len(FEATURES)
                or len(self.scaler["scale"]) != len(FEATURES)
            ):
                raise ValueError(
                    "Scaler dimensions do not match the nine "
                    "TinyML features."
                )

            # Protect against division by zero if a future scaler
            # contains a constant feature.
            self.scaler["scale"] = np.where(
                self.scaler["scale"] == 0,
                1.0,
                self.scaler["scale"],
            )

        except Exception as exc:
            self.scaler = None
            self.model_error = (
                f"Could not load TinyML scaler: {exc}"
            )

    def _get_interpreter_class(self):
        """
        Prefer a lightweight TFLite/LiteRT runtime.

        Fallback order:
            1. ai_edge_litert
            2. tflite_runtime
            3. tensorflow

        TensorFlow is only a compatibility fallback; the deployed
        model itself remains a compact .tflite model.
        """

        try:
            from ai_edge_litert.interpreter import Interpreter

            return Interpreter

        except ImportError:
            pass

        try:
            from tflite_runtime.interpreter import Interpreter

            return Interpreter

        except ImportError:
            pass

        try:
            import tensorflow as tf

            return tf.lite.Interpreter

        except ImportError as exc:
            raise ImportError(
                "No TFLite runtime is installed. Install "
                "ai-edge-litert, tflite-runtime, or TensorFlow."
            ) from exc

    def _load_model(self):
        """Load the FP32 TFLite model once at service startup."""

        if not FP32_MODEL_PATH.exists():
            self.model_error = (
                f"TFLite model not found: {FP32_MODEL_PATH}"
            )
            return

        if self.scaler is None:
            return

        try:
            Interpreter = self._get_interpreter_class()

            self.interpreter = Interpreter(
                model_path=str(FP32_MODEL_PATH)
            )

            self.interpreter.allocate_tensors()

            self.input_details = (
                self.interpreter.get_input_details()
            )

            self.output_details = (
                self.interpreter.get_output_details()
            )

            if not self.input_details:
                raise RuntimeError(
                    "TFLite model has no input tensor."
                )

            if not self.output_details:
                raise RuntimeError(
                    "TFLite model has no output tensor."
                )

            input_shape = self.input_details[0]["shape"]

            if int(input_shape[-1]) != len(FEATURES):
                raise ValueError(
                    "TFLite model input size does not match "
                    "the nine deployed features."
                )

            self.model_loaded = True
            self.model_error = None

        except Exception as exc:
            self.interpreter = None
            self.model_loaded = False
            self.model_error = (
                f"Could not load TinyML TFLite model: {exc}"
            )

            print(
                f"TinyML model loading failed: {exc}"
            )

    # ========================================================
    # FALLBACK LIGHTWEIGHT POLICY
    # ========================================================

    def _heuristic_prediction(
        self,
        data: Dict[str, Any],
    ):
        """
        Preserve the existing lightweight fallback policy.

        This is used when telemetry is unavailable or incomplete.
        """

        score = 0

        severity = str(
            data.get(
                "severity",
                "normal",
            )
        ).lower()

        severity_scores = {
            "critical": 45,
            "high": 30,
            "medium": 15,
            "low": 5,
            "normal": 0,
        }

        score += severity_scores.get(
            severity,
            0,
        )

        mission_critical = bool(
            data.get(
                "mission_critical",
                False,
            )
        )

        if mission_critical:
            score += 25

        try:
            ttl = float(
                data.get(
                    "ttl",
                    30,
                )
            )
        except (
            TypeError,
            ValueError,
        ):
            ttl = 30

        if ttl <= 5:
            score += 15

        elif ttl <= 10:
            score += 10

        elif ttl <= 20:
            score += 5

        anomaly = bool(
            data.get(
                "anomaly",
                False,
            )
        )

        if anomaly:
            score += 15

        score = min(
            100,
            max(0, score),
        )

        if score >= 75:
            priority_class = "CRITICAL"

        elif score >= 50:
            priority_class = "HIGH"

        elif score >= 25:
            priority_class = "MEDIUM"

        else:
            priority_class = "LOW"

        return {
            "priority_score": float(score),
            "priority_class": priority_class,
            "confidence": 0.70,
            "priority_probability": (
                float(score) / 100.0
            ),
            "threshold": PRIORITY_THRESHOLD,
            "model_type": (
                "lightweight-heuristic-fallback"
            ),
        }

    # ========================================================
    # TELEMETRY VALIDATION
    # ========================================================

    def _has_complete_telemetry(
        self,
        data: Dict[str, Any],
    ) -> bool:
        """Require every trained feature before TinyML inference."""

        return all(
            feature in data
            and data[feature] is not None
            for feature in FEATURES
        )

    def _build_feature_vector(
        self,
        data: Dict[str, Any],
    ) -> np.ndarray:
        """Build the exact feature order used during training."""

        values = []

        for feature in FEATURES:
            value = data[feature]

            try:
                value = float(value)
            except (
                TypeError,
                ValueError,
            ) as exc:
                raise ValueError(
                    f"Invalid telemetry value for '{feature}'."
                ) from exc

            if not np.isfinite(value):
                raise ValueError(
                    f"Non-finite telemetry value for '{feature}'."
                )

            values.append(value)

        return np.asarray(
            [values],
            dtype=np.float32,
        )

    def _scale_features(
        self,
        X: np.ndarray,
    ) -> np.ndarray:
        """Apply the exact StandardScaler parameters from training."""

        mean = self.scaler["mean"]
        scale = self.scaler["scale"]

        return (
            (X - mean) / scale
        ).astype(np.float32)

    # ========================================================
    # TFLITE INFERENCE
    # ========================================================

    def _run_tflite(
        self,
        X_scaled: np.ndarray,
    ) -> float:
        """Run one inference and return the positive-class probability."""

        input_info = self.input_details[0]
        output_info = self.output_details[0]

        input_index = input_info["index"]
        output_index = output_info["index"]

        input_dtype = input_info["dtype"]
        output_dtype = output_info["dtype"]

        input_scale, input_zero = (
            input_info.get(
                "quantization",
                (0.0, 0),
            )
        )

        output_scale, output_zero = (
            output_info.get(
                "quantization",
                (0.0, 0),
            )
        )

        tensor = X_scaled.astype(
            np.float32
        )

        # Supports FP32 models and also keeps this method usable
        # if the model is switched to the INT8 artifact later.
        if input_dtype == np.int8:

            if input_scale == 0:
                raise RuntimeError(
                    "Invalid TFLite input quantization scale."
                )

            tensor = (
                tensor / input_scale
                + input_zero
            )

            tensor = np.clip(
                tensor,
                -128,
                127,
            ).astype(np.int8)

        elif input_dtype == np.uint8:

            if input_scale == 0:
                raise RuntimeError(
                    "Invalid TFLite input quantization scale."
                )

            tensor = (
                tensor / input_scale
                + input_zero
            )

            tensor = np.clip(
                tensor,
                0,
                255,
            ).astype(np.uint8)

        else:
            tensor = tensor.astype(
                input_dtype
            )

        self.interpreter.set_tensor(
            input_index,
            tensor,
        )

        self.interpreter.invoke()

        output = self.interpreter.get_tensor(
            output_index
        )

        if output_dtype == np.int8:

            if output_scale == 0:
                raise RuntimeError(
                    "Invalid TFLite output quantization scale."
                )

            output = (
                output.astype(np.float32)
                - output_zero
            ) * output_scale

        elif output_dtype == np.uint8:

            if output_scale == 0:
                raise RuntimeError(
                    "Invalid TFLite output quantization scale."
                )

            output = (
                output.astype(np.float32)
                - output_zero
            ) * output_scale

        else:
            output = output.astype(
                np.float32
            )

        probability = float(
            output.reshape(-1)[0]
        )

        return float(
            np.clip(
                probability,
                0.0,
                1.0,
            )
        )

    # ========================================================
    # PRIORITY MAPPING
    # ========================================================

    def _tinyml_result(
        self,
        probability: float,
    ):
        """
        Convert the binary urgency probability into the DTN
        priority representation.

        score is kept on a 0-100 scale because the existing
        simulator sorts messages by priority_score.
        """

        priority_score = (
            probability * 100.0
        )

        if probability >= PRIORITY_THRESHOLD:
            priority_class = "HIGH"
        else:
            priority_class = "LOW"

        return {
            "priority_score": round(
                priority_score,
                2,
            ),
            "priority_class": priority_class,
            "confidence": round(
                max(
                    probability,
                    1.0 - probability,
                ),
                4,
            ),
            "priority_probability": round(
                probability,
                4,
            ),
            "threshold": PRIORITY_THRESHOLD,
            "model_type": "tflite_fp32",
        }

    # ========================================================
    # PUBLIC PREDICTION API
    # ========================================================

    def predict(
        self,
        data: Dict[str, Any],
    ):
        """
        Predict DTN message priority.

        Complete telemetry:
            TFLite FP32 model -> probability -> HIGH/LOW.

        Incomplete telemetry:
            Existing lightweight heuristic fallback.

        This avoids silently filling missing telemetry with zeros,
        which would create inputs unlike the training distribution.
        """

        if not self._has_complete_telemetry(data):
            return self._heuristic_prediction(
                data
            )

        if not self.model_loaded:
            return self._heuristic_prediction(
                data
            )

        try:
            X = self._build_feature_vector(
                data
            )

            X_scaled = self._scale_features(
                X
            )

            probability = self._run_tflite(
                X_scaled
            )

            return self._tinyml_result(
                probability
            )

        except Exception as exc:

            print(
                f"TinyML prediction failed: {exc}"
            )

            return self._heuristic_prediction(
                data
            )

    # ========================================================
    # STATUS
    # ========================================================

    def status(self):

        return {
            "model_loaded": self.model_loaded,
            "model_path": str(
                FP32_MODEL_PATH
            ),
            "model_type": (
                "tflite_fp32"
                if self.model_loaded
                else "lightweight-heuristic-fallback"
            ),
            "threshold": PRIORITY_THRESHOLD,
            "features": FEATURES,
            "scaler_loaded": self.scaler is not None,
            "model_error": self.model_error,
        }


priority_service = PriorityService()

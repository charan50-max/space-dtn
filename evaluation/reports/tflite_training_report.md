# Space DTN TinyML - TensorFlow Lite Report

## 1. Objective

Train a compact neural-network classifier for satellite telemetry urgency and convert it to TensorFlow Lite for resource-constrained deployment.

## 2. Target

- `0` = Normal / Low Priority
- `1` = Anomalous / High Priority

The original satellite dataset does not contain a native DTN priority label. The anomaly label is therefore used as a documented urgency proxy.

## 3. Input Features

- `value`
- `sampling`
- `channel_id`
- `z_score`
- `abs_z_score`
- `delta_value`
- `abs_delta`
- `rolling_mean_5`
- `rolling_std_5`

## 4. Neural Network

- Input: 9 features
- Hidden layer 1: Dense(16, ReLU)
- Hidden layer 2: Dense(8, ReLU)
- Output: Dense(1, Sigmoid)
- Optimizer: Adam
- Loss: Binary Cross-Entropy

## 5. FP32 vs INT8

| Metric | FP32 | INT8 |
|---|---:|---:|
| accuracy | 0.737600 | 0.710375 |
| precision | 0.729062 | 0.580969 |
| recall | 0.321089 | 0.426724 |
| f1 | 0.445829 | 0.492042 |
| macro_f1 | 0.636966 | 0.644741 |
| balanced_accuracy | 0.631328 | 0.638002 |
| roc_auc | 0.780336 | 0.756111 |
| pr_auc | 0.625204 | 0.581945 |

| Resource Metric | FP32 | INT8 |
|---|---:|---:|
| Model size (KB) | 3.52 | 3.59 |
| Inference (ms/sample) | 0.007136 | 0.018353 |
| Predictions/sec | 140135.61 | 54487.73 |

INT8 model size reduction: **-2.22%**.

F1 change after quantization: **+0.046213**.

Recall change after quantization: **+0.105635**.

## 6. Model Files

- `tinyml_model.keras` - original Keras model
- `tinyml_model_fp32.tflite` - FP32 TFLite model
- `tinyml_model_int8.tflite` - INT8 TFLite model
- `feature_scaler.json` - feature normalization parameters

## 7. Evaluation Files

All metrics, graphs and reports are stored under `evaluation/`.

## 8. Deployment Consideration

The INT8 model is the intended TinyML candidate. Final deployment claims should be validated on the actual target processor because desktop Python inference latency is not equivalent to embedded hardware latency.

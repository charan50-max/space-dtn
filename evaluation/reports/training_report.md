# Space DTN TinyML Training Report

## 1. Objective

Train and evaluate lightweight machine-learning models for classifying satellite telemetry into normal/low-priority and anomalous/high-priority data for the Space DTN priority engine.

## 2. Important Target Definition

The original satellite dataset does not contain a native DTN priority label. Therefore, the `anomaly` label is used as a documented proxy:

- `0` = Normal / Low Priority
- `1` = Anomalous / High Priority

This means the trained model predicts telemetry urgency, which can subsequently be mapped to DTN transmission priority.

## 3. Features

- `value`
- `sampling`
- `channel_id`
- `z_score`
- `abs_z_score`
- `delta_value`
- `abs_delta`
- `rolling_mean_5`
- `rolling_std_5`

## 4. Models Evaluated

- Logistic Regression
- Decision Tree
- Random Forest
- Extra Trees

## 5. Model Performance

| Model | Accuracy | Precision | Recall | F1 | Macro F1 | ROC-AUC | PR-AUC | Size KB | Inference ms |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Logistic Regression | 0.6764 | 0.5221 | 0.1834 | 0.2715 | 0.5317 | 0.7179 | 0.5067 | 1.92 | 0.000840 |
| Decision Tree | 0.7492 | 0.7913 | 0.3221 | 0.4578 | 0.6474 | 0.7849 | 0.6423 | 20.90 | 0.000719 |
| Random Forest | 0.7471 | 0.7759 | 0.3242 | 0.4573 | 0.6462 | 0.7893 | 0.6593 | 978.77 | 0.031132 |
| Extra Trees | 0.7377 | 0.7849 | 0.2783 | 0.4110 | 0.6211 | 0.7853 | 0.6431 | 856.74 | 0.031475 |

## 6. Selected Model

**Random Forest** was selected using the Space DTN-oriented selection score:

`0.60 × F1 + 0.40 × Recall`

Recall is given additional importance because a false negative means an anomalous/high-priority telemetry message could be incorrectly treated as normal and receive lower transmission priority.

## 7. Resource Efficiency

- Model size: 978.77 KB
- Inference latency: 0.031132 ms/sample
- Predictions/sec: 32121.37
- Trees: 50
- Maximum tree depth: 8
- Total tree nodes: 12256

## 8. Generated Evaluation Artifacts

- Model comparison CSV
- Individual model metric JSON files
- Confusion matrices
- ROC curves
- Precision-Recall curves
- Feature importance plots
- Model-size comparison
- Inference-time comparison
- Serialized trained models
- Training summary JSON

## 9. Validation Limitation

The training and testing datasets are synthetic samples generated from the original satellite telemetry distribution. Segment groups were separated before synthetic sampling to reduce train/test leakage. However, final deployment validation should also be performed against untouched real satellite segments or a separate mission dataset.

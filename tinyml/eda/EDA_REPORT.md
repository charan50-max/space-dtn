# Space DTN TinyML — EDA Report

## 1. Dataset overview
- Total samples: 200,000
- Training samples: 160,000
- Testing samples: 40,000
- Features: 9
- Missing cells: 0
- Duplicate rows: 0

## 2. Class distribution
- Normal / low urgency: 134,015 (67.01%)
- Anomalous / high urgency: 65,985 (32.99%)

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

## 4. Strongest feature-target relationships

| Feature | Absolute Pearson correlation |
|---|---:|
| `sampling` | 0.210225 |
| `rolling_mean_5` | 0.196320 |
| `value` | 0.195479 |
| `channel_id` | 0.195409 |
| `rolling_std_5` | 0.131914 |
| `abs_delta` | 0.109138 |
| `abs_z_score` | 0.097550 |
| `z_score` | 0.043259 |
| `delta_value` | 0.000712 |

## 5. Mutual information

| Feature | Mutual information |
|---|---:|
| `rolling_std_5` | 0.137553 |
| `rolling_mean_5` | 0.124478 |
| `channel_id` | 0.072240 |
| `value` | 0.062666 |
| `delta_value` | 0.061779 |
| `abs_delta` | 0.061152 |
| `sampling` | 0.037043 |
| `z_score` | 0.029332 |
| `abs_z_score` | 0.023691 |

## 6. Interpretation

The dataset is suitable for the next modeling stage from a basic data-quality perspective: there are no missing feature/target cells and no duplicate rows. The target is moderately imbalanced, so accuracy alone should not be used to judge the classifier.
The strongest relationships are concentrated in local telemetry context (`rolling_std_5`, `rolling_mean_5`) and channel/value characteristics. `delta_value` has almost zero linear correlation with the target, but its mutual information is non-zero, indicating that non-linear relationships may still be useful.
These are exploratory relationships, not evidence that any feature is causally responsible for anomalies. Model validation will determine predictive usefulness.
# Space DTN TinyML Threshold Optimization

## Objective

The default classification threshold of 0.50 was evaluated against alternative thresholds to understand the trade-off between detecting high-priority telemetry and unnecessarily promoting normal telemetry to high priority.

## DTN Interpretation

- **False Negative:** anomalous/high-priority telemetry classified as normal.
- **False Positive:** normal telemetry promoted to high priority.
- **Predicted high-priority rate:** fraction of telemetry that would enter the high-priority transmission path.

## TensorFlow Lite FP32

| Threshold | Precision | Recall | F1 | FNR | FPR | High Priority Rate |
|---:|---:|---:|---:|---:|---:|---:|
| 0.10 | 0.3945 | 0.9636 | 0.5598 | 0.0364 | 0.7244 | 0.8030 |
| 0.15 | 0.4300 | 0.9360 | 0.5892 | 0.0640 | 0.6077 | 0.7156 |
| 0.20 | 0.4647 | 0.8978 | 0.6124 | 0.1022 | 0.5064 | 0.6351 |
| 0.25 | 0.5010 | 0.8121 | 0.6197 | 0.1879 | 0.3961 | 0.5328 |
| 0.30 | 0.5214 | 0.7534 | 0.6163 | 0.2466 | 0.3386 | 0.4749 |
| 0.35 | 0.5770 | 0.5458 | 0.5610 | 0.4542 | 0.1960 | 0.3110 |
| 0.40 | 0.6570 | 0.4202 | 0.5126 | 0.5798 | 0.1074 | 0.2102 |
| 0.45 | 0.6975 | 0.3676 | 0.4814 | 0.6324 | 0.0781 | 0.1732 |
| 0.50 | 0.7291 | 0.3211 | 0.4458 | 0.6789 | 0.0584 | 0.1448 |
| 0.55 | 0.7467 | 0.2688 | 0.3953 | 0.7312 | 0.0447 | 0.1183 |
| 0.60 | 0.7713 | 0.2495 | 0.3771 | 0.7505 | 0.0362 | 0.1064 |
| 0.65 | 0.7705 | 0.1345 | 0.2291 | 0.8655 | 0.0196 | 0.0574 |

### Operating Points

**highest_f1:**

- Threshold: `0.25`
- Precision: `0.5010`
- Recall: `0.8121`
- F1: `0.6197`
- False-negative rate: `0.1879`
- False-positive rate: `0.3961`

**highest_recall_precision_at_least_50pct:**

- Threshold: `0.25`
- Precision: `0.5010`
- Recall: `0.8121`
- F1: `0.6197`
- False-negative rate: `0.1879`
- False-positive rate: `0.3961`

**highest_recall_fpr_at_most_20pct:**

- Threshold: `0.35`
- Precision: `0.5770`
- Recall: `0.5458`
- F1: `0.5610`
- False-negative rate: `0.4542`
- False-positive rate: `0.1960`

**first_threshold_reaching_50pct_recall:**

- Threshold: `0.10`
- Precision: `0.3945`
- Recall: `0.9636`
- F1: `0.5598`
- False-negative rate: `0.0364`
- False-positive rate: `0.7244`

## TensorFlow Lite INT8

| Threshold | Precision | Recall | F1 | FNR | FPR | High Priority Rate |
|---:|---:|---:|---:|---:|---:|---:|
| 0.10 | 0.3961 | 0.9493 | 0.5590 | 0.0507 | 0.7087 | 0.7878 |
| 0.15 | 0.4476 | 0.8995 | 0.5978 | 0.1005 | 0.5436 | 0.6606 |
| 0.20 | 0.4733 | 0.8230 | 0.6010 | 0.1770 | 0.4485 | 0.5716 |
| 0.25 | 0.4875 | 0.7895 | 0.6028 | 0.2105 | 0.4064 | 0.5323 |
| 0.30 | 0.5083 | 0.7097 | 0.5924 | 0.2903 | 0.3362 | 0.4590 |
| 0.35 | 0.5397 | 0.6131 | 0.5740 | 0.3869 | 0.2561 | 0.3734 |
| 0.40 | 0.5614 | 0.5459 | 0.5535 | 0.4541 | 0.2089 | 0.3196 |
| 0.45 | 0.5783 | 0.4984 | 0.5354 | 0.5016 | 0.1779 | 0.2833 |
| 0.50 | 0.5810 | 0.4267 | 0.4920 | 0.5733 | 0.1507 | 0.2414 |
| 0.55 | 0.6272 | 0.2709 | 0.3784 | 0.7291 | 0.0788 | 0.1420 |
| 0.60 | 0.7490 | 0.1967 | 0.3116 | 0.8033 | 0.0323 | 0.0863 |
| 0.65 | 0.7784 | 0.1726 | 0.2825 | 0.8274 | 0.0241 | 0.0729 |

### Operating Points

**highest_f1:**

- Threshold: `0.25`
- Precision: `0.4875`
- Recall: `0.7895`
- F1: `0.6028`
- False-negative rate: `0.2105`
- False-positive rate: `0.4064`

**highest_recall_precision_at_least_50pct:**

- Threshold: `0.30`
- Precision: `0.5083`
- Recall: `0.7097`
- F1: `0.5924`
- False-negative rate: `0.2903`
- False-positive rate: `0.3362`

**highest_recall_fpr_at_most_20pct:**

- Threshold: `0.45`
- Precision: `0.5783`
- Recall: `0.4984`
- F1: `0.5354`
- False-negative rate: `0.5016`
- False-positive rate: `0.1779`

**first_threshold_reaching_50pct_recall:**

- Threshold: `0.10`
- Precision: `0.3961`
- Recall: `0.9493`
- F1: `0.5590`
- False-negative rate: `0.0507`
- False-positive rate: `0.7087`

## Engineering Note

There is no universally correct threshold for the Space DTN priority engine. The threshold should be selected according to the communication budget and the operational cost of missing urgent telemetry versus promoting additional normal telemetry.

The threshold selected here should therefore be treated as an engineering operating point rather than a claim that it is universally optimal.

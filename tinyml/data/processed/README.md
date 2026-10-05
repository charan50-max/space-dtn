# Space DTN TinyML Dataset

## Source

Original satellite telemetry dataset:
- 303,493 rows
- 9 telemetry channels
- 2,123 channel-segment groups
- Binary `anomaly` field

## Generated data

- `tinyml_200k.csv` — 200,000 generated samples
- `tinyml_train.csv` — 160,000 training samples
- `tinyml_test.csv` — 40,000 testing samples
- `dataset_profile.csv` — source-channel statistics
- `dataset_report.json` — generation metadata
- `generate_tinyml_dataset.py` — reproducible generator

## Target

The source dataset does not contain a native message-priority label.

Therefore:

- `priority = 0` → normal / low urgency
- `priority = 1` → anomalous / high urgency

The DTN priority engine will later map the model prediction to a transmission action.

## ML features

1. value
2. sampling
3. channel_id
4. z_score
5. abs_z_score
6. delta_value
7. abs_delta
8. rolling_mean_5
9. rolling_std_5

## Leakage prevention

The original telemetry is split by complete `channel + segment` groups before synthetic sampling.

Therefore, a segment used to generate training data is not used to generate testing data.

The `channel`, `timestamp`, `segment`, `group_id`, and `anomaly` columns are retained as metadata but should NOT be supplied as model features.

## Reproduction

Place the source file at:

`tinyml/data/raw/segments.csv`

Then run:

`python generate_tinyml_dataset.py`

Default output is 200,000 samples with an 80/20 train/test split.

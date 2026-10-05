"""
Space DTN — TinyML Dataset Generator
=====================================

Generates a 200,000-row classification dataset from the original
satellite telemetry CSV.

Recommended project placement:
    space_dtn/
    └── tinyml/
        ├── data/
        │   └── raw/
        │       └── segments.csv
        └── generate_tinyml_dataset.py

Run from the tinyml directory:
    python generate_tinyml_dataset.py

Optional:
    python generate_tinyml_dataset.py --samples 200000 --test-size 0.20 --seed 42

Target:
    priority = 0 -> normal / low urgency
    priority = 1 -> anomalous / high urgency

The original satellite dataset does NOT contain a native priority label.
The source `anomaly` field is therefore used as the supervised urgency target.

The split is performed by channel + segment before synthetic sampling.
This prevents the same telemetry segment from appearing in both train and test.
"""

import argparse
import json
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split


REQUIRED_COLUMNS = {
    "channel",
    "timestamp",
    "value",
    "label",
    "sampling",
    "anomaly",
    "segment",
    "train",
}


FEATURE_COLUMNS = [
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


def parse_args():
    parser = argparse.ArgumentParser(
        description="Generate a TinyML-ready Space DTN telemetry dataset."
    )

    parser.add_argument(
        "--source",
        type=str,
        default="data/raw/segments.csv",
        help="Original satellite telemetry CSV.",
    )

    parser.add_argument(
        "--output",
        type=str,
        default="data/processed",
        help="Output directory.",
    )

    parser.add_argument(
        "--samples",
        type=int,
        default=200_000,
        help="Total generated samples.",
    )

    parser.add_argument(
        "--test-size",
        type=float,
        default=0.20,
        help="Fraction reserved for testing.",
    )

    parser.add_argument(
        "--seed",
        type=int,
        default=42,
        help="Random seed.",
    )

    return parser.parse_args()


def load_source(path):
    df = pd.read_csv(path)

    missing = REQUIRED_COLUMNS - set(df.columns)

    if missing:
        raise ValueError(
            f"Source dataset is missing columns: {sorted(missing)}"
        )

    if df.empty:
        raise ValueError("Source dataset is empty.")

    return df


def prepare_features(df):
    df = df.copy()

    df["timestamp_dt"] = pd.to_datetime(
        df["timestamp"],
        utc=True,
        errors="raise",
    )

    # A telemetry segment is uniquely identified by channel + segment.
    df["group_id"] = (
        df["channel"].astype(str)
        + "_"
        + df["segment"].astype(str)
    )

    # Channel-level statistics.
    channel_stats = (
        df.groupby("channel")["value"]
        .agg(["mean", "std", "median"])
        .rename(
            columns={
                "mean": "channel_mean",
                "std": "channel_std",
                "median": "channel_median",
            }
        )
    )

    channel_stats["channel_std"] = (
        channel_stats["channel_std"].fillna(0.0)
    )

    channel_stats["safe_std"] = (
        channel_stats["channel_std"].replace(0, 1e-12)
    )

    # Sort before calculating temporal features.
    df = df.sort_values(
        ["channel", "segment", "timestamp_dt"]
    ).reset_index(drop=True)

    # Change from the previous telemetry observation.
    df["delta_value"] = (
        df.groupby(["channel", "segment"])["value"]
        .diff()
        .fillna(0.0)
    )

    # Local five-sample context.
    df["rolling_mean_5"] = (
        df.groupby(["channel", "segment"])["value"]
        .transform(
            lambda s: s.rolling(
                window=5,
                min_periods=1,
            ).mean()
        )
    )

    df["rolling_std_5"] = (
        df.groupby(["channel", "segment"])["value"]
        .transform(
            lambda s: s.rolling(
                window=5,
                min_periods=1,
            ).std()
        )
        .fillna(0.0)
    )

    df = df.join(
        channel_stats[["channel_mean", "safe_std"]],
        on="channel",
    )

    # Normalised deviation from the channel's normal operating level.
    df["z_score"] = (
        (df["value"] - df["channel_mean"])
        / df["safe_std"]
    )

    df["abs_z_score"] = df["z_score"].abs()
    df["abs_delta"] = df["delta_value"].abs()

    return df


def split_segments(df, test_size, seed):
    """
    Split complete telemetry segments rather than individual rows.
    This is important for avoiding train/test leakage.
    """

    groups = (
        df.groupby("group_id")
        .agg(
            channel=("channel", "first"),
            segment=("segment", "first"),
            anomaly=("anomaly", "first"),
            sampling=("sampling", "first"),
            rows=("value", "size"),
        )
        .reset_index()
    )

    train_groups, test_groups = train_test_split(
        groups,
        test_size=test_size,
        random_state=seed,
        stratify=groups["anomaly"],
    )

    train_ids = set(train_groups["group_id"])
    test_ids = set(test_groups["group_id"])

    source_train = df[
        df["group_id"].isin(train_ids)
    ].copy()

    source_test = df[
        df["group_id"].isin(test_ids)
    ].copy()

    return (
        source_train,
        source_test,
        train_groups,
        test_groups,
    )


def generate_samples(source, n_samples, split_name, rng):
    """
    Empirical resampling + small channel-aware perturbation.

    The source telemetry distribution is retained while creating
    additional observations for TinyML experimentation.
    """

    indices = rng.integers(
        low=0,
        high=len(source),
        size=n_samples,
    )

    result = (
        source.iloc[indices]
        .copy()
        .reset_index(drop=True)
    )

    base_std = result["safe_std"].to_numpy()

    # Very small value perturbation.
    noise_scale = np.maximum(
        base_std * 0.005,
        1e-12,
    )

    result["value"] = (
        result["value"].to_numpy()
        + rng.normal(
            0,
            noise_scale,
            size=n_samples,
        )
    )

    # Recalculate value-derived features.
    result["z_score"] = (
        (result["value"] - result["channel_mean"])
        / result["safe_std"]
    )

    result["abs_z_score"] = result["z_score"].abs()

    # Small perturbation to local change.
    original_delta = result["delta_value"].to_numpy()

    delta_scale = np.maximum(
        np.abs(original_delta) * 0.01,
        base_std * 0.001,
    )

    result["delta_value"] = (
        original_delta
        + rng.normal(
            0,
            delta_scale,
            size=n_samples,
        )
    )

    result["abs_delta"] = result["delta_value"].abs()

    result["split"] = split_name

    # Source anomaly is the supervised urgency target.
    result["priority"] = result["anomaly"].astype(int)

    return result


def make_ml_dataset(data, channel_to_id, seed):
    data = data.copy()

    data["channel_id"] = (
        data["channel"]
        .map(channel_to_id)
        .astype(int)
    )

    columns = FEATURE_COLUMNS + [
        "channel",
        "timestamp",
        "segment",
        "group_id",
        "anomaly",
        "priority",
        "split",
    ]

    data = data[columns]

    return (
        data.sample(
            frac=1,
            random_state=seed,
        )
        .reset_index(drop=True)
    )


def main():
    args = parse_args()

    if args.samples < 1000:
        raise ValueError("Use at least 1,000 generated samples.")

    if not 0 < args.test_size < 1:
        raise ValueError("--test-size must be between 0 and 1.")

    output = Path(args.output)
    output.mkdir(parents=True, exist_ok=True)

    rng = np.random.default_rng(args.seed)

    print("Loading source dataset...")
    df = load_source(args.source)

    print(f"Source rows: {len(df):,}")

    print("Preparing telemetry features...")
    df = prepare_features(df)

    print("Splitting complete telemetry segments...")
    (
        source_train,
        source_test,
        train_groups,
        test_groups,
    ) = split_segments(
        df,
        args.test_size,
        args.seed,
    )

    test_samples = int(args.samples * args.test_size)
    train_samples = args.samples - test_samples

    print(
        f"Generating {train_samples:,} training samples..."
    )

    train = generate_samples(
        source_train,
        train_samples,
        "train",
        rng,
    )

    print(
        f"Generating {test_samples:,} testing samples..."
    )

    test = generate_samples(
        source_test,
        test_samples,
        "test",
        rng,
    )

    channels = sorted(df["channel"].unique())

    channel_to_id = {
        channel: index
        for index, channel in enumerate(channels)
    }

    train = make_ml_dataset(
        train,
        channel_to_id,
        args.seed,
    )

    test = make_ml_dataset(
        test,
        channel_to_id,
        args.seed,
    )

    full = pd.concat(
        [train, test],
        ignore_index=True,
    )

    full = (
        full.sample(
            frac=1,
            random_state=args.seed,
        )
        .reset_index(drop=True)
    )

    print("Saving datasets...")

    train.to_csv(
        output / "tinyml_train.csv",
        index=False,
    )

    test.to_csv(
        output / "tinyml_test.csv",
        index=False,
    )

    full.to_csv(
        output / "tinyml_200k.csv",
        index=False,
    )

    # Channel profile from original source.
    profile = (
        df.groupby("channel")
        .agg(
            source_samples=("value", "size"),
            anomaly_rate=("anomaly", "mean"),
            value_mean=("value", "mean"),
            value_std=("value", "std"),
            value_min=("value", "min"),
            value_max=("value", "max"),
            segments=("segment", "nunique"),
            sampling_mode=(
                "sampling",
                lambda x: int(x.mode().iloc[0]),
            ),
        )
        .reset_index()
    )

    profile.to_csv(
        output / "dataset_profile.csv",
        index=False,
    )

    report = {
        "source_rows": int(len(df)),
        "source_channels": int(df["channel"].nunique()),
        "source_segments": int(df["group_id"].nunique()),
        "source_anomaly_rate": float(
            df["anomaly"].mean()
        ),
        "generated_rows": int(len(full)),
        "train_rows": int(len(train)),
        "test_rows": int(len(test)),
        "train_anomaly_rate": float(
            train["priority"].mean()
        ),
        "test_anomaly_rate": float(
            test["priority"].mean()
        ),
        "train_segments": int(len(train_groups)),
        "test_segments": int(len(test_groups)),
        "train_test_segment_overlap": int(
            len(
                set(train["group_id"])
                & set(test["group_id"])
            )
        ),
        "features": FEATURE_COLUMNS,
        "target": "priority",
        "target_definition": {
            "0": "normal / low urgency",
            "1": "anomalous / high urgency",
        },
        "random_seed": args.seed,
        "synthetic_method": (
            "empirical resampling with "
            "small channel-aware Gaussian perturbation"
        ),
    }

    with open(
        output / "dataset_report.json",
        "w",
        encoding="utf-8",
    ) as file:
        json.dump(
            report,
            file,
            indent=2,
        )

    print()
    print("=" * 60)
    print("DATASET GENERATION COMPLETE")
    print("=" * 60)
    print(f"Generated : {len(full):,}")
    print(f"Train     : {len(train):,}")
    print(f"Test      : {len(test):,}")
    print(
        f"Train high urgency : "
        f"{train.priority.mean() * 100:.2f}%"
    )
    print(
        f"Test high urgency  : "
        f"{test.priority.mean() * 100:.2f}%"
    )
    print(
        f"Segment overlap    : "
        f"{report['train_test_segment_overlap']}"
    )
    print()
    print("Features:")
    for feature in FEATURE_COLUMNS:
        print(f"  - {feature}")


if __name__ == "__main__":
    main()

import csv
import io
import json
import math
import random
import statistics
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Optional

from backend.app.dtn.disruptions import DisruptionSchedule
from backend.app.dtn.simulator import DTNSimulator


# Published contact plan for the static baseline (two latency-9 paths tie
# from GS-1 to GS-2, so the plan names one explicitly).
BASELINE_PLAN = ["GS-1", "SAT-1", "SAT-3", "SAT-5", "GS-2"]

STRATEGIES = ("baseline", "reroute", "adaptive", "spray", "epidemic")

# Replication budget for spray-and-wait (copies per bundle).
SPRAY_COPIES = 4

# Named Benchmark Scenarios (Phase 4.1)
SCENARIOS = {
    "random_outages": {
        "id": "random_outages",
        "name": "Random Outages (Default)",
        "description": "General resilience under random link outages and congestion bursts across the topology",
        "judge_question": "Q1: General resilience under changing connectivity",
        "outages": 4,
        "congestion_events": 3,
        "buffer_capacity": 10,
        "link_capacity": 2,
        "corrupt_rate": 0.0,
        "duplicate_rate": 0.0,
    },
    "long_outage": {
        "id": "long_outage",
        "name": "Long Outage on Key Link",
        "description": "Key transit link (L4) disabled for extended horizon with small buffers; stresses storage, eviction & TTL",
        "judge_question": "Q4: Storage exhaustion, eviction margin & TTL expiration",
        "outages": 2,
        "congestion_events": 2,
        "buffer_capacity": 4,
        "link_capacity": 2,
        "corrupt_rate": 0.0,
        "duplicate_rate": 0.0,
        "forced_link": "L4",
        "forced_start": 3,
        "forced_duration": 25,
    },
    "critical_cut": {
        "id": "critical_cut",
        "name": "Critical Cut (Min-Cut Bottleneck)",
        "description": "Outage on min-cut access link (L5); forces store-and-forward retention until restoration",
        "judge_question": "Q2: Mid-demo link cut and adaptive detour / store-and-forward recovery",
        "outages": 1,
        "congestion_events": 1,
        "buffer_capacity": 10,
        "link_capacity": 2,
        "corrupt_rate": 0.0,
        "duplicate_rate": 0.0,
        "forced_link": "L5",
        "forced_start": 2,
        "forced_duration": 18,
    },
    "duplicate_corrupt_burst": {
        "id": "duplicate_corrupt_burst",
        "name": "Duplicate & Corruption Burst",
        "description": "Burst of tampered payloads and duplicate retransmissions; stresses SHA-256 integrity and duplicate registry",
        "judge_question": "Q3: SHA-256 integrity verification and duplicate rejection",
        "outages": 2,
        "congestion_events": 2,
        "buffer_capacity": 10,
        "link_capacity": 2,
        "corrupt_rate": 0.15,
        "duplicate_rate": 0.25,
    },
}

# Where the priority scores/labels come from.
#   tinyml : sampled from a bank of REAL model outputs (score = probability
#            x 100, HIGH when probability >= the deployed threshold) with the
#            dataset's proxy urgency label. This is the realistic setting.
#   oracle : a perfect classifier (clean score gap). Upper bound.
#   random : scores carry no information. Lower bound.
CLASSIFIERS = ("tinyml", "oracle", "random")

PROJECT_ROOT = Path(__file__).resolve().parents[3]
SCORE_BANK_PATH = (
    PROJECT_ROOT / "tinyml" / "data" / "generated" / "score_bank.json"
)

# Fallback when a bank carries no threshold of its own.
DEFAULT_THRESHOLD = 0.25


class ScoreBankUnavailable(RuntimeError):
    """The TinyML score bank is missing or unusable."""

# Metrics averaged across seeds. The second element names the statistics
# field that must be > 0 for the run to count (avoids averaging in the
# artificial 0 the simulator reports when nothing was delivered).
METRICS = {
    "delivery_rate": None,
    "urgent_delivery_rate": None,
    "predicted_urgent_delivery_rate": None,
    "average_delay": "delivered",
    "urgent_avg_delay": "urgent_delivered",
    "predicted_urgent_avg_delay": "predicted_urgent_delivered",
    "average_path_latency_ms": "delivered",
    "link_utilization": None,
    "peak_link_utilization": None,
    "dropped": None,
    "transmissions": None,
    "overhead_ratio": "delivered",
    "replicas_created": None,
    "buffer_blocked": None,
    "buffer_evictions": None,
    "delivered_after_storage": None,
    "custody_retransmissions": None,
    "sequence_gaps": None,
    "simulation_time": None,
}


class BenchmarkService:
    """
    Runs every strategy on the SAME seeded traffic and the SAME seeded
    random outages / congestion, repeated over many seeds.

        baseline : FIFO + static contact-plan routing
        reroute  : FIFO + live adaptive routing        (routing effect)
        adaptive : TinyML priority + live adaptive routing (+ priority effect)
        spray    : binary spray-and-wait, L copies per bundle (replication)
        epidemic : flood a copy to every neighbour (replication, upper bound
                   on delivery, highest overhead)

    Replication strategies get an idealised instant delivery acknowledgement
    that purges remaining copies, which is generous to them.

    Priority scores come from `classifier`: real TinyML outputs sampled from
    a precomputed bank (default), a perfect oracle, or random scores. Urgent
    metrics are scored against the dataset's proxy urgency label.
    """

    # ------------------------------------------------------------------
    # Score bank (real TinyML outputs, precomputed)
    # ------------------------------------------------------------------

    _bank_cache: Optional[dict] = None
    _bank_mtime: Optional[float] = None

    @classmethod
    def load_score_bank(cls) -> dict:
        """
        Load tinyml/data/generated/score_bank.json (built by
        tinyml/build_score_bank.py). Cached until the file changes.
        """
        if not SCORE_BANK_PATH.exists():
            raise ScoreBankUnavailable(
                "TinyML score bank not found. Build it once with: "
                "python tinyml/build_score_bank.py "
                f"(expected at {SCORE_BANK_PATH}). "
                "Or choose the 'oracle' or 'random' priority source."
            )

        mtime = SCORE_BANK_PATH.stat().st_mtime

        if cls._bank_cache is not None and cls._bank_mtime == mtime:
            return cls._bank_cache

        try:
            with SCORE_BANK_PATH.open("r", encoding="utf-8") as file:
                bank = json.load(file)

            urgent = [float(p) for p in bank["urgent_probabilities"]]
            routine = [float(p) for p in bank["routine_probabilities"]]
        except Exception as exc:
            raise ScoreBankUnavailable(
                f"Could not read the score bank: {exc}"
            ) from exc

        if not urgent or not routine:
            raise ScoreBankUnavailable(
                "The score bank needs both urgent and routine samples."
            )

        if bank.get("model_type") != "tflite_fp32":
            raise ScoreBankUnavailable(
                "The score bank was not built with the TFLite model "
                f"(model_type={bank.get('model_type')!r}). Rebuild it with "
                "the model loaded."
            )

        bank["urgent_probabilities"] = urgent
        bank["routine_probabilities"] = routine

        cls._bank_cache = bank
        cls._bank_mtime = mtime

        return bank

    # ------------------------------------------------------------------
    # Workload
    # ------------------------------------------------------------------

    FLOW_PAIRS = [
        ("GS-1", "GS-2"),
        ("GS-2", "GS-1"),
        ("SAT-1", "GS-2"),
        ("GS-1", "SAT-7"),
        ("SAT-6", "GS-2"),
        ("SAT-2", "GS-1"),
    ]

    @classmethod
    def _traffic(
        cls,
        seed: int,
        count: int,
        ttl: int,
        classifier: str = "tinyml",
        urgent_fraction: float = 0.20,
        arrival_process: str = "burst",
        multi_flow: bool = False,
        corrupt_rate: float = 0.0,
        duplicate_rate: float = 0.0,
    ) -> List[dict]:
        """
        Seeded workload, identical for every strategy.

        The draw order (urgent, reverse, score) is kept the same for all
        classifiers, so the same seed yields the same flows and the same
        true-urgent pattern whichever priority source is used.
        """
        if classifier not in CLASSIFIERS:
            raise ValueError(f"classifier must be one of {CLASSIFIERS}")

        bank = cls.load_score_bank() if classifier == "tinyml" else None
        threshold = (
            float(bank.get("threshold", DEFAULT_THRESHOLD))
            if bank
            else DEFAULT_THRESHOLD
        )

        rng = random.Random(f"traffic-{seed}")
        items = []

        for index in range(count):
            urgent = rng.random() < urgent_fraction
            if multi_flow:
                source, destination = rng.choice(cls.FLOW_PAIRS)
            else:
                reverse = rng.random() < 0.25
                source, destination = (
                    ("GS-2", "GS-1") if reverse else ("GS-1", "GS-2")
                )

            # Arrival process (Phase 4.2)
            if arrival_process == "poisson":
                release_tick = min(int(rng.expovariate(1.0 / 3.0)), max(1, min(ttl - 5, 20)))
            elif arrival_process == "uniform":
                release_tick = rng.randint(0, max(1, min(ttl - 5, 15)))
            else:
                release_tick = 0

            tamper = rng.random() < corrupt_rate
            duplicate_tick = (
                release_tick + rng.randint(2, 6)
                if rng.random() < duplicate_rate
                else None
            )

            item = {
                "source": source,
                "destination": destination,
                "payload": f"telemetry-{seed}-{index}",
                "ttl": ttl,
                "true_urgent": urgent,
                "release_tick": release_tick,
                "tamper": tamper,
                "duplicate_tick": duplicate_tick,
            }

            if classifier == "oracle":
                if urgent:
                    item["priority_class"] = "HIGH"
                    item["priority_score"] = round(rng.uniform(80, 99), 2)
                else:
                    item["priority_class"] = "LOW"
                    item["priority_score"] = round(rng.uniform(3, 40), 2)

            elif classifier == "random":
                score = round(rng.uniform(0, 100), 2)
                item["priority_score"] = score
                item["priority_class"] = (
                    "HIGH" if score / 100.0 >= threshold else "LOW"
                )

            else:
                pool = (
                    bank["urgent_probabilities"]
                    if urgent
                    else bank["routine_probabilities"]
                )
                probability = rng.choice(pool)

                item["priority_score"] = round(probability * 100.0, 2)
                item["priority_class"] = (
                    "HIGH" if probability >= threshold else "LOW"
                )
                item["priority_probability"] = round(probability, 4)
                item["priority_threshold"] = threshold
                item["priority_model"] = bank.get("model_type")

            items.append(item)

        return items

    # ------------------------------------------------------------------
    # One run
    # ------------------------------------------------------------------

    def _run_once(
        self,
        mode: str,
        traffic: List[dict],
        schedule: DisruptionSchedule,
        link_capacity: int,
        buffer_capacity: Optional[int],
        max_ticks: int,
        spray_copies: int = SPRAY_COPIES,
        scenario_spec: Optional[dict] = None,
    ) -> dict:
        sim = DTNSimulator(
            mode,
            link_capacity=link_capacity,
            contact_plan=BASELINE_PLAN if mode == "baseline" else None,
            buffer_capacity=buffer_capacity,
            spray_copies=spray_copies,
        )

        by_tick: Dict[int, List[dict]] = defaultdict(list)
        scheduled_dups: List[tuple] = []

        for item in traffic:
            t = item.get("release_tick", 0)
            by_tick[t].append(item)
            dup_t = item.get("duplicate_tick")
            if dup_t is not None:
                scheduled_dups.append((dup_t, item))

        def inject(item):
            kwargs = {
                "source": item["source"],
                "destination": item["destination"],
                "payload": item["payload"],
                "ttl": item["ttl"],
                "true_urgent": item["true_urgent"],
            }
            for k in (
                "priority_score",
                "priority_class",
                "priority_probability",
                "priority_confidence",
                "priority_threshold",
                "priority_model",
            ):
                if k in item:
                    kwargs[k] = item[k]

            msg = sim.add_message(**kwargs)
            if item.get("tamper") and msg is not None:
                msg.tamper()

        # Initial release at t=0
        for item in by_tick.get(0, []):
            inject(item)

        while sim.simulation_time < max_ticks and not sim.is_finished():
            current_tick = sim.simulation_time + 1

            # Forced scenario link disruptions (Phase 4.1)
            if scenario_spec and "forced_link" in scenario_spec:
                f_link = scenario_spec["forced_link"]
                f_start = scenario_spec["forced_start"]
                f_end = f_start + scenario_spec["forced_duration"]
                if current_tick == f_start:
                    sim.disrupt_link(f_link)
                elif current_tick == f_end:
                    sim.restore_link(f_link)

            schedule.apply(sim, current_tick)

            # In-transit releases at current_tick
            for item in by_tick.get(current_tick, []):
                inject(item)

            # Replay duplicates scheduled at current_tick
            for dup_t, item in scheduled_dups:
                if dup_t == current_tick:
                    sim.send_duplicate(
                        source=item["source"],
                        destination=item["destination"],
                        payload=item["payload"],
                        priority_score=item.get("priority_score", 50.0),
                        priority_class=item.get("priority_class", "NORMAL"),
                        true_urgent=item["true_urgent"],
                    )

            sim.step(return_snapshot=False)

        return sim.statistics()

    # ------------------------------------------------------------------
    # Aggregation helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _summarise(values: List[float]) -> dict:
        if not values:
            return {"mean": None, "std": None, "ci95": None, "n": 0}

        mean = statistics.fmean(values)
        std = statistics.stdev(values) if len(values) > 1 else 0.0
        ci95 = 1.96 * std / math.sqrt(len(values)) if len(values) > 1 else 0.0

        return {
            "mean": round(mean, 2),
            "std": round(std, 2),
            "ci95": round(ci95, 2),
            "n": len(values),
        }

    def _aggregate(self, runs: List[dict]) -> dict:
        summary = {}

        for metric, guard in METRICS.items():
            values = [
                run[metric]
                for run in runs
                if guard is None or run.get(guard, 0) > 0
            ]
            summary[metric] = self._summarise(values)

        classes = sorted(
            {name for run in runs for name in run["class_breakdown"]}
        )

        summary["class_avg_delay"] = {
            name: self._summarise(
                [
                    run["class_breakdown"][name]["avg_delay"]
                    for run in runs
                    if name in run["class_breakdown"]
                    and run["class_breakdown"][name]["delivered"] > 0
                ]
            )["mean"]
            for name in classes
        }

        summary["class_delivery_rate"] = {
            name: self._summarise(
                [
                    run["class_breakdown"][name]["delivery_rate"]
                    for run in runs
                    if name in run["class_breakdown"]
                ]
            )["mean"]
            for name in classes
        }

        return summary

    @staticmethod
    def _improvement(
        better: dict,
        worse: dict,
        better_runs: List[dict],
        worse_runs: List[dict],
    ) -> dict:
        """Positive numbers mean `better` outperformed `worse`."""

        def mean(summary, metric):
            return summary[metric]["mean"]

        def gain(metric):
            a, b = mean(worse, metric), mean(better, metric)
            return None if a is None or b is None else round(a - b, 2)

        urgent_worse = mean(worse, "urgent_avg_delay")
        urgent_better = mean(better, "urgent_avg_delay")

        urgent_reduction_pct = (
            round((urgent_worse - urgent_better) / urgent_worse * 100, 1)
            if urgent_worse and urgent_better is not None
            else None
        )

        urgent_wins = urgent_ties = urgent_losses = 0

        for run_better, run_worse in zip(better_runs, worse_runs):
            if not (
                run_better["urgent_delivered"] and run_worse["urgent_delivered"]
            ):
                continue

            if run_better["urgent_avg_delay"] < run_worse["urgent_avg_delay"]:
                urgent_wins += 1
            elif run_better["urgent_avg_delay"] > run_worse["urgent_avg_delay"]:
                urgent_losses += 1
            else:
                urgent_ties += 1

        def pp(metric):
            a, b = mean(worse, metric), mean(better, metric)
            return None if a is None or b is None else round(b - a, 2)

        overhead_worse = mean(worse, "overhead_ratio")
        overhead_better = mean(better, "overhead_ratio")

        overhead_reduction_pct = (
            round((overhead_worse - overhead_better) / overhead_worse * 100, 1)
            if overhead_worse and overhead_better is not None
            else None
        )

        return {
            "urgent_delay_saved_ticks": gain("urgent_avg_delay"),
            "urgent_delay_reduction_pct": urgent_reduction_pct,
            "average_delay_saved_ticks": gain("average_delay"),
            "delivery_rate_gain_pp": pp("delivery_rate"),
            "urgent_delivery_rate_gain_pp": pp("urgent_delivery_rate"),
            "drops_avoided": gain("dropped"),
            "link_utilization_change_pp": pp("link_utilization"),
            "overhead_saved_per_delivery": gain("overhead_ratio"),
            "overhead_reduction_pct": overhead_reduction_pct,
            "transmissions_saved": gain("transmissions"),
            "urgent_delay_seed_record": {
                "wins": urgent_wins,
                "ties": urgent_ties,
                "losses": urgent_losses,
            },
        }

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(
        self,
        seeds: int = 20,
        base_seed: int = 1,
        messages: int = 36,
        outages: int = 4,
        congestion_events: int = 3,
        link_capacity: int = 2,
        buffer_capacity: Optional[int] = 10,
        ttl: int = 30,
        max_ticks: int = 120,
        include_runs: bool = False,
        classifier: str = "tinyml",
        urgent_fraction: float = 0.20,
        scenario: Optional[str] = None,
        arrival_process: str = "burst",
        multi_flow: bool = False,
        spray_copies: int = SPRAY_COPIES,
    ) -> dict:
        if classifier not in CLASSIFIERS:
            raise ValueError(f"classifier must be one of {CLASSIFIERS}")

        # Scenario overrides (Phase 4.1)
        scenario_spec = SCENARIOS.get(scenario) if scenario else None
        corrupt_rate = 0.0
        duplicate_rate = 0.0

        if scenario_spec:
            outages = scenario_spec.get("outages", outages)
            congestion_events = scenario_spec.get("congestion_events", congestion_events)
            link_capacity = scenario_spec.get("link_capacity", link_capacity)
            buffer_capacity = scenario_spec.get("buffer_capacity", buffer_capacity)
            corrupt_rate = scenario_spec.get("corrupt_rate", 0.0)
            duplicate_rate = scenario_spec.get("duplicate_rate", 0.0)

        # Fail early (before any simulation) if the bank is unusable.
        bank = self.load_score_bank() if classifier == "tinyml" else None

        runs: Dict[str, List[dict]] = {mode: [] for mode in STRATEGIES}
        per_seed = []
        schedules = []

        for offset in range(seeds):
            seed = base_seed + offset

            traffic = self._traffic(
                seed=seed,
                count=messages,
                ttl=ttl,
                classifier=classifier,
                urgent_fraction=urgent_fraction,
                arrival_process=arrival_process,
                multi_flow=multi_flow,
                corrupt_rate=corrupt_rate,
                duplicate_rate=duplicate_rate,
            )

            link_ids = list(
                DTNSimulator("baseline").network.links.keys()
            )

            schedule = DisruptionSchedule(
                link_ids,
                seed=seed,
                horizon=ttl,
                outages=outages,
                congestion_events=congestion_events,
            )

            row = {"seed": seed}

            for mode in STRATEGIES:
                stats = self._run_once(
                    mode=mode,
                    traffic=traffic,
                    schedule=schedule,
                    link_capacity=link_capacity,
                    buffer_capacity=buffer_capacity,
                    max_ticks=max_ticks,
                    spray_copies=spray_copies,
                    scenario_spec=scenario_spec,
                )
                runs[mode].append(stats)

                row[mode] = {
                    key: stats[key]
                    for key in (
                        "delivery_rate",
                        "urgent_delivery_rate",
                        "average_delay",
                        "urgent_avg_delay",
                        "link_utilization",
                        "dropped",
                        "overhead_ratio",
                        "simulation_time",
                        "custody_retransmissions",
                    )
                    if key in stats
                }

            per_seed.append(row)

            if include_runs:
                schedules.append(schedule.describe())

        summary = {mode: self._aggregate(runs[mode]) for mode in STRATEGIES}

        result = {
            "config": {
                "seeds": seeds,
                "base_seed": base_seed,
                "messages": messages,
                "outages_per_run": outages,
                "congestion_events_per_run": congestion_events,
                "link_capacity": link_capacity,
                "buffer_capacity": buffer_capacity,
                "ttl": ttl,
                "spray_copies": spray_copies,
                "classifier": classifier,
                "urgent_fraction": urgent_fraction,
                "scenario": scenario,
                "scenario_info": scenario_spec,
                "arrival_process": arrival_process,
                "multi_flow": multi_flow,
                "urgency_label": (
                    "dataset anomaly-derived urgency proxy"
                    if classifier == "tinyml"
                    else "assigned by the workload generator"
                ),
                "model_type": bank.get("model_type") if bank else None,
                "threshold": (
                    bank.get("threshold", DEFAULT_THRESHOLD)
                    if bank
                    else DEFAULT_THRESHOLD
                ),
                "bank": (
                    {
                        key: bank.get(key)
                        for key in (
                            "label_column",
                            "rows",
                            "prevalence",
                            "precision",
                            "recall",
                            "built_at",
                        )
                    }
                    if bank
                    else None
                ),
            },
            "scenarios": SCENARIOS,
            "strategies": dict(DTNSimulator.STRATEGY_LABELS),
            "summary": summary,
            "improvement": {
                "adaptive_vs_baseline": self._improvement(
                    summary["adaptive"],
                    summary["baseline"],
                    runs["adaptive"],
                    runs["baseline"],
                ),
                "reroute_vs_baseline": self._improvement(
                    summary["reroute"],
                    summary["baseline"],
                    runs["reroute"],
                    runs["baseline"],
                ),
                "adaptive_vs_reroute": self._improvement(
                    summary["adaptive"],
                    summary["reroute"],
                    runs["adaptive"],
                    runs["reroute"],
                ),
                "adaptive_vs_spray": self._improvement(
                    summary["adaptive"],
                    summary["spray"],
                    runs["adaptive"],
                    runs["spray"],
                ),
                "adaptive_vs_epidemic": self._improvement(
                    summary["adaptive"],
                    summary["epidemic"],
                    runs["adaptive"],
                    runs["epidemic"],
                ),
            },
        }

        if include_runs:
            result["per_seed"] = per_seed
            result["disruption_schedules"] = schedules

        return result

    def run_sweep(
        self,
        parameter: str = "link_capacity",
        values: Optional[List[Any]] = None,
        seeds: int = 5,
        base_seed: int = 42,
        messages: int = 24,
        outages: int = 3,
        congestion_events: int = 2,
        link_capacity: int = 2,
        buffer_capacity: Optional[int] = 10,
        ttl: int = 30,
        classifier: str = "tinyml",
        urgent_fraction: float = 0.20,
    ) -> dict:
        """
        Sensitivity sweep over one network parameter (Phase 4.3).
        Valid parameters: 'link_capacity', 'buffer_capacity', 'outages'
        """
        if parameter == "link_capacity":
            if values is None:
                values = [1, 2, 3, 4]
        elif parameter == "buffer_capacity":
            if values is None:
                values = [4, 8, 12, 16, 20]
        elif parameter == "outages":
            if values is None:
                values = [1, 2, 4, 6, 8]
        else:
            raise ValueError(f"Unsupported sweep parameter: {parameter}")

        results = []

        for val in values:
            kw = {
                "seeds": seeds,
                "base_seed": base_seed,
                "messages": messages,
                "outages": outages,
                "congestion_events": congestion_events,
                "link_capacity": link_capacity,
                "buffer_capacity": buffer_capacity,
                "ttl": ttl,
                "classifier": classifier,
                "urgent_fraction": urgent_fraction,
            }
            kw[parameter] = val

            res = self.run(**kw)
            point = {"value": val}

            for mode in STRATEGIES:
                mode_sum = res["summary"].get(mode, {})
                point[mode] = {
                    "delivery_rate": mode_sum.get("delivery_rate", {}).get("mean"),
                    "urgent_delivery_rate": mode_sum.get("urgent_delivery_rate", {}).get("mean"),
                    "average_delay": mode_sum.get("average_delay", {}).get("mean"),
                    "urgent_avg_delay": mode_sum.get("urgent_avg_delay", {}).get("mean"),
                    "overhead_ratio": mode_sum.get("overhead_ratio", {}).get("mean"),
                    "transmissions": mode_sum.get("transmissions", {}).get("mean"),
                    "link_utilization": mode_sum.get("link_utilization", {}).get("mean"),
                }
            results.append(point)

        return {
            "parameter": parameter,
            "values": values,
            "seeds_per_point": seeds,
            "results": results,
        }

    @staticmethod
    def to_csv(result: dict) -> str:
        """
        Export benchmark summary and per-seed results to CSV format (Phase 4.4).
        """
        output = io.StringIO()
        writer = csv.writer(output)

        writer.writerow(["Space DTN Statistical Benchmark Export"])
        config = result.get("config", {})
        for k, v in config.items():
            if isinstance(v, dict):
                continue
            writer.writerow([f"# Config: {k}", v])
        writer.writerow([])

        # Summary Section
        strategies = list(result.get("summary", {}).keys())
        writer.writerow(["--- STRATEGY SUMMARY ---"])
        headers = [
            "Metric",
            *[result.get("strategies", {}).get(s, s) for s in strategies],
        ]
        writer.writerow(headers)

        metrics_to_export = [
            ("delivery_rate", "Delivery Rate (%)"),
            ("urgent_delivery_rate", "Urgent Delivery Rate (%)"),
            ("average_delay", "Average Delay (ticks)"),
            ("urgent_avg_delay", "Urgent Average Delay (ticks)"),
            ("average_path_latency_ms", "Average Path Latency (ms)"),
            ("link_utilization", "Link Utilization (%)"),
            ("dropped", "Dropped Bundles"),
            ("transmissions", "Transmissions"),
            ("overhead_ratio", "Overhead Ratio"),
            ("buffer_blocked", "Buffer Blocked Events"),
            ("buffer_evictions", "Buffer Evictions"),
            ("custody_retransmissions", "Custody Retransmissions"),
        ]

        summary = result.get("summary", {})
        for metric_key, metric_label in metrics_to_export:
            row = [metric_label]
            for s in strategies:
                metric_data = summary.get(s, {}).get(metric_key)
                if isinstance(metric_data, dict):
                    mean = metric_data.get("mean", "—")
                    ci = metric_data.get("ci95", 0.0)
                    row.append(f"{mean} ± {ci}" if mean is not None else "—")
                else:
                    row.append(str(metric_data) if metric_data is not None else "—")
            writer.writerow(row)

        writer.writerow([])

        # Per-seed Section
        if "per_seed" in result:
            writer.writerow(["--- PER-SEED RUN BREAKDOWN ---"])
            seed_headers = [
                "Seed", "Strategy", "Delivery Rate (%)", "Urgent Delivery Rate (%)",
                "Avg Delay", "Urgent Avg Delay", "Link Util (%)", "Dropped", "Overhead Ratio",
                "Custody Retransmissions"
            ]
            writer.writerow(seed_headers)

            for seed_row in result["per_seed"]:
                seed_num = seed_row.get("seed")
                for s in strategies:
                    if s in seed_row:
                        data = seed_row[s]
                        writer.writerow([
                            seed_num,
                            s,
                            data.get("delivery_rate", ""),
                            data.get("urgent_delivery_rate", ""),
                            data.get("average_delay", ""),
                            data.get("urgent_avg_delay", ""),
                            data.get("link_utilization", ""),
                            data.get("dropped", ""),
                            data.get("overhead_ratio", ""),
                            data.get("custody_retransmissions", 0),
                        ])

        return output.getvalue()


    def run_priority_sources(self, **kwargs) -> dict:
        """
        Run the benchmark once per priority source and report only what the
        priority engine changes: adaptive vs. reroute (same live routing,
        FIFO vs. priority scheduling), scored on the proxy urgency label.
        """
        kwargs.pop("classifier", None)
        kwargs.pop("include_runs", None)

        sources = {}

        for classifier in CLASSIFIERS:
            try:
                result = self.run(classifier=classifier, **kwargs)
            except ScoreBankUnavailable as exc:
                sources[classifier] = {"available": False, "error": str(exc)}
                continue

            summary = result["summary"]

            def pick(mode):
                return {
                    metric: summary[mode][metric]
                    for metric in (
                        "urgent_avg_delay",
                        "urgent_delivery_rate",
                        "average_delay",
                        "delivery_rate",
                    )
                } | {"routine_avg_delay": summary[mode]["class_avg_delay"].get("LOW")}

            sources[classifier] = {
                "available": True,
                "config": {
                    key: result["config"][key]
                    for key in ("classifier", "model_type", "threshold")
                },
                "reroute": pick("reroute"),
                "adaptive": pick("adaptive"),
                "adaptive_vs_reroute": result["improvement"][
                    "adaptive_vs_reroute"
                ],
            }

        return {"sources": sources, "classifiers": list(CLASSIFIERS)}


benchmark_service = BenchmarkService()

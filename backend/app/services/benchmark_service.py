import math
import random
import statistics
from typing import Dict, List, Optional

from backend.app.dtn.disruptions import DisruptionSchedule
from backend.app.dtn.simulator import DTNSimulator


# Published contact plan for the static baseline (two latency-9 paths tie
# from GS-1 to GS-2, so the plan names one explicitly).
BASELINE_PLAN = ["GS-1", "SAT-1", "SAT-3", "SAT-5", "GS-2"]

STRATEGIES = ("baseline", "reroute", "adaptive")

# Metrics averaged across seeds. The second element names the statistics
# field that must be > 0 for the run to count (avoids averaging in the
# artificial 0 the simulator reports when nothing was delivered).
METRICS = {
    "delivery_rate": None,
    "urgent_delivery_rate": None,
    "average_delay": "delivered",
    "urgent_avg_delay": "urgent_delivered",
    "average_path_latency_ms": "delivered",
    "link_utilization": None,
    "peak_link_utilization": None,
    "dropped": None,
    "buffer_blocked": None,
    "buffer_evictions": None,
    "delivered_after_storage": None,
    "simulation_time": None,
}


class BenchmarkService:
    """
    Runs every strategy on the SAME seeded traffic and the SAME seeded
    random outages / congestion, repeated over many seeds.

        baseline : FIFO + static contact-plan routing
        reroute  : FIFO + live adaptive routing        (routing effect)
        adaptive : TinyML priority + live adaptive routing (+ priority effect)
    """

    # ------------------------------------------------------------------
    # Workload
    # ------------------------------------------------------------------

    @staticmethod
    def _traffic(seed: int, count: int, ttl: int) -> List[dict]:
        rng = random.Random(f"traffic-{seed}")
        items = []

        for index in range(count):
            urgent = rng.random() < 0.20
            reverse = rng.random() < 0.25

            source, destination = (
                ("GS-2", "GS-1") if reverse else ("GS-1", "GS-2")
            )

            if urgent:
                priority_class = "HIGH"
                score = round(rng.uniform(80, 99), 2)
            else:
                priority_class = "LOW"
                score = round(rng.uniform(3, 40), 2)

            items.append(
                {
                    "source": source,
                    "destination": destination,
                    "payload": f"telemetry-{seed}-{index}",
                    "priority_class": priority_class,
                    "priority_score": score,
                    "ttl": ttl,
                }
            )

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
    ) -> dict:
        sim = DTNSimulator(
            mode,
            link_capacity=link_capacity,
            contact_plan=BASELINE_PLAN if mode == "baseline" else None,
            buffer_capacity=buffer_capacity,
        )

        for item in traffic:
            sim.add_message(**item)

        while sim.simulation_time < max_ticks and not sim.is_finished():
            schedule.apply(sim, sim.simulation_time + 1)
            sim.step()

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

        return {
            "urgent_delay_saved_ticks": gain("urgent_avg_delay"),
            "urgent_delay_reduction_pct": urgent_reduction_pct,
            "average_delay_saved_ticks": gain("average_delay"),
            "delivery_rate_gain_pp": pp("delivery_rate"),
            "urgent_delivery_rate_gain_pp": pp("urgent_delivery_rate"),
            "drops_avoided": gain("dropped"),
            "link_utilization_change_pp": pp("link_utilization"),
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
    ) -> dict:
        runs: Dict[str, List[dict]] = {mode: [] for mode in STRATEGIES}
        per_seed = []
        schedules = []

        for offset in range(seeds):
            seed = base_seed + offset

            traffic = self._traffic(seed, messages, ttl)

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
                    mode,
                    traffic,
                    schedule,
                    link_capacity,
                    buffer_capacity,
                    max_ticks,
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
                        "simulation_time",
                    )
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
            },
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
            },
        }

        if include_runs:
            result["per_seed"] = per_seed
            result["disruption_schedules"] = schedules

        return result


benchmark_service = BenchmarkService()

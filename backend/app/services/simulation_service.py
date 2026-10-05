from backend.app.core.state import simulation_store
from backend.app.dtn.simulator import DTNSimulator


class SimulationService:

    @staticmethod
    def get(simulation_id: str):
        return simulation_store.get(simulation_id)

    @staticmethod
    def reset(simulation_id: str):
        simulator = simulation_store.reset(simulation_id)
        return simulator.snapshot()

    @staticmethod
    def step(simulation_id: str):
        simulator = simulation_store.get(simulation_id)
        return simulator.step()

    @staticmethod
    def add_message(
        simulation_id: str,
        source: str,
        destination: str,
        payload: str,
        priority_score: float,
        priority_class: str,
        ttl: int,
        message_id=None,
        telemetry=None,
        priority_probability=None,
        priority_confidence=None,
        priority_threshold=None,
        priority_model=None,
        compression="none",
        encrypted=False,
    ):
        simulator = simulation_store.get(simulation_id)
        message = simulator.add_message(
            source=source,
            destination=destination,
            payload=payload,
            priority_score=priority_score,
            priority_class=priority_class,
            ttl=ttl,
            message_id=message_id,
            telemetry=telemetry,
            priority_probability=priority_probability,
            priority_confidence=priority_confidence,
            priority_threshold=priority_threshold,
            priority_model=priority_model,
            compression=compression,
            encrypted=encrypted,
        )
        return message.to_dict()

    @staticmethod
    def adjust_latency(simulation_id: str, link_id: str, delta: int):
        simulator = simulation_store.get(simulation_id)
        success = simulator.adjust_latency(link_id, delta)
        return {"success": success, "snapshot": simulator.snapshot()}

    @staticmethod
    def set_latency(simulation_id: str, link_id: str, latency: int):
        simulator = simulation_store.get(simulation_id)
        success = simulator.set_latency(link_id, latency)
        return {"success": success, "snapshot": simulator.snapshot()}

    @staticmethod
    def adjust_congestion(simulation_id: str, link_id: str, delta: float):
        simulator = simulation_store.get(simulation_id)
        success = simulator.adjust_congestion(link_id, delta)
        return {"success": success, "snapshot": simulator.snapshot()}

    @staticmethod
    def set_congestion(simulation_id: str, link_id: str, congestion: float):
        simulator = simulation_store.get(simulation_id)
        success = simulator.set_congestion(link_id, congestion)
        return {"success": success, "snapshot": simulator.snapshot()}

    @staticmethod
    def reset_link_conditions(simulation_id: str, link_id: str):
        simulator = simulation_store.get(simulation_id)
        success = simulator.reset_link_conditions(link_id)
        return {"success": success, "snapshot": simulator.snapshot()}

    # Backward-compatible endpoints.
    @staticmethod
    def disrupt_link(simulation_id: str, link_id: str):
        simulator = simulation_store.get(simulation_id)
        success = simulator.disrupt_link(link_id)
        return {"success": success, "snapshot": simulator.snapshot()}

    @staticmethod
    def restore_link(simulation_id: str, link_id: str):
        simulator = simulation_store.get(simulation_id)
        success = simulator.restore_link(link_id)
        return {"success": success, "snapshot": simulator.snapshot()}

    @staticmethod
    def replay_bundle(simulation_id: str, message_id: str):
        """
        Send a retransmitted copy of an already-delivered message to its
        destination. The duplicate detector must reject it. Used to
        demonstrate duplicate detection without typing a new message.
        """
        simulator = simulation_store.get(simulation_id)
        message = simulator.messages.get(message_id)
        success = simulator.replay_bundle(message_id)

        return {
            "success": success,
            "message_id": message_id,
            "destination": message.destination if message else None,
            "duplicates": simulator.total_duplicates,
            "snapshot": simulator.snapshot(),
        }

    @staticmethod
    def corrupt_message(simulation_id: str, message_id: str):
        """
        Corrupt an in-flight message so the destination's SHA-256 check
        fails. Used to demonstrate integrity verification on demand.
        """
        simulator = simulation_store.get(simulation_id)
        success = simulator.corrupt_message(message_id)

        return {
            "success": success,
            "message_id": message_id,
            "integrity_failures": simulator.integrity_failures,
            "snapshot": simulator.snapshot(),
        }

    @staticmethod
    def snapshot(simulation_id: str):
        simulator = simulation_store.get(simulation_id)
        return simulator.snapshot()


simulation_service = SimulationService()


class ComparisonService:
    """
    Runs the SAME scripted scenario on three simulators in lockstep:

        baseline : FIFO queue + static contact-plan routing
        reroute  : FIFO queue + disruption-aware routing
        adaptive : TinyML priority queue + disruption-aware routing

    Scenario: five low-priority messages are queued before one urgent
    message (all GS-1 -> GS-2). A link on the published contact plan fails
    mid-run and is restored later.

      * FIFO leaves the urgent message at the back of the queue; the
        priority queue sends it first.
      * The static plan has no route around the failed link, so the
        baseline waits; the live routers recalculate from current link
        state and go around it.

    `reroute` isolates the two effects:
        baseline -> reroute : what adaptive ROUTING contributes
        reroute  -> adaptive: what PRIORITY scheduling contributes

    Priority scores are fixed inputs so the run is repeatable. They are
    scripted, not live TinyML output. For statistics over many random
    outage patterns see BenchmarkService (/api/simulation/compare/benchmark).
    """

    SOURCE = "GS-1"
    DESTINATION = "GS-2"

    # (priority_class, priority_score). The urgent message is LAST so the
    # FIFO strategies put it behind all of the low-priority data.
    SCENARIO_MESSAGES = [
        ("LOW", 5),
        ("LOW", 5),
        ("LOW", 5),
        ("LOW", 5),
        ("LOW", 5),
        ("HIGH", 95),
    ]

    # GS-1 -> SAT-1 -> SAT-3 -> SAT-5 -> GS-2 and
    # GS-1 -> SAT-1 -> SAT-2 -> SAT-5 -> GS-2 both total 9 latency units,
    # so the plan has to name one. The adaptive router also picks the SAT-3
    # path on a healthy network, so a failure on it hits every strategy.
    BASELINE_PLAN = ["GS-1", "SAT-1", "SAT-3", "SAT-5", "GS-2"]

    # L4 = SAT-3 <-> SAT-5. Alternate path: SAT-3 -> SAT-2 (L3) -> SAT-5 (L10).
    FAIL_LINK = "L4"
    FAIL_TICK = 3
    RESTORE_TICK = 8

    MAX_TICKS = 40

    MODES = ("baseline", "reroute", "adaptive")

    def __init__(self):
        self.sims = {}
        self.replayed = {}
        self.urgent_id = None
        self.reset()

    # --------------------------------------------------

    def reset(self):
        self.sims = {
            "baseline": DTNSimulator(
                "baseline", contact_plan=self.BASELINE_PLAN
            ),
            "reroute": DTNSimulator("reroute"),
            "adaptive": DTNSimulator("adaptive"),
        }
        self.replayed = {mode: False for mode in self.MODES}

        for sim in self.sims.values():
            for priority_class, score in self.SCENARIO_MESSAGES:
                sim.add_message(
                    self.SOURCE,
                    self.DESTINATION,
                    "telemetry",
                    priority_score=score,
                    priority_class=priority_class,
                    ttl=30,
                )

        # Messages are numbered in creation order, so the urgent one is last.
        self.urgent_id = f"MSG-{len(self.SCENARIO_MESSAGES):04d}"

        return self.snapshot()

    # --------------------------------------------------

    def step(self):
        tick = self.sims["adaptive"].simulation_time + 1

        for mode, sim in self.sims.items():
            # Scripted link events happen before the tick, identically in
            # every mode.
            if tick == self.FAIL_TICK:
                sim.disrupt_link(self.FAIL_LINK)
            elif tick == self.RESTORE_TICK:
                sim.restore_link(self.FAIL_LINK)

            sim.step()

            # Replay a copy of the urgent bundle once it has been
            # delivered, to show duplicate detection working.
            if not self.replayed[mode] and self.urgent_id in sim.delivered_ids:
                sim.replay_bundle(self.urgent_id)
                self.replayed[mode] = True

        return self.snapshot()

    def run_to_end(self):
        while not self.is_finished() and (
            self.sims["adaptive"].simulation_time < self.MAX_TICKS
        ):
            self.step()

        return self.snapshot()

    def is_finished(self) -> bool:
        return all(sim.is_finished() for sim in self.sims.values())

    # --------------------------------------------------

    @staticmethod
    def _delta(baseline: dict, adaptive: dict) -> dict:
        """
        Differences expressed so a positive number means the second
        argument did better than the first.
        """
        both_delivered_urgent = (
            baseline["urgent_delivered"] > 0
            and adaptive["urgent_delivered"] > 0
        )

        return {
            "urgent_delay_saved": (
                round(
                    baseline["urgent_avg_delay"]
                    - adaptive["urgent_avg_delay"],
                    2,
                )
                if both_delivered_urgent
                else None
            ),
            "average_delay_saved": round(
                baseline["average_delay"] - adaptive["average_delay"], 2
            ),
            "delivery_rate_gain": round(
                adaptive["delivery_rate"] - baseline["delivery_rate"], 2
            ),
            "drops_avoided": baseline["dropped"] - adaptive["dropped"],
            "utilization_change": round(
                adaptive["link_utilization"] - baseline["link_utilization"],
                2,
            ),
        }

    def snapshot(self):
        baseline = self.sims["baseline"].snapshot()
        reroute = self.sims["reroute"].snapshot()
        adaptive = self.sims["adaptive"].snapshot()

        return {
            "baseline": baseline,
            "reroute": reroute,
            "adaptive": adaptive,
            # Overall: baseline vs the full adaptive system.
            "delta": self._delta(
                baseline["statistics"], adaptive["statistics"]
            ),
            # Attribution: where does the improvement come from?
            "delta_routing": self._delta(
                baseline["statistics"], reroute["statistics"]
            ),
            "delta_priority": self._delta(
                reroute["statistics"], adaptive["statistics"]
            ),
            "finished": self.is_finished(),
            "scenario": {
                "source": self.SOURCE,
                "destination": self.DESTINATION,
                "urgent_id": self.urgent_id,
                "baseline_plan": self.BASELINE_PLAN,
                "fail_link": self.FAIL_LINK,
                "fail_tick": self.FAIL_TICK,
                "restore_tick": self.RESTORE_TICK,
                "link_capacity": self.sims["adaptive"].link_capacity,
                "message_count": len(self.SCENARIO_MESSAGES),
            },
        }


comparison_service = ComparisonService()

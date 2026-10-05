import random
from collections import defaultdict
from typing import Dict, Iterable, List, Tuple


class DisruptionSchedule:
    """
    Seeded, reproducible "links disappear unpredictably" generator.

    The same seed always yields the same outages and congestion bursts, so
    several routing strategies can be run against IDENTICAL conditions and
    compared fairly. Overlapping windows on one link are merged so a
    restore event never cancels a later, still-active outage.

    Events are applied BEFORE the tick they are scheduled for:

        schedule.apply(sim, tick)   # then sim.step()
    """

    def __init__(
        self,
        link_ids: Iterable[str],
        seed: int = 0,
        horizon: int = 30,
        outages: int = 4,
        congestion_events: int = 3,
        min_duration: int = 2,
        max_duration: int = 7,
    ):
        self.seed = seed
        self.horizon = horizon

        rng = random.Random(f"disruptions-{seed}")
        links = sorted(link_ids)

        latest_start = max(1, horizon - max_duration)

        def draw(count: int, levels=None) -> List[Tuple[str, int, int, float]]:
            windows = []
            for _ in range(count):
                link = rng.choice(links)
                start = rng.randint(1, latest_start)
                end = start + rng.randint(min_duration, max_duration)
                level = rng.choice(levels) if levels else 0.0
                windows.append((link, start, end, level))
            return windows

        self.outage_windows = self._merge(draw(outages))
        self.congestion_windows = self._merge(
            draw(congestion_events, levels=(60.0, 75.0, 90.0))
        )

        # tick -> [(action, link_id, value)]
        self.events: Dict[int, List[Tuple[str, str, float]]] = defaultdict(list)

        for link, start, end, _ in self.outage_windows:
            self.events[start].append(("disrupt", link, 0.0))
            self.events[end].append(("restore", link, 0.0))

        for link, start, end, level in self.congestion_windows:
            self.events[start].append(("congest", link, level))
            self.events[end].append(("clear", link, 0.0))

    @staticmethod
    def _merge(windows):
        """Merge overlapping windows per link (keeping the higher level)."""
        per_link: Dict[str, list] = defaultdict(list)

        for link, start, end, level in windows:
            per_link[link].append([start, end, level])

        merged = []

        for link, items in sorted(per_link.items()):
            items.sort()
            current = items[0]

            for start, end, level in items[1:]:
                if start <= current[1]:
                    current[1] = max(current[1], end)
                    current[2] = max(current[2], level)
                else:
                    merged.append((link, *current))
                    current = [start, end, level]

            merged.append((link, *current))

        return sorted(merged, key=lambda item: (item[1], item[0]))

    def apply(self, sim, tick: int) -> List[str]:
        """Apply every event scheduled for `tick`. Returns descriptions."""
        applied = []

        for action, link_id, value in self.events.get(tick, []):
            if action == "disrupt":
                sim.disrupt_link(link_id)
            elif action == "restore":
                sim.restore_link(link_id)
            elif action == "congest":
                sim.set_congestion(link_id, value)
            elif action == "clear":
                sim.set_congestion(link_id, 0.0)

            applied.append(f"t={tick} {action} {link_id}")

        return applied

    def describe(self) -> dict:
        return {
            "seed": self.seed,
            "outages": [
                {"link": link, "start": start, "end": end}
                for link, start, end, _ in self.outage_windows
            ],
            "congestion": [
                {"link": link, "start": start, "end": end, "level": level}
                for link, start, end, level in self.congestion_windows
            ],
        }

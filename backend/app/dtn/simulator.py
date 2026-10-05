from collections import Counter, defaultdict
from typing import Dict, List, Optional

from backend.app.dtn.network import SpaceNetwork
from backend.app.dtn.message import DTNMessage
from backend.app.dtn.router import DTNRouter, StaticPlanRouter


class DTNSimulator:
    """
    DTN simulator that can run three strategies with identical traffic:

    adaptive : TinyML priority scheduling + live, disruption-aware routing
    reroute  : FIFO scheduling          + live, disruption-aware routing
    baseline : FIFO scheduling          + static contact-plan routing

    `reroute` exists to separate the two effects: baseline -> reroute shows
    what adaptive ROUTING buys, reroute -> adaptive shows what PRIORITY buys.

    Resources modelled per tick:
      * every link carries at most `link_capacity` messages
      * every relay node holds at most `buffer_capacity` messages
        (default: the node's own buffer_capacity). When a buffer is full the
        adaptive strategy evicts a clearly lower-priority resident to make
        room; the other strategies simply make the sender wait.
    """

    MODES = ("adaptive", "reroute", "baseline")

    STRATEGY_LABELS = {
        "adaptive": "TinyML priority + live adaptive routing",
        "reroute": "FIFO + live adaptive routing",
        "baseline": "FIFO + static contact-plan routing",
    }

    # The TinyML pipeline emits HIGH / LOW; the heuristic fallback can also
    # emit CRITICAL. Both count as urgent when scoring the comparison.
    URGENT_CLASSES = ("HIGH", "CRITICAL")

    # delivered : reached the destination and passed verification
    # dropped   : lost (TTL expired, integrity failed, or evicted)
    # rejected  : a retransmitted copy refused by the duplicate detector
    TERMINAL = ("delivered", "dropped", "rejected")

    # An incoming message may evict a resident only if it outranks it by
    # at least this many priority points.
    EVICTION_MARGIN = 20.0

    # Priority handed to the router by strategies that ignore priority.
    NEUTRAL_PRIORITY = 50.0

    def __init__(
        self,
        mode: str = "adaptive",
        link_capacity: int = 2,
        contact_plan: Optional[List[str]] = None,
        buffer_capacity: Optional[int] = None,
    ):
        if mode not in self.MODES:
            raise ValueError(f"mode must be one of {self.MODES}")

        self.mode = mode
        self.link_capacity = link_capacity
        self.contact_plan = contact_plan
        self.buffer_capacity = buffer_capacity

        self.network = SpaceNetwork()

        if mode == "baseline":
            self.router = StaticPlanRouter(self.network)
            if contact_plan:
                self.router.set_planned_path(contact_plan)
        else:
            self.router = DTNRouter(self.network)

        self.messages: Dict[str, DTNMessage] = {}
        self.simulation_time = 0

        # Bundle ids that have been delivered (used for duplicate detection).
        self.delivered_ids = set()
        self.event_log = []

        # (release_tick, message_id) retransmissions waiting to be sent.
        self.scheduled_duplicates = []

        self.total_created = 0
        self.total_delivered = 0
        self.total_dropped = 0
        self.total_duplicates = 0
        self.integrity_failures = 0

        # Resource accounting (utilization / buffers / resilience).
        self.busy_ticks = 0              # ticks with at least one live message
        self.disruption_ticks = 0        # busy ticks with >= 1 link down
        self.link_active_ticks = defaultdict(int)
        self.link_used_slots = defaultdict(int)
        self.link_peak_load = defaultdict(int)
        self.peak_buffer: Dict[str, int] = {}
        self.buffer_blocked = 0
        self.buffer_evictions = 0

    # --------------------------------------------------
    # MESSAGE CREATION
    # --------------------------------------------------

    def add_message(
        self,
        source: str,
        destination: str,
        payload: str,
        priority_score: float = 50,
        priority_class: str = "NORMAL",
        ttl: int = 30,
        message_id: Optional[str] = None,
        telemetry: Optional[dict] = None,
        priority_probability: Optional[float] = None,
        priority_confidence: Optional[float] = None,
        priority_threshold: Optional[float] = None,
        priority_model: Optional[str] = None,
        compression: str = "none",
        encrypted: bool = False,
    ):
        if message_id is None:
            message_id = f"MSG-{self.total_created + 1:04d}"

        if message_id in self.messages:
            return self.messages[message_id]

        message = DTNMessage(
            id=message_id,
            source=source,
            destination=destination,
            payload=payload,
            priority_score=priority_score,
            priority_class=priority_class,
            priority_probability=priority_probability,
            priority_confidence=priority_confidence,
            priority_threshold=priority_threshold,
            priority_model=priority_model,
            telemetry=telemetry or {},
            ttl=ttl,
            created_at=self.simulation_time,
            compression=compression,
            encrypted=encrypted,
        )

        self.messages[message.id] = message
        self.total_created += 1

        self._log(
            f"{message.id} created: {source} → {destination} "
            f"| priority={message.priority_score:.2f} "
            f"| class={message.priority_class}"
        )

        return message

    # --------------------------------------------------
    # SCHEDULING HELPERS
    # --------------------------------------------------

    def _sort_key(self, message: DTNMessage):
        if self.mode != "adaptive":
            # FIFO: arrival order only. Priority is ignored.
            return (message.created_at, message.id)

        # Adaptive: highest TinyML priority first, then arrival order.
        return (-message.priority_score, message.created_at, message.id)

    def _routing_priority(self, message: DTNMessage) -> float:
        """Priority the router is allowed to see for this strategy."""
        if self.mode == "adaptive":
            return message.priority_score

        return self.NEUTRAL_PRIORITY

    def _link_between(self, node_a: str, node_b: str):
        """Best usable link from node_a to node_b, or None."""
        candidates = [
            link
            for neighbor, link in self.network.get_neighbors(node_a)
            if neighbor == node_b
        ]

        if not candidates:
            return None

        return min(candidates, key=lambda link: link.latency)

    # --------------------------------------------------
    # BUFFER HELPERS
    # --------------------------------------------------

    def _capacity_of(self, node_id: str) -> int:
        if self.buffer_capacity is not None:
            return self.buffer_capacity

        return self.network.nodes[node_id].buffer_capacity

    def _make_room(
        self,
        node_id: str,
        incoming: DTNMessage,
        active_messages: List[DTNMessage],
        occupancy: Counter,
    ) -> bool:
        """
        Priority-aware eviction (adaptive strategy only).

        Drop the lowest-priority resident of a full buffer if the incoming
        message outranks it by EVICTION_MARGIN. Returns True if room was
        made. Other strategies never evict: the sender just waits.
        """
        if self.mode != "adaptive":
            return False

        residents = [
            other
            for other in active_messages
            if other is not incoming
            and other.current_node == node_id
            and other.status not in self.TERMINAL
        ]

        if not residents:
            return False

        victim = min(
            residents,
            key=lambda other: (other.priority_score, -other.created_at),
        )

        if (
            incoming.priority_score - victim.priority_score
            < self.EVICTION_MARGIN
        ):
            return False

        victim.reject_reason = "buffer_evicted"

        if victim.copy_of:
            victim.status = "rejected"
        else:
            victim.status = "dropped"
            self.total_dropped += 1

        occupancy[node_id] -= 1
        self.buffer_evictions += 1

        self._log(
            f"{victim.id} evicted from full buffer at {node_id} "
            f"to make room for {incoming.id}"
        )

        return True

    # --------------------------------------------------
    # SIMULATION STEP
    # --------------------------------------------------

    def step(self):
        self.simulation_time += 1

        self._release_duplicates()

        # Messages that used each link during THIS tick.
        link_usage: Dict[str, int] = {}

        active_messages = [
            message
            for message in self.messages.values()
            if message.status not in self.TERMINAL
        ]

        active_messages.sort(key=self._sort_key)

        # Messages currently held at each node.
        occupancy: Counter = Counter(
            message.current_node for message in active_messages
        )

        if active_messages:
            self.busy_ticks += 1

            if any(not link.active for link in self.network.links.values()):
                self.disruption_ticks += 1

        for message in active_messages:
            # May have been evicted earlier in this same tick.
            if message.status in self.TERMINAL:
                continue

            message.delay = self.simulation_time - message.created_at

            if message.delay > message.ttl:
                occupancy[message.current_node] -= 1

                if message.copy_of:
                    message.status = "rejected"
                    message.reject_reason = "expired"
                    self._log(f"{message.id} retransmitted copy expired")
                else:
                    message.status = "dropped"
                    message.reject_reason = "ttl"
                    self.total_dropped += 1
                    self._log(f"{message.id} dropped: TTL expired")
                continue

            if message.current_node == message.destination:
                self._deliver(message)
                occupancy[message.destination] -= 1
                continue

            route = self.router.find_route(
                message.current_node,
                message.destination,
                priority_score=self._routing_priority(message),
            )

            if not route:
                message.status = "stored"
                message.stored_ticks += 1
                self._log(
                    f"{message.id} stored at {message.current_node} "
                    f"(no usable route)"
                )
                continue

            if len(route) >= 2:
                next_node = route[1]
                previous_node = message.current_node

                # Link capacity: higher-ranked messages claim slots first.
                link = self._link_between(previous_node, next_node)
                link_key = None

                if link is not None:
                    link_key = getattr(
                        link, "id", f"{previous_node}-{next_node}"
                    )

                    if link_usage.get(link_key, 0) >= self.link_capacity:
                        message.status = "queued"
                        message.queued_ticks += 1
                        self._log(
                            f"{message.id} waiting at {previous_node} "
                            f"(link {link_key} full)"
                        )
                        continue

                # Buffer capacity at the next relay. The final destination
                # is a sink, so it never blocks.
                if (
                    next_node != message.destination
                    and occupancy[next_node] >= self._capacity_of(next_node)
                    and not self._make_room(
                        next_node, message, active_messages, occupancy
                    )
                ):
                    message.status = "queued"
                    message.queued_ticks += 1
                    self.buffer_blocked += 1
                    self._log(
                        f"{message.id} waiting at {previous_node} "
                        f"(buffer at {next_node} full)"
                    )
                    continue

                if link_key is not None:
                    link_usage[link_key] = link_usage.get(link_key, 0) + 1
                    message.path_latency += link.latency

                occupancy[previous_node] -= 1
                occupancy[next_node] += 1

                message.current_node = next_node
                message.route.append(next_node)
                message.hops += 1
                message.status = "in_transit"

                self._log(
                    f"{message.id} forwarded "
                    f"{previous_node} → {next_node}"
                )

            if message.current_node == message.destination:
                self._deliver(message)
                occupancy[message.destination] -= 1

        self._record_tick(active_messages, link_usage)

        return self.snapshot()

    def _record_tick(
        self,
        active_messages: List[DTNMessage],
        link_usage: Dict[str, int],
    ):
        """Accumulate link utilization and relay-buffer peaks."""
        if not active_messages:
            return

        for link in self.network.links.values():
            if not link.active:
                continue

            used = link_usage.get(link.id, 0)

            self.link_active_ticks[link.id] += 1
            self.link_used_slots[link.id] += used
            self.link_peak_load[link.id] = max(
                self.link_peak_load[link.id], used
            )

        # Relay buffers only: messages waiting at their own origin are the
        # sender's queue, not buffered transit data.
        relay = Counter(
            message.current_node
            for message in active_messages
            if message.status not in self.TERMINAL
            and message.current_node != message.source
        )

        for node_id, count in relay.items():
            if count > self.peak_buffer.get(node_id, 0):
                self.peak_buffer[node_id] = count

    # --------------------------------------------------
    # DELIVERY / INTEGRITY
    # --------------------------------------------------

    def _deliver(self, message: DTNMessage):
        # 1. Duplicate detection: has this bundle already been delivered?
        if message.bundle_id in self.delivered_ids:
            message.duplicate_detected = True
            message.status = "rejected"
            message.reject_reason = "duplicate"
            self.total_duplicates += 1

            self._log(
                f"{message.id} duplicate of {message.bundle_id} "
                f"rejected at {message.destination}"
            )
            return

        # 2. Integrity verification: recompute SHA-256 and compare.
        if not message.verify_integrity():
            self.integrity_failures += 1
            message.status = "dropped"
            message.reject_reason = "integrity"
            self.total_dropped += 1

            self._log(
                f"{message.id} failed integrity verification at "
                f"{message.destination}: SHA-256 mismatch, dropped"
            )
            return

        message.status = "delivered"
        message.integrity_verified = True

        self.delivered_ids.add(message.bundle_id)
        self.total_delivered += 1

        self._log(
            f"{message.id} delivered successfully"
        )

    def replay_bundle(self, message_id: str) -> bool:
        """
        Re-send a copy of an already-delivered bundle to its destination.

        The copy is a real retransmitted message (id "<bundle>-DUPn") that
        arrives at the destination straight away, where the duplicate
        detector rejects it. Because the copy is a message in the
        simulation, the 3D map and the packet tables can show the
        rejection instead of only a counter changing.
        """
        original = self.messages.get(message_id)

        if (
            original is None
            or original.copy_of
            or original.bundle_id not in self.delivered_ids
        ):
            return False

        copy = self.send_duplicate(original.id)

        if copy is None:
            return False

        # The retransmission reaches the destination directly. The normal
        # delivery path then runs duplicate detection and rejects it.
        copy.current_node = copy.destination
        copy.status = "in_transit"
        self._deliver(copy)

        return True

    # --------------------------------------------------
    # RETRANSMISSION (DUPLICATES) AND CORRUPTION
    # --------------------------------------------------

    def schedule_duplicate(self, message_id: str, delay: int = 3):
        """
        Plan a retransmission of an existing message `delay` ticks from
        now, as a sender would when an acknowledgement is lost.
        """
        if message_id not in self.messages:
            return False

        self.scheduled_duplicates.append(
            (self.simulation_time + delay, message_id)
        )
        return True

    def _release_duplicates(self):
        due = [
            item
            for item in self.scheduled_duplicates
            if item[0] <= self.simulation_time
        ]

        if not due:
            return

        self.scheduled_duplicates = [
            item
            for item in self.scheduled_duplicates
            if item[0] > self.simulation_time
        ]

        for _, message_id in due:
            self.send_duplicate(message_id)

    def send_duplicate(self, message_id: str):
        """
        Create a retransmitted copy at the original's source. It is a
        separate message that travels the network like any other and is
        only recognised as a duplicate when it reaches the destination.
        """
        original = self.messages.get(message_id)

        if original is None:
            return None

        copies = sum(
            1
            for message in self.messages.values()
            if message.copy_of == original.bundle_id
        )

        copy = DTNMessage(
            id=f"{original.bundle_id}-DUP{copies + 1}",
            source=original.source,
            destination=original.destination,
            payload=original.clean_payload(),
            priority_score=original.priority_score,
            priority_class=original.priority_class,
            priority_probability=original.priority_probability,
            priority_confidence=original.priority_confidence,
            priority_threshold=original.priority_threshold,
            priority_model=original.priority_model,
            telemetry=dict(original.telemetry),
            ttl=original.ttl,
            created_at=self.simulation_time,
            compression=original.compression,
            encrypted=original.encrypted,
            bundle_id=original.bundle_id,
            copy_of=original.bundle_id,
        )

        self.messages[copy.id] = copy

        self._log(
            f"{copy.id} retransmitted from {copy.source} "
            f"(copy of {original.bundle_id})"
        )

        return copy

    def corrupt_message(self, message_id: str) -> bool:
        """
        Corrupt a message that is still in the network. The destination's
        SHA-256 check will fail and the message will be dropped.
        """
        message = self.messages.get(message_id)

        if message is None or message.status in self.TERMINAL:
            return False

        if not message.tampered:
            message.tamper()
            self._log(
                f"{message.id} payload corrupted in transit "
                f"(hash no longer matches)"
            )

        return True

    # --------------------------------------------------
    # ADAPTIVE LINK CONTROL
    # --------------------------------------------------

    def adjust_latency(self, link_id: str, delta: int):
        link = self.network.adjust_link_latency(link_id, delta)

        if link is None:
            return False

        if link.active:
            direction = "increased" if delta > 0 else "decreased"
            self._log(
                f"LINK {link_id} latency {direction} to {link.latency} ms"
            )
        else:
            self._log(
                f"LINK {link_id} reached maximum latency and is UNUSABLE"
            )

        return True

    def set_latency(self, link_id: str, latency: int):
        link = self.network.set_link_latency(link_id, latency)

        if link is None:
            return False

        self._log(
            f"LINK {link_id} latency set to "
            f"{link.latency} ms ({link.link_status})"
        )
        return True

    def adjust_congestion(self, link_id: str, delta: float):
        link = self.network.adjust_link_congestion(link_id, delta)

        if link is None:
            return False

        direction = "increased" if delta > 0 else "decreased"
        self._log(
            f"LINK {link_id} congestion {direction} to "
            f"{link.congestion:.1f}%"
        )
        return True

    def set_congestion(self, link_id: str, congestion: float):
        link = self.network.set_link_congestion(link_id, congestion)

        if link is None:
            return False

        self._log(
            f"LINK {link_id} congestion set to "
            f"{link.congestion:.1f}%"
        )
        return True

    def reset_link_conditions(self, link_id: str):
        success = self.network.reset_link_conditions(link_id)

        if success:
            link = self.network.get_link(link_id)
            self._log(
                f"LINK {link_id} conditions reset: "
                f"{link.latency} ms / {link.congestion:.1f}% congestion"
            )

        return success

    def disrupt_link(self, link_id: str):
        return self.set_latency(link_id, 100)

    def restore_link(self, link_id: str):
        link = self.network.get_link(link_id)

        if link is None:
            return False

        return self.set_latency(
            link_id,
            link.base_latency or 1,
        )

    # --------------------------------------------------
    # LOGGING
    # --------------------------------------------------

    def _log(self, event: str):
        self.event_log.insert(
            0,
            {
                "time": self.simulation_time,
                "event": event,
            },
        )

        self.event_log = self.event_log[:100]

    # --------------------------------------------------
    # METRICS
    # --------------------------------------------------

    @staticmethod
    def _mean(values) -> float:
        values = list(values)
        return sum(values) / len(values) if values else 0.0

    def _class_breakdown(self, originals: List[DTNMessage]) -> dict:
        """Delivery and delay per priority class (originals only)."""
        groups: Dict[str, List[DTNMessage]] = defaultdict(list)

        for message in originals:
            groups[message.priority_class].append(message)

        breakdown = {}

        for priority_class, members in sorted(groups.items()):
            delivered = [m for m in members if m.status == "delivered"]
            delays = [m.delay for m in delivered]

            breakdown[priority_class] = {
                "total": len(members),
                "delivered": len(delivered),
                "dropped": sum(1 for m in members if m.status == "dropped"),
                "delivery_rate": round(
                    len(delivered) / len(members) * 100, 2
                ),
                "avg_delay": round(self._mean(delays), 2),
                "max_delay": max(delays) if delays else 0,
            }

        return breakdown

    def _utilization(self) -> dict:
        """Link utilization = slots used / slots available while link up."""
        by_link = {}
        total_used = 0
        total_available = 0

        for link_id in self.network.links:
            active_ticks = self.link_active_ticks.get(link_id, 0)
            available = active_ticks * self.link_capacity
            used = self.link_used_slots.get(link_id, 0)

            total_used += used
            total_available += available

            by_link[link_id] = {
                "utilization": round(
                    used / available * 100 if available else 0.0, 2
                ),
                "slots_used": used,
                "peak_load": self.link_peak_load.get(link_id, 0),
                "active_ticks": active_ticks,
            }

        busiest = max(
            by_link.items(),
            key=lambda item: item[1]["utilization"],
            default=(None, {"utilization": 0.0}),
        )

        return {
            "link_utilization": round(
                total_used / total_available * 100
                if total_available
                else 0.0,
                2,
            ),
            "peak_link_utilization": busiest[1]["utilization"],
            "busiest_link": busiest[0] if busiest[1]["utilization"] else None,
            "link_utilization_by_link": by_link,
        }

    def statistics(self):
        # Retransmitted copies are not counted as extra messages.
        originals = [
            message
            for message in self.messages.values()
            if not message.copy_of
        ]

        total = len(originals)
        delivered = self.total_delivered

        delivery_rate = (
            (delivered / total) * 100
            if total
            else 0
        )

        active_links = self.network.active_link_count()
        total_links = self.network.total_link_count()

        network_availability = (
            (active_links / total_links) * 100
            if total_links
            else 0
        )

        delivered_messages = [
            message
            for message in self.messages.values()
            if message.status == "delivered"
        ]

        average_delay = self._mean(m.delay for m in delivered_messages)
        average_hops = self._mean(m.hops for m in delivered_messages)
        average_path_latency = self._mean(
            m.path_latency for m in delivered_messages
        )

        high_priority = sum(
            1
            for message in originals
            if message.priority_class in self.URGENT_CLASSES
        )

        stored_messages = sum(
            1
            for message in self.messages.values()
            if message.status == "stored"
        )

        # priority_class is ground truth for SCORING. The non-adaptive
        # strategies ignore it when scheduling, so the comparison is fair.
        urgent_delivered_messages = [
            message
            for message in delivered_messages
            if message.priority_class in self.URGENT_CLASSES
        ]

        urgent_avg_delay = self._mean(
            m.delay for m in urgent_delivered_messages
        )

        # Resilience: bundles that rode out an outage in storage and
        # still arrived intact.
        delivered_after_storage = sum(
            1 for m in delivered_messages if m.stored_ticks > 0
        )

        dropped_breakdown = Counter(
            message.reject_reason or "unknown"
            for message in originals
            if message.status == "dropped"
        )

        utilization = self._utilization()

        buffer_capacity = (
            self.buffer_capacity
            if self.buffer_capacity is not None
            else min(
                (node.buffer_capacity for node in self.network.nodes.values()),
                default=0,
            )
        )

        return {
            "mode": self.mode,
            "strategy": self.STRATEGY_LABELS[self.mode],
            "link_capacity": self.link_capacity,
            "buffer_capacity": buffer_capacity,
            "simulation_time": self.simulation_time,
            "total_messages": total,
            "delivered": delivered,
            "dropped": self.total_dropped,
            "dropped_breakdown": dict(dropped_breakdown),
            "stored": stored_messages,
            "high_priority_messages": high_priority,
            "critical_messages": sum(
                1
                for message in originals
                if message.priority_class == "CRITICAL"
            ),
            "urgent_delivered": len(urgent_delivered_messages),
            "urgent_delivery_rate": round(
                len(urgent_delivered_messages) / high_priority * 100
                if high_priority
                else 0.0,
                2,
            ),
            "urgent_avg_delay": round(urgent_avg_delay, 2),
            "duplicates": self.total_duplicates,
            "copies_sent": len(self.messages) - total,
            "pending_duplicates": len(self.scheduled_duplicates),
            "corrupted": sum(
                1 for message in self.messages.values() if message.tampered
            ),
            "integrity_failures": self.integrity_failures,
            "delivery_rate": round(delivery_rate, 2),
            "active_links": active_links,
            "total_links": total_links,
            "network_availability": round(network_availability, 2),
            "average_link_latency": self.network.average_latency(),
            "average_link_congestion": self.network.average_congestion(),
            "average_delay": round(average_delay, 2),
            "average_hops": round(average_hops, 2),
            "average_path_latency_ms": round(average_path_latency, 2),
            "class_breakdown": self._class_breakdown(originals),
            # Link utilization
            **utilization,
            # Buffers / store-and-forward
            "peak_buffer_occupancy": dict(self.peak_buffer),
            "buffer_blocked": self.buffer_blocked,
            "buffer_evictions": self.buffer_evictions,
            # Resilience
            "disruption_ticks": self.disruption_ticks,
            "delivered_after_storage": delivered_after_storage,
            "total_stored_ticks": sum(
                message.stored_ticks for message in originals
            ),
        }

    def is_finished(self) -> bool:
        """True when every message is delivered or dropped."""
        return (
            bool(self.messages)
            and not self.scheduled_duplicates
            and all(
                message.status in self.TERMINAL
                for message in self.messages.values()
            )
        )

    # --------------------------------------------------
    # SNAPSHOT
    # --------------------------------------------------

    def snapshot(self):
        return {
            "time": self.simulation_time,
            "mode": self.mode,
            "finished": self.is_finished(),
            "network": self.network.to_dict(),
            "messages": [
                message.to_dict()
                for message in self.messages.values()
            ],
            "statistics": self.statistics(),
            "events": self.event_log[:30],
        }

    # --------------------------------------------------
    # RESET
    # --------------------------------------------------

    def reset(self):
        # Keep the configured mode and capacities across resets.
        self.__init__(
            self.mode,
            self.link_capacity,
            self.contact_plan,
            self.buffer_capacity,
        )
        return self.snapshot()

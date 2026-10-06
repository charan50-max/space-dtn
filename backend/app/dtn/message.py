from dataclasses import dataclass, field, asdict
from hashlib import sha256
from typing import Any, Dict, List, Optional


@dataclass
class DTNMessage:
    id: str
    source: str
    destination: str
    payload: str

    priority_score: float = 50.0
    priority_class: str = "NORMAL"
    priority_probability: Optional[float] = None
    priority_confidence: Optional[float] = None
    priority_threshold: Optional[float] = None
    priority_model: Optional[str] = None

    telemetry: Dict[str, Any] = field(default_factory=dict)

    ttl: int = 30
    created_at: int = 0

    current_node: Optional[str] = None

    status: str = "queued"

    hops: int = 0
    delay: int = 0

    payload_hash: str = field(init=False)

    integrity_verified: bool = False
    duplicate_detected: bool = False

    # Transport metadata. The current DTN simulation keeps payload bytes
    # represented by the original payload string; these fields expose the
    # processing state without changing the existing routing semantics.
    compression: str = "none"
    encrypted: bool = False

    # Reliability metadata.
    # bundle_id groups an original message with its retransmitted copies.
    # A copy has its own unique id but the same bundle_id, so the
    # destination can recognise it as a duplicate.
    bundle_id: Optional[str] = None
    copy_of: Optional[str] = None
    tampered: bool = False
    reject_reason: Optional[str] = None

    # Journey metadata (used for latency / resilience metrics).
    #   route         : nodes visited so far, starting at the source
    #   path_latency  : sum of link latencies (ms) over the hops taken
    #   stored_ticks  : ticks spent stored because NO route was usable
    #   queued_ticks  : ticks spent waiting because a link or the next
    #                   node's buffer was full
    route: List[str] = field(default_factory=list)
    path_latency: int = 0
    stored_ticks: int = 0
    queued_ticks: int = 0
    reroute_reason: Optional[str] = None
    avoided_link: Optional[str] = None
    last_decision: Optional[str] = None
    reroute_seq: int = 0

    # Urgency label from the dataset (an anomaly-derived urgency PROXY, not
    # real mission urgency). It is used only to SCORE the strategies; the
    # scheduler and router never read it. None means "no label available",
    # in which case metrics fall back to the predicted priority_class.
    true_urgent: Optional[bool] = None

    # Spray-and-wait token count (replication budget carried by this copy).
    # None for the non-opportunistic strategies.
    copies_left: Optional[int] = None

    # Reliability features (Phase 5).
    #   seq_no                  : per-source monotonic sequence counter
    #   custody_holder          : current custodian node responsible for storage
    #   custody_acked           : whether downstream node acknowledged custody
    #   custody_retransmissions : count of retried forwardings by custodian
    seq_no: Optional[int] = None
    custody_holder: Optional[str] = None
    custody_acked: bool = False
    custody_retransmissions: int = 0

    TAMPER_SUFFIX = " [corrupted in transit]"

    def __post_init__(self):
        self.payload_hash = self.calculate_hash()

        if self.bundle_id is None:
            self.bundle_id = self.id

        if self.current_node is None:
            self.current_node = self.source

        if self.custody_holder is None:
            self.custody_holder = self.source

        if not self.route:
            self.route = [self.current_node]

    def calculate_hash(self) -> str:
        return sha256(
            self.payload.encode("utf-8")
        ).hexdigest()

    def verify_integrity(self) -> bool:
        calculated_hash = self.calculate_hash()

        self.integrity_verified = (
            calculated_hash == self.payload_hash
        )

        return self.integrity_verified

    def tamper(self) -> None:
        """
        Corrupt the payload in transit. The stored SHA-256 hash is left
        untouched, so verification at the destination must fail.
        """
        if self.tampered:
            return

        self._clean_payload = self.payload
        self.payload = self.payload + self.TAMPER_SUFFIX
        self.tampered = True

    def clean_payload(self) -> str:
        """The payload as originally sent (before any corruption)."""
        return getattr(self, "_clean_payload", self.payload)

    def to_dict(self):
        data = asdict(self)
        # Hash of the payload as it exists now. It differs from
        # payload_hash only if the payload was corrupted.
        data["computed_hash"] = self.calculate_hash()
        data["route_path"] = list(self.route)
        return data

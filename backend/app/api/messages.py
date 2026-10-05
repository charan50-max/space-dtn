from typing import Optional

from fastapi import APIRouter
from pydantic import BaseModel, Field

from backend.app.services.priority_service import (
    priority_service,
)

from backend.app.services.simulation_service import (
    simulation_service,
)


router = APIRouter(
    prefix="/api/messages",
    tags=["Messages"],
)


# ============================================================
# PRIORITY PREDICTION REQUEST
# ============================================================

class PriorityRequest(BaseModel):

    # --------------------------------------------------------
    # Existing DTN message-priority fields
    # --------------------------------------------------------

    severity: str = "normal"

    mission_critical: bool = False

    ttl: int = Field(
        default=30,
        ge=1
    )

    anomaly: bool = False

    # --------------------------------------------------------
    # TinyML telemetry features
    #
    # These MUST match the feature order used during training:
    #
    # value
    # sampling
    # channel_id
    # z_score
    # abs_z_score
    # delta_value
    # abs_delta
    # rolling_mean_5
    # rolling_std_5
    #
    # Optional is intentional:
    # If telemetry is not supplied, PriorityService can use
    # its lightweight fallback instead of inventing features.
    # --------------------------------------------------------

    value: Optional[float] = None

    sampling: Optional[float] = None

    channel_id: Optional[int] = None

    z_score: Optional[float] = None

    abs_z_score: Optional[float] = None

    delta_value: Optional[float] = None

    abs_delta: Optional[float] = None

    rolling_mean_5: Optional[float] = None

    rolling_std_5: Optional[float] = None


# ============================================================
# CREATE MESSAGE REQUEST
# ============================================================

class CreateMessageRequest(BaseModel):

    # --------------------------------------------------------
    # DTN message fields
    # --------------------------------------------------------

    simulation_id: str = "default"

    source: str

    destination: str

    payload: str

    severity: str = "normal"

    mission_critical: bool = False

    ttl: int = Field(
        default=30,
        ge=1
    )

    anomaly: bool = False

    # --------------------------------------------------------
    # TinyML telemetry features
    #
    # These allow normal DTN message creation to also use the
    # TinyML priority engine when telemetry is available.
    # --------------------------------------------------------

    value: Optional[float] = None

    sampling: Optional[float] = None

    channel_id: Optional[int] = None

    z_score: Optional[float] = None

    abs_z_score: Optional[float] = None

    delta_value: Optional[float] = None

    abs_delta: Optional[float] = None

    rolling_mean_5: Optional[float] = None

    rolling_std_5: Optional[float] = None


# ============================================================
# PREDICT PRIORITY
# ============================================================

@router.post("/predict")
def predict_priority(
    request: PriorityRequest
):
    """
    Predict DTN message priority using the TinyML engine.

    If all nine telemetry features are supplied, they are
    forwarded to the trained TFLite model.

    If telemetry features are not supplied, PriorityService
    can use its lightweight fallback policy.
    """

    data = request.model_dump(
        exclude_none=True
    )

    return priority_service.predict(
        data
    )


# ============================================================
# CREATE DTN MESSAGE
# ============================================================

@router.post("")
def create_message(
    request: CreateMessageRequest
):

    # --------------------------------------------------------
    # Convert request to dictionary while preserving all
    # supplied telemetry features.
    # --------------------------------------------------------

    data = request.model_dump(
        exclude_none=True
    )

    # --------------------------------------------------------
    # Run TinyML priority prediction
    # --------------------------------------------------------

    prediction = priority_service.predict(
        data
    )

    # --------------------------------------------------------
    # Add message to DTN simulation
    # --------------------------------------------------------

    message = simulation_service.add_message(
        simulation_id=request.simulation_id,
        source=request.source,
        destination=request.destination,
        payload=request.payload,
        priority_score=prediction["priority_score"],
        priority_class=prediction["priority_class"],
        ttl=request.ttl,
        telemetry={
            feature: data[feature]
            for feature in (
                "value",
                "sampling",
                "channel_id",
                "z_score",
                "abs_z_score",
                "delta_value",
                "abs_delta",
                "rolling_mean_5",
                "rolling_std_5",
            )
            if feature in data
        },
        priority_probability=prediction.get(
            "priority_probability"
        ),
        priority_confidence=prediction.get(
            "confidence"
        ),
        priority_threshold=prediction.get(
            "threshold"
        ),
        priority_model=prediction.get(
            "model_type"
        ),
    )

    return {
        "prediction": prediction,
        "message": message,
    }


# ============================================================
# GET MESSAGES
# ============================================================

@router.get("")
def get_messages(
    simulation_id: str = "default"
):

    state = simulation_service.snapshot(
        simulation_id
    )

    return {
        "messages": state["messages"]
    }
import os
from pathlib import Path


BASE_DIR = Path(__file__).resolve().parents[3]

BACKEND_DIR = BASE_DIR / "backend"
TINYML_DIR = BASE_DIR / "tinyml"
MODEL_DIR = TINYML_DIR / "models"
EVALUATION_DIR = BASE_DIR / "evaluation" / "outputs"

APP_NAME = "Space DTN - Disruption Tolerant Space Data Routing Engine"

FRONTEND_URL = os.getenv(
    "FRONTEND_URL",
    "http://localhost:5173"
)

ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
]

if FRONTEND_URL not in ALLOWED_ORIGINS:
    ALLOWED_ORIGINS.append(FRONTEND_URL)

MODEL_PATH = MODEL_DIR / "priority_model.joblib"
MODEL_METADATA_PATH = MODEL_DIR / "model_metadata.json"

METRICS_PATH = EVALUATION_DIR / "metrics.json"

DEFAULT_SIMULATION_ID = "default"
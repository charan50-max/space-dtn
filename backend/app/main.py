from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from backend.app.api.traffic import router as traffic_router
from backend.app.core.config import (
    ALLOWED_ORIGINS,
    APP_NAME,
)

from backend.app.api import (
    simulation,
    messages,
    network,
    ml,
)


app = FastAPI(
    title=APP_NAME,
    version="1.0.0",
    description=(
        "Disruption Tolerant Space Data "
        "Routing & Priority Engine"
    ),
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_origin_regex=r"https://.*\.vercel\.app",
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(
    simulation.router
)

app.include_router(traffic_router)
app.include_router(
    messages.router
)

app.include_router(
    network.router
)

app.include_router(
    ml.router
)


@app.get("/")
def root():

    return {
        "name": APP_NAME,
        "status": "online",
        "version": "1.0.0",
    }


@app.get("/health")
def health():

    return {
        "status": "healthy"
    }
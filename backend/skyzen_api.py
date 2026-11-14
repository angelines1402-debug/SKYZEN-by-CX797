import asyncio
import random
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

if __package__:
    from .wellness_engine import (
        DEMO_THRESHOLDS,
        analyse_passenger,
        generate_wellness_plans,
    )
else:
    from wellness_engine import (
        DEMO_THRESHOLDS,
        analyse_passenger,
        generate_wellness_plans,
    )


# =====================================================
# 1. PROJECT CONFIGURATION
# =====================================================

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

FLIGHT_ID = "CX251"
UPDATE_INTERVAL = 2
HISTORY_LIMIT = 60

# Prototype demonstration thresholds only.
# These are NOT clinically validated medical criteria.

THRESHOLDS = {
    "hrv": {
        "min": DEMO_THRESHOLDS["hrv_low"],
        "max": DEMO_THRESHOLDS["hrv_high"],
    },
    "spo2": {
        "min": DEMO_THRESHOLDS["spo2_low"],
        "max": DEMO_THRESHOLDS["spo2_high"],
    },
}

LIVE_SEATS = ["2A", "2K"]
PATRICIA_NAUSEA_START_TICK = 8


# =====================================================
# 2. INITIAL PASSENGER DATA
# =====================================================

initial_passengers = {
    "2A": {
        "passenger_id": "P001",
        "name": "Patricia",
        "hrv": 55,
        "spo2": 98,
        "reported_symptom": None,
    },
    "2K": {
        "passenger_id": "P002",
        "name": "Mr. Tanaka",
        "hrv": 36,
        "spo2": 97,
        "reported_symptom": "fatigue",
    },
    "3D": {
        "passenger_id": "P003",
        "name": "Ms. Larsson",
        "hrv": 36,
        "spo2": 97,
    },
    "4F": {
        "passenger_id": "P004",
        "name": "Mr. Okafor",
        "hrv": 58,
        "spo2": 98,
    },
    "5C": {
        "passenger_id": "P005",
        "name": "Ms. Dubois",
        "hrv": 48,
        "spo2": 96,
    },
    "6A": {
        "passenger_id": "P006",
        "name": "Mr. Chen",
        "hrv": 62,
        "spo2": 99,
    },
}


live_data = {}
history = {}

simulation_running = True
simulation_task = None
simulation_tick = 0


def reset_data():
    """Restore all six passengers to their initial readings."""

    global live_data, history, simulation_tick

    live_data = {
        seat: passenger.copy()
        for seat, passenger in initial_passengers.items()
    }

    history = {
        seat: deque(maxlen=HISTORY_LIMIT)
        for seat in live_data
    }

    simulation_tick = 0


reset_data()


# =====================================================
# 3. THRESHOLD AND PRIORITY ENGINE
# =====================================================

def get_threshold_status(metric, value):

    threshold = THRESHOLDS[metric]

    if value < threshold["min"]:
        return "LOW"

    if value > threshold["max"]:
        return "HIGH"

    return "NORMAL"


def get_priority(readings):
    """Prototype demonstration priority, not medical triage."""

    statuses = [
        readings["hrv"]["status"],
        readings["spo2"]["status"],
    ]

    if readings["spo2"]["status"] == "LOW":
        return "High"

    if any(status != "NORMAL" for status in statuses):
        return "Medium"

    return "Normal"


# =====================================================
# 4. LIVE SIMULATION
# =====================================================

def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


def generate_patricia_reading(passenger, tick):
    """Patricia starts well and reports nausea after eight simulation ticks."""

    passenger["hrv"] += random.randint(-1, 1)
    passenger["spo2"] += random.choice([-1, 0, 0, 0, 1])

    passenger["hrv"] = clamp(passenger["hrv"], 48, 62)
    passenger["spo2"] = clamp(passenger["spo2"], 96, 100)
    passenger["reported_symptom"] = (
        "nausea" if tick >= PATRICIA_NAUSEA_START_TICK else None
    )


def generate_tanaka_reading(passenger):
    """Mr. Tanaka reports fatigue from the start; readings stay in the demo range."""

    passenger["hrv"] = 36 + random.randint(-2, 2)
    passenger["spo2"] = 97 + random.randint(-1, 1)
    passenger["reported_symptom"] = "fatigue"


def update_live_passengers():
    """Update only the two live passengers."""

    global simulation_tick

    simulation_tick += 1

    generate_patricia_reading(live_data["2A"], simulation_tick)
    generate_tanaka_reading(live_data["2K"])


# =====================================================
# 5. PROCESS AND FORMAT PASSENGER DATA
# =====================================================

def process_passenger(seat, passenger, timestamp):

    readings = {
        "hrv": {
            "value": passenger["hrv"],
            "unit": "ms",
            "status": get_threshold_status(
                "hrv", passenger["hrv"]
            ),
            "timestamp": timestamp,
        },

        "spo2": {
            "value": passenger["spo2"],
            "unit": "%",
            "status": get_threshold_status(
                "spo2", passenger["spo2"]
            ),
            "timestamp": timestamp,
        },

    }

    priority = get_priority(readings)

    flags = []

    if readings["hrv"]["status"] != "NORMAL":
        flags.append(
            f"HRV {passenger['hrv']} ms"
        )

    if readings["spo2"]["status"] != "NORMAL":
        flags.append(
            f"SpO2 {passenger['spo2']}%"
        )

    data_source = (
        "LIVE_SIMULATION"
        if seat in LIVE_SEATS
        else "PREDEFINED_PROFILE"
    )

    return {
        "passenger_id": passenger["passenger_id"],
        "seat": seat,
        "name": passenger["name"],
        "priority": priority,
        "hrv": readings["hrv"],
        "spo2": readings["spo2"],
        "reported_symptom": passenger.get("reported_symptom"),
        "flags": flags,
        "data_source": data_source,
    }


# =====================================================
# 6. UPDATE AND RETRIEVE PASSENGER DATA
# =====================================================

def update_all_passengers():
    """Update live passengers and record all six passengers."""

    timestamp = datetime.now(timezone.utc).isoformat()

    update_live_passengers()

    for seat, passenger in live_data.items():

        processed = process_passenger(
            seat,
            passenger,
            timestamp
        )

        history[seat].append(processed)

    return timestamp


def get_snapshot():
    """Return all six passengers."""

    timestamp = datetime.now(timezone.utc).isoformat()

    passengers = []

    for seat, passenger in live_data.items():

        passengers.append(
            process_passenger(
                seat,
                passenger,
                timestamp
            )
        )

    return {
        "flight_id": FLIGHT_ID,
        "timestamp": timestamp,
        "simulation_running": simulation_running,
        "live_passengers": LIVE_SEATS,
        "total_passengers": len(passengers),
        "passengers": passengers,
    }


# =====================================================
# 7. BACKGROUND SIMULATION
# =====================================================

async def simulation_loop():

    while True:

        if simulation_running:
            update_all_passengers()

        await asyncio.sleep(UPDATE_INTERVAL)


@asynccontextmanager
async def lifespan(app: FastAPI):

    global simulation_task

    simulation_task = asyncio.create_task(simulation_loop())

    yield

    simulation_task.cancel()

    try:
        await simulation_task
    except asyncio.CancelledError:
        pass


# =====================================================
# 8. FASTAPI APPLICATION
# =====================================================

app = FastAPI(
    title="SkyZen Biomarker API",
    description="Simulated in-flight passenger wellness data",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount(
    "/static",
    StaticFiles(directory=FRONTEND_DIR),
    name="static",
)


# =====================================================
# 9. API ENDPOINTS
# =====================================================

@app.get("/passenger", include_in_schema=False)
def passenger_page():
    return FileResponse(FRONTEND_DIR / "passenger" / "passenger.html")


@app.get("/crew", include_in_schema=False)
def crew_page():
    return FileResponse(FRONTEND_DIR / "crew" / "crew.html")


@app.get("/")
def home():

    return {
        "message": "SkyZen Biomarker API is running",
        "flight_id": FLIGHT_ID,
        "total_passengers": len(live_data),
        "live_passengers": LIVE_SEATS,
    }


@app.get("/health")
def health():

    return {
        "status": "online",
        "simulation_running": simulation_running,
    }


@app.get("/snapshot")
def snapshot():

    return get_snapshot()


@app.get("/wellness")
def wellness_all(
    flight_phase: Literal["boarding", "climb", "cruise", "descent"] | None = None,
):
    timestamp = datetime.now(timezone.utc).isoformat()
    passengers = [
        process_passenger(seat, passenger, timestamp)
        for seat, passenger in live_data.items()
    ]
    contexts = (
        {seat: {"flight_phase": flight_phase} for seat in live_data}
        if flight_phase is not None
        else None
    )

    return {
        "flight_id": FLIGHT_ID,
        "timestamp": timestamp,
        "passengers": generate_wellness_plans(passengers, contexts),
    }


@app.get("/wellness/{seat}")
def wellness_detail(
    seat: str,
    symptom: Literal["fatigue", "nausea"] | None = None,
    flight_phase: Literal["boarding", "climb", "cruise", "descent"] | None = None,
):
    seat = seat.upper()

    if seat not in live_data:
        raise HTTPException(
            status_code=404,
            detail="Passenger seat not found",
        )

    passenger = process_passenger(
        seat,
        live_data[seat],
        datetime.now(timezone.utc).isoformat(),
    )
    context = {}
    selected_symptom = symptom or live_data[seat].get("reported_symptom")
    if selected_symptom is not None:
        context["symptom"] = selected_symptom
    if flight_phase is not None:
        context["flight_phase"] = flight_phase

    return analyse_passenger(passenger, context or None)


@app.get("/passengers/{seat}")
def passenger_detail(seat: str):

    seat = seat.upper()

    if seat not in live_data:
        raise HTTPException(
            status_code=404,
            detail="Passenger seat not found",
        )

    return process_passenger(
        seat,
        live_data[seat],
        datetime.now(timezone.utc).isoformat(),
    )


@app.get("/history/{seat}")
def passenger_history(seat: str):

    seat = seat.upper()

    if seat not in history:
        raise HTTPException(
            status_code=404,
            detail="Passenger seat not found",
        )

    return {
        "seat": seat,
        "history": list(history[seat]),
    }


@app.post("/simulation/stop")
def stop_simulation():

    global simulation_running

    simulation_running = False

    return {"message": "Simulation stopped"}


@app.post("/simulation/start")
def start_simulation():

    global simulation_running

    simulation_running = True

    return {"message": "Simulation started"}


@app.post("/simulation/reset")
def reset_simulation():

    reset_data()

    return {
        "message": "Simulation reset",
        "passengers": list(live_data.keys()),
        "live_passengers": LIVE_SEATS,
    }


# =====================================================
# 10. RUN DIRECTLY
# =====================================================

if __name__ == "__main__":
    import uvicorn

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        reload=False,
    )

import asyncio
import random
from collections import deque
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

try:
    from backend.wellness_engine import generate_wellness_plans
except ModuleNotFoundError:
    from wellness_engine import generate_wellness_plans


# =====================================================
# 1. PROJECT CONFIGURATION
# =====================================================

FLIGHT_ID = "CX251"
UPDATE_INTERVAL = 2
HISTORY_LIMIT = 60

# Prototype demonstration thresholds only.
# These are NOT clinically validated medical criteria.

THRESHOLDS = {
    "hrv": {"min": 40, "max": 100},
    "spo2": {"min": 94, "max": 100},
    "sys": {"min": 90, "max": 139},
    "dia": {"min": 60, "max": 89},
}

LIVE_SEATS = ["2A", "2K"]


# =====================================================
# 2. INITIAL PASSENGER DATA
# =====================================================

initial_passengers = {
    "2A": {
        "passenger_id": "P001",
        "name": "Patricia",
        "hrv": 55,
        "spo2": 98,
        "sys": 120,
        "dia": 80,
    },
    "2K": {
        "passenger_id": "P002",
        "name": "Mr. Tanaka",
        "hrv": 52,
        "spo2": 97,
        "sys": 122,
        "dia": 80,
    },
    "3D": {
        "passenger_id": "P003",
        "name": "Ms. Larsson",
        "hrv": 36,
        "spo2": 97,
        "sys": 120,
        "dia": 78,
    },
    "4F": {
        "passenger_id": "P004",
        "name": "Mr. Okafor",
        "hrv": 58,
        "spo2": 98,
        "sys": 130,
        "dia": 84,
    },
    "5C": {
        "passenger_id": "P005",
        "name": "Ms. Dubois",
        "hrv": 48,
        "spo2": 96,
        "sys": 118,
        "dia": 76,
    },
    "6A": {
        "passenger_id": "P006",
        "name": "Mr. Chen",
        "hrv": 62,
        "spo2": 99,
        "sys": 116,
        "dia": 74,
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
        readings["blood_pressure"]["status_systolic"],
        readings["blood_pressure"]["status_diastolic"],
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


def generate_patricia_reading(passenger):
    """Patricia: stable readings with small fluctuations."""

    passenger["hrv"] += random.randint(-1, 1)
    passenger["spo2"] += random.choice([-1, 0, 0, 0, 1])
    passenger["sys"] += random.randint(-1, 1)
    passenger["dia"] += random.randint(-1, 1)

    passenger["hrv"] = clamp(passenger["hrv"], 48, 62)
    passenger["spo2"] = clamp(passenger["spo2"], 96, 100)
    passenger["sys"] = clamp(passenger["sys"], 116, 126)
    passenger["dia"] = clamp(passenger["dia"], 76, 84)


def generate_tanaka_reading(passenger, tick):
    """
    Mr. Tanaka: controlled demonstration scenario.

    Ticks 0-7: Stable
    Ticks 8-19: Simulated wellness alert
    Ticks 20-29: Recovery
    Ticks 30-39: Stable

    One tick = 2 seconds.
    The 40-tick scenario then repeats.
    """

    phase = tick % 40

    if phase < 8:
        # Stable
        passenger["hrv"] = 52 + random.randint(-2, 2)
        passenger["spo2"] = 97 + random.randint(-1, 1)
        passenger["sys"] = 122 + random.randint(-2, 2)
        passenger["dia"] = 80 + random.randint(-1, 1)

    elif phase < 20:
        # Simulated wellness alert
        passenger["hrv"] = 35 + random.randint(-2, 2)
        passenger["spo2"] = 91 + random.randint(-1, 1)
        passenger["sys"] = 132 + random.randint(-2, 2)
        passenger["dia"] = 84 + random.randint(-1, 1)

    elif phase < 30:
        # Recovery
        passenger["hrv"] = 48 + random.randint(-2, 2)
        passenger["spo2"] = 96 + random.randint(-1, 1)
        passenger["sys"] = 124 + random.randint(-2, 2)
        passenger["dia"] = 81 + random.randint(-1, 1)

    else:
        # Stable again
        passenger["hrv"] = 54 + random.randint(-2, 2)
        passenger["spo2"] = 98 + random.randint(-1, 1)
        passenger["sys"] = 120 + random.randint(-2, 2)
        passenger["dia"] = 79 + random.randint(-1, 1)


def update_live_passengers():
    """Update only the two live passengers."""

    global simulation_tick

    simulation_tick += 1

    generate_patricia_reading(live_data["2A"])
    generate_tanaka_reading(
        live_data["2K"],
        simulation_tick
    )


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

        "blood_pressure": {
            "systolic": passenger["sys"],
            "diastolic": passenger["dia"],
            "unit": "mmHg",
            "status_systolic": get_threshold_status(
                "sys", passenger["sys"]
            ),
            "status_diastolic": get_threshold_status(
                "dia", passenger["dia"]
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

    if readings["blood_pressure"]["status_systolic"] != "NORMAL":
        flags.append("Systolic BP outside demo range")

    if readings["blood_pressure"]["status_diastolic"] != "NORMAL":
        flags.append("Diastolic BP outside demo range")

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
        "blood_pressure": readings["blood_pressure"],
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


# =====================================================
# 9. API ENDPOINTS
# =====================================================

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
def wellness_all():
    """Generate wellness plans for all six passengers."""

    snapshot_data = get_snapshot()

    plans = generate_wellness_plans(
        snapshot_data["passengers"]
    )

    return {
        "flight_id": FLIGHT_ID,
        "timestamp": snapshot_data["timestamp"],
        "total_passengers": len(plans),
        "plans": plans,
    }


@app.get("/wellness/{seat}")
def wellness_detail(seat: str):
    """Generate a wellness plan for one passenger."""

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

    plans = generate_wellness_plans([passenger])

    return plans[seat]


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

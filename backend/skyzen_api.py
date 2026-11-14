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
from pydantic import BaseModel

if __package__:
    from .wellness_engine import (
        DEMO_THRESHOLDS,
        analyse_passenger,
        build_schedule,
        generate_wellness_plans,
    )
else:
    from wellness_engine import (
        DEMO_THRESHOLDS,
        analyse_passenger,
        build_schedule,
        generate_wellness_plans,
    )


# =====================================================
# 1. PROJECT CONFIGURATION
# =====================================================

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

FLIGHT_ID = "CX844"
FLIGHT_DEPARTURE_TIME = datetime.now(timezone.utc)
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
CATHERINE_NAUSEA_START_TICK = 8


class CoffeeDecisionRequest(BaseModel):
    decision: Literal["yes", "no"]


class TCMDrinkDecisionRequest(BaseModel):
    decision: Literal["yes", "no"]
    drink: Literal[
        "Harmony Tea 陳皮菊花茶",
        "Evening Calm 酸棗仁百合紅棗茶",
        "Morning Revive 黃耆紅棗枸杞茶",
    ] | None = None


class MealPrepDecisionRequest(BaseModel):
    decision: Literal["yes", "no"]


# =====================================================
# 2. INITIAL PASSENGER DATA
# =====================================================

initial_passengers = {
    "2A": {
        "passenger_id": "P001",
        "name": "Catherine",
        "hrv": 55,
        "spo2": 98,
        "reported_symptom": None,
        "sleep_plan": {
            "dinner_hours_after_departure": 4,
            "sleep_start_hours_after_departure": 6.5,
            "sleep_duration_hours": 6,
            "biomarker_reminder_minutes_before_sleep": 30,
        },
    },
    "2K": {
        "passenger_id": "P002",
        "name": "Ms. Stella",
        "hrv": 36,
        "spo2": 97,
        "reported_symptom": "fatigue",
        "sleep_plan": {
            "sleep_start_hours_after_departure": 5,
            "sleep_duration_hours": 9,
        },
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
coffee_decisions = {}
cabin_coffee_orders = {}
tcm_drink_decisions = {}
cabin_tcm_orders = {}
meal_prep_decisions = {}

simulation_running = True
simulation_task = None
simulation_tick = 0


def reset_data():
    """Restore all six passengers to their initial readings."""

    global live_data, history, simulation_tick
    global coffee_decisions, cabin_coffee_orders
    global tcm_drink_decisions, cabin_tcm_orders
    global meal_prep_decisions

    live_data = {
        seat: passenger.copy()
        for seat, passenger in initial_passengers.items()
    }

    history = {
        seat: deque(maxlen=HISTORY_LIMIT)
        for seat in live_data
    }
    coffee_decisions = {}
    cabin_coffee_orders = {}
    tcm_drink_decisions = {}
    cabin_tcm_orders = {}
    meal_prep_decisions = {}

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


def generate_catherine_reading(passenger, tick):
    """Catherine starts well and reports nausea after eight simulation ticks."""

    passenger["hrv"] += random.randint(-1, 1)
    passenger["spo2"] += random.choice([-1, 0, 0, 0, 1])

    passenger["hrv"] = clamp(passenger["hrv"], 48, 62)
    passenger["spo2"] = clamp(passenger["spo2"], 96, 100)
    passenger["reported_symptom"] = (
        "nausea" if tick >= CATHERINE_NAUSEA_START_TICK else None
    )


def generate_stella_reading(passenger):
    """Ms. Stella reports fatigue from the start; readings stay in the demo range."""

    passenger["hrv"] = 36 + random.randint(-2, 2)
    passenger["spo2"] = 97 + random.randint(-1, 1)
    passenger["reported_symptom"] = "fatigue"


def update_live_passengers():
    """Update only the two live passengers."""

    global simulation_tick

    simulation_tick += 1

    generate_catherine_reading(live_data["2A"], simulation_tick)
    generate_stella_reading(live_data["2K"])


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

    processed = {
        "flight_id": FLIGHT_ID,
        "passenger_id": passenger["passenger_id"],
        "seat": seat,
        "name": passenger["name"],
        "priority": priority,
        "hrv": readings["hrv"],
        "spo2": readings["spo2"],
        "reported_symptom": passenger.get("reported_symptom"),
        "flags": flags,
        "data_source": data_source,
        "flight_elapsed_hours": (
            datetime.now(timezone.utc) - FLIGHT_DEPARTURE_TIME
        ).total_seconds() / 3600,
        "schedule": build_schedule(passenger.get("sleep_plan")),
        "coffee_decision": coffee_decisions.get(seat),
        "tcm_drink_decision": tcm_drink_decisions.get(seat),
        "meal_prep_decision": meal_prep_decisions.get(seat),
    }
    if "sleep_plan" in passenger:
        processed["sleep_plan"] = passenger["sleep_plan"].copy()

    return processed


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
    return FileResponse(FRONTEND_DIR / "passenger" / "dashboard4.html")


@app.get("/crew", include_in_schema=False)
def crew_page():
    return FileResponse(FRONTEND_DIR / "passenger" / "crewview.html")


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


@app.get("/crew/requests")
def crew_coffee_requests():
    return {
        "requests": [
            *cabin_coffee_orders.values(),
            *cabin_tcm_orders.values(),
        ],
    }


@app.post("/crew/meal-prep/{seat}")
def crew_meal_prep_decision(
    seat: str,
    payload: MealPrepDecisionRequest,
):
    seat = seat.upper()
    if seat not in live_data:
        raise HTTPException(status_code=404, detail="Passenger seat not found")

    existing_decision = meal_prep_decisions.get(seat)
    if existing_decision is not None:
        return existing_decision

    dinner = next(
        (
            event for event in build_schedule(live_data[seat].get("sleep_plan"))
            if event["type"] == "dinner"
        ),
        None,
    )
    elapsed_hours = (
        datetime.now(timezone.utc) - FLIGHT_DEPARTURE_TIME
    ).total_seconds() / 3600
    if (
        dinner is None
        or dinner["hour"] < 0.5
        or elapsed_hours < dinner["hour"] - 0.5
        or elapsed_hours >= dinner["hour"]
    ):
        raise HTTPException(
            status_code=409,
            detail="The meal-prep action is outside its scheduled 30-minute window.",
        )

    meal_prep_decision = {
        "seat": seat,
        "name": live_data[seat]["name"],
        "decision": payload.decision,
        "meal_hour": dinner["hour"],
        "decided_at": datetime.now(timezone.utc).isoformat(),
        "oven": "Oven A",
        "oven_status": (
            "Simulated preheating"
            if payload.decision == "yes"
            else "Not preheated"
        ),
        "demo_only": True,
    }
    meal_prep_decisions[seat] = meal_prep_decision
    return meal_prep_decision


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


@app.post("/passengers/{seat}/coffee")
def passenger_coffee_decision(seat: str, payload: CoffeeDecisionRequest):
    seat = seat.upper()
    if seat not in live_data:
        raise HTTPException(
            status_code=404,
            detail="Passenger seat not found",
        )

    existing_decision = coffee_decisions.get(seat)
    if existing_decision is not None:
        return existing_decision

    order = None
    if payload.decision == "yes":
        cutoff = next(
            (
                event for event in build_schedule(
                    live_data[seat].get("sleep_plan")
                )
                if event["type"] == "caffeine_cutoff"
            ),
            None,
        )
        if cutoff is None or cutoff["hour"] < 0:
            raise HTTPException(
                status_code=409,
                detail="The coffee request window is before CX844 departure.",
            )

        elapsed_hours = (
            datetime.now(timezone.utc) - FLIGHT_DEPARTURE_TIME
        ).total_seconds() / 3600
        if elapsed_hours < cutoff["hour"]:
            raise HTTPException(
                status_code=409,
                detail="The coffee request window has not opened yet.",
            )
        if elapsed_hours >= cutoff["hour"] + cutoff["window_hours"]:
            raise HTTPException(
                status_code=409,
                detail="The coffee request window has closed.",
            )

        sent_at = datetime.now(timezone.utc).isoformat()
        order = {
            "id": f"{seat}-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "seat": seat,
            "name": live_data[seat]["name"],
            "item": "Coffee",
            "request_type": "Coffee",
            "sent_at": sent_at,
            "status": "Requested",
        }
        cabin_coffee_orders[seat] = order

    decision = {
        "seat": seat,
        "decision": payload.decision,
        "decided_at": datetime.now(timezone.utc).isoformat(),
        "order": order,
    }
    coffee_decisions[seat] = decision
    return decision


@app.post("/passengers/{seat}/tcm-drink")
def passenger_tcm_drink_decision(
    seat: str,
    payload: TCMDrinkDecisionRequest,
):
    seat = seat.upper()
    if seat not in live_data:
        raise HTTPException(status_code=404, detail="Passenger seat not found")

    existing_decision = tcm_drink_decisions.get(seat)
    if existing_decision is not None:
        return existing_decision

    schedule = build_schedule(live_data[seat].get("sleep_plan"))
    tcm_event = next(
        (event for event in schedule if event["type"] == "tcm_drink"),
        None,
    )
    sleep_start = next(
        (event for event in schedule if event["type"] == "sleep_start"),
        None,
    )
    elapsed_hours = (
        datetime.now(timezone.utc) - FLIGHT_DEPARTURE_TIME
    ).total_seconds() / 3600
    if (
        tcm_event is None
        or sleep_start is None
        or elapsed_hours < tcm_event["hour"]
        or elapsed_hours >= sleep_start["hour"]
    ):
        raise HTTPException(
            status_code=409,
            detail="The TCM drink request is outside its scheduled window.",
        )

    order = None
    if payload.decision == "yes":
        if payload.drink is None:
            raise HTTPException(
                status_code=422,
                detail="Choose a TCM drink before ordering.",
            )
        sent_at = datetime.now(timezone.utc).isoformat()
        order = {
            "id": f"{seat}-tcm-{int(datetime.now(timezone.utc).timestamp() * 1000)}",
            "seat": seat,
            "name": live_data[seat]["name"],
            "item": payload.drink,
            "request_type": "TCM drink",
            "sent_at": sent_at,
            "status": "Requested",
        }
        cabin_tcm_orders[seat] = order

    decision = {
        "seat": seat,
        "decision": payload.decision,
        "decided_at": datetime.now(timezone.utc).isoformat(),
        "order": order,
    }
    tcm_drink_decisions[seat] = decision
    return decision


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

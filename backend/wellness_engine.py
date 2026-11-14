
"""
SkyZen Wellness Engine
Rule-based prototype for passenger wellness plans and crew recommendations.

Uses:
- HRV (ms)
- SpO2 (%)

This is a demonstration system, not a medical diagnostic tool.
"""

DEMO_THRESHOLDS = {
    "hrv_low": 40,
    "hrv_high": 100,
    "spo2_low": 94,
    "spo2_high": 100,
}

RESTORE_MENU = [
    {
        "id": "F1",
        "name": "Hong Kong-style king prawn and silken egg ribbons on jasmine rice",
        "description": "Prawns, eggs, jasmine rice, choy sum, ginger broth",
        "tag": "Restful Evening, Body Wind Down",
    },
    {
        "id": "F2",
        "name": "Maple-glazed roasted turkey tenderloin",
        "description": "Sweet potato, green beans, walnuts, cranberry, sage jus",
        "tag": "Improve Sleep Quality"
    },
    {
        "id": "F3",
        "name": "Claypot brown rice with pumpkin, shiitake and lotus seed (vegetarian)",
        "description": (
            "Brown rice, sweet pumpkin, shiitake mushrooms, lotus seeds, "
            "silken tofu, pumpkin seeds, ginger"
        ),
        "tag": "Restful Evening, Body Wind Down",
    },
]

GENTLE_MENU = [
    {
        "id": "N1",
        "name": "Cantonese steamed wild cod",
        "description": "Ginger, spring onion, soy broth, jasmine rice, choy sum",
        "tag": "Soothe Stomach before Sleep",
    },
    {
        "id": "N2",
        "name": "Poached Hokkaido scallops",
        "description": (
            "Scallops, sweet corn, potato purée, asparagus, lemon-thyme broth"
        ),
        "tag": "Soothe Stomach before Sleep",
    },
    {
        "id": "N3",
        "name": "Pan-roasted tofu and shiitake mushrooms (vegetarian)",
        "description": "Brown rice, spinach, sesame, pumpkin seeds",
        "tag": "Gentle Wind-Down, Support Relaxation",
    },
]

MENU_BY_SYMPTOM = {
    "fatigue": "RESTORE",
    "nausea": "GENTLE",
}

FLIGHT_PHASES = ("boarding", "climb", "cruise", "descent")

MEAL_HOURS_BEFORE_SLEEP = 1
CAFFEINE_CUTOFF_HOURS_BEFORE_SLEEP = 6
COFFEE_REQUEST_WINDOW_HOURS = 0.25
SLEEP_RECOMMENDATION_HOURS_BEFORE_SLEEP = 2.5
TCM_DRINK_HOURS_BEFORE_SLEEP = 1

PHASE_ACTIONS = {
    "boarding": {
        "passenger": "Settle in and follow crew instructions while boarding.",
        "crew": "Offer comfort assistance when it does not interfere with boarding.",
    },
    "climb": {
        "passenger": "Remain seated and follow cabin crew instructions during climb.",
        "crew": "Prioritise cabin safety and defer non-essential check-ins during climb.",
    },
    "cruise": {
        "passenger": "Use the cruise phase to request any comfort assistance you need.",
        "crew": "Continue routine observation and service when operationally appropriate.",
    },
    "descent": {
        "passenger": "Prepare for landing and follow cabin crew instructions.",
        "crew": "Prioritise landing preparation and defer non-essential service.",
    },
}


def build_schedule(sleep_plan):
    """Build schedule events relative to CX844 departure."""

    if sleep_plan is None:
        return []

    sleep_start = sleep_plan["sleep_start_hours_after_departure"]
    sleep_duration = sleep_plan["sleep_duration_hours"]
    if (
        isinstance(sleep_start, bool)
        or not isinstance(sleep_start, (int, float))
        or sleep_start < 0
    ):
        raise ValueError("sleep start must be a non-negative number of flight hours")
    if (
        isinstance(sleep_duration, bool)
        or not isinstance(sleep_duration, (int, float))
        or sleep_duration <= 0
    ):
        raise ValueError("sleep duration must be a positive number of hours")

    dinner_hour = sleep_plan.get(
        "dinner_hours_after_departure",
        sleep_start - MEAL_HOURS_BEFORE_SLEEP,
    )
    events = [
        {
            "type": "dinner",
            "label": "Dinner",
            "hour": dinner_hour,
        },
        {
            "type": "caffeine_cutoff",
            "label": "Caffeine cutoff (6 hours before sleep)",
            "hour": sleep_start - CAFFEINE_CUTOFF_HOURS_BEFORE_SLEEP,
            "window_hours": COFFEE_REQUEST_WINDOW_HOURS,
        },
        {
            "type": "sleep_recommendation",
            "label": "Sleep wind-down recommendation",
            "hour": sleep_start - SLEEP_RECOMMENDATION_HOURS_BEFORE_SLEEP,
        },
        {
            "type": "tcm_drink",
            "label": "TCM drink recommendation",
            "hour": sleep_start - TCM_DRINK_HOURS_BEFORE_SLEEP,
        },
        {
            "type": "sleep_start",
            "label": "Sleep begins",
            "hour": sleep_start,
        },
        {
            "type": "wake_up",
            "label": "Wake-up",
            "hour": sleep_start + sleep_duration,
        },
    ]

    reminder_minutes = sleep_plan.get(
        "biomarker_reminder_minutes_before_sleep"
    )
    if reminder_minutes is not None:
        if (
            isinstance(reminder_minutes, bool)
            or not isinstance(reminder_minutes, (int, float))
            or reminder_minutes < 0
        ):
            raise ValueError("biomarker reminder offset must be non-negative")
        events.append({
            "type": "biomarker_reminder",
            "label": "Biomarker check-in reminder",
            "hour": sleep_start - reminder_minutes / 60,
        })

    return sorted(events, key=lambda event: event["hour"])


def analyse_passenger(passenger, context=None):
    """
    Analyse one passenger's readings.

    context is optional and can later contain:
    - turbulence_level
    - passenger_report
    - symptom (fatigue or nausea)
    - flight_phase (boarding, climb, cruise, or descent)
    """

    context = context or {}

    symptom = context.get("symptom")
    if symptom is not None:
        if not isinstance(symptom, str):
            raise ValueError("symptom must be 'fatigue' or 'nausea'")
        symptom = symptom.strip().lower()
        if symptom not in MENU_BY_SYMPTOM:
            raise ValueError("symptom must be 'fatigue' or 'nausea'")

    flight_phase = context.get("flight_phase")
    if flight_phase is not None:
        if not isinstance(flight_phase, str):
            raise ValueError("flight_phase must be a supported phase")
        flight_phase = flight_phase.strip().lower()
        if flight_phase not in FLIGHT_PHASES:
            raise ValueError(
                "flight_phase must be boarding, climb, cruise, or descent"
            )

    hrv = passenger["hrv"]["value"]
    spo2 = passenger["spo2"]["value"]

    flags = []
    passenger_actions = []
    crew_actions = []

    # 1. Analyse HRV
    if hrv < DEMO_THRESHOLDS["hrv_low"]:
        flags.append("HRV below demo range")

        passenger_actions.append(
            "Consider a quiet rest period and a comfortable seating position."
        )

        crew_actions.append(
            "Consider a discreet check-in to ask whether the passenger needs assistance."
        )
    elif hrv > DEMO_THRESHOLDS["hrv_high"]:
        flags.append("HRV above demo range")

    # 2. Analyse blood oxygen
    if spo2 < DEMO_THRESHOLDS["spo2_low"]:
        flags.append("SpO2 below demo range")
        passenger_actions.append(
            "Remain comfortably seated and allow the crew to check in."
        )
        crew_actions.append(
            "Check in with the passenger and follow appropriate onboard procedures."
        )
    elif spo2 > DEMO_THRESHOLDS["spo2_high"]:
        flags.append("SpO2 above demo range")

    if hrv > DEMO_THRESHOLDS["hrv_high"] or spo2 > DEMO_THRESHOLDS["spo2_high"]:
        crew_actions.append(
            "Consider confirming the reading and checking whether the passenger needs assistance."
        )

    # 3. Consider passenger-reported wellbeing
    passenger_report = context.get("passenger_report", "").lower()

    if (
        symptom == "fatigue"
        or "tired" in passenger_report
        or "fatigue" in passenger_report
    ):
        passenger_actions.append(
            "Offer a quieter environment and an opportunity to rest."
        )
        crew_actions.append(
            "Ask whether the passenger would appreciate reduced interruptions."
        )

    if symptom == "nausea" or "nausea" in passenger_report:
        if symptom == "nausea":
            passenger_actions.append(
                "If you would like, choose an item from the gentle menu."
            )
        crew_actions.append(
            "Ask whether the passenger needs assistance and follow onboard procedures."
        )

    if "thirsty" in passenger_report:
        passenger_actions.append(
            "Consider requesting water from the cabin crew."
        )
        crew_actions.append(
            "Offer water if available and appropriate."
        )

    if "uncomfortable" in passenger_report:
        passenger_actions.append(
            "Consider adjusting your seating position or using an available comfort item."
        )
        crew_actions.append(
            "Ask whether the passenger needs assistance with seating comfort."
        )

    # 4. Tailor comfort guidance to the explicitly selected flight phase
    if flight_phase is not None:
        passenger_actions.append(PHASE_ACTIONS[flight_phase]["passenger"])
        crew_actions.append(PHASE_ACTIONS[flight_phase]["crew"])

    # 5. Consider turbulence
    turbulence = context.get("turbulence_level", "normal").lower()

    if turbulence in ["moderate", "high"]:
        passenger_actions.append(
            "Remain seated and follow the crew's safety instructions."
        )

        crew_actions.append(
            "Prioritise cabin safety and defer non-essential service during turbulence."
        )

    # 6. Determine prototype monitoring priority
    if spo2 < DEMO_THRESHOLDS["spo2_low"]:
        priority = "High"
        status = "Crew review suggested"
    elif flags:
        priority = "Medium"
        status = "Check-in suggested"
    else:
        priority = "Normal"
        status = "Routine monitoring"

    # 7. Provide default suggestions when no flags are detected
    if not passenger_actions:
        passenger_actions.append(
            "Continue your usual in-flight comfort routine."
        )

    if not crew_actions:
        crew_actions.append(
            "Continue routine observation and offer standard cabin service."
        )

    recommended_menu = MENU_BY_SYMPTOM.get(symptom)
    available_menus = (
        list(MENU_BY_SYMPTOM.values())
        if symptom is None
        else [recommended_menu]
    )

    return {
        "seat": passenger["seat"],
        "flight_phase": flight_phase,
        "schedule": build_schedule(passenger.get("sleep_plan")),
        "priority": priority,
        "status": status,
        "flags": flags,
        "passenger_plan": {
            "title": "Your wellness suggestions",
            "actions": passenger_actions,
        },
        "crew_recommendations": {
            "title": "Suggested crew actions",
            "actions": crew_actions,
        },
        "menus": {
            "symptom": symptom,
            "recommended": recommended_menu,
            "available": available_menus,
            "recommendation_basis": (
                "Explicit symptom selection only: fatigue maps to RESTORE and "
                "nausea maps to GENTLE. With no symptom, both menus are "
                "available. Biometrics do not select a menu."
            ),
            "restore": [item.copy() for item in RESTORE_MENU],
            "gentle": [item.copy() for item in GENTLE_MENU],
        },
        "disclaimer": (
            "Prototype wellness guidance based on demonstration rules. "
            "Not a medical assessment or diagnosis."
        ),
    }


def generate_wellness_plans(passengers, context_by_seat=None):
    """
    Generate wellness outputs for multiple passengers.
    """

    context_by_seat = context_by_seat or {}
    results = {}

    for passenger in passengers:
        seat = passenger["seat"]
        context = dict(context_by_seat.get(seat, {}))
        if context.get("symptom") is None:
            reported_symptom = passenger.get("reported_symptom")
            if reported_symptom is not None:
                context["symptom"] = reported_symptom

        results[seat] = analyse_passenger(passenger, context)

    return results

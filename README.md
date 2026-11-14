# SKYZEN-by-CX797
Cathay Hackathon 2026

## Run the cabin crew dashboard

From the repository root, start the API with `python backend/skyzen_api.py`, then open
`http://localhost:8000/crew`. The dashboard reads passenger readings from `/snapshot`,
crew recommendations from `/wellness`, and passenger coffee and TCM drink requests from
`/crew/requests`, refreshing every five seconds.

The current API serves six in-memory demo passengers; only the configured live seats
are simulated. It is not connected to a persistent passenger database.

Passenger sleep schedules are configured per seat in `backend/skyzen_api.py` and
returned with the wellness plan. Schedule hours are relative to CX844 departure; for
this demo, starting the API marks departure. Meals default to one hour before sleep,
caffeine stops six hours before sleep, and the TCM drink recommendation is one hour
before sleep. A sleep wind-down recommendation appears 2.5 hours before each
passenger's planned sleep. The passenger dashboard shows schedule-driven actions:
the coffee request window opens six hours before sleep for 15 minutes, and the TCM
drink prompt opens one hour before sleep and remains available until sleep starts.
Accepting either request sends it to the crew dashboard; declining records no order.
A coffee cutoff that falls before CX844 departure (as in Stella's plan) does not offer
coffee on this flight. The TCM prompt includes a 10-second sensor guide, but this is
a demo countdown and does not read from a connected sensor. Recommendations use the
reported symptom: Evening Calm for fatigue before rest, Harmony Tea for nausea or no
reported symptom. The selectable TCM menu also includes Morning Revive before landing.
These are configurable demo scheduling rules, not individualized medical advice.
Passenger-specific dinner times and biomarker reminders can override defaults.
Schedule-driven actions appear only while the passenger dashboard is open; this demo
does not send push notifications.

The crew dashboard also shows a meal-preparation action during the 30 minutes before a
passenger's scheduled dinner. A Yes response records a simulated Oven A preheating
state; it does not connect to or control physical cabin equipment.

Coffee and TCM decisions, crew requests, and meal-preparation decisions are stored in
memory and cleared when the API restarts. The passenger dashboard submits coffee
decisions to `POST /passengers/{seat}/coffee` and TCM decisions to
`POST /passengers/{seat}/tcm-drink`; the crew dashboard polls `GET /crew/requests`.

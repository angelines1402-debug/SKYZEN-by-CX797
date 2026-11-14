from pathlib import Path
from datetime import datetime, timedelta, timezone
import unittest
from unittest.mock import patch

from fastapi import HTTPException

from backend import skyzen_api


class LivePassengerDemoTests(unittest.TestCase):
    def setUp(self):
        skyzen_api.reset_data()

    def tearDown(self):
        skyzen_api.reset_data()

    def test_initial_live_passenger_states_match_demo(self):
        passenger_a = skyzen_api.wellness_detail("2A")
        passenger_b = skyzen_api.wellness_detail("2K")

        self.assertIsNone(passenger_a["menus"]["symptom"])
        self.assertEqual(
            passenger_a["menus"]["available"],
            ["RESTORE", "GENTLE"],
        )
        self.assertEqual(passenger_b["menus"]["symptom"], "fatigue")
        self.assertEqual(passenger_b["menus"]["recommended"], "RESTORE")

    def test_passenger_sleep_plans_drive_personalized_schedule(self):
        catherine = skyzen_api.wellness_detail("2A")
        stella = skyzen_api.wellness_detail("2K")
        catherine_hours = {
            event["type"]: event["hour"] for event in catherine["schedule"]
        }
        stella_hours = {
            event["type"]: event["hour"] for event in stella["schedule"]
        }

        self.assertEqual(catherine_hours["dinner"], 4)
        self.assertEqual(catherine_hours["caffeine_cutoff"], 0.5)
        self.assertEqual(catherine_hours["tcm_drink"], 5.5)
        self.assertEqual(catherine_hours["biomarker_reminder"], 6)
        self.assertEqual(catherine_hours["sleep_start"], 6.5)
        self.assertEqual(catherine_hours["wake_up"], 12.5)
        self.assertEqual(stella_hours["dinner"], 4)
        self.assertEqual(stella_hours["caffeine_cutoff"], -1)
        self.assertEqual(stella_hours["tcm_drink"], 4)
        self.assertEqual(stella_hours["sleep_start"], 5)
        self.assertEqual(stella_hours["wake_up"], 14)
        self.assertEqual(catherine_hours["sleep_recommendation"], 4)
        self.assertEqual(stella_hours["sleep_recommendation"], 2.5)

    def test_passenger_payload_uses_dashboard_identity_and_flight(self):
        passenger = skyzen_api.process_passenger(
            "2A",
            skyzen_api.live_data["2A"],
            "test timestamp",
        )
        dashboard_path = skyzen_api.passenger_page().path
        dashboard_html = Path(dashboard_path).read_text(encoding="utf-8")

        self.assertEqual(passenger["name"], "Catherine")
        self.assertEqual(passenger["flight_id"], "CX844")
        self.assertEqual(
            dashboard_path,
            skyzen_api.FRONTEND_DIR / "passenger" / "dashboard4.html",
        )
        self.assertIn('/static/js/api.js', dashboard_html)
        self.assertIn('/static/js/passenger.js', dashboard_html)

    def test_crew_page_serves_live_passenger_dashboard(self):
        crew_path = skyzen_api.crew_page().path
        crew_html = Path(crew_path).read_text(encoding="utf-8")

        self.assertEqual(
            crew_path,
            skyzen_api.FRONTEND_DIR / "passenger" / "crewview.html",
        )
        self.assertIn('/static/js/api.js', crew_html)
        self.assertIn("getSnapshot()", crew_html)
        self.assertIn("getAllWellness()", crew_html)
        self.assertIn("getCrewCoffeeRequests()", crew_html)

    def test_coffee_order_is_idempotent_and_visible_to_crew(self):
        departure_time = datetime.now(timezone.utc) - timedelta(minutes=31)
        with patch.object(skyzen_api, "FLIGHT_DEPARTURE_TIME", departure_time):
            decision = skyzen_api.CoffeeDecisionRequest(decision="yes")
            first_response = skyzen_api.passenger_coffee_decision("2A", decision)
            repeated_response = skyzen_api.passenger_coffee_decision(
                "2A",
                decision,
            )

        self.assertEqual(first_response, repeated_response)
        self.assertEqual(first_response["decision"], "yes")
        self.assertEqual(first_response["order"]["item"], "Coffee")
        self.assertEqual(
            skyzen_api.crew_coffee_requests()["requests"],
            [first_response["order"]],
        )
        self.assertEqual(
            skyzen_api.process_passenger(
                "2A",
                skyzen_api.live_data["2A"],
                "test timestamp",
            )["coffee_decision"],
            first_response,
        )

    def test_declining_coffee_does_not_create_a_crew_request(self):
        skyzen_api.passenger_coffee_decision(
            "2A",
            skyzen_api.CoffeeDecisionRequest(decision="no"),
        )

        self.assertEqual(skyzen_api.crew_coffee_requests()["requests"], [])
        self.assertEqual(
            skyzen_api.process_passenger(
                "2A",
                skyzen_api.live_data["2A"],
                "test timestamp",
            )["coffee_decision"]["decision"],
            "no",
        )

    def test_coffee_order_is_rejected_outside_the_scheduled_window(self):
        decision = skyzen_api.CoffeeDecisionRequest(decision="yes")
        departure_times = (
            datetime.now(timezone.utc),
            datetime.now(timezone.utc) - timedelta(minutes=48),
        )

        for departure_time in departure_times:
            with self.subTest(departure_time=departure_time):
                with patch.object(
                    skyzen_api,
                    "FLIGHT_DEPARTURE_TIME",
                    departure_time,
                ):
                    with self.assertRaises(HTTPException) as raised:
                        skyzen_api.passenger_coffee_decision("2A", decision)
                self.assertEqual(raised.exception.status_code, 409)

        with self.assertRaises(HTTPException) as raised:
            skyzen_api.passenger_coffee_decision("2K", decision)
        self.assertEqual(raised.exception.status_code, 409)

    def test_tcm_drink_order_is_idempotent_and_visible_to_crew(self):
        departure_time = datetime.now(timezone.utc) - timedelta(hours=5, minutes=45)
        payload = skyzen_api.TCMDrinkDecisionRequest(
            decision="yes",
            drink="Evening Calm 酸棗仁百合紅棗茶",
        )
        with patch.object(skyzen_api, "FLIGHT_DEPARTURE_TIME", departure_time):
            first_response = skyzen_api.passenger_tcm_drink_decision(
                "2A",
                payload,
            )
            repeated_response = skyzen_api.passenger_tcm_drink_decision(
                "2A",
                payload,
            )

        self.assertEqual(first_response, repeated_response)
        self.assertEqual(first_response["order"]["item"], payload.drink)
        self.assertEqual(
            skyzen_api.crew_coffee_requests()["requests"],
            [first_response["order"]],
        )
        self.assertEqual(
            skyzen_api.process_passenger(
                "2A",
                skyzen_api.live_data["2A"],
                "test timestamp",
            )["tcm_drink_decision"],
            first_response,
        )

    def test_declining_tcm_drink_does_not_create_a_crew_request(self):
        departure_time = datetime.now(timezone.utc) - timedelta(hours=5, minutes=45)
        payload = skyzen_api.TCMDrinkDecisionRequest(decision="no")
        with patch.object(skyzen_api, "FLIGHT_DEPARTURE_TIME", departure_time):
            decision = skyzen_api.passenger_tcm_drink_decision("2A", payload)

        self.assertEqual(decision["decision"], "no")
        self.assertEqual(skyzen_api.crew_coffee_requests()["requests"], [])

    def test_tcm_drink_order_is_rejected_outside_its_schedule(self):
        payload = skyzen_api.TCMDrinkDecisionRequest(
            decision="yes",
            drink="Harmony Tea 陳皮菊花茶",
        )
        with patch.object(
            skyzen_api,
            "FLIGHT_DEPARTURE_TIME",
            datetime.now(timezone.utc),
        ):
            with self.assertRaises(HTTPException) as raised:
                skyzen_api.passenger_tcm_drink_decision("2A", payload)

        self.assertEqual(raised.exception.status_code, 409)

    def test_meal_prep_yes_simulates_oven_preheat_and_is_idempotent(self):
        departure_time = datetime.now(timezone.utc) - timedelta(hours=3, minutes=45)
        payload = skyzen_api.MealPrepDecisionRequest(decision="yes")
        with patch.object(skyzen_api, "FLIGHT_DEPARTURE_TIME", departure_time):
            first_response = skyzen_api.crew_meal_prep_decision("2A", payload)
            repeated_response = skyzen_api.crew_meal_prep_decision("2A", payload)

        self.assertEqual(first_response, repeated_response)
        self.assertEqual(first_response["oven"], "Oven A")
        self.assertEqual(first_response["oven_status"], "Simulated preheating")
        self.assertTrue(first_response["demo_only"])
        self.assertEqual(
            skyzen_api.process_passenger(
                "2A",
                skyzen_api.live_data["2A"],
                "test timestamp",
            )["meal_prep_decision"],
            first_response,
        )

    def test_meal_prep_no_does_not_simulate_oven_preheat(self):
        departure_time = datetime.now(timezone.utc) - timedelta(hours=3, minutes=45)
        payload = skyzen_api.MealPrepDecisionRequest(decision="no")
        with patch.object(skyzen_api, "FLIGHT_DEPARTURE_TIME", departure_time):
            decision = skyzen_api.crew_meal_prep_decision("2A", payload)

        self.assertEqual(decision["decision"], "no")
        self.assertEqual(decision["oven_status"], "Not preheated")

    def test_meal_prep_decision_is_rejected_outside_its_schedule(self):
        payload = skyzen_api.MealPrepDecisionRequest(decision="yes")
        departure_times = (
            datetime.now(timezone.utc),
            datetime.now(timezone.utc) - timedelta(hours=4),
        )

        for departure_time in departure_times:
            with self.subTest(departure_time=departure_time):
                with patch.object(
                    skyzen_api,
                    "FLIGHT_DEPARTURE_TIME",
                    departure_time,
                ):
                    with self.assertRaises(HTTPException) as raised:
                        skyzen_api.crew_meal_prep_decision("2A", payload)
                self.assertEqual(raised.exception.status_code, 409)

    def test_passenger_a_changes_to_nausea_and_passenger_b_stays_fatigued(self):
        for _ in range(skyzen_api.CATHERINE_NAUSEA_START_TICK):
            skyzen_api.update_live_passengers()

        passenger_a = skyzen_api.wellness_detail("2A")
        passenger_b = skyzen_api.wellness_detail("2K")
        all_plans = skyzen_api.wellness_all()["passengers"]

        self.assertEqual(passenger_a["menus"]["symptom"], "nausea")
        self.assertEqual(passenger_a["menus"]["recommended"], "GENTLE")
        self.assertEqual(passenger_b["menus"]["symptom"], "fatigue")
        self.assertEqual(passenger_b["menus"]["recommended"], "RESTORE")
        self.assertEqual(all_plans["2A"]["menus"]["recommended"], "GENTLE")
        self.assertEqual(all_plans["2K"]["menus"]["recommended"], "RESTORE")

    def test_mock_passengers_are_not_updated_by_live_simulation(self):
        mock_before = skyzen_api.live_data["3D"].copy()

        for _ in range(skyzen_api.CATHERINE_NAUSEA_START_TICK):
            skyzen_api.update_live_passengers()

        self.assertEqual(skyzen_api.live_data["3D"], mock_before)
        self.assertIsNone(
            skyzen_api.process_passenger(
                "3D",
                skyzen_api.live_data["3D"],
                "test timestamp",
            )["reported_symptom"]
        )


if __name__ == "__main__":
    unittest.main()

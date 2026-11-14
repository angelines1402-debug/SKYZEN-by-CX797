from pathlib import Path
import unittest

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

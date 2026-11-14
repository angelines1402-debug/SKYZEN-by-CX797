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

    def test_passenger_a_changes_to_nausea_and_passenger_b_stays_fatigued(self):
        for _ in range(skyzen_api.PATRICIA_NAUSEA_START_TICK):
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

        for _ in range(skyzen_api.PATRICIA_NAUSEA_START_TICK):
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

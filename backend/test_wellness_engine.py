import unittest

from backend.wellness_engine import analyse_passenger


def make_passenger(hrv, spo2):
    return {
        "seat": "2A",
        "hrv": {"value": hrv},
        "spo2": {"value": spo2},
    }


class WellnessEngineTests(unittest.TestCase):
    def test_low_spo2_triggers_crew_review_independent_of_hrv(self):
        result = analyse_passenger(make_passenger(hrv=55, spo2=93))

        self.assertEqual(result["priority"], "High")
        self.assertEqual(result["status"], "Crew review suggested")
        self.assertIn("SpO2 below demo range", result["flags"])
        self.assertIsNone(result["menus"]["recommended"])
        self.assertEqual(result["menus"]["available"], ["RESTORE", "GENTLE"])
        self.assertEqual(len(result["menus"]["restore"]), 3)
        self.assertEqual(len(result["menus"]["gentle"]), 3)

    def test_94_percent_is_not_flagged_as_low(self):
        result = analyse_passenger(make_passenger(hrv=55, spo2=94))

        self.assertEqual(result["priority"], "Normal")
        self.assertNotIn("SpO2 below demo range", result["flags"])

    def test_explicit_symptom_selects_its_menu(self):
        fatigue = analyse_passenger(
            make_passenger(hrv=55, spo2=98),
            {"symptom": "fatigue"},
        )
        nausea = analyse_passenger(
            make_passenger(hrv=55, spo2=93),
            {"symptom": "nausea"},
        )

        self.assertEqual(fatigue["menus"]["symptom"], "fatigue")
        self.assertEqual(fatigue["menus"]["recommended"], "RESTORE")
        self.assertEqual(fatigue["menus"]["available"], ["RESTORE"])
        self.assertEqual(nausea["menus"]["symptom"], "nausea")
        self.assertEqual(nausea["menus"]["recommended"], "GENTLE")
        self.assertEqual(nausea["menus"]["available"], ["GENTLE"])
        self.assertEqual(nausea["priority"], "High")

    def test_no_symptom_makes_both_menus_available(self):
        for hrv, spo2 in ((35, 98), (55, 98), (35, 93)):
            with self.subTest(hrv=hrv, spo2=spo2):
                result = analyse_passenger(make_passenger(hrv, spo2))
                self.assertIsNone(result["menus"]["recommended"])
                self.assertEqual(
                    result["menus"]["available"],
                    ["RESTORE", "GENTLE"],
                )

    def test_unsupported_symptom_is_rejected(self):
        with self.assertRaises(ValueError):
            analyse_passenger(
                make_passenger(hrv=55, spo2=98),
                {"symptom": "dizziness"},
            )

    def test_flight_phase_adds_guidance_without_changing_priority(self):
        passenger = make_passenger(hrv=55, spo2=98)
        baseline = analyse_passenger(passenger)
        descent = analyse_passenger(
            passenger,
            {"flight_phase": "descent"},
        )

        self.assertEqual(descent["flight_phase"], "descent")
        self.assertEqual(descent["priority"], baseline["priority"])
        self.assertIn(
            "Prepare for landing",
            " ".join(descent["passenger_plan"]["actions"]),
        )
        self.assertIn(
            "landing preparation",
            " ".join(descent["crew_recommendations"]["actions"]),
        )

    def test_unsupported_flight_phase_is_rejected(self):
        with self.assertRaises(ValueError):
            analyse_passenger(
                make_passenger(hrv=55, spo2=98),
                {"flight_phase": "taxi"},
            )


if __name__ == "__main__":
    unittest.main()

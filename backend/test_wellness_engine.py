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

    def test_schedule_is_calculated_from_passenger_sleep_plan(self):
        passenger = make_passenger(hrv=55, spo2=98)
        passenger["sleep_plan"] = {
            "dinner_hours_after_departure": 4,
            "sleep_start_hours_after_departure": 6.5,
            "sleep_duration_hours": 6,
            "biomarker_reminder_minutes_before_sleep": 30,
        }

        schedule = analyse_passenger(passenger)["schedule"]
        hours = {event["type"]: event["hour"] for event in schedule}

        self.assertEqual(hours["dinner"], 4)
        self.assertEqual(hours["caffeine_cutoff"], 0.5)
        self.assertEqual(hours["tcm_drink"], 5.5)
        self.assertEqual(hours["biomarker_reminder"], 6)
        self.assertEqual(hours["sleep_recommendation"], 4)
        self.assertEqual(hours["sleep_start"], 6.5)
        self.assertEqual(hours["wake_up"], 12.5)
        coffee_prompt = next(
            event for event in schedule
            if event["type"] == "caffeine_cutoff"
        )
        self.assertEqual(coffee_prompt["window_hours"], 0.25)

    def test_caffeine_cutoff_before_departure_is_preserved(self):
        passenger = make_passenger(hrv=55, spo2=98)
        passenger["sleep_plan"] = {
            "sleep_start_hours_after_departure": 5,
            "sleep_duration_hours": 9,
        }

        schedule = analyse_passenger(passenger)["schedule"]
        cutoff = next(
            event for event in schedule if event["type"] == "caffeine_cutoff"
        )

        self.assertEqual(cutoff["hour"], -1)


if __name__ == "__main__":
    unittest.main()

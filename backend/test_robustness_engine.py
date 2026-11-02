import unittest
from robustness_engine import calculate_robustness


class RobustnessEngineTests(unittest.TestCase):
    def sample(self, ratings=None):
        return calculate_robustness(
            session={
                "evidence": "Clue 1: Annual report\nClue 2: Margin trend\nClue 3: Client demand",
                "analysis": {"potential_blind_spots": ["Valuation", "Downside risk"]},
            },
            assumptions=[
                {"assumption_id": "a1", "importance": 3},
                {"assumption_id": "a2", "importance": 1},
            ],
            counterarguments=[{"impact": "2"}],
            stress_tests=[{"assumption_id": "a1", "impact_rating": 3}],
            explored_blindspots=["Valuation"],
            ratings=ratings or {
                "evidence_support_rating": 4,
                "dependency_fragility_rating": 3,
                "counterargument_resilience_rating": 4,
                "reasoning_coverage_rating": 3,
            },
        )

    def test_returns_four_dimensions(self):
        result = self.sample()
        self.assertEqual(len(result["dimensions"]), 4)
        self.assertEqual(result["overall_score"], round(sum(d["score"] for d in result["dimensions"]) / 4, 1))

    def test_scores_bounded(self):
        result = self.sample()
        self.assertTrue(all(0 <= d["score"] <= 100 for d in result["dimensions"]))
        self.assertTrue(0 <= result["overall_score"] <= 100)

    def test_higher_evidence_rating_increases_evidence_score(self):
        low = self.sample({"evidence_support_rating": 1, "dependency_fragility_rating": 3, "counterargument_resilience_rating": 3, "reasoning_coverage_rating": 3})
        high = self.sample({"evidence_support_rating": 5, "dependency_fragility_rating": 3, "counterargument_resilience_rating": 3, "reasoning_coverage_rating": 3})
        self.assertGreater(high["dimensions"][0]["score"], low["dimensions"][0]["score"])

    def test_higher_fragility_reduces_dependency_score(self):
        low_fragility = self.sample({"evidence_support_rating": 3, "dependency_fragility_rating": 1, "counterargument_resilience_rating": 3, "reasoning_coverage_rating": 3})
        high_fragility = self.sample({"evidence_support_rating": 3, "dependency_fragility_rating": 5, "counterargument_resilience_rating": 3, "reasoning_coverage_rating": 3})
        self.assertGreater(low_fragility["dimensions"][1]["score"], high_fragility["dimensions"][1]["score"])

    def test_invalid_ratings_are_bounded(self):
        result = self.sample({"evidence_support_rating": 99, "dependency_fragility_rating": 0, "counterargument_resilience_rating": "x", "reasoning_coverage_rating": None})
        self.assertTrue(all(0 <= d["score"] <= 100 for d in result["dimensions"]))

    def test_no_data_is_not_mislabelled_as_prediction(self):
        result = calculate_robustness(session={"evidence": "", "analysis": {}}, assumptions=[], counterarguments=[], stress_tests=[], explored_blindspots=[], ratings={})
        self.assertIn("does not predict investment outcomes", " ".join(result["limitations"]))


if __name__ == "__main__":
    unittest.main(verbosity=2)

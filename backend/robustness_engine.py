from __future__ import annotations

from typing import Any, Mapping, Sequence

DIMENSION_WEIGHTS = {
    "evidence_support": 0.25,
    "assumption_dependency": 0.25,
    "counterargument_resilience": 0.25,
    "reasoning_coverage": 0.25,
}


def _rating_to_percent(value: Any, default: int = 3) -> float:
    """Map a 1–5 Likert rating to 0–100; invalid/missing values use midpoint."""
    try:
        rating = int(value)
    except (TypeError, ValueError):
        rating = default
    rating = max(1, min(5, rating))
    return ((rating - 1) / 4) * 100.0


def _inverse_rating_to_percent(value: Any, default: int = 3) -> float:
    """Map a 1–5 vulnerability rating to strength, so lower vulnerability scores higher."""
    return 100.0 - _rating_to_percent(value, default)


def _bounded_count_ratio(numerator: int, denominator: int) -> float:
    if denominator <= 0:
        return 0.0
    return max(0.0, min(1.0, numerator / denominator)) * 100.0


def _impact_resilience(impact: Any, scale_max: int, neutral: float = 50.0) -> float:
    """Translate reported challenge impact into an inverse resilience signal.

    An impact of 1 means the challenge had little reported effect (higher
    resilience proxy). The highest impact means it materially changed thinking
    (lower resilience proxy). Missing impact is neutral, not treated as failure.
    """
    try:
        val = int(float(impact))
    except (TypeError, ValueError):
        return neutral
    val = max(1, min(scale_max, val))
    return ((scale_max - val) / (scale_max - 1)) * 100.0


def _evidence_count(evidence: Any) -> int:
    if not isinstance(evidence, str):
        return 0
    return sum(1 for line in evidence.splitlines() if line.strip())


def calculate_robustness(
    *,
    session: Mapping[str, Any],
    assumptions: Sequence[Mapping[str, Any]],
    counterarguments: Sequence[Mapping[str, Any]],
    stress_tests: Sequence[Mapping[str, Any]],
    explored_blindspots: Sequence[str],
    ratings: Mapping[str, Any],
) -> dict[str, Any]:
    """Compute four transparent dimension scores and an equal-weight index.

    Score interpretation: a higher value means the recorded reflection signals
    indicate more examination/stronger self-assessed reasoning. It does not
    mean an investment is suitable, safe, or likely to be profitable.
    """
    evidence_count = _evidence_count(session.get("evidence", ""))
    evidence_presence = _bounded_count_ratio(min(evidence_count, 3), 3)
    evidence_self_rating = _rating_to_percent(ratings.get("evidence_support_rating"))
    evidence_score = round(0.65 * evidence_self_rating + 0.35 * evidence_presence)

    # Importance-weighted coverage of assumptions that received a saved stress test.
    total_importance = 0.0
    tested_importance = 0.0
    tested_assumption_ids = {
        str(item.get("assumption_id"))
        for item in stress_tests
        if item.get("assumption_id")
    }
    for item in assumptions:
        try:
            importance = float(item.get("importance", 2) or 2)
        except (TypeError, ValueError):
            importance = 2.0
        importance = max(1.0, min(3.0, importance))
        total_importance += importance
        if str(item.get("assumption_id", "")) in tested_assumption_ids:
            tested_importance += importance
    dependency_test_coverage = (
        tested_importance / total_importance * 100.0
        if total_importance else 0.0
    )
    vulnerability_strength = _inverse_rating_to_percent(
        ratings.get("dependency_fragility_rating")
    )
    dependency_score = round(
        0.55 * vulnerability_strength + 0.45 * dependency_test_coverage
    )

    # Latest response represents the most recent Steelman challenge in this session.
    latest_counterargument = counterarguments[-1] if counterarguments else {}
    counter_impact = latest_counterargument.get("impact")
    impact_resilience = _impact_resilience(counter_impact, scale_max=4)
    counterargument_self_rating = _rating_to_percent(
        ratings.get("counterargument_resilience_rating")
    )
    counterargument_score = round(
        0.70 * counterargument_self_rating + 0.30 * impact_resilience
    )

    # The user's explored items are compared with AI blind-spot prompts saved in analysis.
    analysis = session.get("analysis")
    if not isinstance(analysis, dict):
        analysis = {}
    available_blindspots = analysis.get("potential_blind_spots", [])
    if not isinstance(available_blindspots, list):
        available_blindspots = []
    available_count = len(available_blindspots)
    unique_explored = {str(item).strip() for item in explored_blindspots if str(item).strip()}
    explored_count = len(unique_explored)
    explored_coverage = _bounded_count_ratio(
        min(explored_count, available_count), available_count
    )
    coverage_self_rating = _rating_to_percent(
        ratings.get("reasoning_coverage_rating")
    )
    coverage_score = round(0.60 * coverage_self_rating + 0.40 * explored_coverage)

    dimensions = [
        {
            "key": "evidence_support",
            "label": "Evidence Support",
            "score": evidence_score,
            "basis": (
                f"65% self-rating; 35% evidence-entry coverage "
                f"({min(evidence_count, 3)} of 3 reference entries)."
            ),
            "interpretation": (
                "This estimates how directly the supplied evidence supports the thesis, "
                "using the user's rating and the presence of evidence entries. It does not verify facts."
            ),
        },
        {
            "key": "assumption_dependency",
            "label": "Assumption Dependency",
            "score": dependency_score,
            "basis": (
                f"55% inverse self-rated vulnerability; 45% importance-weighted stress-test "
                f"coverage ({round(dependency_test_coverage)}%)."
            ),
            "interpretation": (
                "Higher values mean lower self-reported fragility and more importance-weighted "
                "assumption testing. Confirming an assumption does not prove it is true."
            ),
        },
        {
            "key": "counterargument_resilience",
            "label": "Counterargument Resilience",
            "score": counterargument_score,
            "basis": (
                "70% self-rating of the ability to defend the reasoning; 30% inverse of the "
                "reported Steelman impact (neutral when not available)."
            ),
            "interpretation": (
                "This is a reflection signal, not an independent judgement of argument quality. "
                "A challenge changing one's mind is not inherently bad; it can reveal useful evidence needs."
            ),
        },
        {
            "key": "reasoning_coverage",
            "label": "Reasoning Coverage",
            "score": coverage_score,
            "basis": (
                f"60% self-rating; 40% potential AI coverage prompts explored "
                f"({min(explored_count, available_count)} of {available_count})."
            ),
            "interpretation": (
                "Coverage reflects prompts the user marked for exploration; it does not prove "
                "that every relevant business or financial factor has been exhaustively reviewed."
            ),
        },
    ]

    overall = round(sum(d["score"] for d in dimensions) / len(dimensions), 1)
    if overall < 40:
        label = "More examination needed"
    elif overall < 60:
        label = "Several areas remain open"
    elif overall < 80:
        label = "Reasoning examined"
    else:
        label = "Broadly examined reasoning"

    return {
        "version": "1.0",
        "overall_score": overall,
        "label": label,
        "dimensions": dimensions,
        "weights": {key: value for key, value in DIMENSION_WEIGHTS.items()},
        "signals": {
            "evidence_entries": evidence_count,
            "assumptions_total": len(assumptions),
            "assumptions_stress_tested": len(tested_assumption_ids),
            "explored_coverage_prompts": min(explored_count, available_count),
            "available_coverage_prompts": available_count,
            "steelman_impact_available": counter_impact is not None,
            "stress_tests_recorded": len(stress_tests),
        },
        "limitations": [
            "This is an experimental, equally weighted prototype heuristic.",
            "Ratings are self-reported; workflow counts are proxies, not evidence-quality verification.",
            "The score does not predict investment outcomes or provide a buy/sell recommendation.",
            "Weights and thresholds require further evaluation; usability testing does not itself validate financial predictive performance.",
        ],
    }

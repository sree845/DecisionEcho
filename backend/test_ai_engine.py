from ai_engine import analyze_decision
import json


result = analyze_decision(
    asset_name="Example Company",

    decision_intent="Considering investing",

    thesis=(
        "I am considering investing because the company has "
        "experienced strong revenue growth and appears to have "
        "increasing demand."
    ),

    evidence=(
        "Revenue has grown consistently over the last three years "
        "and the company has expanded into new markets."
    )
)


print()
print("=" * 70)
print("DECISIONECHO STRUCTURED AI ANALYSIS")
print("=" * 70)
print()

print(
    json.dumps(
        result,
        indent=2,
        ensure_ascii=False
    )
)

print()
print("=" * 70)
import os
import json
from dotenv import load_dotenv
from groq import Groq


# ============================================================
# CONFIGURATION
# ============================================================

load_dotenv()

API_KEY = os.getenv("GROQ_API_KEY")

if not API_KEY:
    raise ValueError(
        "GROQ_API_KEY not found. "
        "Make sure backend/.env contains GROQ_API_KEY."
    )

client = Groq(api_key=API_KEY)

MODEL = "openai/gpt-oss-20b"


# ============================================================
# CORE SYSTEM PROMPT
# ============================================================

SYSTEM_PROMPT = """
You are the reasoning engine for DecisionEcho.

DecisionEcho is a pre-commitment adversarial decision-support
system for retail investment decisions.

The system helps a user examine the reasoning behind an intended
investment decision before commitment.

============================================================
NON-NEGOTIABLE BOUNDARIES
============================================================

1. Never recommend BUY, SELL, HOLD, or AVOID.
2. Never predict stock prices.
3. Never predict investment returns.
4. Never provide a probability of investment success.
5. Never provide personalized financial advice.
6. Never claim that the user definitely has a psychological bias.
7. Challenge the reasoning, not the person.
8. Preserve user autonomy.
9. Never invent company-specific facts.
10. Do not turn hypothetical possibilities into factual claims.
11. Clearly distinguish the user's statements from AI-generated
    possibilities.
12. The final investment decision always remains with the user.

Return no more than 5 items in any array.
Never exceed the specified maximum number of items.
Do not specifically mention the user terms such as "yours" or "the user" in the output. Be more formal and neutral in tone.
Act like a advisor.
============================================================
DESIGN PRINCIPLE
============================================================

DecisionEcho facilitates adversarial thinking.

It should not simply dump information on the user.

The system should:
- understand the user's reasoning;
- reflect it back;
- identify potential dependencies;
- let the user choose what to challenge;
- construct a strong opposing argument;
- let the user respond;
- stress-test an assumption;
- identify areas the user has not explored;
- support final reflection.

============================================================
OUTPUT STYLE
============================================================

Be:
- concise;
- calm;
- neutral;
- specific to the user's reasoning;
- appropriate for an interactive application.

Avoid:
- long essays;
- unnecessary financial terminology;
- repetitive risk lists;
- persuasive language;
- investment recommendations.
"""


# ============================================================
# SCHEMA HELPERS
# ============================================================

DECISION_SCHEMA = {
    "type": "object",
    "properties": {
        "key_claims": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5
        },

        "potential_assumptions": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5
        },

        "strongest_counterargument": {
            "type": "string"
        },

        "alternative_explanations": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5
        },

        "potential_blind_spots": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5
        },

        "reflection_questions": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5
        }
    },

    "required": [
        "key_claims",
        "potential_assumptions",
        "strongest_counterargument",
        "alternative_explanations",
        "potential_blind_spots",
        "reflection_questions"
    ],

    "additionalProperties": False
}


CHALLENGE_SCHEMA = {
    "type": "object",
    "properties": {
        "challenge_options": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "id": {
                        "type": "string"
                    },
                    "title": {
                        "type": "string"
                    },
                    "subtitle": {
                        "type": "string"
                    },
                    "angle": {
                        "type": "string"
                    },
                    "why_it_matters": {
                        "type": "string"
                    }
                },
                "required": [
                    "id",
                    "title",
                    "subtitle",
                    "angle",
                    "why_it_matters"
                ],
                "additionalProperties": False
            },
            "maxItems": 4
        }
    },
    "required": [
        "challenge_options"
    ],
    "additionalProperties": False
}


STEELMAN_SCHEMA = {
    "type": "object",
    "properties": {
        "strongest_counterargument": {
            "type": "string"
        },

        "why_it_challenges": {
            "type": "string"
        },

        "what_to_examine": {
            "type": "string"
        },

        "alternative_explanation": {
            "type": "string"
        },

        "reflection_questions": {
            "type": "array",
            "items": {"type": "string"},
            "maxItems": 5
        }
    },

    "required": [
        "strongest_counterargument",
        "why_it_challenges",
        "what_to_examine",
        "alternative_explanation",
        "reflection_questions"
    ],

    "additionalProperties": False
}


STRESS_SCHEMA = {
    "type": "object",
    "properties": {
        "affected_reasoning": {
            "type": "string"
        },

        "reasoning_consequence": {
            "type": "string"
        },

        "alternative_scenario": {
            "type": "string"
        },

        "reflection_question": {
            "type": "string"
        }
    },

    "required": [
        "affected_reasoning",
        "reasoning_consequence",
        "alternative_scenario",
        "reflection_question"
    ],

    "additionalProperties": False
}


# ============================================================
# GENERIC STRUCTURED CALL
# ============================================================

def structured_call(
    user_prompt: str,
    schema_name: str,
    schema: dict,
    temperature: float = 0.2
):

    response = client.chat.completions.create(
        model=MODEL,

        messages=[
            {
                "role": "system",
                "content": SYSTEM_PROMPT
            },
            {
                "role": "user",
                "content": user_prompt
            }
        ],

        temperature=temperature,

        response_format={
            "type": "json_schema",
            "json_schema": {
                "name": schema_name,
                "strict": True,
                "schema": schema
            }
        }
    )

    content = response.choices[0].message.content

    return json.loads(content)


# ============================================================
# INITIAL DECISION ANALYSIS
# ============================================================

def analyze_decision(
    asset_name: str,
    decision_intent: str,
    thesis: str,
    evidence: str,
    challenge_intensity: str = "Balanced"
):

    user_prompt = f"""
Analyze the user's reasoning for DecisionEcho.

Asset / company:
{asset_name}

Intended decision:
{decision_intent}

User's thesis:
{thesis}

User-provided evidence:
{evidence}

Preferred challenge intensity:
{challenge_intensity}

Produce:

1. key_claims:
   Claims explicitly made or clearly implied by the user.

2. potential_assumptions:
   Conditions that appear to support the user's reasoning.

3. strongest_counterargument:
   The strongest reasonable challenge to the user's reasoning.

4. alternative_explanations:
   Plausible alternative interpretations of the evidence.

5. potential_blind_spots:
   Important reasoning areas not explicitly explored.

6. reflection_questions:
   Short questions that help the user examine their own reasoning.

IMPORTANT:

Key claims must represent the USER'S reasoning.

Do not turn a user claim into an independent conclusion.

Do not say:
"These factors support investing."

Instead say something such as:
"The user's reasoning treats these factors as support for the decision."

Do not invent factual information about the asset.
"""

    return structured_call(
        user_prompt=user_prompt,
        schema_name="decision_echo_analysis",
        schema=DECISION_SCHEMA
    )


# ============================================================
# CHALLENGE OPTIONS
# ============================================================

def generate_challenge_options(
    asset_name: str,
    thesis: str,
    assumptions: list,
    blind_spots: list,
    challenge_intensity: str = "Balanced"
):

    assumption_text = "\n".join(
        f"- {item}"
        for item in assumptions[:5]
    )

    blindspot_text = "\n".join(
        f"- {item}"
        for item in blind_spots[:5]
    )

    user_prompt = f"""
Create a set of challenge directions for an interactive
DecisionEcho session.

Asset:
{asset_name}

User thesis:
{thesis}

Potential assumptions:
{assumption_text}

Potential blind spots:
{blindspot_text}

Challenge intensity:
{challenge_intensity}

Generate up to four distinct challenge directions.

Each option must:
- challenge a different part of the reasoning;
- be understandable without financial expertise;
- be specific to the user's reasoning;
- invite exploration rather than make a recommendation.

Possible types include:
- sustainability;
- competition;
- profitability;
- valuation;
- evidence quality;
- alternative explanations;
- downside resilience.

Do not assume any company-specific fact is true.

The options are exploration directions, not investment advice.
"""

    return structured_call(
        user_prompt=user_prompt,
        schema_name="challenge_options",
        schema=CHALLENGE_SCHEMA
    )


# ============================================================
# FOCUSED STEELMAN
# ============================================================

def steelman_with_focus(
    asset_name: str,
    thesis: str,
    evidence: str,
    focus_title: str,
    focus_angle: str,
    challenge_intensity: str = "Balanced"
):

    user_prompt = f"""
Perform a focused Steelman challenge for DecisionEcho.

Asset:
{asset_name}

User thesis:
{thesis}

User evidence:
{evidence}

Selected challenge direction:
{focus_title}

Challenge angle:
{focus_angle}

Challenge intensity:
{challenge_intensity}

Construct the strongest reasonable argument against the
user's reasoning specifically through the selected challenge.

Return:

1. strongest_counterargument
2. why_it_challenges
3. what_to_examine
4. alternative_explanation
5. three concise reflection questions

IMPORTANT:

Do not decide whether the investment should be made.

Do not predict the investment outcome.

Do not invent company-specific facts.

The counterargument should challenge the reasoning,
not criticize the user.
"""

    return structured_call(
        user_prompt=user_prompt,
        schema_name="focused_steelman",
        schema=STEELMAN_SCHEMA
    )


# ============================================================
# BELIEF STRESS TEST
# ============================================================

def stress_test_assumption(
    thesis: str,
    assumption: str,
    challenge_intensity: str = "Balanced"
):

    user_prompt = f"""
Perform a Belief Stress Test.

Original user reasoning:
{thesis}

Assumption being tested:
{assumption}

Challenge intensity:
{challenge_intensity}

Temporarily assume that the assumption becomes false.

Explain:

1. Which part of the user's reasoning is affected?
2. What becomes weaker?
3. What alternative scenario should the user consider?
4. What question should the user reflect on?

Do not predict stock prices.

Do not provide a buy/sell/hold recommendation.

Do not invent company-specific facts.
"""

    return structured_call(
        user_prompt=user_prompt,
        schema_name="belief_stress_test",
        schema=STRESS_SCHEMA
    )
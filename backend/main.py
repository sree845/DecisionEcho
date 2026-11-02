from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import List
import sqlite3
import uuid
import json
from datetime import datetime

from ai_engine import (
    analyze_decision,
    generate_challenge_options,
    steelman_with_focus,
    stress_test_assumption
)
from robustness_engine import calculate_robustness


# ============================================================
# APPLICATION
# ============================================================

app = FastAPI(
    title="DecisionEcho API",
    description=(
        "Interactive pre-commitment adversarial decision-support "
        "system for retail investment reasoning."
    ),
    version="0.3.0"
)




# ============================================================
# DATABASE
# ============================================================

DATABASE = "decisionecho.db"


def get_db():
    connection = sqlite3.connect(DATABASE)
    connection.row_factory = sqlite3.Row
    return connection


def add_column_if_missing(
    connection,
    table_name,
    column_name,
    column_type
):

    columns = connection.execute(
        f"PRAGMA table_info({table_name})"
    ).fetchall()

    existing = {
        row["name"]
        for row in columns
    }

    if column_name not in existing:

        connection.execute(
            f"""
            ALTER TABLE {table_name}
            ADD COLUMN {column_name} {column_type}
            """
        )


def initialize_database():

    connection = get_db()
    cursor = connection.cursor()

    # --------------------------------------------------------
    # Sessions
    # --------------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS sessions (
            session_id TEXT PRIMARY KEY,
            asset_name TEXT NOT NULL,
            decision_intent TEXT NOT NULL,
            thesis TEXT NOT NULL,
            evidence TEXT NOT NULL,
            confidence INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
    """)

    # --------------------------------------------------------
    # Assumptions
    # --------------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS assumptions (
            assumption_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            content TEXT NOT NULL,
            importance INTEGER DEFAULT 2,
            user_confirmed INTEGER DEFAULT 0,
            FOREIGN KEY(session_id)
                REFERENCES sessions(session_id)
        )
    """)

    # --------------------------------------------------------
    # Counterarguments
    # --------------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS counterarguments (
            counterargument_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            counterargument TEXT NOT NULL,
            alternative_explanation TEXT,
            user_response TEXT,
            impact TEXT,
            FOREIGN KEY(session_id)
                REFERENCES sessions(session_id)
        )
    """)

    # --------------------------------------------------------
    # Stress tests
    # --------------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS stress_tests (
            stress_test_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            assumption_id TEXT,
            failure_condition TEXT,
            user_response TEXT,
            impact_rating INTEGER,
            FOREIGN KEY(session_id)
                REFERENCES sessions(session_id)
        )
    """)

    # --------------------------------------------------------
    # Reflections
    # --------------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS reflections (
            reflection_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL,
            final_reflection TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id)
                REFERENCES sessions(session_id)
        )
    """)

    # --------------------------------------------------------
    # Interpretable prototype robustness assessment
    # --------------------------------------------------------

    cursor.execute("""
        CREATE TABLE IF NOT EXISTS robustness_assessments (
            assessment_id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL UNIQUE,
            overall_score REAL NOT NULL,
            assessment_json TEXT NOT NULL,
            created_at TEXT NOT NULL,
            FOREIGN KEY(session_id)
                REFERENCES sessions(session_id)
        )
    """)

    # --------------------------------------------------------
    # Safe schema evolution for existing databases
    # --------------------------------------------------------

    add_column_if_missing(
        connection,
        "sessions",
        "analysis_json",
        "TEXT"
    )

    add_column_if_missing(
        connection,
        "sessions",
        "challenge_intensity",
        "TEXT DEFAULT 'Balanced'"
    )

    add_column_if_missing(
        connection,
        "sessions",
        "final_confidence",
        "INTEGER"
    )

    add_column_if_missing(
        connection,
        "sessions",
        "explored_blindspots",
        "TEXT"
    )

    add_column_if_missing(
        connection,
        "counterarguments",
        "challenge_title",
        "TEXT"
    )

    add_column_if_missing(
        connection,
        "counterarguments",
        "why_it_challenges",
        "TEXT"
    )

    add_column_if_missing(
        connection,
        "counterarguments",
        "what_to_examine",
        "TEXT"
    )

    add_column_if_missing(
        connection,
        "counterarguments",
        "reflection_questions",
        "TEXT"
    )

    add_column_if_missing(
        connection,
        "stress_tests",
        "ai_analysis",
        "TEXT"
    )

    connection.commit()
    connection.close()


initialize_database()


# ============================================================
# REQUEST MODELS
# ============================================================

class DecisionCreate(BaseModel):
    asset_name: str = Field(min_length=1)
    decision_intent: str = Field(min_length=1)
    thesis: str = Field(min_length=10)
    evidence: str = Field(min_length=5)
    confidence: int = Field(ge=1, le=5)
    challenge_intensity: str = "Balanced"


class Assumption(BaseModel):
    content: str = Field(min_length=3)
    importance: int = Field(default=2, ge=1, le=3)
    user_confirmed: bool = True


class AssumptionList(BaseModel):
    assumptions: List[Assumption]


class ChallengeOptionRequest(BaseModel):
    challenge_intensity: str = "Balanced"


class SteelmanFocusedRequest(BaseModel):
    focus_title: str
    focus_angle: str
    challenge_intensity: str = "Balanced"


class SteelmanSaveRequest(BaseModel):
    challenge_title: str
    why_it_challenges: str
    what_to_examine: str
    alternative_explanation: str
    reflection_questions: List[str] = []
    user_response: str = Field(min_length=1)
    impact: str = Field(min_length=1)


class StressTestRequest(BaseModel):
    assumption: str
    challenge_intensity: str = "Balanced"


class StressTestCreate(BaseModel):
    assumption_id: str
    failure_condition: str
    user_response: str = Field(min_length=1)
    impact_rating: int = Field(ge=1, le=5)
    ai_analysis: dict | None = None


class ReflectionCreate(BaseModel):
    final_reflection: str = Field(min_length=1)
    final_confidence: int = Field(ge=1, le=5)
    explored_blindspots: List[str] = Field(default_factory=list)
    # Self-reported reflection signals for the experimental robustness heuristic.
    evidence_support_rating: int = Field(default=3, ge=1, le=5)
    dependency_fragility_rating: int = Field(default=3, ge=1, le=5)
    counterargument_resilience_rating: int = Field(default=3, ge=1, le=5)
    reasoning_coverage_rating: int = Field(default=3, ge=1, le=5)


# ============================================================
# HELPERS
# ============================================================

def get_session_or_404(session_id: str):

    connection = get_db()

    session = connection.execute(
        """
        SELECT *
        FROM sessions
        WHERE session_id = ?
        """,
        (session_id,)
    ).fetchone()

    connection.close()

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Decision session not found."
        )

    return session


# ============================================================
# BASIC ROUTES
# ============================================================

@app.get("/")
def root():

    return {
        "application": "DecisionEcho",
        "status": "running",
        "version": "0.3.0"
    }


@app.get("/api/health")
def health():

    return {
        "status": "healthy",
        "service": "DecisionEcho",
        "ai_engine": "Groq",
        "version": "0.3.0"
    }


# ============================================================
# SESSION CREATION
# ============================================================

@app.post("/api/sessions")
def create_session(decision: DecisionCreate):

    session_id = str(uuid.uuid4())

    connection = get_db()

    connection.execute(
        """
        INSERT INTO sessions
        (
            session_id,
            asset_name,
            decision_intent,
            thesis,
            evidence,
            confidence,
            created_at,
            challenge_intensity
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            session_id,
            decision.asset_name.strip(),
            decision.decision_intent.strip(),
            decision.thesis.strip(),
            decision.evidence.strip(),
            decision.confidence,
            datetime.utcnow().isoformat(),
            decision.challenge_intensity
        )
    )

    connection.commit()
    connection.close()

    return {
        "session_id": session_id,
        "message": "Decision session created successfully."
    }


# ============================================================
# SESSION RETRIEVAL
# ============================================================

@app.get("/api/sessions/{session_id}")
def get_session(session_id: str):

    connection = get_db()

    session = connection.execute(
        """
        SELECT *
        FROM sessions
        WHERE session_id = ?
        """,
        (session_id,)
    ).fetchone()

    if not session:

        connection.close()

        raise HTTPException(
            status_code=404,
            detail="Decision session not found."
        )

    assumptions = connection.execute(
        """
        SELECT *
        FROM assumptions
        WHERE session_id = ?
        """,
        (session_id,)
    ).fetchall()

    counterarguments = connection.execute(
        """
        SELECT *
        FROM counterarguments
        WHERE session_id = ?
        ORDER BY rowid ASC
        """,
        (session_id,)
    ).fetchall()

    stress_tests = connection.execute(
        """
        SELECT *
        FROM stress_tests
        WHERE session_id = ?
        ORDER BY rowid ASC
        """,
        (session_id,)
    ).fetchall()

    reflections = connection.execute(
        """
        SELECT *
        FROM reflections
        WHERE session_id = ?
        ORDER BY rowid ASC
        """,
        (session_id,)
    ).fetchall()

    connection.close()

    session_data = dict(session)

    if session_data.get("analysis_json"):

        try:
            session_data["analysis"] = json.loads(
                session_data["analysis_json"]
            )
        except json.JSONDecodeError:

            session_data["analysis"] = None

    else:
        session_data["analysis"] = None

    return {
        "session": session_data,
        "assumptions": [
            dict(item)
            for item in assumptions
        ],
        "counterarguments": [
            dict(item)
            for item in counterarguments
        ],
        "stress_tests": [
            dict(item)
            for item in stress_tests
        ],
        "reflections": [
            dict(item)
            for item in reflections
        ]
    }

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
    "http://localhost:5173",
    "https://your-decisionecho.vercel.app"
],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# INITIAL AI ANALYSIS
# ============================================================

@app.post("/api/sessions/{session_id}/analyze-thesis")
def analyze_thesis(session_id: str):

    session = get_session_or_404(session_id)

    try:

        result = analyze_decision(
            asset_name=session["asset_name"],
            decision_intent=session["decision_intent"],
            thesis=session["thesis"],
            evidence=session["evidence"],
            challenge_intensity=(
                session["challenge_intensity"]
                or "Balanced"
            )
        )

    except Exception as exc:

        print("AI analysis error:", exc)

        raise HTTPException(
            status_code=502,
            detail=(
                "DecisionEcho could not complete the AI analysis. "
                "Please try again."
            )
        )

    connection = get_db()

    connection.execute(
        """
        UPDATE sessions
        SET analysis_json = ?
        WHERE session_id = ?
        """,
        (
            json.dumps(result, ensure_ascii=False),
            session_id
        )
    )

    connection.commit()
    connection.close()

    return result


# ============================================================
# ASSUMPTIONS
# ============================================================

@app.post("/api/sessions/{session_id}/assumptions")
def save_assumptions(
    session_id: str,
    data: AssumptionList
):

    get_session_or_404(session_id)

    cleaned = [
        item
        for item in data.assumptions
        if item.content.strip()
    ]

    if not cleaned:

        raise HTTPException(
            status_code=400,
            detail="At least one assumption is required."
        )

    connection = get_db()

    connection.execute(
        """
        DELETE FROM assumptions
        WHERE session_id = ?
        """,
        (session_id,)
    )

    results = []

    for assumption in cleaned:

        assumption_id = str(uuid.uuid4())

        connection.execute(
            """
            INSERT INTO assumptions
            (
                assumption_id,
                session_id,
                content,
                importance,
                user_confirmed
            )
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                assumption_id,
                session_id,
                assumption.content.strip(),
                assumption.importance,
                1 if assumption.user_confirmed else 0
            )
        )

        results.append({
            "assumption_id": assumption_id,
            "content": assumption.content.strip(),
            "importance": assumption.importance,
            "user_confirmed": assumption.user_confirmed
        })

    connection.commit()
    connection.close()

    return {
        "message": "Assumptions saved successfully.",
        "assumptions": results
    }


# ============================================================
# ADAPTIVE CHALLENGE OPTIONS
# ============================================================

@app.get("/api/sessions/{session_id}/challenge-options")
def challenge_options(session_id: str):

    session = get_session_or_404(session_id)

    analysis = None

    if session["analysis_json"]:

        try:
            analysis = json.loads(
                session["analysis_json"]
            )
        except json.JSONDecodeError:
            analysis = None

    if not analysis:

        raise HTTPException(
            status_code=400,
            detail=(
                "Run the initial reasoning analysis "
                "before choosing a challenge."
            )
        )

    try:

        result = generate_challenge_options(
            asset_name=session["asset_name"],
            thesis=session["thesis"],
            assumptions=analysis.get(
                "potential_assumptions",
                []
            ),
            blind_spots=analysis.get(
                "potential_blind_spots",
                []
            ),
            challenge_intensity=(
                session["challenge_intensity"]
                or "Balanced"
            )
        )

    except Exception as exc:

        print("Challenge option error:", exc)

        raise HTTPException(
            status_code=502,
            detail=(
                "DecisionEcho could not prepare the "
                "challenge choices."
            )
        )

    return result


# ============================================================
# FOCUSED STEELMAN
# ============================================================

@app.post("/api/sessions/{session_id}/steelman-focused")
def focused_steelman(
    session_id: str,
    data: SteelmanFocusedRequest
):

    session = get_session_or_404(session_id)

    try:

        result = steelman_with_focus(
            asset_name=session["asset_name"],
            thesis=session["thesis"],
            evidence=session["evidence"],
            focus_title=data.focus_title,
            focus_angle=data.focus_angle,
            challenge_intensity=data.challenge_intensity
        )

    except Exception as exc:

        print("Steelman error:", exc)

        raise HTTPException(
            status_code=502,
            detail=(
                "DecisionEcho could not build the selected "
                "challenge."
            )
        )

    return result


# ============================================================
# SAVE STEELMAN RESPONSE
# ============================================================

@app.post("/api/sessions/{session_id}/steelman-response")
def save_steelman_response(
    session_id: str,
    data: SteelmanSaveRequest
):

    get_session_or_404(session_id)

    counterargument_id = str(uuid.uuid4())

    connection = get_db()

    connection.execute(
        """
        INSERT INTO counterarguments
        (
            counterargument_id,
            session_id,
            counterargument,
            alternative_explanation,
            user_response,
            impact,
            challenge_title,
            why_it_challenges,
            what_to_examine,
            reflection_questions
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            counterargument_id,
            session_id,
            data.challenge_title,
            data.alternative_explanation,
            data.user_response.strip(),
            data.impact,
            data.challenge_title,
            data.why_it_challenges,
            data.what_to_examine,
            json.dumps(
                data.reflection_questions,
                ensure_ascii=False
            )
        )
    )

    connection.commit()
    connection.close()

    return {
        "message": "Steelman response saved.",
        "counterargument_id": counterargument_id
    }


# ============================================================
# BELIEF STRESS TEST — AI
# ============================================================

@app.post("/api/sessions/{session_id}/stress-test-ai")
def generate_stress_test(
    session_id: str,
    data: StressTestRequest
):

    session = get_session_or_404(session_id)

    try:

        result = stress_test_assumption(
            thesis=session["thesis"],
            assumption=data.assumption,
            challenge_intensity=data.challenge_intensity
        )

    except Exception as exc:

        print("Stress test AI error:", exc)

        raise HTTPException(
            status_code=502,
            detail=(
                "DecisionEcho could not generate the "
                "stress test."
            )
        )

    return result


# ============================================================
# SAVE STRESS TEST
# ============================================================

@app.post("/api/sessions/{session_id}/stress-test")
def save_stress_test(
    session_id: str,
    data: StressTestCreate
):

    get_session_or_404(session_id)

    stress_test_id = str(uuid.uuid4())

    connection = get_db()

    connection.execute(
        """
        INSERT INTO stress_tests
        (
            stress_test_id,
            session_id,
            assumption_id,
            failure_condition,
            user_response,
            impact_rating,
            ai_analysis
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (
            stress_test_id,
            session_id,
            data.assumption_id,
            data.failure_condition,
            data.user_response.strip(),
            data.impact_rating,
            json.dumps(
                data.ai_analysis,
                ensure_ascii=False
            ) if data.ai_analysis else None
        )
    )

    connection.commit()
    connection.close()

    return {
        "message": "Stress test saved successfully.",
        "stress_test_id": stress_test_id
    }


# ============================================================
# FINAL REFLECTION
# ============================================================

@app.post("/api/sessions/{session_id}/reflection")
def save_reflection(
    session_id: str,
    data: ReflectionCreate
):

    get_session_or_404(session_id)

    reflection_id = str(uuid.uuid4())
    assessment_id = str(uuid.uuid4())

    connection = get_db()

    try:
        connection.execute(
            """
            INSERT INTO reflections
            (reflection_id, session_id, final_reflection, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (
                reflection_id,
                session_id,
                data.final_reflection.strip(),
                datetime.utcnow().isoformat()
            )
        )

        explored_json = json.dumps(
            data.explored_blindspots,
            ensure_ascii=False
        )
        connection.execute(
            """
            UPDATE sessions
            SET final_confidence = ?, explored_blindspots = ?
            WHERE session_id = ?
            """,
            (data.final_confidence, explored_json, session_id)
        )

        # Read the saved session signals before deriving its assessment.
        session_row = connection.execute(
            "SELECT * FROM sessions WHERE session_id = ?",
            (session_id,)
        ).fetchone()
        session_data = dict(session_row)
        try:
            session_data["analysis"] = json.loads(session_data.get("analysis_json") or "{}")
        except (TypeError, json.JSONDecodeError):
            session_data["analysis"] = {}

        assumptions = [dict(row) for row in connection.execute(
            "SELECT * FROM assumptions WHERE session_id = ?",
            (session_id,)
        ).fetchall()]
        counterarguments = [dict(row) for row in connection.execute(
            "SELECT * FROM counterarguments WHERE session_id = ? ORDER BY rowid ASC",
            (session_id,)
        ).fetchall()]
        stress_tests = [dict(row) for row in connection.execute(
            "SELECT * FROM stress_tests WHERE session_id = ? ORDER BY rowid ASC",
            (session_id,)
        ).fetchall()]

        ratings = {
            "evidence_support_rating": data.evidence_support_rating,
            "dependency_fragility_rating": data.dependency_fragility_rating,
            "counterargument_resilience_rating": data.counterargument_resilience_rating,
            "reasoning_coverage_rating": data.reasoning_coverage_rating,
        }
        assessment = calculate_robustness(
            session=session_data,
            assumptions=assumptions,
            counterarguments=counterarguments,
            stress_tests=stress_tests,
            explored_blindspots=data.explored_blindspots,
            ratings=ratings,
        )
        assessment["assessment_id"] = assessment_id
        assessment["session_id"] = session_id

        connection.execute(
            """
            INSERT OR REPLACE INTO robustness_assessments
            (assessment_id, session_id, overall_score, assessment_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (
                assessment_id,
                session_id,
                assessment["overall_score"],
                json.dumps(assessment, ensure_ascii=False),
                datetime.utcnow().isoformat(),
            )
        )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()

    return {
        "message": "Final reflection and prototype assessment saved successfully.",
        "reflection_id": reflection_id,
        "assessment": assessment,
    }


@app.get("/api/sessions/{session_id}/robustness")
def get_robustness_assessment(session_id: str):
    """Retrieve the latest persisted assessment for a completed session."""
    get_session_or_404(session_id)
    connection = get_db()
    try:
        row = connection.execute(
            "SELECT assessment_json FROM robustness_assessments WHERE session_id = ?",
            (session_id,)
        ).fetchone()
    finally:
        connection.close()

    if not row:
        raise HTTPException(
            status_code=404,
            detail="No robustness assessment has been saved for this session yet.",
        )
    try:
        return json.loads(row["assessment_json"])
    except (TypeError, json.JSONDecodeError):
        raise HTTPException(
            status_code=500,
            detail="The saved robustness assessment could not be read.",
        )


# ============================================================
# APPLICATION ENTRY POINT
# ============================================================

if __name__ == "__main__":

    import uvicorn

    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        reload=True
    )
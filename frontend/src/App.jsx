import { useMemo, useState } from "react";
import axios from "axios";
import "./App.css";

/*
|--------------------------------------------------------------------------
| API
|--------------------------------------------------------------------------
*/

const API_BASE =
  import.meta.env.VITE_API_URL?.replace(/\/$/, "") ||
  "http://127.0.0.1:8000";

/*
|--------------------------------------------------------------------------
| Journey
|--------------------------------------------------------------------------
*/

const JOURNEY = [
  { key: "input", number: "01", title: "Thesis", verb: "Enter" },
  { key: "echo", number: "02", title: "Echo", verb: "Reveal" },
  { key: "assumptions", number: "03", title: "Dependencies", verb: "Uncover" },
  { key: "challenge", number: "04", title: "Challenge", verb: "Explore" },
  { key: "steelman", number: "05", title: "Opposition", verb: "Confront" },
  { key: "stress", number: "06", title: "Stress test", verb: "Test" },
  { key: "reflection", number: "07", title: "Reflection", verb: "Reflect" },
];

/*
|--------------------------------------------------------------------------
| Initial form
|--------------------------------------------------------------------------
| IMPORTANT:
| These fields match DecisionCreate in your main.py exactly.
|
| asset_name
| decision_intent
| thesis
| evidence
| confidence
| challenge_intensity
|--------------------------------------------------------------------------
*/

const INITIAL_FORM = {
  asset_name: "",
  decision_intent: "Considering investing",
  thesis: "",
  evidence: ["", "", ""],
  confidence: 3,
  challenge_intensity: "Balanced",
};

const CONFIDENCE_LABELS = {
  1: "Very low",
  2: "Low",
  3: "Moderate",
  4: "High",
  5: "Very high",
};

const STEELMAN_IMPACTS = [
  { value: "1", label: "Not at all" },
  { value: "2", label: "Slightly" },
  { value: "3", label: "Moderately" },
  { value: "4", label: "Significantly" },
];

const ROBUSTNESS_QUESTIONS = [
  {
    key: "evidence_support_rating",
    title: "Evidence Support",
    question: "How directly does the evidence you provided support your thesis?",
    low: "Not directly",
    high: "Very directly",
  },
  {
    key: "dependency_fragility_rating",
    title: "Assumption Dependency",
    question: "If a key assumption fails, how vulnerable is your reasoning?",
    low: "Not vulnerable",
    high: "Very vulnerable",
  },
  {
    key: "counterargument_resilience_rating",
    title: "Counterargument Resilience",
    question: "After considering the opposing case, how well can you defend your reasoning with evidence?",
    low: "Not well",
    high: "Very well",
  },
  {
    key: "reasoning_coverage_rating",
    title: "Reasoning Coverage",
    question: "How thoroughly have you examined relevant areas, including downside risk and alternatives?",
    low: "Not thoroughly",
    high: "Very thoroughly",
  },
];

const EMPTY_ROBUSTNESS_RATINGS = {
  evidence_support_rating: 0,
  dependency_fragility_rating: 0,
  counterargument_resilience_rating: 0,
  reasoning_coverage_rating: 0,
};

/*
|--------------------------------------------------------------------------
| Utility helpers
|--------------------------------------------------------------------------
*/

function array(value) {
  return Array.isArray(value) ? value : [];
}

function safeText(value) {
  if (typeof value === "string") return value;

  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return (
      value.content ||
      value.text ||
      value.label ||
      value.assumption ||
      value.description ||
      ""
    );
  }

  return String(value);
}

function extractApiError(error) {
  const responseData = error?.response?.data;

  /*
   * FastAPI validation error:
   *
   * {
   *   "detail": [
   *      {
   *        "loc": ["body", "asset_name"],
   *        "msg": "Field required"
   *      }
   *   ]
   * }
   */

  if (Array.isArray(responseData?.detail)) {
    return responseData.detail
      .map((item) => {
        const location = Array.isArray(item.loc)
          ? item.loc.join(" → ")
          : "request";

        return `${location}: ${item.msg}`;
      })
      .join(" | ");
  }

  if (typeof responseData?.detail === "string") {
    return responseData.detail;
  }

  if (typeof responseData === "string") {
    return responseData;
  }

  if (error?.response?.status) {
    return `Request failed with status ${error.response.status}.`;
  }

  return error?.message || "Something went wrong.";
}

/*
|--------------------------------------------------------------------------
| Normalize AI responses
|--------------------------------------------------------------------------
| Your ai_engine.py is not included in the pasted main.py, so the frontend
| accepts the expected response names and a few sensible alternatives.
|--------------------------------------------------------------------------
*/

function normalizeAnalysis(data) {
  const source = data?.analysis || data || {};

  return {
    keyClaims: array(source.key_claims)
      .map(safeText)
      .filter(Boolean),

    assumptions: array(source.potential_assumptions)
      .map(safeText)
      .filter(Boolean),

    strongestCounterargument: safeText(
      source.strongest_counterargument ||
        source.counterargument ||
        source.strongest_opposing_case
    ),

    alternatives: array(source.alternative_explanations)
      .map(safeText)
      .filter(Boolean),

    blindSpots: array(source.potential_blind_spots)
      .map(safeText)
      .filter(Boolean),

    reflectionQuestions: array(source.reflection_questions)
      .map(safeText)
      .filter(Boolean),
  };
}

function normalizeChallengeOptions(data) {
  const raw =
    data?.challenge_options ||
    data?.options ||
    data?.challenges ||
    (Array.isArray(data) ? data : []);

  return raw.map((option, index) => ({
    id:
      option.id ||
      option.key ||
      option.challenge_id ||
      `challenge-${index}`,

    title:
      option.title ||
      option.name ||
      option.label ||
      `Challenge ${index + 1}`,

    description:
      option.description ||
      option.summary ||
      option.why ||
      option.focus_angle ||
      option.focus ||
      "Examine a different dependency in your reasoning.",

    angle:
      option.focus_angle ||
      option.focus ||
      option.challenge_focus ||
      option.description ||
      option.summary ||
      `Explore challenge ${index + 1}.`,
  }));
}

function normalizeSteelman(data) {
  const source = data?.steelman || data || {};

  return {
    challengeTitle:
      safeText(
        source.challenge_title ||
          source.title ||
          source.name
      ) || "The opposing case",

    whyItChallenges: safeText(
      source.why_it_challenges ||
        source.why ||
        source.challenge_reason
    ),

    whatToExamine: safeText(
      source.what_to_examine ||
        source.what_to_check ||
        source.examination
    ),

    alternativeExplanation: safeText(
      source.alternative_explanation ||
        source.alternative ||
        source.strongest_counterargument ||
        source.counterargument
    ),

    reflectionQuestions: array(
      source.reflection_questions
    )
      .map(safeText)
      .filter(Boolean),
  };
}

function normalizeStress(data) {
  const source = data?.stress_test || data || {};

  return {
    affectedReasoning: safeText(
      source.affected_reasoning ||
        source.affected_logic
    ),

    alternativeScenario: safeText(
      source.alternative_scenario ||
        source.failure_condition
    ),

    reasoningConsequence: safeText(
      source.reasoning_consequence ||
        source.consequence
    ),

    reflectionQuestion: safeText(
      source.reflection_question ||
        source.question
    ),
  };
}

/*
|--------------------------------------------------------------------------
| App
|--------------------------------------------------------------------------
*/

export default function App() {
  /*
   * Screen state
   */
  const [screen, setScreen] = useState("home");
  const [inputStep, setInputStep] = useState(0);

  /*
   * Decision form
   */
  const [form, setForm] = useState(INITIAL_FORM);

  /*
   * Backend/session state
   */
  const [sessionId, setSessionId] = useState("");
  const [analysis, setAnalysis] = useState(null);

  /*
   * Assumptions
   */
  const [assumptions, setAssumptions] = useState([]);

  /*
   * Challenge
   */
  const [challengeOptions, setChallengeOptions] = useState([]);
  const [selectedChallenge, setSelectedChallenge] = useState(null);

  /*
   * Steelman
   */
  const [steelman, setSteelman] = useState(null);
  const [steelmanImpact, setSteelmanImpact] = useState("");
  const [steelmanResponse, setSteelmanResponse] = useState("");

  /*
   * Stress test
   */
  const [selectedAssumption, setSelectedAssumption] = useState(null);
  const [stressTest, setStressTest] = useState(null);
  const [stressImpact, setStressImpact] = useState("");
  const [stressResponse, setStressResponse] = useState("");

  /*
   * Reflection
   */
  const [exploredBlindspots, setExploredBlindspots] = useState([]);
  const [finalConfidence, setFinalConfidence] = useState(3);
  const [finalReflection, setFinalReflection] = useState("");
  const [robustnessRatings, setRobustnessRatings] = useState(EMPTY_ROBUSTNESS_RATINGS);
  const [completePayload, setCompletePayload] = useState(null);

  /*
   * UI state
   */
  const [loading, setLoading] = useState(false);
  const [loadingText, setLoadingText] = useState("");
  const [error, setError] = useState("");

  /*
   * Derived values
   */

  const currentJourneyIndex = useMemo(() => {
    const index = JOURNEY.findIndex(
      (item) => item.key === screen
    );

    return index >= 0 ? index : 0;
  }, [screen]);

  const evidenceCount = form.evidence.filter(
    (item) => item.trim()
  ).length;

  const confirmedAssumptions = assumptions.filter(
    (item) => item.confirmed && item.assumption_id
  );

  const discoveryCount =
    confirmedAssumptions.length +
    exploredBlindspots.length +
    (selectedChallenge ? 1 : 0) +
    (steelmanImpact ? 1 : 0) +
    (stressImpact ? 1 : 0);

  /*
   * Confidence difference
   */
  const confidenceDelta =
    Number(finalConfidence) - Number(form.confidence);

  const robustnessAssessment = completePayload?.assessment || null;
  const robustnessRatingsComplete = Object.values(robustnessRatings).every(
    (rating) => Number(rating) >= 1 && Number(rating) <= 5
  );

  /*
   * Basic navigation
   */

  function move(nextScreen) {
    setError("");
    setScreen(nextScreen);

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /*
   * API helper
   */

  async function request(method, path, data) {
    const response = await axios({
      method,
      url: `${API_BASE}${path}`,
      data,
      timeout: 90000,
      headers: {
        "Content-Type": "application/json",
      },
    });

    return response.data;
  }

  /*
   * Form updates
   */

  function updateForm(field, value) {
    setForm((previous) => ({
      ...previous,
      [field]: value,
    }));
  }

  function updateEvidence(index, value) {
    setForm((previous) => {
      const nextEvidence = [...previous.evidence];

      nextEvidence[index] = value;

      return {
        ...previous,
        evidence: nextEvidence,
      };
    });
  }

  /*
   * Reset
   */

  function resetReview() {
    setScreen("home");
    setInputStep(0);
    setForm(INITIAL_FORM);

    setSessionId("");
    setAnalysis(null);

    setAssumptions([]);
    setChallengeOptions([]);
    setSelectedChallenge(null);

    setSteelman(null);
    setSteelmanImpact("");
    setSteelmanResponse("");

    setSelectedAssumption(null);
    setStressTest(null);
    setStressImpact("");
    setStressResponse("");

    setExploredBlindspots([]);

    setFinalConfidence(3);
    setFinalReflection("");
    setRobustnessRatings(EMPTY_ROBUSTNESS_RATINGS);
    setCompletePayload(null);

    setLoading(false);
    setLoadingText("");
    setError("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  /*
  |--------------------------------------------------------------------------
  | STEP 1–5: THESIS
  |--------------------------------------------------------------------------
  */

  function continueInputJourney() {
    setError("");

    /*
     * STEP 1 — Target
     */
    if (inputStep === 0) {
      if (!form.asset_name.trim()) {
        setError(
          "Enter the company, asset, fund, or instrument you are reviewing."
        );
        return;
      }

      setInputStep(1);
      return;
    }

    /*
     * STEP 2 — Intent
     */
    if (inputStep === 1) {
      setInputStep(2);
      return;
    }

    /*
     * STEP 3 — Thesis
     */
    if (inputStep === 2) {
      if (form.thesis.trim().length < 10) {
        setError(
          "Give at least a little reasoning so DecisionEcho can challenge it."
        );
        return;
      }

      setInputStep(3);
      return;
    }

    /*
     * STEP 4 — Evidence
     */
    if (inputStep === 3) {
      if (evidenceCount === 0) {
        setError(
          "Add at least one supporting clue before continuing."
        );
        return;
      }

      setInputStep(4);
      return;
    }

    /*
     * STEP 5 — Context
     */
    createSession();
  }

  function backInputJourney() {
    if (inputStep === 0) {
      move("home");
      return;
    }

    setInputStep((previous) => previous - 1);
    setError("");
  }

  /*
   |--------------------------------------------------------------------------
   | CREATE SESSION
   |--------------------------------------------------------------------------
   |
   | THIS PAYLOAD EXACTLY MATCHES:
   |
   | class DecisionCreate(BaseModel):
   |     asset_name
   |     decision_intent
   |     thesis
   |     evidence
   |     confidence
   |     challenge_intensity
   |
   |--------------------------------------------------------------------------
   */

  async function createSession() {
    setError("");
    setLoading(true);
    setLoadingText("Opening your decision case…");

    const evidence = form.evidence
      .map((item, index) => {
        const text = item.trim();

        if (!text) return "";

        return `Clue ${index + 1}: ${text}`;
      })
      .filter(Boolean)
      .join("\n");

    /*
     * Exact backend payload
     */
    const payload = {
      asset_name: form.asset_name.trim(),
      decision_intent: form.decision_intent.trim(),
      thesis: form.thesis.trim(),
      evidence: evidence.trim(),
      confidence: Number(form.confidence),
      challenge_intensity: form.challenge_intensity.trim(),
    };

    try {
      const created = await request(
        "post",
        "/api/sessions",
        payload
      );

      const id = created?.session_id;

      if (!id) {
        throw new Error(
          "The backend created the session but did not return session_id."
        );
      }

      setSessionId(id);

      /*
       * Immediately run the AI analysis.
       */
      setLoadingText("Echoing your reasoning…");

      const result = await request(
        "post",
        `/api/sessions/${id}/analyze-thesis`
      );

      const normalized = normalizeAnalysis(result);

      setAnalysis(normalized);

      /*
       * Turn AI-proposed assumptions into editable,
       * user-confirmed assumption records.
       */
      const generatedAssumptions =
        normalized.assumptions.map(
          (content, index) => ({
            localId: `${Date.now()}-${index}`,
            assumption_id: "",
            content,
            importance:
              index === 0
                ? 3
                : index === 1
                ? 2
                : 1,
            confirmed: false,
          })
        );

      setAssumptions(generatedAssumptions);

      /*
       * Start final reflection at the original confidence.
       */
      setFinalConfidence(
        Number(form.confidence)
      );

      setInputStep(0);

      move("echo");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | ECHO
   |--------------------------------------------------------------------------
   */

  function toggleBlindspot(item) {
    setExploredBlindspots((previous) => {
      if (previous.includes(item)) {
        return previous.filter(
          (entry) => entry !== item
        );
      }

      return [...previous, item];
    });
  }

  /*
   |--------------------------------------------------------------------------
   | ASSUMPTIONS
   |--------------------------------------------------------------------------
   */

  function updateAssumption(localId, field, value) {
    setAssumptions((previous) =>
      previous.map((item) =>
        item.localId === localId
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  }

  function addAssumption() {
    setAssumptions((previous) => [
      ...previous,
      {
        localId: `${Date.now()}-manual`,
        assumption_id: "",
        content: "",
        importance: 2,
        confirmed: false,
      },
    ]);
  }

  function removeAssumption(localId) {
    setAssumptions((previous) =>
      previous.filter(
        (item) => item.localId !== localId
      )
    );
  }

  /*
   |--------------------------------------------------------------------------
   | SAVE ASSUMPTIONS
   |--------------------------------------------------------------------------
   */

  async function saveAssumptions() {
    setError("");

    const cleaned = assumptions
      .map((item) => ({
        ...item,
        content: item.content.trim(),
      }))
      .filter((item) => item.content);

    if (!cleaned.length) {
      setError(
        "Keep at least one assumption."
      );
      return;
    }

    if (
      cleaned.some(
        (item) => !item.confirmed
      )
    ) {
      setError(
        "Confirm each assumption before continuing. This lets you verify the AI interpretation."
      );
      return;
    }

    setLoading(true);
    setLoadingText(
      "Saving the dependencies you confirmed…"
    );

    try {
      /*
       * Exact AssumptionList payload:
       *
       * {
       *   assumptions: [
       *     {
       *       content,
       *       importance,
       *       user_confirmed
       *     }
       *   ]
       * }
       */
      const saved = await request(
        "post",
        `/api/sessions/${sessionId}/assumptions`,
        {
          assumptions: cleaned.map(
            (item) => ({
              content: item.content,
              importance: Number(
                item.importance
              ),
              user_confirmed: true,
            })
          ),
        }
      );

      const returned = array(
        saved?.assumptions
      );

      const normalized = cleaned.map(
        (item, index) => ({
          ...item,
          assumption_id:
            returned[index]
              ?.assumption_id || "",
          confirmed: true,
        })
      );

      if (
        normalized.some(
          (item) => !item.assumption_id
        )
      ) {
        throw new Error(
          "The backend saved the assumptions but did not return their IDs."
        );
      }

      setAssumptions(normalized);

      /*
       * Challenge options
       */
      setLoadingText(
        "Preparing your challenge paths…"
      );

      const optionsResult =
        await request(
          "get",
          `/api/sessions/${sessionId}/challenge-options`
        );

      const options =
        normalizeChallengeOptions(
          optionsResult
        );

      if (!options.length) {
        throw new Error(
          "The backend returned no challenge options."
        );
      }

      setChallengeOptions(
        options.slice(0, 3)
      );

      setSelectedChallenge(null);

      move("challenge");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | STEELMAN
   |--------------------------------------------------------------------------
   |
   | Exact backend request:
   |
   | {
   |   focus_title,
   |   focus_angle,
   |   challenge_intensity
   | }
   |--------------------------------------------------------------------------
   */

  async function generateSteelman() {
    setError("");

    if (!selectedChallenge) {
      setError(
        "Choose a challenge direction first."
      );
      return;
    }

    setLoading(true);
    setLoadingText(
      "Constructing the strongest reasonable opposition…"
    );

    try {
      const result = await request(
        "post",
        `/api/sessions/${sessionId}/steelman-focused`,
        {
          focus_title:
            selectedChallenge.title,

          focus_angle:
            selectedChallenge.angle,

          challenge_intensity:
            form.challenge_intensity,
        }
      );

      const normalized =
        normalizeSteelman(result);

      setSteelman(normalized);
      setSteelmanImpact("");
      setSteelmanResponse("");

      move("steelman");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | SAVE STEELMAN + CREATE STRESS TEST
   |--------------------------------------------------------------------------
   |
   | Exact SteelmanSaveRequest fields:
   |
   | challenge_title
   | why_it_challenges
   | what_to_examine
   | alternative_explanation
   | reflection_questions
   | user_response
   | impact
   |
   |--------------------------------------------------------------------------
   */

  async function saveSteelmanAndOpenStress() {
    setError("");

    if (!steelmanImpact) {
      setError(
        "Record how strongly the opposing case affected your thinking."
      );
      return;
    }

    if (!steelmanResponse.trim()) {
      setError(
        "Write your response to the opposing case."
      );
      return;
    }

    /*
     * Select the most important confirmed assumption
     * for the first stress test.
     */
    const candidate =
      [...confirmedAssumptions]
        .sort(
          (a, b) =>
            Number(b.importance) -
            Number(a.importance)
        )[0];

    if (!candidate) {
      setError(
        "No confirmed dependency is available for stress testing."
      );
      return;
    }

    setLoading(true);
    setLoadingText(
      "Saving your response and preparing the break point…"
    );

    try {
      /*
       * Exact SteelmanSaveRequest payload.
       */
      await request(
        "post",
        `/api/sessions/${sessionId}/steelman-response`,
        {
          challenge_title:
            steelman.challengeTitle,

          why_it_challenges:
            steelman.whyItChallenges || "",

          what_to_examine:
            steelman.whatToExamine || "",

          alternative_explanation:
            steelman.alternativeExplanation || "",

          reflection_questions:
            steelman.reflectionQuestions || [],

          user_response:
            steelmanResponse.trim(),

          impact: String(
            steelmanImpact
          ),
        }
      );

      /*
       * Create the AI stress test.
       *
       * Exact StressTestRequest:
       *
       * {
       *   assumption,
       *   challenge_intensity
       * }
       */
      const stress =
        await request(
          "post",
          `/api/sessions/${sessionId}/stress-test-ai`,
          {
            assumption:
              candidate.content,

            challenge_intensity:
              form.challenge_intensity,
          }
        );

      setSelectedAssumption(
        candidate
      );

      setStressTest(
        normalizeStress(stress)
      );

      setStressImpact("");
      setStressResponse("");

      move("stress");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | CHANGE STRESS TEST ASSUMPTION
   |--------------------------------------------------------------------------
   */

  async function changeStressAssumption(
    assumption
  ) {
    if (!assumption?.assumption_id) {
      return;
    }

    setError("");
    setLoading(true);
    setLoadingText(
      "Rebuilding the stress test…"
    );

    try {
      const result =
        await request(
          "post",
          `/api/sessions/${sessionId}/stress-test-ai`,
          {
            assumption:
              assumption.content,

            challenge_intensity:
              form.challenge_intensity,
          }
        );

      setSelectedAssumption(
        assumption
      );

      setStressTest(
        normalizeStress(result)
      );

      setStressImpact("");
      setStressResponse("");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | SAVE STRESS TEST
   |--------------------------------------------------------------------------
   |
   | Exact StressTestCreate:
   |
   | assumption_id
   | failure_condition
   | user_response
   | impact_rating
   | ai_analysis
   |
   |--------------------------------------------------------------------------
   */

  async function saveStressAndReflect() {
    setError("");

    if (
      !selectedAssumption?.assumption_id
    ) {
      setError(
        "The selected dependency is missing."
      );
      return;
    }

    if (!stressImpact) {
      setError(
        "Choose how strongly the failed dependency affects your reasoning."
      );
      return;
    }

    if (!stressResponse.trim()) {
      setError(
        "Explain what changes in your reasoning if this dependency fails."
      );
      return;
    }

    setLoading(true);
    setLoadingText(
      "Recording the stress test…"
    );

    try {
      await request(
        "post",
        `/api/sessions/${sessionId}/stress-test`,
        {
          assumption_id:
            selectedAssumption.assumption_id,

          failure_condition:
            stressTest?.alternativeScenario ||
            "The selected assumption becomes false.",

          user_response:
            stressResponse.trim(),

          impact_rating:
            Number(stressImpact),

          ai_analysis:
            stressTest || null,
        }
      );

      move("reflection");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | SAVE FINAL REFLECTION
   |--------------------------------------------------------------------------
   |
   | Exact ReflectionCreate:
   |
   | final_reflection
   | final_confidence
   | explored_blindspots
   |
   |--------------------------------------------------------------------------
   */

  async function saveReflection() {
    setError("");

    if (!finalReflection.trim()) {
      setError(
        "Write your final reflection before completing the review."
      );
      return;
    }

    setLoading(true);
    setLoadingText(
      "Saving your final reflection…"
    );

    try {
      const result =
        await request(
          "post",
          `/api/sessions/${sessionId}/reflection`,
          {
            final_reflection:
              finalReflection.trim(),

            final_confidence:
              Number(finalConfidence),

            explored_blindspots:
              exploredBlindspots,

            evidence_support_rating:
              Number(robustnessRatings.evidence_support_rating),
            dependency_fragility_rating:
              Number(robustnessRatings.dependency_fragility_rating),
            counterargument_resilience_rating:
              Number(robustnessRatings.counterargument_resilience_rating),
            reasoning_coverage_rating:
              Number(robustnessRatings.reasoning_coverage_rating),
          }
        );

      setCompletePayload(result);

      move("complete");
    } catch (err) {
      console.error(err);

      setError(
        extractApiError(err)
      );
    } finally {
      setLoading(false);
      setLoadingText("");
    }
  }

  /*
   |--------------------------------------------------------------------------
   | HOME
   |--------------------------------------------------------------------------
   */

  if (screen === "home") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <button
            className="brand"
            onClick={resetReview}
          >
            <span className="brand-mark">
              DE
            </span>

            <span className="brand-copy">
              <strong>
                DecisionEcho
              </strong>

              <small>
                Think twice. Then decide.
              </small>
            </span>
          </button>

          <div className="topbar-meta">
            <span>
              Pre-commitment reasoning support
            </span>
          </div>
        </header>

        <main className="home-page">
          <section className="home-copy">
            <span className="eyebrow">
              THE REASONING ADVENTURE
            </span>

            <h1>
              Think twice.
              <br />
              <em>Then decide.</em>
            </h1>

            <p className="home-description">
              DecisionEcho helps you examine
              the reasoning behind an investment
              decision before you commit.
              Capture your case, expose its
              dependencies, confront the strongest
              opposing argument, and test what
              happens when an important assumption
              breaks.
            </p>

            <div className="home-actions">
              <button
                className="primary-button large"
                onClick={() => {
                  setForm(
                    INITIAL_FORM
                  );
                  setInputStep(0);
                  setError("");
                  move("input");
                }}
              >
                Enter the journey
                <span>→</span>
              </button>

              <p className="home-disclaimer">
                You provide the judgment.
                DecisionEcho provides the pressure.
              </p>
            </div>

            <div className="home-method">
              {[
                [
                  "01",
                  "Enter",
                  "State what you believe.",
                ],
                [
                  "02",
                  "Reveal",
                  "See what the system heard.",
                ],
                [
                  "03",
                  "Challenge",
                  "Confront the strongest case.",
                ],
                [
                  "04",
                  "Test",
                  "Break a dependency.",
                ],
              ].map(
                ([number, title, text]) => (
                  <div
                    className="method-item"
                    key={number}
                  >
                    <span>{number}</span>
                    <strong>{title}</strong>
                    <p>{text}</p>
                  </div>
                )
              )}
            </div>
          </section>

          <section className="home-visual">
            <div className="home-grid-lines" />

            <div className="floating-insight top">
              <span>◎</span>
              <div>
                <strong>Echo</strong>
                <small>
                  Here is what I heard…
                </small>
              </div>
            </div>

            <div className="case-orbit orbit-one" />
            <div className="case-orbit orbit-two" />

            <div className="case-preview">
              <div className="case-preview-head">
                <span>
                  DECISION CASE
                </span>
                <span>
                  01 / 07
                </span>
              </div>

              <div className="case-preview-title">
                A decision starts
                <br />
                with your reasoning.
              </div>

              <div className="preview-chain">
                <div className="preview-node active">
                  <span>01</span>
                  <strong>
                    Thesis
                  </strong>
                  <small>
                    What you believe
                  </small>
                </div>

                <div className="preview-connector" />

                <div className="preview-node">
                  <span>02</span>
                  <strong>
                    Dependency
                  </strong>
                  <small>
                    What it relies on
                  </small>
                </div>

                <div className="preview-connector" />

                <div className="preview-node">
                  <span>03</span>
                  <strong>
                    Challenge
                  </strong>
                  <small>
                    What could change it
                  </small>
                </div>
              </div>

              <div className="case-preview-foot">
                <span>
                  AI challenges
                </span>

                <strong>
                  You decide
                </strong>
              </div>
            </div>

            <div className="floating-insight bottom">
              <span>↯</span>
              <div>
                <strong>
                  Stress test
                </strong>
                <small>
                  Break one dependency.
                </small>
              </div>
            </div>
          </section>
        </main>

        <Footer />
      </div>
    );
  }

  /*
   |--------------------------------------------------------------------------
   | COMPLETE
   |--------------------------------------------------------------------------
   */

  if (screen === "complete") {
    return (
      <div className="app-shell">
        <header className="topbar">
          <button
            className="brand"
            onClick={resetReview}
          >
            <span className="brand-mark">
              DE
            </span>

            <span className="brand-copy">
              <strong>
                DecisionEcho
              </strong>

              <small>
                Think twice. Then decide.
              </small>
            </span>
          </button>
        </header>

        <main className="complete-page">
          <div className="complete-icon">
            ✓
          </div>

          <span className="eyebrow">
            REVIEW COMPLETE
          </span>

          <h1>
            Your reasoning
            <br />
            is now visible.
          </h1>

          <p className="complete-description">
            The review challenged your
            reasoning without making the
            investment decision for you.
          </p>

          <div className="complete-metrics">
            <MetricCard
              label="CONFIDENCE"
              value={`${form.confidence} → ${finalConfidence}`}
              note={
                confidenceDelta === 0
                  ? "No change"
                  : `${confidenceDelta > 0 ? "+" : ""}${confidenceDelta} point change`
              }
            />

            <MetricCard
              label="DEPENDENCIES"
              value={confirmedAssumptions.length}
              note="confirmed"
            />

            <MetricCard
              label="DISCOVERIES"
              value={discoveryCount}
              note="across the journey"
            />

            <MetricCard
              label="SESSION"
              value={
                completePayload
                  ? "Saved"
                  : "Complete"
              }
              note="backend record"
            />
          </div>

          {robustnessAssessment && (
            <section className="robustness-results" aria-labelledby="robustness-results-title">
              <div className="robustness-results-heading">
                <div>
                  <span className="robustness-overline">DECISION ROBUSTNESS FRAMEWORK</span>
                  <h2 id="robustness-results-title">
                    {robustnessAssessment.overall_score}/100
                  </h2>
                  <p>{robustnessAssessment.label}</p>
                </div>
                <div className="robustness-method-note">
                  <strong>Prototype heuristic</strong>
                  <span>Based on your ratings and recorded journey signals. It does not verify facts or predict investment outcomes.</span>
                </div>
              </div>

              <div className="robustness-dimensions">
                {robustnessAssessment.dimensions.map((dimension) => (
                  <article className="robustness-dimension" key={dimension.key}>
                    <div className="robustness-dimension-head">
                      <div>
                        <h3>{dimension.label}</h3>
                        <p>{dimension.interpretation}</p>
                      </div>
                      <strong>{dimension.score}</strong>
                    </div>
                    <div className="robustness-score-track" role="img" aria-label={`${dimension.label}: ${dimension.score} out of 100`}>
                      <span style={{ width: `${dimension.score}%` }} />
                    </div>
                    <small>{dimension.basis}</small>
                  </article>
                ))}
              </div>

              <p className="robustness-limitations">
                This experimental score is a reflection aid, not a validated measure of investment quality. A higher score does not mean that an investment is suitable or likely to perform well.
              </p>
            </section>
          )}

          <section className="final-record">
            <span>
              FINAL REFLECTION
            </span>

            <p>
              {finalReflection}
            </p>
          </section>

          <div className="human-control large-control">
            <strong>
              Your decision remains yours.
            </strong>

            <span>
              DecisionEcho is a reasoning-support
              prototype. It does not provide
              financial advice, buy/sell
              recommendations, or outcome
              predictions.
            </span>
          </div>

          <button
            className="primary-button large"
            onClick={resetReview}
          >
            Start another review
            <span>→</span>
          </button>
        </main>

        <Footer />
      </div>
    );
  }

  /*
   |--------------------------------------------------------------------------
   | JOURNEY SCREENS
   |--------------------------------------------------------------------------
   */

  return (
    <div className="app-shell">
      <header className="topbar">
        <button
          className="brand"
          onClick={resetReview}
        >
          <span className="brand-mark">
            DE
          </span>

          <span className="brand-copy">
            <strong>
              DecisionEcho
            </strong>

            <small>
              Think twice. Then decide.
            </small>
          </span>
        </button>

        <div className="topbar-right">
          <span className="discovery-count">
            ✦ {discoveryCount} discoveries
          </span>

          {loading && (
            <span className="loading-status">
              <i />
              {loadingText}
            </span>
          )}

          <button
            className="ghost-button"
            onClick={resetReview}
          >
            Exit review
          </button>
        </div>
      </header>

      <JourneyRail
        currentIndex={
          currentJourneyIndex
        }
      />

      {error && (
        <div
          className="error-banner"
          role="alert"
        >
          <div className="error-symbol">
            !
          </div>

          <div>
            <strong>
              Something needs attention
            </strong>

            <p>{error}</p>
          </div>

          <button
            onClick={() =>
              setError("")
            }
            aria-label="Close error"
          >
            ×
          </button>
        </div>
      )}

      <main className="workspace">
        {screen === "input" && (
          <InputExperience
            form={form}
            step={inputStep}
            updateForm={updateForm}
            updateEvidence={
              updateEvidence
            }
            onNext={
              continueInputJourney
            }
            onBack={
              backInputJourney
            }
            loading={loading}
            evidenceCount={
              evidenceCount
            }
          />
        )}

        {screen === "echo" &&
          analysis && (
            <EchoStage
              form={form}
              analysis={analysis}
              exploredBlindspots={
                exploredBlindspots
              }
              toggleBlindspot={
                toggleBlindspot
              }
              onBack={() =>
                move("input")
              }
              onNext={() =>
                move("assumptions")
              }
            />
          )}

        {screen === "assumptions" && (
          <AssumptionsStage
            assumptions={
              assumptions
            }
            updateAssumption={
              updateAssumption
            }
            addAssumption={
              addAssumption
            }
            removeAssumption={
              removeAssumption
            }
            onBack={() =>
              move("echo")
            }
            onNext={
              saveAssumptions
            }
            loading={loading}
          />
        )}

        {screen === "challenge" && (
          <ChallengeStage
            options={
              challengeOptions
            }
            selected={
              selectedChallenge
            }
            setSelected={
              setSelectedChallenge
            }
            intensity={
              form.challenge_intensity
            }
            onBack={() =>
              move("assumptions")
            }
            onNext={
              generateSteelman
            }
            loading={loading}
          />
        )}

        {screen === "steelman" &&
          steelman && (
            <SteelmanStage
              steelman={
                steelman
              }
              selectedChallenge={
                selectedChallenge
              }
              impact={
                steelmanImpact
              }
              setImpact={
                setSteelmanImpact
              }
              response={
                steelmanResponse
              }
              setResponse={
                setSteelmanResponse
              }
              onBack={() =>
                move("challenge")
              }
              onNext={
                saveSteelmanAndOpenStress
              }
              loading={loading}
            />
          )}

        {screen === "stress" &&
          stressTest &&
          selectedAssumption && (
            <StressStage
              assumptions={
                confirmedAssumptions
              }
              selectedAssumption={
                selectedAssumption
              }
              setSelectedAssumption={
                changeStressAssumption
              }
              stressTest={
                stressTest
              }
              impact={
                stressImpact
              }
              setImpact={
                setStressImpact
              }
              response={
                stressResponse
              }
              setResponse={
                setStressResponse
              }
              onBack={() =>
                move("steelman")
              }
              onNext={
                saveStressAndReflect
              }
              loading={loading}
            />
          )}

        {screen === "reflection" && (
          <ReflectionStage
            assetName={
              form.asset_name
            }
            initialConfidence={
              Number(
                form.confidence
              )
            }
            finalConfidence={
              finalConfidence
            }
            setFinalConfidence={
              setFinalConfidence
            }
            confidenceDelta={
              confidenceDelta
            }
            reflection={
              finalReflection
            }
            setReflection={
              setFinalReflection
            }
            exploredBlindspots={
              exploredBlindspots
            }
            robustnessRatings={robustnessRatings}
            setRobustnessRatings={setRobustnessRatings}
            robustnessRatingsComplete={robustnessRatingsComplete}
            steelmanImpact={
              steelmanImpact
            }
            stressImpact={
              stressImpact
            }
            onBack={() =>
              move("stress")
            }
            onNext={
              saveReflection
            }
            loading={loading}
          />
        )}
      </main>

      <Footer />
    </div>
  );
}

/*
|--------------------------------------------------------------------------
| JOURNEY RAIL
|--------------------------------------------------------------------------
*/

function JourneyRail({ currentIndex }) {
  return (
    <section className="journey-rail">
      <div className="journey-heading">
        <div>
          <span>
            THE REASONING ADVENTURE
          </span>

          <strong>
            Chapter{" "}
            {String(
              currentIndex + 1
            ).padStart(2, "0")}{" "}
            ·{" "}
            {
              JOURNEY[
                currentIndex
              ]?.title
            }
          </strong>
        </div>

        <small>
          {currentIndex + 1} /{" "}
          {JOURNEY.length}
        </small>
      </div>

      <div className="journey-items">
        {JOURNEY.map(
          (chapter, index) => (
            <div
              key={
                chapter.key
              }
              className={`journey-item ${
                index === currentIndex
                  ? "current"
                  : ""
              } ${
                index < currentIndex
                  ? "done"
                  : ""
              }`}
            >
              <span>
                {index <
                currentIndex
                  ? "✓"
                  : chapter.number}
              </span>

              <div>
                <strong>
                  {chapter.title}
                </strong>

                <small>
                  {chapter.verb}
                </small>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}

/*
|--------------------------------------------------------------------------
| INPUT EXPERIENCE
|--------------------------------------------------------------------------
*/

function InputExperience({
  form,
  step,
  updateForm,
  updateEvidence,
  onNext,
  onBack,
  loading,
  evidenceCount,
}) {
  const steps = [
    {
      number: "01",
      label: "Target",
      kicker: "THE THESIS",
      title:
        "What has your attention?",
      description:
        "Start with the company, asset, fund, or instrument behind the decision.",
      button:
        "Set the target",
    },
    {
      number: "02",
      label: "Intent",
      kicker: "THE THESIS",
      title:
        "What are you considering?",
      description:
        "Choose the decision you are actually evaluating.",
      button:
        "Set the intent",
    },
    {
      number: "03",
      label: "Thesis",
      kicker: "THE THESIS",
      title:
        "Why does this decision make sense to you?",
      description:
        "Give DecisionEcho the reasoning you genuinely have.",
      button:
        "Shape the thesis",
    },
    {
      number: "04",
      label: "Clues",
      kicker: "THE THESIS",
      title:
        "What supports your thinking?",
      description:
        "Add a few concrete observations behind your thesis.",
      button:
        "Add the clues",
    },
    {
      number: "05",
      label: "Context",
      kicker: "THE THESIS",
      title:
        "How convinced are you?",
      description:
        "Set your starting confidence and decide how deeply the Echo should challenge you.",
      button:
        "Enter the Echo",
    },
  ];

  const current =
    steps[step];

  return (
    <section className="experience-layout">
      <div className="experience-main">
        <div className="chapter-header">
          <div>
            <span className="chapter-kicker">
              {current.kicker}
            </span>

            <h1>
              {current.title}
            </h1>

            <p>
              {current.description}
            </p>
          </div>

          <span className="chapter-counter">
            {step + 1} / 05
          </span>
        </div>

        <div className="local-steps">
          {steps.map(
            (item, index) => (
              <div
                key={
                  item.number
                }
                className={
                  index === step
                    ? "local-step current"
                    : index < step
                    ? "local-step visited"
                    : "local-step"
                }
              >
                <span>
                  {item.number}
                </span>

                <strong>
                  {item.label}
                </strong>
              </div>
            )
          )}
        </div>

        <div className="interaction-panel">
          {step === 0 && (
            <div className="input-section">
              <label>
                YOUR TARGET
              </label>

              <input
                autoFocus
                value={
                  form.asset_name
                }
                onChange={(e) =>
                  updateForm(
                    "asset_name",
                    e.target.value
                  )
                }
                placeholder="e.g. Tata Motors"
              />

              <p className="input-help">
                Company, asset,
                fund, or
                instrument.
              </p>
            </div>
          )}

          {step === 1 && (
            <div className="input-section">
              <label>
                YOUR INTENT
              </label>

              <div className="intent-grid">
                {[
                  [
                    "Considering investing",
                    "Evaluate a possible entry",
                  ],
                  [
                    "Considering holding",
                    "Re-examine an existing position",
                  ],
                  [
                    "Considering reducing exposure",
                    "Question current exposure",
                  ],
                ].map(
                  ([
                    value,
                    description,
                  ]) => (
                    <button
                      key={value}
                      type="button"
                      className={
                        form.decision_intent ===
                        value
                          ? "intent-card selected"
                          : "intent-card"
                      }
                      onClick={() =>
                        updateForm(
                          "decision_intent",
                          value
                        )
                      }
                    >
                      <span>
                        {form.decision_intent ===
                        value
                          ? "✓"
                          : "○"}
                      </span>

                      <strong>
                        {value.replace(
                          "Considering ",
                          ""
                        )}
                      </strong>

                      <small>
                        {
                          description
                        }
                      </small>
                    </button>
                  )
                )}
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="input-section">
              <label>
                YOUR THESIS
              </label>

              <textarea
                autoFocus
                value={
                  form.thesis
                }
                onChange={(e) =>
                  updateForm(
                    "thesis",
                    e.target.value
                  )
                }
                rows={9}
                placeholder="My reasoning is that…"
              />

              <div className="textarea-meta">
                <span>
                  {
                    form.thesis
                      .trim()
                      .length
                  }{" "}
                  characters
                </span>

                <span>
                  DecisionEcho will
                  challenge this
                  reasoning later.
                </span>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="input-section">
              <div className="evidence-heading">
                <div>
                  <label>
                    YOUR CLUES
                  </label>

                  <p>
                    Use evidence you are
                    actually relying on.
                  </p>
                </div>

                <span>
                  {evidenceCount}
                  / 3
                </span>
              </div>

              <div className="clue-grid">
                {form.evidence.map(
                  (
                    evidence,
                    index
                  ) => (
                    <div
                      className={
                        evidence.trim()
                          ? "clue-card filled"
                          : "clue-card"
                      }
                      key={index}
                    >
                      <div className="clue-head">
                        <span>
                          {String(
                            index + 1
                          ).padStart(
                            2,
                            "0"
                          )}
                        </span>

                        <strong>
                          {index === 0
                            ? "MARKET"
                            : index ===
                              1
                            ? "BUSINESS"
                            : "OTHER SIGNAL"}
                        </strong>
                      </div>

                      <textarea
                        value={
                          evidence
                        }
                        onChange={(
                          e
                        ) =>
                          updateEvidence(
                            index,
                            e.target
                              .value
                          )
                        }
                        rows={5}
                        placeholder={
                          index ===
                          0
                            ? "What market observation supports your thinking?"
                            : index ===
                              1
                            ? "What business observation supports your thinking?"
                            : "What other signal matters?"
                        }
                      />
                    </div>
                  )
                )}
              </div>
            </div>
          )}

          {step === 4 && (
            <div className="input-section">
              <div className="context-block">
                <div className="context-heading">
                  <div>
                    <label>
                      STARTING CONFIDENCE
                    </label>

                    <p>
                      This is your
                      starting
                      reflection
                      measure.
                    </p>
                  </div>

                  <strong>
                    {
                      form.confidence
                    }
                    /5
                  </strong>
                </div>

                <div className="confidence-grid">
                  {[1, 2, 3, 4, 5].map(
                    (value) => (
                      <button
                        key={value}
                        type="button"
                        className={
                          Number(
                            form.confidence
                          ) ===
                          value
                            ? "confidence-card selected"
                            : "confidence-card"
                        }
                        onClick={() =>
                          updateForm(
                            "confidence",
                            value
                          )
                        }
                      >
                        <strong>
                          {value}
                        </strong>

                        <small>
                          {
                            CONFIDENCE_LABELS[
                              value
                            ]
                          }
                        </small>
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="context-block">
                <div className="context-heading">
                  <div>
                    <label>
                      CHALLENGE INTENSITY
                    </label>

                    <p>
                      Choose how hard
                      the Echo pushes.
                    </p>
                  </div>

                  <strong>
                    {
                      form.challenge_intensity
                    }
                  </strong>
                </div>

                <div className="intensity-grid">
                  {[
                    [
                      "Gentle",
                      "Clear alternatives",
                    ],
                    [
                      "Balanced",
                      "Multiple angles",
                    ],
                    [
                      "Deep",
                      "Harder pressure",
                    ],
                  ].map(
                    ([
                      value,
                      description,
                    ]) => (
                      <button
                        key={value}
                        type="button"
                        className={
                          form.challenge_intensity ===
                          value
                            ? "intensity-card selected"
                            : "intensity-card"
                        }
                        onClick={() =>
                          updateForm(
                            "challenge_intensity",
                            value
                          )
                        }
                      >
                        <strong>
                          {value}
                        </strong>

                        <small>
                          {
                            description
                          }
                        </small>
                      </button>
                    )
                  )}
                </div>
              </div>

              <div className="control-note">
                <span>
                  YOUR ROLE
                </span>

                <p>
                  You provide the
                  judgment.
                  DecisionEcho
                  provides the
                  pressure.
                </p>
              </div>
            </div>
          )}

          <div className="action-row">
            <button
              className="back-link"
              onClick={onBack}
              type="button"
              disabled={loading}
            >
              ←{" "}
              {step === 0
                ? "Home"
                : "Back"}
            </button>

            <button
              className="primary-button"
              onClick={onNext}
              type="button"
              disabled={loading}
            >
              {loading
                ? "Opening…"
                : current.button}

              <span>→</span>
            </button>
          </div>
        </div>
      </div>

      <aside className="case-side">
        <div className="case-visual">
          <div className="visual-top">
            <span>
              FIELD VIEW
            </span>

            <span>
              {String(
                step + 1
              ).padStart(
                2,
                "0"
              )}{" "}
              / 05
            </span>
          </div>

          <div className="visual-grid" />

          <div className="visual-orbit outer" />
          <div className="visual-orbit inner" />

          <div className="visual-core">
            <span>
              {current.label.toUpperCase()}
            </span>

            <strong>
              {step === 0
                ? "Name the case"
                : step === 1
                ? "Define the decision"
                : step === 2
                ? "State the reasoning"
                : step === 3
                ? "Collect the evidence"
                : "Set the pressure"}
            </strong>
          </div>

          <div className="visual-caption">
            <span>
              THE CASE GROWS
            </span>

            <p>
              One meaningful
              piece at a time.
            </p>
          </div>
        </div>

        <div className="case-summary">
          <span>
            CASE
          </span>

          <strong>
            {form.asset_name ||
              "Not set yet"}
          </strong>

          <div className="case-summary-line">
            <span>
              Intent
            </span>

            <b>
              {
                form.decision_intent
              }
            </b>
          </div>

          <div className="case-summary-line">
            <span>
              Confidence
            </span>

            <b>
              {
                form.confidence
              }
              /5
            </b>
          </div>

          <div className="side-progress">
            <i
              style={{
                width: `${
                  ((step + 1) /
                    5) *
                  100
                }%`,
              }}
            />
          </div>
        </div>
      </aside>
    </section>
  );
}

/*
|--------------------------------------------------------------------------
| ECHO STAGE
|--------------------------------------------------------------------------
*/

function EchoStage({
  form,
  analysis,
  exploredBlindspots,
  toggleBlindspot,
  onBack,
  onNext,
}) {
  const [activeType, setActiveType] = useState("claims");
  const [activeIndex, setActiveIndex] = useState(0);
  const [signalOpen, setSignalOpen] = useState(false);
  const [touchStartX, setTouchStartX] = useState(null);
  const [slideDirection, setSlideDirection] = useState("slide-in");

  const claims = analysis?.keyClaims || [];
  const assumptions = analysis?.assumptions || [];
  const alternatives = analysis?.alternatives || [];
  const blindSpots = analysis?.blindSpots || [];

  const decks = [
    {
      key: "claims",
      label: "Claims",
      eyebrow: "WHAT WE HEARD",
      title: "Your reasoning",
      items: claims,
      empty: "No explicit claims were returned.",
    },
    {
      key: "dependencies",
      label: "Dependencies",
      eyebrow: "WHAT THIS RELIES ON",
      title: "Your reasoning depends on",
      items: assumptions,
      empty: "No potential dependencies were returned.",
    },
    {
      key: "alternatives",
      label: "Alternative stories",
      eyebrow: "ANOTHER WAY TO READ THIS",
      title: "Alternative explanations",
      items: alternatives,
      empty: "No alternative explanations were returned.",
    },
    {
      key: "blindspots",
      label: "Explore",
      eyebrow: "AREAS WORTH EXPLORING",
      title: "Reasoning areas not yet explored",
      items: blindSpots,
      empty: "No specific reasoning-gap hypotheses were returned.",
    },
  ];

  const currentDeck =
    decks.find((deck) => deck.key === activeType) ||
    decks[0];

  const items = currentDeck.items || [];
  const total = items.length;

  const safeIndex =
    total > 0
      ? Math.min(activeIndex, total - 1)
      : 0;

  const currentItem =
    total > 0
      ? items[safeIndex]
      : "";

  const previousItem =
    total > 1
      ? items[
          safeIndex === 0
            ? total - 1
            : safeIndex - 1
        ]
      : null;

  const nextItem =
    total > 1
      ? items[
          safeIndex === total - 1
            ? 0
            : safeIndex + 1
        ]
      : null;

  function switchDeck(key) {
    setActiveType(key);
    setActiveIndex(0);
    setSlideDirection("slide-in");
    setSignalOpen(false);
  }

  function goToCard(nextIndex, direction = "next") {
    if (!total) return;

    let target = nextIndex;

    if (target < 0) {
      target = total - 1;
    }

    if (target >= total) {
      target = 0;
    }

    setSlideDirection(
      direction === "prev"
        ? "slide-from-left"
        : "slide-from-right"
    );

    setActiveIndex(target);
  }

  function nextCard() {
    if (!total) return;
    goToCard(safeIndex + 1, "next");
  }

  function previousCard() {
    if (!total) return;
    goToCard(safeIndex - 1, "prev");
  }

  function handleTouchStart(event) {
    setTouchStartX(
      event.touches?.[0]?.clientX ?? null
    );
  }

  function handleTouchEnd(event) {
    if (touchStartX === null) return;

    const endX =
      event.changedTouches?.[0]?.clientX ??
      touchStartX;

    const distance = endX - touchStartX;

    if (Math.abs(distance) > 50) {
      if (distance < 0) {
        nextCard();
      } else {
        previousCard();
      }
    }

    setTouchStartX(null);
  }

  function isBlindspotSelected(item) {
    return exploredBlindspots.includes(item);
  }

  function renderCardContent(item) {
    const selected =
      activeType === "blindspots" &&
      isBlindspotSelected(item);

    if (activeType === "claims") {
      return (
        <>
          <div className="echo-card-type">
            YOUR CLAIM
          </div>

          <h3>{item}</h3>

          <p className="echo-card-description">
            This is part of the reasoning DecisionEcho
            heard in your original case.
          </p>

          <div className="echo-card-footer">
            <span>
              Claim {safeIndex + 1} of {total}
            </span>

            <span className="echo-card-hint">
              What you believe
            </span>
          </div>
        </>
      );
    }

    if (activeType === "dependencies") {
      return (
        <>
          <div className="echo-card-type">
            POTENTIAL DEPENDENCY
          </div>

          <h3>{item}</h3>

          <p className="echo-card-description">
            This is a condition your reasoning may
            depend on. You will review and confirm it
            in the next stage.
          </p>

          <div className="echo-card-footer">
            <span>
              Dependency {safeIndex + 1} of {total}
            </span>

            <span className="echo-card-hint">
              What this reasoning relies on
            </span>
          </div>
        </>
      );
    }

    if (activeType === "alternatives") {
      return (
        <>
          <div className="echo-card-type">
            ALTERNATIVE STORY
          </div>

          <h3>{item}</h3>

          <p className="echo-card-description">
            The same evidence can sometimes support a
            different explanation. This is a possibility
            to examine, not a confirmed conclusion.
          </p>

          <div className="echo-card-footer">
            <span>
              Story {safeIndex + 1} of {total}
            </span>

            <span className="echo-card-hint">
              Another possible interpretation
            </span>
          </div>
        </>
      );
    }

    return (
      <>
        <div className="echo-card-type">
          POTENTIAL BLIND SPOT
        </div>

        <h3>{item}</h3>

        <p className="echo-card-description">
          This reasoning area does not appear to be
          explicitly covered in the case you submitted.
          It is a coverage prompt, not a diagnosis.
        </p>

        <div className="echo-card-action">
          <button
            type="button"
            className={
              selected
                ? "echo-explore-button selected"
                : "echo-explore-button"
            }
            onClick={() =>
              toggleBlindspot(item)
            }
          >
            <span>
              {selected ? "✓" : "+"}
            </span>

            {selected
              ? "Carrying into the review"
              : "Mark this area to explore"}
          </button>
        </div>

        <div className="echo-card-footer">
          <span>
            Area {safeIndex + 1} of {total}
          </span>

          <span className="echo-card-hint">
            Reasoning coverage
          </span>
        </div>
      </>
    );
  }

  return (
    <StageLayout
      number="02"
      kicker="ECHO"
      title="Here is what DecisionEcho heard."
      description={`This is an AI interpretation of your ${
        form.asset_name || "decision"
      } case—not a verdict. Explore one layer at a time before moving into the pressure test.`}
      onBack={onBack}
      onNext={onNext}
      nextText="Uncover the dependencies →"
      asideTitle="Reflection before pressure"
      asideText="Explore the reasoning layer by layer. You stay in control of what deserves deeper attention."
      asideItems={[
        [
          "CLAIMS",
          `${claims.length} surfaced`,
        ],
        [
          "DEPENDENCIES",
          `${assumptions.length} proposed`,
        ],
        [
          "EXPLORATION",
          `${exploredBlindspots.length} marked`,
        ],
      ]}
    >
      {/* AI identity banner */}
      <div className="ai-banner echo-ai-banner">
        <div className="ai-badge">
          AI
        </div>

        <div>
          <strong>
            AI interpretation
          </strong>

          <p>
            These are hypotheses about your reasoning.
            Move through them, inspect them, and decide
            what deserves a closer look.
          </p>
        </div>
      </div>

      {/* Interactive reasoning map */}
      <section className="reasoning-map echo-map">
        <div className="content-header">
          <div className="content-header-copy">
            <strong>
              REASONING MAP
            </strong>

            <p>
              Jump directly between the layers
              DecisionEcho found.
            </p>
          </div>

          <span className="content-header-tag">
            Interactive
          </span>
        </div>

        <div className="reasoning-map-grid echo-map-grid">
          <button
            type="button"
            className={
              activeType === "claims"
                ? "map-node echo-map-node active"
                : "map-node echo-map-node"
            }
            onClick={() =>
              switchDeck("claims")
            }
          >
            <span>01</span>

            <strong>
              CLAIM
            </strong>

            <p>
              What you said you believe
            </p>
          </button>

          <div className="map-arrow">
            →
          </div>

          <button
            type="button"
            className={
              activeType === "dependencies"
                ? "map-node echo-map-node active"
                : "map-node echo-map-node"
            }
            onClick={() =>
              switchDeck("dependencies")
            }
          >
            <span>02</span>

            <strong>
              DEPENDENCY
            </strong>

            <p>
              What the reasoning may rely on
            </p>
          </button>

          <div className="map-arrow">
            →
          </div>

          <button
            type="button"
            className={
              activeType === "blindspots"
                ? "map-node echo-map-node active"
                : "map-node echo-map-node"
            }
            onClick={() =>
              switchDeck("blindspots")
            }
          >
            <span>03</span>

            <strong>
              EXPLORE
            </strong>

            <p>
              What may deserve attention
            </p>
          </button>
        </div>
      </section>

      {/* Discovery deck */}
      <section className="echo-discovery">
        <div className="echo-discovery-header">
          <div>
            <span className="echo-section-label">
              DISCOVERY DECK
            </span>

            <h2>
              Explore the interpretation.
            </h2>
          </div>

          <div className="echo-discovery-progress">
            <strong>
              {total ? safeIndex + 1 : 0}
            </strong>

            <span>
              / {total}
            </span>
          </div>
        </div>

        {/* Category tabs */}
        <div className="echo-tabs">
          {decks.map((deck) => (
            <button
              type="button"
              key={deck.key}
              className={
                activeType === deck.key
                  ? "echo-tab active"
                  : "echo-tab"
              }
              onClick={() =>
                switchDeck(deck.key)
              }
            >
              <span>
                {deck.label}
              </span>

              <small>
                {deck.items.length}
              </small>
            </button>
          ))}
        </div>

        {total > 0 ? (
          <>
            {/* Card stack */}
            <div
              className={`echo-card-deck ${slideDirection}`}
              onTouchStart={handleTouchStart}
              onTouchEnd={handleTouchEnd}
            >
              {previousItem && (
                <div className="echo-card echo-card-preview previous">
                  <span className="echo-preview-label">
                    PREVIOUS
                  </span>

                  <p>
                    {previousItem}
                  </p>
                </div>
              )}

              <article
                key={`${activeType}-${safeIndex}`}
                className="echo-card echo-card-active"
              >
                <div className="echo-card-topline">
                  <span>
                    {currentDeck.eyebrow}
                  </span>

                  <span>
                    {String(
                      safeIndex + 1
                    ).padStart(2, "0")}{" "}
                    /{" "}
                    {String(total).padStart(2, "0")}
                  </span>
                </div>

                {renderCardContent(
                  currentItem
                )}
              </article>

              {nextItem && (
                <div className="echo-card echo-card-preview next">
                  <span className="echo-preview-label">
                    NEXT
                  </span>

                  <p>
                    {nextItem}
                  </p>
                </div>
              )}
            </div>

            {/* Slider controls */}
            <div className="echo-controls">
              <button
                type="button"
                className="echo-arrow"
                onClick={previousCard}
                aria-label="Previous card"
              >
                ←
              </button>

              <div className="echo-dots">
                {items.map(
                  (_, index) => (
                    <button
                      type="button"
                      key={index}
                      className={
                        index === safeIndex
                          ? "echo-dot active"
                          : "echo-dot"
                      }
                      onClick={() =>
                        goToCard(
                          index,
                          index < safeIndex
                            ? "prev"
                            : "next"
                        )
                      }
                      aria-label={`Go to ${
                        currentDeck.label
                      } card ${index + 1}`}
                    />
                  )
                )}
              </div>

              <button
                type="button"
                className="echo-arrow"
                onClick={nextCard}
                aria-label="Next card"
              >
                →
              </button>
            </div>

            <div className="echo-swipe-hint">
              <span>←</span>
              <span>
                Swipe or use the arrows to explore
              </span>
              <span>→</span>
            </div>
          </>
        ) : (
          <EmptyState text={currentDeck.empty} />
        )}
      </section>

      {/* Early opposing signal */}
      {analysis?.strongestCounterargument && (
        <section className="echo-signal-card">
          <button
            type="button"
            className="echo-signal-trigger"
            onClick={() =>
              setSignalOpen(
                (previous) => !previous
              )
            }
          >
            <div>
              <span>
                EARLY OPPOSING SIGNAL
              </span>

              <strong>
                A first challenge is already visible.
              </strong>
            </div>

            <span className="echo-signal-toggle">
              {signalOpen ? "−" : "+"}
            </span>
          </button>

          {signalOpen && (
            <div className="echo-signal-body">
              <p>
                {
                  analysis.strongestCounterargument
                }
              </p>

              <small>
                This is an early challenge to explore
                later in Opposition / Steelman.
              </small>
            </div>
          )}
        </section>
      )}

      {/* Discovery summary */}
      <div className="echo-bottom-summary">
        <div>
          <span>
            CURRENT DISCOVERY
          </span>

          <strong>
            {currentDeck.title}
          </strong>
        </div>

        <div className="echo-summary-stats">
          <span>
            {claims.length} claims
          </span>

          <span>
            {assumptions.length} dependencies
          </span>

          <span>
            {alternatives.length} alternatives
          </span>

          <span>
            {exploredBlindspots.length} explored
          </span>
        </div>
      </div>
    </StageLayout>
  );
}


/*
|--------------------------------------------------------------------------
| ASSUMPTIONS STAGE
|--------------------------------------------------------------------------
*/

function AssumptionsStage({
  assumptions,
  updateAssumption,
  addAssumption,
  removeAssumption,
  onBack,
  onNext,
  loading,
}) {
  return (
    <StageLayout
      number="03"
      kicker="DEPENDENCIES"
      title="What has to be true for your reasoning to hold?"
      description="DecisionEcho proposes dependencies based on your thesis. You verify them before the system is allowed to challenge them."
      onBack={onBack}
      onNext={onNext}
      nextText="Open the challenge →"
      loading={loading}
      asideTitle="Human verification"
      asideText="The AI proposes. You confirm. That distinction stays visible throughout the journey."
      asideItems={[
        [
          "EDIT",
          "Rewrite anything the system misunderstood.",
        ],
        [
          "PRIORITISE",
          "Mark which dependency matters most.",
        ],
        [
          "CONFIRM",
          "Only confirmed assumptions enter the stress workflow.",
        ],
      ]}
    >
      <div className="info-strip">
        <strong>
          Important distinction
        </strong>

        <span>
          An assumption is a condition your
          reasoning appears to depend on.
          It is not a fact or a prediction.
        </span>
      </div>

      <div className="assumption-stack">
        {assumptions.map(
          (
            item,
            index
          ) => (
            <article
              key={
                item.localId
              }
              className={
                item.confirmed
                  ? "assumption-card-large confirmed"
                  : "assumption-card-large"
              }
            >
              <div className="assumption-number">
                {String(
                  index + 1
                ).padStart(
                  2,
                  "0"
                )}
              </div>

              <div className="assumption-main">
                <div className="assumption-meta">
                  <span>
                    POTENTIAL DEPENDENCY
                  </span>

                  <b>
                    {item.confirmed
                      ? "Confirmed"
                      : "Needs confirmation"}
                  </b>
                </div>

                <textarea
                  value={
                    item.content
                  }
                  onChange={(
                    e
                  ) =>
                    updateAssumption(
                      item.localId,
                      "content",
                      e.target
                        .value
                    )
                  }
                  rows={3}
                />

                <div className="assumption-controls">
                  <div className="importance-group">
                    <span>
                      IMPORTANCE
                    </span>

                    <div>
                      {[
                        [
                          1,
                          "Supporting",
                        ],
                        [
                          2,
                          "Important",
                        ],
                        [
                          3,
                          "Critical",
                        ],
                      ].map(
                        ([
                          value,
                          label,
                        ]) => (
                          <button
                            key={
                              value
                            }
                            type="button"
                            className={
                              Number(
                                item.importance
                              ) ===
                              value
                                ? "mini-option selected"
                                : "mini-option"
                            }
                            onClick={() =>
                              updateAssumption(
                                item.localId,
                                "importance",
                                value
                              )
                            }
                          >
                            {label}
                          </button>
                        )
                      )}
                    </div>
                  </div>

                  <div className="assumption-actions">
                    <button
                      type="button"
                      className={
                        item.confirmed
                          ? "confirm-button selected"
                          : "confirm-button"
                      }
                      onClick={() =>
                        updateAssumption(
                          item.localId,
                          "confirmed",
                          !item.confirmed
                        )
                      }
                    >
                      {item.confirmed
                        ? "✓ Confirmed"
                        : "Confirm"}
                    </button>

                    <button
                      type="button"
                      className="remove-button"
                      onClick={() =>
                        removeAssumption(
                          item.localId
                        )
                      }
                    >
                      Remove
                    </button>
                  </div>
                </div>
              </div>
            </article>
          )
        )}
      </div>

      <button
        type="button"
        className="add-button"
        onClick={
          addAssumption
        }
      >
        + Add an assumption of your own
      </button>
    </StageLayout>
  );
}

/*
|--------------------------------------------------------------------------
| CHALLENGE STAGE
|--------------------------------------------------------------------------
*/

function ChallengeStage({
  options,
  selected,
  setSelected,
  intensity,
  onBack,
  onNext,
  loading,
}) {
  return (
    <StageLayout
      number="04"
      kicker="CHALLENGE"
      title="Where should we push hardest?"
      description={`Your selected pressure is ${String(intensity).toLowerCase()}. Choose the angle that could most meaningfully complicate your current reasoning.`}
      onBack={onBack}
      onNext={onNext}
      nextText="Confront the opposition →"
      disabled={!selected}
      loading={loading}
      asideTitle="You choose the angle"
      asideText="DecisionEcho does not randomly attack the case. You choose what deserves deeper scrutiny."
      asideItems={[
        [
          "SELECT",
          "Choose the challenge direction that matters most.",
        ],
        [
          "CONFRONT",
          "The AI constructs the strongest reasonable case.",
        ],
        [
          "RESPOND",
          "You decide what the challenge changes.",
        ],
      ]}
    >
      <div className="challenge-guidance">
        <span>
          ↯
        </span>

        <div>
          <strong>
            A useful challenge is specific.
          </strong>

          <p>
            Choose the question that could
            materially weaken, change, or
            complicate your reasoning.
          </p>
        </div>
      </div>

      <div className="challenge-grid">
        {options.map(
          (
            option,
            index
          ) => (
            <button
              type="button"
              key={option.id}
              className={
                selected?.id ===
                option.id
                  ? "challenge-card selected"
                  : "challenge-card"
              }
              onClick={() =>
                setSelected(
                  option
                )
              }
            >
              <div className="challenge-card-top">
                <span>
                  {String(
                    index + 1
                  ).padStart(
                    2,
                    "0"
                  )}
                </span>

                <b>
                  {selected?.id ===
                  option.id
                    ? "✓"
                    : "○"}
                </b>
              </div>

              <h3>
                {option.title}
              </h3>

              <p>
                {
                  option.description
                }
              </p>

              <small>
                Explore this angle →
              </small>
            </button>
          )
        )}
      </div>

      <div className="selection-strip">
        <span>
          SELECTED DIRECTION
        </span>

        <strong>
          {selected?.title ||
            "Choose a challenge direction"}
        </strong>
      </div>
    </StageLayout>
  );
}

/*
|--------------------------------------------------------------------------
| STEELMAN STAGE
|--------------------------------------------------------------------------
*/

function SteelmanStage({
  steelman,
  selectedChallenge,
  impact,
  setImpact,
  response,
  setResponse,
  onBack,
  onNext,
  loading,
}) {
  return (
    <StageLayout
      number="05"
      kicker="OPPOSITION"
      title="Now hear the strongest reasonable case against your reasoning."
      description={`You chose “${selectedChallenge?.title || "the selected challenge"}”. The objective is a fair countercase, not a gotcha.`}
      onBack={onBack}
      onNext={onNext}
      nextText="Break a dependency →"
      disabled={
        !impact ||
        !response.trim()
      }
      loading={loading}
      asideTitle="Steelman, not strawman"
      asideText="The opposing argument should be strong enough that a reasonable person who disagreed with you would recognise it as fair."
      asideItems={[
        [
          "NO GOTCHA",
          "The goal is clarity, not rhetorical victory.",
        ],
        [
          "YOUR RESPONSE",
          "Your reasoning remains visible beside the challenge.",
        ],
        [
          "NEXT",
          "A confirmed dependency will be stress-tested.",
        ],
      ]}
    >
      <div className="opposition-card">
        <span>
          AI-GENERATED COUNTERCASE
        </span>

        <h2>
          {
            steelman.challengeTitle
          }
        </h2>

        <p>
          {
            steelman.alternativeExplanation ||
            "The opposing case was generated from your selected challenge direction."
          }
        </p>
      </div>

      <div className="two-column-content">
        <section className="content-card">
          <div className="content-title">
            WHY IT CHALLENGES YOU
          </div>

          <p className="large-copy">
            {
              steelman.whyItChallenges ||
              "This challenge targets a dependency in your current reasoning."
            }
          </p>
        </section>

        <section className="content-card">
          <div className="content-title">
            WHAT TO EXAMINE
          </div>

          <p className="large-copy">
            {
              steelman.whatToExamine ||
              "Look for evidence that distinguishes the competing explanations."
            }
          </p>
        </section>
      </div>

      {steelman.reflectionQuestions
        ?.length > 0 && (
        <section className="content-card">
          <div className="content-title">
            QUESTIONS TO CARRY FORWARD
          </div>

          <div className="question-list">
            {steelman.reflectionQuestions
              .slice(0, 4)
              .map(
                (
                  question,
                  index
                ) => (
                  <div
                    key={index}
                  >
                    <span>
                      {String(
                        index +
                          1
                      ).padStart(
                        2,
                        "0"
                      )}
                    </span>

                    <p>
                      {question}
                    </p>
                  </div>
                )
              )}
          </div>
        </section>
      )}

      <section className="response-card">
        <label>
          HOW MUCH DID THIS CHANGE YOUR THINKING?
        </label>

        <div className="impact-grid">
          {STEELMAN_IMPACTS.map(
            (item) => (
              <button
                key={
                  item.value
                }
                type="button"
                className={
                  String(
                    impact
                  ) ===
                  item.value
                    ? "impact-option selected"
                    : "impact-option"
                }
                onClick={() =>
                  setImpact(
                    item.value
                  )
                }
              >
                <strong>
                  {
                    item.value
                  }
                </strong>

                <span>
                  {item.label}
                </span>
              </button>
            )
          )}
        </div>

        <label>
          YOUR RESPONSE
        </label>

        <textarea
          value={
            response
          }
          onChange={(e) =>
            setResponse(
              e.target.value
            )
          }
          rows={8}
          placeholder="Defend it, revise it, or explain what became more complicated."
        />
      </section>
    </StageLayout>
  );
}

/*
|--------------------------------------------------------------------------
| STRESS STAGE
|--------------------------------------------------------------------------
*/

function StressStage({
  assumptions,
  selectedAssumption,
  setSelectedAssumption,
  stressTest,
  impact,
  setImpact,
  response,
  setResponse,
  onBack,
  onNext,
  loading,
}) {
  return (
    <StageLayout
      number="06"
      kicker="STRESS TEST"
      title="Break one dependency and see what changes."
      description="Temporarily treat one confirmed dependency as false. The goal is to expose how much your original reasoning depends on it."
      onBack={onBack}
      onNext={onNext}
      nextText="Move to reflection →"
      disabled={
        !impact ||
        !response.trim()
      }
      loading={loading}
      asideTitle="One break point is enough"
      asideText="This is a reasoning exercise, not an outcome prediction. You are observing dependency."
      asideItems={[
        [
          "SELECT",
          "Switch between confirmed dependencies.",
        ],
        [
          "BREAK",
          "Temporarily assume one condition fails.",
        ],
        [
          "OBSERVE",
          "Explain which part of your reasoning changes.",
        ],
      ]}
    >
      <div className="dependency-selector">
        {assumptions.map(
          (
            assumption,
            index
          ) => (
            <button
              type="button"
              key={
                assumption.assumption_id
              }
              className={
                selectedAssumption?.assumption_id ===
                assumption.assumption_id
                  ? "dependency-option selected"
                  : "dependency-option"
              }
              onClick={() =>
                setSelectedAssumption(
                  assumption
                )
              }
            >
              <span>
                {String(
                  index + 1
                ).padStart(
                  2,
                  "0"
                )}
              </span>

              <strong>
                {
                  assumption.content
                }
              </strong>
            </button>
          )
        )}
      </div>

      <div className="stress-focus-card">
        <span>
          TESTING THIS DEPENDENCY
        </span>

        <h3>
          {
            selectedAssumption.content
          }
        </h3>
      </div>

      <div className="stress-grid">
        <section className="stress-card">
          <span>
            AFFECTED REASONING
          </span>

          <p>
            {
              stressTest.affectedReasoning ||
              "How this dependency supports the original case."
            }
          </p>
        </section>

        <section className="stress-card">
          <span>
            ALTERNATIVE SCENARIO
          </span>

          <p>
            {
              stressTest.alternativeScenario ||
              "What the case looks like if this dependency fails."
            }
          </p>
        </section>

        <section className="stress-card wide">
          <span>
            REASONING CONSEQUENCE
          </span>

          <p>
            {
              stressTest.reasoningConsequence ||
              "What changes in the original reasoning when this condition is removed."
            }
          </p>
        </section>
      </div>

      <section className="response-card">
        <label>
          HOW STRONGLY WOULD THIS AFFECT YOUR REASONING?
        </label>

        <div className="impact-grid five">
          {[1, 2, 3, 4, 5].map(
            (value) => (
              <button
                key={value}
                type="button"
                className={
                  Number(
                    impact
                  ) ===
                  value
                    ? "impact-option selected"
                    : "impact-option"
                }
                onClick={() =>
                  setImpact(
                    value
                  )
                }
              >
                <strong>
                  {value}
                </strong>

                <span>
                  {value ===
                  1
                    ? "Very little"
                    : value ===
                      5
                    ? "Severely"
                    : ""}
                </span>
              </button>
            )
          )}
        </div>

        <label>
          WHAT CHANGES IN YOUR REASONING?
        </label>

        <textarea
          value={
            response
          }
          onChange={(e) =>
            setResponse(
              e.target.value
            )
          }
          rows={8}
          placeholder="If this assumption fails, then the part of my reasoning that depends on it becomes…"
        />

        {stressTest.reflectionQuestion && (
          <div className="question-prompt">
            {
              stressTest.reflectionQuestion
            }
          </div>
        )}
      </section>
    </StageLayout>
  );
}

/*
|--------------------------------------------------------------------------
| REFLECTION
|--------------------------------------------------------------------------
*/

function ReflectionStage({
  assetName,
  initialConfidence,
  finalConfidence,
  setFinalConfidence,
  confidenceDelta,
  reflection,
  setReflection,
  exploredBlindspots,
  robustnessRatings,
  setRobustnessRatings,
  robustnessRatingsComplete,
  steelmanImpact,
  stressImpact,
  onBack,
  onNext,
  loading,
}) {
  return (
    <StageLayout
      number="07"
      kicker="REFLECTION"
      title="Pause here. What do you believe now?"
      description={`You began this review at ${initialConfidence}/5 confidence. Record what changed, what stayed intact, and what you would investigate next.`}
      onBack={onBack}
      onNext={onNext}
      nextText="Complete the review →"
      disabled={!reflection.trim() || !robustnessRatingsComplete}
      loading={loading}
      asideTitle="The decision remains yours"
      asideText="There is no correct final confidence. The useful output is a clearer record of what your reasoning now depends on."
      asideItems={[
        [
          "BEFORE",
          `${initialConfidence}/5 starting confidence.`,
        ],
        [
          "AFTER",
          `${finalConfidence}/5 current confidence.`,
        ],
        [
          "RECORD",
          "Capture what you would reconsider or investigate next.",
        ],
      ]}
    >
      <div className="confidence-summary">
        <div>
          <span>
            START
          </span>

          <strong>
            {initialConfidence}
          </strong>

          <small>
            {
              CONFIDENCE_LABELS[
                initialConfidence
              ]
            }
          </small>
        </div>

        <b>
          →
        </b>

        <div className="current">
          <span>
            NOW
          </span>

          <strong>
            {finalConfidence}
          </strong>

          <small>
            {
              CONFIDENCE_LABELS[
                finalConfidence
              ]
            }
          </small>
        </div>

        <em>
          {confidenceDelta > 0
            ? `+${confidenceDelta}`
            : confidenceDelta}
        </em>
      </div>

      <section className="response-card">
        <label>
          YOUR CURRENT CONFIDENCE
        </label>

        <div className="confidence-grid">
          {[1, 2, 3, 4, 5].map(
            (value) => (
              <button
                key={value}
                type="button"
                className={
                  Number(
                    finalConfidence
                  ) ===
                  value
                    ? "confidence-card selected"
                    : "confidence-card"
                }
                onClick={() =>
                  setFinalConfidence(
                    value
                  )
                }
              >
                <strong>
                  {value}
                </strong>

                <small>
                  {
                    CONFIDENCE_LABELS[
                      value
                    ]
                  }
                </small>
              </button>
            )
          )}
        </div>

        <section className="robustness-self-assessment" aria-labelledby="robustness-self-assessment-title">
          <div className="robustness-self-assessment-heading">
            <span className="robustness-overline">FOUR REFLECTION CHECKS</span>
            <h2 id="robustness-self-assessment-title">Review your reasoning dimensions</h2>
            <p>Rate each dimension honestly. These are your self-assessments, not facts verified by AI.</p>
          </div>

          {ROBUSTNESS_QUESTIONS.map((item) => (
            <fieldset className="robustness-question" key={item.key}>
              <legend>{item.title}</legend>
              <p>{item.question}</p>
              <div className="robustness-rating-options" role="group" aria-label={item.title}>
                {[1, 2, 3, 4, 5].map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    className={Number(robustnessRatings[item.key]) === rating ? "robustness-rating selected" : "robustness-rating"}
                    aria-pressed={Number(robustnessRatings[item.key]) === rating}
                    onClick={() => setRobustnessRatings((previous) => ({ ...previous, [item.key]: rating }))}
                  >
                    {rating}
                  </button>
                ))}
              </div>
              <div className="robustness-rating-captions">
                <span>1 · {item.low}</span>
                <span>5 · {item.high}</span>
              </div>
            </fieldset>
          ))}
          {!robustnessRatingsComplete && (
            <p className="robustness-required-note">Choose a rating for each dimension to calculate your prototype assessment.</p>
          )}
        </section>

        <label>
          FINAL REFLECTION ON{" "}
          {assetName ||
            "YOUR DECISION"}
        </label>

        <textarea
          value={
            reflection
          }
          onChange={(e) =>
            setReflection(
              e.target.value
            )
          }
          rows={9}
          placeholder="After this review, I would reconsider…"
        />
      </section>

      <div className="reflection-metrics">
        <div>
          <span>
            STEELMAN IMPACT
          </span>

          <strong>
            {steelmanImpact
              ? `${steelmanImpact}/4`
              : "—"}
          </strong>
        </div>

        <div>
          <span>
            STRESS IMPACT
          </span>

          <strong>
            {stressImpact
              ? `${stressImpact}/5`
              : "—"}
          </strong>
        </div>

        <div>
          <span>
            EXPLORED AREAS
          </span>

          <strong>
            {
              exploredBlindspots.length
            }
          </strong>
        </div>
      </div>

      <div className="human-control">
        <strong>
          Your decision remains yours.
        </strong>

        <span>
          DecisionEcho records the reasoning
          journey. It does not convert this
          exercise into a buy/sell
          recommendation.
        </span>
      </div>
    </StageLayout>
  );
}

/*
|--------------------------------------------------------------------------
| SHARED STAGE LAYOUT
|--------------------------------------------------------------------------
*/

function StageLayout({
  number,
  kicker,
  title,
  description,
  children,
  asideTitle,
  asideText,
  asideItems,
  onBack,
  onNext,
  nextText = "Continue →",
  disabled = false,
  loading = false,
}) {
  return (
    <section className="stage-layout">
      <div className="stage-main">
        <div className="stage-header">
          <div>
            <span className="stage-number">
              {number}
            </span>

            <span className="stage-kicker">
              {kicker}
            </span>
          </div>

          <span className="stage-status">
            {number} / 07
          </span>
        </div>

        <h1 className="stage-title">
          {title}
        </h1>

        <p className="stage-description">
          {description}
        </p>

        <div className="stage-content">
          {children}
        </div>

        <div className="stage-navigation">
          <button
            type="button"
            className="back-link"
            onClick={onBack}
            disabled={loading}
          >
            ← Back
          </button>

          <button
            type="button"
            className="primary-button"
            onClick={onNext}
            disabled={
              disabled || loading
            }
          >
            {loading
              ? "Working…"
              : nextText}
          </button>
        </div>
      </div>

      <aside className="stage-aside">
        <span className="aside-brand">
          DECISIONECHO
        </span>

        <h2>
          {asideTitle}
        </h2>

        <p>
          {asideText}
        </p>

        <div className="aside-items">
          {asideItems.map(
            ([label, text]) => (
              <div
                key={label}
                className="aside-item"
              >
                <strong>
                  {label}
                </strong>

                <span>
                  {text}
                </span>
              </div>
            )
          )}
        </div>
      </aside>
    </section>
  );
}

/*
|--------------------------------------------------------------------------
| SMALL COMPONENTS
|--------------------------------------------------------------------------
*/

function EmptyState({
  text,
}) {
  return (
    <div className="empty-state">
      {text}
    </div>
  );
}

function MetricCard({
  label,
  value,
  note,
}) {
  return (
    <div className="metric-card">
      <span>
        {label}
      </span>

      <strong>
        {value}
      </strong>

      <small>
        {note}
      </small>
    </div>
  );
}

function Footer() {
  return (
    <footer className="app-footer">
      <div>
        <strong>
          DecisionEcho
        </strong>

        <span>
          AI challenges → you evaluate → you decide.
        </span>
      </div>

      <small>
        No financial advice, buy/sell
        recommendations, or outcome predictions.
      </small>
    </footer>
  );
}
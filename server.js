import { createServer } from "node:http";
import { createHash, randomBytes, randomUUID, scryptSync, timingSafeEqual } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const dbPath = path.join(dataDir, "db.json");
const sessionCookieName = "sf_session";
const sessionMaxAgeSeconds = 60 * 60 * 24 * 14;

await loadEnv();

const port = Number(process.env.PORT || 4173);
let pgPool;
let pgReady = false;

const scenarios = [
  {
    id: "family_trip_hotel",
    category: "Daily English",
    title: "Checking into a hotel with your family",
    level: "A2-B1",
    opening_question: "Hi, welcome to our hotel. Do you have a reservation?",
    target_expressions: [
      "We'd like to check in, please.",
      "Is breakfast included?",
      "Could we have a room with two beds?",
      "Could we get a late checkout?"
    ]
  },
  {
    id: "family_trip_restaurant",
    category: "Daily English",
    title: "Ordering food at a restaurant with your family",
    level: "A2-B1",
    opening_question: "Hi, how many people are in your party?",
    target_expressions: [
      "Could we get a table for four?",
      "Do you have any kid-friendly options?",
      "Could we have the bill, please?",
      "We're just looking around for now."
    ]
  },
  {
    id: "conference_booth",
    category: "Business English",
    title: "Talking to visitors at an international fintech conference booth",
    level: "B1-B2",
    opening_question: "Hi, I'm interested in your fintech solution. Could you give me a quick overview?",
    target_expressions: [
      "We help SMEs manage cash flow gaps.",
      "Our platform provides B2B BNPL solutions.",
      "Let me walk you through a simple use case.",
      "Could I scan your badge so we can follow up?"
    ]
  },
  {
    id: "foreign_buyer_meeting",
    category: "Business English",
    title: "Meeting with a foreign buyer",
    level: "B1-B2",
    opening_question: "Could you explain how your service could help our procurement process?",
    target_expressions: [
      "We offer flexible payment terms.",
      "Our solution can improve your working capital efficiency.",
      "Let's explore how this could fit into your workflow.",
      "There's some room for negotiation."
    ]
  },
  {
    id: "global_zoom_meeting",
    category: "Business English",
    title: "Global Zoom meeting with a fintech partner",
    level: "B1-B2",
    opening_question: "Can you briefly introduce your company and today's agenda?",
    target_expressions: [
      "Can everyone hear me clearly?",
      "Let me quickly share my screen.",
      "Let's align on the next steps.",
      "I'll follow up with you by email."
    ]
  },
  {
    id: "investor_pitch",
    category: "Business English",
    title: "Explaining a fintech business model to an overseas investor",
    level: "B2-C1",
    opening_question: "Could you explain your business model and revenue structure?",
    target_expressions: [
      "We generate revenue through transaction-based fees.",
      "Our default rate has remained low.",
      "We use transaction data for credit assessment.",
      "We are seeing strong traction in the SME finance market."
    ]
  }
];

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};

export const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url || "/", `http://${request.headers.host}`);

    if (requestUrl.pathname.startsWith("/api/")) {
      await handleApi(request, response, requestUrl);
      return;
    }

    await serveStatic(requestUrl, response);
  } catch (error) {
    sendJson(response, 500, {
      error: "internal_server_error",
      message: error instanceof Error ? error.message : "Unknown server error"
    });
  }
});

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  server.listen(port, () => {
    console.log(`SpeakFit AI is running at http://localhost:${port}`);
  });
}

async function loadEnv() {
  const envPath = path.join(__dirname, ".env");
  try {
    const raw = await fs.readFile(envPath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
      const [key, ...valueParts] = trimmed.split("=");
      if (!process.env[key]) {
        process.env[key] = valueParts.join("=").trim();
      }
    }
  } catch {
    // The app runs in demo mode without a local .env file.
  }
}

async function handleApi(request, response, requestUrl) {
  if (request.method === "GET" && requestUrl.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      mode: process.env.OPENAI_API_KEY ? "openai-ready" : "demo",
      store: process.env.DATABASE_URL ? "postgres" : "json-file"
    });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/auth/me") {
    const db = await readDb();
    const user = getSessionUser(db, request);
    sendJson(response, user ? 200 : 401, { user: user ? publicUser(user) : null });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/signup") {
    const body = await parseJsonBody(request);
    const result = await signupUser(request, response, body);
    sendJson(response, result.status, result.payload);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/login") {
    const body = await parseJsonBody(request);
    const result = await loginUser(request, response, body);
    sendJson(response, result.status, result.payload);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/auth/logout") {
    await logoutUser(request, response);
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/scenarios") {
    sendJson(response, 200, { scenarios });
    return;
  }

  const auth = await requireUser(request, response);
  if (!auth) return;
  const userId = auth.user.id;

  if (request.method === "POST" && requestUrl.pathname === "/api/realtime/session") {
    await createRealtimeSession(response);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/assessment") {
    const body = await parseJsonBody(request);
    const result = await saveAssessment(body, userId);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/learning-plan") {
    const body = await parseJsonBody(request);
    const plan = createLearningPlan(body.assessment || body);
    sendJson(response, 200, { plan });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/daily-mission/today") {
    const db = await readDb();
    const mission = await getOrCreateTodayMission(db, userId);
    sendJson(response, 200, { mission });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/daily-mission/complete") {
    const body = await parseJsonBody(request);
    const result = await completeMission(body, userId);
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/streak") {
    const db = await readDb();
    sendJson(response, 200, { streak: getUserStreak(db, userId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/streak/update") {
    const result = await updateStreak(userId);
    sendJson(response, 200, { streak: result });
    return;
  }

  if (request.method === "GET" && requestUrl.pathname === "/api/weekly-score") {
    const db = await readDb();
    sendJson(response, 200, { weeklyScore: getCurrentWeeklyScore(db, userId) });
    return;
  }

  if (request.method === "POST" && requestUrl.pathname === "/api/weekly-score/update") {
    const body = await parseJsonBody(request);
    const result = await updateWeeklyScore(body, userId);
    sendJson(response, 200, { weeklyScore: result });
    return;
  }

  sendJson(response, 404, { error: "not_found" });
}

async function createRealtimeSession(response) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_REALTIME_MODEL || "gpt-realtime";

  if (!apiKey) {
    sendJson(response, 200, {
      mode: "demo",
      model,
      ephemeral_token: null,
      message: "OPENAI_API_KEY is not set. The browser demo will use local speech recognition and synthesis."
    });
    return;
  }

  try {
    const realtimeResponse = await fetch("https://api.openai.com/v1/realtime/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Beta": "realtime=v1"
      },
      body: JSON.stringify({
        model,
        voice: "alloy",
        instructions: [
          "You are an AI English speaking coach for Korean professionals.",
          "Ask one question at a time.",
          "Use family travel, finance, fintech, B2B BNPL, and global meeting scenarios.",
          "Keep corrections short during conversation and generate a structured report after the session."
        ].join(" ")
      })
    });

    const payload = await realtimeResponse.json();
    sendJson(response, realtimeResponse.ok ? 200 : realtimeResponse.status, {
      mode: "openai",
      model,
      session: payload
    });
  } catch (error) {
    sendJson(response, 502, {
      error: "realtime_session_failed",
      message: error instanceof Error ? error.message : "Could not create a realtime session"
    });
  }
}

async function signupUser(request, response, body) {
  const db = await readDb();
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const name = String(body.name || "").trim();
  const now = new Date().toISOString();

  if (!name || !email || password.length < 8) {
    return {
      status: 400,
      payload: { error: "invalid_signup", message: "Name, email, and an 8+ character password are required." }
    };
  }

  if (db.users.some((user) => normalizeEmail(user.email) === email)) {
    await logAccess(db, request, null, email, "signup_rejected_duplicate");
    await writeDb(db);
    return {
      status: 409,
      payload: { error: "email_exists", message: "This email is already registered." }
    };
  }

  const user = {
    id: randomUUID(),
    name,
    email,
    password_hash: hashPassword(password),
    native_language: "ko",
    target_goal: String(body.targetGoal || "Business English for fintech meetings and family travel"),
    current_cefr_level: "B1",
    app_level: "New Speaker",
    total_xp: 0,
    role: "learner",
    status: "active",
    failed_login_count: 0,
    locked_until: null,
    last_login_at: now,
    created_at: now,
    updated_at: now
  };

  db.users.push(user);
  ensureUserStreak(db, user.id);
  await createAuthSession(db, request, response, user);
  await logAccess(db, request, user.id, email, "signup_success");
  await writeDb(db);

  return { status: 201, payload: { user: publicUser(user) } };
}

async function loginUser(request, response, body) {
  const db = await readDb();
  const email = normalizeEmail(body.email);
  const password = String(body.password || "");
  const user = db.users.find((item) => normalizeEmail(item.email) === email);
  const now = new Date().toISOString();

  if (!user || !verifyPassword(password, user.password_hash || "")) {
    if (user) {
      user.failed_login_count = Number(user.failed_login_count || 0) + 1;
      if (user.failed_login_count >= 5) {
        user.locked_until = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      }
      user.updated_at = now;
    }
    await logAccess(db, request, user?.id || null, email, "login_failed");
    await writeDb(db);
    return { status: 401, payload: { error: "invalid_credentials", message: "Email or password is incorrect." } };
  }

  if (user.status !== "active") {
    await logAccess(db, request, user.id, email, "login_blocked_inactive");
    await writeDb(db);
    return { status: 403, payload: { error: "account_inactive", message: "This account is not active." } };
  }

  if (user.locked_until && Date.parse(user.locked_until) > Date.now()) {
    await logAccess(db, request, user.id, email, "login_blocked_locked");
    await writeDb(db);
    return { status: 423, payload: { error: "account_locked", message: "Too many failed attempts. Try again later." } };
  }

  user.failed_login_count = 0;
  user.locked_until = null;
  user.last_login_at = now;
  user.updated_at = now;
  ensureUserStreak(db, user.id);
  await createAuthSession(db, request, response, user);
  await logAccess(db, request, user.id, email, "login_success");
  await writeDb(db);

  return { status: 200, payload: { user: publicUser(user) } };
}

async function logoutUser(request, response) {
  const db = await readDb();
  const token = getCookie(request, sessionCookieName);
  const tokenHash = token ? hashToken(token) : "";
  const session = db.authSessions.find((item) => item.token_hash === tokenHash && !item.revoked_at);
  if (session) {
    session.revoked_at = new Date().toISOString();
    await logAccess(db, request, session.user_id, "", "logout");
    await writeDb(db);
  }
  setCookie(response, sessionCookieName, "", { maxAge: 0 });
}

async function requireUser(request, response) {
  const db = await readDb();
  const user = getSessionUser(db, request);
  if (!user) {
    sendJson(response, 401, { error: "unauthorized", message: "Please sign in first." });
    return null;
  }
  return { user, db };
}

function getSessionUser(db, request) {
  const token = getCookie(request, sessionCookieName);
  if (!token) return null;

  const tokenHash = hashToken(token);
  const session = db.authSessions.find((item) => item.token_hash === tokenHash && !item.revoked_at);
  if (!session || Date.parse(session.expires_at) <= Date.now()) return null;

  const user = db.users.find((item) => item.id === session.user_id && item.status === "active");
  return user || null;
}

async function createAuthSession(db, request, response, user) {
  const token = `${randomUUID()}.${randomBytes(32).toString("hex")}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + sessionMaxAgeSeconds * 1000);
  db.authSessions.push({
    id: randomUUID(),
    user_id: user.id,
    token_hash: hashToken(token),
    created_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
    revoked_at: null,
    user_agent: request.headers["user-agent"] || "",
    ip_address: getRequestIp(request)
  });
  setCookie(response, sessionCookieName, token, {
    httpOnly: true,
    sameSite: "Lax",
    maxAge: sessionMaxAgeSeconds,
    secure: isSecureRequest(request)
  });
}

async function logAccess(db, request, userId, email, event) {
  db.accessLogs.push({
    id: randomUUID(),
    user_id: userId,
    email: email || "",
    event,
    ip_address: getRequestIp(request),
    user_agent: request.headers["user-agent"] || "",
    created_at: new Date().toISOString()
  });
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash).split(":");
  if (!salt || !hash) return false;
  const actual = Buffer.from(scryptSync(password, salt, 64).toString("hex"), "hex");
  const expected = Buffer.from(hash, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    current_cefr_level: user.current_cefr_level,
    app_level: user.app_level,
    total_xp: user.total_xp,
    role: user.role || "learner",
    status: user.status || "active"
  };
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

async function saveAssessment(body, userId) {
  const db = await readDb();
  const transcriptItems = Array.isArray(body.transcript) ? body.transcript : [];
  const transcriptText = transcriptItems
    .map((item) => `${item.speaker || "user"}: ${item.text || ""}`)
    .join("\n")
    .trim();
  const scenario = scenarios.find((item) => item.id === body.scenarioId) || scenarios[2];
  const sessionId = randomUUID();
  const assessmentId = randomUUID();
  const now = new Date().toISOString();

  const assessment = createAssessment({
    id: assessmentId,
    sessionId,
    transcriptText,
    scenario,
    durationSeconds: Number(body.durationSeconds || 0)
  });
  const learningPlan = createLearningPlan(assessment);

  db.sessions.push({
    id: sessionId,
    user_id: userId,
    mode: body.mode || "level_test",
    scenario: scenario.title,
    started_at: body.startedAt || now,
    ended_at: now,
    transcript: transcriptText,
    audio_url: "",
    duration_seconds: Number(body.durationSeconds || 0),
    created_at: now
  });
  db.assessments.push(assessment);
  db.learningPlans.push({
    id: randomUUID(),
    user_id: userId,
    level: assessment.estimated_cefr_level,
    goal: "Business English for fintech meetings and family travel",
    plan_json: learningPlan,
    created_at: now,
    updated_at: now
  });

  const user = db.users.find((item) => item.id === userId);
  if (user) {
    user.current_cefr_level = assessment.estimated_cefr_level;
    user.total_xp += 100;
    user.updated_at = now;
  }

  await writeDb(db);
  return { assessment, learningPlan };
}

function createAssessment({ id, sessionId, transcriptText, scenario, durationSeconds }) {
  const userText = transcriptText
    .split("\n")
    .filter((line) => line.toLowerCase().startsWith("user:"))
    .join(" ");
  const wordCount = userText.split(/\s+/).filter(Boolean).length;
  const businessTerms = [
    "cash flow",
    "working capital",
    "invoice",
    "bnpl",
    "payment",
    "sme",
    "transaction",
    "risk",
    "fintech",
    "revenue"
  ];
  const businessHits = businessTerms.filter((term) => userText.toLowerCase().includes(term)).length;
  const base = 62 + Math.min(12, Math.floor(wordCount / 16)) + businessHits * 2;
  const overall = clamp(base + (durationSeconds > 45 ? 3 : 0), 60, 88);
  const isBusiness = scenario.category === "Business English";

  return {
    id,
    session_id: sessionId,
    estimated_cefr_level: overall >= 82 ? "B2" : overall >= 72 ? "B1+" : "B1",
    overall_score: overall,
    fluency_score: clamp(overall - 2, 55, 90),
    grammar_score: clamp(overall - 7, 55, 88),
    vocabulary_score: clamp(overall + businessHits, 58, 92),
    pronunciation_clarity_score: clamp(overall - 4, 55, 88),
    interaction_score: clamp(overall + 4, 60, 94),
    business_english_score: clamp(overall + (isBusiness ? 3 : -2) + businessHits, 55, 94),
    strengths: [
      "You can answer practical questions and keep the conversation moving.",
      isBusiness
        ? "You used several finance or business terms in context."
        : "You handled a familiar daily-life situation clearly."
    ],
    weaknesses: [
      "Make your answers a little longer by adding one reason or example.",
      "Watch articles and tense choices in business explanations."
    ],
    frequent_errors: [
      "Korean-style direct translation in service descriptions",
      "Missing articles before countable nouns",
      "Short answers that need more context"
    ],
    corrected_sentences: [
      {
        original: "Our service help company pay later.",
        corrected: "Our service helps companies buy what they need now and pay later.",
        note: "주어가 단수일 때 동사에 -s를 붙이고, company는 복수 맥락에서 companies가 자연스럽습니다."
      },
      {
        original: "We make cash flow problem better.",
        corrected: "We help SMEs manage cash flow gaps more effectively.",
        note: "핀테크 설명에서는 manage cash flow gaps가 더 자연스럽고 전문적으로 들립니다."
      }
    ],
    better_expressions: [
      "Let me walk you through how it works.",
      "We help SMEs manage cash flow gaps between delivery and payment.",
      "That is a fair point. Let me give you some context.",
      "Could we take a rain check?"
    ],
    recommended_learning_path: [
      "Week 1: Short self-introduction and small talk",
      "Week 2: Family travel role-plays",
      "Week 3: Fintech service explanation",
      "Week 4: Buyer questions and investor follow-ups"
    ],
    created_at: new Date().toISOString()
  };
}

function createLearningPlan(assessment) {
  const level = assessment.estimated_cefr_level || "B1";
  return [
    {
      week: 1,
      level,
      topic: "Self-introduction and small talk",
      scenario: "Global Zoom meeting opening",
      key_expressions: [
        "Can everyone hear me clearly?",
        "I'll start with a brief overview of our business.",
        "Please feel free to jump in if you have any questions."
      ],
      speaking_mission: "Open a 60-second Zoom meeting and introduce your company.",
      mistake_to_avoid: "Do not translate Korean sentence order directly.",
      review_task: "Record the same opening twice and compare the second version."
    },
    {
      week: 2,
      level,
      topic: "Family travel English",
      scenario: "Hotel and restaurant role-play",
      key_expressions: [
        "We'd like to check in, please.",
        "Do you have any kid-friendly options?",
        "Could you recommend a good place for a family trip?"
      ],
      speaking_mission: "Handle a hotel check-in and restaurant request in one flow.",
      mistake_to_avoid: "Use polite requests instead of one-word demands.",
      review_task: "Practice three Could we...? questions."
    },
    {
      week: 3,
      level,
      topic: "Explaining fintech services",
      scenario: "International conference booth",
      key_expressions: [
        "We help SMEs manage cash flow gaps.",
        "Our platform provides flexible payment terms.",
        "Let me walk you through a simple use case."
      ],
      speaking_mission: "Explain your fintech service in 60 seconds.",
      mistake_to_avoid: "Do not overuse solve; vary with help, support, improve, reduce.",
      review_task: "Rewrite one Korean-style sentence into business English."
    },
    {
      week: 4,
      level,
      topic: "Handling questions and objections",
      scenario: "Foreign buyer or investor meeting",
      key_expressions: [
        "That is a fair point.",
        "There is some room for negotiation.",
        "Let's align on the next steps."
      ],
      speaking_mission: "Answer three buyer questions and close with next steps.",
      mistake_to_avoid: "Avoid sounding too absolute when discussing risk or pricing.",
      review_task: "Prepare two softer answers for difficult questions."
    }
  ];
}

async function getOrCreateTodayMission(db, userId) {
  const today = getTodayISO();
  const existing = db.dailyMissions.find((mission) => mission.user_id === userId && mission.date === today);
  if (existing) return existing;

  const scenario = scenarios[2];
  const mission = {
    id: randomUUID(),
    user_id: userId,
    date: today,
    mission_type: "business_speaking",
    scenario: scenario.title,
    goal: "Explain your fintech service in 60 seconds",
    target_expressions: [
      "Let me walk you through how it works.",
      "We help SMEs manage cash flow gaps.",
      "Our platform provides flexible payment terms."
    ],
    estimated_time_minutes: 5,
    minimum_speaking_seconds: 60,
    minimum_score: 60,
    expected_xp: 50,
    is_completed: false,
    completed_at: null,
    score: 0,
    xp_earned: 0,
    created_at: new Date().toISOString()
  };

  db.dailyMissions.push(mission);
  await writeDb(db);
  return mission;
}

async function completeMission(body, userId) {
  const db = await readDb();
  const mission = await getOrCreateTodayMission(db, userId);
  if (mission.is_completed) {
    return {
      mission,
      streak: getUserStreak(db, userId),
      weeklyScore: getCurrentWeeklyScore(db, userId),
      alreadyCompleted: true
    };
  }

  const speakingSeconds = Number(body.speakingSeconds || 60);
  const usedExpressions = Number(body.usedExpressions || 2);
  const clarityScore = Number(body.clarityScore || 74);
  const score = clamp(
    50 +
      (speakingSeconds >= mission.minimum_speaking_seconds ? 20 : 0) +
      (usedExpressions >= 2 ? 20 : 0) +
      (body.improvedSentence ? 20 : 0) +
      (clarityScore >= 70 ? 10 : 0),
    50,
    120
  );
  const now = new Date().toISOString();

  mission.is_completed = true;
  mission.completed_at = now;
  mission.score = score;
  mission.xp_earned = 50 + (score >= 90 ? 20 : 0);

  const user = db.users.find((item) => item.id === userId);
  if (user) {
    user.total_xp += mission.xp_earned;
    user.updated_at = now;
  }

  const streak = calculateStreak(getUserStreak(db, userId));
  setUserStreak(db, streak);
  const weeklyScore = updateWeeklyScoreInDb(db, {
    missionScore: score,
    xp: mission.xp_earned,
    speakingScore: Number(body.speakingScore || score),
    missionType: mission.mission_type
  }, userId);

  await writeDb(db);
  return { mission, streak, weeklyScore };
}

async function updateStreak(userId) {
  const db = await readDb();
  const streak = calculateStreak(getUserStreak(db, userId));
  setUserStreak(db, streak);
  await writeDb(db);
  return streak;
}

function calculateStreak(current) {
  const today = getTodayISO();
  if (current.last_completed_date === today) {
    return current;
  }

  const yesterday = addDays(today, -1);
  const currentStreak = current.last_completed_date === yesterday ? current.current_streak + 1 : 1;
  return {
    ...current,
    current_streak: currentStreak,
    best_streak: Math.max(current.best_streak, currentStreak),
    last_completed_date: today,
    updated_at: new Date().toISOString()
  };
}

async function updateWeeklyScore(body, userId) {
  const db = await readDb();
  const weeklyScore = updateWeeklyScoreInDb(db, body, userId);
  await writeDb(db);
  return weeklyScore;
}

function updateWeeklyScoreInDb(db, body, userId) {
  const weekStart = getWeekStartISO();
  const weekEnd = addDays(weekStart, 6);
  let weeklyScore = db.weeklyScores.find((item) => item.user_id === userId && item.week_start_date === weekStart);

  if (!weeklyScore) {
    weeklyScore = {
      id: randomUUID(),
      user_id: userId,
      week_start_date: weekStart,
      week_end_date: weekEnd,
      total_score: 0,
      total_xp: 0,
      completed_missions: 0,
      average_speaking_score: 0,
      business_missions_completed: 0,
      daily_missions_completed: 0,
      weekly_bonus_score: 0,
      created_at: new Date().toISOString()
    };
    db.weeklyScores.push(weeklyScore);
  }

  const missionScore = Number(body.missionScore || 0);
  const xp = Number(body.xp || 0);
  const speakingScore = Number(body.speakingScore || missionScore || 0);
  weeklyScore.completed_missions += 1;
  weeklyScore.total_score += missionScore;
  weeklyScore.total_xp += xp;
  weeklyScore.average_speaking_score = Math.round(
    (weeklyScore.average_speaking_score * (weeklyScore.completed_missions - 1) + speakingScore) /
      weeklyScore.completed_missions
  );
  weeklyScore.business_missions_completed += body.missionType?.includes("business") ? 1 : 0;
  weeklyScore.daily_missions_completed += body.missionType?.includes("business") ? 0 : 1;
  weeklyScore.weekly_bonus_score =
    (weeklyScore.completed_missions >= 5 ? 100 : 0) +
    (getUserStreak(db, userId).current_streak >= 7 ? 200 : 0) +
    (weeklyScore.business_missions_completed >= 3 ? 50 : 0) +
    (weeklyScore.daily_missions_completed >= 3 ? 50 : 0) +
    (weeklyScore.average_speaking_score >= 75 ? 100 : 0);

  return weeklyScore;
}

function getCurrentWeeklyScore(db, userId) {
  const weekStart = getWeekStartISO();
  const existing = db.weeklyScores.find((item) => item.user_id === userId && item.week_start_date === weekStart);
  if (existing) return existing;

  return {
    id: "preview-week",
    user_id: userId,
    week_start_date: weekStart,
    week_end_date: addDays(weekStart, 6),
    total_score: 0,
    total_xp: 0,
    completed_missions: 0,
    average_speaking_score: 0,
    business_missions_completed: 0,
    daily_missions_completed: 0,
    weekly_bonus_score: 0
  };
}

function getUserStreak(db, userId) {
  return ensureUserStreak(db, userId);
}

function ensureUserStreak(db, userId) {
  let streak = db.streaks.find((item) => item.user_id === userId);
  if (!streak) {
    const now = new Date().toISOString();
    streak = {
      id: randomUUID(),
      user_id: userId,
      current_streak: 0,
      best_streak: 0,
      last_completed_date: null,
      streak_freeze_count: 0,
      created_at: now,
      updated_at: now
    };
    db.streaks.push(streak);
  }
  return streak;
}

function setUserStreak(db, streak) {
  const index = db.streaks.findIndex((item) => item.user_id === streak.user_id);
  if (index >= 0) {
    db.streaks[index] = streak;
  } else {
    db.streaks.push(streak);
  }
}

async function readDb() {
  if (process.env.DATABASE_URL) {
    const db = await readPostgresDb();
    return normalizeDb(db);
  }

  await fs.mkdir(dataDir, { recursive: true });
  try {
    const raw = await fs.readFile(dbPath, "utf8");
    return normalizeDb(JSON.parse(raw));
  } catch {
    const db = createInitialDb();
    await writeDb(db);
    return db;
  }
}

async function writeDb(db) {
  const normalized = normalizeDb(db);
  if (process.env.DATABASE_URL) {
    await writePostgresDb(normalized);
    return;
  }

  await fs.mkdir(dataDir, { recursive: true });
  await fs.writeFile(dbPath, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
}

function createInitialDb() {
  return {
    users: [],
    authSessions: [],
    accessLogs: [],
    sessions: [],
    assessments: [],
    learningPlans: [],
    expressionCards: [],
    dailyMissions: [],
    streaks: [],
    weeklyScores: [],
    badges: []
  };
}

function normalizeDb(db) {
  const normalized = {
    ...createInitialDb(),
    ...(db || {})
  };
  normalized.users = Array.isArray(normalized.users) ? normalized.users : [];
  normalized.authSessions = Array.isArray(normalized.authSessions) ? normalized.authSessions : [];
  normalized.accessLogs = Array.isArray(normalized.accessLogs) ? normalized.accessLogs : [];
  normalized.sessions = Array.isArray(normalized.sessions) ? normalized.sessions : [];
  normalized.assessments = Array.isArray(normalized.assessments) ? normalized.assessments : [];
  normalized.learningPlans = Array.isArray(normalized.learningPlans) ? normalized.learningPlans : [];
  normalized.expressionCards = Array.isArray(normalized.expressionCards) ? normalized.expressionCards : [];
  normalized.dailyMissions = Array.isArray(normalized.dailyMissions) ? normalized.dailyMissions : [];
  normalized.streaks = Array.isArray(normalized.streaks) ? normalized.streaks : [];
  normalized.weeklyScores = Array.isArray(normalized.weeklyScores) ? normalized.weeklyScores : [];
  normalized.badges = Array.isArray(normalized.badges) ? normalized.badges : [];

  if (normalized.streak && !normalized.streaks.some((item) => item.user_id === normalized.streak.user_id)) {
    normalized.streaks.push(normalized.streak);
  }
  delete normalized.streak;

  return normalized;
}

async function readPostgresDb() {
  const pool = await getPgPool();
  await ensurePgSchema(pool);
  const result = await pool.query("select data from app_state where id = $1", ["default"]);
  if (result.rows[0]?.data) return result.rows[0].data;

  const db = createInitialDb();
  await writePostgresDb(db);
  return db;
}

async function writePostgresDb(db) {
  const pool = await getPgPool();
  await ensurePgSchema(pool);
  await pool.query(
    `insert into app_state (id, data, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (id)
     do update set data = excluded.data, updated_at = now()`,
    ["default", JSON.stringify(db)]
  );
}

async function getPgPool() {
  if (pgPool) return pgPool;
  let Pool;
  try {
    ({ Pool } = await import("pg"));
  } catch {
    throw new Error("DATABASE_URL is set, but the pg package is not installed. Run npm install before starting.");
  }
  pgPool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pgPool;
}

async function ensurePgSchema(pool) {
  if (pgReady) return;
  await pool.query(`
    create table if not exists app_state (
      id text primary key,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )
  `);
  pgReady = true;
}

async function serveStatic(requestUrl, response) {
  let pathname = decodeURIComponent(requestUrl.pathname);
  if (pathname === "/") pathname = "/index.html";

  const normalizedPath = path.normalize(pathname).replace(/^([/\\])+/, "");
  const filePath = path.join(publicDir, normalizedPath);

  if (!filePath.startsWith(publicDir)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const mimeType = mimeTypes[path.extname(filePath)] || "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": mimeType,
      "Cache-Control": "no-store"
    });
    response.end(file);
  } catch {
    const index = await fs.readFile(path.join(publicDir, "index.html"));
    response.writeHead(200, { "Content-Type": mimeTypes[".html"] });
    response.end(index);
  }
}

function getCookie(request, name) {
  const cookieHeader = request.headers.cookie || "";
  return cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1) || "";
}

function setCookie(response, name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${options.maxAge ?? sessionMaxAgeSeconds}`];
  if (options.httpOnly !== false) parts.push("HttpOnly");
  if (options.sameSite) parts.push(`SameSite=${options.sameSite}`);
  if (options.secure) parts.push("Secure");
  response.setHeader("Set-Cookie", parts.join("; "));
}

function isSecureRequest(request) {
  return process.env.COOKIE_SECURE === "true" || request.headers["x-forwarded-proto"] === "https";
}

function getRequestIp(request) {
  const forwarded = request.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim()) {
    return forwarded.split(",")[0].trim();
  }
  return request.socket.remoteAddress || "";
}

function sendJson(response, statusCode, payload) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  };
  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(payload));
}

function parseJsonBody(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(new Error("Request body is too large"));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
  });
}

function getTodayISO() {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function getWeekStartISO() {
  const today = getTodayISO();
  const date = new Date(`${today}T12:00:00Z`);
  const day = date.getUTCDay();
  const diff = (day + 6) % 7;
  date.setUTCDate(date.getUTCDate() - diff);
  return date.toISOString().slice(0, 10);
}

function addDays(isoDate, days) {
  const date = new Date(`${isoDate}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Math.round(value)));
}

const state = {
  authUser: null,
  authMode: "login",
  view: "home",
  scenarios: [],
  selectedScenarioId: "conference_booth",
  transcript: [],
  interimText: "",
  assessment: null,
  learningPlan: [],
  mission: null,
  streak: null,
  weeklyScore: null,
  recognition: null,
  isListening: false,
  isSpeaking: false,
  slowMode: false,
  sessionActive: false,
  sessionType: "level_test",
  startedAt: null,
  timerSeconds: 180,
  timerId: null,
  responseTimer: null,
  pendingUserAnswer: "",
  responseDelayMs: 3200,
  isThinking: false,
  userWordCount: 0,
  toast: ""
};

const aiFollowUps = {
  family_trip_hotel: [
    "Great. Could you ask if breakfast is included?",
    "Now ask for a late checkout in a polite way.",
    "Your child has a mild fever. What would you ask the hotel staff?"
  ],
  family_trip_restaurant: [
    "Nice. Could you ask for kid-friendly options?",
    "Now ask if the restaurant has anything not too spicy.",
    "Please ask for the bill in a natural way."
  ],
  conference_booth: [
    "Thanks. What problem does your product solve for SMEs?",
    "Could you explain one simple use case in 30 seconds?",
    "How would you ask a visitor for follow-up contact information?"
  ],
  foreign_buyer_meeting: [
    "Could you explain your usual payment terms?",
    "How would your service fit into our procurement workflow?",
    "What would you say if I asked about risk?"
  ],
  global_zoom_meeting: [
    "Can you introduce today's agenda in one sentence?",
    "Could you ask everyone if they can hear you clearly?",
    "How would you define the next steps before ending the call?"
  ],
  investor_pitch: [
    "Could you explain your revenue model?",
    "How would you describe your default rate and risk assessment?",
    "What makes this a strategic fit for overseas investors?"
  ]
};

const icons = {
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
  test: '<path d="M12 3v12"/><path d="M8 7v4"/><path d="M16 7v4"/><path d="M5 12a7 7 0 0 0 14 0"/><path d="M12 19v2"/>',
  mission: '<path d="M8 4h8"/><path d="M7 8h10"/><path d="M6 12h12"/><path d="M8 16h8"/><path d="M10 20h4"/>',
  report: '<path d="M4 19V5"/><path d="M4 19h16"/><path d="M8 16v-5"/><path d="M12 16V8"/><path d="M16 16v-9"/>',
  plan: '<path d="M4 5h16"/><path d="M4 12h16"/><path d="M4 19h16"/><path d="M8 3v4"/><path d="M16 17v4"/>',
  mic: '<path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/>',
  stop: '<path d="M7 7h10v10H7z"/>',
  spark: '<path d="M12 3 9.8 9.8 3 12l6.8 2.2L12 21l2.2-6.8L21 12l-6.8-2.2Z"/>',
  repeat: '<path d="M17 2 21 6l-4 4"/><path d="M3 11V9a3 3 0 0 1 3-3h15"/><path d="M7 22 3 18l4-4"/><path d="M21 13v2a3 3 0 0 1-3 3H3"/>',
  slow: '<path d="M12 6v6l4 2"/><circle cx="12" cy="12" r="9"/>',
  check: '<path d="m20 6-11 11-5-5"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>'
};

init();

async function init() {
  const me = await api("/api/auth/me").catch(() => ({ user: null }));
  state.authUser = me.user;
  if (!state.authUser) {
    render();
    return;
  }

  const [scenarios, mission, streak, weeklyScore] = await Promise.all([
    api("/api/scenarios").catch(() => ({ scenarios: [] })),
    api("/api/daily-mission/today").catch(() => ({ mission: null })),
    api("/api/streak").catch(() => ({ streak: null })),
    api("/api/weekly-score").catch(() => ({ weeklyScore: null }))
  ]);

  state.scenarios = scenarios.scenarios || [];
  state.mission = mission.mission;
  state.streak = streak.streak;
  state.weeklyScore = weeklyScore.weeklyScore;
  render();
}

document.addEventListener("click", async (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) return;

  const action = actionTarget.dataset.action;
  const view = actionTarget.dataset.view;
  const scenarioId = actionTarget.dataset.scenario;

  if (action === "go") {
    state.view = view;
    render();
  }

  if (action === "begin-test") {
    beginSession("level_test", state.selectedScenarioId, true);
  }

  if (action === "begin-practice") {
    beginSession("practice", scenarioId || state.selectedScenarioId, true);
  }

  if (action === "toggle-mic") {
    await toggleMic();
  }

  if (action === "end-test") {
    await endSession(true);
  }

  if (action === "end-practice") {
    await endSession(false);
  }

  if (action === "hint") {
    giveHint();
  }

  if (action === "better") {
    giveBetterExpression();
  }

  if (action === "repeat") {
    repeatLastAiTurn();
  }

  if (action === "slow") {
    state.slowMode = !state.slowMode;
    showToast(state.slowMode ? "AI 음성 속도를 낮췄습니다." : "AI 음성 속도를 기본으로 돌렸습니다.");
    render();
  }

  if (action === "demo-answer") {
    addDemoAnswer();
  }

  if (action === "complete-mission") {
    await completeMission();
  }

  if (action === "switch-auth") {
    state.authMode = state.authMode === "login" ? "signup" : "login";
    render();
  }

  if (action === "logout") {
    await api("/api/auth/logout", { method: "POST" }).catch(() => null);
    state.authUser = null;
    state.view = "home";
    render();
  }
});

document.addEventListener("submit", async (event) => {
  if (!event.target.matches("[data-auth-form]")) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const isSignup = state.authMode === "signup";
  const payload = {
    email: form.get("email"),
    password: form.get("password")
  };
  if (isSignup) {
    payload.name = form.get("name");
    payload.targetGoal = form.get("targetGoal");
  }

  try {
    const response = await api(isSignup ? "/api/auth/signup" : "/api/auth/login", {
      method: "POST",
      body: payload
    });
    state.authUser = response.user;
    await init();
  } catch (error) {
    showToast(error.message || "Sign in failed.");
  }
});

document.addEventListener("change", (event) => {
  if (event.target.matches("[data-action='select-scenario']")) {
    state.selectedScenarioId = event.target.value;
    render();
  }
});

function render() {
  const app = document.querySelector("#app");
  if (!state.authUser) {
    app.innerHTML = `
      <div class="app-shell">
        <div class="app-content">
          ${renderAuth()}
        </div>
      </div>
      ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
    `;
    return;
  }

  app.innerHTML = `
    <div class="app-shell">
      <div class="app-content">
        ${renderTopbar()}
        ${renderView()}
      </div>
      ${renderNav()}
    </div>
    ${state.toast ? `<div class="toast">${escapeHtml(state.toast)}</div>` : ""}
  `;
  updateTimerDisplay();
}

function renderTopbar() {
  const level = state.assessment?.estimated_cefr_level || "B1";
  return `
    <header class="topbar">
      <div class="brand">
        <div class="brand-mark">SF</div>
        <div>
          <h1 class="brand-title">SpeakFit AI</h1>
          <p class="brand-subtitle">5분 영어 스피킹 코치</p>
        </div>
      </div>
      <div class="level-chip" aria-label="CEFR level">${level}</div>
      <button class="icon-button" title="Logout" aria-label="Logout" data-action="logout">${icon("stop")}</button>
    </header>
  `;
}

function renderAuth() {
  const isSignup = state.authMode === "signup";
  return `
    <section class="hero auth-hero">
      <div class="hero-copy">
        <p class="eyebrow">SpeakFit AI</p>
        <h2>${isSignup ? "Create your speaking profile" : "Welcome back"}</h2>
        <p>${isSignup ? "Your missions, streak, reports, and access history will be stored under your account." : "Sign in to continue your speaking missions and weekly score."}</p>
      </div>
      <div class="hero-characters" aria-hidden="true">
        <img class="hero-avatar" src="/assets/coach-character.png" alt="" />
        <img class="hero-avatar child" src="/assets/child-character.png" alt="" />
      </div>
    </section>
    <section class="section">
      <form class="card auth-form" data-auth-form>
        ${isSignup ? `<label>Name<input name="name" autocomplete="name" required /></label>` : ""}
        <label>Email<input name="email" type="email" autocomplete="email" required /></label>
        <label>Password<input name="password" type="password" autocomplete="${isSignup ? "new-password" : "current-password"}" minlength="8" required /></label>
        ${
          isSignup
            ? `<label>Learning goal<input name="targetGoal" value="Business English for fintech meetings and family travel" /></label>`
            : ""
        }
        <button class="primary-button wide" type="submit">${isSignup ? "Create account" : "Log in"}</button>
        <button class="ghost-button wide" type="button" data-action="switch-auth">
          ${isSignup ? "I already have an account" : "Create a new account"}
        </button>
      </form>
    </section>
  `;
}

function renderView() {
  if (state.view === "test") return renderTest();
  if (state.view === "mission") return renderMission();
  if (state.view === "practice") return renderPractice();
  if (state.view === "report") return renderReport();
  if (state.view === "plan") return renderPlan();
  if (state.view === "weekly") return renderWeekly();
  return renderHome();
}

function renderHome() {
  const mission = state.mission;
  return `
    <section class="hero">
      <div class="hero-copy">
        <p class="eyebrow">AI Speaking Coach</p>
        <h2>말하고, 진단받고, 매일 5분씩 쌓기</h2>
        <p>가족 여행 영어와 금융·핀테크 비즈니스 영어를 한 흐름으로 연습합니다.</p>
        <button class="primary-button" data-action="begin-test">${icon("test")}Start Level Test</button>
      </div>
      <div class="hero-characters" aria-hidden="true">
        <img class="hero-avatar" src="/assets/coach-character.png" alt="" />
        <img class="hero-avatar child" src="/assets/child-character.png" alt="" />
      </div>
    </section>

    <section class="section">
      <div class="grid two">
        <div class="card stat-card">
          <span class="stat-label">Current Streak</span>
          <strong class="stat-value">${state.streak?.current_streak || 0}일</strong>
        </div>
        <div class="card stat-card">
          <span class="stat-label">Weekly Score</span>
          <strong class="stat-value">${state.weeklyScore?.total_score || 0}</strong>
        </div>
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <h3>Today’s Mission</h3>
        <small>${mission?.estimated_time_minutes || 5} min</small>
      </div>
      <div class="card mission-strip">
        <div class="icon-tile">${icon("mission")}</div>
        <div>
          <h4>${escapeHtml(mission?.scenario || "International conference booth")}</h4>
          <p>${escapeHtml(mission?.goal || "Explain your fintech service in 60 seconds")}</p>
        </div>
      </div>
      <div class="button-row">
        <button class="secondary-button" data-action="go" data-view="mission">${icon("mission")}미션 보기</button>
        <button class="ghost-button" data-action="go" data-view="weekly">${icon("report")}주간 리포트</button>
      </div>
    </section>

    <section class="section">
      <div class="section-heading">
        <h3>Practice Modes</h3>
        <small>${state.scenarios.length} scenarios</small>
      </div>
      <div class="grid">
        ${state.scenarios.slice(0, 3).map((scenario) => renderScenarioCard(scenario)).join("")}
      </div>
    </section>
  `;
}

function renderTest() {
  return `
    <section class="screen-title">
      <div>
        <h2>Level Test</h2>
        <p>CEFR 진단과 4주 학습 계획을 생성합니다.</p>
      </div>
    </section>
    ${renderScenarioSelect()}
    ${renderConversation()}
  `;
}

function renderPractice() {
  if (state.sessionActive) {
    return `
      <section class="screen-title">
        <div>
          <h2>Conversation</h2>
          <p>${escapeHtml(getSelectedScenario().title)}</p>
        </div>
      </section>
      ${renderConversation(false)}
    `;
  }

  return `
    <section class="screen-title">
      <div>
        <h2>Practice</h2>
        <p>여행·컨퍼런스·핀테크 미팅 상황을 고릅니다.</p>
      </div>
    </section>
    <div class="grid">
      ${state.scenarios.map((scenario) => renderScenarioCard(scenario, true)).join("")}
    </div>
  `;
}

function renderConversation(showAssessmentAction = true) {
  const selected = getSelectedScenario();
  const progress = Math.max(0, Math.min(100, Math.round((1 - state.timerSeconds / 180) * 100)));
  const status = getConversationStatus();
  const endAction = showAssessmentAction ? "end-test" : "end-practice";
  const endLabel = showAssessmentAction ? "테스트 종료" : "연습 종료";

  return `
    <section class="conversation-stage section">
      <div class="coach-panel">
        <img src="/assets/coach-character.png" alt="AI coach character" />
        <div>
          <h3>${escapeHtml(selected.title)}</h3>
          <p>${escapeHtml(selected.opening_question)}</p>
          <div class="meter-line">
            <span id="timerText">${formatTimer(state.timerSeconds)}</span>
            <div class="bar" aria-hidden="true"><span style="--value:${progress}%"></span></div>
            <span id="conversationStatus">${status}</span>
          </div>
        </div>
      </div>

      <div class="control-panel">
        <button class="primary-button" data-action="toggle-mic">${icon(state.isListening ? "stop" : "mic")}${state.isListening ? "멈춤" : "말하기"}</button>
        <button class="secondary-button" data-action="${endAction}">${icon("check")}${endLabel}</button>
        <button class="icon-button" title="Hint" aria-label="Hint" data-action="hint">${icon("spark")}</button>
        <button class="icon-button" title="Better expression" aria-label="Better expression" data-action="better">${icon("chevron")}</button>
        <button class="icon-button" title="Repeat" aria-label="Repeat" data-action="repeat">${icon("repeat")}</button>
        <button class="icon-button" title="Slow down" aria-label="Slow down" data-action="slow">${icon("slow")}</button>
      </div>

      ${!hasSpeechRecognition() ? `<div class="notice">이 브라우저는 음성 인식을 지원하지 않아 텍스트 데모 답변을 사용할 수 있습니다.</div>` : ""}

      <div id="transcriptList" class="transcript">
        ${renderTranscript()}
      </div>

      <button class="ghost-button wide" data-action="demo-answer">${icon("spark")}데모 답변 추가</button>
    </section>
  `;
}

function renderScenarioSelect() {
  return `
    <select class="scenario-select" data-action="select-scenario" aria-label="Scenario">
      ${state.scenarios
        .map(
          (scenario) =>
            `<option value="${scenario.id}" ${scenario.id === state.selectedScenarioId ? "selected" : ""}>${escapeHtml(scenario.title)}</option>`
        )
        .join("")}
    </select>
  `;
}

function renderTranscript() {
  if (!state.transcript.length && !state.interimText) {
    return `
      <div class="empty-state">
        <p>AI 질문이 표시되면 영어로 답변을 시작하세요.</p>
      </div>
    `;
  }

  const turns = state.transcript
    .map(
      (turn) => `
        <div class="turn ${turn.speaker === "user" ? "user" : "ai"}">
          <div class="bubble">
            <span class="turn-label">${turn.speaker === "user" ? "You" : "Coach"}</span>
            ${escapeHtml(turn.text)}
          </div>
        </div>
      `
    )
    .join("");
  const interim = state.interimText
    ? `<div class="turn user"><div class="bubble"><span class="turn-label">You</span>${escapeHtml(state.interimText)}</div></div>`
    : "";
  return turns + interim;
}

function renderMission() {
  const mission = state.mission;
  if (!mission) {
    return `
      <section class="empty-state">
        <p>오늘의 미션을 불러오는 중입니다.</p>
      </section>
    `;
  }

  return `
    <section class="screen-title">
      <div>
        <h2>Today’s Mission</h2>
        <p>${escapeHtml(mission.scenario)}</p>
      </div>
      <div class="level-chip">+${mission.expected_xp || 50} XP</div>
    </section>

    <section class="card">
      <span class="stat-label">Goal</span>
      <strong class="stat-value" style="font-size:22px; line-height:1.15">${escapeHtml(mission.goal)}</strong>
      <p style="color:var(--muted); font-size:13px; line-height:1.45">완료 조건: ${mission.minimum_speaking_seconds}초 이상 말하기, ${mission.minimum_score}점 이상</p>
    </section>

    <section class="section">
      <div class="section-heading">
        <h3>Target Expressions</h3>
        <small>${mission.estimated_time_minutes} min</small>
      </div>
      <div class="chip-list">
        ${mission.target_expressions.map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}
      </div>
      <div class="button-row">
        <button class="primary-button" data-action="begin-practice" data-scenario="conference_booth">${icon("mic")}미션 시작</button>
        <button class="secondary-button" data-action="complete-mission">${icon("check")}완료 처리</button>
      </div>
    </section>
  `;
}

function renderReport() {
  const assessment = state.assessment;
  if (!assessment) {
    return `
      <section class="screen-title">
        <div>
          <h2>Assessment</h2>
          <p>레벨 테스트 후 리포트가 생성됩니다.</p>
        </div>
      </section>
      <div class="empty-state">
        <p>아직 생성된 리포트가 없습니다.</p>
        <button class="primary-button" data-action="begin-test">${icon("test")}Start Level Test</button>
      </div>
    `;
  }

  return `
    <section class="screen-title">
      <div>
        <h2>Assessment</h2>
        <p>Estimated CEFR: ${escapeHtml(assessment.estimated_cefr_level)}</p>
      </div>
    </section>

    <section class="card">
      <div class="score-ring" style="--score:${assessment.overall_score}">
        <strong>${assessment.overall_score}</strong>
      </div>
      <div class="metric-list">
        ${renderMetric("Fluency", assessment.fluency_score)}
        ${renderMetric("Grammar", assessment.grammar_score)}
        ${renderMetric("Vocabulary", assessment.vocabulary_score)}
        ${renderMetric("Pronunciation", assessment.pronunciation_clarity_score)}
        ${renderMetric("Interaction", assessment.interaction_score)}
        ${renderMetric("Business", assessment.business_english_score)}
      </div>
    </section>

    <section class="section grid">
      ${renderReportBlock("Strengths", assessment.strengths)}
      ${renderReportBlock("Weaknesses", assessment.weaknesses)}
      ${renderCorrectionBlock(assessment.corrected_sentences)}
      ${renderReportBlock("Better Expressions", assessment.better_expressions)}
    </section>
  `;
}

function renderPlan() {
  const plan = state.learningPlan.length ? state.learningPlan : defaultPlan();
  return `
    <section class="screen-title">
      <div>
        <h2>Learning Plan</h2>
        <p>4주 맞춤 스피킹 과정</p>
      </div>
    </section>
    <div class="week-list">
      ${plan
        .map(
          (week) => `
          <article class="card week-item">
            <span class="stat-label">Week ${week.week}</span>
            <h3 style="margin:6px 0 6px; font-size:17px">${escapeHtml(week.topic)}</h3>
            <p style="margin:0; color:var(--muted); font-size:13px; line-height:1.4">${escapeHtml(week.scenario)}</p>
            <div class="chip-list" style="margin-top:10px">
              ${(week.key_expressions || []).slice(0, 2).map((item) => `<span class="chip">${escapeHtml(item)}</span>`).join("")}
            </div>
          </article>
        `
        )
        .join("")}
    </div>
  `;
}

function renderScenarioCard(scenario, withStart = false) {
  return `
    <article class="card scenario-card">
      <div class="section-heading" style="margin-bottom:6px">
        <h4>${escapeHtml(scenario.title)}</h4>
        <small>${escapeHtml(scenario.level)}</small>
      </div>
      <p>${escapeHtml(scenario.opening_question)}</p>
      <div class="chip-list" style="margin-top:10px">
        <span class="chip">${escapeHtml(scenario.category)}</span>
        <span class="chip">${escapeHtml(scenario.target_expressions[0])}</span>
      </div>
      ${
        withStart
          ? `<button class="secondary-button wide" style="margin-top:12px" data-action="begin-practice" data-scenario="${scenario.id}">${icon("mic")}연습 시작</button>`
          : ""
      }
    </article>
  `;
}

function renderWeekly() {
  const weekly = state.weeklyScore || {};
  const streak = state.streak || {};
  const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const completed = Math.min(7, weekly.completed_missions || 3);

  return `
    <section class="screen-title">
      <div>
        <h2>Weekly Report</h2>
        <p>연속학습과 주간 점수를 확인합니다.</p>
      </div>
    </section>

    <section class="grid two">
      <div class="card stat-card">
        <span class="stat-label">Current Streak</span>
        <strong class="stat-value">${streak.current_streak || 0}일</strong>
      </div>
      <div class="card stat-card">
        <span class="stat-label">Best Streak</span>
        <strong class="stat-value">${streak.best_streak || 0}일</strong>
      </div>
    </section>

    <section class="section">
      <div class="day-track">
        ${days.map((day, index) => `<div class="day ${index < completed ? "done" : ""}">${day}</div>`).join("")}
      </div>
    </section>

    <section class="section grid">
      <div class="card stat-card">
        <span class="stat-label">Weekly Score</span>
        <strong class="stat-value">${weekly.total_score || 0}</strong>
      </div>
      <div class="card stat-card">
        <span class="stat-label">XP Earned</span>
        <strong class="stat-value">${weekly.total_xp || 0}</strong>
      </div>
      <div class="card report-block">
        <h4>Most Improved Skill</h4>
        <p>Business English: fintech service explanation</p>
      </div>
      <div class="card report-block">
        <h4>Next Week Focus</h4>
        <p>Use longer answers with one concrete example and softer business phrasing.</p>
      </div>
    </section>
  `;
}

function renderReportBlock(title, items) {
  return `
    <article class="card report-block">
      <h4>${escapeHtml(title)}</h4>
      ${(items || []).map((item) => `<p>${escapeHtml(String(item))}</p>`).join("")}
    </article>
  `;
}

function renderCorrectionBlock(items) {
  return `
    <article class="card report-block">
      <h4>Corrected Sentences</h4>
      ${(items || [])
        .map(
          (item) => `
          <p><strong>Before:</strong> ${escapeHtml(item.original || "")}</p>
          <p><strong>After:</strong> ${escapeHtml(item.corrected || "")}</p>
          <p>${escapeHtml(item.note || "")}</p>
        `
        )
        .join("")}
    </article>
  `;
}

function renderMetric(label, value) {
  return `
    <div class="metric">
      <span>${escapeHtml(label)}</span>
      <div class="bar"><span style="--value:${value}%"></span></div>
      <strong>${value}</strong>
    </div>
  `;
}

function renderNav() {
  const items = [
    ["home", "홈", "home"],
    ["test", "테스트", "test"],
    ["mission", "미션", "mission"],
    ["practice", "연습", "mic"],
    ["report", "리포트", "report"],
    ["plan", "계획", "plan"]
  ];
  return `
    <nav class="bottom-nav" aria-label="Main navigation">
      ${items
        .map(
          ([view, label, iconName]) => `
          <button class="nav-button ${state.view === view ? "active" : ""}" data-action="go" data-view="${view}">
            ${icon(iconName)}
            <span>${label}</span>
          </button>
        `
        )
        .join("")}
    </nav>
  `;
}

function beginSession(type, scenarioId, goToSessionView) {
  clearInterval(state.timerId);
  state.sessionType = type;
  state.selectedScenarioId = scenarioId || state.selectedScenarioId;
  state.view = type === "level_test" ? "test" : "practice";
  state.transcript = [];
  state.interimText = "";
  state.sessionActive = true;
  state.startedAt = new Date().toISOString();
  state.timerSeconds = type === "level_test" ? 180 : 300;
  state.userWordCount = 0;
  clearPendingResponse();
  render();

  const scenario = getSelectedScenario();
  addTurn("ai", scenario.opening_question);
  speak(scenario.opening_question);

  state.timerId = setInterval(() => {
    if (state.timerSeconds > 0) {
      state.timerSeconds -= 1;
      updateTimerDisplay();
    }
  }, 1000);

  if (goToSessionView) showToast("AI 질문이 시작되었습니다.");
}

async function toggleMic() {
  if (state.isListening) {
    stopRecognition();
    return;
  }

  if (!hasSpeechRecognition()) {
    addDemoAnswer();
    return;
  }

  try {
    if (navigator.mediaDevices?.getUserMedia) {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
    }

    startRecognition();
  } catch {
    showToast("마이크 권한을 확인해 주세요.");
  }
}

function startRecognition() {
  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new Recognition();
  recognition.lang = "en-US";
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onresult = (event) => {
    let interim = "";
    const finalTexts = [];
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const result = event.results[index];
      const text = result[0].transcript.trim();
      if (result.isFinal) {
        state.interimText = "";
        addTurn("user", text);
        state.userWordCount += text.split(/\s+/).filter(Boolean).length;
        finalTexts.push(text);
      } else {
        interim += ` ${text}`;
      }
    }
    state.interimText = interim.trim();

    if (finalTexts.length) {
      state.pendingUserAnswer = [state.pendingUserAnswer, finalTexts.join(" ")]
        .filter(Boolean)
        .join(" ")
        .trim();
    }

    if (state.interimText) {
      clearPendingResponse({ keepText: true });
    } else if (finalTexts.length) {
      scheduleResponseAfterPause();
    }

    updateTranscript();
  };

  recognition.onerror = () => {
    state.isListening = false;
    render();
    showToast("음성 인식을 다시 시작해 주세요.");
  };

  recognition.onend = () => {
    state.isListening = false;
    render();
  };

  state.recognition = recognition;
  state.isListening = true;
  recognition.start();
  render();
}

function stopRecognition() {
  if (state.recognition) {
    state.recognition.stop();
  }
  state.isListening = false;
  render();
}

async function endSession(createReport) {
  stopRecognition();
  clearPendingResponse();
  clearInterval(state.timerId);
  state.sessionActive = false;

  if (!state.transcript.some((turn) => turn.speaker === "user")) {
    addTurn("user", "We help SMEs manage cash flow gaps and provide flexible payment terms.");
  }

  if (createReport) {
    showToast("Speaking report를 생성하고 있습니다.");
    const response = await api("/api/assessment", {
      method: "POST",
      body: {
        mode: "level_test",
        scenarioId: state.selectedScenarioId,
        transcript: state.transcript,
        startedAt: state.startedAt,
        durationSeconds: getSessionDuration()
      }
    });
    state.assessment = response.assessment;
    state.learningPlan = response.learningPlan || [];
    state.view = "report";
    render();
    return;
  }

  state.view = "mission";
  render();
}

function scheduleResponseAfterPause() {
  window.clearTimeout(state.responseTimer);
  const delay = getResponseDelay(state.pendingUserAnswer);
  state.responseDelayMs = delay;
  state.isThinking = true;
  updateConversationStatus();

  state.responseTimer = window.setTimeout(() => {
    const userText = state.pendingUserAnswer.trim();
    state.pendingUserAnswer = "";
    state.responseTimer = null;
    state.isThinking = false;
    updateConversationStatus();

    if (!state.sessionActive || !userText) return;
    respondToUser(userText);
  }, delay);
}

function clearPendingResponse(options = {}) {
  window.clearTimeout(state.responseTimer);
  state.responseTimer = null;
  if (!options.keepText) {
    state.pendingUserAnswer = "";
  }
  state.isThinking = false;
  updateConversationStatus();
}

function getResponseDelay(text) {
  const wordCount = text.split(/\s+/).filter(Boolean).length;
  return Math.max(2800, Math.min(5600, 2400 + wordCount * 95));
}

function respondToUser(userText) {
  const scenario = getSelectedScenario();
  const turns = state.transcript.filter((turn) => turn.speaker === "user").length;
  const reply = buildContextualReply(userText, scenario, turns);
  addTurn("ai", reply);
  speak(reply);
}

function buildContextualReply(userText, scenario, turns) {
  const normalized = userText.toLowerCase();
  const phrase = getAnswerReference(userText);
  const isBusiness = scenario.category === "Business English";
  const isShort = userText.split(/\s+/).filter(Boolean).length < 9;

  if (isShort) {
    return `I got your point about ${phrase}. Could you add one reason or one specific example?`;
  }

  if (isBusiness) {
    if (includesAny(normalized, ["cash flow", "working capital", "liquidity"])) {
      return `You mentioned ${phrase}, which is important for SMEs. Can you give me one concrete example of when a company would need that support?`;
    }

    if (includesAny(normalized, ["bnpl", "pay later", "payment terms", "repayment"])) {
      return `Good. Since you talked about payment terms, how would you explain the repayment period to a foreign buyer in a simple way?`;
    }

    if (includesAny(normalized, ["risk", "credit", "default", "assessment", "scoring"])) {
      return `That connects well to risk management. How do you assess whether a buyer or SME is safe to support?`;
    }

    if (includesAny(normalized, ["revenue", "fee", "traction", "investor", "growth"])) {
      return `You brought up ${phrase}. If an investor asked why the numbers look promising, what would you say next?`;
    }

    return `That makes sense. Building on your answer about ${phrase}, what problem does this solve for small and medium-sized businesses?`;
  }

  if (includesAny(normalized, ["breakfast", "late checkout", "reservation", "room", "hotel"])) {
    return `Nice. You handled the hotel situation. Now could you ask one polite follow-up question about the room or checkout time?`;
  }

  if (includesAny(normalized, ["kid", "child", "family", "table", "menu", "restaurant"])) {
    return `Good family-travel answer. If the staff says there is a wait, how would you respond politely?`;
  }

  if (includesAny(normalized, ["pharmacy", "fever", "doctor", "hospital", "sick"])) {
    return `You explained the health situation clearly. What would you ask next to find the nearest pharmacy or clinic?`;
  }

  const followUps = aiFollowUps[scenario.id] || aiFollowUps.conference_booth;
  const fallback = followUps[(turns - 1) % followUps.length];
  return `I heard your answer about ${phrase}. ${fallback}`;
}

function getAnswerReference(userText) {
  const words = userText
    .replace(/[^\w\s'-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2)
    .slice(0, 7);
  return words.length ? `"${words.join(" ")}"` : "that idea";
}

function includesAny(text, terms) {
  return terms.some((term) => text.includes(term));
}

function giveHint() {
  const scenario = getSelectedScenario();
  const hint = scenario.target_expressions[0] || "Let me give you some context.";
  const text = `Try this: ${hint}`;
  addTurn("ai", text);
  speak(text);
}

function giveBetterExpression() {
  const text = "A more natural version is: We help SMEs manage cash flow gaps between delivery and payment.";
  addTurn("ai", text);
  speak(text);
}

function repeatLastAiTurn() {
  const last = [...state.transcript].reverse().find((turn) => turn.speaker === "ai");
  if (last) speak(last.text);
}

function addDemoAnswer() {
  const sample = getSelectedScenario().category === "Business English"
    ? "We help small and medium-sized businesses manage cash flow gaps. Let me walk you through how our platform works."
    : "We'd like to check in, please. Is breakfast included, and could we get a room with two beds?";
  addTurn("user", sample);
  state.userWordCount += sample.split(/\s+/).length;
  state.pendingUserAnswer = [state.pendingUserAnswer, sample].filter(Boolean).join(" ").trim();
  scheduleResponseAfterPause();
}

async function completeMission() {
  const response = await api("/api/daily-mission/complete", {
    method: "POST",
    body: {
      speakingSeconds: Math.max(60, Math.round(state.userWordCount * 0.45)),
      usedExpressions: 2,
      clarityScore: state.assessment?.pronunciation_clarity_score || 74,
      speakingScore: state.assessment?.overall_score || 78,
      improvedSentence: true
    }
  });
  state.mission = response.mission;
  state.streak = response.streak;
  state.weeklyScore = response.weeklyScore;
  showToast(response.alreadyCompleted ? "오늘 미션은 이미 완료되었습니다." : "미션 완료: XP와 주간 점수가 반영되었습니다.");
  state.view = "home";
  render();
}

function addTurn(speaker, text, shouldRender = true) {
  state.transcript.push({
    speaker,
    text,
    time: new Date().toISOString()
  });
  if (shouldRender) updateTranscript();
}

function updateTranscript() {
  const list = document.querySelector("#transcriptList");
  if (list) {
    list.innerHTML = renderTranscript();
    list.scrollTop = list.scrollHeight;
  }
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = state.slowMode ? 0.78 : 0.95;
  utterance.pitch = 1.02;
  utterance.onstart = () => {
    state.isSpeaking = true;
    updateConversationStatus();
  };
  utterance.onend = () => {
    state.isSpeaking = false;
    updateConversationStatus();
  };
  window.speechSynthesis.speak(utterance);
}

function getSelectedScenario() {
  return state.scenarios.find((scenario) => scenario.id === state.selectedScenarioId) || state.scenarios[0] || {
    id: "conference_booth",
    category: "Business English",
    title: "International conference booth",
    opening_question: "Hi, could you give me a quick overview?",
    target_expressions: ["Let me walk you through how it works."]
  };
}

function getSessionDuration() {
  if (!state.startedAt) return 0;
  return Math.max(1, Math.round((Date.now() - Date.parse(state.startedAt)) / 1000));
}

function updateTimerDisplay() {
  const timer = document.querySelector("#timerText");
  if (timer) timer.textContent = formatTimer(state.timerSeconds);
}

function getConversationStatus() {
  if (state.isSpeaking) return "AI 말하는 중";
  if (state.isThinking) return "답변 완료 판단 중";
  if (state.isListening) return "사용자 답변 듣는 중";
  return "대기 중";
}

function updateConversationStatus() {
  const status = document.querySelector("#conversationStatus");
  if (status) status.textContent = getConversationStatus();
}

function formatTimer(seconds) {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

function defaultPlan() {
  return [
    {
      week: 1,
      topic: "Self-introduction and small talk",
      scenario: "Global Zoom meeting opening",
      key_expressions: ["Can everyone hear me clearly?", "I'll start with a brief overview."]
    },
    {
      week: 2,
      topic: "Family travel English",
      scenario: "Hotel and restaurant role-play",
      key_expressions: ["We'd like to check in, please.", "Do you have any kid-friendly options?"]
    },
    {
      week: 3,
      topic: "Fintech service explanation",
      scenario: "International conference booth",
      key_expressions: ["We help SMEs manage cash flow gaps.", "Let me walk you through a use case."]
    },
    {
      week: 4,
      topic: "Buyer questions and objections",
      scenario: "Foreign buyer meeting",
      key_expressions: ["That is a fair point.", "Let's align on the next steps."]
    }
  ];
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json"
    },
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.message || payload.error || "Request failed");
  }
  return payload;
}

function hasSpeechRecognition() {
  return Boolean(window.SpeechRecognition || window.webkitSpeechRecognition);
}

function showToast(message) {
  state.toast = message;
  render();
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function icon(name) {
  return `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

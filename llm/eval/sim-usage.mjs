// 시뮬레이션 사용: 시연 신입사원 2명이 학습 질문 → 대화 복원 → 보충학습 → 제선 평가 시험을 차례로 한다.
// 실제 사용자가 아니라 스크립트이며, 서버 trace(TRACE_DIR)로 기준선 표를 채우는 데 쓴다. 화면 표시(learning-ui) trace는 브라우저가 없어 남지 않는다.
// usage: 서버를 따로 켠 뒤(예: PORT=3006 TRACE_DIR=… DB_PATH=임시 파일 npm run start:ollama) node llm/eval/sim-usage.mjs http://127.0.0.1:3006
//        그다음 npm run trace:report -- --dir <TRACE_DIR>. 시연 계정 비밀번호는 기본값(DEMO_PASSWORD 없을 때)을 쓴다.
const base = process.argv[2];
const PASSWORD = "steel-2026-demo";
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

async function call(token, method, path, body, headers = {}) {
  const res = await fetch(base + path, { method, headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json };
}
async function login(username) {
  const res = await fetch(base + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password: PASSWORD }) });
  return (await res.json()).token;
}
const key = () => `sim_${Math.random().toString(36).slice(2, 14)}`;
async function waitJob(token, job) {
  for (let i = 0; i < 400; i++) {
    const r = await call(token, "GET", `/api/exam-jobs/${job.id}`);
    if (["succeeded", "failed", "cancelled"].includes(r.json?.state)) return r.json;
    await new Promise((s) => setTimeout(s, 1000));
  }
  return null;
}

const BF = { process_id: "ironmaking", equipment_id: "blast_furnace" };
const SI = { process_id: "ironmaking", equipment_id: "sinter_plant" };
const ANSWERS = {
  correct: {
    sinter_purpose: "소결은 가루 철광석을 고로에 넣기 좋은 소결광으로 만드는 전처리 공정이에요.",
    coke_reduction: "코크스가 열풍과 반응해 일산화탄소를 만들고, 그 일산화탄소가 철광석의 산소를 떼어내는 환원을 해요.",
    blast_furnace_hot_metal: "고로에서 환원과 용융이 일어나 용선이 되고, 용선은 제강 전로로 가서 용강이 돼요.",
  },
  partial: {
    sinter_purpose: "철광석을 가공하는 과정이에요.",
    coke_reduction: "코크스는 연료라서 열을 내요.",
    blast_furnace_hot_metal: "고로에서 쇳물이 만들어져요.",
  },
};
const PERSONAS = [
  {
    user: "trainee03", label: "차근차근형",
    questions: [["고로는 뭐 하는 설비야?", BF], ["이 설비 안은 몇 도야?", BF], ["코크스는 불순물 없애려고 넣는 거죠?", BF], ["열풍로는 뭐 하는 설비야?", { process_id: "ironmaking", equipment_id: "hot_stove" }],
      ["소결기는 왜 필요해?", SI], ["토페도카는 뭘 옮겨?", { process_id: "ironmaking", equipment_id: "torpedo_car" }], ["고로는 어떻게 작동해?", BF], ["슬래그는 어디에 써?", { process_id: "ironmaking", equipment_id: "taphole_casthouse" }]],
    supplementAnswers: ["코크스가 일산화탄소를 만들고 그게 철광석의 산소를 떼어내요.", "일산화탄소가 산소를 떼어내는 환원을 해요."],
    exam: { first: "correct", recheck: "correct", partialOn: ["blast_furnace_hot_metal"] },
  },
  {
    user: "trainee04", label: "헷갈림형",
    questions: [["소결은 쇳물 만드는 과정이잖아요.", SI], ["고로에서 바로 용강이 나오는 거죠?", BF], ["출선구는 뭐야?", BF], ["코크스가 뭐예요?", BF],
      ["고로 하나 짓는 데 얼마나 들어?", BF], ["여기서 나온 쇳물은 어디로 가?", BF], ["미분탄은 어디로 넣어?", BF], ["FINEX는 고로랑 뭐가 달라?", BF]],
    supplementAnswers: ["쇳물을 만드는 과정이에요.", "철광석을 고로에 넣기 좋게 소결광으로 만드는 전처리예요."],
    exam: { first: "partial", recheck: "correct", partialOn: [] },
  },
];

async function learning(token, p) {
  let session = null;
  for (const [question, screen] of p.questions) {
    const t0 = Date.now();
    const r = await call(token, "POST", "/api/chat", { question, screen, ...(session ? { session_id: session } : {}) });
    session = r.json?.session_id ?? session;
    log(p.label, "chat", r.status, r.json?.status ?? r.json?.error, `${Date.now() - t0}ms`, question);
  }
  const restore = await call(token, "GET", `/api/chat/sessions/${session}`);
  log(p.label, "restore", restore.status);
}

async function supplement(token, p) {
  const list = await call(token, "GET", "/api/learning/supplements?section=ironmaking");
  const cand = list.json?.candidates?.[0];
  if (!cand) { log(p.label, "supplement: 후보 없음"); return; }
  let v = await call(token, "POST", "/api/learning/supplements", { section: "ironmaking", concept_id: cand.concept_id, screen: { process_id: "ironmaking" } });
  log(p.label, "supplement start", v.status, cand.concept_id, v.json?.state);
  for (const answer of p.supplementAnswers) {
    if (!v.json?.id || !["awaiting_answer", "awaiting_recheck"].includes(v.json?.state)) break;
    v = await call(token, "POST", `/api/learning/supplements/${v.json.id}/answer`, { answer });
    log(p.label, "supplement answer", v.status, v.json?.state);
  }
}

async function exam(token, p) {
  const started = await call(token, "POST", "/api/exams", { section: "ironmaking" }, { "Idempotency-Key": key() });
  let job = await waitJob(token, started.json);
  let view = job?.result;
  log(p.label, "exam start", started.status, job?.state, view?.state);
  const seen = new Set();
  for (let step = 0; step < 14 && view && view.state !== "completed"; step++) {
    let text;
    if (view.state === "awaiting_ready") text = "네, 준비됐어요.";
    else if (view.state === "awaiting_answer") {
      const id = view.concept?.id;
      const kind = p.exam.partialOn.includes(id) || p.exam.first === "partial" ? "partial" : "correct";
      text = ANSWERS[kind][id] ?? "잘 모르겠어요.";
      seen.add(id);
    } else if (view.state === "awaiting_recheck") text = ANSWERS[p.exam.recheck][view.concept?.id] ?? "잘 모르겠어요.";
    else break;
    const sent = await call(token, "POST", `/api/exams/${view.attempt_id}/commands`, { action: "answer", text }, { "Idempotency-Key": key() });
    job = await waitJob(token, sent.json);
    view = job?.result ?? view;
    log(p.label, "exam", job?.state, view?.state, view?.concept?.id ?? "");
  }
  log(p.label, "exam result", JSON.stringify(view?.result ? { understanding: view.result.understanding, unlocked: view.result.unlocked } : null));
}

for (const p of PERSONAS) {
  const token = await login(p.user);
  log(p.label, "login", token ? "ok" : "failed");
  await learning(token, p);
  await supplement(token, p);
  await exam(token, p);
}
log("done");

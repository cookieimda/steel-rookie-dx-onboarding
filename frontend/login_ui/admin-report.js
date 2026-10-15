// 관리자 보고서(그림 버전, admin-report.html). 신입사원 통계를 차트·표로 그리고 브라우저 인쇄로 A4 PDF를 만든다.
// - 숫자는 서버가 계산한 /api/admin/trainees·/api/admin/concepts 응답 그대로다(관리자 화면·CSV 보고서와 같은 값). 오개념은 개수만 쓴다.
// - 상태(수료·진행 중·재도전 필요·미시작)와 개념 오답률은 관리자 화면(Admin Dashboard.dc.html)과 같은 규칙이다.
// - ?print=1이면 다 그린 뒤 인쇄 창을 바로 연다(관리자 화면의 [PDF 보고서] 버튼).
import { loadAdminData } from './admin_data.js';

const NAMES = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열간압연' };
const STATUS = { done: ['수료', 'var(--ok)'], active: ['진행 중', 'var(--act)'], retry: ['재도전 필요', 'var(--bad)'], idle: ['미시작', 'var(--idle)'] };
const PASS = 0.8;
const pct = (x) => `${Math.round(x * 100)}%`;
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const uColor = (u) => (u >= PASS ? 'var(--ok)' : u >= 0.6 ? 'var(--mid)' : 'var(--bad)');
const kst = (iso, withTime = true) => (iso ? new Date(iso).toLocaleString('sv-SE', { timeZone: 'Asia/Seoul', hour12: false }).slice(0, withTime ? 16 : 10) : '—');

export function statusOf(t, secs) {
  if (secs.length && t.passed_sections === secs.length) return 'done';
  if (secs.some((s) => t.sections[s] && !t.sections[s].passed)) return 'retry';
  if (secs.some((s) => t.sections[s]) || t.in_progress_sections?.length) return 'active';
  return 'idle';
}

/** 보고서에 넣을 숫자를 모은다(그리기와 분리해 확인하기 쉽게). */
export function summarize(trainees, concepts) {
  const secs = trainees.sections, T = trainees.trainees, N = T.length;
  const status = Object.fromEntries(Object.keys(STATUS).map((k) => [k, 0]));
  for (const t of T) status[statusOf(t, secs)]++;
  const all = T.flatMap((t) => secs.map((s) => t.sections[s]).filter(Boolean).map((x) => x.understanding));
  const bySection = secs.map((s) => {
    const done = T.map((t) => t.sections[s]).filter(Boolean);
    return { section: s, name: NAMES[s] || s, demo: trainees.demo_sections?.includes(s), taken: done.length,
      avg: done.length ? done.reduce((a, x) => a + x.understanding, 0) / done.length : null,
      passRate: N ? done.filter((x) => x.passed).length / N : 0, going: T.filter((t) => t.in_progress_sections?.includes(s)).length };
  });
  const top = concepts.concepts.filter((c) => c.asked > 0).map((c) => ({ ...c, miss: c.partial + c.wrong + c.assisted }))
    .sort((a, b) => b.miss / b.asked - a.miss / a.asked || b.wrong - a.wrong).slice(0, 8);
  return { secs, T, N, status, avg: all.length ? all.reduce((a, b) => a + b, 0) / all.length : null,
    openMis: T.reduce((a, t) => a + t.misconceptions.open, 0), bySection, top, includeDemo: trainees.include_demo !== false };
}

// --- 차트(SVG) ---
function statusChart(R) {
  const W = 680, H = 44; let x = 0;
  const parts = Object.entries(STATUS).map(([k, [label, color]]) => {
    const w = R.N ? (R.status[k] / R.N) * W : 0, at = x; x += w;
    return w ? `<rect x="${at}" y="0" width="${w}" height="${H}" fill="${color}"/>${w > 46 ? `<text x="${at + w / 2}" y="${H / 2 + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="${k === 'idle' ? '#161617' : '#fff'}">${R.status[k]}명</text>` : ''}` : '';
  }).join('');
  const legend = Object.entries(STATUS).map(([k, [label, color]]) => `<span><i style="background:${color}"></i>${label} ${R.status[k]}명 (${R.N ? pct(R.status[k] / R.N) : '0%'})</span>`).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="상태 분포"><rect width="${W}" height="${H}" rx="6" fill="var(--panel)"/>${parts}</svg><div class="legend">${legend}</div>`;
}

function sectionChart(R) {
  const W = 680, H = 230, left = 40, bottom = 34, top = 14, plotH = H - top - bottom, n = R.bySection.length || 1, slot = (W - left) / n, bw = Math.min(38, slot / 3.2);
  const y = (v) => top + plotH * (1 - v);
  const grid = [0, 0.25, 0.5, 0.75, 1].map((v) => `<line x1="${left}" x2="${W}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${left - 6}" y="${y(v) + 4}" text-anchor="end" font-size="10" fill="var(--dim)">${v * 100}</text>`).join('');
  const bars = R.bySection.map((s, i) => {
    const cx = left + slot * i + slot / 2, a = s.avg ?? 0;
    const avgBar = s.avg == null ? `<text x="${cx - bw * 0.6}" y="${y(0) - 6}" text-anchor="middle" font-size="10" fill="var(--dim)">응시 없음</text>`
      : `<rect x="${cx - bw - 3}" y="${y(a)}" width="${bw}" height="${plotH * a}" rx="3" fill="${uColor(a)}"/><text x="${cx - bw / 2 - 3}" y="${y(a) - 5}" text-anchor="middle" font-size="11" font-weight="700">${pct(a)}</text>`;
    const passBar = `<rect x="${cx + 3}" y="${y(s.passRate)}" width="${bw}" height="${plotH * s.passRate}" rx="3" fill="#7d8ba3"/><text x="${cx + bw / 2 + 3}" y="${y(s.passRate) - 5}" text-anchor="middle" font-size="11" font-weight="700">${pct(s.passRate)}</text>`;
    return `${avgBar}${passBar}<text x="${cx}" y="${H - bottom + 16}" text-anchor="middle" font-size="12" font-weight="700">${esc(s.name)}</text><text x="${cx}" y="${H - bottom + 30}" text-anchor="middle" font-size="10" fill="var(--dim)">응시 ${s.taken}명${s.going ? ` · 진행 ${s.going}` : ''}${s.demo ? ' · 시연 개념' : ''}</text>`;
  }).join('');
  const line = `<line x1="${left}" x2="${W}" y1="${y(PASS)}" y2="${y(PASS)}" stroke="var(--bad)" stroke-dasharray="5 4"/><text x="${W}" y="${y(PASS) - 4}" text-anchor="end" font-size="10" fill="var(--bad)">통과 기준 80%</text>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="공정별 평균 이해도와 통과율">${grid}${bars}${line}</svg>
    <div class="legend"><span><i style="background:var(--ok)"></i>평균 이해도(응시한 사람, 색은 80%·60% 기준)</span><span><i style="background:#7d8ba3"></i>통과율(전체 인원 대비)</span></div>`;
}

function conceptChart(R) {
  if (!R.top.length) return '<p class="sub">아직 완료한 이해도 확인 기록이 없어요.</p>';
  const W = 680, row = 26, H = R.top.length * row + 4, label = 230, barW = W - label - 60;
  const rows = R.top.map((c, i) => {
    const y0 = i * row + 4; let x = label;
    const seg = [['wrong', 'var(--bad)'], ['partial', 'var(--mid)'], ['assisted', '#8a8a90']].map(([k, color]) => { const w = (c[k] / c.asked) * barW, at = x; x += w; return w ? `<rect x="${at}" y="${y0}" width="${w}" height="16" fill="${color}"/>` : ''; }).join('');
    return `<text x="0" y="${y0 + 13}" font-size="11.5">${i + 1}. ${esc(c.name || c.concept_id)}</text><text x="${label - 8}" y="${y0 + 13}" text-anchor="end" font-size="10" fill="var(--dim)">${esc(NAMES[c.section] || c.section)}</text>
      <rect x="${label}" y="${y0}" width="${barW}" height="16" rx="3" fill="var(--panel)"/>${seg}<text x="${W}" y="${y0 + 13}" text-anchor="end" font-size="12" font-weight="800">${pct(c.miss / c.asked)}</text><text x="${W - 46}" y="${y0 + 13}" text-anchor="end" font-size="10" fill="var(--dim)">${c.miss}/${c.asked}</text>`;
  }).join('');
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="오답률 높은 개념">${rows}</svg>
    <div class="legend"><span><i style="background:var(--bad)"></i>틀림</span><span><i style="background:var(--mid)"></i>부분 정답</span><span><i style="background:#8a8a90"></i>힌트 요청</span><span>첫 답변 기준 · 정답이 아니었던 비율</span></div>`;
}

function traineeTable(R) {
  const order = { retry: 0, active: 1, idle: 2, done: 3 };
  const rows = [...R.T].sort((a, b) => order[statusOf(a, R.secs)] - order[statusOf(b, R.secs)] || a.username.localeCompare(b.username)).map((t) => {
    const [label, color] = STATUS[statusOf(t, R.secs)];
    const cells = R.secs.map((s) => { const x = t.sections[s];
      if (x) return `<td style="color:${uColor(x.understanding)};font-weight:700">${pct(x.understanding)}<span style="color:var(--dim);font-weight:400"> · ${x.attempts}회</span></td>`;
      return `<td style="color:var(--dim)">${t.in_progress_sections?.includes(s) ? '진행 중' : '—'}</td>`; }).join('');
    return `<tr><td class="name">${esc(t.name)}${t.is_demo ? ' <span style="color:var(--dim)">(시연)</span>' : ''}<small>${esc(t.employee_no)}</small></td>
      <td><span class="tag" style="color:${label === '미시작' ? 'var(--muted)' : color};background:color-mix(in srgb, ${color} 14%, transparent)">${label}</span></td>
      <td>${t.passed_sections}/${R.secs.length}</td>${cells}<td>${t.misconceptions.open} / ${t.misconceptions.resolved}</td><td>${kst(t.last_activity)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th class="name">신입사원</th><th>상태</th><th>통과</th>${R.secs.map((s) => `<th>${esc(NAMES[s] || s)}</th>`).join('')}<th>오개념 미해결/해결</th><th>마지막 학습</th></tr></thead><tbody>${rows}</tbody></table>`;
}

export function renderReport(R, now = new Date()) {
  const kpi = (label, value, unit = '') => `<div class="kpi"><span>${label}</span><b>${value}</b><small>${unit}</small></div>`;
  return `<header><div><div class="eyebrow">ST-ROOKIE · TRAINEE REPORT</div><h1>신입사원 학습 현황 보고서</h1></div>
      <div class="meta">작성 ${kst(now.toISOString())} (한국 시간)<br>대상 신입사원 ${R.N}명${R.includeDemo ? ' · 시연 계정 포함' : ''}<br>통과 기준 이해도 ${PASS * 100}%</div></header>
    <div class="kpis">${kpi('신입사원', R.N, '명')}${kpi('전 과정 수료', R.status.done, `명 · ${R.N ? pct(R.status.done / R.N) : '0%'}`)}${kpi('평균 이해도', R.avg == null ? '—' : pct(R.avg), '응시한 공정')}${kpi('미해결 오개념', R.openMis, '개(개념 수 합)')}</div>
    <section><h2>진행 상태</h2><p class="sub">수료 = 모든 공정 통과 · 재도전 필요 = 기준 미달 공정이 있음 · 진행 중 = 응시 중이거나 일부 통과</p>${statusChart(R)}</section>
    <section><h2>공정별 평균 이해도와 통과율</h2><p class="sub">공정마다 마지막 이해도 확인 결과 기준. 점선은 통과 기준 80%</p>${sectionChart(R)}</section>
    <section><h2>오답률 높은 개념 (상위 ${Math.min(8, R.top.length) || 0})</h2><p class="sub">복습 자료·교육 보강이 필요한 개념</p>${conceptChart(R)}</section>
    <section style="break-inside:auto"><h2>신입사원별 현황</h2><p class="sub">재도전 필요 → 진행 중 → 미시작 → 수료 순 · 칸은 이해도 · 시도 횟수</p>${traineeTable(R)}</section>
    <p class="note">숫자는 서버 DB에서 계산한 값(관리자 화면·CSV 보고서와 같음)입니다. 오개념은 개수만 표시하며 내용과 답변 원문은 본인만 볼 수 있습니다.</p>`;
}

async function boot() {
  const root = document.getElementById('report');
  document.getElementById('print').addEventListener('click', () => window.print());
  document.getElementById('close').addEventListener('click', () => window.close());
  try {
    const data = await loadAdminData();
    root.innerHTML = renderReport(summarize(data.trainees, data.concepts));
    document.title = `신입사원_학습현황_${kst(new Date().toISOString(), false).replace(/-/g, '')}`; // 'PDF로 저장' 기본 파일 이름
    if (new URLSearchParams(location.search).get('print') === '1') { await document.fonts?.ready; setTimeout(() => window.print(), 300); }
  } catch (e) {
    root.innerHTML = `<p class="msg">${e.message === '401' || e.message === '403' ? '관리자로 로그인한 뒤 다시 열어 주세요.' : '보고서 데이터를 불러오지 못했어요. 서버 연결을 확인해 주세요.'}</p>`;
  }
}
if (typeof document !== 'undefined') void boot();

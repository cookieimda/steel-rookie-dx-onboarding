// 평가 시험 페이지(/exam)의 그림 요소(2026-10-15): 공정 아이콘, 통과 기준 그래프, 공정 로드맵, 응시 가능 네모 칸(GitHub 잔디처럼),
// 진행 순서 아이콘, 학습 캘린더(복습 일정 · 배정된 시험 · 최근 평가 기록). 데이터는 exam.js가 넘긴다(API는 그대로).
// 아이콘은 이 파일의 고정 SVG 문자열이라 innerHTML로 넣는다(사용자 입력은 textContent로만 넣는다).

const svg = (body, view = '0 0 48 48') => `<svg viewBox="${view}" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

/** 공정 아이콘: 제선(고로) · 제강(전로) · 연주(주형과 휘어 나오는 주편) · 열연(압연 롤 사이를 지나는 판) */
export const PROCESS_ICONS = {
  ironmaking: svg('<path d="M17 42h14M18 42l2-24h8l2 24"/><path d="M20 18l-2-8h12l-2 8"/><path d="M21 34h6"/><path class="hot" d="M24 6c-2 2-2 4 0 5 2-1 2-3 0-5z" fill="currentColor"/><path d="M30 26h6v6"/>'),
  steelmaking: svg('<path d="M12 16h22l-3 20a6 6 0 0 1-6 5h-4a6 6 0 0 1-6-5z"/><path d="M14 22h18"/><path d="M8 20l4-2M38 20l-4-2"/><path class="hot" d="M34 12c4 2 6 6 6 10" /><path d="M23 4v8"/>'),
  continuous_casting: svg('<path d="M16 6h16v8H16z"/><path d="M20 14v8c0 10 6 16 20 16"/><path d="M28 14v8c0 4 3 8 12 8"/><circle cx="14" cy="28" r="2.5"/><circle cx="20" cy="36" r="2.5"/><circle cx="30" cy="42" r="2.5"/>'),
  rolling: svg('<circle cx="24" cy="12" r="7"/><circle cx="24" cy="36" r="7"/><path d="M4 24h12M32 24h12"/><path d="M4 21h12v6H4zM32 22.5h12v3H32z"/><path d="M38 20l4 4-4 4"/>'),
};
/** 이름 줄임(로드맵·카드 아래 이름표) */
export const SHORT_NAMES = { ironmaking: '제선', steelmaking: '제강', continuous_casting: '연주', rolling: '열연' };

/** 진행 순서 아이콘: 공정 선택(손가락으로 고르기) · 자신의 말로 답하기(말풍선과 연필) · 설명과 추가 확인(전구와 물음표) · 결과 확인(막대그래프와 체크) */
export const STEP_ICONS = [
  svg('<rect x="6" y="8" width="16" height="14" rx="3"/><rect x="26" y="8" width="16" height="14" rx="3"/><rect x="6" y="26" width="16" height="14" rx="3"/><path d="M30 44V31a2.5 2.5 0 0 1 5 0v6l4 1a3 3 0 0 1 2 3.5L40 44"/>'),
  svg('<path d="M8 10h28a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H20l-8 7v-7H8a4 4 0 0 1-4-4V14a4 4 0 0 1 4-4z"/><path d="M15 26l2-6 10-10 4 4-10 10z"/>'),
  svg('<path d="M18 34h12M19 39h10"/><path d="M24 6a12 12 0 0 0-7 21.7c1.3 1 2 2.4 2 4.3h10c0-1.9.7-3.3 2-4.3A12 12 0 0 0 24 6z"/><path d="M21 15a3.5 3.5 0 1 1 4.5 3.3c-1 .4-1.5 1.2-1.5 2.2V22"/><path d="M24 26h.01"/>'),
  svg('<path d="M8 40h32"/><path d="M12 40V28M20 40V20M28 40V24M36 40V12"/><path d="M10 16l6-6 5 4 9-8" /><path d="M26 6h4v4"/>'),
];

/** 고정 SVG 문자열 → 요소 */
export function icon(markup, className = 'ico') {
  const wrap = document.createElement('span');
  wrap.className = className;
  wrap.innerHTML = markup;
  return wrap;
}
const el = (tag, className = '', text) => { const n = document.createElement(tag); if (className) n.className = className; if (text !== undefined) n.textContent = text; return n; };
const NS = 'http://www.w3.org/2000/svg';
const s = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v)); return n; };

/** 공정 상태: pass(통과) · progress(응시 중) · open(응시 가능) · locked(잠금) · prep(시험 준비 중) */
export const kindOf = (s) => (!s.checkpoint ? 'prep' : s.progress?.unlocked ? 'pass' : s.progress?.in_progress_attempt_id ? 'progress' : s.progress?.open ? 'open' : 'locked');

/**
 * 통과 기준 그래프: 공정별 이해도 막대 + 기준선(점선). 응시 전 공정은 빈 막대, 시험 준비 중이면 '준비 중'.
 * 막대 색: 기준 이상 ok, 60% 이상 mid, 그 아래 bad.
 */
export function renderThresholdChart(root, sections, threshold = 0.8) {
  const W = 260, H = 120, top = 10, bottom = 26, left = 6, right = 6;
  const plotH = H - top - bottom, slot = (W - left - right) / Math.max(1, sections.length), barW = Math.min(30, slot * 0.46);
  const chart = s('svg', { viewBox: `0 0 ${W} ${H}`, class: 'tchart', role: 'img' });
  const desc = sections.map((x) => `${x.name} ${x.progress?.understanding == null ? (x.checkpoint ? '응시 전' : '준비 중') : `${Math.round(x.progress.understanding * 100)}%`}`).join(', ');
  chart.setAttribute('aria-label', `통과 기준 ${Math.round(threshold * 100)}% · ${desc}`);
  sections.forEach((x, i) => {
    const cx = left + slot * i + slot / 2, u = x.progress?.understanding;
    chart.append(s('rect', { x: cx - barW / 2, y: top, width: barW, height: plotH, rx: 6, class: 'track' }));
    if (u != null) {
      const h = Math.max(4, plotH * u), tone = u >= threshold ? 'ok' : u >= 0.6 ? 'mid' : 'bad';
      const bar = s('rect', { x: cx - barW / 2, y: top + plotH - h, width: barW, height: h, rx: 6, class: `fill ${tone}` });
      bar.style.setProperty('--h', `${h}px`);
      chart.append(bar);
      const t = s('text', { x: cx, y: top + plotH - h - 4, class: 'val' }); t.textContent = `${Math.round(u * 100)}`; chart.append(t);
    }
    const label = s('text', { x: cx, y: H - 6, class: `lab${kindOf(x) === 'prep' ? ' dim' : ''}` }); label.textContent = SHORT_NAMES[x.section] || x.name; chart.append(label);
  });
  const y = top + plotH * (1 - threshold);
  chart.append(s('line', { x1: left, x2: W - right, y1: y, y2: y, class: 'line' }));
  const tag = s('text', { x: W - right, y: y - 4, class: 'line-tag' }); tag.textContent = `기준 ${Math.round(threshold * 100)}%`; chart.append(tag);
  root.replaceChildren(chart);
}

/** 공정 로드맵: 제선 → 제강 → 연주 → 열연을 길로 잇고, 통과한 공정은 채운 아이콘과 체크, 지금 갈 공정은 깃발. */
export function renderRoadmap(root, sections, onPick) {
  const passed = sections.filter((x) => kindOf(x) === 'pass').length;
  const nextIndex = sections.findIndex((x) => ['progress', 'open'].includes(kindOf(x)));
  const road = el('ol', 'roadmap');
  // 채운 길: 통과한 공정까지(첫 공정을 통과하면 다음 공정까지 이어진다)
  road.style.setProperty('--done', String(sections.length > 1 ? Math.min(1, passed / (sections.length - 1)) : 0));
  sections.forEach((x, i) => {
    const kind = kindOf(x), item = el('li', `stop ${kind}${i === nextIndex ? ' next' : ''}`);
    const node = el('button', 'stop-node'); node.type = 'button';
    node.setAttribute('aria-label', `${x.name} · ${{ pass: '통과', progress: '응시 중', open: '응시 가능', locked: '잠금', prep: '시험 준비 중' }[kind]}`);
    node.append(icon(PROCESS_ICONS[x.section] || '', 'ico'));
    if (kind === 'pass') node.append(el('span', 'stop-badge', '✓'));
    else if (kind === 'locked') node.append(el('span', 'stop-badge lock', '🔒'));
    if (i === nextIndex) node.append(el('span', 'stop-flag', '지금'));
    node.addEventListener('click', () => onPick?.(i));
    item.append(node, el('span', 'stop-name', SHORT_NAMES[x.section] || x.name));
    road.append(item);
  });
  root.replaceChildren(road);
}

/**
 * 응시 가능 네모 칸(GitHub 잔디처럼): 공정마다 한 줄, 개념마다 한 칸. 진할수록 많이 해낸 칸이다.
 * 0 잠금·준비 중, 1 응시 가능(아직 안 봄), 2 다시 볼 개념, 3 응시 중 확정, 4 통과·만점 개념.
 */
export function renderSquares(root, sections, onPick) {
  const grid = el('div', 'squares');
  sections.forEach((x, i) => {
    const kind = kindOf(x), p = x.progress, n = Math.max(3, x.concept_count || 0);
    const retry = new Set(p?.retry_concept_ids || []);
    const done = kind === 'progress' ? p?.in_progress?.done ?? 0 : 0;
    const row = el('button', `sq-row ${kind}`); row.type = 'button';
    row.setAttribute('aria-label', `${x.name} · ${{ pass: '통과', progress: '응시 중', open: '응시 가능', locked: '잠금', prep: '시험 준비 중' }[kind]}`);
    row.append(el('span', 'sq-name', SHORT_NAMES[x.section] || x.name));
    const cells = el('span', 'sq-cells');
    for (let c = 0; c < n; c++) {
      let level = 0;
      if (kind === 'pass') level = 4;
      else if (kind === 'progress') level = c < done ? 3 : 1;
      else if (kind === 'open') level = p?.understanding == null ? 1 : c < retry.size ? 2 : 4;
      const cell = el('i', `sq l${level}`); cells.append(cell);
    }
    row.append(cells);
    row.addEventListener('click', () => onPick?.(i));
    grid.append(row);
  });
  const legend = el('div', 'sq-legend');
  legend.append(el('span', '', '잠김'));
  for (let l = 0; l <= 4; l++) legend.append(el('i', `sq l${l}`));
  legend.append(el('span', '', '통과'));
  root.replaceChildren(grid, legend);
}

/** 진행 순서(공정 선택 → 자신의 말로 답하기 → 설명과 추가 확인 → 결과 확인)를 아이콘 카드로. 지금 단계(active)는 강조. */
export const STEPS = [
  ['공정 선택', '시험지를 넘겨 공정을 골라요'],
  ['자신의 말로 답하기', '포석호의 질문에 내 말로'],
  ['설명과 추가 확인', '놓친 부분은 설명 뒤 한 번 더'],
  ['결과 확인', '80% 이상이면 다음 공정이 열려요'],
];
export function renderSteps(root, active = 0) {
  const list = el('ol', 'flow');
  list.setAttribute('aria-label', '진행 순서');
  STEPS.forEach(([title, sub], i) => {
    const li = el('li', `flow-step${i === active ? ' on' : ''}${i < active ? ' done' : ''}`);
    li.append(el('span', 'flow-num', String(i + 1)), icon(STEP_ICONS[i], 'flow-ico'), el('strong', '', title), el('small', '', sub));
    list.append(li);
  });
  root.replaceChildren(list);
}

// ── 학습 캘린더 ──
export const kstDay = (iso) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);
const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
export const CAL_KINDS = { review: ['복습', 'mid'], assignment: ['배정 시험', 'accent'], pass: ['평가 통과', 'ok'], retry: ['평가 다시 도전', 'bad'] };

/**
 * 달력. items: [{ date: 'YYYY-MM-DD', kind: 'review'|'assignment'|'pass'|'retry', ... }].
 * 날마다 종류별 점, 오늘은 테두리, 고른 날은 채움. 달 이동·날 고르기는 콜백으로 exam.js 상태를 바꾼다.
 */
export function renderCalendar(root, { month, selected, today, items, onMonth, onPick }) {
  const [y, m] = month.split('-').map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1)), startDow = first.getUTCDay(), days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const byDay = new Map();
  for (const it of items) { if (!byDay.has(it.date)) byDay.set(it.date, []); byDay.get(it.date).push(it); }
  const head = el('div', 'cal-head');
  const prev = el('button', 'cal-nav', '‹'); prev.type = 'button'; prev.setAttribute('aria-label', '이전 달'); prev.addEventListener('click', () => onMonth(-1));
  const next = el('button', 'cal-nav', '›'); next.type = 'button'; next.setAttribute('aria-label', '다음 달'); next.addEventListener('click', () => onMonth(1));
  const todayBtn = el('button', 'cal-today', '오늘'); todayBtn.type = 'button'; todayBtn.addEventListener('click', () => onPick(today, true));
  head.append(prev, el('strong', 'cal-title', `${y}년 ${m}월`), next, todayBtn);
  const grid = el('div', 'cal-grid'); grid.setAttribute('role', 'grid');
  WEEK.forEach((w, i) => grid.append(el('span', `cal-dow${i === 0 ? ' sun' : i === 6 ? ' sat' : ''}`, w)));
  for (let i = 0; i < startDow; i++) grid.append(el('span', 'cal-empty'));
  for (let d = 1; d <= days; d++) {
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, list = byDay.get(date) || [];
    const cell = el('button', `cal-day${date === today ? ' today' : ''}${date === selected ? ' sel' : ''}${list.length ? ' has' : ''}`); cell.type = 'button';
    cell.setAttribute('aria-label', `${m}월 ${d}일${list.length ? ` · ${[...new Set(list.map((x) => CAL_KINDS[x.kind][0]))].join(', ')}` : ''}`);
    cell.append(el('span', 'cal-num', String(d)));
    const dots = el('span', 'cal-dots');
    for (const kind of Object.keys(CAL_KINDS)) if (list.some((x) => x.kind === kind)) dots.append(el('i', `dot ${CAL_KINDS[kind][1]}`));
    cell.append(dots);
    cell.addEventListener('click', () => onPick(date));
    grid.append(cell);
  }
  const legend = el('div', 'cal-legend');
  for (const [, [label, tone]] of Object.entries(CAL_KINDS)) { const item = el('span'); item.append(el('i', `dot ${tone}`), document.createTextNode(label)); legend.append(item); }
  root.replaceChildren(head, grid, legend);
}

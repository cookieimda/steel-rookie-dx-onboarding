// 3D 공정 화면 대시보드 배치(레퍼런스: 왼쪽 위 3D 뷰 · 그 아래 카드 · 오른쪽 What-if 열).
// 아래 카드는 탭 2개: [조업 전광판] 표 + 오른쪽(온도 지표는 원호 다이얼, 나머지는 실험 변경 이력 차트. 3D 공중 전광판·What-if 위 다이얼을 대신한다) / [온도 흐름] 왼쪽 패널.
// 단계 설명 탭은 뺐다(2026-10-16 요청): 단계 설명은 제철 공정 지도(steel-intro)의 [▶ 재생]에서 공정을 확대해 본다(intro-tour.js). 대시보드 배치에서는 설비 설명 패널(#right)이 보이지 않는다(lab-console-glass.css).
// 단계 설명과 온도 흐름은 기존 패널을 옮기지 않고, 이 카드 자리에 겹쳐 보이게 CSS(lab-console-glass.css, body.lab-dock)로 배치한다.
// 폭 1001px 이상에서만 이 배치를 쓰고, 그보다 좁으면 원래 화면 그대로다.
import { displayNumber, tempPosition } from './lab-display-data.js';
import { arcGaugeHtml } from './lab-gauge-arc.js';

const TABS = [['board', '조업 전광판'], ['temp', '온도 흐름']];
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const tone = (d) => (d === 'up' ? 'up' : d === 'down' ? 'down' : 'flat');

/** 값 이력 하나를 작은 선으로(표 안). */
function spark(values, cls) {
  if (values.length < 2) return '<svg class="lab-spark" viewBox="0 0 120 28" aria-hidden="true"><line x1="0" y1="14" x2="120" y2="14"/></svg>';
  const min = Math.min(...values), range = Math.max(1e-9, Math.max(...values) - min);
  const pts = values.map((v, i) => `${(i / (values.length - 1) * 120).toFixed(1)},${(24 - (v - min) / range * 20).toFixed(1)}`).join(' ');
  return `<svg class="lab-spark ${cls}" viewBox="0 0 120 28" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}

/** 고른 지표의 실험 변경 이력(큰 차트): 기준값 점선 + 값 선 + 아래 면. */
function chart(row, values) {
  const W = 420, H = 190, L = 44, B = 26, T = 12;
  if (!row) return '<p class="lab-dock-empty">지표를 고르면 실험 변경 이력이 여기 그려져요.</p>';
  const vs = values.length ? values : [row.base, row.value];
  const lo = Math.min(...vs, row.base), hi = Math.max(...vs, row.base), pad = Math.max((hi - lo) * .15, Math.abs(row.base) * .01, 1);
  const y0 = lo - pad, y1 = hi + pad, X = (i) => L + (vs.length < 2 ? 0 : i / (vs.length - 1)) * (W - L - 8), Y = (v) => T + (1 - (v - y0) / (y1 - y0)) * (H - T - B);
  const ticks = [0, .5, 1].map((k) => y0 + (y1 - y0) * k);
  const line = vs.map((v, i) => `${X(i).toFixed(1)},${Y(v).toFixed(1)}`).join(' ');
  const area = `${X(0).toFixed(1)},${(H - B).toFixed(1)} ${line} ${X(vs.length - 1).toFixed(1)},${(H - B).toFixed(1)}`;
  return `<div class="lab-dock-chart-head"><b>${esc(row.label)}</b><span>실험 ${vs.length - 1}회 · 단위 ${esc(row.unit)}</span></div>
    <svg class="lab-dock-chart ${tone(row.direction)}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(row.label)} 실험 변경 이력, 마지막 값 ${displayNumber(row.value, row.digits)} ${esc(row.unit)}">
      ${ticks.map((v) => `<line class="grid" x1="${L}" x2="${W - 8}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L - 6}" y="${(Y(v) + 4).toFixed(1)}" text-anchor="end">${displayNumber(v, row.digits)}</text>`).join('')}
      <line class="base" x1="${L}" x2="${W - 8}" y1="${Y(row.base).toFixed(1)}" y2="${Y(row.base).toFixed(1)}"/>
      <polygon class="area" points="${area}"/><polyline class="val" points="${line}"/>
      <circle class="end" cx="${X(vs.length - 1).toFixed(1)}" cy="${Y(vs[vs.length - 1]).toFixed(1)}" r="4"/>
      <text class="axis" x="${L}" y="${H - 6}">기준</text><text class="axis" x="${W - 8}" y="${H - 6}" text-anchor="end">지금</text>
    </svg>`;
}

export function createDock() {
  const wide = matchMedia('(min-width: 1001px)');
  const card = document.createElement('section');
  card.className = 'lab-dock-card'; card.setAttribute('aria-label', '조업 전광판 · 단계 설명 · 온도 흐름');
  card.innerHTML = `<div class="lab-dock-tabs" role="tablist">${TABS.map(([k, label]) => `<button type="button" role="tab" data-dock-tab="${k}" aria-selected="false">${label}</button>`).join('')}
      <span class="lab-dock-note" data-dock-note></span></div>
    <div class="lab-dock-body">
      <div class="lab-board" data-dock-pane="board"><div class="lab-board-table" data-board-table></div><div class="lab-board-chart" data-board-chart></div></div>
    </div>`;
  document.body.appendChild(card);
  let tab = 'board', rows = [], picked = null, name = '', pid = '';
  // 온도 지표(℃)는 이력 선 대신 원호 다이얼로 보인다. 범위는 lab-console.js의 What-if 계기와 같은 규칙(제선 1380~1560℃)
  const dial = (r) => {
    const low = pid === 'ironmaking' ? 1380 : Math.floor((r.base - 150) / 50) * 50, high = pid === 'ironmaking' ? 1560 : low + 300;
    return arcGaugeHtml({ title: r.label, value: displayNumber(r.value, r.digits), pos: tempPosition(r.value, low, high), low, high, direction: r.direction, delta: displayNumber(Math.abs(r.delta), r.digits) });
  };
  const series = new Map();

  function setTab(next) {
    tab = next; document.body.dataset.labTab = next;
    card.querySelectorAll('[data-dock-tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.dockTab === next)));
    card.querySelector('[data-dock-note]').textContent = next === 'board' ? 'WHAT-IF · 교육용 모의 수치 · 실제 조업 값 아님' : '';
  }
  function render() {
    const row = rows.find((r) => r.id === picked) || rows[0];
    card.querySelector('[data-board-table]').innerHTML = rows.length
      ? `<table><caption>${esc(name)} 조업 전광판</caption><thead><tr><th>지표</th><th>계산값</th><th>기준값</th><th>등락</th><th>실험 변경 이력</th></tr></thead><tbody>${rows.map((r) => {
          const t = tone(r.direction), delta = t === 'flat' ? '—' : `${t === 'up' ? '▲ +' : '▼ −'}${displayNumber(Math.abs(r.delta), r.digits)}`;
          return `<tr class="${t}${r === row ? ' on' : ''}" data-row="${esc(r.id)}" tabindex="0" aria-selected="${r === row}"><td>${esc(r.label)}</td><td class="v">${displayNumber(r.value, r.digits)} <small>${esc(r.unit)}</small></td><td class="b">${displayNumber(r.base, r.digits)}</td><td class="d">${delta}</td><td>${spark(series.get(r.id) || [], t)}</td></tr>`;
        }).join('')}</tbody></table><p class="lab-board-legend">▲ 상승 빨강 · ▼ 하락 파랑 · 줄을 누르면 오른쪽이 그 지표로 바뀌어요(온도는 다이얼, 나머지는 실험 변경 이력)</p>`
      : '<p class="lab-dock-empty">오른쪽 What-if에서 조건을 바꾸면 계산 결과가 이 표에 나와요.</p>';
    card.querySelector('[data-board-chart]').innerHTML = row?.unit === '℃' ? dial(row) : chart(row, row ? series.get(row.id) || [] : []);
    card.querySelectorAll('[data-row]').forEach((tr) => {
      const pick = () => { picked = tr.dataset.row; render(); };
      tr.onclick = pick; tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    });
  }

  card.querySelectorAll('[data-dock-tab]').forEach((b) => { b.onclick = () => setTab(b.dataset.dockTab); });

  const sync = () => document.body.classList.toggle('lab-dock', wide.matches);
  wide.addEventListener('change', sync); sync(); setTab('board'); render();
  attachSplitter();

  return {
    /** 공정이 바뀌면 이력을 비운다. */
    setProcess(p) { name = p?.name || ''; pid = p?.id || ''; rows = []; picked = null; series.clear(); render(); },
    /** lab-display-data.js의 displayRows 결과(계산할 때마다). */
    update(next) {
      rows = next;
      for (const r of rows) { const v = series.get(r.id) || [r.base]; v.push(r.value); series.set(r.id, v.slice(-20)); }
      render();
    },
  };
}

/**
 * 3D 뷰와 아래 카드 사이의 위아래 크기 조절 손잡이(블렌더의 영역 경계처럼). 끌면 카드 높이(--dock-b)가 바뀌고 3D 뷰가 그만큼 늘거나 준다.
 * 정한 높이는 이 브라우저에 기억한다. 두 번 누르면 기본 높이, 키보드 ↑↓(Shift는 크게)로도 조절한다.
 */
function attachSplitter() {
  const KEY = 'st-rookie:dock-height', MIN = 180, TOP_ROOM = 240; // 카드 최소 높이, 3D 뷰에 남길 최소 높이
  const split = document.createElement('div');
  split.className = 'lab-dock-split'; split.tabIndex = 0;
  split.setAttribute('role', 'separator'); split.setAttribute('aria-orientation', 'horizontal'); split.setAttribute('aria-label', '3D 뷰와 아래 카드 크기 조절');
  split.title = '끌어서 크기 조절 · 두 번 누르면 기본 크기';
  document.body.appendChild(split);
  const clamp = (h) => Math.round(Math.min(innerHeight - TOP_ROOM, Math.max(MIN, h)));
  const current = () => document.querySelector('.lab-dock-card')?.getBoundingClientRect().height || 0;
  function apply(h, save = true) {
    if (h == null) document.body.style.removeProperty('--dock-b');
    else document.body.style.setProperty('--dock-b', `${clamp(h)}px`);
    split.setAttribute('aria-valuenow', String(Math.round(current())));
    if (save) try { h == null ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, String(clamp(h))); } catch {}
  }
  try { const saved = Number(localStorage.getItem(KEY)); if (saved) apply(saved, false); } catch {}

  let drag = null;
  split.addEventListener('pointerdown', (e) => {
    drag = { y: e.clientY, h: current() }; split.setPointerCapture(e.pointerId);
    document.body.classList.add('lab-dock-resizing'); e.preventDefault();
  });
  split.addEventListener('pointermove', (e) => { if (drag) apply(drag.h + (drag.y - e.clientY), false); });
  const done = () => dispatchEvent(new Event('lab-dock-resized')); // steel-index.js가 카메라를 새 3D 뷰 크기에 다시 맞춘다
  const end = () => { if (!drag) return; drag = null; document.body.classList.remove('lab-dock-resizing'); apply(current()); done(); };
  split.addEventListener('pointerup', end); split.addEventListener('pointercancel', end);
  split.addEventListener('dblclick', () => { apply(null); done(); });
  split.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 60 : 20;
    if (e.key === 'ArrowUp') { apply(current() + step); done(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { apply(current() - step); done(); e.preventDefault(); }
    else if (e.key === 'Home' || e.key === 'Enter') { apply(null); done(); e.preventDefault(); }
  });
  // 창 높이가 줄면 저장한 높이가 3D 뷰를 너무 덮지 않게 다시 맞춘다
  addEventListener('resize', () => { if (document.body.style.getPropertyValue('--dock-b')) apply(current(), false); });
}

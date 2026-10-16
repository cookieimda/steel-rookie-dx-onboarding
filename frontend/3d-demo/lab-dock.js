// 3D 공정 화면 대시보드 배치(레퍼런스: 왼쪽 위 3D 뷰 · 그 아래 카드 · 오른쪽 What-if 열).
// 아래 카드는 탭 3개: [조업 전광판] 표 + 실험 변경 이력 차트(3D 공중 전광판을 대신한다) / [단계 설명] 설비 설명 패널(#right) / [온도 흐름] 왼쪽 패널.
// 단계 설명과 온도 흐름은 기존 패널을 옮기지 않고, 이 카드 자리에 겹쳐 보이게 CSS(lab-console-glass.css, body.lab-dock)로 배치한다.
// 폭 1001px 이상에서만 이 배치를 쓰고, 그보다 좁으면 원래 화면 그대로다.
import { displayNumber } from './lab-display-data.js';

const TABS = [['board', '조업 전광판'], ['steps', '단계 설명'], ['temp', '온도 흐름']];
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
      <p class="lab-dock-empty" data-dock-pane="steps">아래 재생 바나 3D에서 설비를 고르면 단계 설명이 이 자리에 머물러 천천히 읽을 수 있어요.</p>
    </div>`;
  document.body.appendChild(card);
  const right = document.getElementById('right');
  let tab = 'board', rows = [], picked = null, name = '';
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
        }).join('')}</tbody></table><p class="lab-board-legend">▲ 상승 빨강 · ▼ 하락 파랑 · 줄을 누르면 오른쪽 차트가 그 지표로 바뀌어요</p>`
      : '<p class="lab-dock-empty">오른쪽 What-if에서 조건을 바꾸면 계산 결과가 이 표에 나와요.</p>';
    card.querySelector('[data-board-chart]').innerHTML = chart(row, row ? series.get(row.id) || [] : []);
    card.querySelectorAll('[data-row]').forEach((tr) => {
      const pick = () => { picked = tr.dataset.row; render(); };
      tr.onclick = pick; tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } };
    });
  }

  card.querySelectorAll('[data-dock-tab]').forEach((b) => { b.onclick = () => setTab(b.dataset.dockTab); });
  // 설비를 고르면(설명 패널이 열리면) 단계 설명 탭으로, 닫히면 고르기 전 탭으로 돌아간다
  let before = 'board';
  if (right) new MutationObserver(() => {
    const open = right.classList.contains('on');
    if (open && tab !== 'steps') { before = tab; setTab('steps'); } else if (!open && tab === 'steps') setTab(before);
  }).observe(right, { attributes: true, attributeFilter: ['class'] });

  const sync = () => document.body.classList.toggle('lab-dock', wide.matches);
  wide.addEventListener('change', sync); sync(); setTab('board'); render();

  return {
    /** 공정이 바뀌면 이력을 비운다. */
    setProcess(p) { name = p?.name || ''; rows = []; picked = null; series.clear(); render(); },
    /** lab-display-data.js의 displayRows 결과(계산할 때마다). */
    update(next) {
      rows = next;
      for (const r of rows) { const v = series.get(r.id) || [r.base]; v.push(r.value); series.set(r.id, v.slice(-20)); }
      render();
    },
  };
}

import { WI_SLIDERS } from '../login_ui/lab-extras.js';
import { parseTemp } from './steel-index-ui.js';
import { displayRows, displayNumber, tempPosition } from './lab-display-data.js';
import { createLabWorld } from './lab-world-display.js';
import { arcGaugeHtml } from './lab-gauge-arc.js';
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function attachLabConsole({ api, scene, camera, reduced, pickEquipment }) {
  document.body.classList.add('process-lab');
  const left = document.createElement('aside'), right = document.createElement('aside');
  left.className = 'lab-pane lab-temperature'; left.setAttribute('aria-label', '공정 온도 흐름');
  right.className = 'lab-pane lab-inputs'; right.setAttribute('aria-label', 'What-if 조건 조절');
  document.body.append(left, right);
  const world = createLabWorld(scene, reduced);
  let process, epoch = 0, timer, inputs = {}, reply, points = [], selected = 0;
  const status = text => { const el = right.querySelector('[data-lab-status]'); if (el) el.textContent = text; };
  function profile() {
    const data = points, max = Math.ceil(Math.max(500, ...data.map(p => p.high)) / 500) * 500;
    const positions = data.map((p, i) => `${48 + i / Math.max(1, data.length - 1) * 300},${178 - p.high / max * 140}`);
    return `<svg viewBox="0 0 380 218" class="lab-chart" role="img" aria-label="단계별 온도 범위의 상한. 아래 탐색 바에서 각 단계의 설명을 확인할 수 있습니다.">
      ${[0, .5, 1].map(k => `<path d="M48 ${178 - k * 140}H348"/><text x="40" y="${183 - k * 140}" text-anchor="end">${displayNumber(max * k)}</text>`).join('')}
      <polyline points="${positions.join(' ')}"/>
      ${data.map((p, i) => `<circle data-lab-point="${i}" cx="${positions[i].split(',')[0]}" cy="${positions[i].split(',')[1]}" r="${i === selected ? 6 : 3}"><title>${escape(p.eq)} · ${escape(p.zone)} · ${escape(p.temp)}</title></circle>`).join('')}
      <text x="48" y="211">공정 시작</text><text x="348" y="211" text-anchor="end">공정 끝 · ℃</text></svg>`;
  }
  function temperaturePanel() {
    left.innerHTML = `<header class="lab-pane-head"><span>THERMAL PROFILE</span><h2>온도 흐름</h2><b>${escape(process.name)}</b></header><div class="lab-pane-body">
      <div class="lab-step-value"><span data-lab-eq></span><strong data-lab-temp></strong><span data-lab-zone></span></div>
      ${profile()}<label class="lab-slider"><span>단계 탐색</span><output data-lab-count></output><input aria-label="온도 단계 탐색" data-lab-position type="range" min="0" max="${Math.max(0, points.length - 1)}" value="0" step="1" ${points.length ? '' : 'disabled'}></label>
      <button type="button" class="lab-button" data-lab-equipment ${points.length ? '' : 'disabled'}>선택 설비 자세히 보기 ↗</button>
      <section class="lab-temperature-result" data-lab-temperature-result></section>
      <label class="lab-slider"><span>애니메이션 속도</span><output data-lab-speed-text>1.0×</output><input aria-label="애니메이션 속도" data-lab-speed type="range" min="0.5" max="2" value="1" step="0.1"></label>
      <p class="lab-muted">그래프는 학습 자료의 단계별 예시 온도입니다. 실험 결과는 별도 계기와 공정 뒤 전광판에 표시됩니다.</p><p class="lab-muted" data-lab-progress></p></div>`;
    left.querySelector('[data-lab-position]').oninput = e => { selected = Number(e.target.value); describeStep(); world.focus(points[selected].id); };
    left.querySelector('[data-lab-equipment]').onclick = () => points[selected] && pickEquipment(points[selected].id);
    left.querySelector('[data-lab-speed]').oninput = e => { world.speed(Number(e.target.value)); left.querySelector('[data-lab-speed-text]').textContent = `${Number(e.target.value).toFixed(1)}×`; };
    describeStep();
  }
  function describeStep() {
    const p = points[selected];
    left.querySelector('[data-lab-eq]').textContent = p?.eq || '온도 자료 없음';
    left.querySelector('[data-lab-temp]').textContent = p?.temp || '—';
    left.querySelector('[data-lab-zone]').textContent = p?.zone || '';
    left.querySelector('[data-lab-count]').textContent = `${points.length ? selected + 1 : 0} / ${points.length}`;
    left.querySelectorAll('[data-lab-point]').forEach(dot => dot.setAttribute('r', Number(dot.dataset.labPoint) === selected ? '7' : '3'));
  }
  function inputPanel() {
    right.innerHTML = `<header class="lab-pane-head"><span>CONDITION EXPERIMENT</span><h2>What-if</h2><b>조건을 바꾸고 전광판 확인</b></header><div class="lab-pane-body">
      <div class="lab-gauge-slot" data-lab-gauge></div><div class="lab-fields" data-lab-fields></div>
      <p class="lab-status" data-lab-status role="status" aria-live="polite">${api.hasToken() ? '계산 모델을 불러오는 중…' : '로그인하면 조건을 바꾸고 전광판 결과를 확인할 수 있습니다.'}</p>
      ${api.hasToken() ? '<button type="button" class="lab-button" data-lab-reset>↺ 기준 조건으로 초기화</button>' : '<a class="lab-button" href="/login">로그인하기 →</a>'}
      <details><summary>계산 가정</summary><p class="lab-muted" data-lab-assumptions>교육용 간이 모델 · 실제 운전 지침이 아닙니다.</p></details>
      <div class="lab-sr" data-lab-quotes aria-label="공정 뒤 전광판의 계산 결과"></div></div>`;
    right.querySelector('[data-lab-reset]')?.addEventListener('click', () => { inputs = {}; clearTimeout(timer); calculate(true); });
  }
  function renderFields() {
    const fields = process.id === 'ironmaking'
      ? WI_SLIDERS.map(([key, label, unit, min, max, step]) => ({ key, label, unit, min, max, step, value: reply.input[key] }))
      : reply.nodes.filter(n => n.process === process.id && n.control).map(n => ({ key: n.id, label: n.label, unit: n.unit, ...n.control, value: n.value }));
    right.querySelector('[data-lab-fields]').innerHTML = fields.map(f => `<label class="lab-slider"><span>${escape(f.label)}</span><output data-lab-output="${f.key}">${displayNumber(f.value, f.step < 1 ? 1 : 0)} ${escape(f.unit)}</output><input data-lab-input="${f.key}" aria-label="${escape(f.label)} (${escape(f.unit)})" type="range" min="${f.min}" max="${f.max}" step="${f.step}" value="${f.value}"></label>`).join('');
    right.querySelectorAll('[data-lab-input]').forEach(el => el.oninput = () => {
      const f = fields.find(f => f.key === el.dataset.labInput);
      inputs[f.key] = Number(el.value); right.querySelector(`[data-lab-output="${f.key}"]`).textContent = `${displayNumber(Number(el.value), f.step < 1 ? 1 : 0)} ${f.unit}`;
      epoch++; clearTimeout(timer); status('조건 변경을 계산하는 중…'); timer = setTimeout(() => calculate(false), 180);
    });
  }
  function results(rows) {
    const temperatures = rows.filter(r => r.unit === '℃'), thermometer = temperatures[0];
    const thermometers = temperatures.map(r => `<div><span>실험 · ${escape(r.label)}</span><b>${displayNumber(r.value, r.digits)}℃</b><small>${r.direction === 'flat' ? '기준과 같음' : `${r.direction === 'up' ? '▲ +' : '▼ −'}${displayNumber(Math.abs(r.delta), r.digits)}℃`}</small></div>`).join('');
    left.querySelector('[data-lab-temperature-result]').innerHTML = thermometers;
    if (thermometer) {
      const low = process.id === 'ironmaking' ? 1380 : Math.floor((thermometer.base - 150) / 50) * 50, high = process.id === 'ironmaking' ? 1560 : low + 300;
      right.querySelector('[data-lab-gauge]').innerHTML = arcGaugeHtml({ title: thermometer.label, value: displayNumber(thermometer.value, thermometer.digits), pos: tempPosition(thermometer.value, low, high), low, high, direction: thermometer.direction, delta: displayNumber(Math.abs(thermometer.delta), thermometer.digits) }); // 원호 다이얼(lab-gauge-arc.js)
    } else right.querySelector('[data-lab-gauge]').innerHTML = '<p class="lab-muted">이 공정은 온도 대신 속도·품질 지표의 영향을 계산합니다.</p>';
    right.querySelector('[data-lab-quotes]').textContent = rows.map(r => `${r.label}: ${displayNumber(r.value, r.digits)} ${r.unit}, 기준 대비 ${displayNumber(r.delta, r.digits)}`).join('. ');
    right.querySelector('[data-lab-assumptions]').textContent = process.id === 'ironmaking' ? reply.assumptions.join(' ') : reply.note;
    if (process.id === 'ironmaking') {
      status(reply.result.warnings.join(' · ') || `원료 비율을 100%로 환산했습니다: 소결광 ${reply.input.sinter_pct.toFixed(1)}% · 펠릿 ${reply.input.pellet_pct.toFixed(1)}% · 괴광 ${reply.input.lump_pct.toFixed(1)}%.`);
      for (const [key, , unit, , , step] of WI_SLIDERS) {
        const el = right.querySelector(`[data-lab-input="${key}"]`); if (el) { el.value = reply.input[key]; right.querySelector(`[data-lab-output="${key}"]`).textContent = `${displayNumber(reply.input[key], step < 1 ? 1 : 0)} ${unit}`; }
      }
    } else status('오른쪽의 조건 변경이 공정 뒤 전광판과 가운데 공정에 반영됩니다.');
    document.body.dataset.labValues = JSON.stringify(Object.fromEntries(rows.map(r => [r.id, r.value])));
  }
  async function calculate(rebuild) {
    const ticket = ++epoch, section = process.id;
    try {
      const value = await api.request('POST', section === 'ironmaking' ? '/api/lab/whatif' : '/api/lab/causal', { ...inputs });
      if (ticket !== epoch || section !== process.id) return;
      const rows = displayRows(value, section); reply = value;
      if (section === 'ironmaking') inputs = { ...value.input };
      if (rebuild) renderFields();
      results(rows); world.update(rows, reply, section);
    } catch (error) { if (ticket === epoch) status(error.message || '계산하지 못했습니다. 초기화 후 다시 시도해 주세요.'); }
  }
  function setProcess(p) {
    epoch++; clearTimeout(timer); process = p.data; inputs = {}; reply = null; selected = 0; world.speed(1);
    points = process.equipment.flatMap(eq => (eq.steps || []).flatMap(step => { const range = parseTemp(step.temp); return range ? [{ id: eq.id, eq: eq.name, zone: step.zone, temp: step.temp, high: range[1] }] : []; }));
    world.setProcess(p); temperaturePanel(); inputPanel();
    if (api.hasToken()) calculate(true);
  }
  const setProgress = text => { const el = left.querySelector('[data-lab-progress]'); if (el) el.textContent = text; };
  return { setProcess, setProgress, bounds: world.bounds, tick: now => world.tick(now, camera), clear: () => { epoch++; clearTimeout(timer); world.clear(); } };
}

// What-if 온도 계기: 가로 스펙트럼 막대 대신 원호 다이얼(레퍼런스의 Climate 계기). 눈금 · 값까지 채운 호 · 끝 손잡이 · 가운데 큰 숫자 · 기준 대비 상태.
// 값의 위치(pos, 0~100)는 lab-display-data.js의 tempPosition이 정한다. 호의 색은 낮을수록 파랑, 높을수록 빨강(기존 스펙트럼과 같은 뜻).
const CX = 120, CY = 112, R = 86, START = 150, SWEEP = 240;
const at = (r, deg) => { const a = deg * Math.PI / 180; return [CX + r * Math.cos(a), CY + r * Math.sin(a)]; };
const arc = (r, a0, a1) => { const [x0, y0] = at(r, a0), [x1, y1] = at(r, a1); return `M${x0.toFixed(1)} ${y0.toFixed(1)}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1.toFixed(1)} ${y1.toFixed(1)}`; };
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

/**
 * @param {{ title: string, value: string, pos: number, low: number, high: number, direction?: 'up'|'down'|'flat', delta?: string }} g
 * value·delta는 화면에 쓸 글자(displayNumber 결과)로 받는다.
 */
export function arcGaugeHtml(g) {
  const p = Math.min(100, Math.max(0, Number(g.pos) || 0)) / 100, end = START + SWEEP * p;
  const ticks = Array.from({ length: 25 }, (_, i) => {
    const d = START + SWEEP * i / 24, [x0, y0] = at(R - 16, d), [x1, y1] = at(R - (i % 6 === 0 ? 24 : 21), d);
    return `<line x1="${x0.toFixed(1)}" y1="${y0.toFixed(1)}" x2="${x1.toFixed(1)}" y2="${y1.toFixed(1)}"/>`;
  }).join('');
  const [hx, hy] = at(R, end);
  const tone = g.direction === 'up' ? 'up' : g.direction === 'down' ? 'down' : 'flat';
  const status = tone === 'flat' ? '기준과 같음' : `${tone === 'up' ? '▲ +' : '▼ −'}${esc(g.delta)}℃ · 기준보다 ${tone === 'up' ? '높음' : '낮음'}`;
  return `<div class="lab-gauge lab-arc-gauge"><span>온도 시뮬레이션 · ${esc(g.title)}</span>
    <div class="lab-arc" role="img" aria-label="${esc(g.title)} ${esc(g.value)}도, ${g.low}~${g.high}도 범위 중 ${Math.round(p * 100)}% 위치">
      <svg viewBox="0 0 240 190" aria-hidden="true">
        <defs><linearGradient id="labArcHeat" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#578bd8"/><stop offset=".3" stop-color="#49b3c6"/><stop offset=".5" stop-color="#8bc767"/><stop offset=".68" stop-color="#dfc653"/><stop offset=".84" stop-color="#f39645"/><stop offset="1" stop-color="#ec6065"/></linearGradient></defs>
        <path class="lab-arc-track" d="${arc(R, START, START + SWEEP)}"/>
        ${p > 0.002 ? `<path class="lab-arc-fill" d="${arc(R, START, end)}"/>` : ''}
        <g class="lab-arc-ticks">${ticks}</g>
        <circle class="lab-arc-knob" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="7"/>
      </svg>
      <div class="lab-arc-val"><strong>${esc(g.value)}<small>℃</small></strong><em class="${tone}">${status}</em></div>
    </div>
    <div class="lab-scale"><span>${g.low}℃</span><span>${g.high}℃</span></div>
    <p>온도의 위치이며 안전 판정은 아닙니다.</p></div>`;
}

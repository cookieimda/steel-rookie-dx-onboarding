// 공정 무대(steel-index.js가 쓴다). 공정을 고르면 바닥판이 앞으로 쭉 뻗고 뒷벽이 위로 솟아 ㄴ자 무대가 된다.
// 벽 왼쪽 위에는 공정 이름(굵은 평면 글자, 글자마다 아래에서 위로 올라온다), 오른쪽에는 대시보드 4장이 차례로 켜진다.
//   - 공정 온도 흐름: 설비 단계별 대표 온도(data_v2.js의 steps[].temp)를 이은 주황 선 그래프. 고른 설비 구간을 밝게 표시
//   - 가장 뜨거운 구간: 공정(또는 고른 설비)에서 온도가 가장 높은 단계
//   - 소재 흐름: 들어오는 원료 → 나오는 소재(io), 설비·단계 수
//   - 학습 현황: 지금 보는 것 · 본 설비 수 · 이해도 확인 상태(서버 응답, 로그인 때만) · 다시 볼 설비 수
// 값은 data_v2.js와 서버 응답에서만 가져온다(꾸민 실시간 값 없음). 온도는 교육용 예시값이라 그래프에 그렇게 적는다.
// 바닥판 윗면 = y 0(설비가 여기서 솟는다). 바닥판 두께만큼 아래(-STAGE_H)까지 그리므로 steel-index.js의 전역 클리핑 평면도 그 높이에 맞춘다.
// 카메라가 벽 뒤로 돌아가면 벽과 대시보드를 옅게 해 공정을 가리지 않는다.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { parseTemp } from './steel-index-ui.js';

export const STAGE_H = 1.6;
const T = { floor: 650, wallAt: 220, wall: 820, titleAt: 700, title: 1000, panelAt: 1050, panelGap: 170, panel: 700, sink: 420 };
const ease = (k) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);
const FONT = '"Noto Sans KR", "Pretendard", sans-serif', MONO = '"IBM Plex Mono", "JetBrains Mono", monospace';
const fmt = (n) => Math.round(n).toLocaleString('ko-KR');
// 너비 maxW 안에 들어가게 글자 크기를 줄인다(최대 size)
const fitFont = (x, text, weight, size, maxW, family = FONT) => { let s = size; x.font = `${weight} ${s}px ${family}`; while (s > 18 && x.measureText(text).width > maxW) { s -= 2; x.font = `${weight} ${s}px ${family}`; } return s; };

export function createStage({ scene, slateMap, reduced = false }) {
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2c3036, roughness: 0.8, metalness: 0.15, roughnessMap: slateMap, bumpMap: slateMap, bumpScale: 0.08 });
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1c2025, roughness: 0.88, metalness: 0.08, transparent: true });
  const lineMat = new THREE.LineBasicMaterial({ color: 0x4a5058, transparent: true });
  const floorPivot = new THREE.Group(), wallPivot = new THREE.Group(), board = new THREE.Group();
  const box = new THREE.BoxGeometry(1, 1, 1), boxEdges = new THREE.EdgesGeometry(box);
  const floor = new THREE.Mesh(box, floorMat); floor.receiveShadow = true; floorPivot.add(floor); floor.add(new THREE.LineSegments(boxEdges, lineMat));
  const wall = new THREE.Mesh(box, wallMat); wall.receiveShadow = true; wallPivot.add(wall); wall.add(new THREE.LineSegments(boxEdges, lineMat));
  [floor, wall].forEach((m) => { m.raycast = () => {}; });
  scene.add(floorPivot, wallPivot, board); floorPivot.visible = wallPivot.visible = board.visible = false;

  // 캔버스 한 장 = 판 하나(벽에 붙은 평면). draw(x, k)로 다시 그린다
  function plate(cw, ch, w, h) {
    const c = document.createElement('canvas'); c.width = cw; c.height = ch; const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0, depthWrite: false }));
    mesh.renderOrder = 3; mesh.raycast = () => {}; board.add(mesh); return { c, x: c.getContext('2d'), tex, mesh, w, h };
  }
  const glass = (x, W, H) => { x.clearRect(0, 0, W, H); x.fillStyle = 'rgba(14,18,23,.86)'; x.strokeStyle = 'rgba(255,255,255,.16)'; x.lineWidth = 3; x.beginPath(); x.roundRect(3, 3, W - 6, H - 6, 26); x.fill(); x.stroke(); };
  const head = (x, t, sub) => { x.fillStyle = '#9aa6b2'; x.font = `500 30px ${MONO}`; x.fillText(t, 40, 64); if (sub) { x.fillStyle = '#6f7b88'; x.font = `400 24px ${FONT}`; x.fillText(sub, 40, 102); } };

  let st = null, dark = true; // 지금 무대(공정 하나)
  function build(p) {
    const { w, d, cx, cz } = p.foot, size = p.bounds.getSize(new THREE.Vector3());
    const W = w + 12, D = d + 14, z0 = cz - d / 2 - 6, Hw = Math.max(18, size.y + 9), H = STAGE_H;
    floor.scale.set(W, H, D); floor.position.set(0, -H / 2, D / 2); floorPivot.position.set(cx, 0, z0);
    wall.scale.set(W, Hw + H, 0.8); wall.position.set(0, (Hw + H) / 2, -0.4); wallPivot.position.set(cx, -H, z0);
    board.position.set(cx, 0, z0 + 0.06);
    board.children.slice().forEach((m) => { board.remove(m); m.geometry.dispose(); m.material.map.dispose(); m.material.dispose(); });
    // 배치(벽 기준 좌표): 왼쪽 위 글자, 오른쪽 위 큰 그래프, 그 아래 작은 판 3장
    const tw = Math.min(22, Math.max(13, W * 0.3)), L = -W / 2 + 2.2, R = W / 2 - 2.2, gx = L + tw + 1.6, rw = R - gx, top = Hw - 1.8;
    const title = plate(1024, 512, tw, tw / 2); title.mesh.position.set(L + tw / 2, top - tw / 4, 0.02);
    const gh = Math.min(rw * 0.36, Hw * 0.42), graph = plate(1600, Math.round(1600 * gh / rw), rw, gh); graph.mesh.position.set(gx + rw / 2, top - gh / 2, 0.02);
    // 작은 판은 캔버스 해상도를 낮춰(600) 같은 글자 크기가 더 크게 보이게 한다
    const sw = (rw - 2 * 1.2) / 3, sh = Math.min(sw * 0.62, Hw * 0.3), sy = top - gh - 1.2 - sh / 2;
    const small = [0, 1, 2].map((i) => { const pl = plate(600, Math.round(600 * sh / sw), sw, sh); pl.mesh.position.set(gx + sw / 2 + i * (sw + 1.2), sy, 0.02); return pl; });
    // 데이터: 설비 단계별 온도(상한), 설비 구간
    const pts = [], bands = [];
    p.eqs.forEach((e) => { const i0 = pts.length; (e.data.steps || []).forEach((s) => { const r = parseTemp(s.temp); if (r) pts.push({ v: r[1], zone: s.zone, temp: s.temp, eq: e }); }); if (pts.length > i0) bands.push({ eq: e, i0, i1: pts.length - 1 }); });
    st = { p, W, D, Hw, z0, title, graph, small, pts, bands, t0: 0, sink: null, k: { floor: 0, wall: 0, title: 0, graph: 0 }, learn: null, eq: null, fade: 1 };
    floorPivot.scale.set(1, 1, 0.0001); wallPivot.scale.set(1, 0.0001, 1); floorPivot.visible = wallPivot.visible = board.visible = true;
    drawAll(true);
  }

  // ---- 그리기 ----
  function drawTitle(k) {
    const { x, c, tex } = st.title, D = st.p.data, chars = [...D.name], ink = dark ? '#ffffff' : '#141820', ink2 = dark ? '#c9d1d6' : '#3a4048';
    x.clearRect(0, 0, c.width, c.height); x.textBaseline = 'top';
    const size = Math.min(250, Math.floor(980 / Math.max(2, chars.length))); x.font = `900 ${size}px ${FONT}`; let px = 6; const lh = size * 1.1;
    chars.forEach((ch, i) => { const ki = Math.min(1, Math.max(0, k * (1 + 0.18 * chars.length) - 0.18 * i)), e = 1 - Math.pow(1 - ki, 4), wch = x.measureText(ch).width;
      x.save(); x.beginPath(); x.rect(px - 4, 0, wch + 8, lh + 6); x.clip(); x.fillStyle = ink; x.fillText(ch, px, 4 + (1 - e) * lh); x.restore(); px += wch * 0.97; });
    const a = Math.min(1, Math.max(0, (k - 0.4) / 0.5)); x.globalAlpha = a;
    const sub = `ST-ROOKIE · ${D.en} Process`, io = `${D.num} / 04   ${D.io || ''}`;
    x.fillStyle = ink2; fitFont(x, sub, 700, 58, c.width - 24); x.fillText(sub, 10, lh + 22);
    x.fillStyle = '#ff7a1a'; fitFont(x, io, 500, 34, c.width - 24, MONO); x.fillText(io, 12, lh + 104);
    x.globalAlpha = 1; tex.needsUpdate = true;
  }
  function drawGraph(k) { // 공정 온도 흐름(선이 왼쪽부터 그어진다)
    const { x, c, tex } = st.graph, Wc = c.width, Hc = c.height, P = st.pts; glass(x, Wc, Hc);
    head(x, 'TEMPERATURE FLOW · 공정 온도 흐름', '단계별 대표 온도 · 교육용 예시값');
    if (P.length < 2) { x.fillStyle = '#9aa6b2'; x.font = `400 30px ${FONT}`; x.fillText('온도 자료가 없어요', 40, Hc / 2); tex.needsUpdate = true; return; }
    const l = 120, r = Wc - 48, t = 140, b = Hc - 92, max = 2000, X = (i) => l + (r - l) * i / (P.length - 1), Y = (v) => b - (b - t) * Math.min(1, v / max);
    x.strokeStyle = 'rgba(255,255,255,.08)'; x.lineWidth = 2; x.fillStyle = '#6f7b88'; x.font = `400 24px ${MONO}`;
    [0, 500, 1000, 1500, 2000].forEach((v) => { x.beginPath(); x.moveTo(l, Y(v)); x.lineTo(r, Y(v)); x.stroke(); x.fillText(`${fmt(v)}`, 40, Y(v) - 12); });
    st.bands.forEach((bd, j) => { const x0 = X(bd.i0) - (bd.i0 ? (X(1) - X(0)) / 2 : 0), x1 = X(bd.i1) + (bd.i1 < P.length - 1 ? (X(1) - X(0)) / 2 : 0), on = st.eq === bd.eq;
      if (on) { x.fillStyle = 'rgba(255,122,26,.12)'; x.fillRect(x0, t - 10, x1 - x0, b - t + 10); }
      if (j) { x.strokeStyle = 'rgba(255,255,255,.1)'; x.setLineDash([6, 8]); x.beginPath(); x.moveTo(x0, t - 10); x.lineTo(x0, b); x.stroke(); x.setLineDash([]); }
      x.fillStyle = on ? '#ffd2a8' : '#8f9aa6'; x.font = `${on ? 700 : 500} 26px ${FONT}`; const nm = bd.eq.data.name, tw = x.measureText(nm).width; x.fillText(nm, Math.max(x0 + 6, (x0 + x1) / 2 - tw / 2), b + 22); });
    const n = Math.max(1, Math.floor(k * (P.length - 1) + 1e-6)), frac = k * (P.length - 1) - (n - 1), last = Math.min(P.length - 1, n);
    const pts = P.slice(0, n).map((q, i) => [X(i), Y(q.v)]); if (k < 1 && last < P.length) { const a = P[n - 1], bq = P[last]; pts.push([X(n - 1) + (X(last) - X(n - 1)) * Math.min(1, frac), Y(a.v + (bq.v - a.v) * Math.min(1, frac))]); }
    const g = x.createLinearGradient(0, t, 0, b); g.addColorStop(0, 'rgba(255,122,26,.42)'); g.addColorStop(1, 'rgba(255,122,26,0)');
    x.beginPath(); x.moveTo(pts[0][0], b); pts.forEach(([a, v]) => x.lineTo(a, v)); x.lineTo(pts[pts.length - 1][0], b); x.closePath(); x.fillStyle = g; x.fill();
    x.save(); x.shadowColor = 'rgba(255,140,40,.9)'; x.shadowBlur = 18; x.strokeStyle = '#ff8a2a'; x.lineWidth = 6; x.lineJoin = 'round'; x.beginPath(); pts.forEach(([a, v], i) => (i ? x.lineTo(a, v) : x.moveTo(a, v))); x.stroke(); x.restore();
    if (k >= 1) { const hi = P.reduce((m, q, i) => (q.v > P[m].v ? i : m), 0), hx = X(hi), hy = Y(P[hi].v);
      x.strokeStyle = 'rgba(255,210,168,.6)'; x.setLineDash([5, 6]); x.lineWidth = 2; x.beginPath(); x.moveTo(hx, hy); x.lineTo(hx, b); x.stroke(); x.setLineDash([]);
      x.save(); x.shadowColor = '#ff8a2a'; x.shadowBlur = 20; x.fillStyle = '#ffb066'; x.beginPath(); x.arc(hx, hy, 11, 0, Math.PI * 2); x.fill(); x.restore(); }
    tex.needsUpdate = true;
  }
  function hottest(list) { return list.reduce((m, q) => (!m || q.v > m.v ? q : m), null); }
  function drawHot() {
    const { x, c, tex } = st.small[0], Wc = c.width, Hc = c.height; glass(x, Wc, Hc);
    const list = st.eq ? st.pts.filter((q) => q.eq === st.eq) : st.pts, h0 = hottest(list), h = h0 && { ...h0, temp: h0.temp.replace(/^[→~\s]+/, '') }; // 데이터의 '→ 약 200℃' 같은 앞 화살표는 뺀다
    head(x, st.eq ? 'HOTTEST · 이 설비' : 'HOTTEST · 공정');
    if (!h) { x.fillStyle = '#9aa6b2'; x.font = `400 30px ${FONT}`; x.fillText('온도 자료가 없어요', 40, 170); tex.needsUpdate = true; return; }
    x.save(); x.shadowColor = 'rgba(255,140,40,.8)'; x.shadowBlur = 16; x.fillStyle = '#ffb066'; fitFont(x, h.temp, 800, 72, Wc - 80); x.fillText(h.temp, 40, Hc * 0.52); x.restore();
    x.fillStyle = '#e6ebf1'; fitFont(x, h.zone, 700, 34, Wc - 80); x.fillText(h.zone, 40, Hc * 0.52 + 54); x.fillStyle = '#8f9aa6'; x.font = `400 28px ${FONT}`; x.fillText(`${h.eq.data.name} · 교육용 예시값`, 40, Hc * 0.52 + 100);
    tex.needsUpdate = true;
  }
  function drawFlow() {
    const { x, c, tex } = st.small[1], Wc = c.width, Hc = c.height, D = st.p.data; glass(x, Wc, Hc);
    head(x, 'MATERIAL FLOW · 소재 흐름');
    const [a, b] = (D.io || '').split('→').map((s) => s.trim());
    x.fillStyle = '#c3ccd7'; fitFont(x, a || '-', 500, 32, Wc - 80); x.fillText(a || '-', 40, Hc * 0.4);
    x.fillStyle = '#ff9a2e'; x.font = `700 38px ${MONO}`; x.fillText('→', 40, Hc * 0.4 + 52);
    x.fillStyle = '#ffffff'; fitFont(x, b || '-', 800, 56, Wc - 136); x.fillText(b || '-', 96, Hc * 0.4 + 60);
    const steps = st.p.eqs.reduce((s, e) => s + (e.data.steps || []).length, 0);
    x.fillStyle = '#8f9aa6'; x.font = `400 28px ${MONO}`; x.fillText(`설비 ${st.p.eqs.length} · 단계 ${steps}`, 40, Hc - 44);
    tex.needsUpdate = true;
  }
  function drawLearn() {
    const { x, c, tex } = st.small[2], Wc = c.width, Hc = c.height, L = st.learn || {}; glass(x, Wc, Hc);
    head(x, 'LEARNING · 학습 현황');
    x.fillStyle = '#8f9aa6'; x.font = `400 26px ${FONT}`; x.fillText('지금 보는 것', 40, 150); x.fillText('본 설비', Wc * 0.58, 150);
    x.fillStyle = '#ffffff'; x.font = `700 36px ${FONT}`; const now = L.now || '공정 전체'; fitFont(x, now, 700, 36, Wc * 0.58 - 60); x.fillText(now, 40, 198);
    x.font = `800 52px ${MONO}`; x.fillText(`${L.seen ?? 0}`, Wc * 0.58, 202); const sw = x.measureText(`${L.seen ?? 0}`).width; x.fillStyle = '#8f9aa6'; x.font = `400 32px ${MONO}`; x.fillText(` / ${L.total ?? st.p.eqs.length}`, Wc * 0.58 + sw, 202);
    const tone = { ok: '#5fd39a', warn: '#f5b13d' }[L.cpTone] || '#c3ccd7';
    x.fillStyle = '#8f9aa6'; x.font = `400 26px ${FONT}`; x.fillText('이해도 확인', 40, Hc - 96);
    x.fillStyle = tone; fitFont(x, L.cp || '불러오는 중…', 700, 30, L.review ? Wc * 0.55 : Wc - 80); x.fillText(L.cp || '불러오는 중…', 40, Hc - 54);
    if (L.review) { x.fillStyle = '#f5b13d'; x.font = `700 28px ${FONT}`; const t = `다시 볼 설비 ${L.review}`; x.fillText(t, Wc - 40 - x.measureText(t).width, Hc - 54); }
    tex.needsUpdate = true;
  }
  function drawAll(initial) { drawTitle(initial ? 0 : st.k.title); drawGraph(initial ? 0 : st.k.graph); drawHot(); drawFlow(); drawLearn(); }

  function play(now) { if (!st) return; st.t0 = now; st.sink = null; if (reduced) { st.t0 = now - 1e5; } }
  function sink(now) { if (st) st.sink = { t0: now, from: { floor: floorPivot.scale.z, wall: wallPivot.scale.y } }; }
  function setTheme(isDark) {
    dark = isDark; floorMat.color.setHex(dark ? 0x2c3036 : 0x9aa0a8); wallMat.color.setHex(dark ? 0x1c2025 : 0xc4c9d0); lineMat.color.setHex(dark ? 0x4a5058 : 0xd6dade);
    if (st) drawTitle(st.k.title);
  }
  function setEquipment(e) { if (!st || st.eq === e) return; st.eq = e; drawGraph(st.k.graph); drawHot(); }
  function setLearning(info) { if (!st) return; st.learn = info; drawLearn(); }

  const _cam = new THREE.Vector3();
  function tick(now, camera) {
    if (!st) return;
    if (st.sink) { // 거꾸로: 대시보드·글자가 먼저 사라지고 벽이 내려가고 바닥이 접힌다
      const s = now - st.sink.t0, kp = ease(s / (T.sink * 0.35)), kw = ease((s - T.sink * 0.25) / T.sink), kf = ease((s - T.sink * 0.55) / T.sink);
      board.children.forEach((m) => { m.material.opacity = Math.min(m.material.opacity, 1 - kp); }); // 글자·대시보드가 먼저 꺼진다
      wallPivot.scale.y = Math.max(0.0001, st.sink.from.wall * (1 - kw)); floorPivot.scale.z = Math.max(0.0001, st.sink.from.floor * (1 - kf));
      if (now - st.sink.t0 > T.sink * 1.6) { floorPivot.visible = wallPivot.visible = board.visible = false; st = null; }
      return;
    }
    const t = now - st.t0, K = st.k;
    K.floor = ease(t / T.floor); K.wall = ease((t - T.wallAt) / T.wall);
    floorPivot.scale.z = Math.max(0.0001, K.floor); wallPivot.scale.y = Math.max(0.0001, K.wall);
    const kt = Math.min(1, Math.max(0, (t - T.titleAt) / T.title)); if (kt !== K.title) { K.title = kt; drawTitle(kt); }
    camera.getWorldPosition(_cam); const behind = _cam.z < st.z0 - 0.5; st.fade += ((behind ? 0.12 : 1) - st.fade) * 0.12; // 벽 뒤에서 보면 옅게
    wallMat.opacity = st.fade; lineMat.opacity = st.fade; wallMat.depthWrite = st.fade > 0.9;
    const kg = Math.min(1, Math.max(0, (t - T.panelAt) / (T.panel * 2.2))); // 그래프 선은 판이 켜진 뒤 왼쪽부터 그어진다
    if (kg > 0 && K.graph !== kg) { K.graph = kg; drawGraph(kg); }
    [st.title, st.graph, ...st.small].forEach((pl, i) => {
      const k = i === 0 ? Math.min(1, kt * 3) : ease((t - T.panelAt - (i - 1) * T.panelGap) / T.panel);
      pl.mesh.material.opacity = k * st.fade;
      if (i > 0) pl.mesh.position.z = 0.02 + (1 - k) * 0.6; // 벽에서 살짝 앞에서 붙는다
    });
  }
  // 카메라가 무대 전체(바닥판 + 벽)를 담는 데 쓰는 상자
  function bounds() { if (!st) return null; const { cx } = st.p.foot; return new THREE.Box3(new THREE.Vector3(cx - st.W / 2, 0, st.z0), new THREE.Vector3(cx + st.W / 2, st.Hw, st.z0 + st.D)); }
  return { build, play, sink, tick, setTheme, setEquipment, setLearning, bounds };
}

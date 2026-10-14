// 공정 인덱스 페이지(steel-index.js)의 단면 연출. v4(scene_v3.js _showInterior)의 층 배치를 옮겨 왔고, 단계 시각화는 step-fx.js(StepFx)를 그대로 쓴다.
// - show(p, e): 공정 모델 전체를 반투명(엑스레이)으로 만들고, 설비 안에 data_v2.js의 interior 층을 그린다. 층 좌표는 anchors-v2b.json의 interiors.<설비 id>(없으면 설비 노드의 경계 상자).
//   층 재질(피드백 반영): 고로는 광석층(짙은 갈색)·코크스층(검정)이 번갈아 쌓인 띠 텍스처, 열풍로는 내화벽돌 격자(체커) 텍스처, 소결 베드는 덩어리 텍스처가 왼쪽 → 오른쪽으로 흐르고(UV 스크롤) 아래에 윈드박스(흡입 덕트) 실루엣을 둔다.
// - layer(idx): 그 층만 밝히고(나머지 흐리게) step-fx의 단계 시각화를 튼다. step-fx가 3D 위에 붙이는 글자 말풍선은 작은 맥동 핫스팟 핀으로 바꾸고, 글은 { hotspots }로 돌려줘 오른쪽 패널에서 펼친다(점진적 공개).
//   입자는 공중에 흩날리는 종류(가스·수증기·분진 등)를 15%로 줄이고, 쇳물·불꽃·화염(풍구·출선구) 종류만 50%로 둔다.
// - hide(): 층·시각화를 지우고 재질을 되돌린다. tick(now): 시각화 애니메이션 + 베드 스크롤.
// StepFx가 기대하는 호스트(scene·renderer·labels·camera·layerItems·interior·dark·clientWidth/Height)는 여기서 작은 객체로 흉내 낸다.

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { StepFx, STEP_FX } from './step-fx.js';

// step-fx.js KIND 표의 기본 입자 수(이름: 개수). 피드백대로 공중 입자를 줄일 때 기준으로 쓴다
const KIND_N = { gas: 60, steam: 45, co: 70, air: 70, heat: 70, flame: 80, metal: 60, spark: 80, water: 80, bubble: 50, powder: 60, dust: 50, coal: 50, scrap: 30, flake: 50, imp: 40 };
const HOT_KIND = /^(heat|flame|metal|spark)$/;
let trimmed = false;
function trimParticles() {
  if (trimmed) return; trimmed = true;
  for (const steps of Object.values(STEP_FX)) for (const spec of steps) for (const o of spec) {
    if (o.t !== 'stream' || !o.kind) continue;
    const base = o.n || KIND_N[o.kind] || 50, k = HOT_KIND.test(o.kind) ? 0.5 : 0.15;
    o.n = Math.max(6, Math.round(base * k));
  }
}

// ---- 층 텍스처 ---------------------------------------------------------------------------------------------
const texCache = {};
function canvasTex(key, draw, w = 256, h = 256, repeat = [1, 1]) {
  if (texCache[key]) return texCache[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); t.colorSpace = THREE.SRGBColorSpace; return (texCache[key] = t);
}
/** 고로: 광석층·코크스층이 번갈아 쌓인 띠. 층 색(tint)을 띠 사이에 섞는다 */
function burdenTex(tint) {
  return canvasTex('burden:' + tint, (x, w, h) => {
    const bands = 10, bh = h / bands;
    for (let i = 0; i < bands; i++) { x.fillStyle = i % 2 ? '#1a1b1e' : '#5a3b28'; x.fillRect(0, i * bh, w, bh);
      for (let j = 0; j < 46; j++) { const px = Math.random() * w, py = i * bh + Math.random() * bh, r = 2 + Math.random() * 4; x.fillStyle = i % 2 ? (Math.random() < 0.5 ? '#2b2d31' : '#0f1012') : (Math.random() < 0.5 ? '#6e4a30' : '#3f2a1c'); x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); } }
    x.fillStyle = tint; x.globalAlpha = 0.28; x.fillRect(0, 0, w, h); x.globalAlpha = 1;
  }, 256, 256, [2, 1.4]);
}
/** 열풍로: 내화벽돌 격자(체커). 가로·세로 줄눈 */
function checkerTex(tint) {
  return canvasTex('checker:' + tint, (x, w, h) => {
    x.fillStyle = tint; x.fillRect(0, 0, w, h); x.fillStyle = 'rgba(0,0,0,.42)';
    const cell = 20; for (let i = 0; i <= w; i += cell) x.fillRect(i, 0, 2.5, h); for (let j = 0; j <= h; j += cell) x.fillRect(0, j, w, 2.5);
    x.fillStyle = 'rgba(255,255,255,.08)'; for (let i = 0; i < w; i += cell) for (let j = 0; j < h; j += cell) if ((i / cell + j / cell) % 2 === 0) x.fillRect(i + 3, j + 3, cell - 6, cell - 6);
  }, 256, 256, [3, 2]);
}
/** 소결 베드: 원료 덩어리. 스크롤용 */
function bedTex(tint) {
  return canvasTex('bed:' + tint, (x, w, h) => {
    x.fillStyle = tint; x.fillRect(0, 0, w, h);
    for (let j = 0; j < 260; j++) { const px = Math.random() * w, py = Math.random() * h, r = 2 + Math.random() * 5; x.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,.35)' : 'rgba(255,255,255,.14)'; x.beginPath(); x.arc(px, py, r, 0, Math.PI * 2); x.fill(); }
  }, 256, 128, [2, 1]);
}

export function createSection({ scene, renderer, hud, getCamera, getAnchors, isDark = () => true, onHotspot = null }) {
  trimParticles();
  const host = {
    scene, renderer, labels: hud, layerItems: [], interior: null, _dirty: false,
    get camera() { return getCamera(); }, get dark() { return isDark(); },
    get clientWidth() { return renderer.domElement.clientWidth; }, get clientHeight() { return renderer.domElement.clientHeight; },
  };
  const fx = new StepFx(host);
  let cur = null; // { p, e, info, group, layers: [{ m, mid }], restore: [], scroll: [materials] }
  let hotspots = [];

  function interiorOf(p, e) {
    const cfg = getAnchors()?.[p.id], sc = cfg?.scale ?? 1, off = cfg?.offset || [0, 0, 0], iv = cfg?.interiors?.[e.id];
    if (iv) return { cx: iv.center[0] * sc + off[0], cz: iv.center[1] * sc + off[2], y0: iv.y0 * sc + off[1], y1: iv.y1 * sc + off[1], r: iv.r * sc, box: iv.box ? [iv.box[0] * sc, iv.box[1] * sc] : null, w: iv.w ? iv.w * sc : null };
    const b = e.box, c = b.getCenter(new THREE.Vector3()), s = b.getSize(new THREE.Vector3());
    return { cx: c.x, cz: c.z, y0: b.min.y + s.y * 0.08, y1: b.max.y - s.y * 0.08, r: Math.max(0.8, Math.min(s.x, s.z) * 0.3), box: null, w: null };
  }
  const mat = (c, op = 0.9, map = null) => new THREE.MeshBasicMaterial({ color: map ? 0xffffff : c, map, transparent: true, opacity: op, depthTest: false });

  // v4 _showInterior의 층 배치(stack / bed / chambers / stove / strand) + 층 텍스처
  function build(e, info) {
    const { cx, cz, y0, y1, r } = info, layers = e.data.interior, H = y1 - y0, layout = e.data.interiorLayout || 'stack';
    const g = new THREE.Group(); g.name = 'INDEX_INTERIOR'; let y = y1, x = cx - r * 1.6;
    const W = info.w || r * 3.2, x0 = cx - W / 2; if (layout === 'strand') x = x0;
    const out = [], scroll = [];
    layers.forEach((L, idx) => {
      let m, mid, h = L.h * H;
      if (layout === 'strand') {
        const Rr = H, qLen = Math.PI / 2 * Rr, total = qLen + Math.max(0, W - Rr), th = 0.32, dp = r * 1.3;
        const t0 = x - x0, t1 = t0 + L.h * total;
        const P = (t) => Rr > 0.01 && t < qLen ? { x: x0 + Rr - Rr * Math.cos(t / Rr), y: y1 - Rr * Math.sin(t / Rr) } : { x: x0 + Rr + (t - qLen), y: y0 };
        const n = Math.max(2, Math.ceil((t1 - t0) / 0.28)); m = new THREE.Group();
        for (let q = 0; q < n; q++) { const ta = t0 + (t1 - t0) * q / n, tb = t0 + (t1 - t0) * (q + 1) / n, pa = P(ta), pb = P(tb), len = Math.hypot(pb.x - pa.x, pb.y - pa.y) * 1.08; const seg = new THREE.Mesh(new THREE.BoxGeometry(len, th, dp), mat(L.color)); seg.position.set((pa.x + pb.x) / 2, (pa.y + pb.y) / 2 + th / 2, cz); seg.rotation.z = Math.atan2(pb.y - pa.y, pb.x - pa.x); m.add(seg); }
        const pm = P((t0 + t1) / 2); mid = new THREE.Vector3(pm.x, pm.y + th, cz); x += L.h * total;
      } else if (layout === 'bed') {            // 소결: 팰릿 대차 위 베드. 덩어리 텍스처가 흐르고, 아래 윈드박스
        const w = L.h * W, bh = H * 0.45, bm = mat(L.color, 0.95, bedTex(L.color)); scroll.push(bm);
        m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh, r * 1.2), bm); m.position.set(x + w / 2, y0 + bh / 2, cz); mid = m.position.clone();
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh * 0.12, r * 1.3), mat(0x2a2f36, 0.95)); rail.position.set(mid.x, y0 - bh * 0.06, cz); rail.renderOrder = 10; g.add(rail);
        const nb = Math.max(1, Math.round(w / (r * 0.9))); for (let q = 0; q < nb; q++) { const wb = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96 / nb * 0.7, bh * 0.5, r * 0.8), mat(0x1f242b, 0.9)); wb.position.set(x + w * 0.96 / nb * (q + 0.5) + w * 0.02, y0 - bh * 0.42, cz); wb.renderOrder = 10; g.add(wb); } // 윈드박스
        x += w;
      } else if (layout === 'chambers') {
        const n = layers.filter((q) => !q.wall).length, cw = W / n;
        if (L.wall) { m = new THREE.Group(); for (let i = 0; i <= n; i++) { const wall = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.18, H, r * 1.5), mat(L.color)); wall.position.set(cx - W / 2 + i * cw, y0 + H / 2, cz); wall.renderOrder = 10; m.add(wall); } mid = new THREE.Vector3(cx, y1 + H * 0.08, cz); }
        else { const i = layers.filter((q, k) => k < idx && !q.wall).length; m = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.74, H * 0.92, r * 1.4), mat(L.color)); m.position.set(cx - W / 2 + cw * (i + 0.5), y0 + H * 0.46, cz); mid = m.position.clone(); }
      } else if (layout === 'stove' && idx === 0) {
        m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(L.color, 0.9, checkerTex(L.color))); m.position.set(cx, y - h, cz); mid = new THREE.Vector3(cx, y - h * 0.4, cz); y -= h;
      } else if (layout === 'stove' && idx === layers.length - 1) {
        m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 2.4, 16), mat(L.color)); m.rotation.z = Math.PI / 2; m.position.set(cx + r + r * 1.2, y0 + H * 0.12, cz); mid = m.position.clone();
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 0.6, 16), mat(L.color)); arrow.rotation.z = -Math.PI / 2; arrow.position.set(cx + r + r * 2.6, y0 + H * 0.12, cz); arrow.renderOrder = 10; g.add(arrow);
      } else {
        const prof = e.id === 'blast_furnace' ? (t) => { const P = [[0, 0.56], [0.1, 0.6], [0.52, 0.9], [0.66, 0.94], [0.8, 0.76], [1, 0.8]]; let i = 1; while (i < P.length - 1 && t > P[i][0]) i++; const [a, ra] = P[i - 1], [b, rb] = P[i]; return ra + (rb - ra) * (t - a) / (b - a); } : () => 0.86;
        const tTop = (y1 - y) / H, tBot = (y1 - y + h) / H;
        const tex = e.id === 'blast_furnace' ? burdenTex(L.color) : layout === 'stove' ? checkerTex(L.color) : null;
        m = new THREE.Mesh(info.box ? new THREE.BoxGeometry(info.box[0], h, info.box[1]) : new THREE.CylinderGeometry(r * prof(tTop), r * prof(tBot), h, 40), mat(L.color, 0.9, tex)); m.position.set(cx, y - h / 2, cz); mid = m.position.clone(); y -= h;
      }
      m.renderOrder = 10; m.traverse((o) => { o.renderOrder = 10; o.userData.layerIdx = idx; }); g.add(m);
      out.push({ m, mid, L });
    });
    return { group: g, layers: out, scroll };
  }

  function xray(p, e) {
    const restore = [];
    p.root.traverse((o) => { if (!o.isMesh || !o.visible) return; const m = o.material; restore.push(() => { m.transparent = m.userData._tr; m.opacity = m.userData._op; m.depthWrite = m.userData._dw; m.needsUpdate = true; });
      if (m.userData._tr === undefined) { m.userData._tr = m.transparent; m.userData._op = m.opacity; m.userData._dw = m.depthWrite; }
      let inside = false; for (let q = o; q; q = q.parent) if (q === e.node) { inside = true; break; }
      m.transparent = true; m.opacity = inside ? 0.16 : 0.1; m.depthWrite = false; m.needsUpdate = true; });
    return restore;
  }

  // step-fx의 글자 말풍선 → 맥동 핫스팟 핀. 글은 hotspots로 넘긴다(패널에서 펼침)
  function pinify() {
    hotspots = [];
    fx.els.forEach((el, i) => {
      const body = el.querySelector('.sfx-body') || el, b = body.querySelector('b'), text = (b ? b.textContent : body.textContent).trim(), sub = body.querySelector('small')?.textContent.trim() || '';
      if (!text) return;
      el.classList.add('lh-hot'); el.dataset.i = String(i); el.innerHTML = `<button class="lh-pin" type="button" aria-label="${text.replace(/"/g, '&quot;')}"><i></i></button>`;
      el.style.pointerEvents = 'auto'; el.firstChild.onclick = () => onHotspot?.(i);
      hotspots.push({ i, text, sub });
    });
    return hotspots;
  }
  function highlight(i) { fx.els.forEach((el) => el.classList.toggle('on', el.dataset.i === String(i))); }

  function hide() {
    fx.clear(); host.layerItems = []; host.interior = null; hotspots = [];
    if (!cur) return;
    scene.remove(cur.group); cur.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
    cur.restore.forEach((f) => f()); cur = null;
  }
  function show(p, e) {
    if (cur && cur.e === e) return true; hide();
    if (!e.data.interior?.length) return false;
    const info = interiorOf(p, e), { group, layers, scroll } = build(e, info);
    scene.add(group); group.updateMatrixWorld(true);
    cur = { p, e, info, group, layers, scroll, restore: xray(p, e) };
    host.layerItems = layers; host.interior = group;
    return true;
  }
  /** 층 하나를 밝히고 그 단계의 시각화를 튼다. { target, span, hotspots }를 돌려준다(없으면 null). */
  function layer(idx) {
    if (!cur) return null;
    cur.layers.forEach((l, i) => l.m.traverse((o) => { if (o.material) o.material.opacity = i === idx ? 0.95 : 0.28; }));
    fx.play({ id: cur.e.id, interior: cur.info }, idx);
    const hs = pinify();
    const box = new THREE.Box3().setFromObject(cur.group), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
    const l = cur.layers[idx]; return { target: l ? l.mid.clone().lerp(c, 0.35) : c, span: Math.max(s.x, s.y, s.z), hotspots: hs };
  }
  function tick(now) { if (cur?.scroll?.length) { const off = (now / 1000) * 0.08 % 1; cur.scroll.forEach((m) => { if (m.map) m.map.offset.x = -off; }); } return fx.tick(now); }
  return { show, layer, hide, tick, highlight, get hotspots() { return hotspots; }, get active() { return !!cur; }, get equipment() { return cur?.e || null; } };
}

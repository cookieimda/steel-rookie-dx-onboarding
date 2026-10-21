// [세련안] 밤 불빛 — 공장 주변의 현실적인 광원(모두 스프라이트·점 + 바닥 번짐, 실제 Light 없음 → 셰이더 재컴파일·추가 로딩 없음)
//   import { attachNightLights } from './night-lights.js'; attachNightLights();
// 종류: 공장동 창문 띠, 야적장·안벽 투광등(기둥 위 흰빛 + 바닥 원), 굴뚝·크레인 적색 장애등(점멸), 고로 출선구 붉은빛(맥동), 도로 나트륨등 번짐
// 라이트 모드에서는 전부 숨긴다. 결정적 seed, 시간 기반(simTime) 갱신.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const dot = (() => { let t; return () => t ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })(); })();
const points = (n, size, extra = {}) => { const pos = new Float32Array(n * 3), col = new Float32Array(n * 3), geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const p = new THREE.Points(geo, new THREE.PointsMaterial({ map: dot(), size, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, ...extra })); p.raycast = () => {}; p.frustumCulled = false; p.renderOrder = 7; p.userData.nightLight = true; return { p, pos, col, geo }; };
const pool = (() => { let t; return () => t ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (let k = 0; k <= 8; k++) { const u = k / 8, f = Math.pow(1 - u * u, 2); g.addColorStop(u, `rgba(255,255,255,${f.toFixed(3)})`); } x.fillStyle = g; x.fillRect(0, 0, 128, 128); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })(); })();
const floorGlow = (color, r, op) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(r * 2, r * 2), new THREE.MeshBasicMaterial({ color, map: pool(), transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); m.rotation.x = -Math.PI / 2; m.raycast = () => {}; m.renderOrder = 4; m.userData.nightLight = true; return m; };

export async function attachNightLights() {
  let el; while (!(el = document.querySelector('steel-scene'))) await new Promise(r => setTimeout(r, 100));
  while (!el.scene || !el.zones || Object.values(el.zones).some(z => !z.modelStatus || z.modelStatus === 'loading')) await new Promise(r => setTimeout(r, 150));
  if (el.__nightLights) return; el.__nightLights = true;
  const root = new THREE.Group(); root.name = 'NIGHT_LIGHTS'; root.userData.nightLight = true; el.scene.add(root);
  let seed = 31; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const Z = el.zones, zp = (id, dx, dz) => { const z = Z[id]; return z ? [z.ox + dx, z.oz + dz] : [dx, dz]; };
  const zoneBox = (id) => { const z = Z[id]; if (!z) return null; return new THREE.Box3().setFromObject(z.root); };

  // 1. 공장동 창문 띠 — 각 공정 모델의 긴 변을 따라 높이 ~6m에 작은 따뜻한 창 불빛 줄. 일부 꺼짐
  const WIN = []; for (const id of ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling']) { const b = zoneBox(id); if (!b) continue; const y = Math.min(b.max.y * 0.45, 7), n = Math.round((b.max.x - b.min.x) / 2.2); for (let i = 0; i < n; i++) { const x = b.min.x + 1.1 + i * 2.2; WIN.push([x, y, b.max.z + 0.3, rnd() < 0.7 ? 1 : 0.08]); WIN.push([x, y, b.min.z - 0.3, rnd() < 0.7 ? 1 : 0.08]); } }
  const win = points(WIN.length, 1.1, { opacity: 0.9 }); root.add(win.p); WIN.forEach((w, i) => { win.pos.set([w[0], w[1], w[2]], i * 3); win.col.set([1 * w[3], 0.82 * w[3], 0.55 * w[3]], i * 3); }); win.geo.attributes.position.needsUpdate = win.geo.attributes.color.needsUpdate = true;
  let winT = 0; const winOn = WIN.map(w => w[3]);

  // 2. 투광등(야적장·안벽·각 공정 모퉁이) — 기둥 위 흰빛 점 + 바닥 큰 원. 좌표는 기존 가로등·공정 위치 기준
  const FLOOD = [[62, -58], [84, -58], [66, -50.5], [96, -50.5], [30, -46], [44, -46], [58, -46], ...['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'].flatMap(id => { const b = zoneBox(id); return b ? [[b.min.x - 2, b.min.z - 2], [b.max.x + 2, b.max.z + 2]] : []; })];
  FLOOD.forEach(([x, z]) => { const g = floorGlow(0xcfd8e6, 11, 0.22); g.position.set(x, 0.12, z); root.add(g); });

  // 3. 적색 항공장애등 — 각 공정 모델 꼭대기 2곳 + 야적장 크레인 3곳. 1.2초 주기 점멸, 위상 다름
  const OBS = [...['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'].flatMap(id => { const b = zoneBox(id); return b ? [[b.min.x + (b.max.x - b.min.x) * 0.3, b.max.y + 0.6, (b.min.z + b.max.z) / 2], [b.min.x + (b.max.x - b.min.x) * 0.7, b.max.y + 0.6, (b.min.z + b.max.z) / 2]] : []; }), [30, 19, -51], [44, 19, -50], [58, 19, -49]];
  const ob = points(OBS.length, 1.8); root.add(ob.p); OBS.forEach((p, i) => ob.pos.set(p, i * 3)); ob.geo.attributes.position.needsUpdate = true; const obPh = OBS.map(() => rnd() * 1.2);

  // 4. 고로 출선구·전로 붉은빛 — 제선 고로 아래, 제강 전로 쪽. 큰 주황 스프라이트 맥동 + 바닥 번짐
  const HOT = [[...zp('ironmaking', 4, 4), 0xff7a28, 10], [...zp('steelmaking', 0, 2), 0xffa040, 7]];
  const hot = HOT.map(([x, z, c, r]) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dot(), color: c, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.position.set(x, 2.4, z); s.scale.setScalar(r); s.renderOrder = 8; s.userData.nightLight = true; root.add(s); const f = floorGlow(c, r * 0.9, 0.3); f.position.set(x, 0.14, z); root.add(f); return { s, f, r, ph: rnd() * 6 }; });

  // 5. 도로 나트륨등 번짐 — 기존 가로등(userData.lamp) 아래 바닥에 주황빛 원 (가로등 스프라이트는 이미 있으므로 바닥만)
  const lamps = []; el.scene.traverse(o => { if (o.userData.lamp && !o.userData.nightLight) lamps.push(o); });
  const V = new THREE.Vector3(); lamps.slice(0, 120).forEach(o => { o.getWorldPosition(V); const g = floorGlow(0xffb060, 6, 0.16); g.position.set(V.x, 0.1, V.z); root.add(g); });

  const isDark = () => (el.getAttribute('theme') || 'dark') === 'dark';
  let last = performance.now(), simT = 0;
  const tick = (now) => { requestAnimationFrame(tick); if (document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now; simT += dt;
    const on = isDark() && (el._isOverview !== false); if (root.visible !== on) { root.visible = on; el._dirty = true; } if (!on) return;
    // 창문: 1.5초마다 한 칸 토글
    if ((winT += dt) > 1.5) { winT = 0; const i = Math.floor(rnd() * WIN.length); winOn[i] = winOn[i] > 0.5 ? 0.08 : 1; win.col.set([winOn[i], 0.82 * winOn[i], 0.55 * winOn[i]], i * 3); win.geo.attributes.color.needsUpdate = true; }
    // 장애등 점멸
    for (let i = 0; i < OBS.length; i++) { const k = ((simT + obPh[i]) % 1.2) < 0.18 ? 1 : 0.06; ob.col.set([k, k * 0.1, k * 0.06], i * 3); } ob.geo.attributes.color.needsUpdate = true;
    // 출선구 맥동
    hot.forEach(h => { const p = 0.7 + 0.3 * Math.sin(simT * 1.1 + h.ph) + 0.08 * Math.sin(simT * 6.7 + h.ph); h.s.material.opacity = 0.42 * p; h.s.scale.setScalar(h.r * (0.9 + 0.2 * p)); h.f.material.opacity = 0.28 * p; });
    el._dirty = true; };
  requestAnimationFrame(tick);
  return root;
}

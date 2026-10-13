// 전체 공정 배경 디테일 (scene_v3.js 수정 없이 <steel-scene>에 붙인다)
//   import { attachSiteDetails } from './site-details.js'; attachSiteDetails();
// 낮·밤 공통: 항공장애등(크레인·고층 설비·관제탑·풍력탑, 빨간등 동기 점멸), 방파제 등대, 압연 동쪽 관제탑 회전 레이더, 먼 풍력발전기 3기
// 낮만: 부지 위를 선회하는 순찰 헬기(기수가 진행 방향), 바다 햇빛 반짝임 / 밤만: 등대 회전 빔 (비행기는 scene_v3.js 기존 것)
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const glowTex = (() => { let t; return () => t ||= (() => { const c = document.createElement('canvas'); c.width = c.height = 64; const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, 64, 64); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; return tx; })(); })();
const beamTex = () => { const c = document.createElement('canvas'); c.width = 256; c.height = 32; const x = c.getContext('2d'), g = x.createLinearGradient(0, 0, 256, 0);
  g.addColorStop(0, 'rgba(255,248,220,.9)'); g.addColorStop(0.3, 'rgba(255,244,210,.35)'); g.addColorStop(1, 'rgba(255,240,200,0)'); x.fillStyle = g; x.fillRect(0, 0, 256, 32);
  const v = x.createLinearGradient(0, 0, 0, 32); v.addColorStop(0, 'rgba(0,0,0,1)'); v.addColorStop(0.5, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,1)'); x.globalCompositeOperation = 'destination-out'; x.fillStyle = v; x.fillRect(0, 0, 256, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; };
const glow = (color, size, op = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex(), color, transparent: true, opacity: op, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); s.scale.setScalar(size); s.renderOrder = 8; return s; };
const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.7, metalness: 0.2, ...extra });
const mesh = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.raycast = () => {}; return m; };

export async function attachSiteDetails() {
  let el; while (!(el = document.querySelector('steel-scene'))) await new Promise(r => setTimeout(r, 100));
  if (el.__siteDetails) return el.__siteDetails; el.__siteDetails = true; // 페이지 재실행 시 중복 부착 방지
  while (!el.scene || !el.backdrop) await new Promise(r => setTimeout(r, 100));
  const root = new THREE.Group(); root.name = 'SITE_DETAILS'; el.scene.add(root);
  const day = new THREE.Group(), night = new THREE.Group(); root.add(day, night);
  const avi = []; // 항공장애등 스프라이트
  const addAvi = (x, y, z, s = 2.2) => { const g = glow(0xff2a1a, s); g.position.set(x, y, z); root.add(g); avi.push(g); return g; };

  // 크레인 꼭대기 4곳 (scene_v3.js crane() 운전실 위 마스트 끝)
  [[30, 22.8, -51.7], [44, 22.8, -50.5], [58, 22.8, -49.3], [39, 19.4, 8.9]].forEach(p => addAvi(...p));

  // 방파제 등대: 흰 탑 + 빨간 머리, 밤에는 회전 빔
  const LH = [76.5, 0, -25.5], lh = new THREE.Group(); lh.position.set(...LH); root.add(lh);
  const white = std(0xeef0f2), red = std(0xc8322a);
  lh.add(mesh(new THREE.CylinderGeometry(0.75, 1.05, 7, 14), white, 0, 3.5, 0), mesh(new THREE.CylinderGeometry(0.8, 0.8, 0.9, 14), red, 0, 2.2, 0),
    mesh(new THREE.CylinderGeometry(1.1, 1.1, 0.25, 14), red, 0, 7.1, 0), mesh(new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10), new THREE.MeshStandardMaterial({ color: 0xfff1c8, emissive: 0xffe6a0, emissiveIntensity: 0.6, roughness: 0.2 }), 0, 7.8, 0),
    mesh(new THREE.ConeGeometry(0.8, 0.8, 14), red, 0, 8.75, 0));
  const lamp = glow(0xfff0c8, 2.2, 0.6); lamp.position.set(0, 7.8, 0); lh.add(lamp);
  const beam = new THREE.Group(); beam.position.set(0, 7.8, 0); lh.add(beam);
  { const bm = new THREE.MeshBasicMaterial({ map: beamTex(), transparent: true, opacity: 0.16, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false });
    const pg = new THREE.PlaneGeometry(45, 2.6); pg.translate(22.5, 0, 0);
    [0, Math.PI].forEach(r => { const arm = new THREE.Group(); arm.rotation.y = r; [0, Math.PI / 2].forEach(rx => { const m = new THREE.Mesh(pg, bm); m.rotation.x = rx; m.raycast = () => {}; m.renderOrder = 7; arm.add(m); }); beam.add(arm); }); }

  // 관제탑 + 회전 레이더 (압연 동쪽)
  const CT = [9, 0, 74], tower = new THREE.Group(); tower.position.set(...CT); root.add(tower);
  const tw = std(0xd9dcdf), glass = new THREE.MeshStandardMaterial({ color: 0x1e3a52, emissive: 0x4a90c8, emissiveIntensity: 0.15, roughness: 0.15, metalness: 0.4 });
  tower.add(mesh(new THREE.CylinderGeometry(1.3, 1.7, 12, 12), tw, 0, 6, 0), mesh(new THREE.CylinderGeometry(2.6, 1.9, 2.2, 12), glass, 0, 13.1, 0), mesh(new THREE.CylinderGeometry(2.8, 2.8, 0.35, 12), tw, 0, 14.4, 0), mesh(new THREE.CylinderGeometry(0.15, 0.15, 1.6, 6), std(0x555b62), 0, 15.3, 0));
  const radar = new THREE.Group(); radar.position.set(0, 16.1, 0); tower.add(radar);
  radar.add(mesh(new THREE.BoxGeometry(4.2, 0.9, 0.25), std(0xe8eaec), 0, 0, 0), mesh(new THREE.BoxGeometry(0.5, 0.3, 0.6), std(0x555b62), 0, -0.4, 0));
  addAvi(CT[0], 17.3, CT[2], 1.8); tower.userData.glass = glass;

  // 먼 풍력발전기 3기 (서쪽 산자락)
  const blades = [], wm = std(0xe6e8ea, { roughness: 0.5 }), WG = { tw: new THREE.CylinderGeometry(0.45, 0.9, 32, 8), nc: new THREE.BoxGeometry(2.6, 1.1, 1.1), hb: new THREE.SphereGeometry(0.55, 8, 6), bl: new THREE.BoxGeometry(0.18, 13, 0.75) };
  [[-232, -150, 0.4], [-256, -108, 1.6], [-240, -66, 2.9]].forEach(([x, z, ph]) => { const t = new THREE.Group(); t.position.set(x, 0, z); t.rotation.y = -0.6; root.add(t);
    t.add(mesh(WG.tw, wm, 0, 16, 0), mesh(WG.nc, wm, 0.4, 32.4, 0));
    const hub = new THREE.Group(); hub.position.set(-1.1, 32.4, 0); t.add(hub); hub.add(mesh(WG.hb, wm, 0, 0, 0));
    for (let k = 0; k < 3; k++) { const b = mesh(WG.bl, wm, 0, 6.5, 0); const arm = new THREE.Group(); arm.rotation.x = k * Math.PI * 2 / 3; arm.add(b); hub.add(arm); }
    hub.rotation.x = ph; blades.push(hub); addAvi(x, 33.4, z, 3.2); });

  // 항로 부표: 몸통은 InstancedMesh 1개, 등불은 Points 1개(초록·빨강 교대 점멸)
  const BUOY = [[96, -40], [110, -10], [124, 20], [138, 50], [104, -70], [118, -100], [150, 80], [132, -130]];
  const bI = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.7, 1.6, 8), std(0xd8a21e), BUOY.length), dm = new THREE.Object3D();
  BUOY.forEach(([x, z], i) => { dm.position.set(x, 0.6, z); dm.updateMatrix(); bI.setMatrixAt(i, dm.matrix); }); bI.raycast = () => {}; root.add(bI);
  const bp = new Float32Array(BUOY.length * 3), bc = new Float32Array(BUOY.length * 3); BUOY.forEach(([x, z], i) => { bp.set([x, 1.8, z], i * 3); });
  const bgeo = new THREE.BufferGeometry(); bgeo.setAttribute('position', new THREE.BufferAttribute(bp, 3)); bgeo.setAttribute('color', new THREE.BufferAttribute(bc, 3));
  const bLights = new THREE.Points(bgeo, new THREE.PointsMaterial({ map: glowTex(), size: 3, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); bLights.raycast = () => {}; root.add(bLights);
  // 먼바다 컨테이너선: 선체·선교·컨테이너 줄을 3개 메시로
  const ship = new THREE.Group(); root.add(ship);
  { const hull = mesh(new THREE.BoxGeometry(34, 2.6, 6), std(0x2e3a46), 0, 1.1, 0), deck = mesh(new THREE.BoxGeometry(34.4, 0.4, 6.2), std(0xa63a2c), 0, -0.1, 0), br = mesh(new THREE.BoxGeometry(3.4, 5, 5.2), std(0xe9ecef), -13.5, 4.9, 0);
    const cI = new THREE.InstancedMesh(new THREE.BoxGeometry(2.3, 2.2, 5.4), new THREE.MeshStandardMaterial({ roughness: 0.8 }), 20), cols = [0xc0482e, 0x2f6aa8, 0xd8a21e, 0x3d8a5a, 0x8a8f96];
    for (let i = 0; i < 20; i++) { const col = i % 10, row = Math.floor(i / 10); dm.position.set(-9 + col * 2.45, 3.5 + row * 2.2, 0); dm.updateMatrix(); cI.setMatrixAt(i, dm.matrix); cI.setColorAt(i, new THREE.Color(cols[(i * 7) % 5])); }
    [hull, deck, br, cI].forEach(m => { m.raycast = () => {}; ship.add(m); }); const sl = glow(0xffe8c0, 1.6); sl.position.set(-13.5, 8, 0); ship.add(sl); }

  // 고층 설비 꼭대기 (공정 GLB가 로드된 뒤 각 구역 최고점에 1개)
  const tops = new Set(); const findTops = () => Object.values(el.zones || {}).forEach(z => { if (tops.has(z.id) || !z.glb) return; const b = new THREE.Box3().setFromObject(z.glb); if (!isFinite(b.max.y)) return; tops.add(z.id);
    let best = null; z.glb.traverse(o => { if (!o.isMesh || !o.visible) return; const bb = new THREE.Box3().setFromObject(o); if (bb.max.y > b.max.y - 0.5 && (!best || bb.max.y > best.max.y)) best = bb; });
    if (best) { const c = best.getCenter(new THREE.Vector3()); const g = addAvi(c.x, best.max.y + 0.5, c.z, 1.8); g.userData.zone = z; } });

  // 낮: 순찰 헬기 (기수 = 진행 방향)
  const heli = new THREE.Group(); heli.visible = false; // 헬기 사용 안 함
  if (false) day.add(heli);
  { const body = std(0x2c4a6e, { metalness: 0.35, roughness: 0.45 }), dark = std(0x23262b);
    const cab = mesh(new THREE.SphereGeometry(1, 14, 10), body, 0.4, 0, 0); cab.scale.set(1.9, 1, 1); heli.add(cab);
    heli.add(mesh(new THREE.SphereGeometry(0.62, 12, 8), new THREE.MeshStandardMaterial({ color: 0x9fc3dc, roughness: 0.1, metalness: 0.5 }), 1.6, 0.15, 0));
    heli.add(mesh(new THREE.CylinderGeometry(0.16, 0.3, 4.4, 8), body, -2.6, 0.15, 0).rotateZ(Math.PI / 2));
    heli.add(mesh(new THREE.BoxGeometry(0.7, 1.2, 0.1), body, -4.7, 0.6, 0));
    [-0.7, 0.7].forEach(z => heli.add(mesh(new THREE.BoxGeometry(3, 0.1, 0.1), dark, 0.4, -1.15, z)));
    const rotor = new THREE.Group(); rotor.position.set(0.4, 1.15, 0); heli.add(rotor); rotor.add(mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.4, 6), dark, 0, -0.2, 0));
    [0, Math.PI / 2].forEach(r => rotor.add(mesh(new THREE.BoxGeometry(8.5, 0.05, 0.28), dark, 0, 0, 0).rotateY(r)));
    const disc = mesh(new THREE.CircleGeometry(4.3, 24), new THREE.MeshBasicMaterial({ color: 0x23262b, transparent: true, opacity: 0.12, depthWrite: false, side: THREE.DoubleSide }), 0, 0.02, 0); disc.rotation.x = -Math.PI / 2; rotor.add(disc);
    const tail = new THREE.Group(); tail.position.set(-4.75, 0.6, 0.12); heli.add(tail); tail.add(mesh(new THREE.BoxGeometry(1.3, 0.05, 0.12), dark, 0, 0, 0));
    heli.userData = { rotor, tail }; const nav = glow(0xff3020, 1.2); nav.position.set(-4.7, 1.2, 0); heli.add(nav); heli.userData.nav = nav; }
  const HC = [0, -5], HR = 95, HY = 42, HV = 0.045; // 반시계(위에서 볼 때 +각도) 방향 선회

  // 낮: 바다 햇빛 반짝임 (방파제 동쪽 바다) — 고정 개수, 반짝임은 결정적 위상
  const GN = 160; let gk = 7; const rnd = () => (gk = (gk * 16807) % 2147483647) / 2147483647;
  const gpos = new Float32Array(GN * 3), gcol = new Float32Array(GN * 3), gph = new Float32Array(GN), gsp = new Float32Array(GN);
  for (let i = 0; i < GN; i++) { gpos[i * 3] = 85 + rnd() * 190; gpos[i * 3 + 1] = 0.3; gpos[i * 3 + 2] = -170 + rnd() * 280; gph[i] = rnd() * 6.28; gsp[i] = 1.4 + rnd() * 2.4; }
  const ggeo = new THREE.BufferGeometry(); ggeo.setAttribute('position', new THREE.BufferAttribute(gpos, 3)); ggeo.setAttribute('color', new THREE.BufferAttribute(gcol, 3));
  const glint = new THREE.Points(ggeo, new THREE.PointsMaterial({ map: glowTex(), size: 2.6, sizeAttenuation: true, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true }));
  glint.raycast = () => {}; glint.renderOrder = 5; day.add(glint);

  const theme = () => (el.getAttribute('theme') || 'dark') === 'dark';
  let last = performance.now(), simT = 0, findT = 0, gTick = 0;
  const tick = (now) => { requestAnimationFrame(tick); if (document.hidden) { last = now; return; }
    const dt = Math.min((now - last) / 1000, 0.05); last = now; simT += dt;
    const vis = el.backdrop?.visible !== false && !el._bpGrid?.visible && !el._2d; root.visible = vis; if (!vis) return;
    const dk = theme(); day.visible = !dk; night.visible = dk; beam.visible = dk; lamp.material.opacity = dk ? 0.6 : 0.3;
    if (tops.size < 4 && (findT += dt) > 1) { findT = 0; findTops(); }
    // 항공장애등: 1.5초 주기 동기 점멸 (켜짐 0.35초, 부드러운 페이드)
    const ph = (simT % 1.5) / 1.5, on = ph < 0.25 ? Math.sin(ph / 0.25 * Math.PI) : 0;
    avi.forEach(a => { a.visible = !a.userData.zone || a.userData.zone.root.visible; a.material.opacity = (dk ? 0.15 : 0.08) + on * (dk ? 1 : 0.75); });
    beam.rotation.y = simT * 0.9;
    radar.rotation.y = simT * 1.6; tower.userData.glass.emissiveIntensity = dk ? 0.7 : 0.15;
    blades.forEach((h, i) => { h.rotation.x += dt * (0.55 + i * 0.07); });
    for (let i = 0; i < BUOY.length; i++) { const k = Math.max(0, Math.sin(simT * 2.2 + i * 1.3)) ** 6 * (dk ? 1 : 0.6), g = i % 2 === 0; bc[i * 3] = g ? 0.1 * k : k; bc[i * 3 + 1] = g ? k : 0.15 * k; bc[i * 3 + 2] = g ? 0.35 * k : 0.1 * k; } bgeo.attributes.color.needsUpdate = true;
    { const L = 900, u = ((simT * 3.2) % L) - L / 2; ship.position.set(205, 0, u * 0.6); ship.rotation.y = -Math.PI / 2 + 0.05; } // 남북으로 천천히 항해 (기수 = 진행 방향 +Z)
    if (false) { const a = simT * HV, x = HC[0] + HR * Math.cos(a), z = HC[1] + HR * Math.sin(a), vx = -Math.sin(a), vz = Math.cos(a);
      heli.position.set(x, HY + Math.sin(simT * 0.6) * 1.2, z); heli.rotation.set(0, Math.atan2(-vz, vx), 0); heli.rotateX(-0.12); heli.rotateZ(-0.08); // 기수(+X)를 진행 방향으로, 살짝 앞으로 숙이고 안쪽으로 기울임
      heli.userData.rotor.rotation.y = simT * 38; heli.userData.tail.rotation.z = simT * 55; heli.userData.nav.material.opacity = 0.2 + on * 0.8;
    } if (!dk && (gTick = (gTick + 1) % 3) === 0) { for (let i = 0; i < GN; i++) { const v = Math.max(0, Math.sin(simT * gsp[i] + gph[i])); const k = v ** 8; gcol[i * 3] = k; gcol[i * 3 + 1] = k * 0.97; gcol[i * 3 + 2] = k * 0.88; } ggeo.attributes.color.needsUpdate = true; }
    el._dirty = true; };
  requestAnimationFrame(tick);
  return root;
}

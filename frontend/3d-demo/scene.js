// <steel-scene> — Three.js 공정 뷰. 설비 그룹 이름 = EQ_<id> (GLB 노드 규약과 동일).
// GLB 교체: buildProcess() 안의 primitive 생성 부분을 GLTFLoader.load(`models/${processId}.glb`)로 바꾸고,
// scene.getObjectByName(`EQ_${id}`)로 노드를 찾으면 나머지(라벨·클릭·하이라이트·흐름)는 그대로 동작.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { PROCESSES, findProcess } from './data.js';
const ZONE_GAP = 90; // 공정 구역 간격(X축). 4개 구역이 한 장면에 나란히 놓임
const zoneX = (i) => (i - (PROCESSES.length - 1) / 2) * ZONE_GAP;

const STEEL = 0x7d8794, DARK = 0x4a525c, ACCENT = 0x1a9bd7, UI = '#1a9bd7';
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, metalness: 0.35, ...o });
const mesh = (g, m, y = 0) => { const o = new THREE.Mesh(g, m); o.position.y = y; return o; };

function equipmentPrimitive(shape) {
  const g = new THREE.Group();
  const add = (m) => (g.add(m), m);
  switch (shape) {
    case 'tower': add(mesh(new THREE.CylinderGeometry(1.3, 1.9, 6.5, 20), mat(STEEL), 3.25)); add(mesh(new THREE.CylinderGeometry(0.6, 1.3, 1.6, 20), mat(DARK), 7.3)); add(mesh(new THREE.CylinderGeometry(0.9, 1.9, 1.2, 20), mat(DARK), 0.6)); break;
    case 'battery': for (let i = 0; i < 5; i++) add(mesh(new THREE.BoxGeometry(0.7, 3, 2.4), mat(i % 2 ? DARK : STEEL), 1.5)).position.x = (i - 2) * 0.85; break;
    case 'cyl': for (let i = 0; i < 3; i++) add(mesh(new THREE.CylinderGeometry(0.7, 0.7, 4.5, 16), mat(STEEL), 2.25)).position.x = (i - 1) * 1.7; break;
    case 'ladle': add(mesh(new THREE.CylinderGeometry(1.3, 1.0, 2.6, 20), mat(STEEL), 1.3)); add(mesh(new THREE.CylinderGeometry(1.15, 1.15, 0.2, 20), mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.6 }), 2.65)); break;
    case 'converter': add(mesh(new THREE.CylinderGeometry(1.5, 1.5, 3, 20), mat(STEEL), 1.9)); add(mesh(new THREE.CylinderGeometry(0.7, 1.5, 1.4, 20), mat(DARK), 4.1)); add(mesh(new THREE.CylinderGeometry(1.5, 1.0, 0.9, 20), mat(DARK), 0.45)); add(mesh(new THREE.BoxGeometry(4, 0.3, 0.3), mat(DARK), 1.9)); break;
    case 'twin': add(mesh(new THREE.CylinderGeometry(1.1, 0.9, 2.4, 20), mat(STEEL), 1.2)).position.x = -1.3; add(mesh(new THREE.BoxGeometry(1.8, 3.6, 1.8), mat(DARK), 1.8)).position.x = 1.3; break;
    case 'tray': add(mesh(new THREE.BoxGeometry(4, 1.2, 1.8), mat(STEEL), 3.2)); add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), mat(DARK), 1.3)).position.x = -1.7; add(mesh(new THREE.BoxGeometry(0.3, 2.6, 0.3), mat(DARK), 1.3)).position.x = 1.7; break;
    case 'mold': add(mesh(new THREE.BoxGeometry(2.6, 2.2, 2.2), mat(0xb87333, { metalness: 0.6 }), 2.6)); add(mesh(new THREE.BoxGeometry(3.2, 0.4, 2.8), mat(DARK), 1.3)); break;
    case 'rollers': for (let i = 0; i < 6; i++) { const r = add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 2.4, 12), mat(DARK), 0.9)); r.rotation.x = Math.PI / 2; r.position.x = (i - 2.5) * 0.8; } add(mesh(new THREE.BoxGeometry(5, 0.2, 0.2), mat(STEEL), 2.6)); break;
    case 'gate': add(mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), mat(STEEL), 1.6)).position.z = -1.4; add(mesh(new THREE.BoxGeometry(0.4, 3.2, 0.4), mat(STEEL), 1.6)).position.z = 1.4; add(mesh(new THREE.BoxGeometry(0.5, 0.5, 3.2), mat(DARK), 3.2)); add(mesh(new THREE.ConeGeometry(0.25, 0.7, 12), mat(ACCENT, { emissive: ACCENT, emissiveIntensity: 0.8 }), 2.6)).rotation.x = Math.PI; break;
    case 'stand': add(mesh(new THREE.BoxGeometry(2.2, 4, 3), mat(STEEL), 2)); add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 16), mat(DARK), 1.0)).rotation.x = Math.PI / 2; add(mesh(new THREE.CylinderGeometry(0.6, 0.6, 3.2, 16), mat(DARK), 2.4)).rotation.x = Math.PI / 2; break;
    case 'stands': for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(1.0, 3.4, 2.8), mat(i % 2 ? DARK : STEEL), 1.7)).position.x = (i - 1.5) * 1.3; break;
    case 'table': add(mesh(new THREE.BoxGeometry(6, 0.3, 2.2), mat(DARK), 0.9)); for (let i = 0; i < 4; i++) add(mesh(new THREE.BoxGeometry(0.2, 1.6, 2.4), mat(STEEL), 1.9)).position.x = (i - 1.5) * 1.6; break;
    case 'coiler': add(mesh(new THREE.CylinderGeometry(1.4, 1.4, 1.8, 24), mat(STEEL), 1.6)).rotation.x = Math.PI / 2; add(mesh(new THREE.BoxGeometry(1.2, 1.6, 1.2), mat(DARK), 0.8)); break;
    default: add(mesh(new THREE.BoxGeometry(3.2, 2.6, 2.6), mat(STEEL), 1.3)); add(mesh(new THREE.CylinderGeometry(0.3, 0.3, 1.8, 12), mat(DARK), 3.5)).position.x = 1;
  }
  return g;
}

function materialMesh(state) {
  const c = new THREE.Color(state.color);
  const glow = ['liquid'].includes(state.shape) || c.r > 0.9;
  const m = new THREE.MeshStandardMaterial({ color: c, roughness: 0.5, metalness: 0.2, emissive: glow ? c : 0x000000, emissiveIntensity: glow ? 0.7 : 0 });
  const g = new THREE.Group();
  switch (state.shape) {
    case 'chunks': for (let i = 0; i < 6; i++) { const d = new THREE.Mesh(new THREE.DodecahedronGeometry(0.32 + (i % 3) * 0.08, 0), m); d.position.set((i % 3 - 1) * 0.55, 0.3 + Math.floor(i / 3) * 0.45, (i % 2 - 0.5) * 0.5); g.add(d); } break;
    case 'liquid': { const s = new THREE.Mesh(new THREE.SphereGeometry(0.75, 20, 16), m); s.scale.y = 0.6; s.position.y = 0.5; g.add(s); break; }
    case 'slab': g.add(mesh(new THREE.BoxGeometry(3.2, 0.5, 1.5), m, 0.45)); break;
    case 'bar': g.add(mesh(new THREE.BoxGeometry(4.5, 0.22, 1.4), m, 0.4)); break;
    case 'strip': g.add(mesh(new THREE.BoxGeometry(6, 0.08, 1.4), m, 0.4)); break;
    case 'coil': { const t = new THREE.Mesh(new THREE.TorusGeometry(0.75, 0.42, 14, 32), m); t.position.y = 1.15; g.add(t); break; }
  }
  return g;
}

class SteelScene extends HTMLElement {
  static get observedAttributes() { return ['process', 'selected', 'theme']; }
  connectedCallback() {
    if (this._init) { this._startLoop(); return; } this._init = true;
    Object.assign(this.style, { display: 'block', position: 'relative', overflow: 'hidden', width: '100%', height: '100%', touchAction: 'none' });
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    Object.assign(this.renderer.domElement.style, { display: 'block', width: '100%', height: '100%', cursor: 'grab' });
    this.appendChild(this.renderer.domElement);
    this.labels = document.createElement('div');
    Object.assign(this.labels.style, { position: 'absolute', inset: '0', pointerEvents: 'none', overflow: 'hidden' });
    this.appendChild(this.labels);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 900);
    this.orbit = { yaw: -0.5, pitch: 0.36, dist: 48, target: new THREE.Vector3(0, 1.5, 0) };
    this.home0 = { yaw: -0.5, pitch: 0.36, dist: 48, target: [0, 1.5, 0] }; this.home = { ...this.home0 };
    this.scene.add(new THREE.HemisphereLight(0xdfe6ee, 0x3a4048, 0.9));
    const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(10, 20, 12); this.scene.add(sun);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, metalness: 0.1 }));
    this.ground.rotation.x = -Math.PI / 2; this.ground.position.y = -0.02; this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(700, 350, 0x556070, 0x3c4550); this.grid.visible = false; this.scene.add(this.grid);
    this.ring = new THREE.Mesh(new THREE.RingGeometry(2.4, 2.8, 48), new THREE.MeshBasicMaterial({ color: 0x1a9bd7, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    /* 배경 장식 제거 (성능) */ if (false) { const sg = new THREE.BufferGeometry(), sp = new Float32Array(1800 * 3);
    for (let i = 0; i < 1800; i++) { const r = 90 + Math.random() * 60, th = Math.random() * Math.PI * 2, ph = Math.acos(Math.random() * 0.9); sp.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph) - 10, r * Math.sin(ph) * Math.sin(th)], i * 3); }
    sg.setAttribute('position', new THREE.BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0x9fb0c4, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.8 })); this.scene.add(this.stars);
    this.glow = new THREE.Mesh(new THREE.CircleGeometry(60, 48), new THREE.MeshBasicMaterial({ color: 0xff6a10, transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.glow.rotation.x = -Math.PI / 2; this.glow.position.set(0, 0.03, 0); this.scene.add(this.glow);
    this.skyline = new THREE.Group();
    for (let i = 0; i < 70; i++) { const a = Math.random() * Math.PI * 2, r = 70 + Math.random() * 40, h = 4 + Math.random() * 22, w = 3 + Math.random() * 10; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), new THREE.MeshBasicMaterial({ color: 0x0b1119 })); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); this.skyline.add(b); if (Math.random() < 0.3) { const s = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.8, h * 1.6, 8), b.material); s.position.set(b.position.x + w / 2, h * 0.8, b.position.z); this.skyline.add(s); } }
    this.scene.add(this.skyline);
    }
    this.ring.rotation.x = -Math.PI / 2; this.ring.position.y = 0.02; this.ring.visible = false; this.scene.add(this.ring);
    this.ray = new THREE.Raycaster(); this.eqs = []; this._tourId = 0; this._tourWaits = [];
    this._bindPointer();
    new ResizeObserver(() => this._resize()).observe(this);
    this._resize();
    this._applyTheme();
    this._buildAll();
    this._applySelection();
    this._startLoop();
  }
  _startLoop() {
    if (this._raf) return;
    const tick = (now) => { this._frame(now); const o = this.orbit, key = `${o.yaw.toFixed(4)}|${o.pitch.toFixed(4)}|${o.dist.toFixed(3)}|${o.target.x.toFixed(2)},${o.target.y.toFixed(2)},${o.target.z.toFixed(2)}`; const busy = this.anim || this.move || this.playing || this.touring || this.ring.visible || this._dirty || key !== this._camKey; this._camKey = key; if (busy) { this.renderer.render(this.scene, this.camera); this._dirty = false; } this._raf = requestAnimationFrame(tick); };
    this._raf = requestAnimationFrame(tick);
  }
  disconnectedCallback() { cancelAnimationFrame(this._raf); this._raf = 0; }
  attributeChangedCallback(n) {
    if (!this._init) return;
    if (n === 'process') this._activate(this.getAttribute('process'), true); if (n === 'selected') this._applySelection(); if (n === 'theme') this._applyTheme();
  }
  invalidate() { this._dirty = true; }
  _resize() { this._dirty = true; const w = this.clientWidth || 1, h = this.clientHeight || 1; this.renderer.setSize(w, h, false); this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); }
  _applyTheme() { this._dirty = true; if (this.siteMode && this._init && this.root) setTimeout(() => this._buildSite(), 0);
    const dark = (this.getAttribute('theme') || 'dark') === 'dark';
    this.scene.background = this._gradientTex(dark ? ['#02040a', '#0a1324', '#1b2740'] : ['#6f93b8', '#a9c0d6', '#e9eef3', '#f6f1ea']);
    this.scene.fog = new THREE.Fog(dark ? 0x141a22 : 0xdfe6ec, 220, 520);
    this.ground.material.map = this._radialTex(dark ? ['#2a313a', '#191e25', '#0c1015'] : ['#f1eee8', '#cfd4da', '#a9b3bd']); this.ground.material.color.set(0xffffff); this.ground.material.needsUpdate = true;
    this._buildBackdrop(dark);
    this._gridOn = dark; this.grid.visible = dark && this.orbit.dist > 120; this.grid.material.color.set(dark ? 0x262d36 : 0xaeb6bf); this.grid.material.transparent = true; this.grid.material.opacity = 0.35;
    if (this.glow) this.glow.visible = false;
    if (this.skyline) this.skyline.visible = false;
    if (!this.nightSky) this._buildStars();
    this.nightSky.visible = dark;
    this.dark = dark; this._styleLabels();
  }
  // 다크모드 밤하늘: 큰 구 위쪽 반구에 별 점들 (안개 영향 없음)
  _buildStars() {
    const g = new THREE.Group(); g.name = 'STARS';
    const dot = (() => { const c = document.createElement('canvas'); c.width = c.height = 32; const x = c.getContext('2d'), gr = x.createRadialGradient(16, 16, 0, 16, 16, 16); gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = gr; x.fillRect(0, 0, 32, 32); return new THREE.CanvasTexture(c); })();
    [[1400, 2.2, 0.55], [260, 4, 0.85], [40, 6.5, 1]].forEach(([n, size, op]) => {
      const pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const th = Math.random() * Math.PI * 2, y = 0.06 + Math.pow(Math.random(), 0.8) * 0.94, r = Math.sqrt(1 - y * y), R = 780;
        pos.set([Math.cos(th) * r * R, y * R, Math.sin(th) * r * R], i * 3);
        const t = Math.random(); col.set(t < 0.15 ? [1, 0.88, 0.75] : t < 0.35 ? [0.78, 0.86, 1] : [1, 1, 1], i * 3);
      }
      const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.add(new THREE.Points(geo, new THREE.PointsMaterial({ size, map: dot, vertexColors: true, transparent: true, opacity: op, depthWrite: false, fog: false, sizeAttenuation: false })));
    });
    g.renderOrder = -1; this.nightSky = g; this.scene.add(g);
  }
  _styleLabels() {
    const id = this.getAttribute('selected');
    this.eqs.forEach(e => { const on = e.id === id, hov = e.id === this.hoverId; const ac = '#1a9bd7', act = on || hov; Object.assign(e.label.style, { color: act ? '#ffffff' : (this.dark ? '#dfe5ec' : '#1f262e'), opacity: act || !id ? '1' : '0.55', fontWeight: act ? '700' : '500', background: 'transparent', border: 'none', boxShadow: 'none', backdropFilter: 'none', textShadow: 'none' }); e.label.style.color = act ? ac : (this.dark ? '#ffffff' : '#1f262e'); const dot = e.label.querySelector('i'), n = this.eqs.length, k = this.eqs.indexOf(e), stepColor = `oklch(${(0.82 - 0.36 * (n > 1 ? k / (n - 1) : 0)).toFixed(3)} 0.14 230)`; dot.style.background = stepColor; dot.style.border = act ? '2px solid #ffffff' : 'none'; dot.style.boxShadow = act ? '0 0 10px ' + stepColor : 'none'; dot.style.width = act ? '10px' : '8px'; dot.style.height = act ? '10px' : '8px'; });
  }
  // 멀리 보이는 제철소 실루엣 + 불티
  _buildBackdrop(dark) {
    if (this.backdrop) { this.scene.remove(this.backdrop); }
    const g = new THREE.Group(); this.backdrop = g;
    const silM = new THREE.MeshBasicMaterial({ color: dark ? 0x0d131a : 0x7b8896, fog: true });
    const rnd = (() => { let x = 7; return () => (x = (x * 16807) % 2147483647) / 2147483647; })();
    for (let i = 0; i < 48; i++) {
      const a = rnd() * Math.PI * 2, r = 250 + rnd() * 60, w = 10 + rnd() * 26, h = 8 + rnd() * 28;
      const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 6 + rnd() * 10), silM); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); g.add(b);
      if (rnd() < 0.45) { const ch = 18 + rnd() * 26, c = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.3, ch, 8), silM); c.position.set(b.position.x + (rnd() - 0.5) * w, ch / 2, b.position.z); g.add(c);
        if (dark) { const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 6, 6), new THREE.MeshBasicMaterial({ color: 0xff5a2a })); lamp.position.set(c.position.x, ch + 0.4, c.position.z); g.add(lamp); } }
    }
    if (dark) {
      const n = 220, pos = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) pos.set([(rnd() - 0.5) * 400, 2 + rnd() * 40, (rnd() - 0.5) * 160], i * 3);
      const pg = new THREE.BufferGeometry(); pg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      this.embers = new THREE.Points(pg, new THREE.PointsMaterial({ color: 0xffa050, size: 0.35, transparent: true, opacity: 0.7, depthWrite: false })); g.add(this.embers);
      const glow = new THREE.Mesh(new THREE.CircleGeometry(220, 48), new THREE.MeshBasicMaterial({ color: 0xff6a20, transparent: true, opacity: 0.06, depthWrite: false, blending: THREE.AdditiveBlending }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = 0.03; g.add(glow);
    } else this.embers = null;
    {
      const N = dark; // 밤: 같은 풍경을 어두운 톤 + 달/창문 불빛으로
      // 멀리 두 번째 층의 더 연한 실루엣 (깊이감)
      const farM = new THREE.MeshBasicMaterial({ color: N ? 0x16202e : 0xb4c0cc, fog: true });
      for (let i = 0; i < 36; i++) { const a = rnd() * Math.PI * 2, r = 330 + rnd() * 50, w = 16 + rnd() * 36, h = 12 + rnd() * 44; const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, 10), farM); b.position.set(Math.cos(a) * r, h / 2, Math.sin(a) * r); g.add(b); }
      // 굴뚝 증기
      const steamM = new THREE.MeshBasicMaterial({ color: N ? 0x4a5568 : 0xffffff, transparent: true, opacity: N ? 0.35 : 0.55, depthWrite: false, fog: true });
      g.children.filter(o => o.geometry.type === 'CylinderGeometry').slice(0, 10).forEach(c => { for (let k = 0; k < 4; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(2.2 + k * 1.3, 10, 8), steamM); p.position.set(c.position.x + k * 2.5, c.position.y * 2 + 2 + k * 2.4, c.position.z + k * 1.2); g.add(p); } });
      // 잔디/풀: 설비 구역 바깥에 녹지 패치 + 풀 포기
      const grassM = new THREE.MeshBasicMaterial({ color: N ? 0x1e2b1c : 0x8fb06a, fog: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
      const grassM2 = new THREE.MeshBasicMaterial({ color: N ? 0x18241a : 0x7a9c58, fog: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
      for (let i = 0; i < 60; i++) {
        const w = 10 + rnd() * 26, d = 8 + rnd() * 20, gx = (rnd() - 0.5) * 420, gz = (rnd() < 0.5 ? -1 : 1) * (48 + rnd() * 60);
        const patch = new THREE.Mesh(new THREE.CircleGeometry(1, 18), rnd() < 0.5 ? grassM : grassM2);
        patch.scale.set(w, d, 1); patch.rotation.x = -Math.PI / 2; patch.rotation.z = rnd() * Math.PI; patch.position.set(gx, 0.03 + i * 0.002, gz); patch.renderOrder = 1 + i; g.add(patch);
      }
      const bladeM = new THREE.MeshBasicMaterial({ color: N ? 0x1f2f1d : 0x6f944f, side: THREE.DoubleSide, fog: true });
      const bladeGeo = new THREE.ConeGeometry(0.35, 1.6, 4);
      for (let i = 0; i < 900; i++) {
        const b = new THREE.Mesh(bladeGeo, bladeM);
        b.position.set((rnd() - 0.5) * 420, 0.8 + 0.09, (rnd() < 0.5 ? -1 : 1) * (50 + rnd() * 55)); b.rotation.y = rnd() * Math.PI; b.rotation.z = (rnd() - 0.5) * 0.5; b.scale.setScalar(0.6 + rnd() * 0.9); g.add(b);
      }
      // 나무 몇 그루 (줄기 + 둥근 수관)
      const trunkM = new THREE.MeshBasicMaterial({ color: N ? 0x1f1812 : 0x6b5340, fog: true }), leafM = new THREE.MeshBasicMaterial({ color: N ? 0x172617 : 0x5f8a4a, fog: true });
      for (let i = 0; i < 40; i++) {
        const h = 3 + rnd() * 3, x = (rnd() - 0.5) * 420, z = (rnd() < 0.5 ? -1 : 1) * (55 + rnd() * 50);
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.35, h, 6), trunkM); t.position.set(x, h / 2, z); g.add(t);
        const c = new THREE.Mesh(new THREE.SphereGeometry(1.8 + rnd() * 1.4, 8, 6), leafM); c.position.set(x, h + 1.2, z); c.scale.y = 1.2; g.add(c);
      }
      if (N) {
        // 달 + 달무리
        const moon = new THREE.Mesh(new THREE.CircleGeometry(11, 40), new THREE.MeshBasicMaterial({ color: 0xeef2f8, depthWrite: false, fog: false }));
        moon.position.set(-200, 140, -320); moon.lookAt(0, 20, 0); g.add(moon);
        const halo = new THREE.Mesh(new THREE.CircleGeometry(34, 40), new THREE.MeshBasicMaterial({ color: 0x8fa6c8, transparent: true, opacity: 0.12, depthWrite: false, fog: false, blending: THREE.AdditiveBlending }));
        halo.position.copy(moon.position).multiplyScalar(1.01); halo.lookAt(0, 20, 0); g.add(halo);
        // 공장 실루엣 창문 불빛
        const winM = new THREE.MeshBasicMaterial({ color: 0xffc56a, fog: false }), winG = new THREE.PlaneGeometry(1.4, 0.9);
        g.children.filter(o => o.geometry.type === 'BoxGeometry' && o.material === silM).forEach(b => { const p = b.geometry.parameters; const k = Math.floor(rnd() * 5); for (let q = 0; q < k; q++) { const w = new THREE.Mesh(winG, winM); w.position.set((rnd() - 0.5) * p.width * 0.8, (rnd() - 0.3) * p.height * 0.6, p.depth / 2 + 0.05); const sz = b.position.z > 0 ? -1 : 1; w.position.z = sz * (p.depth / 2 + 0.05); if (sz < 0) w.rotation.y = Math.PI; b.add(w); } });
      } else {
        // 태양 헤이즈
        const sun = new THREE.Mesh(new THREE.CircleGeometry(26, 40), new THREE.MeshBasicMaterial({ color: 0xfff3dc, transparent: true, opacity: 0.55, depthWrite: false, fog: false }));
        sun.position.set(-200, 120, -320); sun.lookAt(0, 20, 0); g.add(sun);
      }
    }
    this.scene.add(g);
  }
  _gradientTex(stops) { const c = document.createElement('canvas'); c.width = 4; c.height = 512; const g = c.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 512); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, 4, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _radialTex(stops) { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'), gr = g.createRadialGradient(256, 256, 20, 256, 256, 256); stops.forEach((s, i) => gr.addColorStop(i / (stops.length - 1), s)); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; }
  _buildAll() {
    this.zones = {}; this.labels.innerHTML = '';
    this.zoneLabels = [];
    PROCESSES.forEach((p, i) => this._buildZone(p, zoneX(i), i));
    this._activate(this.getAttribute('process') || PROCESSES[0].id, false);
    // 처음엔 4개 공정 전체 보기
    const pose = this._overviewPose(); this.orbit.yaw = pose.yaw; this.orbit.pitch = pose.pitch; this.orbit.dist = pose.dist; this.orbit.target.copy(pose.target);
  }
  _buildZone(p, ox, zi) {
    const z = { id: p.id, ox, root: new THREE.Group(), eqs: [], anchorMode: false, home: { yaw: -0.5, pitch: 0.36, dist: 48, target: [ox, 1.5, 0] }, ringScale: 1 };
    z.root.name = `PROCESS_${p.id}`;
    const n = p.equipment.length;
    p.equipment.forEach((e, i) => {
      const lx = n === 1 ? 0 : -15 + 30 * i / (n - 1), x = ox + lx;
      const g = equipmentPrimitive(e.shape); g.name = `EQ_${e.id}`; g.position.x = x; g.userData.id = e.id;
      g.traverse(o => { if (o.isMesh) { o.userData.eq = e.id; o.userData.base = o.material.emissive.getHex(); } });
      z.root.add(g);
      const box = new THREE.Box3().setFromObject(g);
      const lab = document.createElement('div');
      lab.innerHTML = `<i></i><span style="display:flex;flex-direction:column;gap:2px"><span style="display:flex;align-items:center;gap:8px"><b>${e.name}</b><code>${String(i + 1).padStart(2, '0')}</code></span><u></u></span>`;
      const tip = lab.querySelector('u'); tip.textContent = e.role; tip.style.cssText = 'text-decoration:none;display:block;font-size:11px;font-weight:400;opacity:0;max-height:0;overflow:hidden;white-space:normal;max-width:220px;line-height:1.4;color:inherit;transition:max-height .22s ease, opacity .22s ease';
      Object.assign(lab.style, { position: 'absolute', left: '0', top: '0', willChange: 'transform', display: 'none', alignItems: 'flex-start', gap: '8px', padding: '4px 6px', fontFamily: '"IBM Plex Sans KR", sans-serif', fontSize: '13px', fontWeight: '500', letterSpacing: '0.02em', lineHeight: '1', whiteSpace: 'nowrap', pointerEvents: 'auto', cursor: 'pointer', textShadow: '0 1px 6px rgba(0,0,0,.8)', transition: 'opacity .2s, transform .2s' });
      lab.querySelector('i').style.cssText = 'width:8px;height:8px;border-radius:0;flex:none;transform:rotate(45deg)'; lab.querySelector('code').style.cssText = 'font-family:"IBM Plex Mono",monospace;font-size:10px;opacity:.6';
      lab.onmouseenter = () => { this._hover(e.id); }; lab.onmouseleave = () => { this._hover(null); this._styleLabels(); if (this.dimmed) this.eqs.forEach(q => { if (q.id !== this.getAttribute('selected')) q.label.style.opacity = '0.2'; }); };
      lab.onclick = () => this._select(e.id, true);
      this.labels.appendChild(lab);
      const sz = box.getSize(new THREE.Vector3());
      z.eqs.push({ id: e.id, x, zone: p.id, data: e, anchor: new THREE.Vector3(x, box.max.y + 0.6, 0), focus: new THREE.Vector3(x, 2.5, 0), dist: 16, group: g, label: lab, interior: e.interior ? { cx: x, cz: 0, y0: box.min.y + 0.3, y1: box.max.y - 0.4, r: sz.x * 0.34 } : null });
    });
    const lg = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(ox - 18, 0.05, 3.2), new THREE.Vector3(ox + 18, 0.05, 3.2)]);
    const line = new THREE.Line(lg, new THREE.LineDashedMaterial({ color: 0x1a9bd7, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.5 })); line.computeLineDistances(); z.root.add(line);
    z.path = [new THREE.Vector3(ox - 18, 0, 3.2), ...z.eqs.map(e => new THREE.Vector3(e.x, 0, 3.2)), new THREE.Vector3(ox + 18, 0, 3.2)];
    z.states = [p.materialIn, ...p.equipment.map(e => e.materialOut)];
    z.root.visible = false; // GLB 확인 전까지 기본 도형 숨김
    this.scene.add(z.root);
    // 구역 타이틀 라벨 (클릭 → 그 공정으로 이동)
    const zl = document.createElement('button');
    zl.innerHTML = `<code>${p.num}</code><b>${p.name}</b><span>${p.en}</span>`;
    Object.assign(zl.style, { position: 'absolute', left: '0', top: '0', willChange: 'transform', display: 'flex', alignItems: 'baseline', gap: '8px', padding: '8px 14px', border: '1px solid rgba(255,255,255,.25)', borderRadius: '2px', background: 'rgba(8,12,18,.6)', color: '#fff', fontFamily: '"IBM Plex Sans KR", sans-serif', cursor: 'pointer', pointerEvents: 'auto', whiteSpace: 'nowrap', transition: 'opacity .25s, background .2s, border-color .2s' });
    zl.querySelector('code').style.cssText = 'font-family:"IBM Plex Mono",monospace;font-size:11px;opacity:.7'; zl.querySelector('b').style.cssText = 'font-size:16px;font-weight:700'; zl.querySelector('span').style.cssText = 'font-size:11px;opacity:.6';
    zl.onmouseenter = () => { zl.style.borderColor = '#1a9bd7'; zl.style.background = 'rgba(26,155,215,.35)'; }; zl.onmouseleave = () => this._styleZoneLabels();
    const go = (ev) => { ev.stopPropagation(); ev.preventDefault(); this.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: p.id }, bubbles: true, composed: true })); };
    zl.onpointerdown = go; zl.onpointerup = (ev) => ev.stopPropagation();
    zl.onclick = (ev) => ev.stopPropagation();
    this.labels.appendChild(zl); z.label = zl; z.labelPos = new THREE.Vector3(ox, 22, 0);
    this.zones[p.id] = z; this.zoneLabels.push(z);
    this._loadGLB(p, z);
  }
  _styleZoneLabels() { (this.zoneLabels || []).forEach(z => { const on = z.id === this.process?.id; z.label.style.borderColor = on ? '#1a9bd7' : 'rgba(255,255,255,.25)'; z.label.style.background = on ? '#1a9bd7' : (this.dark ? 'rgba(8,12,18,.6)' : 'rgba(255,255,255,.75)'); z.label.style.color = on ? '#fff' : (this.dark ? '#fff' : '#1f262e'); z.label.style.opacity = this.orbit.dist > 120 || !on ? '1' : '0'; z.label.style.pointerEvents = this.orbit.dist > 120 || !on ? 'auto' : 'none'; }); }
  // 공정 활성화: 해당 구역을 현재 작업 대상으로 바꾸고 카메라를 그 구역으로 이동
  _activate(id, fly) {
    const p = findProcess(id), z = this.zones?.[id]; if (!p || !z) return;
    if (this.touring) { this._tourId++; this._skip(); this.move = null; this.touring = false; this.tourStep = null; }
    this._showInterior(null); this._dimOthers(null);
    if (this.eqs) this.eqs.forEach(e => { e.label.style.display = 'none'; });
    this.process = p; this.zone = z; this.root = z.root; this.eqs = z.eqs; this.path = z.path; this.states = z.states; this.stops = z.stops; this.rail = z.rail; this.matScale = z.matScale; this.anchorMode = z.anchorMode; this.home = z.home; this.ring.scale.setScalar(z.ringScale);
    this.eqs.forEach(e => { e.label.style.display = z.root.visible ? 'flex' : 'none'; e._lx = null; });
    this.stop(); this._setMaterial(0, this.path[0]); this._emitProgress();
    this._applySelection(); this._styleZoneLabels();
    if (fly) this.reset();
    this._emitModel(z.modelStatus || 'loading', z.modelUrl || '', z.mapped || 0);
  }
  // models/<processId>.glb 가 있으면 기본 도형을 GLB 노드(EQ_<id>)로 교체
  async _loadGLB(p, z) {
    const url = new URL(`models/${p.id}.glb`, document.baseURI).href; z.modelUrl = url; z.modelStatus = 'loading';
    if (this.zone === z) this._emitModel('loading', url);
    let cfg = null;
    try { const all = await (await fetch(new URL('models/anchors.json', document.baseURI))).json(); cfg = all[p.id] || null; } catch (e) {}
    const done = (status, mapped) => { z.modelStatus = status; z.mapped = mapped; z.root.visible = true; if (this.zone === z) { this.eqs.forEach(e => { e.label.style.display = 'flex'; }); if (this.material) this.material.visible = true; this._emitModel(status, url, mapped); } this._dirty = true; };
    new GLTFLoader().load(url, (gltf) => {
      const model = gltf.scene; model.name = `GLB_${p.id}`;
      const sc = cfg?.scale ?? 1, off = new THREE.Vector3().fromArray(cfg?.offset || [0, 0, 0]).add(new THREE.Vector3(z.ox, 0, 0));
      model.scale.setScalar(sc); model.position.copy(off);
      model.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.userData.base = o.material.emissive ? o.material.emissive.getHex() : 0; } });
      const M = (a) => new THREE.Vector3().fromArray(a).multiplyScalar(sc).add(off);
      let mapped = 0;
      z.eqs.forEach(e => {
        const node = model.getObjectByName(`EQ_${e.id}`), a = cfg?.anchors?.[e.id];
        if (node) {
          node.traverse(o => { if (o.isMesh) o.userData.eq = e.id; });
          model.updateMatrixWorld(true);
          const box = new THREE.Box3().setFromObject(node), c = box.getCenter(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).length();
          e.group.visible = false; e.group = node; e.x = c.x; e.anchor.set(c.x, box.max.y + 0.6, c.z); e.focus.set(c.x, c.y, c.z); e.dist = Math.max(10, sz * 1.6); mapped++;
        } else if (a) {
          e.group.visible = false; e.group = new THREE.Group(); e.anchor.copy(M(a.label)); e.focus.copy(M(a.focus || a.label)); e.x = e.focus.x; e.dist = (a.dist ?? 40) * sc; mapped++;
          if (a.interior && e.data.interior) { const c = M([a.interior.center[0], 0, a.interior.center[1]]); e.interior = { cx: c.x, cz: c.z, y0: a.interior.y0 * sc + off.y, y1: a.interior.y1 * sc + off.y, r: a.interior.r * sc }; }
        }
      });
      if (!mapped) { done('glb-no-nodes', 0); return; }
      z.root.children.filter(c => c.isLine).forEach(l => z.root.remove(l));
      model.traverse(o => { o.matrixAutoUpdate = false; o.updateMatrix(); }); model.matrixAutoUpdate = false; model.updateMatrix();
      z.root.add(model); z.anchorMode = !!cfg?.anchors;
      z.path = cfg?.flow ? cfg.flow.map(M) : [z.eqs[0].focus.clone().add(new THREE.Vector3(-6, 0, 0)), ...z.eqs.map(e => e.focus.clone()), z.eqs[z.eqs.length - 1].focus.clone().add(new THREE.Vector3(6, 0, 0))];
      if (cfg?.home) { const t = cfg.home.target || [0, 1.5, 0]; z.home = { ...z.home, ...cfg.home, target: [t[0] + z.ox, t[1], t[2]] }; }
      z.ringScale = cfg?.ringScale ?? 1; z.stops = cfg?.stops || null; z.rail = !!cfg?.rail; z.matScale = cfg?.materialScale ?? 1;
      if (this.zone === z) { this.path = z.path; this.stops = z.stops; this.rail = z.rail; this.matScale = z.matScale; this.anchorMode = z.anchorMode; this.home = z.home; this.ring.scale.setScalar(z.ringScale); this.stop(); this._setMaterial(0, this.path[0]); this._applySelection(); }
      done('glb', mapped);
    }, undefined, () => done('primitive', 0));
  }
  _emitModel(status, url, mapped = 0) { this.dispatchEvent(new CustomEvent('steel-model', { detail: { status, url, mapped, process: this.process?.id }, bubbles: true, composed: true })); }
  _setMaterial(stateIdx, x) {
    if (this.matIdx !== stateIdx) {
      if (this.material) this.scene.remove(this.material);
      this.material = materialMesh(this.states[stateIdx]); this.material.name = 'MATERIAL'; this.material.scale.setScalar(this.matScale || 1); this.material._fresh = true; this.matBase = new THREE.Box3().setFromObject(this.material).min.y; this.material.visible = !!(this.zone && this.zone.root.visible); this.scene.add(this.material);
      this.matIdx = stateIdx;
    }
    this.material.position.copy(x); if (this.rail) this.material.position.y -= this.matBase || 0;
  }
  _stopPos(i) { return this.path[this._stopIdx(i)]; }
  _stopList() { return this.stops || this.path.map((_, i) => i); }
  _nStops() { return this.stops ? this.stops.length : this.path.length; }
  _stopIdx(i) { const S = this._stopList(); return S[Math.max(0, Math.min(i, S.length - 1))]; }
  // 경로 인덱스 a..b 구간을 실제 거리 기준으로 보간(레일 위 등속 이동)
  _along(a, b, u) {
    const P = this.path; if (a === b) return { pos: P[a].clone(), dir: new THREE.Vector3(1, 0, 0), seg: a, f: 0 };
    const L = []; let tot = 0; for (let i = a; i < b; i++) { const l = P[i].distanceTo(P[i + 1]); L.push(l); tot += l; }
    let d = Math.max(0, Math.min(1, u)) * tot, j = 0; while (j < L.length - 1 && d > L[j]) { d -= L[j]; j++; }
    const i = a + j, f = L[j] ? Math.min(1, d / L[j]) : 0;
    return { pos: new THREE.Vector3().lerpVectors(P[i], P[i + 1], f), dir: new THREE.Vector3().subVectors(P[i + 1], P[i]).normalize(), seg: i, f };
  }
  _orient(dir) {
    const m = this.material; m.rotation.order = 'YZX';
    const yaw = Math.atan2(-dir.z, dir.x), pitch = Math.atan2(dir.y, Math.hypot(dir.x, dir.z));
    if (m._fresh) { m.rotation.y = yaw; m.rotation.z = pitch; m._fresh = false; return; }
    let dy = yaw - m.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    m.rotation.y += dy * 0.12; m.rotation.z += (pitch - m.rotation.z) * 0.12;
  }
  _applySelection() { this._dirty = true;
    const id = this.getAttribute('selected');
    this.eqs.forEach(e => {
      const on = e.id === id;
      e.group.traverse(o => { if (o.isMesh && o.material.emissive) { o.material.emissive.setHex(on ? ACCENT : o.userData.base); o.material.emissiveIntensity = on ? 0.35 : (o.userData.base ? 0.6 : 0); } });
    });
    this._styleLabels();
    const sel = this.eqs.find(e => e.id === id);
    this._showInterior(sel && sel.interior ? sel : null);
    this._dimOthers(sel && sel.interior ? sel : null);
    this.ring.material.color.set(this.dark ? 0x1a9bd7 : 0x05507d); this.ring.visible = !!sel; if (sel) this.ring.position.set(sel.focus.x, 0.02 + (this.anchorMode ? 0.4 : 0), sel.focus.z);
  }
  // 선택된 설비 내부 단면(X-ray): data.js의 equipment.interior 레이어를 색깔 층으로 표시
  _typewrite(el, text, delay, speed, showEl) {
    const target = showEl || el; const t0 = setTimeout(() => { target.style.opacity = '1'; let i = 0; const tick = () => { if (!el.isConnected) return; el.textContent = text.slice(0, ++i) + (i < text.length ? '▍' : ''); if (i < text.length) this._timers.push(setTimeout(tick, speed)); }; tick(); }, delay);
    this._timers.push(t0);
  }
  _showInterior(e) { this._dirty = true;
    (this._timers || []).forEach(clearTimeout); this._timers = [];
    if (this.interior) { this.scene.remove(this.interior); this.interior = null; }
    (this.interiorLabels || []).forEach(l => l.remove()); this.interiorLabels = []; this.layerItems = []; this.pinnedLayer = null; if (this.activeLayer !== null && this.activeLayer !== undefined) this.dispatchEvent(new CustomEvent('steel-layer', { detail: { layer: null }, bubbles: true, composed: true })); this.activeLayer = null;
    if (!e) return;
    const { cx, cz, y0, y1, r } = e.interior, layers = e.data.interior, H = y1 - y0, layout = e.data.interiorLayout || 'stack';
    const g = new THREE.Group(); let y = y1, x = cx - r * 1.6;
    const W = r * 3.2, mat = (c, op = 0.9) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, depthTest: false });
    this.interiorSpan = layout === 'stack' || layout === 'stove' ? H : W;
    layers.forEach((L, idx) => {
      let m, mid, h = L.h * H, cardX;
      if (layout === 'bed') {            // 소결: 수평 이동 베드 — 왼쬭→오른쬭 구간
        const w = L.h * W, bh = H * 0.45; m = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh, r * 1.2), mat(L.color));
        m.position.set(x + w / 2, y0 + bh / 2, cz); mid = m.position.clone(); x += w;
        const rail = new THREE.Mesh(new THREE.BoxGeometry(w * 0.96, bh * 0.12, r * 1.3), mat(0x2a2f36, 0.95)); rail.position.set(mid.x, y0 - bh * 0.06, cz); rail.renderOrder = 10; g.add(rail);
        h = bh; cardX = mid.x;
      } else if (layout === 'chambers') { // 코크스: 좁은 탄화실이 나란히 — 연소실 벽은 사이사이 얇은 벽
        if (L.wall) {
          m = new THREE.Group(); const n = layers.filter(q => !q.wall).length, cw = W / n;
          for (let i = 0; i <= n; i++) { const wall = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.18, H, r * 1.5), mat(L.color)); wall.position.set(cx - W / 2 + i * cw, y0 + H / 2, cz); wall.renderOrder = 10; m.add(wall); }
          mid = new THREE.Vector3(cx, y1 + H * 0.08, cz);
        } else {
          const n = layers.filter(q => !q.wall).length, cw = W / n, i = layers.filter((q, k) => k < idx && !q.wall).length;
          m = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.74, H * 0.92, r * 1.4), mat(L.color)); m.position.set(cx - W / 2 + cw * (i + 0.5), y0 + H * 0.46, cz); mid = m.position.clone();
        }
        h = H; cardX = mid.x;
      } else if (layout === 'stove' && idx === 0) {   // 열풍로: 돔
        m = new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), mat(L.color)); m.position.set(cx, y - h, cz); mid = new THREE.Vector3(cx, y - h * 0.4, cz); y -= h;
      } else if (layout === 'stove' && idx === layers.length - 1) {   // 열풍로: 열풍 출구 관 (오른쬭으로)
        m = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.28, r * 0.28, r * 2.4, 16), mat(L.color)); m.rotation.z = Math.PI / 2; m.position.set(cx + r + r * 1.2, y0 + H * 0.12, cz); mid = m.position.clone();
        const arrow = new THREE.Mesh(new THREE.ConeGeometry(r * 0.45, r * 0.6, 16), mat(L.color)); arrow.rotation.z = -Math.PI / 2; arrow.position.set(cx + r + r * 2.6, y0 + H * 0.12, cz); arrow.renderOrder = 10; g.add(arrow);
      } else {                            // 기본: 수직 층 (고로 등)
        m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, 32), mat(L.color)); m.position.set(cx, y - h / 2, cz); mid = m.position.clone(); y -= h;
      }
      m.renderOrder = 10; m.traverse(o => { o.renderOrder = 10; }); g.add(m);
      // 온도 칩: 층 안쪽 중앙, 클릭 → 그 층으로 포커스 + 설명 등장
      const tl = document.createElement('button');
      tl.textContent = L.temp || '·';
      Object.assign(tl.style, { position: 'absolute', transform: 'translate(-50%,-50%)', fontFamily: '"IBM Plex Mono", monospace', fontSize: '13px', fontWeight: '700', letterSpacing: '0.04em', whiteSpace: 'nowrap', cursor: 'pointer', color: '#fff', background: 'rgba(8,12,18,.45)', border: '1px solid rgba(255,255,255,.35)', borderRadius: '2px', padding: '4px 10px', textShadow: '0 0 6px rgba(0,0,0,.9)', opacity: '0', transition: 'opacity .3s, transform .2s, background .2s, border-color .2s', pointerEvents: 'auto' });
      const horizL = layout === 'bed' || layout === 'chambers';
      tl._pos = horizL ? new THREE.Vector3(mid.x, mid.y + (idx % 2 ? -1 : 1) * h * 0.95, mid.z) : mid; tl._lead = horizL ? mid : null; this.labels.appendChild(tl); this.interiorLabels.push(tl);
      this._timers.push(setTimeout(() => { tl.style.opacity = '1'; }, 120 * idx + 200));
      // 마우스 올리면 바로 그 층 열기(설명 자동 표시), 클릭하면 고정
      tl.onmouseenter = () => { if (this.touring) return; clearTimeout(this._hoverT); if (this.activeLayer !== idx && this.pinnedLayer === null) this._hoverT = setTimeout(() => { this._focusLayer(idx, { hover: true }); }, 120); };
      tl.onmouseleave = () => { clearTimeout(this._hoverT); };
      // 설명 카드: 처음엔 숨김
      const card = document.createElement('div');
      card.innerHTML = `<i>×</i><em></em><b></b><span></span>${L.formula ? '<code></code>' : ''}`;
      Object.assign(card.style, { position: 'absolute', transform: 'translate(0,-50%)', display: 'none', flexDirection: 'column', gap: '5px', padding: '12px 14px 12px 16px', borderRadius: '2px', fontFamily: '"IBM Plex Sans KR", sans-serif', fontSize: '13px', lineHeight: '1.35', whiteSpace: 'nowrap', pointerEvents: 'none', color: '#f3f5f8', background: this.dark ? `linear-gradient(115deg, ${L.color}40 0%, ${L.color}00 55%), rgba(20,26,34,.82)` : `linear-gradient(115deg, ${L.color}30 0%, ${L.color}00 55%), rgba(255,255,255,.85)`, backdropFilter: 'blur(8px)', webkitBackdropFilter: 'blur(8px)', color: this.dark ? '#f3f5f8' : '#14202c', border: `1px solid ${L.color}66`, boxShadow: '0 10px 30px rgba(0,0,0,.18)', opacity: '0', transition: 'opacity .35s' });
      card.querySelector('em').style.cssText = `font-style:normal;font-family:"IBM Plex Mono",monospace;font-size:10px;letter-spacing:.16em;color:${L.color}`;
      const xb = card.querySelector('i'); xb.style.cssText = 'position:absolute;top:8px;right:10px;font-style:normal;font-size:18px;line-height:1;color:currentColor;opacity:.55;cursor:pointer;pointer-events:auto'; xb.onclick = (ev) => { ev.stopPropagation(); this.pinnedLayer = null; this._focusLayer(idx); };
      card.querySelector('b').style.cssText = 'font-size:18px;font-weight:700;letter-spacing:-0.01em;white-space:normal;line-height:1.3';
      card.querySelector('span').style.cssText = 'font-size:13px;color:inherit;opacity:.85;white-space:normal;line-height:1.6';
      const code = card.querySelector('code'); if (code) code.style.cssText = `font-family:"IBM Plex Mono",monospace;font-size:12px;color:${L.color};margin-top:2px`;
      const horiz = layout === 'bed' || layout === 'chambers';
      card._pos = horiz ? new THREE.Vector3(mid.x, y1 + H * 0.35, cz) : new THREE.Vector3(mid.x + r * 1.25, mid.y, cz);
      card._card = true; card._dock = true; Object.assign(card.style, { right: '22px', left: 'auto', top: '50%', transform: 'translateY(-50%)', width: 'min(340px, 38vw)', whiteSpace: 'normal', padding: '16px 18px 16px 20px', pointerEvents: 'auto' }); this.labels.appendChild(card); this.interiorLabels.push(card);
      this.layerItems.push({ L, m, tl, card, mid, h, idx });
      tl.onclick = (ev) => { ev.stopPropagation(); if (this.activeLayer === idx && this.pinnedLayer === idx) { this.pinnedLayer = null; this._focusLayer(idx); } else { this.pinnedLayer = idx; if (this.activeLayer !== idx) { this.activeLayer = null; this._focusLayer(idx); } } };
    });
    if (layout === 'stack') { const sh = new THREE.Mesh(new THREE.CylinderGeometry(r * 1.08, r * 1.08, H, 32, 1, true), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthTest: false })); sh.position.set(cx, (y0 + y1) / 2, cz); sh.renderOrder = 11; g.add(sh); }
    this.interior = g; this.scene.add(g);
  }
  _focusLayer(idx, opt = {}) { this._dirty = true; if (this.pinnedLayer === undefined) this.pinnedLayer = null;
    (this._timers || []).forEach(clearTimeout); this._timers = [];
    const same = this.activeLayer === idx; this.activeLayer = same ? null : idx;
    this.dispatchEvent(new CustomEvent('steel-layer', { detail: { layer: this.activeLayer }, bubbles: true, composed: true }));
    const e = this.eqs.find(q => q.id === this.getAttribute('selected'));
    this.layerItems.forEach(it => {
      const on = it.idx === this.activeLayer, none = this.activeLayer === null;
      const op = none || on ? 0.9 : 0.22; it.m.traverse(o => { if (o.isMesh) o.material.opacity = op; });
      it.tl.style.opacity = none || on ? '1' : '0.35';
      it.tl.style.transform = on ? 'translate(-50%,-50%) scale(1.35)' : 'translate(-50%,-50%)'; it.tl.style.zIndex = on ? '3' : '';
      it.tl.style.background = on ? it.L.color : 'rgba(8,12,18,.45)';
      it.tl.style.borderColor = on ? it.L.color : 'rgba(255,255,255,.35)';
      it.tl.style.color = on ? '#0b0f14' : '#fff';
      it.card.style.display = on ? 'flex' : 'none'; it.card.style.opacity = '0';
      if (on) {
        const em = it.card.querySelector('em'), b = it.card.querySelector('b'), sp = it.card.querySelector('span'), code = it.card.querySelector('code');
        em.textContent = ''; b.textContent = ''; sp.textContent = ''; if (code) code.textContent = '';
        this._timers.push(setTimeout(() => { it.card.style.opacity = '1'; }, 350));
        this._typewrite(em, `LAYER ${String(it.idx + 1).padStart(2, '0')} · ${it.L.temp || '온도 유지'}`, 400, 14);
        this._typewrite(b, it.L.label, 650, 20);
        this._typewrite(sp, e?.data.steps?.[it.idx]?.text || '', 650 + it.L.label.length * 20 + 160, 9);
        if (code) this._typewrite(code, it.L.formula, 650 + it.L.label.length * 20 + 160 + (e?.data.steps?.[it.idx]?.text || '').length * 9 + 160, 17);
      }
    });
    if (this.activeLayer !== null && e) {
      const it = this.layerItems[idx], r = e.interior.r;
      const H = e.interior.y1 - e.interior.y0, center = (e.interior.y0 + e.interior.y1) / 2, yaw = -0.2, S = this.interiorSpan || H;
      const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), horiz = S !== H;
      const dist = Math.max(S * (horiz ? 1.5 : 2.1), r * 7, 9);
      const tx = horiz ? e.interior.cx : it.mid.x;
      this._animateTo({ yaw, pitch: horiz ? 0.25 : 0.05, dist, target: new THREE.Vector3(tx, center + (horiz ? H * 0.4 : H * 0.06), it.mid.z).add(right.multiplyScalar(dist * 0.08)) });
      this.ring.visible = false;
    } else if (e) { this.focus(e.id); this.ring.visible = true; }
  }
  // 내부 단면 표시 중에는 나머지 장면을 흐리게(포커스 모드)
  _dimOthers(sel) { this._dirty = true;
    const dim = !!sel;
    const set = (o) => { if (!o.isMesh) return; if (!o.userData._m) o.userData._m = { t: o.material.transparent, op: o.material.opacity }; o.material.transparent = dim ? true : o.userData._m.t; o.material.opacity = dim ? 0.28 : o.userData._m.op; o.material.needsUpdate = true; };
    if (this.root) this.root.traverse(set);
    if (this.material) this.material.traverse(set);
    if (this.skyline) this.skyline.traverse(set);
    if (this.glow) this.glow.visible = !dim;
    if (this.stars) this.stars.material.opacity = dim ? 0.3 : 0.8;
    this.eqs.forEach(e => { if (dim && e !== sel) e.label.style.opacity = '0.2'; if (dim && e === sel) e.label.style.opacity = '0'; });
    if (this.interiorLabels) this.interiorLabels.forEach(l => l.style.zIndex = '2');
    this.dimmed = dim;
  }
  _hover(id) {
    if (this.hoverId === id) return; this.hoverId = id; this._dirty = true;
    const sel = this.getAttribute('selected'), accent = this.dark ? UI : '#1a9bd7';
    this.eqs.forEach(e => {
      const on = e.id === id && e.id !== sel;
      // 3D: 살짝 밝아지는 emissive + 바닥 점선 사각
      e.group.traverse(o => { if (o.isMesh && o.material.emissive && o.userData.eq) { const selOn = e.id === sel; o.material.emissive.setHex(selOn ? ACCENT : on ? 0x1a9bd7 : o.userData.base); o.material.emissiveIntensity = selOn ? 0.35 : on ? 0.22 : (o.userData.base ? 0.6 : 0); } });
      // 라벨: 밑줄·역할 툴팁
      const tip = e.label.querySelector('u');
      e.label.style.fontWeight = on ? '700' : '500';
      e.label.style.color = on ? accent : '';
      if (tip) { tip.style.maxHeight = on ? '40px' : '0'; tip.style.opacity = on ? '1' : '0'; }
      if (!this.dimmed) e.label.style.opacity = on || !sel || e.id === sel ? '1' : '0.55';
      if (on && !this.dimmed) this._styleLabels(); // keep selected styling
      if (on) { e.label.style.color = accent; e.label.querySelector('i').style.background = accent; }
    });
    if (this.hoverRing) this.hoverRing.visible = false;
    const e = this.eqs.find(q => q.id === id);
    if (e && e.id !== sel) { if (!this.hoverRing) { this.hoverRing = new THREE.Mesh(new THREE.RingGeometry(2.6, 2.75, 4), new THREE.MeshBasicMaterial({ color: 0x1a9bd7, side: THREE.DoubleSide, transparent: true, opacity: 0.7 })); this.hoverRing.rotation.x = -Math.PI / 2; this.hoverRing.rotation.z = Math.PI / 4; this.scene.add(this.hoverRing); } this.hoverRing.visible = true; this.hoverRing.position.set(e.focus.x, 0.03 + (this.anchorMode ? 0.4 : 0), e.focus.z); this.hoverRing.scale.setScalar(this.anchorMode ? (e.dist / 16) * 0.5 : 1); }
  }
  _select(id, user = false) { this.dispatchEvent(new CustomEvent('steel-select', { detail: { id, user }, bubbles: true, composed: true })); }
  _bindPointer() {
    const el = this.renderer.domElement; let down = null, moved = false;
    el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; moved = false; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
    el.addEventListener('pointermove', e => {
      if (!down) return; const dx = e.clientX - down.x, dy = e.clientY - down.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      this.orbit.yaw -= dx * 0.005; this.orbit.pitch = Math.min(1.3, Math.max(0.08, this.orbit.pitch + dy * 0.005)); down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', e => { if (down || !this.zoneLabels || this.orbit.dist <= 120) return; const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); const zid = this._zoneAt(v); (this.zoneLabels || []).forEach(z => { if (z.id === zid) { z.label.style.borderColor = '#1a9bd7'; z.label.style.background = 'rgba(26,155,215,.35)'; } }); if (zid !== this._hoverZone) { this._hoverZone = zid; if (!zid) this._styleZoneLabels(); } el.style.cursor = zid ? 'pointer' : 'grab'; });
    el.addEventListener('pointermove', e => { if (down || !this.root || this.anchorMode || this.orbit.dist > 120) return; const nowT = performance.now(); if (nowT - (this._lastHover || 0) < 90) return; this._lastHover = nowT; const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1); this.ray.setFromCamera(v, this.camera); const hit = this.ray.intersectObjects(this.root.children, true)[0]; let id = hit ? hit.object.userData.eq : null; if (hit && !id && this.anchorMode) { let best = null, bd = Infinity; this.eqs.forEach(q => { const d = q.focus.distanceTo(hit.point); if (d < bd) { bd = d; best = q; } }); if (best && bd < best.dist * 0.9) id = best.id; } this._hover(id); el.style.cursor = id ? 'pointer' : 'grab'; });
    el.addEventListener('pointerleave', () => this._hover(null));
    el.addEventListener('pointerup', e => {
      el.style.cursor = 'grab';
      if (down && !moved) {
        const r = el.getBoundingClientRect(); const v = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.ray.setFromCamera(v, this.camera);
        const zid = this._zoneAt(v); if (zid) { down = null; this.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: zid }, bubbles: true, composed: true })); return; }
        const hit = this.ray.intersectObjects(this.root.children, true)[0];
        let id = hit ? hit.object.userData.eq : null;
        if (hit && !id && this.anchorMode) { let best = null, bd = Infinity; this.eqs.forEach(q => { const d = q.focus.distanceTo(hit.point); if (d < bd) { bd = d; best = q; } }); if (best && bd < best.dist * 0.9) id = best.id; }
        if (id || !this.touring) this._select(id, true);
      }
      down = null;
    });
    el.addEventListener('wheel', e => { e.preventDefault(); this.orbit.dist = Math.min(90, Math.max(8, this.orbit.dist * (1 + e.deltaY * 0.001))); }, { passive: false });
  }
  _zoneAt(v) {
    if (this.orbit.dist <= 120 || !this.zoneLabels) return null;
    this.ray.setFromCamera(v, this.camera);
    const zs = this.zoneLabels.filter(z => z.root && z.root.visible);
    const hit = this.ray.intersectObjects(zs.map(z => z.root), true)[0];
    if (!hit) return null;
    let o = hit.object; while (o) { const z = zs.find(q => q.root === o); if (z) return z.id; o = o.parent; }
    return null;
  }
  _frame(now) {
    if (this.grid) { const g = this._gridOn !== false && this.orbit.dist > 120; if (this.grid.visible !== g) { this.grid.visible = g; this._dirty = true; } } const ov = this.orbit.dist > 120; if (ov !== this._isOverview) { this._isOverview = ov; if (ov) { this._showInterior(null); this.dispatchEvent(new CustomEvent('steel-overview', { bubbles: true, composed: true })); } }
    if (this.anim) { const k = Math.min(1, (now - this.anim.t0) / this.anim.dur), s = k * k * (3 - 2 * k);
      this.orbit.target.lerpVectors(this.anim.from.target, this.anim.to.target, s);
      this.orbit.yaw = this.anim.from.yaw + (this.anim.to.yaw - this.anim.from.yaw) * s; this.orbit.pitch = this.anim.from.pitch + (this.anim.to.pitch - this.anim.from.pitch) * s; this.orbit.dist = this.anim.from.dist + (this.anim.to.dist - this.anim.from.dist) * s;
      if (k >= 1) this.anim = null; }
    const o = this.orbit;
    this.camera.position.set(o.target.x + o.dist * Math.sin(o.yaw) * Math.cos(o.pitch), o.target.y + o.dist * Math.sin(o.pitch), o.target.z + o.dist * Math.cos(o.yaw) * Math.cos(o.pitch));
    if (this.nightSky) this.nightSky.position.set(this.camera.position.x, 0, this.camera.position.z);
    this.camera.lookAt(o.target);
    if (this.move) {
      const mv = this.move, k = Math.min(1, (now - mv.t0) / mv.dur), e = k * k * (3 - 2 * k);
      const ee = this.rail ? 0.5 - 0.5 * Math.cos(Math.PI * k) : e;
      const { pos, dir } = this._along(this._stopIdx(mv.from), this._stopIdx(mv.to), ee);
      if (mv.arc && !this.rail) pos.y += Math.sin(e * Math.PI) * mv.arc;
      this._setMaterial(k > 0.5 ? mv.state : mv.prevState, pos);
      if (this.material) { if (this.rail) this._orient(dir); else this.material.rotation.y += 0.02; }
      this.t = (mv.from + ee) / (this._nStops() - 1);
      if (now - (this.lastEmit || 0) > 120 || k >= 1) { this.lastEmit = now; this._emitProgress(); }
      if (k >= 1) { this.move = null; mv.resolve(); }
    }
    if (this.playing) {
      const t = Math.min(1, (now - this.playT0) / this.playDur); this.t = t;
      const segs = this._nStops() - 1, f = t * segs, i = Math.min(segs - 1, Math.floor(f)), u = f - i, ns = this.states.length;
      let x, dir, sIdx;
      if (this.rail) { const r = this._along(this._stopIdx(0), this._stopIdx(segs), t), S = this._stopList(); x = r.pos; dir = r.dir; let p = 0; for (let s2 = 1; s2 < S.length; s2++) if (S[s2] <= r.seg + r.f + 1e-6) p = s2; sIdx = Math.min(ns - 1, p); }
      else { x = this._along(this._stopIdx(i), this._stopIdx(i + 1), u).pos; sIdx = t >= 1 ? ns - 1 : Math.min(ns - 1, Math.max(0, Math.round(f - 0.5))); }
      this._setMaterial(sIdx, x);
      if (this.material) { if (this.rail) this._orient(dir); else this.material.rotation.y += 0.01; }
      if (t >= 1) this.playing = false;
      if (now - (this.lastEmit || 0) > 120 || !this.playing) { this.lastEmit = now; this._emitProgress(); }
    }
    const w = this.clientWidth, h = this.clientHeight, v = new THREE.Vector3();
    (this.zoneLabels || []).forEach(z => { v.copy(z.labelPos).project(this.camera); const py = (1 - v.y) / 2 * h; const vis = v.z < 1 && py > 70 + 44 && py < h - 150; const lx = Math.round((v.x + 1) / 2 * w), ly = Math.round((1 - v.y) / 2 * h); if (z._lx !== lx || z._ly !== ly || z._vis !== vis) { z._lx = lx; z._ly = ly; z._vis = vis; z.label.style.display = vis ? 'flex' : 'none'; if (vis) z.label.style.transform = `translate(${lx}px, ${ly}px) translate(-50%,-100%)`; } });
    if (this._zoomKey !== (this.orbit.dist > 120)) { this._zoomKey = this.orbit.dist > 120; this._styleZoneLabels(); }
    const far = this.orbit.dist > 120;
    this.eqs.forEach(e => { v.copy(e.anchor).project(this.camera); const vis = v.z < 1 && !far && (!this.zone || this.zone.root.visible); const lx = Math.round((v.x + 1) / 2 * w), ly = Math.round((1 - v.y) / 2 * h); if (e._lx !== lx || e._ly !== ly || e._vis !== vis) { e._lx = lx; e._ly = ly; e._vis = vis; e.label.style.display = vis ? 'flex' : 'none'; if (vis) e.label.style.transform = `translate(${lx - 7}px, ${ly}px) translate(0,-50%)`; } });
    (this.interiorLabels || []).forEach(l => { if (!l._pos || l._dock) return; if (l.style.display === 'none' && l._card) return; v.copy(l._pos).project(this.camera); const vis = v.z < 1; l.style.display = vis ? 'flex' : 'none'; if (vis) { let px = (v.x + 1) / 2 * w; if (l._card && l._up) { const cw = l.offsetWidth || 260; px = Math.min(Math.max(px - cw / 2, 8), w - cw - 8); l.style.transform = 'translate(0,-100%)'; } else if (l._card) { const cw = l.offsetWidth || 260, leftLimit = this.labels.dataset.leftLimit ? +this.labels.dataset.leftLimit : 8, rightLimit = w - 8; if (px + cw <= rightLimit) { l.style.transform = 'translate(0,-50%)'; } else { const alt = l._posL.clone().project(this.camera), lx = (alt.x + 1) / 2 * w; if (lx - cw >= leftLimit) { px = lx; l.style.transform = 'translate(-100%,-50%)'; } else { px = Math.min(Math.max(px - cw / 2, leftLimit), rightLimit - cw); l.style.transform = 'translate(0,-100%)'; const upv = l._pos.clone(); upv.y = (this.interiorTop ?? upv.y); } } } l.style.left = px + 'px'; l.style.top = ((1 - v.y) / 2 * h) + 'px'; } });
    if (this.embers) { const p = this.embers.geometry.attributes.position; for (let i = 0; i < p.count; i++) { let y = p.getY(i) + 0.012; if (y > 42) y = 2; p.setY(i, y); } p.needsUpdate = true; this._dirty = true; }
    if (this.ring.visible) this.ring.rotation.z += 0.01;
    if (this.hoverRing && this.hoverRing.visible) { this.hoverRing.rotation.z += 0.02; this._dirty = true; }
  }
  _emitProgress() { this.dispatchEvent(new CustomEvent('steel-progress', { detail: { t: this.t || 0, label: (this.states && this.states[this.matIdx]?.label) || '', playing: !!this.playing || !!this.touring, touring: !!this.touring, step: this.tourStep || null }, bubbles: true, composed: true })); }
  _emitTour(step) { this.tourStep = step; this.dispatchEvent(new CustomEvent('steel-tour', { detail: step, bubbles: true, composed: true })); this._emitProgress(); }
  _moveMaterial(from, to, dur, state, arc) { return new Promise(resolve => { this.move = { from, to, t0: performance.now(), dur, state, prevState: this.matIdx < 0 ? 0 : this.matIdx, arc, resolve }; }); }
  _wait(ms) { return new Promise((res) => { const tk = this._tourToken; const id = setTimeout(res, ms); this._tourWaits.push({ id, res }); }); }
  _skip() { (this._tourWaits || []).forEach(w => { clearTimeout(w.id); w.res(); }); this._tourWaits = []; if (this.move) { const mv = this.move; this.move = null; this._setMaterial(mv.state, this._stopPos(mv.to)); mv.resolve(); } }
  // 자동 시연: 설비마다 소재 이동 → 카메라 → 내부 층 순서대로 설명
  // 특정 설비 구간부터 시연 시작(진행 중이면 그 지점으로 점프)
  async jumpTo(k, speed = 1) {
    if (this.siteMode || !this.eqs.length) return false;
    if (this.touring) { (this._tourWaits || []).forEach(w => { clearTimeout(w.id); w.res(); }); if (this.move) { this.move.resolve(); this.move = null; } this.touring = false; }
    return this.tour(speed, k);
  }
  async tour(speed = 1, startAt = 0) {
    if (this.touring || this.siteMode || !this.eqs.length) return false;
    const token = ++this._tourId;
    try { return await this._tourBody(token, speed, startAt); }
    catch (err) { console.error('tour error', err); return false; }
    finally { if (token === this._tourId) { this.touring = false; this.tourStep = null; this.move = null; this._emitProgress(); this.dispatchEvent(new CustomEvent('steel-tour-end', { bubbles: true, composed: true })); } }
  }
  async _tourBody(token, speed, startAt = 0) {
    this.touring = true; this._tourWaits = []; this.playing = false;
    const sp = 1 / speed, total = this.eqs.reduce((n, e) => n + 1 + (e.interior && e.data.interior ? e.data.interior.length : 0), 0) + 2;
    let step = 0;
    this._select(null); this._setMaterial(0, this.path[0]); this.t = 0;
    if (startAt > 0) { step = 1 + startAt; this.matIdx = -1; this._setMaterial(startAt, this._stopPos ? this._stopPos(startAt) : this.path[startAt]); this.t = startAt / ((this._nStops ? this._nStops() : this.path.length) - 1); }
    else { this._emitTour({ i: ++step, total, title: this.process.name + ' 공정 자동 시연', text: this.process.summary, eq: null });
    this.reset(); await this._wait(4500 * sp); if (token !== this._tourId) return; }
    for (let k = startAt; k < this.eqs.length; k++) {
      const e = this.eqs[k];
      this._emitTour({ i: ++step, total, title: `${String(k + 1).padStart(2, '0')} ${e.data.name}`, text: e.data.role, eq: e.id });
      this._select(e.id); this.focus(e.id);
      await this._moveMaterial(k, k + 1, 3200 * sp, k + 1, 1.5); if (token !== this._tourId) return;
      await this._wait(3000 * sp); if (token !== this._tourId) return;
      if (e.interior && e.data.interior && this.layerItems?.length) {
        for (let L = 0; L < this.layerItems.length; L++) {
          const it = this.layerItems[L];
          this._emitTour({ i: ++step, total, title: it.L.temp ? `${e.data.name} · ${it.L.temp}` : `${e.data.name} · ${it.L.label}`, text: it.L.temp ? it.L.label : (e.data.steps?.[L]?.zone || ''), eq: e.id, layer: L });
          this.activeLayer = null; this._focusLayer(L);
          const ln = (it.L.label.length * 26) + ((e.data.steps?.[L]?.text || '').length * 12) + ((it.L.formula || '').length * 22);
          await this._wait(Math.max(5000, 3500 + ln) * sp); if (token !== this._tourId) return;
        }
        this.activeLayer = null; this.layerItems.forEach(it => { it.m.traverse(o => { if (o.isMesh) o.material.opacity = 0.9; }); it.tl.style.opacity = '1'; it.card.style.display = 'none'; it.tl.style.background = 'rgba(8,12,18,.45)'; it.tl.style.color = '#fff'; it.tl.style.transform = 'translate(-50%,-50%)'; it.tl.style.borderColor = 'rgba(255,255,255,.35)'; });
        this.focus(e.id); await this._wait(2200 * sp); if (token !== this._tourId) return;
      }
    }
    this._emitTour({ i: ++step, total, title: '완료', text: this.states[this.states.length - 1].label + ' → 다음 공정으로', eq: null });
    this._select(null); this.reset();
    await this._moveMaterial(this.eqs.length, this.eqs.length + 1, 3200 * sp, this.states.length - 1, 0); if (token !== this._tourId) return;
    await this._wait(3000 * sp);
    return true;
  }
  next() { if (this.touring) this._skip(); }
  stopTour() { if (!this.touring) return; this._tourId++; this._skip(); this.move = null; this.touring = false; this.tourStep = null; this._select(null); this.reset(); this.stop(); }
  setLeftLimit(px) { this.labels.dataset.leftLimit = String(px); }
  setNavWidth(px) { this.labels.dataset.navWidth = String(px); }
  // 공개 API
  play(speed = 1) { this.playing = true; this.t = 0; this.playT0 = performance.now(); this.playDur = (this._nStops() - 1) * 2600 / speed; this._setMaterial(0, this.path[0]); this._emitProgress(); return true; }
  stop() { if (this.touring) return this.stopTour(); this.playing = false; this.t = 0; this.matIdx = -1; this._emitProgress(); }
  toggle(speed) { (this.playing || this.touring) ? this.stop() : this.tour(speed); }
  focus(id) { const e = this.eqs.find(q => q.id === id); if (!e) return false; const inner = !!e.interior; this._animateTo({ yaw: inner ? -0.25 : -0.5, pitch: inner ? 0.12 : 0.35, dist: inner ? e.dist * 0.75 : e.dist, target: inner ? new THREE.Vector3(e.interior.cx, (e.interior.y0 + e.interior.y1) / 2, e.interior.cz) : e.focus.clone() }); return true; }
  // 왼쪽 네비(~260px)를 피해 남은 화면 중앙에 target이 오도록 카메라 target을 보정
  _navShift(pose) { const w = this.clientWidth || 1200, navPx = (+this.labels.dataset.navWidth || 260) + 30; const fovH = 2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(42) / 2) * this.camera.aspect); const worldPerPx = (2 * pose.dist * Math.tan(fovH / 2)) / w; const right = new THREE.Vector3(Math.cos(pose.yaw), 0, -Math.sin(pose.yaw)); return { ...pose, target: pose.target.clone().sub(right.multiplyScalar(navPx / 2 * worldPerPx)) }; }
  _overviewPose() { return this._navShift({ yaw: -0.35, pitch: 0.5, dist: 360, target: new THREE.Vector3(0, 4, 0) }); }
  overview() { this._showInterior(null); this._dimOthers?.(null); if (this.eqs) this.eqs.forEach(e => { e.label.style.display = 'none'; }); this._animateTo(this._overviewPose()); }
  reset() { if (this.eqs && this.zone?.root.visible) this.eqs.forEach(e => { e.label.style.display = 'flex'; }); this._animateTo(this._navShift({ yaw: this.home.yaw, pitch: this.home.pitch, dist: this.home.dist, target: new THREE.Vector3().fromArray(this.home.target) })); }
  _animateTo(to) { const d = this.orbit.target.distanceTo(to.target); this.anim = { t0: performance.now(), dur: Math.min(1800, 700 + d * 6), from: { yaw: this.orbit.yaw, pitch: this.orbit.pitch, dist: this.orbit.dist, target: this.orbit.target.clone() }, to }; }
}
customElements.define('steel-scene', SteelScene);

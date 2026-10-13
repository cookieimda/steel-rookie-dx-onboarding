// 이해도 확인 오버레이의 캐릭터(<cp-character>). 설계: docs/checkpoint-overlay.md '캐릭터 모듈'
// - 입력은 속성뿐이다: motion(동작 이름표), model(GLB 주소), fallback(대체 이미지 주소, 선택).
//   체크포인트 로직(checkpoint-chat.js)은 이름표(vals()의 cpCharacterMotion)만 내고, 모델·클립·이미지는 여기서만 다룬다.
// - GltfRenderer: 모델에 이름표와 같은 이름의 애니메이션 클립이 있으면 클립을, 없으면 몸 전체 움직임(poseAt)을 쓴다.
//   그래서 뼈대·클립이 있는 모델로 바꿔도 클립 이름만 이름표에 맞추면 코드는 그대로다.
// - ImageRenderer: 모델 로드 실패·시간 초과·WebGL 없음일 때만. fallback 이미지 한 장, 없거나 못 읽으면 기본 실루엣. 움직이지 않는다.
// - 크기는 노드 변환을 포함한 바운딩 박스(Box3.setFromObject)로 맞춘다(quantize한 모델은 배율·위치가 노드에 있다).
// - 화면에 안 보이면 그리기를 멈추고, 엘리먼트가 빠지면 정리한다. prefers-reduced-motion이면 움직이지 않는다.
// - 이벤트: cp-character-ready { renderer: 'gltf' | 'image', clips }, cp-character-fallback { reason }.

/** 동작 이름표(checkpoint-chat.js의 motionFor·characterMotion이 내는 값). */
export const MOTIONS = ['idle', 'greet', 'ask', 'ask_again', 'praise', 'explain', 'encourage', 'thinking', 'celebrate', 'cheer_retry', 'sorry'];

/**
 * 몸 전체 움직임(뼈대 없음). t는 동작을 시작한 뒤 초. 단위는 모델 높이 1 기준.
 * duration이 있으면 한 번 하고 끝난다(hold면 마지막 자세 유지, 아니면 idle로 돌아감). 없으면 반복.
 */
const TAU = Math.PI * 2;
const ease = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));
export const PROCEDURAL = {
  // 대기: 위아래 흔들림
  idle: { pose: (t) => ({ y: 0.015 * Math.sin((TAU * t) / 2.2) }) },
  // 통통 튀기: 두 번 튀고 착지
  praise: { duration: 0.9, pose: (t) => { const k = Math.abs(Math.sin((Math.PI * t) / 0.45)); return { y: 0.1 * k, sy: 1 + 0.04 * k }; } },
  // 갸웃 기울기: 옆으로 기울인 채 유지
  ask_again: { duration: 0.45, hold: true, pose: (t) => ({ rz: 0.2 * ease(t / 0.45) }) },
  // 좌우 흔들기
  explain: { pose: (t) => ({ ry: 0.22 * Math.sin((TAU * t) / 1.6), rz: 0.03 * Math.sin((TAU * t) / 1.6) }) },
  // 점프 + 한 바퀴 회전
  celebrate: { duration: 0.9, pose: (t) => ({ y: 0.3 * Math.sin((Math.PI * t) / 0.9), ry: TAU * ease(t / 0.9) }) },
  // 천천히 기울기
  thinking: { pose: (t) => ({ rz: 0.08 * Math.sin((TAU * t) / 3.2), rx: 0.04 }) },
};

/** 몸 전체 움직임이 따로 없는 이름표의 대체(docs/checkpoint-overlay.md 미정 사항 6, 제안값). */
export const MOTION_ALIAS = { greet: 'praise', ask: 'idle', encourage: 'explain', cheer_retry: 'praise', sorry: 'thinking' };

const REST = { y: 0, rx: 0, ry: 0, rz: 0, sy: 1 };

/**
 * 동작을 어떻게 보일지 정한다. 1) 같은 이름의 클립 2) 그 이름의 몸 전체 움직임 3) 대체 이름표의 몸 전체 움직임 4) idle.
 * @param {string} motion 이름표
 * @param {string[]} clipNames 모델의 애니메이션 클립 이름
 * @returns {{ kind: 'clip' | 'procedural', name: string }}
 */
export function resolveMotion(motion, clipNames = []) {
  if (motion && clipNames.includes(motion)) return { kind: 'clip', name: motion };
  if (PROCEDURAL[motion]) return { kind: 'procedural', name: motion };
  const alias = MOTION_ALIAS[motion];
  if (alias && PROCEDURAL[alias]) return { kind: 'procedural', name: alias };
  return { kind: 'procedural', name: 'idle' };
}

/**
 * 몸 전체 움직임의 t초 자세 { y, rx, ry, rz, sy }. 한 번 하는 동작이 끝나면 hold는 마지막 자세, 아니면 idle(끝난 뒤 시간 기준).
 * reducedMotion이면 항상 기본 자세.
 */
export function poseAt(name, t, { reducedMotion = false } = {}) {
  if (reducedMotion) return { ...REST };
  const m = PROCEDURAL[name] ?? PROCEDURAL.idle;
  if (m.duration != null && t >= m.duration) {
    if (m.hold) return { ...REST, ...m.pose(m.duration) };
    return { ...REST, ...PROCEDURAL.idle.pose(t - m.duration) };
  }
  return { ...REST, ...m.pose(Math.max(0, t)) };
}

/** 두 자세 사이 보간(동작이 바뀔 때 튀지 않게). */
export function blendPose(a, b, k) {
  const w = ease(k);
  return Object.fromEntries(Object.keys(REST).map((key) => [key, a[key] + (b[key] - a[key]) * w]));
}

const BLEND_SECONDS = 0.2;
const LOAD_TIMEOUT_MS = 15000;
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
const LOADER_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
const ROOM_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/environments/RoomEnvironment.js/+esm';

/** 기본 실루엣(모델·이미지 모두 없을 때). 둥근 머리·귀·몸. */
const SILHOUETTE = `<svg viewBox="0 0 100 120" role="img" aria-label="튜터" xmlns="http://www.w3.org/2000/svg">
  <g fill="currentColor"><circle cx="24" cy="18" r="11"/><circle cx="76" cy="18" r="11"/><ellipse cx="50" cy="44" rx="36" ry="32"/>
  <rect x="28" y="70" width="44" height="34" rx="16"/><rect x="18" y="74" width="14" height="22" rx="7"/><rect x="68" y="74" width="14" height="22" rx="7"/>
  <rect x="32" y="98" width="14" height="18" rx="7"/><rect x="54" y="98" width="14" height="18" rx="7"/></g></svg>`;

/** 대체 렌더러: 이미지 한 장 또는 실루엣. 움직이지 않는다. */
class ImageRenderer {
  constructor(root, fallbackUrl) { this.root = root; this.fallbackUrl = fallbackUrl; this.kind = 'image'; }
  async load() {
    const box = document.createElement('div');
    box.className = 'image';
    const silhouette = () => { box.innerHTML = SILHOUETTE; };
    if (this.fallbackUrl) {
      const img = document.createElement('img');
      img.alt = '튜터';
      img.src = this.fallbackUrl;
      img.onerror = silhouette;
      box.append(img);
    } else silhouette();
    this.root.append(box);
    this.box = box;
  }
  play() {}
  setVisible() {}
  resize() {}
  dispose() { this.box?.remove(); }
}

/** 3D 렌더러: 클립이 있으면 클립, 없으면 몸 전체 움직임. scene_v3.js와 별도의 캔버스·WebGL 렌더러를 쓴다. */
class GltfRenderer {
  constructor(root, modelUrl, { reducedMotion }) {
    this.root = root; this.modelUrl = modelUrl; this.reducedMotion = reducedMotion; this.kind = 'gltf';
    this.clips = []; this.visible = true; this.raf = 0; this.disposed = false; this.ready = false;
    this.motion = { kind: 'procedural', name: 'idle' }; this.started = 0; this.from = { ...REST }; this.last = { ...REST };
  }

  async load() {
    const [THREE, { GLTFLoader }, { RoomEnvironment }] = await Promise.all([import(THREE_URL), import(LOADER_URL), import(ROOM_URL)]);
    if (this.disposed) return;
    this.THREE = THREE;
    const canvas = document.createElement('canvas');
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true }); // WebGL이 없으면 여기서 예외 → 대체
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer = renderer;

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a96a3, 1.2));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    key.position.set(1.5, 3, 4);
    scene.add(key);
    this.scene = scene;

    const gltf = await new GLTFLoader().loadAsync(this.modelUrl);
    if (this.disposed) { this.disposeScene(gltf.scene); return; }
    const model = gltf.scene;
    // 환경광 반사가 강하면 흰 표면이 금속처럼 보여서 줄인다.
    model.traverse((o) => { if (o.isMesh) for (const m of [o.material].flat()) if ('envMapIntensity' in m) m.envMapIntensity = 0.45; });
    // 크기: 노드 변환을 포함한 바운딩 박스로 높이 1, 발 중앙을 원점에.
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(1 / (size.y || 1));
    const fitted = new THREE.Box3().setFromObject(model);
    const center = fitted.getCenter(new THREE.Vector3());
    model.position.sub(new THREE.Vector3(center.x, fitted.min.y, center.z));
    // 몸 전체 움직임은 감싼 그룹에 적용한다(기준점 = 발 중앙).
    const body = new THREE.Group();
    body.add(model);
    scene.add(body);
    this.body = body;

    this.clips = gltf.animations.map((c) => c.name);
    if (gltf.animations.length) {
      this.mixer = new THREE.AnimationMixer(model);
      this.actions = Object.fromEntries(gltf.animations.map((c) => [c.name, this.mixer.clipAction(c)]));
    }

    this.camera = new THREE.PerspectiveCamera(30, 1, 0.05, 50);
    this.camera.position.set(0, 0.55, 2.7);
    this.camera.lookAt(0, 0.48, 0);
    this.clock = new THREE.Clock();
    this.root.append(canvas);
    this.canvas = canvas;
    // 여기까지 와야 그릴 수 있다. 불러오는 중에 motion·크기가 바뀌어도(play·resize) 그리지 않고 기다린다.
    this.ready = true;
    this.resize();
    this.tick();
  }

  play(name) {
    // 움직임 줄이기 설정이면 클립도 쓰지 않고 기본 자세로 둔다.
    const next = this.reducedMotion ? { kind: 'procedural', name: 'idle' } : resolveMotion(name, this.clips);
    if (next.kind === this.motion.kind && next.name === this.motion.name) return;
    const prevAction = this.motion.kind === 'clip' ? this.actions[this.motion.name] : null;
    this.from = this.last;
    this.started = this.clock?.elapsedTime ?? 0;
    this.motion = next;
    if (next.kind === 'clip') {
      const action = this.actions[next.name];
      action.reset().play();
      if (prevAction) prevAction.crossFadeTo(action, 0.25, false);
    } else if (prevAction) prevAction.fadeOut(0.25);
    this.tick();
  }

  tick = () => {
    cancelAnimationFrame(this.raf);
    if (this.disposed || !this.ready || !this.visible) return;
    // getElapsedTime()은 내부에서 getDelta()를 불러 dt를 0으로 만들므로 getDelta()만 부르고 elapsedTime을 읽는다.
    const dt = this.clock.getDelta();
    const now = this.clock.elapsedTime;
    this.mixer?.update(dt);
    const t = now - this.started;
    // 클립을 쓰는 동안 몸 전체 움직임은 기본 자세로 돌린다.
    const target = this.motion.kind === 'clip' ? { ...REST } : poseAt(this.motion.name, t, { reducedMotion: this.reducedMotion });
    const pose = t < BLEND_SECONDS ? blendPose(this.from, target, t / BLEND_SECONDS) : target;
    this.last = pose;
    this.body.position.y = pose.y;
    this.body.rotation.set(pose.rx, pose.ry, pose.rz);
    this.body.scale.set(1, pose.sy, 1);
    this.renderer.render(this.scene, this.camera);
    // 움직임 줄이기 설정이면 한 번만 그린다.
    if (!this.reducedMotion) this.raf = requestAnimationFrame(this.tick);
  };

  setVisible(visible) {
    this.visible = visible;
    if (visible && this.ready) { this.clock.getDelta(); this.tick(); } else cancelAnimationFrame(this.raf);
  }

  resize() {
    if (!this.ready) return;
    const w = this.root.clientWidth || 220, h = this.root.clientHeight || 260;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.tick();
  }

  disposeScene(object) {
    object?.traverse?.((o) => {
      o.geometry?.dispose?.();
      for (const m of [o.material].flat().filter(Boolean)) {
        for (const v of Object.values(m)) if (v?.isTexture) v.dispose();
        m.dispose?.();
      }
    });
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.mixer?.stopAllAction();
    this.disposeScene(this.scene);
    this.scene?.environment?.dispose?.();
    this.renderer?.dispose();
    this.canvas?.remove();
  }
}

const STYLE = `
  :host { display:block; position:relative; width:220px; height:260px; color:#93a0b0; }
  canvas, .image { position:absolute; inset:0; width:100%; height:100%; display:block; }
  .image { display:flex; align-items:flex-end; justify-content:center; }
  .image img, .image svg { max-width:100%; max-height:100%; object-fit:contain; }
`;

const Base = globalThis.HTMLElement ?? class {};

/** <cp-character motion="ask" model="models/character/tutor.glb" fallback="images/character/idle.png"> */
export class CpCharacter extends Base {
  static observedAttributes = ['motion', 'model', 'fallback'];

  connectedCallback() {
    if (!this.shadowRoot) {
      this.attachShadow({ mode: 'open' }).innerHTML = `<style>${STYLE}</style><div class="stage" part="stage" style="position:absolute;inset:0"></div>`;
    }
    this.stage = this.shadowRoot.querySelector('.stage');
    this.resizeObserver = new ResizeObserver(() => this.renderer?.resize());
    this.resizeObserver.observe(this);
    // 화면에 안 보이면(오버레이가 닫힘·스크롤 밖) 그리기를 멈춘다.
    this.visibilityObserver = new IntersectionObserver(([e]) => this.renderer?.setVisible(e.isIntersecting));
    this.visibilityObserver.observe(this);
    this.mount();
  }

  disconnectedCallback() {
    this.resizeObserver?.disconnect();
    this.visibilityObserver?.disconnect();
    this.renderer?.dispose();
    this.renderer = null;
  }

  attributeChangedCallback(name, oldValue, value) {
    if (oldValue === value || !this.isConnected || !this.stage) return;
    if (name === 'motion') this.renderer?.play(value || 'idle');
    else this.mount();
  }

  /** 현재 렌더러 종류('gltf' | 'image')와 모델 클립 이름. 개발자 확인용. */
  get rendererKind() { return this.renderer?.kind ?? null; }
  get clips() { return this.renderer?.clips ?? []; }

  async mount() {
    this.renderer?.dispose();
    const token = (this.mountToken = {});
    const reducedMotion = !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const model = this.getAttribute('model');
    let reason = model ? null : 'no-model';
    if (model) {
      const r = new GltfRenderer(this.stage, model, { reducedMotion });
      this.renderer = r;
      try {
        let timer;
        await Promise.race([r.load(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), LOAD_TIMEOUT_MS); })])
          .finally(() => clearTimeout(timer));
        if (token !== this.mountToken || !this.isConnected) return;
        r.play(this.getAttribute('motion') || 'idle');
        this.setAttribute('data-renderer', 'gltf');
        this.dispatchEvent(new CustomEvent('cp-character-ready', { detail: { renderer: 'gltf', clips: r.clips } }));
        return;
      } catch (e) {
        r.dispose();
        if (token !== this.mountToken) return;
        reason = e?.message || 'load-failed';
      }
    }
    const img = new ImageRenderer(this.stage, this.getAttribute('fallback'));
    this.renderer = img;
    await img.load();
    this.setAttribute('data-renderer', 'image');
    this.dispatchEvent(new CustomEvent('cp-character-fallback', { detail: { reason } }));
    this.dispatchEvent(new CustomEvent('cp-character-ready', { detail: { renderer: 'image', clips: [] } }));
  }
}

if (globalThis.customElements && !customElements.get('cp-character')) customElements.define('cp-character', CpCharacter);

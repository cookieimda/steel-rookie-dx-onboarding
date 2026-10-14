// 포석호(이해도 확인 캐릭터) 얼굴·감정 연출. cp-character.js가 쓴다.
// - 모델(AI로 만든 tutor.glb)의 눈·코·입은 표면에 새겨져 있어 울퉁불퉁하고 표정을 바꿀 수 없다.
//   그래서 얼굴 위에 머리 표면을 따라 매끈하게 편 판(buildFacePlate)을 덮고, 그 위에 눈·코·입을 그린다(drawFace).
// - 표정은 동작 이름표로 정한다(EXPRESSION_BY_MOTION). 바뀌면 바로 다시 그리고, 대기 표정에서는 가끔 눈을 깜빡인다.
// - 감정 배경(MOOD_BY_MOTION)은 캐릭터 뒤 효과 층(cp-character.js의 .fx)에 쓴다.
// - 브라우저 없이 불러와도 되게, 캔버스·three는 인자로 받는다.

/** 동작 이름표 → 얼굴 표정. */
export const EXPRESSION_BY_MOTION = {
  idle: 'neutral', ask: 'neutral', explain: 'neutral',
  greet: 'happy', praise: 'happy',
  celebrate: 'excited',
  encourage: 'determined', cheer_retry: 'determined',
  ask_again: 'curious', thinking: 'thinking',
  sorry: 'sad',
};
export const EXPRESSIONS = ['neutral', 'happy', 'excited', 'determined', 'curious', 'thinking', 'sad'];
/** 깜빡이는 표정(눈을 감고 웃는 표정은 깜빡이지 않는다). */
export const BLINKING = new Set(['neutral', 'determined', 'curious', 'thinking', 'sad']);

/** 동작 이름표 → 배경 감정(없으면 효과 없음). */
export const MOOD_BY_MOTION = {
  greet: 'joy', praise: 'joy',
  celebrate: 'celebrate',
  encourage: 'hope', cheer_retry: 'hope',
  sorry: 'sad',
  ask_again: 'think', thinking: 'think',
};
export const MOODS = ['joy', 'celebrate', 'hope', 'sad', 'think'];

/** 감정이 바뀌는 순간 몸이 '톡' 커졌다 돌아오는 동작(초·크기). */
export const POP = { seconds: 0.28, scale: 0.14 };
export const POP_MOTIONS = new Set(['greet', 'praise', 'celebrate', 'encourage', 'cheer_retry', 'sorry', 'ask_again']);
export const popAt = (t) => (t >= 0 && t < POP.seconds ? 1 + POP.scale * Math.sin((Math.PI * t) / POP.seconds) : 1);

const INK = '#2b2622';
/** 이목구비 배율(얼굴 판 가운데 기준). */
export const FEATURE_SCALE = 1.22;

/**
 * 얼굴을 그린다(512×512, 얼굴 판의 uv와 같은 좌표). 가운데는 피부색으로 덮고 가장자리는 흐리게 해 머리와 이어지게 한다.
 * @param {CanvasRenderingContext2D} ctx
 * @param {{ expression: string, blink?: boolean, skin?: string }} o
 */
export function drawFace(ctx, { expression = 'neutral', blink = false, skin = '#eeeeec' }) {
  const S = 512, cx = 256;
  ctx.clearRect(0, 0, S, S);
  // 피부: 새겨진 눈·코·입을 덮는 부분(불투명) → 가장자리로 갈수록 투명.
  ctx.save();
  ctx.translate(cx, 256);
  ctx.scale(1, 0.96);
  const g = ctx.createRadialGradient(0, 0, 185, 0, 0, 254);
  g.addColorStop(0, skin);
  g.addColorStop(1, `${skin}00`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 252, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  const eyeY = 172, eyeDX = 112, noseY = 240, mouthY = 306;
  // 이목구비는 머리에 비해 크게(감정이 잘 보이게) 그린다. 피부 덮개는 그대로 두고 이목구비만 키운다.
  ctx.save();
  ctx.translate(cx, 240);
  ctx.scale(FEATURE_SCALE, FEATURE_SCALE);
  ctx.translate(-cx, -240);
  const line = (w) => { ctx.strokeStyle = INK; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };
  const blush = (alpha) => {
    for (const s of [-1, 1]) {
      const b = ctx.createRadialGradient(cx + s * 168, 262, 4, cx + s * 168, 262, 46);
      b.addColorStop(0, `rgba(255,140,150,${alpha})`);
      b.addColorStop(1, 'rgba(255,140,150,0)');
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.ellipse(cx + s * 168, 262, 52, 34, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  };
  const ovalEye = (x, y, { rx = 30, ry = 37, lookX = 0, lookY = 0 } = {}) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x - rx * 0.32 + lookX, y - ry * 0.38 + lookY, rx * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + rx * 0.3 + lookX, y + ry * 0.3 + lookY, rx * 0.15, 0, Math.PI * 2);
    ctx.fill();
  };
  const closedEye = (x, y) => { line(11); ctx.beginPath(); ctx.moveTo(x - 26, y + 2); ctx.quadraticCurveTo(x, y + 12, x + 26, y + 2); ctx.stroke(); };
  const happyEye = (x, y, w = 30) => { line(12); ctx.beginPath(); ctx.moveTo(x - w, y + 10); ctx.quadraticCurveTo(x, y - 26, x + w, y + 10); ctx.stroke(); };
  const brow = (x, y, tilt) => { line(10); ctx.beginPath(); ctx.moveTo(x - 30, y + tilt); ctx.lineTo(x + 30, y - tilt); ctx.stroke(); };
  const nose = () => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.ellipse(cx, noseY, 17, 11, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.beginPath();
    ctx.ellipse(cx - 5, noseY - 4, 6, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
  };
  const catMouth = (open = 0) => {
    line(9);
    ctx.beginPath();
    ctx.moveTo(cx, noseY + 10);
    ctx.lineTo(cx, mouthY - 22);
    ctx.moveTo(cx - 38, mouthY - 26);
    ctx.quadraticCurveTo(cx - 18, mouthY - 6 + open, cx, mouthY - 22);
    ctx.quadraticCurveTo(cx + 18, mouthY - 6 + open, cx + 38, mouthY - 26);
    ctx.stroke();
  };
  const openMouth = (w, h) => {
    ctx.fillStyle = '#5a2a2a';
    ctx.beginPath();
    ctx.moveTo(cx - w, mouthY - 24);
    ctx.quadraticCurveTo(cx, mouthY - 24 + h * 2, cx + w, mouthY - 24);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ff8f9a';
    ctx.beginPath();
    ctx.ellipse(cx, mouthY - 24 + h * 0.75, w * 0.5, h * 0.32, 0, 0, Math.PI * 2);
    ctx.fill();
    line(8);
    ctx.beginPath();
    ctx.moveTo(cx, noseY + 10);
    ctx.lineTo(cx, mouthY - 24);
    ctx.stroke();
  };
  const eyes = (opts) => {
    for (const s of [-1, 1]) {
      if (blink && BLINKING.has(expression)) closedEye(cx + s * eyeDX, eyeY + 6);
      else ovalEye(cx + s * eyeDX, eyeY, typeof opts === 'function' ? opts(s) : opts);
    }
  };

  switch (expression) {
    case 'happy':
      blush(0.55);
      for (const s of [-1, 1]) happyEye(cx + s * eyeDX, eyeY + 4);
      nose();
      openMouth(42, 30);
      break;
    case 'excited':
      blush(0.75);
      for (const s of [-1, 1]) happyEye(cx + s * eyeDX, eyeY, 34);
      // 반짝이
      ctx.fillStyle = '#ffd34d';
      for (const [x, y, r] of [[cx - 196, 110, 16], [cx + 200, 120, 13], [cx + 172, 70, 9]]) {
        ctx.beginPath();
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI / 4) * i, rr = i % 2 ? r * 0.38 : r;
          ctx.lineTo(x + rr * Math.cos(a), y + rr * Math.sin(a));
        }
        ctx.fill();
      }
      nose();
      openMouth(56, 42);
      break;
    case 'determined':
      blush(0.35);
      eyes({ rx: 25, ry: 30 });
      for (const s of [-1, 1]) brow(cx + s * eyeDX, eyeY - 52, s * 9);
      nose();
      catMouth(10);
      break;
    case 'curious':
      blush(0.3);
      eyes((s) => (s < 0 ? { rx: 24, ry: 28 } : { rx: 30, ry: 37 }));
      brow(cx - eyeDX, eyeY - 48, 0);
      line(10);
      ctx.beginPath();
      ctx.moveTo(cx + eyeDX - 30, eyeY - 52);
      ctx.quadraticCurveTo(cx + eyeDX, eyeY - 80, cx + eyeDX + 30, eyeY - 58);
      ctx.stroke();
      nose();
      ctx.fillStyle = '#5a2a2a';
      ctx.beginPath();
      ctx.ellipse(cx, mouthY - 10, 14, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'thinking':
      eyes({ rx: 24, ry: 30, lookX: 7, lookY: -9 });
      line(10);
      ctx.beginPath();
      ctx.moveTo(cx + eyeDX - 28, eyeY - 56);
      ctx.quadraticCurveTo(cx + eyeDX, eyeY - 74, cx + eyeDX + 30, eyeY - 60);
      ctx.stroke();
      nose();
      line(9);
      ctx.beginPath();
      ctx.moveTo(cx - 30, mouthY - 14);
      ctx.bezierCurveTo(cx - 12, mouthY - 24, cx + 8, mouthY - 4, cx + 30, mouthY - 16);
      ctx.stroke();
      break;
    case 'sad':
      eyes({ rx: 24, ry: 29, lookY: 4 });
      for (const s of [-1, 1]) brow(cx + s * eyeDX, eyeY - 50, -s * 10);
      nose();
      line(9);
      ctx.beginPath();
      ctx.moveTo(cx - 32, mouthY - 2);
      ctx.quadraticCurveTo(cx, mouthY - 30, cx + 32, mouthY - 2);
      ctx.stroke();
      // 눈물
      ctx.fillStyle = '#7cc4ff';
      ctx.beginPath();
      ctx.moveTo(cx + eyeDX + 18, eyeY + 34);
      ctx.quadraticCurveTo(cx + eyeDX + 34, eyeY + 66, cx + eyeDX + 18, eyeY + 74);
      ctx.quadraticCurveTo(cx + eyeDX + 2, eyeY + 66, cx + eyeDX + 18, eyeY + 34);
      ctx.fill();
      break;
    default:
      blush(0.3);
      eyes({});
      nose();
      catMouth(0);
  }
  ctx.restore();
}

/** 다음 깜빡임까지 기다릴 초(2.6~5초). */
export const nextBlinkIn = (random = Math.random) => 2.6 + random() * 2.4;
export const BLINK_SECONDS = 0.13;

/**
 * 얼굴 판 만들기: 정면에서 머리를 향해 격자로 광선을 쏴 표면 점을 얻고, 앞뒤(z) 높이를 여러 번 고르게 펴서(새겨진 홈을 지움)
 * 표면에서 조금 띄운 판을 만든다. 모델은 높이 1·발 중앙 원점으로 맞춘 뒤 부른다. 얼굴을 못 찾으면 null.
 * @returns {{ mesh, canvas, ctx, texture, skin } | null}
 */
export function buildFacePlate(THREE, model, { document: doc = globalThis.document } = {}) {
  const meshes = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length || !doc) return null;
  const ray = new THREE.Raycaster();
  const dir = new THREE.Vector3(0, 0, -1);
  const hitAt = (x, y) => {
    ray.set(new THREE.Vector3(x, y, 5), dir);
    return ray.intersectObjects(meshes, false)[0] ?? null;
  };
  // 얼굴 가운데: 몸 위쪽에서 정면으로 가장 튀어나온 높이(머리 앞면).
  let best = null;
  for (let y = 0.45; y <= 0.95; y += 0.01) {
    const h = hitAt(0, y);
    if (h && (!best || h.point.z > best.z)) best = { y, z: h.point.z };
  }
  if (!best) return null;
  // 새겨진 눈·코·입은 가장 튀어나온 높이보다 조금 아래(tutor.glb: 가운데 0.635, 위아래 ±0.115, 좌우 ±0.14)에 있어 판을 그만큼 내리고 넉넉히 덮는다.
  const HALF = 0.25, N = 56, CENTER = best.y - 0.055;
  const X0 = -HALF, Y0 = CENTER - HALF * 0.95, W = HALF * 2, H = HALF * 2 * 0.95;
  const z = [], ok = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      const h = hitAt(X0 + (W * i) / N, Y0 + (H * j) / N);
      ok.push(!!h);
      z.push(h ? h.point.z : 0);
    }
  }
  // 고르게 펴기(라플라시안): 새겨진 눈·코·입의 홈·돌기(폭 약 0.02~0.03)를 지운다. 못 맞은 점(머리 밖)은 빼고 이웃만 본다.
  // 편 면이 원래 돌기보다 낮아지면 판이 묻히므로, 가장 많이 낮아진 만큼(최대 0.02) 판 전체를 띄운다.
  const at = (i, j) => j * (N + 1) + i;
  const original = z.slice();
  for (let pass = 0; pass < 12; pass++) {
    const next = z.slice();
    for (let j = 1; j < N; j++) {
      for (let i = 1; i < N; i++) {
        const k = at(i, j);
        if (!ok[k]) continue;
        const ns = [at(i - 1, j), at(i + 1, j), at(i, j - 1), at(i, j + 1)].filter((n) => ok[n]);
        if (ns.length) next[k] = (z[k] + ns.reduce((s, n) => s + z[n], 0)) / (ns.length + 1);
      }
    }
    z.splice(0, z.length, ...next);
  }
  let lift = 0;
  for (let k = 0; k < z.length; k++) if (ok[k]) lift = Math.max(lift, original[k] - z[k]);
  lift = Math.min(lift, 0.02) + 0.004;
  const positions = [], uvs = [], index = [];
  for (let j = 0; j <= N; j++) {
    for (let i = 0; i <= N; i++) {
      positions.push(X0 + (W * i) / N, Y0 + (H * j) / N, z[at(i, j)] + lift);
      uvs.push(i / N, j / N);
    }
  }
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = at(i, j), b = at(i + 1, j), c = at(i, j + 1), d = at(i + 1, j + 1);
      if (ok[a] && ok[b] && ok[c] && ok[d]) index.push(a, b, d, a, d, c);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(index);
  geometry.computeVertexNormals();

  const canvas = doc.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  const material = new THREE.MeshStandardMaterial({ map: texture, transparent: true, roughness: 0.6, metalness: 0, envMapIntensity: 0.45, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return { mesh, canvas, ctx, texture, center: CENTER, skin: sampleSkin(THREE, meshes, hitAt, { X0, Y0, W, H }, doc) };
}

/** 피부색: 얼굴 판 가장자리 둘레에서 모델 색 텍스처를 읽어 평균(판과 머리가 이어지게). 못 읽으면 기본색. */
function sampleSkin(THREE, meshes, hitAt, { X0, Y0, W, H }, doc) {
  try {
    const map = meshes[0].material?.map;
    const img = map?.image;
    if (!img?.width) return '#eeeeec';
    const c = doc.createElement('canvas');
    c.width = img.width; c.height = img.height;
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0);
    let r = 0, g = 0, b = 0, n = 0;
    for (let k = 0; k < 16; k++) {
      const a = (Math.PI * 2 * k) / 16;
      const h = hitAt(X0 + W / 2 + Math.cos(a) * W * 0.42, Y0 + H / 2 + Math.sin(a) * H * 0.42);
      if (!h?.uv) continue;
      const u = ((h.uv.x % 1) + 1) % 1, v = ((h.uv.y % 1) + 1) % 1;
      const px = cx.getImageData(Math.floor(u * (img.width - 1)), Math.floor((map.flipY ? 1 - v : v) * (img.height - 1)), 1, 1).data;
      r += px[0]; g += px[1]; b += px[2]; n++;
    }
    if (!n) return '#eeeeec';
    const hex = (x) => Math.round(x / n).toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
  } catch {
    return '#eeeeec';
  }
}

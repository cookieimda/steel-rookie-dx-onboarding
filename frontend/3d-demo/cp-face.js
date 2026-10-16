// 포석호(이해도 확인 캐릭터) 얼굴·감정 연출. cp-character.js가 쓴다.
// - 모델(AI로 만든 tutor.glb)의 눈·코·입은 표면에 새겨져 있어 울퉁불퉁하고 표정을 바꿀 수 없다.
//   그래서 얼굴 위에 머리 표면을 따라 매끈하게 편 판(buildFacePlate)을 덮고, 원래 얼굴과 같은 모양·자리로 눈·코·입을 다시 그린다(drawFace).
// - 표정은 동작 이름표로 정한다(EXPRESSION_BY_MOTION). 바뀌면 바로 다시 그리고, 대기 표정에서는 가끔 눈을 깜빡인다.
// - 감정 배경(MOOD_BY_MOTION)은 캐릭터 뒤 효과 층(cp-character.js의 .fx)에 쓴다.
// - 브라우저 없이 불러와도 되게, 캔버스·three는 인자로 받는다.

/** 동작 이름표 → 얼굴 표정. */
export const EXPRESSION_BY_MOTION = {
  idle: 'neutral', ask: 'neutral', explain: 'neutral',
  greet: 'happy', praise: 'happy',
  celebrate: 'excited',
  encourage: 'determined', cheer_retry: 'sad',
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
  encourage: 'hope', cheer_retry: 'sad',
  sorry: 'sad',
  ask_again: 'think', thinking: 'think',
};
export const MOODS = ['joy', 'celebrate', 'hope', 'sad', 'think'];

/** 감정이 바뀌는 순간 몸이 '톡' 커졌다 돌아오는 동작(초·크기). */
export const POP = { seconds: 0.28, scale: 0.14 };
export const POP_MOTIONS = new Set(['greet', 'praise', 'celebrate', 'encourage', 'sorry', 'ask_again']);
export const popAt = (t) => (t >= 0 && t < POP.seconds ? 1 + POP.scale * Math.sin((Math.PI * t) / POP.seconds) : 1);

const INK = '#2b2622';

/**
 * 얼굴을 그린다(512×512, 얼굴 판의 uv와 같은 좌표). 포석호 원래 얼굴(tutor.glb에 새겨진 모양)을 같은 자리·크기로 매끈하게 다시 그린다:
 * 동그란 까만 눈(진한 테두리·회색 눈동자·빛 반사), 작고 둥근 코에서 내려와 'ω'로 갈라지는 입, 그 아래 따로 있는 얇은 미소선.
 * 감정은 이 얼굴에서 조금씩만 바꾼다(웃으면 눈이 ^^·미소선이 벌어짐, 슬프면 작은 눈썹·눈물·뒤집힌 미소선). 볼의 분홍은 모델 텍스처 그대로다.
 * 좌표는 원래 얼굴과 다시 그린 얼굴을 같은 화면에서 찍어 겹쳐 보며 맞췄다(판 좌표: 눈 y198·좌우 ±96, 코 y194, 'ω' 갈림 y226, 미소선 y383).
 * @param {CanvasRenderingContext2D} ctx
 * gaze({x, y}, -1~1)를 주면 눈동자·빛 반사가 그 방향으로 옮겨 간다(학습 기록 튜터 머리에서 마우스를 따라 봄, 2026-10-15).
 * @param {{ expression: string, blink?: boolean, skin?: string, gaze?: { x: number, y: number } }} o
 */
export function drawFace(ctx, { expression = 'neutral', blink = false, skin = '#eeeeec', gaze = null }) {
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

  const eyeY = 198, eyeDX = 96, eyeR = 25;
  const noseY = 194, jointY = 226, mouthEndY = 222, mouthDX = 56;
  const smileY = 383, smileDX = 44;
  const line = (w, color = INK) => { ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; };

  // 원래 눈: 진한 테두리 + 회색 눈동자 + 왼쪽 위 빛 반사. look은 눈동자·반사를 옮긴다(위를 봄 등).
  const eye = (x, y, { r = eyeR, lookX = 0, lookY = 0 } = {}) => {
    if (gaze) { lookX += gaze.x * r * 0.32; lookY += gaze.y * r * 0.32; }
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#55504c';
    ctx.beginPath();
    ctx.arc(x + 2 + lookX, y + 3 + lookY, r * 0.68, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.3 + lookX, y - r * 0.36 + lookY, r * 0.26, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();
  };
  const closedEye = (x, y) => { line(9); ctx.beginPath(); ctx.moveTo(x - eyeR, y + 2); ctx.quadraticCurveTo(x, y + 12, x + eyeR, y + 2); ctx.stroke(); };
  const happyEye = (x, y) => { line(10); ctx.beginPath(); ctx.moveTo(x - eyeR, y + 8); ctx.quadraticCurveTo(x, y - 22, x + eyeR, y + 8); ctx.stroke(); };
  const eyes = (opts = {}) => {
    for (const s of [-1, 1]) {
      const x = cx + s * eyeDX;
      if (blink && BLINKING.has(expression)) closedEye(x, eyeY);
      else eye(x, eyeY, typeof opts === 'function' ? opts(s) : opts);
    }
  };
  const brows = (tilt, y = eyeY - 44) => { line(8); for (const s of [-1, 1]) { const x = cx + s * eyeDX; ctx.beginPath(); ctx.moveTo(x - 20, y + s * tilt); ctx.lineTo(x + 20, y - s * tilt); ctx.stroke(); } };

  // 원래 코와 'ω' 입: 둥근 코 → 아래로 짧은 선 → 양쪽으로 둥글게 올라가는 두 곡선.
  const noseMouth = (open = 0) => {
    ctx.fillStyle = INK;
    ctx.beginPath();
    ctx.moveTo(cx - 20, noseY - 9);
    ctx.quadraticCurveTo(cx, noseY - 22, cx + 20, noseY - 9);
    ctx.quadraticCurveTo(cx + 18, noseY + 12, cx, noseY + 18);
    ctx.quadraticCurveTo(cx - 18, noseY + 12, cx - 20, noseY - 9);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.beginPath();
    ctx.ellipse(cx - 5, noseY - 6, 5, 3, -0.3, 0, Math.PI * 2);
    ctx.fill();
    line(13);
    ctx.beginPath();
    ctx.moveTo(cx, noseY + 14);
    ctx.lineTo(cx, jointY);
    for (const s of [-1, 1]) {
      ctx.moveTo(cx, jointY);
      ctx.bezierCurveTo(cx + s * mouthDX * 0.2, jointY + 15 + open, cx + s * mouthDX * 0.8, jointY + 17 + open, cx + s * mouthDX, mouthEndY - 6);
    }
    ctx.stroke();
  };
  // 원래 미소선(아래쪽 얇은 곡선). curve > 0이면 웃는 쪽, < 0이면 뒤집힌(시무룩한) 쪽.
  const smile = (curve = 9, width = smileDX) => {
    line(11);
    ctx.beginPath();
    ctx.moveTo(cx - width, smileY - curve * 0.4);
    ctx.quadraticCurveTo(cx, smileY + curve * 1.2, cx + width, smileY - curve * 0.4);
    ctx.stroke();
  };
  const openSmile = (width, depth) => {
    ctx.fillStyle = '#4a2424';
    ctx.beginPath();
    ctx.moveTo(cx - width, smileY - 6);
    ctx.quadraticCurveTo(cx, smileY - 12, cx + width, smileY - 6);
    ctx.quadraticCurveTo(cx, smileY + depth * 2, cx - width, smileY - 6);
    ctx.fill();
    ctx.fillStyle = '#ff8f9a';
    ctx.beginPath();
    ctx.ellipse(cx, smileY + depth * 0.7, width * 0.45, depth * 0.35, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  const softBlush = (alpha) => {
    for (const s of [-1, 1]) {
      const x = cx + s * 150, y = eyeY + 58;
      const b = ctx.createRadialGradient(x, y, 2, x, y, 34);
      b.addColorStop(0, `rgba(255,150,160,${alpha})`);
      b.addColorStop(1, 'rgba(255,150,160,0)');
      ctx.fillStyle = b;
      ctx.beginPath();
      ctx.arc(x, y, 34, 0, Math.PI * 2);
      ctx.fill();
    }
  };

  switch (expression) {
    case 'happy':
      softBlush(0.35);
      for (const s of [-1, 1]) happyEye(cx + s * eyeDX, eyeY);
      noseMouth(4);
      openSmile(40, 16);
      break;
    case 'excited':
      softBlush(0.5);
      for (const s of [-1, 1]) happyEye(cx + s * eyeDX, eyeY - 2);
      noseMouth(6);
      openSmile(48, 24);
      break;
    case 'determined':
      eyes();
      brows(5);
      noseMouth();
      smile(10, 46);
      break;
    case 'curious':
      eyes((s) => (s > 0 ? { r: eyeR + 4 } : { r: eyeR - 2 }));
      line(8);
      ctx.beginPath();
      ctx.moveTo(cx + eyeDX - 20, eyeY - 44);
      ctx.quadraticCurveTo(cx + eyeDX, eyeY - 60, cx + eyeDX + 22, eyeY - 46);
      ctx.stroke();
      noseMouth();
      ctx.fillStyle = '#4a2424';
      ctx.beginPath();
      ctx.ellipse(cx, smileY, 11, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'thinking':
      eyes({ lookX: 5, lookY: -7 });
      noseMouth();
      line(10);
      ctx.beginPath();
      ctx.moveTo(cx - smileDX, smileY);
      ctx.bezierCurveTo(cx - 14, smileY - 9, cx + 12, smileY + 9, cx + smileDX, smileY - 2);
      ctx.stroke();
      break;
    case 'sad':
      eyes({ lookY: 3 });
      brows(-6);
      noseMouth();
      smile(-9);
      // 눈물
      ctx.fillStyle = '#7cc4ff';
      ctx.beginPath();
      ctx.moveTo(cx + eyeDX + 14, eyeY + 26);
      ctx.quadraticCurveTo(cx + eyeDX + 27, eyeY + 52, cx + eyeDX + 14, eyeY + 59);
      ctx.quadraticCurveTo(cx + eyeDX + 1, eyeY + 52, cx + eyeDX + 14, eyeY + 26);
      ctx.fill();
      break;
    default:
      eyes();
      noseMouth();
      smile();
  }
}

/** 다음 깜빡임까지 기다릴 초(2.6~5초). */
export const nextBlinkIn = (random = Math.random) => 2.6 + random() * 2.4;
export const BLINK_SECONDS = 0.13;

/**
 * 정면(z가 큰 쪽)에서 본 높이 지도: 영역 안 삼각형을 한 번씩 격자에 칠해(래스터화) 칸마다 가장 앞(z 최대) 표면의 z와 uv를 남긴다.
 * 광선을 칸마다 쏘면 삼각형 약 12만 개를 매번 다 검사해 40초 넘게 걸려서(2026-10-14 측정), 삼각형을 한 번만 훑는 방식으로 바꿨다.
 * 돌려주는 hitAt(x, y)는 Raycaster 결과와 같은 모양({ point: { z }, uv: { x, y } } 또는 null)이다.
 */
export function frontHeightField(THREE, meshes, { x0, x1, y0, y1, step }) {
  const nx = Math.ceil((x1 - x0) / step) + 1, ny = Math.ceil((y1 - y0) / step) + 1;
  const zs = new Float32Array(nx * ny).fill(-Infinity), us = new Float32Array(nx * ny), vs = new Float32Array(nx * ny);
  const p = new THREE.Vector3();
  for (const mesh of meshes) {
    const g = mesh.geometry, pos = g.attributes.position, uv = g.attributes.uv, index = g.index;
    if (!pos) continue;
    const P = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      P[i * 3] = p.x; P[i * 3 + 1] = p.y; P[i * 3 + 2] = p.z;
    }
    const triangles = index ? index.count / 3 : pos.count / 3;
    for (let t = 0; t < triangles; t++) {
      const a = index ? index.getX(t * 3) : t * 3, b = index ? index.getX(t * 3 + 1) : t * 3 + 1, c = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2];
      const bx = P[b * 3], by = P[b * 3 + 1], bz = P[b * 3 + 2];
      const cx = P[c * 3], cy = P[c * 3 + 1], cz = P[c * 3 + 2];
      const minX = Math.min(ax, bx, cx), maxX = Math.max(ax, bx, cx), minY = Math.min(ay, by, cy), maxY = Math.max(ay, by, cy);
      if (maxX < x0 || minX > x1 || maxY < y0 || minY > y1) continue;
      const d = (by - cy) * (ax - cx) + (cx - bx) * (ay - cy);
      if (Math.abs(d) < 1e-12) continue;
      const i0 = Math.max(0, Math.ceil((minX - x0) / step)), i1 = Math.min(nx - 1, Math.floor((maxX - x0) / step));
      const j0 = Math.max(0, Math.ceil((minY - y0) / step)), j1 = Math.min(ny - 1, Math.floor((maxY - y0) / step));
      for (let j = j0; j <= j1; j++) {
        const Y = y0 + j * step;
        for (let i = i0; i <= i1; i++) {
          const X = x0 + i * step;
          const w1 = ((by - cy) * (X - cx) + (cx - bx) * (Y - cy)) / d;
          const w2 = ((cy - ay) * (X - cx) + (ax - cx) * (Y - cy)) / d;
          const w3 = 1 - w1 - w2;
          if (w1 < -1e-6 || w2 < -1e-6 || w3 < -1e-6) continue;
          const Z = w1 * az + w2 * bz + w3 * cz;
          const k = j * nx + i;
          if (Z <= zs[k]) continue;
          zs[k] = Z;
          if (uv) {
            us[k] = w1 * uv.getX(a) + w2 * uv.getX(b) + w3 * uv.getX(c);
            vs[k] = w1 * uv.getY(a) + w2 * uv.getY(b) + w3 * uv.getY(c);
          }
        }
      }
    }
  }
  return (x, y) => {
    const i = Math.round((x - x0) / step), j = Math.round((y - y0) / step);
    if (i < 0 || j < 0 || i >= nx || j >= ny) return null;
    const k = j * nx + i;
    return Number.isFinite(zs[k]) ? { point: { z: zs[k] }, uv: { x: us[k], y: vs[k] } } : null;
  };
}

/**
 * 얼굴 판 만들기: 정면에서 본 머리 높이 지도(frontHeightField)에서 표면 점을 얻고, 앞뒤(z) 높이를 여러 번 고르게 펴서(새겨진 홈을 지움)
 * 표면에서 조금 띄운 판을 만든다. 모델은 높이 1·발 중앙 원점으로 맞춘 뒤 부른다. 얼굴을 못 찾으면 null.
 * @returns {{ mesh, canvas, ctx, texture, skin } | null}
 */
export function buildFacePlate(THREE, model, { document: doc = globalThis.document } = {}) {
  const meshes = [];
  model.updateMatrixWorld(true);
  model.traverse((o) => { if (o.isMesh) meshes.push(o); });
  if (!meshes.length || !doc) return null;
  // 얼굴 찾기·판·피부색이 쓰는 영역(높이 1 기준 머리 앞면 넉넉히). 칸 0.004 ≈ 판 격자의 절반.
  const hitAt = frontHeightField(THREE, meshes, { x0: -0.32, x1: 0.32, y0: 0.3, y1: 1.0, step: 0.004 });
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

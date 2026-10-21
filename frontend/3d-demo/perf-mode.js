// 3D 화면 화질·부하 조절(첫 화면 steel-intro, 공정 화면 steel-index가 같이 쓴다).
// 발표 모드: 주소에 ?present=1, 또는 키보드 P로 켜고 끈다(이 브라우저에 기억). 빔 프로젝터·노트북 발표처럼 렉이 없어야 할 때 쓴다.
//  - 렌더 해상도 배율 1(윈도우 배율 150% 노트북에서 1.5배로 그리던 것을 줄인다)
//  - 빛번짐(블룸)은 절반 해상도로, 그림자는 매 프레임 대신 1초에 5번만 다시 계산, 그림자 지도 1024
//  - 패널 뒤 흐림(backdrop-filter)을 끄고 판을 조금 더 진하게(3D가 움직일 때마다 다시 흐리게 만드는 비용을 없앤다)
// 늘 켜짐: 3초 동안 평균 프레임이 24ms(약 40fps)보다 느리면 렌더 해상도를 1로 낮춘다(한 번만).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const KEY = 'st-rookie:present';
const read = () => { try { return localStorage.getItem(KEY) === '1'; } catch { return false; } };
const qs = new URLSearchParams(location.search);
export const present = qs.has('present') ? qs.get('present') !== '0' : read();
if (qs.has('present')) try { localStorage.setItem(KEY, present ? '1' : '0'); } catch {}

// 키보드 P: 발표 모드 켜고 끄기(입력창에서 누를 때는 무시), 다시 불러와 처음부터 적용
addEventListener('keydown', (e) => {
  if (e.key !== 'p' && e.key !== 'P') return;
  if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName || '') || e.target?.isContentEditable) return;
  try { localStorage.setItem(KEY, present ? '0' : '1'); } catch {}
  const u = new URL(location.href); u.searchParams.delete('present'); location.replace(u);
});

if (present) {
  const mark = () => document.body.classList.add('present-mode');
  if (document.body) mark(); else addEventListener('DOMContentLoaded', mark);
  const style = document.createElement('style');
  style.textContent = `body.present-mode *, body.present-mode *::before, body.present-mode *::after { -webkit-backdrop-filter: none !important; backdrop-filter: none !important; }
body.present-mode { --glass: rgba(24, 27, 35, .92); }
.present-chip { position: fixed; right: 12px; bottom: 12px; z-index: 9998; padding: 4px 10px; border-radius: 999px; background: rgba(0,0,0,.6); color: #8dffbf; font: 500 12px system-ui, sans-serif; pointer-events: none; }`;
  document.head.appendChild(style);
  const chip = document.createElement('div'); chip.className = 'present-chip'; chip.textContent = '발표 모드 · P로 끄기';
  const add = () => document.body.appendChild(chip);
  if (document.body) add(); else addEventListener('DOMContentLoaded', add);
}

/** 렌더러를 만든 직후에 부른다: 해상도 배율·그림자 방식. */
export function tuneRenderer(renderer) {
  renderer.setPixelRatio(present ? 1 : Math.min(devicePixelRatio, 1.5));
  if (present) { renderer.shadowMap.type = THREE.PCFShadowMap; renderer.shadowMap.autoUpdate = false; renderer.shadowMap.needsUpdate = true; }
}
/** 그림자를 드리우는 빛: 발표 모드면 그림자 지도를 1024로. */
export function tuneShadowLight(light) { if (present && light.shadow.mapSize.x > 1024) light.shadow.mapSize.set(1024, 1024); }
/** 블룸 패스: 발표 모드면 절반 해상도로 계산한다(composer가 부르는 setSize를 감싼다). */
export function tuneBloom(bloom) {
  if (!present) return;
  const setSize = bloom.setSize.bind(bloom);
  bloom.setSize = (w, h) => setSize(Math.max(1, Math.round(w / 2)), Math.max(1, Math.round(h / 2)));
}
/** 매 프레임 부른다: 발표 모드면 그림자를 1초에 5번만 다시 계산한다. */
let lastShadow = 0;
export function shadowTick(renderer, now) {
  if (!present || now - lastShadow < 200) return;
  lastShadow = now; renderer.shadowMap.needsUpdate = true;
}

/**
 * 자동 화질: 3초 동안 평균 프레임이 24ms보다 느리면 렌더 해상도 배율을 1로 낮춘다(한 번만). 이미 1이면 아무것도 하지 않는다.
 * @param {{ renderer: THREE.WebGLRenderer, composer?: { setPixelRatio(n: number): void, setSize(w: number, h: number): void } }} o
 */
export function autoQuality({ renderer, composer }) {
  let samples = [], last = performance.now(), done = false;
  const loop = (now) => {
    if (done) return;
    samples.push(now - last); last = now;
    if (samples.length >= 90) {
      const avg = samples.reduce((s, x) => s + x, 0) / samples.length; samples = [];
      if (avg > 24 && avg < 500 && renderer.getPixelRatio() > 1) { // 500ms 넘는 건 탭이 숨겨진 것이라 무시
        const el = renderer.domElement, w = el.clientWidth || 1, h = el.clientHeight || 1;
        renderer.setPixelRatio(1); renderer.setSize(w, h, false);
        composer?.setPixelRatio?.(1); composer?.setSize(w, h);
        document.body.dataset.autoQuality = 'dpr1'; done = true; return;
      }
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

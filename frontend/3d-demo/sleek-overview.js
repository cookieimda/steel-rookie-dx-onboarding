// [세련안] Steel Academy v4.dc.html 전용 덧붙임. scene_v3.js는 고치지 않고 site-*.js처럼 바깥에서 붙는다.
// 1) 드론 시점: 전체 공정을 낮고 비스듬한 각도로 본다(_overviewPose 대체)
// 2) 인트로: 어두운 화면에서 조명이 서서히 켜진다
// 3) 정리: 공정 사이 빛나는 연결선·길 빛, 보케·불씨·불꽃놀이, 바닥 빛기둥, 구역 네온 테두리를 끈다
// 4) 공정 안을 볼 때 카메라와 공정 사이를 가리는 주변 건물을 숨긴다
// 끝나면 document에 'sleek-intro-done' 이벤트를 보낸다(페이지가 안내 문구를 띄움).
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';
import { PROCESSES } from './data_v2.js';

const IDS = ['ironmaking', 'steelmaking', 'continuous_casting', 'rolling'];
const LIGHT_MS = 3200;

export function attachSleek() {
  const tryAttach = () => {
    const el = document.querySelector('steel-scene');
    const ready = el && el.scene && el.zones && IDS.every(id => el.zones[id]?.root?.getObjectByName('GLB_' + id)) && el.scene.getObjectByName('SITE_BACKDROP_EXT');
    if (!ready) return setTimeout(tryAttach, 120);
    if (el.__sleek) return; el.__sleek = true;
    setupDroneView(el);
    // 원래 코드가 테마를 칠한 직후 바로 톤을 다시 맞춘다(500ms 주기를 기다리면 남색 하늘이 잠깐 비친다)
    const applyTheme = el._applyTheme.bind(el);
    el._applyTheme = function () { const r = applyTheme(), dark = (this.getAttribute('theme') || 'dark') === 'dark'; try { gradeScene(this, dark); } catch (e) { console.warn('톤 맞추기 실패', e); }
      if (dark) this.renderer.toneMappingExposure = NIGHT_EXPOSURE; return r; }; // 다크 모드 화면 밝기(원래 코드는 0.95로 칠한다)
    if ((el.getAttribute('theme') || 'dark') === 'dark') el.renderer.toneMappingExposure = NIGHT_EXPOSURE; // 인트로가 이 값까지 밝힌다
    const tidy = () => tidyScene(el);
    tidy(); setInterval(tidy, 500); // 새로 생기는 것도 잡는다
    let burstUntil = 0;
    const burst = () => { if (performance.now() < burstUntil) { tidy(); setTimeout(burst, 16); } }; // 그리기(rAF)와 상관없이 약 60번/초
    new MutationObserver(() => { const go = performance.now() >= burstUntil; burstUntil = performance.now() + 3000; tidy(); if (go) setTimeout(burst, 16); })
      .observe(el, { attributes: true, attributeFilter: ['theme', 'time-of-day', 'timeofday'] });
    setInterval(() => hideOccluders(el), 400);
    setupFraming(el);
    // 조작(드래그·휠) 처리는 지금 바로 붙이고, 공정 소개는 인트로가 끝난 뒤 시작한다(인트로 중 휠이 원래 거리 줌으로 새던 문제)
    const showcase = startShowcase(el);
    playIntro(el, showcase);
  };
  tryAttach();
}

// ---- 5) 공정 안 화면 위치: 왼쪽 메뉴·오른쪽 설명 패널에 가리지 않는 영역의 가운데에 맞춘다 ----
// 원래 _resize는 공정 안에서 화면을 늘 오른쪽으로 폭의 10%(최대 170px) 밀었다. 시연 중엔 오른쪽 패널이 3D 위에 겹쳐 떠서
// 설비가 패널 쪽으로 쏠려 보였다. 매 프레임 메뉴·패널이 3D 영역을 가리는 폭을 재서 남는 영역 가운데로 부드럽게 옮긴다.
// 2D 보기는 원래 동작 그대로 둔다.
function setupFraming(el) {
  const nav = () => document.querySelector('[data-sa-nav]'), pan = () => document.querySelector('[data-sa-panel]');
  const shown = (n) => n && n.offsetParent !== null && getComputedStyle(n).visibility !== 'hidden';
  const target = () => { // 가로 오프셋(px, 양수 = 장면을 왼쪽으로). null = 오프셋 없음
    if ((el.getAttribute('process') || 'site') === 'site' || el.clientWidth <= 900) return null;
    const r = el.getBoundingClientRect(); let L = r.left, R = r.right;
    const n = nav(), p = pan();
    if (shown(n)) { const b = n.getBoundingClientRect(); if (b.height > r.height * 0.4 && b.right > L && b.left < r.left + r.width / 2) L = Math.max(L, b.right); } // 접힌(작은) 공정 캡슐은 빼고
    if (shown(p)) { const b = p.getBoundingClientRect(); if (b.left < R && b.right > r.left + r.width / 2) R = Math.min(R, b.left); }
    return Math.round(r.left + r.width / 2 - (L + R) / 2);
  };
  let cur = null;
  const apply = () => { const pc = el._persp || el.camera, w = el.clientWidth || 1, h = el.clientHeight || 1;
    if (cur == null) pc.clearViewOffset(); else pc.setViewOffset(w, h, cur, 0, w, h); pc.updateProjectionMatrix(); el._dirty = true; };
  const resize = el._resize.bind(el);
  el._resize = function () { resize(); if (!this._2d) apply(); };
  (function step() {
    if (!el._2d) {
      const t = target();
      if (t == null) { if (cur != null) { cur = null; apply(); } }
      else {
        if (cur == null) { const v = (el._persp || el.camera).view; cur = v?.enabled ? v.offsetX : 0; } // 원래 오프셋에서 출발
        const d = t - cur; if (Math.abs(d) > 0.5) { cur += d * 0.12; apply(); } else if (d) { cur = t; apply(); }
      }
    }
    requestAnimationFrame(step);
  })();
}

// ---- 1) 드론 시점 ----
const MAX_DIST = 200; // 전체 공정에서 카메라가 물러날 수 있는 최대 거리(원래 300)
// 라이트 모드의 해: 첫 화면(드론 시점) 기준 2시 방향 하늘(고도 40°). 그림자는 이 방향으로 바닥에 구워 둔다(bakeSunShadow)
const SUN = (() => { const yaw = -0.55, f = new THREE.Vector2(-Math.sin(yaw), -Math.cos(yaw)), r = new THREE.Vector2(Math.cos(yaw), -Math.sin(yaw));
  const a = Math.PI / 3, h = f.multiplyScalar(Math.cos(a)).add(r.multiplyScalar(Math.sin(a))).normalize(), el = 40 * Math.PI / 180; // 2시 = 12시(앞쪽 멀리)에서 오른쪽으로 60°
  return new THREE.Vector3(h.x * Math.cos(el), Math.sin(el), h.y * Math.cos(el)).normalize(); })();
function setupDroneView(el) {
  const PITCH = 0.42, YAW = -0.55;
  // 오른쪽 드래그로도 돌린다: 장면은 오른쪽 버튼도 회전으로 처리하므로, 브라우저 오른쪽 클릭 메뉴만 막는다
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  // 라이트 모드에선 실시간 햇빛도 구운 그림자와 같은 방향(2시)에서 비추게
  const placeSun = el._placeSun.bind(el);
  el._placeSun = function () { if ((this.getAttribute('theme') || 'dark') !== 'dark') this._sunDir = SUN.clone(); return placeSun(); };
  el._placeSun();
  // 전체 공정에서 좌우로 240°(드론 시점 기준 ±120°)까지 돌려 볼 수 있게 한다. 공정 안에서는 원래 범위
  const yawRange = el._yawRange.bind(el);
  el._yawRange = function () { return this.orbit.dist > 120 ? [YAW - 2.09, YAW + 2.09] : yawRange(); };
  el._overviewPose = function () {
    const zs = Object.values(this.zones || {}), xs = zs.map(z => z.ox), zz = zs.map(z => z.oz || 0);
    const x0 = Math.min(...xs) - 26, x1 = Math.max(...xs) + 26, z0 = Math.min(...zz) - 22, z1 = Math.max(...zz) + 28;
    // 화각은 늘 기본 42°로 계산한다(소개 중엔 20°로 당겨져 있어, 그대로 쓰면 거리가 두 배 넘게 잡혀 멀리 빠졌다)
    const a = this.camera.aspect || 1.6, t = Math.tan(42 * Math.PI / 360);
    const span = Math.hypot(x1 - x0, z1 - z0); // 비스듬히 보므로 대각선 길이로 맞춘다
    const dist = Math.max(140, Math.min(MAX_DIST, span / (2 * t * Math.min(a, 1.8)) * 1.05));
    // 화면 앞쪽(04 열간압연)이 잘리지 않게 시선 중심을 카메라 쪽으로 조금 당긴다
    const fwd = new THREE.Vector3(Math.sin(YAW), 0, Math.cos(YAW)).multiplyScalar(14);
    return this._navShift({ yaw: YAW, pitch: PITCH, dist, target: new THREE.Vector3((x0 + x1) / 2, 0, (z0 + z1) / 2).add(fwd) });
  };
}

// ---- 3) 잡다한 것 끄기 ----
function isOldNearStatic(o) { // site-backdrop.js의 isNearStatic과 같은 기준(부지 안, 반경 300 안의 정적 메시)
  if (!o.isMesh || o.isPoints || o.userData.keep || !o.material || o.material.isShaderMaterial || o.material.blending === THREE.AdditiveBlending) return false;
  o.updateMatrixWorld(true);
  const s = o.isInstancedMesh ? (o.computeBoundingSphere(), o.boundingSphere.clone()) : (o.geometry.computeBoundingSphere(), o.geometry.boundingSphere.clone().applyMatrix4(o.matrixWorld));
  return s.center.length() < 300 && s.radius < 300;
}
function tidyScene(el) {
  let changed = false;
  const settled = backdropSettled(el); // 테마를 바꾼 직후 배경 GLB가 바뀌기 전에는 테마별 굽기를 미룬다
  // 원래 장면 코드(scene_v3.js·site-backdrop.js)가 테마를 바꿀 때 네온·빛기둥 등을 다시 켜서, 잠깐씩 예전 모습이 비쳤다.
  // 그래서 숨길 것은 visible 속성을 잠가 버린다(켜려 해도 무시)
  const off = (o) => { if (!o || o.userData.sleekOff) return; Object.defineProperty(o, 'visible', { configurable: true, get: () => false, set: () => {} }); o.userData.sleekOff = true; changed = true; };
  // 옛 배경(scene_v3.js의 backdrop) 중 부지 안 정적 메시는 site-backdrop.js가 새 배경 GLB와 겹친다고 숨기지만, 공정 화면의 가림 처리(scene_v3.js _occTick)가
  // visible = true로 되돌려 옛 건물·컨테이너·공 모양 나무가 새 배경 위에 겹쳐 보였다 → 잠근다. 고르는 기준은 site-backdrop.js의 isNearStatic과 같다
  if (el.scene.getObjectByName('SITE_BACKDROP_EXT')) el.backdrop?.children.forEach(o => { if (!o.userData.sleekOff && (o.userData.oldNear ??= isOldNearStatic(o))) off(o); });
  removeBlockers(el, off); // 그림자를 굽기 전에 먼저 지운다(지운 건물 그림자가 바닥에 남지 않게)
  if (scaleBackdrop(el)) changed = true; // 주변 건물·나무를 공정 축척에 맞게 줄임(그림자 굽기 전에)
  if (replaceTrees(el)) changed = true; // 공 모양 나무 → 잎 그림 평면을 엇갈려 세운 나무
  if (removeFarBuildings(el, off)) changed = true; // 바다 건너 먼 건물 실루엣
  if (removeLights(el)) changed = true;             // 구워 둔 조명과 겹치는 실제 조명 빼기(투광등·밤 키라이트·구역 조명)
  if (settled && (el.getAttribute('theme') || 'dark') === 'dark' && !el.__nightBaked && el.zones && Object.values(el.zones).every(z => z.root?.children.length)) {
    el.__nightBaked = true; try { bakeNight(el); } catch (e) { console.warn('밤 조명 굽기 실패', e); } changed = true; }
  off(el._links?.g);                                   // 공정 사이 하늘색 연결선
  (el.zoneArrows || []).forEach(a => { if (a.el && a.el.style.display !== 'none') { a.el.style.display = 'none'; changed = true; } off(a.mesh); off(a.glow); });
  (el._bokehPts || []).forEach(off);                  // 보케(먼 도시 불빛 점)
  off(el.embers);                                      // 불씨
  if (el._fw) { off(el._fw.pts); off(el._fw.glow); }   // 불꽃놀이
  Object.values(el.zones || {}).forEach(z => off(z.neon)); // 구역 네온 테두리
  // 원래 상자 이름표(01 제선 …)는 쓰지 않는다. 대신 동그라미 콜아웃(makeCallout). display는 장면이 만지므로 visibility로 숨긴다
  Object.values(el.zones || {}).forEach(z => { if (z.label && z.label.style.visibility !== 'hidden') { z.label.style.visibility = 'hidden'; z.label.style.pointerEvents = 'none'; } });
  const beams = el.scene.getObjectByName('SITE_FLOOR_BEAMS'); off(beams); // 바닥 빛기둥
  // 바닥 조명 본체: 빛기둥과 같은 개수로 깔린 납작한 원판(주변 건물 GLB 안). 이것도 숨긴다
  if (beams?.isInstancedMesh) beams.parent?.traverse(o => { if (o !== beams && o.isInstancedMesh && o.count === beams.count && !o.userData.lamp) off(o); });
  off(el._waves?.g);                                   // 바다 물결 줄(땅 모양이 달라 땅 위까지 덮음)
  (el._sharks || []).forEach(off);                    // 바다 위 상어(지느러미·그림자·물살)
  // 가로등 3D(기둥·등머리·빛 번짐·아래 주황 원)는 모두 숨긴다. 빛은 바닥 라이트맵에 구워 둔다(bakeLampLight)
  el.scene.traverse(o => { if (!o.userData.lamp) return; if (!lampPool && o.geometry?.type === 'CircleGeometry' && o.isInstancedMesh) lampPool = o; off(o); });
  // 낮·밤 배경 GLB는 각자 바닥(SITE_GROUND)을 갖는다. 지금 보이는 것을 고른다
  let ground = null; el.scene.traverse(o => { if (o.name === 'SITE_GROUND' && o.material && isShown(o)) ground = o; });
  const dark = (el.getAttribute('theme') || 'dark') === 'dark';
  if (ground) {
    const m = ground.material;
    // scene_v3.js의 _applyTheme이 테마를 바꿀 때·60초마다 바닥 지도를 다시 칠하므로, 바뀌면 다시 입힌다
    if (m.map !== m.userData.myBase) { asphaltGround(el, m, dark); changed = true; }
    if (!m.userData.sleekZS) { m.userData.sleekZS = true; m.needsUpdate = true; changed = true; }
    if (!dark && zoneSunShadows(el)) changed = true;
    if (settled && !dark && !m.userData.myBase?.userData.sunBaked && m.userData.myBase) { try { bakeSunShadow(el, ground, m.userData.myBase); } catch (e) { console.warn('그림자 굽기 실패', e); } m.userData.myBase.userData.sunBaked = true; changed = true; }
    if (lampPool && !m.userData.lampBaked) { m.userData.lampBaked = true; try { bakeLampLight(ground, lampPool); } catch (e) { console.warn('가로등 빛 굽기 실패', e); } changed = true; }
    const lmi = dark ? 13.8 * 1.2 * NIGHT_LIGHT * LAMP_GAIN : 0; if (m.lightMap && m.lightMapIntensity !== lmi) { m.lightMapIntensity = lmi; changed = true; } // 낮에는 가로등이 꺼져 있다. 밤 밝기는 원래보다 20% 밝게
    if (lampPool && lampPosts(el, lampPool, dark)) changed = true; // 빛 웅덩이 가운데에 로우폴리 가로등
    if (!ground.userData.sea) { try { ground.userData.sea = makeSea(el, ground); } catch (e) { console.warn('바다 만들기 실패', e); ground.userData.sea = 'fail'; } changed = true; }
    if (ground.userData.sea?.setTheme) ground.userData.sea.setTheme(dark);
  }
  if (!dark) lightContrast(el);
  nightLights(el, dark);
  if (!dark) placeSunDisc(el);
  if (settled && !dark) { const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (ext && isShown(ext) && ground && !ground.userData.chiaro) { ground.userData.chiaro = true; /* 낮·밤 배경 GLB마다 바닥이 따로라 거기에 표시 */ try { bakeChiaroscuro(el, ext); } catch (e) { console.warn('명암 굽기 실패', e); } changed = true; } }
  if (!el.__sleekRoads && el._traffic) el.__sleekRoads = buildRoads(el) || 'none';
  if (el.__sleekRoads?.setTheme) el.__sleekRoads.setTheme(dark);
  if (gradeScene(el, dark)) changed = true;
  if (purgeHidden(el)) changed = true;
  if (changed) el._dirty = true;
}
// 잠가서 숨긴 것(sleekOff)을 장면 그래프에서 떼고, 다른 곳에서 안 쓰는 지오메트리·재질은 dispose. 가로등(lamp)은 빛 굽기·기둥 배치가 다시 읽으므로 남긴다
function purgeHidden(el) {
  const S = el.scene, dead = [];
  S.traverse(o => { if (o.userData.sleekOff && !o.userData.lamp && o.parent && !o.userData.purged) dead.push(o); });
  if (!dead.length) return false;
  dead.forEach(o => { o.userData.purged = true; o.parent.remove(o); });
  const used = new Set(); S.traverse(o => { if (o.geometry) used.add(o.geometry); if (o.material) [].concat(o.material).forEach(m => used.add(m)); });
  dead.forEach(o => o.traverse(c => { if (c.geometry && !used.has(c.geometry)) c.geometry.dispose(); if (c.material) [].concat(c.material).forEach(m => { if (!used.has(m)) m.dispose(); }); }));
  return true;
}

// ---- 색감 누그러뜨리기: 원래 색(남색 밤하늘·파란 바다·초록 나무)은 살리고 채도만 낮춘다 ----
// 홈(home-sleek)은 무채색이라 3D로 넘어가면 색이 너무 진해 다른 사이트처럼 보였다.
// 공정 설비(zones)는 색이 뜻을 가지므로(쇳물 주황 등) 그대로 두고, 주변 배경(하늘·건물·나무·바닥·바다·먼 산)만 낮춘다.
const GRADE = { dark: { sat: 0.6 }, light: { sat: 0.6 } }; // 남길 채도 비율(1 = 원래 색)
const SAT = { value: GRADE.dark.sat }; // 모든 배경 재질이 같은 값을 본다 → 테마가 바뀌면 값만 바꾼다
const skyCache = new WeakMap(); // 원래 하늘 텍스처 → 채도 낮춘 사본
const SEA_FAR = { value: new THREE.Color(0xa9cfc6) }; // 먼 바다 색(바다 끝까지 이 색으로 옅어진다). makeSea의 setTheme이 테마마다 정한다
const mute = (c, s = SAT.value) => { const l = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; return c.setRGB(l + (c.r - l) * s, l + (c.g - l) * s, l + (c.b - l) * s); };
function mutedSky(src) {
  let t = skyCache.get(src); if (t) return t;
  const img = src.image, c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
  const x = c.getContext('2d'); x.drawImage(img, 0, 0); const d = x.getImageData(0, 0, c.width, c.height), p = d.data, s = SAT.value;
  for (let i = 0; i < p.length; i += 4) { const l = 0.2126 * p[i] + 0.7152 * p[i + 1] + 0.0722 * p[i + 2]; for (let k = 0; k < 3; k++) p[i + k] = l + (p[i + k] - l) * s; }
  x.putImageData(d, 0, 0);
  t = new THREE.CanvasTexture(c); t.colorSpace = src.colorSpace; t.userData.sleekSky = true; skyCache.set(src, t); return t;
}
function desaturate(m) {
  // 표시는 userData가 아니라 훅 함수에 단다: 재질을 clone하면 userData는 복사되지만 onBeforeCompile은 복사되지 않는다(하늘 가장자리 띠가 그래서 파랗게 남았다)
  if (!m || m.onBeforeCompile.sleek || m.isShaderMaterial || m.isRawShaderMaterial) return false;
  const prev = m.onBeforeCompile, key = m.customProgramCacheKey;
  m.onBeforeCompile = function (sh, r) {
    prev?.call(this, sh, r);
    if (!this.userData.noSat) { sh.uniforms.uSleekSat = SAT;
      sh.fragmentShader = 'uniform float uSleekSat;\n' + sh.fragmentShader.replace('#include <opaque_fragment>',
        '#include <opaque_fragment>\n gl_FragColor.rgb = mix(vec3(dot(gl_FragColor.rgb, vec3(.2126, .7152, .0722))), gl_FragColor.rgb, uSleekSat);'); }
    if (this.userData.sleekTrim && TRIM.value) addTrim(sh); // 건물: 트림시트 결
    if (this.userData.sleekBake) addBake(sh);              // 밤: 구운 빛(키라이트·옴니)
    else if (this.userData.sleekFlat) addFlat(sh, this.userData.sleekFlat === 'g'); // 밤: 고정 빛(인스턴스·소품·바닥)
    if (this.userData.sleekZS) addZoneShade(sh);           // 낮 바닥: 보이는 공정의 그림자
  };
  m.onBeforeCompile.sleek = true;
  m.customProgramCacheKey = function () { const u = this.userData; return key.call(this) + (u.noSat ? '|nosat' : '|sleekSat') + (u.sleekTrim ? '|trim' : '') + (u.sleekBake ? '|bake' : '') + (u.sleekFlat ? '|flat' + u.sleekFlat : '') + (u.sleekZS ? '|zs' : ''); };
  m.needsUpdate = true; return true;
}

// ---- 건물 트림시트: 모든 건물이 한 장을 같이 쓴다 ----
// 위아래 세 띠(아래 → 위): 바닥 쪽 얼룩(0~1.2m) / 벽 패널(이음매·빗물 자국, 높이 4m마다 반복) / 지붕(자갈).
// 건물 모델에 UV가 없어, 셰이더에서 월드 좌표로 띠를 고른다(벽: 가로 = 수평 좌표, 세로 = 높이 / 지붕: x·z).
// 띠 안에서만 반복하므로 textureGrad로 미분을 이어 이음선(밉맵 경계)이 생기지 않게 한다.
// 결은 서브스턴스 디자이너 식으로 노이즈 → 블러 → 합성. 값 0.5가 '변화 없음'이고 원래 건물 색에 살짝 곱한다(바닥보다 약하게)
const TRIM = { value: null }, TRIM_AMT = { value: 0.4 };
function trimSheet() {
  const W = 512, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const x = c.getContext('2d');
  let k = 2024; const rnd = () => (k = (k * 16807) % 2147483647) / 2147483647;
  const yOf = (v) => H - v * H; // v(아래 0 → 위 1) → 캔버스 y
  x.fillStyle = 'rgb(128,128,128)'; x.fillRect(0, 0, W, H);
  // 노이즈 한 겹: 점을 뿌리고 블러(서브스턴스의 noise → blur). 띠 영역에만, 가로는 이어지게 좌우로 한 번 더 그린다
  const layer = (v0, v1, n, size, amp, blur, alpha) => {
    const t = document.createElement('canvas'); t.width = W; t.height = H; const tx = t.getContext('2d');
    for (let i = 0; i < n; i++) { const px = rnd() * W, py = yOf(v0 + rnd() * (v1 - v0)), r = size * (0.4 + rnd()), g = 128 + (rnd() - 0.5) * 2 * amp;
      tx.fillStyle = `rgb(${g},${g},${g})`; for (const dx of [0, -W, W]) { tx.beginPath(); tx.ellipse(px + dx, py, r, r * (0.6 + rnd() * 0.8), rnd() * 3, 0, 7); tx.fill(); } }
    x.save(); x.beginPath(); x.rect(0, yOf(v1), W, (v1 - v0) * H); x.clip(); x.globalAlpha = alpha; x.filter = `blur(${blur}px)`; x.drawImage(t, 0, 0); x.restore();
  };
  // 아래 띠(바닥 쪽): 아래로 갈수록 어두운 얼룩 + 튄 자국
  const gp = x.createLinearGradient(0, yOf(0.25), 0, yOf(0)); gp.addColorStop(0, 'rgb(128,128,128)'); gp.addColorStop(1, 'rgb(100,100,100)');
  x.fillStyle = gp; x.fillRect(0, yOf(0.25), W, 0.25 * H);
  layer(0, 0.25, 220, 16, 22, 7, 0.7); layer(0, 0.12, 900, 2, 26, 0.6, 0.45);
  // 벽 띠: 큰 얼룩 → 잔 노이즈 → 패널 이음매 → 이음매에서 흘러내린 빗물 자국
  layer(0.25, 0.75, 120, 40, 12, 18, 0.8);
  layer(0.25, 0.75, 5000, 1.4, 10, 0.5, 0.5);
  x.save(); x.beginPath(); x.rect(0, yOf(0.75), W, 0.5 * H); x.clip();
  x.filter = 'blur(0.8px)'; x.fillStyle = 'rgb(92,92,92)';
  for (const v of [0.25, 0.5, 0.75]) x.fillRect(0, yOf(v) - 1.5, W, 3);       // 가로 이음매(2m마다)
  for (const u of [0, 0.5, 1]) x.fillRect(u * W - 1.5, yOf(0.75), 3, 0.5 * H); // 세로 이음매(3m마다)
  x.filter = 'blur(2.5px)';
  for (let i = 0; i < 70; i++) { const px = rnd() * W, top = [0.75, 0.5][i % 2], len = (0.04 + rnd() * 0.16) * H, g = 104 + rnd() * 16;
    const gr = x.createLinearGradient(0, yOf(top), 0, yOf(top) + len); gr.addColorStop(0, `rgba(${g},${g},${g},.75)`); gr.addColorStop(1, `rgba(${g},${g},${g},0)`);
    x.fillStyle = gr; x.fillRect(px, yOf(top), 2 + rnd() * 5, len); }
  x.restore();
  // 위 띠(지붕): 자갈 + 군데군데 얼룩
  layer(0.75, 1, 6000, 1.6, 18, 0.7, 0.6); layer(0.75, 1, 90, 30, 14, 14, 0.7);
  const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; t.anisotropy = 4; // 값 텍스처(색 공간 변환 없음)
  return t;
}
function addTrim(sh) {
  sh.uniforms.uSleekTrim = TRIM; sh.uniforms.uSleekTrimAmt = TRIM_AMT;
  sh.vertexShader = 'varying vec3 vSleekW;\n' + sh.vertexShader.replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 sw = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    sw = instanceMatrix * sw;
  #endif
    vSleekW = (modelMatrix * sw).xyz; }`);
  sh.fragmentShader = 'uniform sampler2D uSleekTrim; uniform float uSleekTrimAmt; varying vec3 vSleekW;\n' + sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
  { vec3 sp = vSleekW, sn = normalize(cross(dFdx(sp), dFdy(sp)));
    vec2 q; float v0, vh;
    if (abs(sn.y) > 0.6) { q = sp.xz / 8.0; v0 = 0.76; vh = 0.23; }                       // 지붕
    else { q = vec2((abs(sn.x) > abs(sn.z) ? sp.z : sp.x) / 6.0, 0.0);
      if (sp.y < 1.2) { q.y = clamp(sp.y / 1.2, 0.0, 0.999); v0 = 0.01; vh = 0.23; }       // 바닥 쪽
      else { q.y = (sp.y - 1.2) / 4.0; v0 = 0.26; vh = 0.48; } }                          // 벽 패널(4m마다)
    float t = textureGrad(uSleekTrim, vec2(q.x, v0 + fract(q.y) * vh), dFdx(q) * vec2(1.0, vh), dFdy(q) * vec2(1.0, vh)).r;
    diffuseColor.rgb *= 1.0 + (t - 0.5) * 2.0 * uSleekTrimAmt; }`);
}
// 건물로 볼 것: 주변 배경 GLB의 일반 메시 중 높이 2.5m 넘는 것(바닥·가로등·나무·인스턴스 소품 제외)
function isBuilding(o) {
  if (o.userData.bld !== undefined) return o.userData.bld;
  let v = false;
  if (o.isMesh && !o.isInstancedMesh && o.name !== 'SITE_GROUND' && !o.userData.lamp && !o.userData.sleekTree && !o.userData.treeProxy && o.material && !o.material.isShaderMaterial) {
    const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3()); v = sz.y > 2.5 && Math.max(sz.x, sz.z) < 150;
  }
  return (o.userData.bld = v);
}
function gradeScene(el, dark) {
  const G = GRADE[dark ? 'dark' : 'light'], S = el.scene; let ch = false;
  if (SAT.value !== G.sat) { SAT.value = G.sat; ch = true; }
  const bakeOn = dark ? 1 : 0; if (BAKE_ON.value !== bakeOn) { BAKE_ON.value = bakeOn; ch = true; } // 구운 밤 조명은 다크 모드에서만
  // 하늘: 원래 코드가 테마 바꿀 때·60초마다 그라데이션을 새로 칠하므로, 내 사본이 아니면 그 원본의 채도 낮춘 사본으로 바꾼다. 2D 도면(단색 배경)은 건드리지 않는다
  const bg = S.background;
  if (!el._2d && bg?.isTexture && !bg.userData.sleekSky && bg.image?.width) { S.background = mutedSky(bg); ch = true; }
  const ext = S.getObjectByName('SITE_BACKDROP_EXT');
  if (ext && !TRIM.value) TRIM.value = trimSheet();
  [el.backdrop, ext, el.ground, el.nightSky].forEach(root => root?.traverse(o => {
    const bld = root === ext && isBuilding(o);
    (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => {
      if (bld && m && !m.userData.sleekTrim && !m.isShaderMaterial) { m.userData.sleekTrim = true; m.needsUpdate = true; ch = true; } // 라이트 모드 명암 굽기가 재질을 새로 만들면 다시 붙는다
      if (desaturate(m)) ch = true;
    });
  }));
  return ch;
}
const isShown = (o) => { for (let p = o; p; p = p.parent) if (!p.visible) return false; return true; };

// 바닥: 그려진 도로·차선 줄은 흐려 지우고(땅·바다 색 구분은 남김), 그 위에 잘게 반복되는 노이즈를 얹어
// 아스팔트처럼 자글자글하게(서브스턴스 디자이너 add noise 느낌). 노이즈는 자체 발광으로 넣어 밤에도 결이 보인다.
// 흐린 바닥 그림은 원본 텍스처(낮·밤)마다 따로 만든다.
let noiseTex = null, lampPool = null;
const baseCache = new Map(), landCache = new Map(); // 원본 지도(낮·밤) → 흐린 바닥 그림 / 땅 마스크
function asphaltGround(el, m, dark) {
  const src = m.map, img = src?.image;
  if (img) {
    // 땅 마스크 먼저(바다 칸을 또렷하게 도려낼 때와, 땅 그림을 흐릴 때 바다 색이 섞이지 않게 할 때 함께 쓴다)
    let L = landCache.get(src);
    if (!L) {
      const N = 1024, canvas = seaMaskCanvas(img, N), sx = canvas.getContext('2d'), sd = sx.getImageData(0, 0, N, N), d = sd.data;
      // 바깥 바다와 이어진 물만 바다로 남긴다: 가장자리 바다 칸에서 출발해 번져 나가고, 땅에 둘러싸인 '바다'(공정 아래 판 등)는 땅으로 메운다
      const sea = new Uint8Array(N * N), q = new Int32Array(N * N); let qh = 0, qt = 0;
      const push = (i) => { if (!sea[i] && d[i * 4] > 127) { sea[i] = 1; q[qt++] = i; } };
      for (let k = 0; k < N; k++) { push(k); push((N - 1) * N + k); push(k * N); push(k * N + N - 1); }
      while (qh < qt) { const i = q[qh++], x = i % N, y = (i / N) | 0; if (x > 0) push(i - 1); if (x < N - 1) push(i + 1); if (y > 0) push(i - N); if (y < N - 1) push(i + N); }
      // 바다 위 작은 '땅' 조각(원본 지도에 그려진 물결 점선이 땅처럼 밝아 남은 것)은 바다로 되돌린다: 땅 덩어리마다 넓이를 재서 작으면 지운다
      const seen = new Uint8Array(N * N), comp = new Int32Array(N * N);
      for (let s0 = 0; s0 < N * N; s0++) {
        if (sea[s0] || seen[s0]) continue;
        let h = 0, t = 0; comp[t++] = s0; seen[s0] = 1;
        while (h < t) { const i = comp[h++], x = i % N, y = (i / N) | 0; for (const j of [x > 0 ? i - 1 : -1, x < N - 1 ? i + 1 : -1, y > 0 ? i - N : -1, y < N - 1 ? i + N : -1]) if (j >= 0 && !sea[j] && !seen[j]) { seen[j] = 1; comp[t++] = j; } }
        if (t < 1500) for (let k = 0; k < t; k++) sea[comp[k]] = 1; // 1500칸(≈590㎡) 미만은 물결 점선으로 본다
      }
      for (let i = 0; i < N * N; i++) { const v = sea[i] ? 0 : 255; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = v; d[i * 4 + 3] = 255; } // 땅=흰색
      sx.putImageData(sd, 0, 0);
      const tex = new THREE.CanvasTexture(canvas); tex.flipY = src.flipY;
      L = { canvas, tex }; landCache.set(src, L);
    }
    m.alphaMap = L.tex; m.alphaTest = 0.5;

    let base = baseCache.get(src);
    if (!base) {
      // 도로·차선 줄은 흐려 지우되, 땅 칸끼리만 섞는다: 바다를 투명하게 비운 뒤 흐리면 캔버스가 투명도를 나눠 주어
      // 해안선 근처 땅에 바다 색이 번져 들어오지 않는다. 마지막에 다시 불투명하게 채운다
      const N = 1024, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
      const t = document.createElement('canvas'); t.width = t.height = N; const tx = t.getContext('2d');
      tx.drawImage(img, 0, 0, N, N);
      const mk = document.createElement('canvas'); mk.width = mk.height = N; const mkx = mk.getContext('2d'), md = mkx.createImageData(N, N), ld = L.canvas.getContext('2d').getImageData(0, 0, N, N).data;
      for (let i = 0; i < N * N; i++) { md.data[i * 4 + 3] = ld[i * 4]; } mkx.putImageData(md, 0, 0); // 땅=불투명
      tx.globalCompositeOperation = 'destination-in'; tx.drawImage(mk, 0, 0);
      x.filter = 'blur(6px)'; x.drawImage(t, 0, 0); x.filter = 'none';
      const bd = x.getImageData(0, 0, N, N); for (let i = 3; i < bd.data.length; i += 4) bd.data[i] = 255; x.putImageData(bd, 0, 0);
      base = new THREE.CanvasTexture(c); base.colorSpace = src.colorSpace; base.flipY = src.flipY; base.wrapS = src.wrapS; base.wrapT = src.wrapT; base.anisotropy = 4;
      baseCache.set(src, base);
    }
    m.map = base; m.userData.myBase = base;
  }
  if (!noiseTex) {
    const n = document.createElement('canvas'); n.width = n.height = 256; const nx = n.getContext('2d'), im = nx.createImageData(256, 256);
    for (let i = 0; i < im.data.length; i += 4) { const r = Math.random(), v = 8 + r * r * 120; im.data[i] = im.data[i + 1] = im.data[i + 2] = v; im.data[i + 3] = 255; }
    nx.putImageData(im, 0, 0);
    noiseTex = new THREE.CanvasTexture(n); noiseTex.wrapS = noiseTex.wrapT = THREE.RepeatWrapping; noiseTex.repeat.set(36, 36); noiseTex.colorSpace = THREE.SRGBColorSpace; noiseTex.anisotropy = 8; // 알갱이 하나 ≈ 0.07m: 너무 잘면 멀리서 평균색으로 뭉개진다
  }
  m.emissiveMap = noiseTex; m.emissive.set(0x50545b); m.emissiveIntensity = 1;
  m.needsUpdate = true;
}

// ---- 밤 조명 굽기(실시간 조명 없이) ----
// 공정: 원래는 하늘빛·달빛·방향광을 실시간으로 받아 하얗게 떠 보였다 → 꼭짓점마다 빛을 미리 계산해 두고(구움) 다크 모드에서는 그 값으로 칠한다.
//   은은한 환경광(위를 볼수록 조금 밝게) + 푸른 달빛 키라이트(명도는 높고 세기는 약하게, 그림자 포함) + 바닥 가까울수록 조금 어둡게. 전체는 원래보다 30% 어둡게 맞췄다.
//   재질은 그대로 두므로(선택 강조·쇳물 발광은 emissive로 계속 더해진다) 원래 색도 그대로(채도 낮추기 안 함).
// 빈터 옴니(NIGHT_OMNI): 명도·채도 낮은 푸른 회색 큰 점광원 3개를 바닥 라이트맵과 주변 건물 꼭짓점에 굽는다. 실제 조명 객체는 만들지 않는다.
const BAKE_ON = { value: 1 };
const KEY_DIR = new THREE.Vector3(-0.85, 0.95, 0.25).normalize();       // 서쪽 위에서 비추는 달빛(드론 시점에서 왼쪽 위)
// 다크 모드 전체 빛 세기: 구운 빛(공정·건물·고정 빛)에 모두 곱한다(1 = 원래). 가로등 빛 웅덩이는 LAMP_GAIN을 한 번 더 곱한다.
// 다크 모드엔 실시간 조명이 없다(nightLights). 화면 전체 밝기(바다·하늘 포함)는 노출 NIGHT_EXPOSURE(원래 0.95)
const NIGHT_LIGHT = 1.8, LAMP_GAIN = 1.3, NIGHT_EXPOSURE = 1.2;
// 빛 색은 더 푸르게(명도는 그대로: 휘도 0.69 / 0.25 유지)
const KEY_COL = new THREE.Color(0.54, 0.70, 0.98), AMB_COL = new THREE.Color(0.20, 0.25, 0.38);
const PROC_GAIN = 0.38 * NIGHT_LIGHT, BLD_GAIN = 1.4 * NIGHT_LIGHT; // 0.38: 켜고 끄며 잰 공정 화면 밝기가 원래의 약 70%(30% 어둡게)가 되는 값
// 위치는 사용자가 표시한 빈터(제강 서쪽 / 오른쪽 긴 건물 쪽 / 왼쪽 아래 높은 건물 쪽). h = 빛 높이, r = 닿는 반경, ground = 바닥 세기, wall = 건물 세기
const NIGHT_OMNI = [{ p: [-52, -26], h: 28, r: 55, ground: 1.0, wall: 1.0 }, { p: [22, 32], h: 28, r: 55, ground: 1.0, wall: 1.0 }, { p: [-55, 40], h: 28, r: 55, ground: 1.0, wall: 1.0 }]; // 사용자 스크린샷의 공정 4곳으로 화면→지면 투영 변환을 세워 구한 좌표
const OMNI_COL = new THREE.Color(0.40, 0.50, 0.70);
function addBake(sh) {
  sh.uniforms.uSleekBakeOn = BAKE_ON;
  sh.vertexShader = 'attribute vec3 sleekBake;\nvarying vec3 vSleekBake;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSleekBake = sleekBake;');
  sh.fragmentShader = 'varying vec3 vSleekBake;\n' + declBakeOn(sh.fragmentShader).replace('#include <opaque_fragment>', `#ifdef STANDARD
  outgoingLight = mix(outgoingLight, diffuseColor.rgb * mix(1.0, 0.55, metalnessFactor) * vSleekBake + totalEmissiveRadiance, uSleekBakeOn);
#endif
#include <opaque_fragment>`);
}
// 고정 빛: 꼭짓점마다 구울 수 없는 것(인스턴스 소품·나무·가로등, 나중에 붙는 제철소 소품, 바닥)은 bakeNight와 같은 빛 식(환경광 + 키라이트)을
// 꼭짓점 셰이더에서 상수로 계산한다. 조명 객체는 쓰지 않는다. 바닥은 키라이트에 구운 그림자 텍스처(GSHADOW)를 곱하고 라이트맵(가로등)은 그대로 더한다.
// FLAT_GAIN 0.75: 원래 실시간 조명(달빛·하늘빛·방향광)으로 위를 보는 면이 받던 밝기와 같게 맞춘 값
const FLAT_GAIN = 0.75 * NIGHT_LIGHT, GSHADOW = { value: Object.assign(new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1), { needsUpdate: true }) }; // 굽기 전엔 그림자 없음(흰색)
const GBOX = { value: new THREE.Vector4(-320, -320, 640, 640) }; // 바닥 판 x·z -320~320
function addFlat(sh, ground) {
  const v3 = (a, b, c) => `vec3(${a.toFixed(3)}, ${b.toFixed(3)}, ${c.toFixed(3)})`, A = AMB_COL, K = KEY_COL, d = KEY_DIR;
  sh.uniforms.uSleekBakeOn = BAKE_ON;
  sh.vertexShader = 'varying vec3 vSleekAmb;\nvarying vec3 vSleekKey;\nvarying vec2 vSleekXZ;\n' + sh.vertexShader
    .replace('#include <defaultnormal_vertex>', `#include <defaultnormal_vertex>
  { vec3 wn = normalize((vec4(transformedNormal, 0.) * viewMatrix).xyz);
    vSleekAmb = ${v3(A.r, A.g, A.b)} * (0.75 + 0.25 * max(0., wn.y)) * ${FLAT_GAIN.toFixed(3)};
    vSleekKey = ${v3(K.r, K.g, K.b)} * max(0., dot(wn, ${v3(d.x, d.y, d.z)})) * ${FLAT_GAIN.toFixed(3)}; }`)
    .replace('#include <project_vertex>', `#include <project_vertex>
  { vec4 sw = vec4(transformed, 1.);
  #ifdef USE_INSTANCING
    sw = instanceMatrix * sw;
  #endif
    vSleekXZ = (modelMatrix * sw).xz; }`);
  sh.fragmentShader = 'varying vec3 vSleekAmb;\nvarying vec3 vSleekKey;\nvarying vec2 vSleekXZ;\n'
    + (ground ? (sh.uniforms.uSleekGShadow = GSHADOW, sh.uniforms.uSleekGBox = GBOX, 'uniform sampler2D uSleekGShadow;\nuniform vec4 uSleekGBox;\n') : '')
    + declBakeOn(sh.fragmentShader).replace('#include <opaque_fragment>', `#ifdef STANDARD
  { float ks = ${ground ? 'texture2D(uSleekGShadow, (vSleekXZ - uSleekGBox.xy) / uSleekGBox.zw).r' : '1.0'};
    outgoingLight = mix(outgoingLight, diffuseColor.rgb * mix(1.0, 0.55, metalnessFactor) * (vSleekAmb + vSleekKey * ks) + reflectedLight.indirectDiffuse + totalEmissiveRadiance, uSleekBakeOn); }
#endif
#include <opaque_fragment>`);
}
// 다크 모드: 구운 빛이 없는 표준 재질에 고정 빛을 단다(새로 생기는 것도 tidyScene이 0.5초마다 잡는다). 새로 훅을 다는 재질은 채도를 그대로 둔다
function flatBake(el) {
  let ch = false;
  el.scene.traverse(o => { if (!o.isMesh) return; [].concat(o.material).forEach(m => {
    if (!m?.isMeshStandardMaterial || m.userData.sleekFlat) return;
    // 장면이 재질을 clone하면 sleekBake 표시는 복사되지만 훅(onBeforeCompile)은 빠진다 → 구운 빛 훅을 다시 단다(꼭짓점 빛이 없으면 고정 빛으로)
    if (m.userData.sleekBake) { if (m.onBeforeCompile.sleek) return; if (!o.geometry.attributes.sleekBake) m.userData.sleekBake = false; else { desaturate(m); ch = true; return; } }
    m.userData.sleekFlat = o.name === 'SITE_GROUND' ? 'g' : 1;
    if (!m.onBeforeCompile.sleek && m.userData.noSat === undefined) m.userData.noSat = true;
    desaturate(m); m.needsUpdate = true; ch = true; }); });
  return ch;
}
// 바닥 그림자: 키라이트 방향 깊이 지도로 바닥(높이 0.05) 1024×1024 칸마다 가려지는지 구워 둔다
function groundShadow(el) {
  const { x: x0, y: z0, z: W, w: D } = GBOX.value, keep = [], setVis = (o, v) => { keep.push([o, o.visible]); o.visible = v; };
  occluders().forEach(o => setVis(o, true)); Object.values(el.zones || {}).forEach(z => setVis(z.root, false)); // 공정 그림자는 바닥에 굳히지 않는다(공정 안 화면에서 숨으므로)
  let lit; try { lit = keyShadow(el, new THREE.Box3(new THREE.Vector3(x0, 0, z0), new THREE.Vector3(x0 + W, 40, z0 + D))); } finally { keep.reverse().forEach(([o, v]) => { o.visible = v; }); }
  const N = 1024, px = new Uint8Array(N * N * 4), w = new THREE.Vector3();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) { w.set(x0 + (i + 0.5) / N * W, 0.05, z0 + (j + 0.5) / N * D); const v = Math.round(lit(w) * 255), k = (j * N + i) * 4; px[k] = px[k + 1] = px[k + 2] = v; px[k + 3] = 255; }
  const t = new THREE.DataTexture(px, N, N); t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t;
}
// 키라이트 방향에서 본 깊이 지도(직교) → 꼭짓점이 가려지는지(그림자)
function keyShadow(el, box) {
  const R = el.renderer, S = el.scene, RES = 2048, c = box.getCenter(new THREE.Vector3()), half = box.getSize(new THREE.Vector3()).length() / 2 + 4;
  const cam = new THREE.OrthographicCamera(-half, half, half, -half, 1, 2000); cam.position.copy(c).addScaledVector(KEY_DIR, 800); cam.lookAt(c); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const dmat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: 'varying float vD; void main(){ vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec4 mv = viewMatrix * modelMatrix * p; vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vD; void main(){ gl_FragColor = vec4(vD, 0., 0., 1.); }' });
  const hidden = []; treeBake(S, true);
  S.traverse(o => { if (!o.visible) return; if (o.name === 'SITE_GROUND' || o.name === 'SLEEK_SEA' || o.name === 'SLEEK_ROADS' || o.isPoints || o.isLine || o.isSprite) { o.visible = false; hidden.push(o); } });
  const bg = S.background, fog = S.fog, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(), tm = R.toneMapping;
  const rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.FloatType }), depth = new Float32Array(RES * RES * 4);
  try { S.background = null; S.fog = null; S.overrideMaterial = dmat; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 1); R.setRenderTarget(rt); R.clear(); R.render(S, cam); R.readRenderTargetPixels(rt, 0, 0, RES, RES, depth); }
  finally { R.setRenderTarget(null); S.overrideMaterial = null; S.background = bg; S.fog = fog; R.toneMapping = tm; R.setClearColor(cc, ca); hidden.forEach(o => { o.visible = true; }); rt.dispose(); dmat.dispose(); treeBake(S, false); }
  const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), q = new THREE.Vector4(), cp = cam.position;
  return (w) => { q.set(w.x, w.y, w.z, 1).applyMatrix4(VP); const u = (q.x / q.w + 1) / 2 * RES, v = (q.y / q.w + 1) / 2 * RES; if (u < 1 || v < 1 || u > RES - 2 || v > RES - 2) return 1;
    const d = cp.clone().sub(w).dot(KEY_DIR); let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = depth[(((v | 0) + dy) * RES + ((u | 0) + dx)) * 4]; if (!z || d <= z + 0.08) n++; } return n / 9; };
}
// 한 메시의 꼭짓점 빛을 계산해 sleekBake 속성으로 넣고, 재질을 복제해 굽기 훅을 단다(공유 재질·지오메트리는 복제해서 다른 메시에 번지지 않게)
const bakedGeo = new Set();
function bakeMesh(o, light, opt) {
  if (o.userData.nightBaked || !o.isMesh || o.isInstancedMesh || !o.material || Array.isArray(o.material) || !o.material.isMeshStandardMaterial) return 0;
  o.userData.nightBaked = true;
  if (bakedGeo.has(o.geometry)) o.geometry = o.geometry.clone(); bakedGeo.add(o.geometry);
  const g = o.geometry; if (!g.attributes.normal) g.computeVertexNormals();
  const P = g.attributes.position, Nn = g.attributes.normal, out = new Float32Array(P.count * 3), w = new THREE.Vector3(), n = new THREE.Vector3(), NM = new THREE.Matrix3().getNormalMatrix(o.matrixWorld), c = new THREE.Color();
  for (let i = 0; i < P.count; i++) {
    w.fromBufferAttribute(P, i).applyMatrix4(o.matrixWorld); n.fromBufferAttribute(Nn, i).applyMatrix3(NM).normalize();
    light(w, n, c); out[i * 3] = c.r; out[i * 3 + 1] = c.g; out[i * 3 + 2] = c.b;
  }
  g.setAttribute('sleekBake', new THREE.BufferAttribute(out, 3));
  const m = o.material.clone(); Object.assign(m.userData, { sleekBake: true, noSat: !!opt.noSat }); o.material = m; desaturate(m);
  return P.count;
}
function omniAt(w, n, c, k) { // 빈터 옴니 기여(거리 감쇠 + 면 방향)
  NIGHT_OMNI.forEach(o => { const lx = o.p[0] - w.x, ly = o.h - w.y, lz = o.p[1] - w.z, d2 = lx * lx + ly * ly + lz * lz, d = Math.sqrt(d2); if (d > o.r) return;
    const ndl = Math.max(0, (n.x * lx + n.y * ly + n.z * lz) / d), fall = (o.h * o.h) / (o.h * o.h + d2) * (1 - d / o.r);
    c.r += OMNI_COL.r * o[k] * ndl * fall * 4; c.g += OMNI_COL.g * o[k] * ndl * fall * 4; c.b += OMNI_COL.b * o[k] * ndl * fall * 4; });
}
function bakeNight(el) {
  const zones = Object.values(el.zones || {}); el.scene.updateMatrixWorld(true);
  const box = new THREE.Box3(); zones.forEach(z => box.expandByObject(z.root)); box.expandByScalar(6);
  const lit = keyShadow(el, box);
  let nv = 0;
  // 공정
  zones.forEach(z => z.root.traverse(o => { nv += bakeMesh(o, (w, n, c) => {
    const sky = 0.75 + 0.25 * Math.max(0, n.y), ndl = Math.max(0, n.dot(KEY_DIR)), sh = ndl > 0 ? lit(w.clone().addScaledVector(n, 0.05)) : 0, ao = 0.82 + 0.18 * Math.min(1, Math.max(0, w.y / 2));
    c.setRGB(AMB_COL.r * sky + KEY_COL.r * ndl * sh, AMB_COL.g * sky + KEY_COL.g * ndl * sh, AMB_COL.b * sky + KEY_COL.b * ndl * sh);
    omniAt(w, n, c, 'wall'); c.multiplyScalar(PROC_GAIN * ao);
  }, { noSat: true }); }));
  // 밤 배경의 주변 건물(지금 보이는 것만 = 밤 GLB): 환경광 + 키라이트(그림자 없이) + 빈터 옴니
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT');
  ext?.traverse(o => { if (!o.isMesh || !isShown(o) || o.name === 'SITE_GROUND' || o.userData.sleekTree || o.userData.treeProxy || o.userData.lamp) return;
    nv += bakeMesh(o, (w, n, c) => {
      const sky = 0.7 + 0.3 * Math.max(0, n.y), ndl = Math.max(0, n.dot(KEY_DIR));
      c.setRGB(AMB_COL.r * sky + KEY_COL.r * ndl * 0.6, AMB_COL.g * sky + KEY_COL.g * ndl * 0.6, AMB_COL.b * sky + KEY_COL.b * ndl * 0.6);
      omniAt(w, n, c, 'wall'); c.multiplyScalar(BLD_GAIN);
    }, { noSat: false }); });
  try { GSHADOW.value = groundShadow(el); } catch (e) { console.warn('바닥 그림자 굽기 실패', e); }
  el._dirty = true; console.info('밤 조명 굽기: 꼭짓점', nv);
}

// ---- 축척 맞추기: 공정 모델 기준(1단위 ≈ 12m: 고로 6.3 ≈ 75m, 토페도카 2.1 ≈ 25m)으로 주변 물체를 줄인다 ----
// 원래는 가로등 7(≈84m), 나무 ≈4.3(≈50m), 건물 높이 중앙값 8(≈96m)로 공정보다 훨씬 컸다.
// 실제 축척을 그대로 따르면 나무가 점처럼 작아져서, 공정이 돋보이는 선에서 줄인다.
// - 건물: 높이만(지면 기준 세로로). 바닥 면을 줄이면 배치가 듬성해지고 도로와 어긋난다. 위에 얹힌 부품도 함께 내려온다
// - 나무: 밑동 기준으로 통째로(줄기·수관). 가로등: 사용자가 표시한 높이(지금의 60%) × 나무 비율
const K_BLD = 0.5, K_TREE = 0.5, K_LAMP = 0.6 * K_TREE;
function scaleBackdrop(el) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (!ext) return false;
  ext.updateMatrixWorld(true);
  // 건물만 고르면 굴뚝 꼭대기 줄무늬 같은 작은 부품이 제자리에 떠 버렸다 → 바닥·바다·나무·인스턴스 소품을 뺀 일반 메시는 모두 같이 줄인다
  const list = []; ext.traverse(o => { if (o.isMesh && !o.isInstancedMesh && !o.userData.scaledY && o.name !== 'SITE_GROUND' && o.name !== 'SLEEK_SEA' && !o.userData.sleekTree && !o.material?.isShaderMaterial) list.push(o); });
  if (!list.length) return false;
  const set = new Set(list), S = new THREE.Matrix4().makeScale(1, K_BLD, 1), W = new THREE.Matrix4(), PI = new THREE.Matrix4();
  list.forEach(o => {
    o.userData.scaledY = true;
    for (let a = o.parent; a && a !== ext; a = a.parent) if (set.has(a)) return; // 부모가 이미 줄었으면 같이 줄어든다(두 번 줄이지 않게)
    W.multiplyMatrices(S, o.matrixWorld); PI.copy(o.parent.matrixWorld).invert();
    o.matrix.multiplyMatrices(PI, W).decompose(o.position, o.quaternion, o.scale); o.updateMatrixWorld(true);
  });
  return true;
}
// 인스턴스마다 밑동(지면) 기준으로 통째로 줄인다
function scaleInstances(o, k) {
  if (o.userData.scaledK) return; o.userData.scaledK = k;
  const M = new THREE.Matrix4(), P = new THREE.Vector3(), A = new THREE.Matrix4(), Sk = new THREE.Matrix4().makeScale(k, k, k), B = new THREE.Matrix4();
  for (let i = 0; i < o.count; i++) {
    o.getMatrixAt(i, M); P.setFromMatrixPosition(M);
    A.makeTranslation(P.x, 0, P.z).multiply(Sk).multiply(B.makeTranslation(-P.x, 0, -P.z)); o.setMatrixAt(i, A.multiply(M));
  }
  o.instanceMatrix.needsUpdate = true; o.computeBoundingSphere?.();
}
const isTrunk = (o) => { if (!o.isInstancedMesh || o.userData.scaledK) return false; o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new THREE.Vector3()); return Math.abs(s.y - 1.6) < 0.2 && s.x < 0.5 && s.z < 0.5 && o.material?.color && o.material.color.r >= o.material.color.b; };

// 테마를 바꾸면 site-backdrop.js가 낮·밤 배경 GLB를 비동기로 바꿔 끼운다. 바뀌기 전(옛 GLB가 아직 붙어 있는 동안)에 새 테마용 굽기를 하면
// 엉뚱한 GLB에 구워진다(밤 건물이 낮 명암 재질로 바뀌고, 밤 바닥에 낮 그림자가 남음). 배경이 실제로 바뀌었거나 6초가 지난 뒤에만 굽는다
function backdropSettled(el) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'), dark = (el.getAttribute('theme') || 'dark') === 'dark';
  if (el.__sDark === undefined) { el.__sDark = dark; return true; }
  if (dark !== el.__sDark) { el.__sDark = dark; el.__sRoot = ext?.children[0]; el.__sT = performance.now(); }
  if (!el.__sRoot) return true;
  if (ext?.children[0] !== el.__sRoot || performance.now() - el.__sT > 6000) { el.__sRoot = null; return true; }
  return false;
}

// ---- 구워 둔 빛과 겹치는 실제 조명 빼기 ----
// - 투광등(site-backdrop.js의 구역 보조광 SpotLight 4개): 원뿔이 바닥에 닿는 자리를 바닥 라이트맵에 굽고(FLOODS → bakeLampLight) 장면에서 뺀다
// - 밤 키라이트(site-backdrop.js, 카메라를 따라가는 방향광): 공정·건물은 구운 키라이트(bakeNight)를 쓰므로 뺀다
// - 구역 조명(scene_v3.js ZONE_LIGHT, 공정 비추는 스포트·포인트): 공정 빛을 구웠으므로 빼면 공정 주변 바닥이 하얗게 뜨지 않는다
// 원래 코드가 세기를 바꿔도 장면에 없으니 그려지지 않는다
const FLOODS = [];
function removeLights(el) {
  const S = el.scene, rm = []; let ch = false;
  S.children.forEach(o => {
    if (o.isSpotLight && o.userData.k !== undefined) { // 투광등
      const p = o.position, t = o.target.position, d = p.distanceTo(t);
      FLOODS.push({ x: t.x, z: t.z, r: d * Math.tan(o.angle) * 1.1, color: '#' + o.color.getHexString() }); rm.push(o, o.target);
    } else if (o.isDirectionalLight && o !== el.sunLight) rm.push(o, o.target); // 밤 키라이트
    else if (o.name === 'ZONE_LIGHT') rm.push(o);
  });
  rm.forEach(o => { S.remove(o); ch = true; });
  return ch;
}

// ---- 먼 건물 지우기: scene_v3.js가 반지름 약 300~500m에 둘러 깐 실루엣(상자·굴뚝·굴뚝 연기 구·창 불빛) ----
// 산 능선(BufferGeometry)·바다·해·달은 남긴다. 배경(낮·밤·시간대)마다 따로 만들어지므로 매번 확인한다
function removeFarBuildings(el, off) {
  let ch = false;
  el.backdrop?.traverse(o => {
    if (!o.isMesh || o.userData.sleekOff || o.userData.farChecked) return; o.userData.farChecked = true;
    const t = o.geometry?.type;
    if (t === 'RingGeometry') { off(o); ch = true; return; } // 먼 바다 링: makeSea의 먼 바다 판으로 대신한다
    if (t === 'CylinderGeometry' && o.geometry.parameters.radiusTop > 1000) { off(o); ch = true; return; } // 수평선 글로우 띠(바다·하늘 사이 층)
    if (!['BoxGeometry', 'CylinderGeometry', 'SphereGeometry', 'PlaneGeometry'].includes(t)) return;
    const p = o.getWorldPosition(new THREE.Vector3()); if (Math.hypot(p.x, p.z) < 250) return;
    off(o); ch = true;
  });
  return ch;
}

// ---- 나무: 공 모양 수관 → 잎 그림 평면을 엇갈려 세운 나무(게임에서 쓰는 크로스 빌보드) ----
// 원래 배경 GLB의 나무는 줄기(가는 원기둥) + 수관(지름 2m 구, 꼭짓점 63개)을 인스턴스로 깔아 덩어리처럼 보였다.
// 수관만 바꾼다: 같은 위치·크기에 세로 평면 3장(60°씩) + 수평 평면 1장. 잎 그림은 캔버스로 그리고(가지·잎 덩어리·빈틈),
// 알파 테스트로 잎 모양만 남긴다. 평면의 법선을 수관 가운데에서 바깥(위로 조금 치우침)으로 잡아 둥근 나무처럼 빛을 받게 한다.
// 그루마다 방향을 무작위로 돌리고 잎 그림 2종을 섞는다. 원래 수관은 숨기되 그림자 굽기 때만 잠깐 보인다(treeBake).
let leafTex = null, crownGeo = null; // leafTex: 잎 그림 2종을 나란히 넣은 아틀라스 한 장
function leafTexture(seed) {
  const N = 512, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  let k = seed; const rnd = () => (k = (k * 16807) % 2147483647) / 2147483647;
  const cx = N / 2, cy = N * 0.47, rx = N * 0.4, ry = N * 0.41;
  // 잎 사이로 비치는 가지
  x.strokeStyle = '#4b3b2d'; x.lineCap = 'round';
  const branch = (x0, y0, a, len, w, d) => { if (!d || w < 1) return; const x1 = x0 + Math.cos(a) * len, y1 = y0 + Math.sin(a) * len;
    x.lineWidth = w; x.beginPath(); x.moveTo(x0, y0); x.lineTo(x1, y1); x.stroke();
    branch(x1, y1, a - 0.35 - rnd() * 0.35, len * 0.72, w * 0.62, d - 1); branch(x1, y1, a + 0.35 + rnd() * 0.35, len * 0.72, w * 0.62, d - 1); };
  branch(cx, N, -Math.PI / 2, N * 0.24, 18, 5);
  // 잎 색: 그늘(어두운 녹색) → 중간 → 해 받는 쪽(연두)
  const C = [[24, 46, 24], [62, 100, 44], [150, 186, 96]];
  const shade = (t) => { t = Math.max(0, Math.min(1, t)); const [a, b, u] = t < 0.5 ? [C[0], C[1], t * 2] : [C[1], C[2], (t - 0.5) * 2];
    return `rgb(${a.map((v, i) => Math.round(v + (b[i] - v) * u)).join(',')})`; };
  const clusters = [];
  for (let i = 0; i < 28; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.8; clusters.push([cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, N * (0.085 + rnd() * 0.07)]); }
  clusters.sort((a, b) => a[1] - b[1]);
  for (const [px, py, pr] of clusters) {
    const up = 1 - (py - (cy - ry)) / (2 * ry); // 수관 위쪽일수록 밝게
    x.fillStyle = shade(0.12 + up * 0.25); x.beginPath(); x.arc(px, py, pr * 0.82, 0, 7); x.fill(); // 덩어리 안쪽 그늘
    for (let j = 0; j < 170; j++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * pr, lx = px + Math.cos(a) * r, ly = py + Math.sin(a) * r;
      const top = 1 - (ly - (py - pr)) / (2 * pr); // 덩어리 위쪽일수록 밝게
      x.fillStyle = shade(up * 0.45 + top * 0.45 + (rnd() - 0.5) * 0.3);
      x.beginPath(); x.ellipse(lx, ly, 3 + rnd() * 4.5, 1.8 + rnd() * 2.4, rnd() * Math.PI, 0, 7); x.fill();
    }
  }
  x.globalCompositeOperation = 'destination-out'; // 잎 사이 빈틈
  for (let i = 0; i < 16; i++) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.7; x.beginPath(); x.arc(cx + Math.cos(a) * rx * r, cy + Math.sin(a) * ry * r, 4 + rnd() * 9, 0, 7); x.fill(); }
  x.globalCompositeOperation = 'source-over';
  const d = x.getImageData(0, 0, N, N).data; let r = 0, g = 0, b = 0, n = 0;
  for (let i = 0; i < d.length; i += 16) if (d[i + 3] > 128) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData.mean = new THREE.Color().setRGB(r / n / 255, g / n / 255, b / n / 255, THREE.SRGBColorSpace); // 잎 그림 평균색(원래 나무 색에 맞출 때 씀)
  return t;
}
// 잎 그림 2종(각 512×512)을 가로로 붙인 아틀라스 1024×512. 평균색은 두 그림의 평균
function leafAtlas() {
  const a = leafTexture(11), b = leafTexture(4567), c = document.createElement('canvas'); c.width = 1024; c.height = 512;
  const x = c.getContext('2d'); x.drawImage(a.image, 0, 0); x.drawImage(b.image, 512, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  t.userData.mean = a.userData.mean.clone().lerp(b.userData.mean, 0.5); a.dispose(); b.dispose(); return t;
}
function crownGeometry() {
  const parts = [0, 1, 2].map(k => new THREE.PlaneGeometry(2.7, 2.9, 4, 4).rotateY(k * Math.PI / 3));
  parts.push(new THREE.PlaneGeometry(2.3, 2.3, 4, 4).rotateX(-Math.PI / 2).translate(0, 0.3, 0)); // 위에서 볼 때
  const pos = [], uv = [], nor = [], idx = []; let off = 0; const v = new THREE.Vector3();
  parts.forEach(g => {
    const P = g.attributes.position, U = g.attributes.uv;
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i); pos.push(v.x, v.y, v.z); uv.push(U.getX(i) * 0.5, U.getY(i)); // 평면 4장이 아틀라스의 같은 칸을 겹쳐 쓴다
      v.y += 0.6; v.normalize(); nor.push(v.x, v.y, v.z); // 수관 가운데에서 바깥으로(위로 조금 치우침) → 둥근 나무처럼 빛을 받는다
    }
    for (let i = 0; i < g.index.count; i += 3) { const A = g.index.getX(i) + off, B = g.index.getX(i + 1) + off, C = g.index.getX(i + 2) + off; idx.push(A, B, C, A, C, B); } off += P.count;
    // 뒷면도 같은 법선의 삼각형을 따로 둔다(DoubleSide는 뒷면에서 법선을 뒤집어, 바깥으로 잡은 법선이 안쪽을 향해 검게 보였다)
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx); g.computeBoundingSphere(); return g;
}
function isCanopy(o) {
  if (!o.isInstancedMesh || o.userData.treeProxy || o.userData.sleekTree || !o.material?.color) return false;
  o.geometry.computeBoundingBox(); const s = o.geometry.boundingBox.getSize(new THREE.Vector3()), c = o.material.color;
  return Math.abs(s.x - 2) < 0.15 && Math.abs(s.y - 2) < 0.15 && Math.abs(s.z - 2) < 0.15 && o.geometry.attributes.position.count < 200 && c.g > c.r && c.g >= c.b; // 지름 2m 녹색 구
}
function replaceTrees(el) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (!ext) return false;
  const found = []; ext.traverse(o => { if (isCanopy(o)) found.push(o); }); if (!found.length) return false;
  ext.traverse(o => { if (isTrunk(o)) scaleInstances(o, K_TREE); }); // 줄기
  found.forEach(o => scaleInstances(o, K_TREE));                         // 수관(그림자 굽기용으로도 쓴다)
  leafTex = leafTex || leafAtlas(); crownGeo = crownGeo || crownGeometry();
  const M = new THREE.Matrix4(), R = new THREE.Matrix4();
  found.forEach((o, oi) => {
    let k = 97 + oi * 31; const rnd = () => (k = (k * 16807) % 2147483647) / 2147483647;
    // 색: 원래 나무 색(낮·밤 GLB마다 다름)에 맞춘다. 잎 그림 평균색이 원래 색이 되도록 곱하는 색을 정한다
    const mean = leafTex.userData.mean, base = o.material.color, mul = new THREE.Color(Math.min(2, base.r / mean.r), Math.min(2, base.g / mean.g), Math.min(2, base.b / mean.b));
    const m = o.material.clone(); Object.assign(m, { map: leafTex, alphaTest: 0.5, transparent: false, side: THREE.FrontSide, shadowSide: THREE.DoubleSide, vertexColors: false, flatShading: false }); m.color.copy(mul);
    // 인스턴스마다 아틀라스 칸(0 = 왼쪽, 1 = 오른쪽)을 고른다: 수관 하나(그리기 1번)로 잎 그림 2종
    m.onBeforeCompile = (sh) => { sh.vertexShader = 'attribute float aVar;\n' + sh.vertexShader.replace('#include <uv_vertex>', '#include <uv_vertex>\n#ifdef USE_MAP\n  vMapUv.x += aVar * 0.5;\n#endif'); };
    m.customProgramCacheKey = () => 'sleekTreeAtlas'; m.needsUpdate = true;
    const geo = crownGeo.clone(), vars = new Float32Array(o.count);
    for (let i = 0; i < o.count; i++) vars[i] = i % 2;
    geo.setAttribute('aVar', new THREE.InstancedBufferAttribute(vars, 1));
    const t = new THREE.InstancedMesh(geo, m, o.count);
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); t.setMatrixAt(i, M.multiply(R.makeRotationY(rnd() * Math.PI * 2))); }
    t.instanceMatrix.needsUpdate = true; t.castShadow = o.castShadow; t.receiveShadow = o.receiveShadow;
    t.name = 'SLEEK_TREE'; t.userData.sleekTree = true; t.raycast = () => {}; t.frustumCulled = false;
    o.parent.add(t);
    // 원래 수관은 숨긴다. 그림자 굽기 때만 보인다(bakeShow) → 바닥·건물에 둥근 나무 그림자가 남는다
    o.userData.treeProxy = true; Object.defineProperty(o, 'visible', { configurable: true, get: () => !!o.userData.bakeShow, set: () => {} });
  });
  return true;
}
// 그림자를 구울 때: 잎 평면은 숨기고 원래 공 모양 수관을 잠깐 보인다(평면이 십자 모양 그림자를 만들지 않게)
function treeBake(S, on) {
  S.traverse(o => {
    if (o.userData.treeProxy) o.userData.bakeShow = on;
    if (o.userData.sleekTree) { if (on) { o.userData.wasVisible = o.visible; o.visible = false; } else o.visible = o.userData.wasVisible ?? true; }
  });
}

// 공정을 가리는 주변 모델 지우기(사용자 표시): 위치 범위로 고른다(낮·밤 배경 GLB 모두 같은 배치)
// - 열간압연 바로 앞(카메라 쪽) 긴 건물 묶음, 연주 앞 흰 탑 무리
// - 공장 안쪽(공정 사이)에 놓인 컨테이너·트럭(인스턴스): 부두·배 위 것은 남기고 안쪽 것만 크기 0으로
const BLOCKER_AREAS = [{ x0: -22, x1: 14, z0: 28, z1: 40 }, { x0: -76, x1: -50, z0: 14, z1: 33 }];
function removeBlockers(el, off) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (!ext) return;
  ext.traverse(o => {
    if (!o.isMesh || o.userData.sleekChecked) return; o.userData.sleekChecked = true;
    if (o.isInstancedMesh) {
      o.geometry.computeBoundingBox(); const g = o.geometry.boundingBox.getSize(new THREE.Vector3());
      const container = Math.abs(g.x - 6) < 0.3 && Math.abs(g.y - 2.4) < 0.3, truck = g.x > 1.5 && g.x < 5.5 && g.y < 1.7 && g.z < 2.2 && g.z > 1.9;
      if (!container && !truck) return;
      const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), S = new THREE.Vector3(), W = new THREE.Vector3();
      for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, M); M.decompose(P, Q, S); W.copy(P).applyMatrix4(o.matrixWorld); if (W.z > -30) { S.setScalar(0); M.compose(P, Q, S); o.setMatrixAt(i, M); } }
      o.instanceMatrix.needsUpdate = true; el._dirty = true; return;
    }
    const c = new THREE.Box3().setFromObject(o).getCenter(new THREE.Vector3());
    if (BLOCKER_AREAS.some(a => c.x > a.x0 && c.x < a.x1 && c.z > a.z0 && c.z < a.z1)) off(o);
  });
}

// ---- 라이트 모드: 소묘처럼 명암을 물체에 구워 넣는다(주변 건물·탱크·굴뚝·나무) ----
// 밝은 면 → 중간톤 → 명암 경계(코어 섀도, 가장 어두움) → 반사광(그늘 안쪽이 바닥 반사로 살짝 밝아짐) + 드리운 그림자 + 바닥 쪽 접지 그림자.
// 해(SUN)에서 본 깊이 지도를 한 번 그려 다른 물체에 가려지는지(드리운 그림자) 판별하고, 꼭짓점마다 명암을 계산해 꼭짓점 색으로 저장한 뒤
// 조명 계산이 없는 재질(MeshBasicMaterial)로 바꾼다 → 이 물체들은 실시간 조명 비용이 0. 밝은 쪽은 살짝 따뜻하게, 그늘은 푸르스름하게.
function bakeChiaroscuro(el, ext) {
  const R = el.renderer, S = el.scene, RES = 2048, L = SUN.clone();
  // 1) 해에서 본 깊이 지도(직교). 깊이는 해 쪽 카메라에서 잰 거리를 float로 그대로 쓴다
  const cam = new THREE.OrthographicCamera(-360, 360, 360, -360, 1, 2400); cam.position.copy(L).multiplyScalar(1000); cam.lookAt(0, 0, 0); cam.updateMatrixWorld(); cam.updateProjectionMatrix();
  const dmat = new THREE.ShaderMaterial({ side: THREE.DoubleSide,
    vertexShader: 'varying float vD; void main(){ vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec4 mv = viewMatrix * modelMatrix * p; vD = -mv.z; gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying float vD; void main(){ gl_FragColor = vec4(vD, 0., 0., 1.); }' });
  const hidden = [];
  treeBake(S, true);
  S.traverse(o => { if (!o.visible) return; if (o.name === 'SITE_GROUND' || o.name === 'SLEEK_SEA' || o.name === 'SLEEK_ROADS' || o.isPoints || o.isLine || o.isSprite) { o.visible = false; hidden.push(o); } });
  const bg = S.background, fog = S.fog, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(), tm = R.toneMapping;
  const rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.FloatType }), depth = new Float32Array(RES * RES * 4);
  try { S.background = null; S.fog = null; S.overrideMaterial = dmat; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 1); R.setRenderTarget(rt); R.clear(); R.render(S, cam); R.readRenderTargetPixels(rt, 0, 0, RES, RES, depth); }
  finally { R.setRenderTarget(null); S.overrideMaterial = null; S.background = bg; S.fog = fog; R.toneMapping = tm; R.setClearColor(cc, ca); hidden.forEach(o => { o.visible = true; }); rt.dispose(); dmat.dispose(); treeBake(S, false); }
  const VP = new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse), q = new THREE.Vector4(), camPos = cam.position;
  const lit = (w) => { // 0 = 완전히 가려짐, 1 = 해가 닿음 (3×3 칸 평균으로 가장자리를 부드럽게)
    q.set(w.x, w.y, w.z, 1).applyMatrix4(VP); const u = (q.x / q.w + 1) / 2 * RES, v = (q.y / q.w + 1) / 2 * RES; if (u < 1 || v < 1 || u > RES - 2 || v > RES - 2) return 1;
    const d = camPos.clone().sub(w).dot(L); // 해 쪽 카메라에서 잰 깊이(깊이 지도와 같은 기준)
    let n = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const z = depth[(((v | 0) + dy) * RES + ((u | 0) + dx)) * 4]; if (!z || d <= z + 0.6) n++; } return n / 9; };
  // 2) 명암 단계(소묘): d = 면이 해를 향하는 정도(-1~1)
  const g = (x) => Math.pow(Math.max(0, x), 2.2); // 화면 밝기 → 선형
  const tone = (d, ny, y, sun) => {
    let v;
    if (ny > 0.75) v = 0.9 + 0.12 * Math.max(0, d);                        // 윗면: 하늘을 봐서 밝게
    else if (d > 0) v = 0.7 + 0.36 * Math.min(1, d * 1.25) + (d > 0.93 ? 0.05 : 0); // 중간톤 → 밝은 면 (+하이라이트)
    else v = 0.52 + 0.195 * Math.min(1, Math.max(0, (-d - 0.2) / 0.8));   // 명암 경계(0.52) → 반사광(0.715)  (처음 값의 1.3배)
    v += (Math.min(v, 0.6) - v) * sun;                                      // 드리운 그림자(sun 0~1)만큼 그늘 밝기(0.6)로
    v *= 0.86 + 0.14 * Math.min(1, Math.max(0, y / 3));                     // 바닥 쪽 접지 그림자(어둡게 하는 양 30% 줄임)
    const shade = 1 - Math.min(1, v);                                       // 어두울수록 푸르게, 밝을수록 따뜻하게
    return [g(v * (1.0 - shade * 0.1)), g(v * (0.985 - shade * 0.05)), g(v * (0.95 + shade * 0.12))];
  };
  const P = new THREE.Vector3(), N = new THREE.Vector3(), NM = new THREE.Matrix3(), M = new THREE.Matrix4(), IM = new THREE.Matrix4();
  ext.updateMatrixWorld(true);
  ext.traverse(o => {
    if (!o.isMesh || o.name === 'SITE_GROUND' || o.userData.sleekOff || o.userData.sleekTree || o.userData.treeProxy || !o.material || Array.isArray(o.material) || o.material.isShaderMaterial) return;
    const geo = o.geometry.clone(); if (!geo.attributes.normal) geo.computeVertexNormals();
    const pos = geo.attributes.position, nor = geo.attributes.normal, col = new Float32Array(pos.count * 3);
    const base = o.isInstancedMesh ? (o.getMatrixAt(0, IM), M.multiplyMatrices(o.matrixWorld, IM)) : o.matrixWorld;
    NM.getNormalMatrix(base);
    for (let i = 0; i < pos.count; i++) {
      P.fromBufferAttribute(pos, i).applyMatrix4(base); N.fromBufferAttribute(nor, i).applyMatrix3(NM).normalize();
      const d = N.dot(L), sunBlock = o.isInstancedMesh || d <= 0 ? 0 : 1 - lit(P.clone().addScaledVector(N, 0.25));
      const c = tone(d, N.y, P.y, sunBlock); col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3)); o.geometry = geo;
    if (o.isInstancedMesh) { // 인스턴스마다 드리운 그림자 정도 → instanceColor
      const ic = new Float32Array(o.count * 3); for (let k = 0; k < o.count; k++) { o.getMatrixAt(k, IM); P.setFromMatrixPosition(M.multiplyMatrices(o.matrixWorld, IM)); P.y += 1; const s2 = 0.55 + 0.45 * lit(P); ic[k * 3] = ic[k * 3 + 1] = s2; ic[k * 3 + 2] = Math.min(1, s2 * 1.05); }
      o.instanceColor = new THREE.InstancedBufferAttribute(ic, 3);
    }
    const m = o.material;
    o.material = new THREE.MeshBasicMaterial({ color: m.color, map: m.map || null, vertexColors: true, transparent: m.transparent, opacity: m.opacity, side: m.side, alphaTest: m.alphaTest });
  });
  el._dirty = true;
}

// 하늘의 해 원판·빛무리를 그림자 반대쪽(햇빛이 오는 2시 방향)으로 옮긴다. 원래 코드는 남서쪽 하늘 고정이라 빛 방향과 어긋났다.
// 방향(방위)은 SUN과 같게, 높이는 화면에 보이도록 수평선 바로 위(8°). 거리는 원래대로
function placeSunDisc(el) {
  const h = new THREE.Vector2(SUN.x, SUN.z).normalize(), e = 8 * Math.PI / 180;
  el.backdrop?.children.forEach(o => {
    if (!o.isMesh || o.geometry.type !== 'CircleGeometry' || o.geometry.parameters.radius < 25 || o.userData.sleekSun) return;
    const R = o.position.length(); if (R < 400) return;
    o.position.set(h.x * Math.cos(e) * R, Math.sin(e) * R, h.y * Math.cos(e) * R); o.lookAt(0, 20, 0); o.userData.sleekSun = true; el._dirty = true;
  });
}

// 다크 모드 실시간 조명 끄기: 밤 빛은 모두 구워 두었다(공정·건물 = bakeNight, 나머지 = addFlat, 바닥 가로등 = 라이트맵).
// 그래서 장면의 조명을 모두 끄고(빛 계산·그림자 지도 그리기 없음), 라이트 모드에선 내가 끈 것만 다시 켠다.
// 장면이 나중에 붙이는 빛(쇳물 이동 빛 = scene_v3.js의 this.material, 설비 작동 효과 빛 = 장면에 새로 붙는 그룹)은 그리기 직전에 꺼서
// 빛 개수가 바뀌어 셰이더를 다시 만드는 일이 없게 한다(새로 붙은 장면 자식만 훑는다)
function nightLights(el, dark) {
  let ch = false; el.__nightOff = dark;
  const hide = (o) => { if (o.isLight && o.visible) { o.visible = false; o.userData.sleekNightOff = true; return true; } return false; };
  if (!el.__nightHook) { el.__nightHook = true; const prev = el.scene.onBeforeRender, known = new WeakSet();
    el.scene.onBeforeRender = function (...a) { prev?.apply(this, a);
      ZON.value.set(...IDS.map(id => (el.zones?.[id] && isShown(el.zones[id].root) ? 1 : 0))); // 낮 바닥의 공정 그림자: 지금 보이는 공정만
      if (!el.__nightOff) return;
      el.material?.traverse?.(hide); for (const c of el.scene.children) if (!known.has(c)) { known.add(c); c.traverse(hide); } }; }
  el.scene.traverse(o => { if (!o.isLight) return;
    if (dark) { if (hide(o)) ch = true; } else if (o.userData.sleekNightOff) { o.visible = true; o.userData.sleekNightOff = false; ch = true; } });
  if (dark && flatBake(el)) ch = true;
  if (ch) el._dirty = true;
}

// 라이트 모드 입체감: 사방에서 고르게 밝히는 환경광을 줄이고(건물 0.3), 하늘빛도 줄이고, 2시 방향 햇빛을 세게.
// 상자는 해 받는 면/반대 면 차이가, 실린더는 빛 방향으로 밝다가 어두워지는 그라데이션이 살아난다. (원래 코드가 되돌려도 계속 맞춘다)
function lightContrast(el) {
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT');
  // (바닥 SITE_GROUND는 원래 밝기 유지)
  ext?.traverse(o => { if (o.isMesh && o.name !== 'SITE_GROUND' && o.material && o.material.envMapIntensity !== undefined && !o.material.userData.sleekEnv) { o.material.envMapIntensity = 0.3; o.material.userData.sleekEnv = true; o.material.needsUpdate = true; } });
  const h = el.hemiLight, sun = el.sunLight; let ch = false;
  if (h && Math.abs(h.intensity - 0.36) > 1e-3) { h.intensity = 0.36; h.groundColor.set(0x4a5160); ch = true; }
  if (sun && Math.abs(sun.intensity - 2.7) > 1e-3) { sun.intensity = 2.7; sun.color.set(0xfff1dd); ch = true; }
  if (ch) el._dirty = true;
}

// 바닥 지도 좌표: 바닥 판은 x·z 모두 -320~320. 캔버스 가로 = x, 세로 0행 = 남쪽(z=+320)
const GX = (x, N) => (x + 320) / 640 * N, GY = (z, N) => (320 - z) / 640 * N;

// 차가 다니는 경로를 따라 도로를 3D 면으로 깐다(바닥 그림에 칠하면 확대할 때 픽셀이 깨져서). 어떤 배율에서도 가장자리가 깔끔하다.
// - 구간마다 사각형 + 꺾이는 점마다 원 → 둥글게 이어진 띠. 연석(조금 넓게) 위에 아스팔트 면을 얹는다
// - 바닥 색에 '곱해' 그린다: 구워 둔 햇빛 그림자·가로등 빛이 도로 위에도 이어진다
// - 스텐실로 화면 한 칸에 한 번만 칠한다: 겹치는 곳(교차로·이음매)이 더 진해지지 않고 한 면으로 합쳐진다
function buildRoads(el) {
  const paths = [...new Set((el._traffic?.cars || []).map(c => c.path))];
  if (!paths.length) return null;
  const ribbon = (half) => {
    const pos = [], push = (x, z) => pos.push(x, 0, z);
    paths.forEach(pa => {
      const P = pa.P;
      for (let i = 0; i < P.length - 1; i++) {
        const a = P[i], b = P[i + 1], dx = b.x - a.x, dz = b.y - a.y, L = Math.hypot(dx, dz) || 1, nx = -dz / L * half, nz = dx / L * half;
        push(a.x + nx, a.y + nz); push(b.x + nx, b.y + nz); push(b.x - nx, b.y - nz);
        push(a.x + nx, a.y + nz); push(b.x - nx, b.y - nz); push(a.x - nx, a.y - nz);
      }
      P.forEach(q => { const n = 20; for (let k = 0; k < n; k++) { const t0 = k / n * Math.PI * 2, t1 = (k + 1) / n * Math.PI * 2; push(q.x, q.y); push(q.x + Math.cos(t1) * half, q.y + Math.sin(t1) * half); push(q.x + Math.cos(t0) * half, q.y + Math.sin(t0) * half); } });
    });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); return g;
  };
  const layer = (half, ref, order, y) => {
    const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, toneMapped: false,
      blending: THREE.MultiplyBlending, premultipliedAlpha: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      stencilWrite: true, stencilRef: ref, stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    const mesh = new THREE.Mesh(ribbon(half), m); mesh.position.y = y; mesh.renderOrder = order; mesh.raycast = () => {}; return mesh;
  };
  const g = new THREE.Group(); g.name = 'SLEEK_ROADS';
  const curb = layer(4.3, 1, 3, 0.03), road = layer(3.7, 2, 4, 0.04);
  g.add(curb, road); el.scene.add(g);
  return { setTheme(dark) { curb.material.color.setScalar(dark ? 0.82 : 0.9); road.material.color.setScalar(dark ? 0.62 : 0.66); el._dirty = true; } }; // 곱하는 값: 연석은 살짝, 아스팔트는 더 어둡게(연석 위에 겹쳐 곱해짐)
}

// ---- 라이트 모드: 2시 방향 햇빛 그림자를 바닥 그림에 한 번 구워 넣는다(실시간 그림자 계산 없음) ----
// 실제 그림자처럼: 물체에 붙은 곳은 날카롭고 진하게, 물체에서 멀어질수록(= 해를 가린 부분이 땅에서 높을수록) 넓게 풀리고 옅게.
// 1) 위에서 내려다보는 직교 카메라로 모든 물체를 '해 반대쪽 바닥에 눕힌 모양'(평면 투영)으로 그리되, 그 칸을 가린 부분의 높이를 함께 기록한다
//    (여러 부분이 겹치면 가장 낮은 것 = 가장 가까운 가림을 남긴다: 깊이값을 높이로 써서 깊이 테스트로 고름)
// 2) 칸마다 그 높이에 비례해 흐림 반경을 정하고(여러 단계로 흐린 그림자 중에서 골라 섞음), 높을수록 옅게
// 3) 물체 바로 밑 접지 그림자(수직 투영)를 좁게 흐려 더한다 → 바닥 색에 곱한다(푸른 회색 그림자)
// 공정(장면 zones)은 공정 안 화면에서 다른 공정이 숨으므로, 바닥 그림에 같이 구우면 숨은 공정의 그림자만 바닥에 남는다.
// 그래서 정적인 것(주변 건물·나무·소품)은 바닥 그림에 굽고(onlyZone 없음, 공정은 뺀다), 공정은 하나씩 따로 구워(zoneSunShadows)
// 보이는 공정 것만 바닥 셰이더가 곱한다(addZoneShade). 공정 안 화면에서 잠깐 숨긴 건물(hideOccluders)도 그림자는 굽는다.
// 돌려주는 값: 칸마다 그림자 진하기(0~1), 0행 = 남쪽
const SUN_RES = 1024;
function sunShadeBuf(el, onlyZone) {
  const R = el.renderer, S = el.scene, RES = SUN_RES, PX = 640 / RES; // 한 칸 = 0.625m
  const keep = [], setVis = (o, v) => { keep.push([o, o.visible]); o.visible = v; };
  occluders().forEach(o => setVis(o, true));
  if (onlyZone) { let top = onlyZone.root; while (top.parent && top.parent !== S) top = top.parent; S.children.forEach(c => setVis(c, c === top)); for (let o = onlyZone.root; o && o !== S; o = o.parent) setVis(o, true); } else Object.values(el.zones || {}).forEach(z => setVis(z.root, false));
  try {
  const cam = new THREE.OrthographicCamera(-320, 320, 320, -320, 1, 3000); cam.position.set(0, 1500, 0); cam.up.set(0, 0, -1); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
  const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, uniforms: { uK: { value: new THREE.Vector2() } },
    vertexShader: 'uniform vec2 uK; varying float vH; void main(){ vec4 p = vec4(position, 1.);\n#ifdef USE_INSTANCING\n p = instanceMatrix * p;\n#endif\n vec4 w = modelMatrix * p; vH = max(w.y, 0.); w.xz -= uK * vH; w.y = 0.; vec4 c = projectionMatrix * viewMatrix * w; c.z = (vH / 400.) * 2. - 1.; gl_Position = c; }',
    fragmentShader: 'varying float vH; void main(){ gl_FragColor = vec4(vH, 1., 0., 1.); }' });
  const hidden = [], box = new THREE.Box3();
  treeBake(S, true);
  S.traverse(o => { if (!o.visible) return;
    const flat = o.isMesh && !o.isInstancedMesh && (box.setFromObject(o), box.max.y < 0.6);
    if (o.name === 'SITE_GROUND' || o.name === 'SLEEK_SEA' || o.parent?.name === 'SLEEK_ROADS' || o.isPoints || o.isLine || o.isSprite || flat) { o.visible = false; hidden.push(o); } });
  const bg = S.background, fog = S.fog, cc = R.getClearColor(new THREE.Color()), ca = R.getClearAlpha(), tm = R.toneMapping;
  const rt = new THREE.WebGLRenderTarget(RES, RES, { type: THREE.FloatType, depthBuffer: true });
  const read = (k) => { mat.uniforms.uK.value.copy(k); R.setRenderTarget(rt); R.clear(); R.render(S, cam); const b = new Float32Array(RES * RES * 4); R.readRenderTargetPixels(rt, 0, 0, RES, RES, b); return b; };
  let sunBuf, aoBuf;
  try { S.background = null; S.fog = null; S.overrideMaterial = mat; R.toneMapping = THREE.NoToneMapping; R.setClearColor(0x000000, 0);
    sunBuf = read(new THREE.Vector2(SUN.x / SUN.y, SUN.z / SUN.y)); aoBuf = read(new THREE.Vector2(0, 0)); }
  finally { R.setRenderTarget(null); S.overrideMaterial = null; S.background = bg; S.fog = fog; R.toneMapping = tm; R.setClearColor(cc, ca); hidden.forEach(o => { o.visible = true; }); rt.dispose(); mat.dispose(); treeBake(S, false); }

  const n = RES * RES, mask = new Float32Array(n), hgt = new Float32Array(n), foot = new Float32Array(n);
  for (let i = 0; i < n; i++) { const m = sunBuf[i * 4 + 1] > 0.5 ? 1 : 0; mask[i] = m; hgt[i] = m * sunBuf[i * 4]; foot[i] = aoBuf[i * 4 + 1] > 0.5 ? 1 : 0; }
  // 가로·세로로 나눠 하는 상자 흐림(두 번 하면 가우스에 가깝다)
  const boxBlur = (src, r) => { if (r < 0.5) return src; r = Math.round(r); const tmp = new Float32Array(n), out = new Float32Array(n), w = 2 * r + 1;
    for (let y = 0; y < RES; y++) { let acc = 0; const row = y * RES; for (let x = -r; x <= r; x++) acc += src[row + Math.min(RES - 1, Math.max(0, x))]; for (let x = 0; x < RES; x++) { tmp[row + x] = acc / w; acc += src[row + Math.min(RES - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < RES; x++) { let acc = 0; for (let y = -r; y <= r; y++) acc += tmp[Math.min(RES - 1, Math.max(0, y)) * RES + x]; for (let y = 0; y < RES; y++) { out[y * RES + x] = acc / w; acc += tmp[Math.min(RES - 1, y + r + 1) * RES + x] - tmp[Math.max(0, y - r) * RES + x]; } }
    return out; };
  const blur2 = (src, r) => boxBlur(boxBlur(src, r / 1.6), r / 1.6);
  const RADII = [0, 1, 2, 4, 7, 11], levels = RADII.map(r => blur2(mask, r));
  // 칸 주변(그림자 밖 반영 칸 포함)의 '가린 부분 높이' 평균
  const wide = blur2(mask, 12), hAvg = blur2(hgt, 12);
  const ao = blur2(foot, 2.5), shade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    if (wide[i] > 0.002) {
      const h = mask[i] ? hgt[i] : hAvg[i] / wide[i];        // 이 칸을 가린 높이(그림자 밖이면 주변 평균)
      const rp = (0.12 + h * 0.07) / PX;                      // 흐림 반경(칸): 높을수록(= 물체에서 멀수록) 넓게
      let k = 0; while (k < RADII.length - 2 && RADII[k + 1] < rp) k++;
      const t = Math.min(1, Math.max(0, (rp - RADII[k]) / (RADII[k + 1] - RADII[k])));
      const v = levels[k][i] * (1 - t) + levels[k + 1][i] * t;
      const dens = 0.6 * (1 - 0.55 * Math.min(1, h / 45));    // 진하기: 붙은 곳 0.6 → 멀리 0.27
      s = v * dens;
    }
    const a = ao[i] * 0.2;                                     // 접지 그림자
    shade[i] = 1 - (1 - s) * (1 - a);
  }
  // 읽은 픽셀 0행 = 화면 아래 = 남쪽 → 바닥 캔버스와 같은 방향
    return shade;
  } finally { keep.reverse().forEach(([o, v]) => { o.visible = v; }); }
}
function bakeSunShadow(el, ground, baseTex) {
  const RES = SUN_RES, n = RES * RES, shade = sunShadeBuf(el, null);
  const sc = document.createElement('canvas'); sc.width = sc.height = RES; const sx = sc.getContext('2d'), im = sx.createImageData(RES, RES);
  for (let i = 0; i < n; i++) { im.data[i * 4] = 0x2b; im.data[i * 4 + 1] = 0x35; im.data[i * 4 + 2] = 0x50; im.data[i * 4 + 3] = Math.round(Math.min(1, shade[i]) * 255); } // 그림자 색: 푸른 회색
  sx.putImageData(im, 0, 0);
  const c = baseTex.image, x = c.getContext('2d');
  // 곱하기: 투명한 곳은 그대로, 그림자 칸은 푸른 회색 쪽으로
  const m = document.createElement('canvas'); m.width = m.height = c.width; const mx = m.getContext('2d'); mx.fillStyle = '#fff'; mx.fillRect(0, 0, c.width, c.height); mx.drawImage(sc, 0, 0, c.width, c.height);
  x.save(); x.globalCompositeOperation = 'multiply'; x.drawImage(m, 0, 0); x.restore();
  baseTex.needsUpdate = true;
}

// 공정 그림자: 공정마다 RGBA 한 채널(IDS 순서)에 구워 두고, 바닥 셰이더가 지금 보이는 공정(ZON) 것만 곱한다.
// 모델이 다 실린 공정부터 한 번에 하나씩 굽는다(한꺼번에 굽는 멈칫거림을 나눔). 굽기 결과 0행(남쪽)을 그대로 0행에 넣는다(바닥 UV와 맞춤: 화면에서 확인)
const ZSHADE = { value: Object.assign(new THREE.DataTexture(new Uint8Array(SUN_RES * SUN_RES * 4), SUN_RES, SUN_RES), { magFilter: THREE.LinearFilter, minFilter: THREE.LinearFilter, needsUpdate: true }) };
const ZON = { value: new THREE.Vector4() }, zoneShadeDone = new Set();
function zoneSunShadows(el) {
  for (let i = 0; i < IDS.length; i++) {
    const id = IDS[i], z = el.zones?.[id]; if (zoneShadeDone.has(id) || !z?.root?.getObjectByName('GLB_' + id)) continue;
    zoneShadeDone.add(id); const sh = sunShadeBuf(el, z), d = ZSHADE.value.image.data, N = SUN_RES;
    for (let r = 0; r < N; r++) for (let x = 0; x < N; x++) d[(r * N + x) * 4 + i] = Math.round(Math.min(1, sh[r * N + x]) * 255);
    ZSHADE.value.needsUpdate = true; el._dirty = true; return true;
  }
  return false;
}
function addZoneShade(sh) { // 라이트 모드 바닥: 보이는 공정의 그림자를 바닥 그림처럼 푸른 회색으로 곱한다(canvas 곱하기와 같게 sRGB에서 섞고 선형으로)
  sh.uniforms.uSleekZS = ZSHADE; sh.uniforms.uSleekZOn = ZON; sh.uniforms.uSleekBakeOn = BAKE_ON;
  sh.fragmentShader = 'uniform sampler2D uSleekZS;\nuniform vec4 uSleekZOn;\n' + declBakeOn(sh.fragmentShader).replace('#include <map_fragment>', `#include <map_fragment>
#ifdef USE_MAP
  { vec4 zs = texture2D(uSleekZS, vMapUv) * uSleekZOn; float s = 1.0 - (1.0 - zs.r) * (1.0 - zs.g) * (1.0 - zs.b) * (1.0 - zs.a);
    diffuseColor.rgb *= mix(vec3(1.0), pow(mix(vec3(1.0), vec3(0.169, 0.208, 0.314), s), vec3(2.2)), 1.0 - uSleekBakeOn); }
#endif`);
}
const declBakeOn = (src) => src.includes('uniform float uSleekBakeOn;') ? src : 'uniform float uSleekBakeOn;\n' + src;

// 바닥 그림에서 바다 칸을 가린다: 빨강 값의 분포를 오츠 문턱값으로 둘로 나눈다. 바다=흰색 캔버스를 돌려준다
function seaMaskCanvas(img, N) {
  const mc = document.createElement('canvas'); mc.width = mc.height = N; const mx = mc.getContext('2d');
  mx.drawImage(img, 0, 0, N, N); const im = mx.getImageData(0, 0, N, N), d = im.data;
  const hist = new Array(256).fill(0), val = new Uint8Array(N * N);
  for (let i = 0; i < N * N; i++) { const v = 255 - d[i * 4]; val[i] = v; hist[v]++; } // 빨강이 낮을수록 바다: 낮(바다 72·땅 160대)·밤(바다 10·땅 22~34) 모두 갈린다
  let sum = 0, sumB = 0, wB = 0, best = 0, th = 140; for (let i = 0; i < 256; i++) sum += i * hist[i];
  for (let i = 0; i < 256; i++) { wB += hist[i]; if (!wB) continue; const wF = N * N - wB; if (!wF) break; sumB += i * hist[i]; const mB = sumB / wB, mF = (sum - sumB) / wF, v = wB * wF * (mB - mF) ** 2; if (v > best) { best = v; th = i; } }
  for (let i = 0; i < N * N; i++) { const k = val[i] > th ? 255 : 0; d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = k; d[i * 4 + 3] = 255; }
  mx.putImageData(im, 0, 0); return mc;
}

// ---- 바다: 실시간 반사 계산 없이 UV 스크롤로 ----
// 땅 바닥이 바다 칸을 도려내고(seaMaskCanvas), 그보다 살짝 낮게 바다 판 하나를 깐다.
// 물결 무늬 두 겹 + 반짝임 점 두 겹이 서로 다른 방향·속도로 흐르고, 두 반짝임이 겹치는 곳만 빛나 구운 햇빛 반짝임처럼 보인다.
// 비스듬히 볼수록 하늘색이 비친다(프레넬). 라이트 모드는 반짝임을 세게, 다크 모드는 달빛처럼 약하게.
function makeSea(el, ground) {
  if (!ground.material.alphaMap) return 'none'; // 땅이 바다 칸을 도려내지 못했으면 바다를 깔지 않는다
  const tile = (fn, size = 256) => { const t = document.createElement('canvas'); t.width = t.height = size; fn(t.getContext('2d'), size); const tx = new THREE.CanvasTexture(t); tx.wrapS = tx.wrapT = THREE.RepeatWrapping; return tx; };
  const rnd = (() => { let k = 7; return () => (k = (k * 16807) % 2147483647) / 2147483647; })();
  const wave = tile((x, S) => { x.fillStyle = '#808080'; x.fillRect(0, 0, S, S); x.filter = 'blur(10px)'; for (let i = 0; i < 260; i++) { const u = rnd() * S, v = rnd() * S, r = 6 + rnd() * 22; x.fillStyle = 'rgba(' + (rnd() > .5 ? 255 : 0) + ',' + (rnd() > .5 ? 255 : 0) + ',255,' + (0.15 + rnd() * 0.25).toFixed(2) + ')'; for (const [dx, dy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) { x.beginPath(); x.ellipse(u + dx, v + dy, r * 1.8, r * 0.7, 0, 0, 7); x.fill(); } } });
  const glint = tile((x, S) => { x.fillStyle = '#000'; x.fillRect(0, 0, S, S); x.filter = 'blur(0.6px)'; for (let i = 0; i < 900; i++) { const u = rnd() * S, v = rnd() * S, r = 0.6 + rnd() * 1.6; x.fillStyle = 'rgba(255,255,255,' + (0.4 + rnd() * 0.6).toFixed(2) + ')'; x.beginPath(); x.ellipse(u, v, r * 2.2, r * 0.8, 0, 0, 7); x.fill(); } });

  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: { uWave: { value: wave }, uGlint: { value: glint }, uTime: { value: 0 },
      uDeep: { value: new THREE.Color() }, uShallow: { value: new THREE.Color() }, uSky: { value: new THREE.Color() }, uSun: { value: -1 },
      uHaze: SEA_FAR, uCen: { value: new THREE.Vector2() }, uEdge: { value: 1 } },
    vertexShader: 'varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position, 1.); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: [
      'uniform sampler2D uWave, uGlint; uniform float uTime, uSun, uEdge; uniform vec3 uDeep, uShallow, uSky, uHaze; uniform vec2 uCen; varying vec2 vUv; varying vec3 vW;',
      'void main(){',
      '  float t = uTime;',
      '  vec2 w1 = texture2D(uWave, vUv * 34. - vec2(t * .012, 0.)).rg, w2 = texture2D(uWave, vUv * 47. - vec2(t * .007, t * .0015)).rg;', // 왼쪽 → 오른쪽으로 흐른다
      '  float h = (w1.r + w2.g) * .5;',
      '  vec3 col = mix(uDeep, uShallow, smoothstep(.2, .9, h) * .7);',
      '  float f = pow(1. - clamp(normalize(cameraPosition - vW).y, 0., 1.), 3.);',
      '  col = mix(col, uSky, f * .55);',
      '  vec2 jit = (w1 - .5) * .004;',
      '  float g1 = texture2D(uGlint, vUv * 90. + jit - vec2(t * .018, 0.)).r, g2 = texture2D(uGlint, vUv * 70. - jit - vec2(t * .011, 0.)).r;',
      '  float hz = smoothstep(120., 2400., length(vW.xz - uCen));',
      '  col = mix(col, uHaze, hz);',
      '  float glint = pow(g1 * g2, 1.6) * 2.4 * uSun * (.4 + f) * (1. - hz);',
      '  float edge = smoothstep(0., .12, vUv.x) * smoothstep(0., .12, 1. - vUv.x) * smoothstep(0., .12, vUv.y) * smoothstep(0., .12, 1. - vUv.y);', // 판 끝은 서서히 사라지게
      '  gl_FragColor = vec4(col + vec3(glint), mix(1., edge, uEdge));',
      '  #include <tonemapping_fragment>',
      '  #include <colorspace_fragment>', // 다른 재질과 같은 색 변환(선형 → 화면 sRGB)
      '}'].join('\n'),
  });
  const gb = new THREE.Box3().setFromObject(ground), sz = gb.getSize(new THREE.Vector3()), cen = gb.getCenter(new THREE.Vector3());
  const geo = new THREE.PlaneGeometry(sz.x, sz.z); geo.rotateX(-Math.PI / 2);
  // 바닥 UV와 같게: u = (x - minX)/W, v = (maxZ - z)/D
  const P = geo.attributes.position, U = geo.attributes.uv; for (let i = 0; i < P.count; i++) U.setXY(i, (P.getX(i) + sz.x / 2) / sz.x, (sz.z / 2 - P.getZ(i)) / sz.z);
  const sea = new THREE.Mesh(geo, mat); sea.name = 'SLEEK_SEA'; sea.position.set(cen.x, gb.max.y - 0.5, cen.z); // 땅보다 낮게: 해안선으로 도려낸 구멍으로만 보인다
  sea.renderOrder = 2; sea.raycast = () => {}; mat.uniforms.uCen.value.set(cen.x, cen.z);
  ground.parent.add(sea); // 바닥과 같은 묶음 → 낮·밤 배경이 바뀌면 함께 숨는다
  // 먼 바다: 원래 배경의 먼 바다 링(색이 달라 가까운 바다 끝에서 경계가 보였다)은 숨기고, 같은 셰이더·같은 값의 큰 판(5km)을 아래에 깐다.
  // 가까운 바다 판 가장자리가 투명하게 사라져도 아래가 같은 바다라 이음새가 없다. 멀수록 수평선 색으로 섞인다(uHaze)
  const fgeo = new THREE.CircleGeometry(2800, 128); fgeo.rotateX(-Math.PI / 2); // 원형: 바다 끝이 고르게 둥근 수평선이 되어 하늘과 또렷하게 갈린다
  const FP = fgeo.attributes.position, FU = fgeo.attributes.uv; for (let i = 0; i < FP.count; i++) FU.setXY(i, (FP.getX(i) + cen.x - gb.min.x) / sz.x, (gb.max.z - FP.getZ(i) - cen.z) / sz.z);
  const fmat = new THREE.ShaderMaterial({ vertexShader: mat.vertexShader, fragmentShader: mat.fragmentShader, uniforms: { ...mat.uniforms, uEdge: { value: 0 } }, depthWrite: false });
  const far = new THREE.Mesh(fgeo, fmat); far.name = 'SLEEK_SEA'; far.position.set(cen.x, gb.max.y - 0.58, cen.z); far.renderOrder = 1; far.raycast = () => {};
  ground.parent.add(far);
  const t0 = performance.now(); let last = 0;
  (function flow(now) { // 30fps면 충분: 바다가 보일 때만 시간을 흘리고 다시 그린다
    if (now - last > 33 && isShown(sea) && !document.hidden) { last = now; mat.uniforms.uTime.value = (now - t0) / 1000; el._dirty = true; }
    requestAnimationFrame(flow);
  })(t0);
  return {
    setTheme(dark) {
      const V = mat.uniforms, sun = dark ? 0.55 : 1; if (V.uSun.value === sun) return;
      // 밤바다도 땅과 구분되게 살짝 밝게. 다른 배경처럼 채도를 낮춘다(mute)
      if (dark) { mute(V.uDeep.value.set(0x1b3550)); mute(V.uShallow.value.set(0x23415f)); mute(V.uSky.value.set(0x3a5672)); }
      else { V.uDeep.value.set(0x4f8f86); V.uShallow.value.set(0x6fa89c); V.uSky.value.set(0xcfe2dc); } // 낮: 채도를 조금 낮춘 에메랄드
      V.uHaze.value.set(dark ? 0x2b3a4c : 0xa9cfc6); // 먼 바다: 같은 바다색이 옅어진 색(하늘색으로 섞지 않는다 → 수평선이 또렷)
      V.uSun.value = sun;
    },
  };
}

// ---- 가로등: 빛 웅덩이(바닥에 구운 빛) 가운데 바로 위에 등머리가 오도록 로우폴리 가로등을 다시 세운다 ----
// 원래 가로등 3D(기둥·등머리·빛 번짐·주황 원판)는 숨겼고 빛은 바닥 라이트맵에 구워 둔다(bakeLampLight). 실제 조명은 두지 않는다.
// 모양: 육각 기둥(위로 가늘어짐) + 받침 + 팔 + 등갓은 금속 한 덩어리, 아래 렌즈만 스스로 빛나는 재질(밤: 따뜻한 주황, 낮: 꺼진 회색).
// 인스턴스 2개(금속·렌즈)로 37개를 한 번에 그린다. 팔은 공장 가운데 쪽을 향한다
let lampSet = null;
function mergeGeos(list) {
  const pos = [], nor = [];
  list.forEach(g => { const n = g.toNonIndexed(); pos.push(...n.attributes.position.array); nor.push(...n.attributes.normal.array); });
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); return g;
}
function lampPosts(el, pool, dark) {
  if (!lampSet) {
    const A = 0.75; // 팔 길이: 기둥은 등머리(웅덩이 가운데)에서 이만큼 떨어져 선다
    const metalGeo = mergeGeos([
      new THREE.CylinderGeometry(0.07, 0.11, 7, 6, 1).translate(-A, 3.5, 0),  // 기둥
      new THREE.CylinderGeometry(0.2, 0.25, 0.45, 6, 1).translate(-A, 0.22, 0), // 받침
      new THREE.BoxGeometry(A + 0.1, 0.07, 0.07).translate(-A / 2, 6.95, 0),    // 팔
      new THREE.BoxGeometry(0.62, 0.14, 0.3).translate(0, 6.9, 0),            // 등갓
    ]);
    const lensGeo = new THREE.BoxGeometry(0.5, 0.04, 0.22).translate(0, 6.81, 0);
    const metal = new THREE.InstancedMesh(metalGeo, new THREE.MeshStandardMaterial({ color: 0x59626c, roughness: 0.55, metalness: 0.45, flatShading: true }), pool.count);
    const lens = new THREE.InstancedMesh(lensGeo, new THREE.MeshBasicMaterial({ color: 0xffd9a0, toneMapped: false }), pool.count);
    const zs = Object.values(el.zones || {}), cx = zs.reduce((a, z) => a + z.ox, 0) / (zs.length || 1), cz = zs.reduce((a, z) => a + (z.oz || 0), 0) / (zs.length || 1);
    const M = new THREE.Matrix4(), P = new THREE.Vector3(), Q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < pool.count; i++) {
      pool.getMatrixAt(i, M); P.setFromMatrixPosition(M).applyMatrix4(pool.matrixWorld); P.y = 0;
      Q.setFromAxisAngle(Y, Math.atan2(-(cz - P.z), cx - P.x)); // +x(팔 방향)가 공장 가운데를 향하게
      M.compose(P, Q, new THREE.Vector3(K_LAMP, K_LAMP, K_LAMP)); metal.setMatrixAt(i, M); lens.setMatrixAt(i, M);
    }
    [metal, lens].forEach(o => { o.instanceMatrix.needsUpdate = true; o.castShadow = false; o.receiveShadow = false; o.raycast = () => {}; o.userData.sleekLamp = true; });
    const g = new THREE.Group(); g.name = 'SLEEK_LAMPS'; g.add(metal, lens); el.scene.add(g);
    lampSet = { g, lens };
  }
  const col = dark ? 0xffd9a0 : 0xc9ced4; // 밤에는 켜짐(따뜻한 주황), 낮에는 꺼짐
  const vis = !el._2d;
  let ch = false;
  if (lampSet.lens.material.color.getHex() !== col) { lampSet.lens.material.color.setHex(col); ch = true; }
  if (lampSet.g.visible !== vis) { lampSet.g.visible = vis; ch = true; }
  return ch;
}

// 가로등 빛을 바닥에 굽는다: 반투명 원 대신, 가로등마다 점광원 하나가 바닥을 비춘 모양(거리 제곱에 반비례해 어두워짐)을
// 캔버스 라이트맵에 그려 둔다. 실시간 빛·반사 없이 바닥 색에 곱해져 자연스럽고 가볍다.
function bakeLampLight(ground, pool) {
  const N = 2048, c = document.createElement('canvas'); c.width = c.height = N; const x = c.getContext('2d');
  x.fillStyle = '#000'; x.fillRect(0, 0, N, N);
  const gb = new THREE.Box3().setFromObject(ground), W = gb.max.x - gb.min.x, D = gb.max.z - gb.min.z; // 바닥 판은 회전돼 있어 월드 좌표로 잰다
  const M = new THREE.Matrix4(), p = new THREE.Vector3(), H = 7 * K_LAMP, R = 16 * 0.56; // 줄인 가로등 높이에 맞춰 빛 웅덩이도 작게 // 등 높이 7m, 빛이 닿는 반경 16m
  x.globalCompositeOperation = 'lighter'; // 가까운 가로등끼리 빛이 더해진다
  // 투광등 4개: 원뿔이 닿는 자리를 부드럽게(가운데가 하얗게 날지 않게 낮게)
  FLOODS.forEach(o => { const cx = (o.x - gb.min.x) / W * N, cy = (o.z - gb.min.z) / D * N, r = o.r / W * N, g = x.createRadialGradient(cx, cy, 0, cx, cy, r), c = new THREE.Color(o.color);
    const rgb = [c.r, c.g, c.b].map(v => Math.round(v * 255)).join(',');
    for (let k = 0; k <= 8; k++) { const u = k / 8, f = Math.pow(1 - u * u, 2) * 0.22; g.addColorStop(u, `rgba(${rgb},${f.toFixed(3)})`); }
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); });
  // 빈터를 은은하게 밝히는 큰 옴니(달빛): 명도·채도 낮은 푸른 회색, 넓고 부드럽게
  NIGHT_OMNI.forEach(o => { const cx = (o.p[0] - gb.min.x) / W * N, cy = (o.p[1] - gb.min.z) / D * N, r = o.r / W * N, g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    // 가운데가 뾰족하지 않게 넓고 완만하게(점광원 감쇠를 그대로 쓰니 가운데가 하얗게 날아갔다)
    for (let k = 0; k <= 8; k++) { const u = k / 8, f = Math.pow(1 - u * u, 2) * o.ground * 0.3; g.addColorStop(u, `rgba(170,185,210,${f.toFixed(3)})`); }
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill(); });
  for (let i = 0; i < pool.count; i++) {
    pool.getMatrixAt(i, M); p.setFromMatrixPosition(M).applyMatrix4(pool.matrixWorld);
    // 바닥 UV: u = (x - minX)/W, v = (maxZ - z)/D → 캔버스(flipY) 세로는 (z - minZ)/D
    const cx = (p.x - gb.min.x) / W * N, cy = (p.z - gb.min.z) / D * N, r = R / W * N;
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, r);
    for (let k = 0; k <= 8; k++) { const d = k / 8 * R, e = (H * H) / (H * H + d * d), f = e * e * (1 - k / 8); g.addColorStop(k / 8, `rgba(255,${Math.round(150 + 40 * f)},${Math.round(80 + 40 * f)},${f.toFixed(3)})`); }
    x.fillStyle = g; x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
  }
  const lm = new THREE.CanvasTexture(c); lm.channel = 0; lm.colorSpace = THREE.SRGBColorSpace; // 바닥은 uv가 하나뿐이라 0번 채널을 쓴다
  ground.material.lightMap = lm; ground.material.lightMapIntensity = 12; ground.material.needsUpdate = true; // 바닥이 어두운 색이라 세게 줘야 보인다
}

// ---- 4) 공정을 볼 때(소개 중 포함) 카메라와 공정 사이를 가리는 주변 모델 숨기기 ----
// 대상 공정: 소개 중이면 그 공정(el.__sleekFocus), 아니면 들어가 있는 공정. 대상이 바뀌면 숨긴 것을 되돌리고 다시 잰다.
const hidden = new Set();
function occluders() { return hidden; } // 공정 안 화면에서 숨긴 건물(굽기 함수 안의 지역 변수 hidden과 이름이 겹쳐서 따로 둔다)
const ray = new THREE.Raycaster();
let hiddenFor = null;
function hideOccluders(el) {
  const z = el.__sleekFocus ? el.zones[el.__sleekFocus] : (!el._isOverview && el.zone);
  const fid = el.__sleekFocus || (z ? 'in:' + (el.process?.id || '') : null);
  if (fid !== hiddenFor || !z || !z.root.visible) { if (hidden.size) { hidden.forEach(o => { o.visible = true; }); hidden.clear(); el._dirty = true; } hiddenFor = fid; }
  if (!z || !z.root.visible) return;
  const ext = el.scene.getObjectByName('SITE_BACKDROP_EXT'); if (!ext) return;
  const box = new THREE.Box3().setFromObject(z.root); if (box.isEmpty()) return;
  const cam = el.camera.position, s = box.getSize(new THREE.Vector3()), pts = [];
  for (const fx of [.1, .37, .63, .9]) for (const fz of [.15, .5, .85]) for (const fy of [.15, .5])
    pts.push(new THREE.Vector3(box.min.x + s.x * fx, box.min.y + s.y * fy, box.min.z + s.z * fz));
  // 주변 건물 GLB는 site-backdrop.js가 메시 레이캐스트를 꺼 두어(클릭 통과), 각 메시의 경계 상자와 광선으로 판정한다
  if (!ext.userData.boxes) { const B = []; ext.updateMatrixWorld(true); ext.traverse(o => { if (!o.isMesh || o.isInstancedMesh || o.name === 'SITE_GROUND' || o.userData.lamp) return; const b = new THREE.Box3().setFromObject(o), sz = b.getSize(new THREE.Vector3()); if (Math.max(sz.x, sz.z) > 150) return; B.push([o, b]); }); ext.userData.boxes = B; } // 바닥처럼 넓은 판은 빼 둔다
  const hit = new THREE.Vector3();
  pts.forEach(p => {
    const dir = p.clone().sub(cam), len = dir.length(); ray.set(cam, dir.normalize());
    ext.userData.boxes.forEach(([o, b]) => { if (hidden.has(o) || b.containsPoint(p)) return; if (ray.ray.intersectBox(b, hit) && hit.distanceTo(cam) < len) { o.visible = false; hidden.add(o); el._dirty = true; } });
  });
}

// ---- 2) 인트로: 어두운 화면에서 조명이 서서히 켜지며 드론 시점으로 다가간다 ----
function playIntro(el, showcase) {
  const R = el.renderer, exposure = R.toneMappingExposure;
  // 이름표는 장면이 매 프레임 개별 스타일을 만지므로 감싸는 겹(el.labels)째로 숨긴다
  // 주의: 이 겹은 3D 화면 전체를 덮는다. 원래 pointer-events:none(마우스 통과)이라, 그 값은 건드리지 않는다(지웠더니 드래그 회전이 막혔다)
  const labels = (op) => { el.labels.style.transition = 'opacity .8s ease'; el.labels.style.opacity = op; };
  labels(0);
  R.toneMappingExposure = 0;
  el._dirty = true; setTimeout(() => document.body.classList.add('sleek-ready'), 80); // 노출 0(검은 화면)으로 한 번 그린 뒤 덮개를 걷는다

  // 카메라: 조금 더 높고 먼 곳에서 드론 시점으로 천천히 다가간다
  const to = el._overviewPose();
  Object.assign(el.orbit, { yaw: to.yaw - 0.25, pitch: to.pitch + 0.12, dist: to.dist * 1.35 }); el.orbit.target.copy(to.target);
  el._animateTo?.(to);
  setTimeout(() => el._animateTo?.(to), 50);

  const t0 = performance.now();
  const tick = () => {
    const k = Math.min(1, (performance.now() - t0) / LIGHT_MS);
    R.toneMappingExposure = exposure * (k * k * (3 - 2 * k));
    el._dirty = true;
    if (k < 1) return requestAnimationFrame(tick);
    labels(1);
    tidyScene(el);
    showcase.begin();
    document.dispatchEvent(new CustomEvent('sleek-intro-done'));
  };
  requestAnimationFrame(tick);
}

// 공정 소개: 몇 초마다 01 제선 → 02 제강 → 03 연주 → 04 열간압연 순서로 카메라가 다가가 동그라미 콜아웃으로 가리키고, 페이지에 'sleek-showcase' {id}를 알린다.
// 페이지 카드의 '이 공정 보기'로 들어가면 멈추고, 전체 공정으로 돌아오면 다시 돈다. '다음 공정'은 'sleek-showcase-next'.
const SHOW_MS = 6000;
const SHOW_FOV = 20; // 소개할 때 화각(기본 42). 작을수록 더 당겨 보인다
// 홈(전체 공정) 화면의 화각: 기본 화면은 34°(공장이 화면에 차게), 휠로 12°까지 당긴다. 34°보다 넓어지지(멀어지지) 않는다.
// 원래 장면은 거리 120 이하를 '공정 안'으로 보아 휠 줌이 125~300으로 묶여 있었다 → 홈에선 거리 대신 화각으로 줌한다
const HOME_FOV = 34, HOME_FOV_MIN = 12;
function startShowcase(el) {
  let cur = null, timer = 0, running = false;
  const inSite = () => (el.getAttribute('process') || 'site') === 'site';
  // 줌인은 거리 대신 화각으로 한다: 거리를 120 아래로 줄이면 장면이 '공정 안' 상태로 바뀌어 이름표·조작이 달라진다
  const BASE_FOV = el.camera.fov; let fovTo = BASE_FOV;
  (function lens() { const c = el.camera, d = fovTo - c.fov;
    if (Math.abs(d) > 0.05) { c.fov += d * 0.05; c.updateProjectionMatrix(); el._dirty = true; } else if (d) { c.fov = fovTo; c.updateProjectionMatrix(); el._dirty = true; }
    requestAnimationFrame(lens); })();
  // 공정마다 동그라미 콜아웃 하나. 소개 중엔 그 공정 것만, 자유 시점(직접 둘러보기)에선 넷 다 띄운다
  const callouts = Object.fromEntries(IDS.map(k => [k, makeCallout(el)]));
  let labelsOn = true; // '공정 이름표 숨김' 버튼
  const showOnly = (id) => IDS.forEach(k => { if (k === id && labelsOn) callouts[k].show(k, 900); else callouts[k].hide(); });
  // 홈(자유 시점)에선 늘 띄워 두지 않는다: 시야를 가리고 돌릴 때마다 따라다녀 어지럽다.
  // 마우스가 공정 가까이 가면 그 공정 것만 띄우고(hoverId), 드래그·휠로 돌리는 동안엔 모두 숨긴다
  let hoverId = null;
  const setHover = (id) => { if (id === hoverId) return; if (hoverId) callouts[hoverId].hide(); hoverId = id; if (id && labelsOn) callouts[id].show(id, 0); };
  const showAll = () => setHover(null); // 자유 시점으로 들어갈 때: 처음엔 아무것도 띄우지 않는다
  const zoneBoxes = () => IDS.map(k => [k, new THREE.Box3().setFromObject(el.zones[k].root)]);
  const v3 = new THREE.Vector3();
  document.addEventListener('pointermove', (e) => {
    if (!free || running || !inSite() || el._2d || !labelsOn) return;
    if (e.buttons) { setHover(null); return; } // 돌리는 중
    if (e.target.closest?.('button')) return; // 동그라미 위에 올라가 있으면 유지
    const r = el.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    if (mx < 0 || my < 0 || mx > r.width || my > r.height) { setHover(null); return; }
    let best = null, bestD = Infinity;
    zoneBoxes().forEach(([k, b]) => { // 화면에 비친 공정 영역(상자 8꼭짓점) 안이거나 60px 이내면 후보, 그중 중심이 가장 가까운 것
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const X of [b.min.x, b.max.x]) for (const Y of [b.min.y, b.max.y]) for (const Z of [b.min.z, b.max.z]) { v3.set(X, Y, Z).project(el.camera); const px = (v3.x + 1) / 2 * r.width, py = (1 - v3.y) / 2 * r.height; x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py); }
      const dx = Math.max(x0 - mx, 0, mx - x1), dy = Math.max(y0 - my, 0, my - y1), out = Math.hypot(dx, dy);
      const d = Math.hypot(mx - (x0 + x1) / 2, my - (y0 + y1) / 2);
      if (out < 60 && d < bestD) { bestD = d; best = k; }
    });
    setHover(best);
  });
  const hideAll = () => { IDS.forEach(k => callouts[k].hide()); hoverId = null; };
  const setLabels = el.setZoneLabelsVisible?.bind(el);
  el.setZoneLabelsVisible = function (v) { setLabels?.(v); labelsOn = !!v; if (!inSite()) return; if (running) showOnly(cur); else if (free) showAll(); };
  const show = (id) => {
    cur = id; fovTo = SHOW_FOV; el.__sleekFocus = id;
    showOnly(id);
    const z = el.zones[id], box = new THREE.Box3().setFromObject(z.root), c = box.getCenter(new THREE.Vector3());
    // 거리 130: 장면이 '전체 공정'으로 여기는 범위(120 초과)를 지켜 이름표·휠 동작이 그대로다
    // 공정을 화면 가로 64% 쯤에 둔다: 시선 중심을 카메라 기준 왼쪽으로 옮기면 공정이 오른쪽으로 간다
    const YAW = -0.55, DIST = 130, viewW = 2 * DIST * Math.tan(SHOW_FOV * Math.PI / 360) * (el.camera.aspect || 1.6);
    const right = new THREE.Vector3(Math.cos(YAW), 0, -Math.sin(YAW)), tgt = new THREE.Vector3(c.x, 0, c.z).addScaledVector(right, -viewW * 0.14);
    el._animateTo({ yaw: YAW, pitch: 0.4, dist: DIST, target: tgt });
    document.dispatchEvent(new CustomEvent('sleek-showcase', { detail: { id } }));
  };
  const next = () => { show(IDS[(IDS.indexOf(cur) + 1) % IDS.length]); schedule(SHOW_MS); }; // 처음(cur=null)이면 01부터
  const schedule = (ms) => { clearTimeout(timer); if (running) timer = setTimeout(next, ms); };
  const start = (delay) => { running = true; schedule(delay); };
  const stop = () => { running = false; clearTimeout(timer); hideAll(); fovTo = inSite() ? HOME_FOV : BASE_FOV; el.__sleekFocus = null; };
  // 드래그·휠·홈 버튼으로 직접 둘러보기 시작하면 소개를 끝내고(카드·동그라미도 닫음) 원래 화각의 자유 시점으로 돌려준다
  let free = false;
  const goFree = () => { if (free) return; free = true; stop(); fovTo = HOME_FOV; el.camera.fov = HOME_FOV; el.camera.updateProjectionMatrix(); el._dirty = true; showAll(); document.dispatchEvent(new CustomEvent('sleek-showcase', { detail: { id: null } })); };
  const overview = el.overview.bind(el);
  el.overview = function (...a) { if (running) goFree(); fovTo = HOME_FOV; return overview(...a); }; // 홈 버튼(goSite)이 부른다: 기본 홈 화면으로
  document.addEventListener('sleek-showcase-next', () => { if (running) next(); });
  // 공정에 들어가는 길은 여러 개(카드 버튼·이름표·왼쪽 메뉴)라, 장면의 process 속성을 직접 지켜본다
  new MutationObserver(() => { if (!inSite()) { stop(); fovTo = BASE_FOV; return; } if (free) { fovTo = HOME_FOV; showAll(); } else if (!running) start(2500); }).observe(el, { attributes: true, attributeFilter: ['process'] });
  // 드래그·휠을 시작하면: 소개 중이면 끝내고, 진행 중인 카메라 이동(_animateTo)은 끊어서 손으로 돌리는 것이 바로 먹게 한다
  let started = false; // 인트로가 끝나 소개를 시작했는지
  const takeOver = () => { if (!started) free = true; /* 인트로 중 직접 만지면 소개 없이 자유 시점으로 */ if (running) goFree(); if (inSite()) { el.anim = null; if (free) setHover(null); } };
  el.addEventListener('pointerdown', takeOver, { capture: true });
  el.addEventListener('wheel', (e) => {
    takeOver();
    if (!inSite() || el._2d || el.orbit.dist <= 120) return; // 공정 안·2D 보기는 장면의 원래 줌
    e.stopImmediatePropagation(); e.preventDefault();
    fovTo = Math.max(HOME_FOV_MIN, Math.min(HOME_FOV, fovTo * (1 + e.deltaY * 0.0012)));
  }, { capture: true, passive: false });
  return { begin() { started = true; if (!inSite()) return; if (free) { fovTo = HOME_FOV; showAll(); } else start(0); } };
}

// 동그라미 콜아웃(레퍼런스: 자동차 부품 지시선): 흰 원 안에 '01 / 제선', 원에서 가로로 나온 선이 꺾여 3D 공정을 가리킨다.
// 선 끝은 공정 모델 위 한 점을 매 프레임 화면 좌표로 옮겨 붙인다. 원을 누르면 그 공정으로 들어간다.
function makeCallout(el) {
  const host = el.parentElement; // 3D 영역(x-import) 안에 겹친다
  const D = 96, R = D / 2; // 원 지름
  const wrap = document.createElement('div');
  wrap.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;opacity:0;transition:opacity .5s ease;';
  wrap.innerHTML = `
    <svg style="position:absolute;inset:0;width:100%;height:100%;overflow:visible">
      <path pathLength="1" fill="none" stroke="rgba(255,255,255,.9)" stroke-width="1.5" stroke-dasharray="1" stroke-dashoffset="1" style="transition:stroke-dashoffset .9s cubic-bezier(.6,0,.2,1)"/>
      <circle r="3.5" fill="#fff" style="opacity:0;transition:opacity .3s ease .8s"/>
    </svg>
    <button style="position:absolute;left:0;top:0;width:${D}px;height:${D}px;margin:-${D / 2}px 0 0 -${D / 2}px;border:none;border-radius:50%;
      cursor:pointer;pointer-events:auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:4px;
      box-shadow:0 10px 30px rgba(0,0,0,.35);transform:scale(.6);opacity:0;transition:transform .5s cubic-bezier(.2,.8,.2,1), opacity .4s ease;">
      <span data-num style="font-family:'IBM Plex Mono',monospace;font-size:11px;letter-spacing:.18em;opacity:.65"></span>
      <span data-name style="font-family:'Noto Sans KR',sans-serif;font-size:19px;font-weight:900;letter-spacing:-0.02em"></span>
    </button>`;
  host.appendChild(wrap);
  const path = wrap.querySelector('path'), dot = wrap.querySelector('circle'), btn = wrap.querySelector('button');
  let id = null, anchor = null, corners = [], t;
  btn.addEventListener('click', () => { if (id) document.dispatchEvent(new CustomEvent('steel-goto', { detail: { process: id } })); });
  const v = new THREE.Vector3();
  (function follow() {
    if (id && anchor) {
      const W = el.clientWidth, H = el.clientHeight;
      v.copy(anchor).project(el.camera);
      const ax = (v.x + 1) / 2 * W, ay = (1 - v.y) / 2 * H;
      // 원은 화면에 비친 공정 영역의 왼쪽 위 모서리 근처(공정에 붙어 보이게). 화면 밖으로 나가지 않게 붙잡는다
      let x0 = Infinity, y0 = Infinity;
      corners.forEach(k => { v.copy(k).project(el.camera); x0 = Math.min(x0, (v.x + 1) / 2 * W); y0 = Math.min(y0, (1 - v.y) / 2 * H); });
      const cx = Math.max(R + 16, Math.min(W - R - 16, Math.min(ax - 120, x0 + 40))), cy = Math.max(R + 80, Math.min(H - R - 16, Math.min(ay - 60, y0 - R * 0.3)));
      btn.style.left = cx + 'px'; btn.style.top = cy + 'px';
      const sx = cx + R, ex = Math.min(ax - 30, sx + 50); // 원 오른쪽에서 짧게 가로로 나와, 꺾여서 점으로
      path.setAttribute('d', `M${sx},${cy} L${Math.max(sx, ex)},${cy} L${ax},${ay}`);
      dot.setAttribute('cx', ax); dot.setAttribute('cy', ay);
    }
    requestAnimationFrame(follow);
  })();
  // 다크 모드: 검은 원, 위는 불투명 → 아래로 살짝 반투명. 라이트 모드: 밝은 원
  let painted = null;
  const paint = () => { const dark = (el.getAttribute('theme') || 'dark') === 'dark'; if (painted === dark) return; painted = dark;
    Object.assign(btn.style, dark
      ? { background: 'linear-gradient(180deg, rgba(10,11,13,1) 0%, rgba(10,11,13,.94) 45%, rgba(10,11,13,.62) 100%)', color: '#f4f6f9', boxShadow: '0 10px 30px rgba(0,0,0,.45)' }
      : { background: 'rgba(244,246,249,.92)', color: '#111', boxShadow: '0 10px 30px rgba(0,0,0,.25)' }); };
  new MutationObserver(paint).observe(el, { attributes: true, attributeFilter: ['theme'] });
  const reset = () => { path.style.transition = 'none'; path.setAttribute('stroke-dashoffset', '1'); dot.style.opacity = '0'; btn.style.transform = 'scale(.6)'; btn.style.opacity = '0'; };
  return {
    show(next, delay = 900) {
      const p = PROCESSES.find(q => q.id === next), z = el.zones[next];
      if (!p || !z) return;
      clearTimeout(t); reset();
      id = next;
      const box = new THREE.Box3().setFromObject(z.root), c = box.getCenter(new THREE.Vector3());
      anchor = new THREE.Vector3(c.x, box.min.y + (box.max.y - box.min.y) * 0.45, c.z); // 공정 모델 가운데쯤
      corners = [0, 1].flatMap(i => [0, 1].flatMap(j => [0, 1].map(k => new THREE.Vector3(i ? box.max.x : box.min.x, j ? box.max.y : box.min.y, k ? box.max.z : box.min.z))));
      btn.querySelector('[data-num]').textContent = p.num;
      btn.querySelector('[data-name]').textContent = p.name;
      paint();
      wrap.style.opacity = '1';
      // 카메라가 다가간 뒤: 원이 나타나고 → 선이 그려진다
      t = setTimeout(() => {
        btn.style.transform = 'scale(1)'; btn.style.opacity = '1';
        t = setTimeout(() => { path.style.transition = 'stroke-dashoffset .9s cubic-bezier(.6,0,.2,1)'; path.setAttribute('stroke-dashoffset', '0'); dot.style.opacity = '1'; }, 350);
      }, delay);
    },
    hide() { clearTimeout(t); id = null; wrap.style.opacity = '0'; reset(); },
  };
}

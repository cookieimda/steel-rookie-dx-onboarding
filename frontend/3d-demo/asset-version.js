// GLB 주소 뒤에 ?v=내용 해시를 붙인다. 서버는 ?v가 붙은 GLB를 1년 동안 다시 묻지 않게 보낸다(backend/src/asset-version.ts).
// 모델이 바뀌면 해시가 바뀌어 주소가 달라지므로 새 모델을 바로 받는다. three.js 공용 로딩 관리자(DefaultLoadingManager)에 한 번 걸어 두면
// 같은 three를 쓰는 모든 GLTFLoader(공정 화면·첫 화면·홈·포석호 캐릭터)에 적용된다. 해시 목록을 못 받으면 ?v 없이 예전처럼 받는다.
// 서버가 BASE(CDN 주소, MODEL_CDN)를 주면 공정 모델(models/ 바로 아래 GLB)은 CDN에서 받는다. CDN에서 실패하면 gltf-loader.js의 loadModel이
// cdn.off()로 끄고 이 서버에서 다시 받는다. 포석호 캐릭터(character/)는 늘 이 서버에서 받는다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const M = await import('./asset-hashes.js').catch(() => ({}));
const V = M.V || {};
let BASE = M.BASE || '';
export const cdn = { get base() { return BASE; }, off() { BASE = ''; } };
THREE.DefaultLoadingManager.setURLModifier((url) => {
  const m = /models\/([^?#]+\.glb)$/.exec(url); if (!m) return url;
  if (BASE && /^[\w-]+\.glb$/.test(m[1])) return BASE + m[1]; // CDN 주소는 커밋으로 고정돼 있어 ?v가 필요 없다
  const v = V[m[1]]; return v ? `${url}?v=${v}` : url;
});

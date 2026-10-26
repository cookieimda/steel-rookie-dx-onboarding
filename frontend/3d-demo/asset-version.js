// GLB 주소 뒤에 ?v=내용 해시를 붙인다. 서버는 ?v가 붙은 GLB를 1년 동안 다시 묻지 않게 보낸다(backend/src/asset-version.ts).
// 모델이 바뀌면 해시가 바뀌어 주소가 달라지므로 새 모델을 바로 받는다. three.js 공용 로딩 관리자(DefaultLoadingManager)에 한 번 걸어 두면
// 같은 three를 쓰는 모든 GLTFLoader(공정 화면·첫 화면·홈·포석호 캐릭터)에 적용된다. 해시 목록을 못 받으면 ?v 없이 예전처럼 받는다.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/+esm';

const V = await import('./asset-hashes.js').then((m) => m.V || {}).catch(() => ({}));
THREE.DefaultLoadingManager.setURLModifier((url) => {
  const m = /models\/([^?#]+\.glb)$/.exec(url), v = m && V[m[1]];
  return v ? `${url}?v=${v}` : url;
});

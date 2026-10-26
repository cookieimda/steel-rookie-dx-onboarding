// 공정 GLB(models/*.glb)는 Draco로 압축해 두었다(models/README.md '용량 줄이기'). GLB를 읽는 화면은 모두 이 로더를 쓴다.
// 압축을 푸는 디코더(wasm)는 three와 같은 버전을 jsDelivr에서 처음 한 번 받아 Web Worker에서 돌린다(화면을 멈추지 않는다).
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js/+esm';
import './asset-version.js'; // GLB 주소에 ?v=내용 해시(브라우저 1년 캐시)

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');

/** Draco 압축 GLB도 읽는 GLTFLoader. 압축하지 않은 GLB도 그대로 읽는다. */
export function createGLTFLoader() { return new GLTFLoader().setDRACOLoader(draco); }

// 같은 GLB는 한 페이지에서 한 번만 받아 압축을 풀고(Draco 해제가 가장 비싸다), 쓰는 쪽마다 복제본을 준다.
// 예: 공정 화면이 받은 모델을 [▶] 재생(intro-tour.js)이 다시 받지 않는다. 형상(정점 버퍼)은 공유해 메모리도 한 벌만 쓴다.
// 노드와 재질은 새로 만든다: 화면마다 재질 색·투명도를 바꾸고(외곽선·단면·흑백) 노드를 합치므로(batchStatic·mergeByEquipment) 서로 영향이 없어야 한다.
// 원본은 장면에 넣지 않고 복제의 틀로만 둔다. 형상을 직접 고치는 쪽(지금은 없음)은 복제본의 형상을 먼저 clone()해야 한다.
const parsed = new Map(); // 주소 → Promise<gltf>
const loaderForCache = createGLTFLoader();
function cloneScene(src) {
  const root = src.clone(true), mats = new Map(), copy = (m) => { if (!mats.has(m)) mats.set(m, m.clone()); return mats.get(m); };
  root.traverse((o) => { if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(copy) : copy(o.material); });
  return root;
}
/** GLB 하나의 복제본(장면 루트). onProgress는 처음 받을 때만 불린다. 실패하면 다음 호출에서 다시 받는다 */
export function loadModel(url, onProgress) {
  if (!parsed.has(url)) parsed.set(url, new Promise((resolve, reject) => loaderForCache.load(url, resolve, onProgress, reject)).catch((e) => { parsed.delete(url); throw e; }));
  return parsed.get(url).then((g) => cloneScene(g.scene));
}

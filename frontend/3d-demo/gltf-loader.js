// 공정 GLB(models/*.glb)는 Draco로 압축해 두었다(models/README.md '용량 줄이기'). GLB를 읽는 화면은 모두 이 로더를 쓴다.
// 압축을 푸는 디코더(wasm)는 three와 같은 버전을 jsDelivr에서 처음 한 번 받아 Web Worker에서 돌린다(화면을 멈추지 않는다).
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/GLTFLoader.js/+esm';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/loaders/DRACOLoader.js/+esm';
import './asset-version.js'; // GLB 주소에 ?v=내용 해시(브라우저 1년 캐시)

const draco = new DRACOLoader().setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/libs/draco/gltf/');

/** Draco 압축 GLB도 읽는 GLTFLoader. 압축하지 않은 GLB도 그대로 읽는다. */
export function createGLTFLoader() { return new GLTFLoader().setDRACOLoader(draco); }

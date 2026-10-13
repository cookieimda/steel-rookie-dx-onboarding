// 학습 화면의 설비 작동 단계 설명(3D: data_v2.js의 steps, 2D: process-2d.js의 PROCS). 튜터가 근거 자료로 답하지 못할 때
// "학습 화면 어디에서 다루는지"를 안내하는 데에만 쓴다. 검수 전 샘플 내용이라 근거(retrieve)로 쓰지 않는다(llm/prompts/learning-system.md).
// 두 파일은 프론트 담당 파일이라 서버는 읽기만 한다. 형식이 바뀌어 못 읽으면 빈 목록으로 두고 경고만 남긴다(테스트로 읽히는지 확인).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ScreenMaterial } from "../../../llm/src/learning-agent.js";

export const DATA_V2_PATH = join(process.cwd(), "frontend", "3d-demo", "data_v2.js");
export const PROCESS_2D_PATH = join(process.cwd(), "frontend", "3d-demo", "process-2d.js");

/** 한 번에 튜터에 넘기는 단계 설명 수. */
export const MAX_SCREEN_MATERIAL = 3;

export type ScreenStep = { process_id: string; equipment_id: string; equipment_name: string; step: number; text: string };

/** data_v2.js의 설비 작동 단계(3D 작동 보기). */
async function stepsFromDataV2(path: string): Promise<ScreenStep[]> {
  const { PROCESSES } = (await import(pathToFileURL(path).href)) as { PROCESSES: { id: string; equipment: { id: string; name: string; steps?: { text: string }[] }[] }[] };
  return PROCESSES.flatMap((p) => p.equipment.flatMap((e) => (e.steps ?? []).map((s, i) => ({ process_id: p.id, equipment_id: e.id, equipment_name: e.name, step: i + 1, text: s.text }))));
}

/** process-2d.js의 PROCS(2D 작동 단계). 브라우저 모듈이라 import하지 않고 `const PROCS = [...]` 줄의 JSON만 읽는다. */
function stepsFrom2d(path: string): ScreenStep[] {
  const match = /const PROCS = (\[.*\]);\s*$/m.exec(readFileSync(path, "utf8"));
  if (!match) throw new Error("PROCS를 찾지 못함");
  const procs = JSON.parse(match[1]) as { id: string; items: { id: string; name: string; steps: [string, string][] }[] }[];
  return procs.flatMap((p) => p.items.flatMap((e) => e.steps.map(([text], i) => ({ process_id: p.id, equipment_id: e.id, equipment_name: e.name, step: i + 1, text }))));
}

/** 두 화면의 단계 설명을 모두 읽는다. 한쪽을 못 읽으면 그쪽만 빼고 경고한다(서버는 계속 뜬다). */
export async function loadScreenSteps(dataV2 = DATA_V2_PATH, process2d = PROCESS_2D_PATH): Promise<ScreenStep[]> {
  const out: ScreenStep[] = [];
  try {
    out.push(...(await stepsFromDataV2(dataV2)));
  } catch (e) {
    console.warn(`학습 화면 단계 설명(data_v2.js)을 읽지 못했습니다: ${(e as Error).message}`);
  }
  try {
    out.push(...stepsFrom2d(process2d));
  } catch (e) {
    console.warn(`학습 화면 단계 설명(process-2d.js)을 읽지 못했습니다: ${(e as Error).message}`);
  }
  return out;
}

// 질문 단어 끝의 조사·어미(긴 것부터)와, 단계 설명을 찾는 데 쓰지 않는 말.
const SUFFIXES = ["에서는", "으로는", "이라는", "이란", "에서", "으로", "까지", "부터", "이랑", "하고", "이야", "은", "는", "이", "가", "을", "를", "에", "의", "로", "와", "과", "도", "만", "란", "야"];
const STOPWORDS = new Set(["무엇", "뭐", "뭐야", "뭔데", "무슨", "어떤", "어떻게", "왜", "어디", "언제", "설비", "공정", "역할", "이거", "그거", "저거", "여기", "거기", "설명", "대해", "알려", "알려줘", "해줘", "하는", "있어", "있나", "되나", "되는", "이유", "정도", "얼마나"]);

/** 질문에서 찾을 말(두 글자 이상 한글·영문·숫자 단어의 조사를 뗀 형태). */
export function keywordsOf(question: string): string[] {
  const words = question.normalize("NFC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const out = new Set<string>();
  for (const word of words) {
    let w = word;
    for (const s of SUFFIXES) {
      if (w.length - s.length >= 2 && w.endsWith(s)) { w = w.slice(0, -s.length); break; }
    }
    if (w.length >= 2 && !STOPWORDS.has(w)) out.add(w);
  }
  return [...out];
}

/** 질문 단어가 나오는 단계 설명(같은 공정 먼저, 맞는 단어가 많은 순). 같은 설비·단계 번호·문장은 한 번만. */
export function findScreenMaterial(question: string, steps: ScreenStep[], section: string, limit = MAX_SCREEN_MATERIAL): ScreenMaterial[] {
  const keywords = keywordsOf(question);
  if (!keywords.length) return [];
  const seen = new Set<string>();
  return steps
    .map((s) => ({ s, hits: keywords.filter((k) => s.text.includes(k)).length }))
    .filter((r) => r.hits > 0)
    .sort((a, b) => Number(b.s.process_id === section) - Number(a.s.process_id === section) || b.hits - a.hits)
    .filter(({ s }) => {
      const key = `${s.equipment_id}#${s.step}#${s.text}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map(({ s }) => ({ equipment_id: s.equipment_id, equipment_name: s.equipment_name, step: s.step, text: s.text }));
}

// 화면별 추천 질문(튜터 패널의 질문 칩). 화면과 같은 규칙으로 고른다(frontend/3d-demo/learning-chat.js vals):
// learning-suggestions.js에 정해 둔 질문, 없으면 data_v2.js의 SUGGESTED(설비를 고르지 않았으면 '이 설비…' 질문은 뺀다).
// 서버는 이 목록으로 추천 질문인지 알아보고(저장한 답 쓰기), 켜질 때 답을 미리 받는다(warm).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { SceneCatalog } from "../../../llm/src/learning-agent.js";
import type { WarmItem } from "./routes.js";

const FRONT = join(process.cwd(), "frontend", "3d-demo");

export type SuggestedQuestions = (processId: string | null, equipmentId: string | null) => string[];

export async function loadSuggestedQuestions(): Promise<SuggestedQuestions> {
  const { suggestionsFor } = (await import(pathToFileURL(join(FRONT, "learning-suggestions.js")).href)) as { suggestionsFor: (p: string, e: string | null) => string[] | null };
  const { SUGGESTED } = (await import(pathToFileURL(join(FRONT, "data_v2.js")).href)) as { SUGGESTED: string[] };
  // 전체 공정 화면은 화면이 'site'로 부른다(서버 요청에서는 process_id 없음).
  return (processId, equipmentId) => suggestionsFor(processId ?? "site", equipmentId) ?? SUGGESTED.filter((q) => equipmentId || !q.startsWith("이 설비"));
}

/**
 * 미리 받을 질문 목록. 시연에서 먼저 보이는 순서로: 전체 화면 → 제선 공정 → 제선 설비 → 다른 공정.
 * 다른 공정의 설비 화면은 정해 둔 질문이 없어(기본 질문) 넣지 않는다.
 */
export function warmItems(suggested: SuggestedQuestions, scene: SceneCatalog | undefined): WarmItem[] {
  const screens: { processId: string | null; equipmentId: string | null }[] = [{ processId: null, equipmentId: null }, { processId: "ironmaking", equipmentId: null }];
  for (const e of scene?.processes.find((p) => p.id === "ironmaking")?.equipment ?? []) screens.push({ processId: "ironmaking", equipmentId: e.id });
  for (const p of scene?.processes ?? []) if (p.id !== "ironmaking") screens.push({ processId: p.id, equipmentId: null });
  const seen = new Set<string>();
  return screens.flatMap(({ processId, equipmentId }) => suggested(processId, equipmentId).map((question) => ({ processId, equipmentId, question })))
    .filter((item) => {
      const k = `${item.processId}|${item.equipmentId}|${item.question}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
}

// 학습 모드 튜터가 화면 조작(scene_actions)에 쓸 공정·설비 목록.
// 기준은 frontend/3d-demo/data_v2.js의 PROCESSES(프론트 담당 파일, 서버는 읽기만 한다).
// 설비 id는 화면 선택·3D 앵커·콘텐츠를 잇는 키라서 따로 복사해 두지 않는다(docs/equipment-ids.md).
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import type { SceneCatalog } from "../../../llm/src/learning-agent.js";
import { SECTION_ORDER, type Section } from "../checkpoint/types.js";

export const SCENE_DATA_PATH = join(process.cwd(), "frontend", "3d-demo", "data_v2.js");

// 공정 id는 섹션 id와 같고, 설비 id는 /api/chat의 screen.equipment_id와 같은 형식이다.
const Processes = z.array(
  z.object({
    id: z.enum(SECTION_ORDER as [Section, ...Section[]]),
    name: z.string().min(1),
    equipment: z.array(z.object({ id: z.string().regex(/^[a-z0-9_]{1,40}$/), name: z.string().min(1), steps: z.array(z.unknown()).optional() })).min(1),
  }),
);

/** data_v2.js에서 공정·설비 id와 이름만 꺼낸다. 형식이 틀리거나 설비 id가 겹치면 예외(서버가 시작하지 않는다). */
export async function loadSceneCatalog(path = SCENE_DATA_PATH): Promise<SceneCatalog> {
  const mod = (await import(pathToFileURL(path).href)) as { PROCESSES?: unknown };
  const parsed = Processes.safeParse(mod.PROCESSES);
  if (!parsed.success) {
    throw new Error(`화면 설비 목록 형식 오류(${path}): ${parsed.error.issues.map((i) => i.path.join(".")).join(", ")}`);
  }
  const seen = new Set<string>();
  for (const e of parsed.data.flatMap((p) => p.equipment)) {
    if (seen.has(e.id)) throw new Error(`화면 설비 id가 겹칩니다(${path}): ${e.id}`);
    seen.add(e.id);
  }
  return {
    // operation: 작동 단계(steps)가 있는 설비만 true. 튜터의 작동 보기(show_operation)는 이 설비만 허용한다.
    processes: parsed.data.map((p) => ({ id: p.id, name: p.name, equipment: p.equipment.map((e) => ({ id: e.id, name: e.name, ...(e.steps?.length ? { operation: true } : {}) })) })),
  };
}

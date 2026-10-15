// 로컬 모델(compact 프로필)용 학습 튜터 입력 줄이기. 근거 조각은 자르지 않고 개수만 줄이며, 지금 질문은 그대로 둔다.
// 3B 모델을 CPU로 돌리면 입력 길이가 곧 지연이라(2026-10-13 측정: 프롬프트 4~5천 자에서 호출당 20초 이상) 대화·메모·화면 목록을 줄인다.
import type { LearningInput } from "./learning-agent.js";

export const LOCAL_CONTEXT_LIMITS = { chunks: 3, sourceChars: 2200, turns: 2, questionChars: 400, answerChars: 500, notes: 3 } as const;

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max)} [이전 대화 일부 생략]`);

export function compactLearningInput(input: LearningInput): LearningInput {
  let used = 0;
  // 순위가 높은 조각부터 글자 수 상한까지. 첫 조각은 상한을 넘어도 넣는다(근거가 하나도 없게 되지 않게).
  const chunks = input.chunks
    .filter((c, i) => {
      const length = c.title.length + c.text.length;
      if (i > 0 && used + length > LOCAL_CONTEXT_LIMITS.sourceChars) return false;
      used += length;
      return true;
    })
    .slice(0, LOCAL_CONTEXT_LIMITS.chunks);
  const history = input.history.slice(-LOCAL_CONTEXT_LIMITS.turns).map((t) => ({
    question: clip(t.question, LOCAL_CONTEXT_LIMITS.questionChars),
    answer: clip(t.answer, LOCAL_CONTEXT_LIMITS.answerChars),
  }));
  const referents = [input.question, ...history.map((t) => `${t.question} ${t.answer}`)].join(" ").toLowerCase();
  const current = input.screen.process_id ?? input.section;
  const relevantEquipment = new Set([input.screen.equipment_id, ...chunks.flatMap((c) => c.tags)]);
  // 화면 목록은 근거·지금 선택한 설비·질문과 대화에서 이름으로 가리킨 설비만 남긴다(공정 id는 모두 남김).
  const scene = input.scene && {
    processes: input.scene.processes.map((p) => ({
      ...p,
      equipment: p.equipment.filter((e) => {
        const names = [e.id, e.name.split(/[\s(·]/)[0]!, ...(e.name.match(/[A-Z]{2,}/g) ?? [])];
        return (p.id === current && relevantEquipment.has(e.id)) || names.some((name) => name.length > 1 && referents.includes(name.toLowerCase()));
      }),
    })),
  };
  return {
    ...input,
    chunks,
    history,
    scene,
    openMisconceptions: input.openMisconceptions.slice(-LOCAL_CONTEXT_LIMITS.notes).map((m) => ({ ...m, summary: clip(m.summary, 200) })),
  };
}

// 오개념 출처 라벨(docs/learning-mode.md '개인 페이지 표시'). 학습자 메모(notes.ts)와 개인 페이지 API(me/)가 같이 쓴다.
export const MISCONCEPTION_SOURCE_LABEL = {
  learning: "대화 중 감지됨",
  checkpoint: "이해도 확인",
} as const;

export type MisconceptionSource = keyof typeof MISCONCEPTION_SOURCE_LABEL;

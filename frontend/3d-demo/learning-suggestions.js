// 학습 모드 추천 질문(튜터 패널의 질문 버튼). 제선은 화면·설비마다 공개 자료로 답할 수 있는 질문만 둔다.
// 질문을 바꾸면 npm run eval:learning으로 근거 있는 답(grounded)이 나오는지 확인한다(평가가 이 파일을 읽어 케이스를 만든다).
// 다른 공정은 아직 근거 자료가 없어 data_v2.js의 SUGGESTED를 그대로 쓴다.

export const SUGGESTIONS = {
  ironmaking: {
    // 설비를 고르지 않았을 때
    process: ['제선 공정 순서를 보여 줘', '고로는 무슨 일을 해?', '쇳물은 다음에 어느 공정으로 가?', '코크스는 왜 넣어?'],
    equipment: {
      sinter_plant: ['소결기는 무슨 일을 해?', '소결광은 왜 만들어?', '소결광 말고 고로에 넣는 원료는 뭐야?'],
      coke_oven: ['코크스 오븐은 왜 필요해?', '고로에서 코크스는 무슨 역할을 해?', '고로용 코크스는 무엇을 고려해 만들어?'],
      blast_furnace: ['고로는 무슨 일을 해?', '고로에 열풍을 왜 불어넣어?', '고로에 넣은 원료는 어떻게 골고루 퍼져?'],
      hot_stove: ['열풍로는 뭐 하는 설비야?', '열풍은 몇 도야?', '열풍로는 어떤 연료를 써?'],
      taphole_casthouse: ['출선구는 뭐야?', '고로에서 쇳물과 슬래그는 각각 어디로 가?', '출선구에서 나온 쇳물은 어디로 가?'],
      torpedo_car: ['토페도카는 뭘 옮겨?', '토페도카에는 쇳물이 얼마나 들어가?', '토페도카는 왜 어뢰차라고 불러?'],
    },
  },
};

/**
 * 화면(공정·설비)에 맞는 추천 질문. 정해 둔 것이 없으면 null(호출하는 쪽이 기본 질문을 쓴다).
 * 전체 공정 화면('site')은 서버가 제선 기준으로 답하므로 제선 공정 질문을 쓴다(설비가 없는데 '이 설비의 역할은?'이 나오지 않게).
 */
export function suggestionsFor(processId, equipmentId) {
  const p = SUGGESTIONS[processId === 'site' ? 'ironmaking' : processId];
  if (!p) return null;
  return (equipmentId && p.equipment[equipmentId]) || p.process;
}

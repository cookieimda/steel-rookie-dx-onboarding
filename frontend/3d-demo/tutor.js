// 가짜 AI 튜터. 실제 서버와 같은 요청/응답 형식.
// 교체 방법: mockTutor(req) 본문을 fetch(`/sessions/${id}/messages`, {method:'POST', body: JSON.stringify(req)}).then(r => r.json()) 로 바꾸면 됨.
import { PROCESSES, findProcess, findEquipment } from './data.js';

const SAFETY = ['밸브', '열어', '닫아', '비상', '정지', '조작', '스위치', '눌러', '작동시', '멈춰', '점검'];
const cite = (p) => [{ document_id: `SAMPLE-${p.id.toUpperCase().slice(0, 4)}-001`, title: `[샘플] ${p.name} 공정 개요`, page: null, version: 'sample-0.1' }];

export function mockTutor(req) {
  const { message, screen_context: ctx } = req;
  const p = findProcess(ctx.process_id) || PROCESSES[0];
  const eq = findEquipment(p.id, ctx.equipment_id);
  const m = message.replace(/\s/g, '');
  const base = { mode: 'free_question', evidence_status: 'grounded', citations: cite(p), scene_actions: [], follow_up_question: null, needs_clarification: false };
  let res;

  if (SAFETY.some(k => m.includes(k))) {
    res = { ...base, answer: '현장 안전 작업표준과 담당자에게 확인하세요.', mode: 'safety_redirect', evidence_status: 'not_applicable', citations: [] };
  } else if (m.includes('앞뒤') || m.includes('연결')) {
    const i = PROCESSES.findIndex(x => x.id === p.id), pv = PROCESSES[i - 1], nx = PROCESSES[i + 1];
    if (eq) {
      const k = p.equipment.indexOf(eq), pe = p.equipment[k - 1], ne = p.equipment[k + 1];
      res = { ...base, answer: `${eq.name} 앞에는 ${pe ? pe.name + '(' + pe.output + ')' : (pv ? pv.name + ' 공정의 결과물인 ' + p.materialIn.label.split(':')[0] : '원료 입고')}이 있고, 뒤에는 ${ne ? ne.name : (nx ? nx.name + ' 공정' : '출하')}이(가) 이어집니다. 이 설비는 ${eq.input}을(를) 받아 ${eq.output}으로 바꿉니다.`, scene_actions: [{ type: 'highlight', target_id: eq.id }], follow_up_question: `${ne ? ne.name : '다음 공정'}에서는 소재가 어떻게 달라질까요?` };
    } else {
      res = { ...base, answer: `${p.name} 공정은 ${pv ? pv.name + ' 다음' : '가장 처음'}이고 ${nx ? nx.name + ' 앞' : '마지막'}에 있습니다. ${p.io}. ${pv ? pv.name + '에서 만든 ' + p.materialIn.label.split(':')[0] + '을(를) 받아' : '원료를 받아'} ${nx ? nx.name + '으로 보냅니다.' : '최종 제품을 만듭니다.'}`, follow_up_question: '이 공정에서 소재의 상태(고체/액체)는 어떻게 바뀔까요?' };
    }
  } else if (m.includes('순서') || m.includes('전체')) {
    res = { ...base, mode: 'guided', answer: `${p.name} 공정 순서: ${p.equipment.map((e, i) => (i + 1) + '. ' + e.name).join(' → ')}. 소재 흐름을 재생합니다.`, scene_actions: [{ type: 'play_animation', target_id: p.id }], follow_up_question: '전체 4공정 순서(제선→제강→연주→열간압연)도 말할 수 있나요?' };
  } else if (m.includes('과정') || m.includes('흐름') || m.includes('보여')) {
    res = { ...base, mode: 'guided',
      answer: `${p.name} 공정의 소재 흐름을 재생합니다. ${p.io}. ${p.summary}`,
      scene_actions: [{ type: 'play_animation', target_id: p.id }],
      follow_up_question: `소재의 색이 바뀌는 순간은 어느 설비를 지날 때일까요?` };
  } else if (m.includes('온도')) {
    const map = {
      ironmaking: '고로 안은 약 2,000℃, 나오는 용선은 약 1,500℃입니다. 온도가 낮으면 철이 녹지 않고, 너무 높으면 내화물이 손상됩니다.',
      steelmaking: '전로에서 산소가 탄소를 태우면 온도가 약 1,650℃까지 올라갑니다. 다음 공정(연주)에 맞는 온도를 정확히 맞추는 것이 핵심입니다.',
      continuous_casting: '용강이 너무 뜨거우면 겉껍질(쉘)이 얇아 터질 수 있고, 너무 차가우면 노즐이 막힙니다. 그래서 턴디시 온도를 촘촘히 관리합니다.',
      rolling: '슬라브를 약 1,200℃로 달궈야 부드럽게 눌리고, 마지막 사상 온도와 권취 온도가 강판의 조직·강도를 결정합니다.',
    };
    res = { ...base, answer: map[p.id], follow_up_question: '온도가 너무 낮으면 어떤 문제가 생길까요?',
      scene_actions: eq ? [{ type: 'highlight', target_id: eq.id }] : [] };
  } else if (m.includes('다음')) {
    const i = PROCESSES.findIndex(x => x.id === p.id);
    const nx = PROCESSES[i + 1];
    res = nx
      ? { ...base, mode: 'guided', answer: `${p.name}의 결과물은 ${nx.name} 공정으로 갑니다. ${nx.io}. 화면을 ${nx.name}으로 이동합니다.`, scene_actions: [{ type: 'goto_process', target_id: nx.id }, { type: 'highlight', target_id: nx.equipment[0].id }], follow_up_question: `${nx.name}의 첫 설비인 ${nx.equipment[0].name}은(는) 무엇을 할까요?` }
      : { ...base, answer: '열간압연은 이 데모의 마지막 공정입니다. 열연 코일은 이후 냉간압연·도금 공정으로 이어집니다.', evidence_status: 'partial' };
  } else if (eq && (m.includes('뭐') || m.includes('무엇') || m.includes('설비') || m.includes('역할') || m.includes('이거'))) {
    res = { ...base,
      answer: `${eq.name}(${eq.id})은(는) ${eq.role} 입력은 ${eq.input}, 출력은 ${eq.output}입니다. ${eq.notes[0]}`,
      scene_actions: [{ type: 'focus', target_id: eq.id }, { type: 'highlight', target_id: eq.id }],
      follow_up_question: `${eq.name}에서 나온 ${eq.output.split('(')[0].trim()}은(는) 다음에 어디로 갈까요?` };
  } else if (!eq && (m.includes('뭐') || m.includes('설비') || m.includes('이거'))) {
    res = { ...base, needs_clarification: true, evidence_status: 'partial',
      answer: `어떤 설비인지 화면에서 먼저 클릭해 주세요. ${p.name} 공정에는 ${p.equipment.map(e => e.name).join(', ')}이(가) 있습니다.`,
      scene_actions: [{ type: 'highlight', target_id: p.equipment[0].id }] };
  } else {
    res = { ...base, evidence_status: 'partial',
      answer: `${p.name} 공정 요약: ${p.summary} (샘플 자료 기준이며, 질문과 정확히 맞는 문서를 찾지 못했습니다.)`,
      follow_up_question: `${p.name}에서 가장 중요한 설비는 무엇이라고 생각하나요?` };
  }
  return new Promise(r => setTimeout(() => r(res), 700));
}

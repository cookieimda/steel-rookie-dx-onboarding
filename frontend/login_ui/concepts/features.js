// 학습 기록 허브 시안(hub-concepts.html)이 쓰는 기능 10개와 그림. 기존 화면은 읽지도 고치지도 않는다(시안 전용).
// art(): 200×140 SVG 아이콘. 색은 브랜드 3색(주황 · 차콜 · 미색)만 쓴다.
// id: [사용하기]를 누르면 실제 화면 창(live.html#id)이 그 기능의 화면을 연다.

const O = '#ff9e64', D = '#1d2027', D2 = '#2a2e37', C = '#f4ece6', L = 'rgba(255,255,255,.18)';
const svg = (body) => `<svg viewBox="0 0 200 140" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const FEATURES = [
  {
    id: 'steps', num: '01', name: '작동 단계', en: 'OPERATION STEPS', group: '배우기',
    line: '설비가 어떤 순서로 움직이는지 2D 도면으로 한 단계씩 봐요.',
    how: ['위 공정 탭(제선·제강·연주·열간압연)을 고른다', '도면에서 설비를 누른다', '1, 2, 3… 단계를 넘기며 설명을 읽는다'],
    say: '도면에서 설비를 누르고 번호를 넘겨 봐. 쇳물이 어디로 가는지 한눈에 보여!',
    keys: ['2d', '도면', '설비', '공정', '단계'],
    art: () => svg(`<rect x="14" y="78" width="172" height="10" rx="3" fill="${D2}"/>
      <path d="M30 78 L170 52 L170 78 Z" fill="${O}" opacity=".85"/>
      <circle cx="40" cy="48" r="16" fill="none" stroke="${C}" stroke-width="3"/><circle cx="40" cy="48" r="7" fill="${O}"/>
      ${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="${24 + i * 26}" y="96" width="20" height="8" rx="2" fill="${L}"/>`).join('')}
      ${[1, 2, 3].map((i) => `<circle cx="${40 + i * 30}" cy="120" r="7" fill="${i === 1 ? O : 'none'}" stroke="${O}" stroke-width="2"/><text x="${40 + i * 30}" y="124" font-size="9" text-anchor="middle" fill="${i === 1 ? D : O}" font-family="monospace">${i}</text>`).join('')}`),
  },
  {
    id: 'todo', num: '02', name: '안 해 본 실습', en: 'UNTRIED LABS', group: '해 보기',
    line: '학습 랩 맨 위 "오늘의 실습 경로"에서 아직 안 해 본 실습과 공정별 진행을 보여 줘요.',
    how: ['학습 랩을 연다', '오늘의 실습 경로 1·2·3단계를 본다', '아래 공정 칸에서 아직 비어 있는 공정을 고른다'],
    say: '오늘의 실습 경로 1단계부터 해 봐. 아래 공정 칸이 차오르면 다 해 본 거야!',
    keys: ['실습', '경험', '랩', '경로', '오늘'],
    art: () => svg(`${[0, 1, 2, 3].map((r) => [0, 1, 2, 3, 4].map((c) => {
      const on = (r * 5 + c) % 3 !== 0;
      return `<rect x="${34 + c * 28}" y="${18 + r * 28}" width="22" height="22" rx="5" fill="${on ? O : 'none'}" stroke="${on ? O : L}" stroke-width="2" opacity="${on ? 0.9 : 1}"/>`;
    }).join('')).join('')}
      <path d="M150 112 l8 8 l16 -18" stroke="${C}" stroke-width="4" fill="none" stroke-linecap="round"/>`),
  },
  {
    id: 'report', num: '03', name: '학습 보고서', en: 'REPORT · PDF', group: '기록',
    line: '공정을 고르면 내 이해도·오개념·복습 기록을 A4 보고서로 보여 주고 PDF로 저장해요.',
    how: ['학습 랩 → 보고서를 연다', '공정 칩(제선·제강…)을 고르고 미리보기를 확인한다', '[PDF로 저장]을 누른다'],
    say: '보고서는 A4 한 장으로 뽑혀. 설비마다 봤는지 안 봤는지도 다 나와!',
    keys: ['pdf', '보고서', '인쇄', '출력', 'a4'],
    art: () => svg(`<rect x="58" y="10" width="84" height="116" rx="6" fill="${C}"/>
      <rect x="70" y="24" width="40" height="6" rx="2" fill="${D}"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${72 + i * 15}" y="${86 - [20, 34, 26, 44][i]}" width="10" height="${[20, 34, 26, 44][i]}" rx="2" fill="${i === 3 ? O : '#c9b9b0'}"/>`).join('')}
      ${[0, 1, 2].map((i) => `<rect x="70" y="${96 + i * 8}" width="${60 - i * 14}" height="4" rx="2" fill="#c9b9b0"/>`).join('')}
      <rect x="120" y="96" width="34" height="20" rx="5" fill="${O}"/><text x="137" y="110" font-size="10" font-weight="700" text-anchor="middle" fill="${D}" font-family="sans-serif">PDF</text>`),
  },
  {
    id: 'whatif', num: '04', name: 'What-if', en: 'WHAT-IF', group: '해 보기',
    line: '고로 조건(소결광·코크스·송풍 온도…)을 바꾸면 용선 온도·슬래그·CO2가 어떻게 변하는지 계산해요.',
    how: ['왼쪽 슬라이더로 조건 하나를 바꾼다', '오른쪽 수치 칸과 용선 온도 막대의 변화를 본다', '[기준 조건으로]로 되돌려 비교한다'],
    say: '한 번에 하나만 바꿔 봐. 그래야 무엇 때문에 변했는지 알 수 있어.',
    keys: ['시뮬레이션', '조업', '고로', '슬라이더', '계산', '용선'],
    art: () => svg(`${[0, 1, 2].map((i) => `<rect x="24" y="${30 + i * 32}" width="100" height="6" rx="3" fill="${L}"/><rect x="24" y="${30 + i * 32}" width="${[70, 40, 86][i]}" height="6" rx="3" fill="${O}"/><circle cx="${24 + [70, 40, 86][i]}" cy="${33 + i * 32}" r="8" fill="${C}"/>`).join('')}
      <path d="M150 104 A30 30 0 1 1 186 104" fill="none" stroke="${L}" stroke-width="6" stroke-linecap="round"/>
      <path d="M150 104 A30 30 0 0 1 178 60" fill="none" stroke="${O}" stroke-width="6" stroke-linecap="round"/>
      <text x="168" y="96" font-size="12" text-anchor="middle" fill="${C}" font-family="monospace">1500</text>`),
  },
  {
    id: 'synapse', num: '05', name: 'What-if 시냅스', en: 'SYNAPSE', group: '해 보기',
    line: '조건 → 성분 → 결과로 이어지는 선을 따라 원인과 결과를 그래프로 봐요.',
    how: ['[해 보기] 칩 하나를 누른다', '빛이 번지는 선을 따라간다', '노드를 눌러 풀이를 읽는다'],
    say: '선이 굵을수록 영향이 커. 빛이 어디로 번지는지 따라가 봐!',
    keys: ['그래프', '원인', '결과', '노드', '인과'],
    art: () => {
      const a = [[30, 30], [30, 70], [30, 110]], b = [[100, 50], [100, 92]], c = [[170, 30], [170, 70], [170, 110]];
      const lines = a.flatMap(([x, y]) => b.map(([X, Y]) => `<path d="M${x} ${y} C65 ${y} 65 ${Y} ${X} ${Y}" stroke="${y === 70 ? O : L}" stroke-width="${y === 70 ? 3 : 1.5}" fill="none"/>`))
        .concat(b.flatMap(([x, y]) => c.map(([X, Y]) => `<path d="M${x} ${y} C135 ${y} 135 ${Y} ${X} ${Y}" stroke="${y === 50 && Y === 70 ? O : L}" stroke-width="${y === 50 && Y === 70 ? 3 : 1.5}" fill="none"/>`)));
      return svg(`${lines.join('')}${[...a, ...b, ...c].map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 1 || i === 3 || i === 6 ? 9 : 7}" fill="${i === 1 || i === 3 || i === 6 ? O : D2}" stroke="${C}" stroke-width="2"/>`).join('')}`);
    },
  },
  {
    id: 'notes', num: '06', name: '설비 메모', en: 'EQUIPMENT NOTES', group: '기록',
    line: '설비를 고르고 질문·메모·팁을 남겨요. 그 설비를 다시 고르면 남긴 메모가 보여요.',
    how: ['위 목록에서 공정·설비를 고른다(또는 [2D에서 고른 설비])', '질문·메모·팁 중 하나를 고르고 적는다', '[남기기]를 누른다. 나만 보기도 고를 수 있다'],
    say: '현장에서 들은 말, 헷갈린 점을 한 줄씩 적어 둬. 나중에 큰 도움 돼!',
    keys: ['메모', '노트', '필기', '기록', '질문', '팁'],
    art: () => svg(`<rect x="40" y="18" width="104" height="104" rx="8" fill="${C}" transform="rotate(-4 92 70)"/>
      <rect x="62" y="12" width="40" height="14" rx="3" fill="${O}" opacity=".85" transform="rotate(-4 92 70)"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="54" y="${46 + i * 16}" width="${[74, 60, 70, 40][i]}" height="5" rx="2.5" fill="#c9b9b0" transform="rotate(-4 92 70)"/>`).join('')}
      <path d="M150 112 L176 60 L186 66 L160 118 Z" fill="${O}"/><path d="M150 112 L160 118 L148 124 Z" fill="${C}"/>`),
  },
  {
    id: 'patterns', num: '07', name: '내 오답 유형', en: 'MY MISTAKES', group: '기록',
    line: '비슷한 오개념끼리 묶어 보여 줘요. 같은 묶음이 여러 번 나오면 그 부분을 집중 복습해요.',
    how: ['학습 랩 → 내 오답 유형을 연다', '여러 번 나온 묶음부터 본다', '그 묶음의 개념을 다시 복습한다'],
    say: '틀린 건 부끄러운 게 아니야. 제일 자주 나온 묶음 하나만 오늘 잡자!',
    keys: ['오답', '틀림', '약점', '오개념', '복습', '유형'],
    art: () => svg(`<circle cx="70" cy="70" r="44" fill="none" stroke="${L}" stroke-width="14"/>
      <circle cx="70" cy="70" r="44" fill="none" stroke="${O}" stroke-width="14" stroke-dasharray="120 400" transform="rotate(-90 70 70)"/>
      <circle cx="70" cy="70" r="44" fill="none" stroke="${C}" stroke-width="14" stroke-dasharray="60 400" stroke-dashoffset="-124" transform="rotate(-90 70 70)"/>
      ${[0, 1, 2].map((i) => `<rect x="128" y="${40 + i * 22}" width="${[54, 34, 20][i]}" height="10" rx="5" fill="${i ? L : O}"/>`).join('')}`),
  },
  {
    id: 'card', num: '08', name: '사원증', en: 'EMPLOYEE CARD', group: '기록',
    line: '연속 학습일·직급·XP·오늘의 미션을 사원증 한 장에 모아 보여 줘요. 다시 볼 개념(복습)도 여기서 해요.',
    how: ['헤더의 🔥 칩이나 사원증 탭을 누른다', '오늘의 미션 체크와 XP 막대를 본다', '아래 다시 볼 개념을 복습한다'],
    say: '매일 조금씩 하면 직급이 올라가! 오늘 연속 기록 끊기지 않게 하자.',
    keys: ['xp', '레벨', '직급', '연속', '배지', '복습', '미션'],
    art: () => svg(`<rect x="52" y="10" width="96" height="124" rx="10" fill="${D2}" stroke="${O}" stroke-width="2"/>
      <rect x="86" y="4" width="28" height="12" rx="4" fill="${C}"/>
      <circle cx="100" cy="52" r="20" fill="${C}"/><circle cx="93" cy="49" r="2.5" fill="${D}"/><circle cx="107" cy="49" r="2.5" fill="${D}"/>
      <rect x="70" y="82" width="60" height="7" rx="3" fill="${C}"/><rect x="78" y="95" width="44" height="5" rx="2.5" fill="${L}"/>
      <rect x="66" y="110" width="68" height="8" rx="4" fill="${L}"/><rect x="66" y="110" width="44" height="8" rx="4" fill="${O}"/>`),
  },
  {
    id: 'exam', num: '09', name: '평가 시험', en: 'PROVE & PASS', group: '평가',
    line: '공정별 시험을 보고 이해도 80%를 넘으면 다음 공정이 열려요.',
    how: ['열린 공정의 시험지를 고른다', '[시험 응시]를 누르고 내 말로 답을 쓴다', '80%를 넘으면 다음 공정이 열린다'],
    say: '외운 말 말고 네 말로 설명해 봐. 그게 진짜 아는 거야. 준비됐어?',
    keys: ['시험', '평가', '테스트', '통과', '80'],
    art: () => svg(`<rect x="24" y="22" width="152" height="96" rx="8" fill="${C}"/>
      <path d="M40 90 L76 90" stroke="#c9b9b0" stroke-width="5" stroke-linecap="round"/>
      ${[0, 1, 2, 3].map((i) => `<rect x="${44 + i * 32}" y="${96 - [44, 56, 30, 22][i]}" width="20" height="${[44, 56, 30, 22][i]}" rx="3" fill="${i < 2 ? O : '#d9cbc3'}"/>`).join('')}
      <path d="M34 50 H166" stroke="${D}" stroke-width="2" stroke-dasharray="5 4"/><text x="166" y="44" font-size="10" text-anchor="end" fill="${D}" font-family="monospace" font-weight="700">80%</text>`),
  },
];

export const POSEOKHO = { model: '/3d-demo/models/character/tutor.glb', name: '포석호' };

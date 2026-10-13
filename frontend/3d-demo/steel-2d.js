// <steel-2d> — 제강 공정 2D 뷰. GLB의 최상위 그룹 이름을 읽어 설비 카드를 만들고, 단계별 2D 장면을 보여준다.
// 연동 규약은 <steel-scene>(scene.js)과 같다:
//   속성   process="steelmaking"  selected="<설비id>"  theme="dark|light"  [glb="models/steelmaking.glb"]
//   이벤트 steel-select { id: <설비id|null>, stage: <2D 단계id>, group: <GLB 그룹명|null> }  (bubbles, composed)
// 팀 HTML(.dc.html)에서는 scene.js 옆에 <script type="module" src="./steel-2d.js"></script> 를 추가하고
//   <x-import component-from-global-scope="steel-2d" process="{{ processId }}" selected="{{ selectedAttr }}" theme="{{ theme }}">
// 로 넣으면 된다. GLB를 바꾸면 카드·단계 상태가 그 GLB의 그룹 이름을 따라간다.

const LANES = [['01', '용선 준비'], ['02', '전로 취련'], ['03', '출강 · 2차 정련'], ['04', '연주 이송']];
const IGNORE = /^(\d+_)?(site|ground|floor|terrain|common)$/i;

// 제강 2D 단계. match = GLB 그룹 이름 정규식(먼저 맞는 단계가 가져감), eq = 3D(data.js) 설비 id.
const STAGES = { steelmaking: [
  { id: 'hotmetal', name: '용선 수입 · 장입 래들', en: 'Hot Metal Input', lane: 0, eq: 'hot_metal_pretreatment', match: /hot_?metal|torpedo|input|charge_ladle/i,
    concept: '토페도카로 온 용선을 장입 래들에 옮겨 담는 시작 장면입니다. 온도와 양을 확인한 뒤 KR 탈황 또는 전로로 보냅니다.',
    steps: [['토페도카가 용선을 싣고 제강 공장에 도착', ''], ['경동시켜 장입 래들로 용선 이적', '~5분'], ['래들 무게·온도 측정', ''], ['KR 탈황 또는 전로 장입으로 이동', '']],
    design: '토페도카 → 래들 이적을 수평 흐름 한 줄로. 용선은 주황, 래들 단면은 내화물 색으로 고정.' },
  { id: 'kr', name: '용선 예비처리 (KR 탈황)', en: 'Hot Metal Pretreatment', lane: 0, eq: 'hot_metal_pretreatment', match: /\bKR\b|desulf|pretreat/i,
    concept: '전로 투입 전 용선의 황을 낮추는 선택 공정. 래들 단면에 임펠러 회전·탈황제 투입·슬래그 제거만 보여주면 역할이 전달됩니다.',
    steps: [['장입 래들을 KR 스테이션으로 이동', ''], ['임펠러를 쇳물 속으로 내려 회전·교반', '~10분'], ['탈황제를 투입해 황을 슬래그로 이동', ''], ['스키머로 표면 슬래그를 긁어 포트로 배출', '~10분'], ['필요 시 탈인·탈규 처리', '선택']],
    design: '래들 단면 + 회전 임펠러 + 슬래그 스키밍 3동작만 강조.' },
  { id: 'bof', name: '전로 (BOF)', en: 'Basic Oxygen Furnace', lane: 1, eq: 'bof_converter', match: /BOF|converter|charg/i,
    concept: '제강의 중심 장면. "장입 쪽 틸팅 → 수직 취련 → 출강 쪽 틸팅 → 슬래그 배출" 4자세가 공정의 핵심입니다.',
    steps: [['전로를 장입 쪽으로 기울여 고철 투입', '~2분'], ['장입 래들로 용선 투입', '~3분'], ['전로를 수직으로 세우고 후드 하강', ''], ['산소 랜스 하강 + 부원료 투입', '15~20분'], ['탈탄 반응·거품 슬래그·저취 교반', ''], ['서브랜스로 온도·탄소 측정', ''], ['출강 쪽으로 기울여 래들에 용강 출강', '4~8분'], ['슬래그 다트로 슬래그 유출 억제', ''], ['반대 방향으로 잔류 슬래그 배출', ''], ['슬래그 스플래싱 후 다음 회차', '총 35~45분']],
    design: '전로를 화면 중앙에 크게 두고, 좌=장입 / 상=랜스·후드 / 우=출강 / 좌하=슬래그 포트로 4방향 의미를 고정. 각 단계에서 해당 방향만 밝힙니다.' },
  { id: 'og', name: '산소 랜스 · 배가스(OG)', en: 'Oxygen Lance & OG System', lane: 1, eq: 'oxygen_lance_offgas', match: /lance|off_?gas|\bOG\b|oxygen|hood/i,
    concept: '랜스가 반응을 만들고, 후드/OG가 그 반응에서 나온 가스를 처리합니다. 전로 단면과 오른쪽 가스 배관을 한 화면에 붙입니다.',
    steps: [['랜스 3중 수냉 구조와 다공 노즐', ''], ['랜스 카가 취련 높이까지 랜스 하강', ''], ['초음속 산소 제트가 쇳물 표면에 캐비티 형성', ''], ['스커트 하강, CO계 배가스 포집', ''], ['수냉 후드→스프레이 쿨러→벤츄리→IDF', ''], ['고농도 가스는 LDG 회수, 낮은 구간은 플레어 처리', '']],
    design: '왼쪽은 랜스 끝 확대 단면, 오른쪽은 "후드 → 냉각 → 집진 → 팬 → 홀더/플레어" 배관 흐름. 점선 애니메이션으로 가스 방향을 고정 표시.' },
  { id: 'ladle', name: '출강 래들 · 크레인', en: 'Teeming Ladle & Ladle Crane', lane: 2, eq: 'tapping_ladle_crane', match: /tapping|crane|ladle_?system|teeming/i,
    concept: '전로에서 나온 용강을 다음 공정으로 넘기는 운반 설비. "대차 → 크레인 → LF/RH" 이동이 보여야 공정이 끊기지 않습니다.',
    steps: [['빈 래들이 대차로 전로 아래 진입', ''], ['출강과 동시에 합금 투입 + 바닥 Ar 교반', '4~8분'], ['출강 종료 후 보온 처리, 대차 이탈', ''], ['천장 크레인이 래들을 인양', ''], ['LF/RH 또는 연주 방향으로 수평 이동', '~5분'], ['슬라이딩 게이트는 연주 전까지 닫힘', '']],
    design: '하단 레일의 래들 대차와 상단 크레인 레일을 동시에 그려 수평·수직 이동을 분리. 래들 단면에는 바닥 노즐과 Ar 기포를 표시.' },
  { id: 'lfrh', name: '2차 정련 (LF · RH)', en: 'Ladle Furnace & RH Degasser', lane: 2, eq: 'secondary_refining', match: /\bLF\b|\bRH\b|refin|degas|secondary/i,
    concept: 'LF는 가열·합금 조정, RH는 진공 탈가스입니다. 같은 래들을 중심에 두고 상부 장치만 바뀌는 구조로 그리면 2D/3D 재사용성이 좋습니다.',
    steps: [['LF 수냉 루프 덮고 전극 3본 아크 가열', '~30분'], ['LF 합금·와이어 투입 + Ar 교반', ''], ['RH 진공조의 스노클 2본을 용강에 침지', ''], ['스팀 이젝터로 진공 형성', ''], ['Ar 상승관으로 용강을 순환', '15~25분'], ['탈가스·합금 조정 후 진공 해제', '']],
    design: '화면을 LF/RH 반반으로 나누되 래들 형상은 동일하게 재사용. RH는 두 다리와 순환 화살표만 명확하면 내부 원리가 바로 보입니다.' },
  { id: 'transfer', name: '래들 이송 → 연주', en: 'Ladle Transfer to Caster', lane: 3, eq: 'ladle_transfer', match: /transfer|caster|product|turret/i,
    concept: '제강에서 연주로 넘어가는 연결 장면. "래들이 어느 경로로 터릿까지 가는지"를 평면도로 보여주는 게 핵심입니다.',
    steps: [['정련 완료 래들에 보온 커버, 온도 확인', ''], ['대차/크레인으로 연주 설비까지 이동', '~5~10분'], ['크레인이 래들 터릿 빈 팔에 거치', ''], ['슬라이딩 게이트 점검 + 롱 노즐 준비', '']],
    design: '공장 평면도를 단순화해 LF/RH → 이동 레일 → 연주 터릿 3영역만 표시. 래들 아이콘 자체를 이동시키면 충분합니다.' },
] };

// 설비 카드 아이콘 (viewBox 0 0 184 102)
const ICONS = {
  hotmetal: `<path class="structure" d="M8 89H176"/><path class="metal" d="M40 35H130L152 47V61L130 74H40L20 61V48Z"/><path class="heat" d="M75 28H95V35H75Z"/><circle class="soft" cx="46" cy="83" r="6"/><circle class="soft" cx="124" cy="83" r="6"/><path class="flow motion" d="M30 16H150"/>`,
  kr: `<path class="structure" d="M8 90H176"/><path class="metal" d="M50 30L42 86H132L124 30Z"/><path class="heat" d="M52 48H122V84H52Z"/><path class="structure" d="M87 6V60M70 60H104"/><path class="flow motion" d="M60 40Q87 30 114 40"/>`,
  bof: `<path class="structure" d="M8 90H176"/><path class="metal" d="M92 14C62 14 52 40 52 60C52 80 70 92 92 92C114 92 132 80 132 60C132 40 122 14 92 14Z"/><path class="heat" d="M64 62C66 80 78 88 92 88C106 88 118 80 120 62Z"/><path class="structure" d="M92 0V48M80 48L92 62L104 48"/><path class="flow motion" d="M30 40H60M124 40H154"/>`,
  og: `<path class="structure" d="M8 90H176"/><path class="metal" d="M30 60H90V86H30Z"/><path class="structure" d="M60 10V60M90 30H130V70H160"/><circle class="soft" cx="160" cy="70" r="12"/><path class="heat" d="M34 72H86V82H34Z"/><path class="flow motion" d="M90 30H130V70H148"/>`,
  ladle: `<path class="structure" d="M8 90H176M20 12H164M92 12V34"/><path class="metal" d="M60 34L52 86H132L124 34Z"/><path class="heat" d="M62 52H122V84H62Z"/><path class="flow motion" d="M30 12H154"/>`,
  lfrh: `<path class="structure" d="M8 90H176"/><path class="metal" d="M24 40L18 86H78L72 40Z"/><path class="heat" d="M26 56H70V84H26Z"/><path class="structure" d="M36 10V50M48 10V50M60 10V50"/><path class="metal" d="M110 40L104 86H164L158 40Z"/><path class="heat" d="M112 56H156V84H112Z"/><path class="soft" d="M112 8H156V34H112Z"/><path class="structure" d="M122 34V56M146 34V56"/><path class="flow motion" d="M122 50V38H146V50"/>`,
  transfer: `<path class="structure" d="M8 80H176M8 86H176"/><path class="metal" d="M40 44L34 78H86L80 44Z"/><path class="heat" d="M42 58H78V76H42Z"/><circle class="structure" cx="140" cy="46" r="20"/><path class="structure" d="M120 46H160"/><path class="flow motion" d="M20 30H120"/>`,
  other: `<path class="structure" d="M8 90H176"/><path class="metal" d="M40 30H144V86H40Z"/><path class="structure" d="M60 30V86M92 30V86M124 30V86"/>`,
};

// 단계별 2D 장면 (viewBox 0 0 700 420). data-s="n n" = 그 단계 번호에서 강조.
const bub = (xs, y, d = .28) => xs.map((x, i) => `<circle cx="${x}" cy="${y}" r="4" fill="#fff" class="bubble" style="animation-delay:${i * d}s"/>`).join('');
const SCENES = {
hotmetal: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="350" y="26" class="lbl strong">토페도카 → 장입 래들 이적</text>
 <g data-s="1 2 3 4" class="always"><rect x="40" y="300" width="330" height="6" fill="#738392"/></g>
 <g data-s="1 2"><path d="M90 200 H300 L335 232 V262 L300 290 H90 L55 262 V232 Z" class="structure"/><rect x="100" y="218" width="195" height="58" class="liquid" opacity=".85"/><circle cx="110" cy="298" r="12" fill="#313c48" stroke="#7c8b9a" stroke-width="2"/><circle cx="150" cy="298" r="12" fill="#313c48" stroke="#7c8b9a" stroke-width="2"/><circle cx="240" cy="298" r="12" fill="#313c48" stroke="#7c8b9a" stroke-width="2"/><circle cx="280" cy="298" r="12" fill="#313c48" stroke="#7c8b9a" stroke-width="2"/><text x="195" y="332" class="lbl s">토페도카 (용선 운반)</text></g>
 <g data-s="2"><path d="M335 245 Q400 255 455 300" class="hotFlow"/><text x="400" y="240" class="lbl s">경동 · 이적</text></g>
 <g data-s="2 3 4"><path d="M440 290 L425 390 H565 L550 290 Z" class="refractory"/><rect x="438" y="312" width="114" height="68" class="liquid" opacity=".85"/><rect x="438" y="302" width="114" height="10" class="slag"/><text x="495" y="410" class="lbl s">장입 래들</text></g>
 <g data-s="3"><rect x="585" y="150" width="80" height="48" rx="6" class="structure"/><path d="M625 198 L560 290" class="gas"/><text x="625" y="140" class="lbl s">무게 · 온도 측정</text></g>
 <g data-s="4"><path d="M568 345 H690" class="arrowFlow"/><text x="640" y="372" class="lbl s">KR / 전로로</text></g>
 </svg>`,
kr: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="350" y="28" class="lbl strong">KR 탈황 · 선택 공정</text>
 <g data-s="1 2 3 4 5" class="gap3d"><path d="M180 120 L160 340 H370 L350 120 Z" class="structure gap3d"/><rect x="171" y="155" width="188" height="172" class="liquid" opacity=".8"/></g>
 <g data-s="2" class="gap3d"><rect x="258" y="38" width="14" height="165"/><g class="spin"><rect x="220" y="220" width="90" height="13"/><rect x="258" y="185" width="14" height="84"/></g><ellipse cx="265" cy="230" rx="70" ry="24" fill="none" class="arrowFlow"/><text x="265" y="52" class="lbl s">KR 임펠러</text></g>
 <g data-s="3" class="gap3d"><rect x="402" y="56" width="55" height="42"/><path d="M430 98 L340 160" class="gas"/><text x="430" y="48" class="lbl s">탈황제 호퍼</text></g>
 <g data-s="4" class="gap3d"><rect x="170" y="145" width="188" height="12" class="slag"/><path d="M132 138 L198 152" stroke="#ff5d68" stroke-width="7"/><path d="M360 154 L475 240" class="gas"/><rect x="470" y="240" width="75" height="65" class="gap3d"/><text x="505" y="322" class="lbl s">슬래그 포트</text><text x="115" y="127" class="lbl s">스키머</text></g>
 <g data-s="5"><path d="M70 210 L165 245" class="waterFlow"/><text x="80" y="195" class="lbl s">옵션 탈인·탈규</text></g>
 </svg>`,
bof: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="350" y="26" class="lbl strong">BOF 중심 4자세: 장입 → 취련 → 출강 → 슬래그 배출</text>
 <g data-s="1 2 3 4 5 6 7 8 9 10" class="always"><line x1="350" y1="135" x2="350" y2="335" stroke="#738392" stroke-width="3"/><circle cx="350" cy="225" r="9" fill="#39d98a"/><text x="350" y="356" class="lbl s">Trunnion 축</text></g>
 <g data-s="1 2 3 4 5 6 7 8 9 10" class="have3d"><path d="M350 112 C282 112 260 158 260 220 C260 292 296 328 350 328 C404 328 440 292 440 220 C440 158 418 112 350 112 Z" class="structure have3d"/><path d="M350 122 C296 122 278 160 278 219 C278 278 307 311 350 311 C393 311 422 278 422 219 C422 160 404 122 350 122 Z" class="refractory"/><path d="M286 235 C290 286 312 307 350 307 C388 307 410 286 414 235 Z" class="liquid"/><ellipse cx="350" cy="110" rx="30" ry="10" fill="#0b1118" stroke="#39d98a" stroke-width="3"/><rect x="436" y="240" width="28" height="11" fill="#714d31" stroke="#39d98a" stroke-width="2"/><text x="493" y="248" class="lbl s">출강구</text></g>
 <g data-s="1" class="gap3d"><path d="M52 80 L130 122 L228 122" class="pipe gap3d"/><path d="M122 88 L218 135" class="hotFlow"/><text x="125" y="68" class="lbl s">고철 슈트</text></g>
 <g data-s="2" class="gap3d"><path d="M65 190 L128 158 L214 165" fill="none" class="gap3d"/><path d="M205 166 Q240 170 282 205" class="hotFlow"/><text x="126" y="206" class="lbl s">장입 래들</text></g>
 <g data-s="3 4 5 6" class="gap3d"><rect x="305" y="67" width="90" height="14" class="gap3d"/><text x="350" y="58" class="lbl s">스커트/후드 · OG 화면과 연결</text></g>
 <g data-s="4 5" class="have3d"><rect x="346" y="25" width="8" height="150" fill="#93a0ad" stroke="#39d98a" stroke-width="2"/><polygon points="341,175 359,175 350,190" fill="#93a0ad" stroke="#39d98a"/><path d="M350 190 L330 228 M350 190 L350 228 M350 190 L370 228" stroke="#e6f5ff" stroke-width="3" stroke-dasharray="5 5"/><text x="402" y="44" class="lbl s">산소 랜스</text></g>
 <g data-s="4" class="gap3d"><rect x="510" y="56" width="55" height="38" class="gap3d"/><path d="M536 94 L400 150" class="gas"/><text x="536" y="47" class="lbl s">부원료 호퍼</text></g>
 <g data-s="5" class="gap3d">${bub([318, 338, 362, 382], 301)}<text x="350" y="338" class="lbl s">저취 노즐</text></g>
 <g data-s="6" class="gap3d"><rect x="505" y="128" width="7" height="98" class="gap3d lift"/><text x="557" y="128" class="lbl s">서브랜스</text></g>
 <g data-s="7 8" class="gap3d"><path d="M510 270 L497 343 H595 L582 270 Z" class="gap3d"/><path d="M465 246 Q500 255 520 285" class="hotFlow"/><rect x="482" y="344" width="127" height="16" class="gap3d"/><circle cx="500" cy="368" r="7" class="gap3d"/><circle cx="590" cy="368" r="7" class="gap3d"/><text x="548" y="395" class="lbl s">출강 래들 + 대차</text></g>
 <g data-s="9" class="gap3d"><rect x="85" y="275" width="86" height="67" class="gap3d"/><path d="M260 202 Q185 240 135 275" class="gas"/><text x="128" y="362" class="lbl s">슬래그 포트</text></g>
 <g data-s="10"><ellipse cx="350" cy="150" rx="18" ry="28" class="flame"/></g>
 </svg>`,
og: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="350" y="26" class="lbl strong">O₂ 반응 + OG 배가스 처리 경로</text>
 <g data-s="1 2 3" class="have3d"><rect x="95" y="40" width="14" height="185" fill="#8b99a8" stroke="#39d98a" stroke-width="2"/><rect x="99" y="40" width="6" height="185" fill="#56c8ff"/><polygon points="84,225 120,225 113,242 91,242" fill="#8b99a8" stroke="#39d98a"/><text x="102" y="260" class="lbl s">산소 랜스</text></g>
 <g data-s="2" class="gap3d"><rect x="58" y="38" width="88" height="38" rx="5" class="gap3d"/><line x1="102" y1="76" x2="102" y2="112" class="gas"/><text x="102" y="30" class="lbl s">랜스 카</text></g>
 <g data-s="3"><rect x="34" y="280" width="200" height="80" class="liquid" opacity=".85"/>${[-28, -14, 0, 14, 28].map(d => `<line x1="102" y1="242" x2="${102 + d * 2}" y2="285" stroke="#eaf7ff" stroke-width="3" stroke-dasharray="4 4"/>`).join('')}<ellipse cx="102" cy="286" rx="38" ry="12" fill="#ffd45d" class="pulse"/>${bub([62, 88, 117, 145, 185], 335, .25)}<text x="132" y="382" class="lbl s">캐비티 + CO 기포</text></g>
 <g data-s="4" class="gap3d"><rect x="34" y="260" width="200" height="14" class="gap3d lift"/><text x="134" y="250" class="lbl s">스커트(가동 후드)</text></g>
 <g data-s="5" class="gap3d"><path d="M235 267 L315 267 L315 90 L395 90 L395 160 L470 160 L470 90 L548 90" class="pipe gap3d"/><path d="M235 267 L315 267 L315 90 L395 90 L395 160 L470 160 L470 90 L548 90" class="gas"/><rect x="343" y="185" width="65" height="58" class="gap3d"/><text x="375" y="256" class="lbl s">스프레이 쿨러</text><rect x="435" y="185" width="65" height="58" class="gap3d"/><text x="467" y="256" class="lbl s">벤츄리</text><circle cx="530" cy="173" r="22" class="gap3d spin"/><text x="530" y="207" class="lbl s">IDF 팬</text></g>
 <g data-s="6" class="gap3d"><rect x="565" y="250" width="92" height="105" rx="9" class="gap3d"/><path d="M548 90 L610 90 L610 250" class="gas"/><text x="611" y="378" class="lbl s">LDG 가스 홀더</text><path d="M610 90 L655 90 L655 145" class="pipe gap3d"/><ellipse cx="655" cy="75" rx="10" ry="24" class="flame"/><text x="650" y="40" class="lbl s">플레어</text></g>
 </svg>`,
ladle: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="350" y="26" class="lbl strong">전로 출강 → 래들 대차 → 천장 크레인 → LF/RH</text>
 <g data-s="4 5" class="gap3d"><line x1="30" y1="55" x2="670" y2="55" stroke="#ff5d68" stroke-width="5" stroke-dasharray="8 6"/><g class="crane"><rect x="95" y="40" width="92" height="30" class="gap3d"/><line x1="141" y1="70" x2="141" y2="148" stroke="#ff5d68" stroke-width="2" stroke-dasharray="5 4"/><path d="M119 148 H163" stroke="#ff5d68" stroke-width="4"/><text x="141" y="34" class="lbl s">래들 크레인</text></g></g>
 <g data-s="1 2 3 4 5 6" class="have3d"><path d="M110 160 L94 315 H230 L214 160 Z" class="structure have3d"/><rect x="106" y="184" width="112" height="118" class="liquid" opacity=".84"/><rect x="106" y="174" width="112" height="10" class="slag"/><text x="162" y="336" class="lbl s">출강 래들</text></g>
 <g data-s="1 3" class="gap3d"><rect x="75" y="316" width="176" height="18" class="gap3d"/><circle cx="100" cy="348" r="9" class="gap3d"/><circle cx="226" cy="348" r="9" class="gap3d"/><line x1="30" y1="357" x2="300" y2="357" stroke="#ff5d68" stroke-width="3" stroke-dasharray="8 6"/><text x="162" y="380" class="lbl s">래들 대차</text></g>
 <g data-s="2" class="gap3d"><rect x="264" y="92" width="62" height="45" class="gap3d"/><path d="M295 137 L208 180" class="gas"/><text x="296" y="82" class="lbl s">합금 호퍼</text>${bub([135, 160, 185], 285)}<text x="230" y="300" class="lbl s">Ar 교반</text></g>
 <g data-s="6" class="gap3d"><rect x="146" y="305" width="32" height="18" class="gap3d"/><rect x="150" y="323" width="24" height="14" class="gap3d"/><text x="232" y="322" class="lbl s">슬라이딩 게이트 + 포러스 플러그</text></g>
 <g data-s="5"><rect x="410" y="235" width="115" height="100" class="structure"/><text x="468" y="225" class="lbl s">LF / RH</text><path d="M305 200 Q370 160 430 210" class="arrowFlow"/><rect x="557" y="235" width="110" height="100" class="structure ghost"/><text x="612" y="225" class="lbl s">연주</text></g>
 <g data-s="3" class="gap3d"><rect x="112" y="142" width="102" height="12" class="gap3d"/><text x="162" y="132" class="lbl s">래들 커버/보온재</text></g>
 </svg>`,
lfrh: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="175" y="28" class="lbl strong">LF · 가열/성분 조정</text><text x="525" y="28" class="lbl strong">RH · 진공 탈가스</text><line x1="350" y1="45" x2="350" y2="382" stroke="#263441" stroke-width="2"/>
 <g data-s="1 2" class="gap3d"><path d="M70 160 L55 350 H290 L275 160 Z" class="structure"/><rect x="66" y="190" width="213" height="145" class="liquid" opacity=".82"/><rect x="66" y="180" width="213" height="10" class="slag"/><rect x="48" y="138" width="250" height="20" class="gap3d"/>${[130, 175, 220].map(x => `<rect x="${x - 6}" y="54" width="12" height="150" class="gap3d lift"/><circle cx="${x}" cy="205" r="8" fill="#fff1b8" class="pulse"/>`).join('')}<text x="174" y="370" class="lbl s">LF 루프 · 전극 3본</text><rect x="286" y="70" width="45" height="38" class="gap3d"/><path d="M308 108 L270 178" class="gas"/><text x="307" y="59" class="lbl s">와이어/합금</text></g>
 <g data-s="2">${bub([130, 175, 220], 315, .3)}</g>
 <g data-s="3 4 5 6" class="have3d"><path d="M415 185 L402 350 H655 L642 185 Z" class="structure"/><rect x="413" y="212" width="231" height="125" class="liquid" opacity=".82"/><rect x="455" y="58" width="155" height="95" class="refractory have3d"/><text x="532" y="50" class="lbl s">RH 진공조</text></g>
 <g data-s="3 4 5" class="gap3d"><rect x="470" y="150" width="34" height="110" class="gap3d"/><rect x="560" y="150" width="34" height="110" class="gap3d"/><path d="M487 277 L487 108 L577 108 L577 277" class="arrowFlow"/><text x="531" y="294" class="lbl s">스노클 2본</text></g>
 <g data-s="4 6" class="gap3d"><path d="M610 92 L665 92 L665 55" class="pipe gap3d"/><path d="M610 92 L665 92 L665 57" class="gas"/><text x="632" y="42" class="lbl s">스팀 이젝터</text></g>
 <g data-s="5">${bub([495, 515, 535], 240, .27)}<text x="532" y="326" class="lbl s">Ar ↑ → 용강 순환</text></g>
 <g data-s="3 6" class="gap3d"><rect x="447" y="42" width="172" height="14" class="gap3d lift"/></g>
 </svg>`,
transfer: `<svg class="scene" viewBox="0 0 700 420" xmlns="http://www.w3.org/2000/svg">
 <text x="350" y="28" class="lbl strong">제강 → 연주 연결 평면도</text>
 <rect x="30" y="55" width="640" height="300" fill="#0b1118" stroke="#2b3948" stroke-dasharray="5 5"/>
 <g data-s="1"><rect x="70" y="120" width="135" height="110" class="structure"/><text x="138" y="106" class="lbl s">LF / RH</text><path d="M112 146 L103 216 H173 L164 146 Z" class="structure"/><rect x="110" y="160" width="56" height="50" class="liquid" opacity=".8"/><rect x="100" y="136" width="76" height="7" class="gap3d"/><text x="138" y="248" class="lbl s">보온 커버</text></g>
 <g data-s="2" class="gap3d"><line x1="80" y1="290" x2="610" y2="290" stroke="#ff5d68" stroke-width="4" stroke-dasharray="9 7"/><g class="slide"><path d="M150 230 L142 278 H200 L192 230 Z" class="gap3d"/><rect x="148" y="240" width="46" height="32" class="liquid" opacity=".82"/><rect x="133" y="278" width="76" height="11" class="gap3d"/></g><text x="350" y="315" class="lbl s">래들 이송대차</text></g>
 <g data-s="3 4" class="gap3d"><rect x="490" y="102" width="140" height="130" class="gap3d"/><circle cx="560" cy="165" r="44" fill="none" class="gap3d"/><line x1="516" y1="165" x2="604" y2="165" stroke="#ff5d68" stroke-width="7" stroke-dasharray="8 5"/><text x="560" y="90" class="lbl s">연주 래들 터릿 접점</text><path d="M440 115 H490" class="arrowFlow"/><text x="455" y="102" class="lbl s">크레인 거치</text></g>
 <g data-s="4" class="gap3d"><rect x="544" y="202" width="32" height="18" class="gap3d"/><line x1="560" y1="220" x2="560" y2="252" class="hotFlow"/><text x="604" y="250" class="lbl s">게이트/롱 노즐 준비</text></g>
 </svg>`,
};

// 장면 SVG 공용 스타일 (팝업과 공유)
const SCENE_CSS = `
/* 장면 SVG 색: .svgbox에 변수로 두고 테마(steel-2d·팝업의 theme 속성)에 따라 바꾼다. SVG 안에 속성으로 박힌 색도 아래에서 같은 변수로 덮는다(CSS가 속성보다 우선) */
.svgbox{--sc-bg1:#141416;--sc-bg2:#111113;--sc-edge:#2a2a2e;--sc-plot:#141416;--sc-grid:#2f2f34;--sc-lbl:#c8c8cd;--sc-lbl-strong:#f2f2f2;--sc-none:#8e8e95;
  --sc-sf:#34343a;--sc-sl:#8a8a92;--sc-rf:#69472d;--sc-rl:#9d6840;--sc-rail:#7a7a82;--sc-metal:#9a9aa2;--sc-pipe:#8a8a92;--sc-gas:#c0c0c6;--sc-jet:#eef0f2}
:host([theme=light]) .svgbox{--sc-bg1:#fafafa;--sc-bg2:#f1f1f3;--sc-edge:#e4e4e7;--sc-plot:#ffffff;--sc-grid:#d4d4d8;--sc-lbl:#55555c;--sc-lbl-strong:#161617;--sc-none:#5f5f66;
  --sc-sf:#e6e6e9;--sc-sl:#7c7c85;--sc-rf:#e2c09d;--sc-rl:#a8713f;--sc-rail:#8e8e96;--sc-metal:#b0b0b7;--sc-pipe:#a0a0a8;--sc-gas:#74747c;--sc-jet:#3d86c6}
.svgbox{background:linear-gradient(180deg,var(--sc-bg1),var(--sc-bg2));border-color:var(--sc-edge)}
.svgbox [fill="#313c48"]{fill:var(--sc-sf)}.svgbox [stroke="#7c8b9a"]{stroke:var(--sc-sl)}.svgbox [fill="#0b1118"]{fill:var(--sc-plot)}
.svgbox [stroke="#2b3948"],.svgbox [stroke="#263441"]{stroke:var(--sc-grid)}.svgbox [fill="#738392"]{fill:var(--sc-rail)}.svgbox [stroke="#738392"]{stroke:var(--sc-rail)}
.svgbox [fill="#93a0ad"],.svgbox [fill="#8b99a8"]{fill:var(--sc-metal)}.svgbox [stroke="#e6f5ff"],.svgbox [stroke="#eaf7ff"]{stroke:var(--sc-jet)}
.lbl{fill:var(--sc-lbl)!important;stroke:none!important;stroke-dasharray:none!important;font-size:13px;font-weight:500;text-anchor:middle;font-family:inherit;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased}.lbl.s{font-size:12px}.lbl.strong{fill:var(--sc-lbl-strong)!important;font-weight:700;font-size:14px}
.structure{fill:var(--sc-sf);stroke:var(--sc-sl);stroke-width:2}.refractory{fill:var(--sc-rf);stroke:var(--sc-rl);stroke-width:2}.liquid{fill:#ff8b2c}.slag{fill:#889b62}
.have3d{stroke:#39d98a!important;stroke-width:2.6!important}
.gap3d{stroke:#ff5d68!important;stroke-width:2.3!important;stroke-dasharray:7 5!important;fill:rgba(255,93,104,.04)!important}
.scene.found .gap3d{stroke:#39d98a!important;stroke-dasharray:none!important;fill:rgba(57,217,138,.05)!important}
.scene.found [stroke="#ff5d68"]{stroke:#39d98a!important}
.ghost{opacity:.28}.pipe{fill:none;stroke:var(--sc-pipe);stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
.gas{fill:none;stroke:var(--sc-gas);stroke-width:2;stroke-dasharray:6 7;animation:dash 1.1s linear infinite}.hotFlow{fill:none;stroke:#ff8b2c;stroke-width:5;stroke-linecap:round;stroke-dasharray:9 7;animation:dash .7s linear infinite}.waterFlow{fill:none;stroke:#56c8ff;stroke-width:3;stroke-dasharray:7 7;animation:dash 1s linear infinite}.arrowFlow{fill:none;stroke:#ffd257;stroke-width:2.3;stroke-dasharray:7 6;animation:dash 1.4s linear infinite}
.bubble{fill:#fff;opacity:.82;animation:rise 1.7s linear infinite}.flame{fill:#ffb23e;filter:drop-shadow(0 0 5px rgba(255,139,44,.8));animation:flame .5s ease-in-out infinite alternate}
.spin{animation:spin 2.6s linear infinite;transform-box:fill-box;transform-origin:center}.pulse{animation:pulse 1.2s ease-in-out infinite}.slide{animation:slide 5s ease-in-out infinite}.crane{animation:crane 8s ease-in-out infinite}.lift{animation:lift 4s ease-in-out infinite}
.scene.hl [data-s]{opacity:.34;transition:opacity .2s,filter .2s}.scene.hl [data-s].hit{opacity:1;filter:drop-shadow(0 0 7px rgba(255,200,87,.45))}.scene.hl [data-s].always{opacity:1}
@keyframes dash{to{stroke-dashoffset:-28}}@keyframes imflow{to{stroke-dashoffset:-28}}@keyframes spin{to{transform:rotate(360deg)}}@keyframes pulse{0%,100%{opacity:.45}50%{opacity:1}}@keyframes rise{0%{transform:translateY(0);opacity:0}20%{opacity:1}100%{transform:translateY(-44px);opacity:0}}@keyframes flame{from{transform:scaleY(.85)}to{transform:scaleY(1.15)}}@keyframes slide{0%,12%{transform:translateX(-45px)}50%,62%{transform:translateX(300px)}100%{transform:translateX(-45px)}}@keyframes crane{0%,12%{transform:translate(0,0)}34%{transform:translate(0,-65px)}60%{transform:translate(240px,-65px)}82%{transform:translate(240px,0)}100%{transform:translate(0,0)}}@keyframes lift{0%,100%{transform:translateY(-16px)}50%{transform:translateY(18px)}}
@media(prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
`;

const CSS = `
:host{display:block;height:100%;min-height:0;font-family:"IBM Plex Sans KR","Malgun Gothic","Apple SD Gothic Neo",system-ui,sans-serif;font-size:14px;line-height:1.5}
.root{--bg:#18181a;--surface:#1f1f22;--ink:#f2f2f2;--muted:#a8a8ad;--border:#2e2e33;--soft:#2a2a2e;--accent:#f2f2f2;--active:#38383e;--orange:#ffad61;--warm:#453226;--steel:#64676e;--darksteel:#9a9ea6;--ok:#39d98a;--miss:#ff5d68;--warn:#ffc857;
  height:100%;overflow:auto;background:var(--bg);color:var(--ink);box-sizing:border-box;outline:none;container-type:inline-size}
.root[data-theme=light]{--bg:#f4f4f5;--surface:#fff;--ink:#161617;--muted:#5f5f66;--border:#e4e4e7;--soft:#efeff1;--accent:#161617;--active:#e8e8eb;--orange:#e98532;--warm:#fff1e5;--steel:#c4c6cc;--darksteel:#7c7f88}
.root *{box-sizing:border-box}
button{font:inherit;cursor:pointer;touch-action:manipulation}
.header{padding:14px 22px;display:flex;align-items:center;justify-content:space-between;gap:12px;background:var(--surface);border-bottom:1px solid var(--border);position:sticky;top:0;z-index:5}
.brand{display:flex;gap:12px;align-items:center}.mark{display:grid;place-items:center;width:38px;height:38px;background:var(--ink);color:var(--surface);border-radius:11px;font-size:17px;font-weight:700}
.brand strong{display:block;font-size:16px}.subtitle{display:block;font-size:10px;letter-spacing:1.5px;color:var(--muted);margin-top:2px}
.workspace{display:grid;grid-template-columns:176px minmax(0,1fr);min-height:calc(100% - 67px)}
.sidebar{background:var(--surface);padding:22px 12px;border-right:1px solid var(--border)}
.navtitle{font-size:11px;color:var(--muted);padding:0 10px;margin-bottom:14px}
.nav{display:grid;gap:4px}.nav button{background:transparent;border:0;color:var(--muted);padding:10px 9px;border-radius:8px;text-align:left;display:flex;align-items:center;gap:9px;font-size:12px;width:100%}
.nav button .n{font-size:10px;opacity:.7;width:16px}.nav button .d{width:7px;height:7px;border-radius:50%;margin-left:auto;background:var(--miss);flex:none}.nav button .d.ok{background:var(--ok)}
.nav button[aria-pressed=true]{background:var(--active);color:var(--accent);font-weight:700}
.note{margin:26px 8px 0;border-top:1px solid var(--border);padding-top:16px;font-size:11px;color:var(--muted);line-height:1.8}
.main{padding:22px 22px 14px;min-width:0}
.eyebrow{color:var(--accent);font-size:10px;letter-spacing:1.5px;font-weight:700}
h2{font-size:22px;letter-spacing:-.6px;line-height:1.35;margin:6px 0 4px;font-weight:700}.lead{color:var(--muted);font-size:12px;margin:0}
.toolbar{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:18px 0 12px;flex-wrap:wrap}
.status{font-size:11px;display:flex;gap:7px;align-items:center;color:var(--muted)}.status i{width:6px;height:6px;border-radius:50%;background:var(--accent)}
.actions{display:flex;gap:7px}.actions button{border:1px solid var(--border);background:var(--surface);color:var(--ink);border-radius:7px;padding:7px 11px;font-size:11px;white-space:nowrap;min-height:34px}
.actions .play{background:var(--ink);color:var(--surface);border-color:var(--ink)}.actions .play.on{background:var(--accent);border-color:var(--accent);color:var(--surface)}
.map{background:var(--surface);border:1px solid var(--border);border-radius:13px;padding:16px 16px 12px}
.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px}
.lane{min-width:0;position:relative}.lane:not(:last-child):after{content:'→';position:absolute;top:96px;right:-12px;color:var(--muted);font-size:16px}
.lanehead{font-size:11px;color:var(--muted);display:flex;align-items:center;gap:6px;margin-bottom:10px}.lanehead span{font-size:10px;padding:2px 5px;background:var(--soft);border-radius:4px}
.machines{display:grid;gap:10px}
.machine{width:100%;background:var(--bg);border:1px solid transparent;border-radius:9px;padding:9px 9px 10px;color:var(--ink);text-align:left;transition:background .2s,border-color .2s,box-shadow .2s}
.machine:hover{border-color:var(--steel)}.machine[aria-pressed=true]{background:var(--active);border-color:var(--accent);box-shadow:0 0 0 2px color-mix(in srgb,var(--accent) 12%,transparent)}
.machine svg{width:100%;height:84px;display:block;overflow:visible}
.machine .name{display:flex;gap:5px;align-items:center;margin:5px 0 1px;font-size:12px;font-weight:700}
.machine .group{font-size:9.5px;color:var(--muted);display:block;font-family:ui-monospace,Consolas,monospace;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.machine svg .metal{fill:var(--steel);stroke:var(--darksteel);stroke-width:2}.machine svg .structure{fill:none;stroke:var(--darksteel);stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.machine svg .soft{fill:var(--soft);stroke:var(--darksteel);stroke-width:2}.machine svg .heat{fill:var(--orange)}.machine svg .warm{fill:var(--warm)}
.machine svg .flow{stroke:var(--orange);fill:none;stroke-width:3;stroke-dasharray:7 7}.root.playing .machine[aria-pressed=true] svg .motion{animation:imflow 1.1s linear infinite}
.empty{font-size:11px;color:var(--muted);padding:8px 2px}
.legend{display:flex;justify-content:center;gap:16px;flex-wrap:wrap;margin-top:12px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--muted)}.legend span{display:flex;gap:6px;align-items:center}.sw{width:14px;height:7px;border-radius:3px}.sw.have{border:2px solid var(--ok)}.sw.gap{border:2px dashed var(--miss)}.sw.flow{background:var(--orange)}
.stage{display:grid;grid-template-columns:minmax(0,1.25fr) minmax(300px,.75fr);gap:12px;align-items:start;margin-top:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:13px}
.scenecard{padding:10px;position:sticky;top:78px}.scenehead{display:flex;justify-content:space-between;gap:10px;align-items:center;padding:2px 3px 8px}.scenehead .t{font-weight:800}.scenehead .m{font-size:11px;color:var(--muted)}
.svgbox{border:1px solid;border-radius:11px;overflow:hidden;min-height:200px;display:grid;place-items:center}.svgbox svg{width:100%;height:auto;display:block}.svgbox .none{color:var(--sc-none);font-size:12px;padding:60px 20px;text-align:center}
.cap{display:flex;justify-content:space-between;gap:10px;align-items:center;margin-top:8px;font-size:11px;color:var(--muted)}.cap b{color:var(--warn)}
.side{padding:14px}.side h3{margin:0;font-size:18px;line-height:1.3}.en{font-size:11px;color:var(--muted);font-weight:500;margin-left:7px}
.badges{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 10px}.badge{border:1px solid;border-radius:999px;padding:2px 8px;font-size:10px}.badge.ok{color:var(--ok)}.badge.miss{color:var(--miss)}.badge.lane{color:var(--muted)}
.concept{margin:0 0 10px;padding:9px 10px;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 9px 9px 0;font-size:12px}
.side h4{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:13px 0 6px}
.chips{display:flex;flex-wrap:wrap;gap:5px}.chip{font-size:10px;border-radius:6px;padding:3px 7px;border:1px solid var(--border);color:var(--ink);font-family:ui-monospace,Consolas,monospace;cursor:pointer}.chip:hover,.chip.on{border-color:var(--accent);color:var(--accent)}
.steps{display:grid;gap:5px}.step{display:grid;grid-template-columns:24px 1fr auto;gap:8px;align-items:start;border:1px solid var(--border);background:var(--bg);border-radius:8px;padding:7px 8px;cursor:pointer;opacity:.62}.step.on{opacity:1;border-color:var(--warn);box-shadow:0 0 13px -6px var(--warn)}.step.done{opacity:.85}
.step .num{width:21px;height:21px;border-radius:5px;background:var(--soft);color:var(--muted);display:grid;place-items:center;font-size:10px}.step.on .num{background:var(--warn);color:#221700;font-weight:800}.step .txt{font-size:11px}.step .time{font-size:9px;color:var(--muted);white-space:nowrap}
.design{margin-top:4px;border:1px dashed var(--border);border-radius:9px;padding:9px 10px;font-size:11px;color:var(--muted)}
.footer{border-top:1px solid var(--border);margin-top:14px;padding-top:10px;display:flex;gap:12px;justify-content:space-between;font-size:10px;color:var(--muted)}
${SCENE_CSS}
/* 컨테이너(요소 자신) 너비 기준 반응형: 팀 HTML에서 화면 절반에 끼워 넣어도 맞게 줄어든다 */
@container (max-width:1100px){.stage{grid-template-columns:1fr}.scenecard{position:static}}
@container (max-width:900px){.workspace{grid-template-columns:1fr}.sidebar{display:none}.grid{grid-template-columns:repeat(2,minmax(0,1fr))!important}.lane:not(:last-child):after{display:none}}
@container (max-width:540px){.main{padding:16px 12px 12px}.grid{grid-template-columns:1fr!important}.header{padding:12px 14px}}
`;

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// GLB 헤더(JSON 청크)만 읽어 최상위 그룹 이름을 돌려준다. 루트가 하나뿐이면 그 자식들을 그룹으로 본다.
async function readGlbGroups(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = await res.arrayBuffer();
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546C67) throw new Error('not glb');
  const len = dv.getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, len)));
  const scene = json.scenes?.[json.scene ?? 0];
  let roots = (scene?.nodes || []).map(i => json.nodes[i]);
  if (roots.length === 1 && roots[0].children?.length) roots = roots[0].children.map(i => json.nodes[i]);
  return [...new Set(roots.map(n => n.name || '').filter(Boolean))];
}

class Steel2D extends HTMLElement {
  static get observedAttributes() { return ['process', 'selected', 'theme', 'glb']; }
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="root" tabindex="0">
      <header class="header"><div class="brand"><span class="mark">St</span><div><strong id="title">제강 공정</strong><span class="subtitle">2D PROCESS EXPLORER · GLB 기준</span></div></div></header>
      <div class="workspace">
        <aside class="sidebar"><div class="navtitle">공정 단계</div><nav class="nav" id="nav"></nav><div class="note" id="note"></div></aside>
        <main class="main">
          <div><div class="eyebrow" id="eyebrow">STEELMAKING / OVERVIEW</div><h2>용선에서 용강으로, 한눈에.</h2><p class="lead">설비 카드는 3D 모델(GLB)의 그룹 이름을 읽어 자동으로 만들어집니다. 카드나 단계를 눌러 2D 장면을 확인하세요.</p></div>
          <div class="toolbar"><div class="status"><i></i><span id="status"></span></div><div class="actions"><button class="prev">← 이전</button><button class="next">다음 →</button><button class="play">▶ 자동</button></div></div>
          <section class="map"><div class="grid" id="grid"></div><div class="legend"><span><i class="sw have"></i>GLB에 있는 설비</span><span><i class="sw gap"></i>아직 GLB에 없는 설비</span><span><i class="sw flow"></i>용강 · 가스 흐름</span></div></section>
          <section class="stage"><div class="card scenecard"><div class="scenehead"><div><div class="t" id="stitle"></div><div class="m" id="smeta"></div></div></div><div class="svgbox" id="svgbox"></div><div class="cap"><span id="cap"></span><span>← → / Space</span></div></div><aside class="card side" id="side"></aside></section>
          <footer class="footer"><span id="foot"></span><span id="counter"></span></footer>
        </main>
      </div></div>`;
    this.$ = id => this.shadowRoot.getElementById(id);
    this.stages = []; this.groups = null; this.stage = null; this.step = 0; this.timer = null; this.group = null;
    const root = this.shadowRoot.querySelector('.root');
    root.querySelector('.prev').onclick = () => this.advance(-1);
    root.querySelector('.next').onclick = () => this.advance(1);
    root.querySelector('.play').onclick = () => this.timer ? this.stopAuto() : this.startAuto();
    root.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); this.advance(1); }
      else if (e.key === 'ArrowLeft') this.advance(-1);
      else if (e.key === 'ArrowDown') this.selectIndex(this.index() + 1);
      else if (e.key === 'ArrowUp') this.selectIndex(this.index() - 1);
    });
  }
  connectedCallback() { this._applyTheme(); this.load(); }
  disconnectedCallback() { this.stopAuto(); }
  attributeChangedCallback(n, a, b) {
    if (a === b) return;
    if (n === 'theme') this._applyTheme();
    else if (n === 'process' || n === 'glb') { if (this.isConnected) this.load(); }
    else if (n === 'selected') {
      if (!b || this.stage?.eq === b) return;
      const s = this.stages.find(x => x.eq === b);
      if (s) this.select(s, { emit: false });
    }
  }
  _applyTheme() { this.shadowRoot.querySelector('.root').dataset.theme = this.getAttribute('theme') || 'dark'; }
  get processId() { return this.getAttribute('process') || 'steelmaking'; }
  index() { return this.stages.indexOf(this.stage); }

  async load() {
    const pid = this.processId, token = (this._token = Symbol());
    this.stopAuto();
    this.stages = (STAGES[pid] || []).map(s => ({ ...s, groups: [] }));
    const url = this.getAttribute('glb') || `models/${pid}.glb`;
    let names = null;
    try { names = await readGlbGroups(new URL(url, document.baseURI).href); } catch (e) { names = null; }
    if (this._token !== token) return;
    this.groups = names ? names.filter(n => !IGNORE.test(n)).map(name => {
      const stage = this.stages.find(s => s.match.test(name)) || null;
      if (stage) stage.groups.push(name);
      return { name, stage };
    }) : null;
    this.$('eyebrow').textContent = `${pid.replace(/_/g, ' ').toUpperCase()} / OVERVIEW`;
    this.$('note').innerHTML = names ? `GLB 그룹 ${this.groups.length}개를 읽어 구성했습니다.<br>GLB를 바꾸면 카드가 따라갑니다.` : `GLB를 읽지 못해 기본 단계만 표시합니다.`;
    this.renderNav(); this.renderGrid();
    const sel = this.getAttribute('selected');
    const first = this.stages.find(s => s.eq === sel) || this.stages.find(s => s.groups.length) || this.stages[0] || null;
    if (first) this.select(first, { emit: false });
    else { this.$('svgbox').innerHTML = `<div class="none">이 공정(${esc(pid)})의 2D 장면은 아직 없습니다. GLB 그룹 카드만 표시합니다.</div>`; this.$('side').innerHTML = ''; this.$('status').textContent = '2D 장면 없음'; this.$('counter').textContent = ''; this.$('foot').textContent = ''; }
  }

  renderNav() {
    this.$('nav').innerHTML = this.stages.map((s, i) => `<button data-i="${i}" aria-pressed="false"><span class="n">${String(i + 1).padStart(2, '0')}</span>${esc(s.name)}<span class="d ${s.groups.length ? 'ok' : ''}" title="${s.groups.length ? 'GLB에 있음' : 'GLB에 없음'}"></span></button>`).join('');
    this.$('nav').querySelectorAll('button').forEach(b => b.onclick = () => this.selectIndex(+b.dataset.i));
  }
  renderGrid() {
    const lanes = LANES.map(([n, t]) => ({ n, t, items: [] }));
    const other = { n: '··', t: '기타 그룹', items: [] };
    if (this.groups) {
      const order = g => g.stage ? this.stages.indexOf(g.stage) : 99;
      [...this.groups].sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name)).forEach(g => (g.stage ? lanes[g.stage.lane] : other).items.push({ label: g.stage ? g.stage.name : g.name, group: g.name, stage: g.stage, icon: g.stage ? g.stage.id : 'other' }));
    } else {
      this.stages.forEach(s => lanes[s.lane].items.push({ label: s.name, group: '(GLB 없음)', stage: s, icon: s.id }));
    }
    const all = other.items.length ? [...lanes, other] : lanes;
    this.$('grid').style.gridTemplateColumns = `repeat(${all.length},minmax(0,1fr))`;
    this.$('grid').innerHTML = all.map(l => `<section class="lane"><div class="lanehead"><span>${l.n}</span>${l.t}</div><div class="machines">${l.items.length ? l.items.map(it => `<button class="machine" data-group="${esc(it.group)}" data-stage="${it.stage ? it.stage.id : ''}" aria-pressed="false"><svg viewBox="0 0 184 102" aria-hidden="true">${ICONS[it.icon] || ICONS.other}</svg><span class="name">${esc(it.label)}</span><span class="group" title="${esc(it.group)}">${esc(it.group)}</span></button>`).join('') : '<div class="empty">GLB에 해당 설비 없음</div>'}</div></section>`).join('');
    this.$('grid').querySelectorAll('.machine').forEach(b => b.onclick = () => {
      const s = this.stages.find(x => x.id === b.dataset.stage);
      if (s) this.select(s, { group: b.dataset.group });
      else { this._press(null, b.dataset.group); this.$('status').textContent = `${b.dataset.group} · 2D 단계 미연결 그룹`; this.emit(null, null, b.dataset.group); }
    });
  }
  _press(stage, group) {
    this.$('nav').querySelectorAll('button').forEach((b, i) => b.setAttribute('aria-pressed', String(this.stages[i] === stage)));
    this.$('grid').querySelectorAll('.machine').forEach(b => b.setAttribute('aria-pressed', String(group ? b.dataset.group === group : !!(stage && b.dataset.stage === stage.id))));
  }
  selectIndex(i) { if (i >= 0 && i < this.stages.length) this.select(this.stages[i]); }
  select(stage, { emit = true, group = null } = {}) {
    const auto = !!this.timer;
    this.stopAuto();
    this.stage = stage; this.step = 0; this.group = group || stage.groups[0] || null;
    this._press(stage, group);
    this.renderScene(); this.renderSide();
    this.$('status').textContent = `${stage.name}${this.group ? ` · ${this.group}` : ''} 선택됨`;
    this.$('counter').textContent = `${String(this.index() + 1).padStart(2, '0')} / ${String(this.stages.length).padStart(2, '0')}`;
    this.$('foot').textContent = stage.groups.length ? `GLB 그룹 ${stage.groups.length}개가 이 단계에 연결됨` : '이 단계의 설비는 아직 GLB에 없습니다';
    if (auto) this.startAuto();
    if (emit) this.emit(stage.eq, stage.id, this.group);
  }
  emit(id, stage, group) { this.dispatchEvent(new CustomEvent('steel-select', { detail: { id, stage, group }, bubbles: true, composed: true })); }
  renderScene() {
    const s = this.stage, box = this.$('svgbox');
    box.innerHTML = SCENES[s.id] || `<div class="none">${esc(s.name)} 장면 준비 중</div>`;
    const svg = box.querySelector('svg'); if (svg) { svg.classList.add('hl'); svg.classList.toggle('found', s.groups.length > 0); }
    this.$('stitle').textContent = s.name;
    this.highlight();
  }
  highlight() {
    const s = this.stage, svg = this.$('svgbox').querySelector('svg');
    if (svg) svg.querySelectorAll('[data-s]').forEach(g => g.classList.toggle('hit', g.dataset.s.split(' ').includes(String(this.step + 1))));
    this.$('smeta').textContent = `${s.en} · 단계 ${this.step + 1}/${s.steps.length}`;
    this.$('cap').innerHTML = `<b>${esc(s.name)}</b> · ${esc(s.steps[this.step][0])}`;
    this.shadowRoot.querySelectorAll('.step').forEach((el, i) => { el.classList.toggle('on', i === this.step); el.classList.toggle('done', i < this.step); });
  }
  renderSide() {
    const s = this.stage, lane = LANES[s.lane];
    this.$('side').innerHTML = `
      <h3>${esc(s.name)}<span class="en">${esc(s.en)}</span></h3>
      <div class="badges"><span class="badge lane">${lane[0]} ${lane[1]}</span><span class="badge ${s.groups.length ? 'ok' : 'miss'}">${s.groups.length ? `GLB에 있음 · ${s.groups.length}그룹` : 'GLB에 없음'}</span><span class="badge lane">3D 설비: ${esc(s.eq)}</span></div>
      <p class="concept">${esc(s.concept)}</p>
      <h4>GLB 그룹</h4><div class="chips">${s.groups.length ? s.groups.map(g => `<span class="chip ${g === this.group ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</span>`).join('') : '<span class="chip">없음</span>'}</div>
      <h4>공정 단계</h4><div class="steps">${s.steps.map((x, i) => `<div class="step ${i === this.step ? 'on' : ''}" data-i="${i}"><span class="num">${i + 1}</span><span class="txt">${esc(x[0])}</span><span class="time">${esc(x[1] || '')}</span></div>`).join('')}</div>
      <h4>2D 포인트</h4><div class="design">${esc(s.design)}</div>`;
    this.$('side').querySelectorAll('.step').forEach(el => el.onclick = () => { this.step = +el.dataset.i; this.highlight(); });
    this.$('side').querySelectorAll('.chip[data-g]').forEach(el => el.onclick = () => this.select(s, { group: el.dataset.g }));
  }
  advance(n) {
    if (!this.stage) return;
    const max = this.stage.steps.length, i = this.index();
    if (n > 0 && this.step === max - 1) { if (i < this.stages.length - 1) this.select(this.stages[i + 1]); else this.stopAuto(); return; }
    if (n < 0 && this.step === 0) { if (i > 0) { this.select(this.stages[i - 1]); this.step = this.stage.steps.length - 1; this.highlight(); } return; }
    this.step = Math.max(0, Math.min(max - 1, this.step + n)); this.highlight();
  }
  startAuto() {
    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => this.advance(1), 3200);
    const root = this.shadowRoot.querySelector('.root'); root.classList.add('playing');
    const b = root.querySelector('.play'); b.textContent = '⏸ 자동'; b.classList.add('on');
  }
  stopAuto() {
    if (this.timer) clearInterval(this.timer); this.timer = null;
    const root = this.shadowRoot.querySelector('.root'); root.classList.remove('playing');
    const b = root.querySelector('.play'); if (b) { b.textContent = '▶ 자동'; b.classList.remove('on'); }
  }
}
if (!customElements.get('steel-2d')) customElements.define('steel-2d', Steel2D);
export { Steel2D, readGlbGroups, STAGES, SCENES, SCENE_CSS, LANES };

// Steel Academy v2 (공정 6단계 테스트) — 샘플 교육 데이터 (실제 회사 공식 자료가 아님)
// 3D: 설비 id는 GLB 노드 이름 EQ_<id> 와 1:1 대응. shape는 GLB 교체 전 임시 기본 도형.
export const PROCESSES = [
  {
    id: 'ironmaking', num: '01', name: '제선', en: 'Ironmaking', sub: '철광석에서 쇳물로',
    io: '철광석·석탄·석회석 → 용선',
    summary: '철광석에서 산소를 떼어내(환원) 액체 철인 용선을 만드는 첫 단계. 고로가 중심 설비.',
    materialIn: { shape: 'chunks', color: '#8a8f98', label: '가루 철광석: 아직 돌가루 상태' },
    equipment: [
      { id: 'sinter_plant', name: '소결기', shape: 'box', interiorLayout: 'bed', role: '가루 철광석을 구워 덩어리(소결광)로 만듭니다.',
        input: '가루 철광석, 석회석', output: '소결광(덩어리)', notes: ['가루 그대로는 고로 안에서 바람이 통하지 않아요.', '덩어리로 만들어야 고로에 넣을 수 있습니다.'],
        facts: [{ v: '원료 2.5t → 1t', k: '소결광 1톤에 드는 원료(수분·연료 포함)', src: 'US EPA AP-42 12.5' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'chunks', color: '#6e747d', label: '소결광: 구워서 덩어리가 됨' },
        steps: [
          { zone: '배합·장입', temp: '상온', text: '가루 철광석에 석회석·분코크스·물을 섞어 소결기(팰릿) 위에 약 50cm 두께로 고르게 깝니다.' },
          { zone: '점화로', temp: '약 1,100℃', text: '표면의 분코크스에 불을 붙입니다. 아래에서 바람을 빨아들여 불이 위→아래로 천천히 내려갑니다.' },
          { zone: '연소대(소결대)', temp: '약 1,300~1,400℃', text: '가루가 부분적으로 녹아 서로 붙습니다. 이 온도 대역이 두꺼울수록 단단한 소결광이 됩니다.' },
          { zone: '건조·예열대', temp: '300~800℃', text: '연소대 아래에서는 수분이 마르고 석회석이 분해되며 다음 연소를 준비합니다.' },
          { zone: '냉각·파쇄', temp: '150℃ 이하', text: '구워진 케이크를 부순 뒤 식혀 5~50mm 크기로 고릅니다. 너무 작은 것은 다시 배합으로 돌려보냅니다.' },
        ],
        interior: [
          { label: '배합 원료층 (가루 철광석+석회석+분코크스)', temp: '상온', color: '#5a5f68', h: 0.18, formula: '' },
          { label: '점화 · 표면 착화', temp: '약 1,100℃', color: '#d8551a', h: 0.16, formula: 'C + O₂ → CO₂ + 열' },
          { label: '연소대 · 부분 용융으로 덩어리화', temp: '1,200~1,350℃', color: '#ffb03a', h: 0.24, formula: 'CaO + Fe₂O₃ → 칼슘페라이트' },
          { label: '건조·예열대', temp: '300~800℃', color: '#9a5a3a', h: 0.2, formula: 'CaCO₃ → CaO + CO₂' },
          { label: '소결광 · 냉각 후 5~50mm', temp: '150℃ 이하', color: '#7d838c', h: 0.22, formula: '' },
        ] },
      { id: 'coke_oven', name: '코크스 오븐', shape: 'battery', interiorLayout: 'chambers', role: '석탄을 공기 없이 구워 코크스로 만듭니다.',
        input: '석탄', output: '코크스', notes: ['코크스는 고로의 열원이자 환원제(산소를 떼어내는 재료)입니다.', '약 1,000℃에서 굽습니다.'],
        facts: [{ v: '약 18MW', k: '건식 소화(CDQ) 1기 발전량(100t/h급)', src: '일본제철엔지니어링 SEAISI 발표' }, { v: '10~25시간', k: '석탄을 코크스로 굽는 시간', src: '특허 US3959082' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'chunks', color: '#3a3d42', label: '소결광 + 코크스: 고로에 넣을 준비' },
        steps: [
          { zone: '석탄 장입', temp: '상온', text: '배합한 석탄을 좁고 긴 탄화실(폭 약 45cm, 높이 6~7.6m) 위에서 넣고 뚜껑을 닫습니다. 공기는 들어가지 않습니다.' },
          { zone: '건류 시작 · 가스 방출', temp: '300~700℃', text: '양쪽 벽에서 열이 들어옵니다. 석탄이 물러지며 타르·가스(코크스오븐가스)가 빠져나갑니다. 이 가스는 연료로 재사용합니다.' },
          { zone: '코크스화', temp: '약 1,000℃', text: '휘발 성분이 모두 빠지고 단단한 다공질 탄소 덩어리(코크스)만 남습니다. 약 18~24시간이 걸립니다.' },
          { zone: '가열 벽 (연소실)', temp: '1,200~1,300℃', text: '탄화실 사이의 연소실에서 가스를 태워 벽을 가열합니다. 석탄은 직접 타지 않고 벽 너머 열로만 구워집니다.' },
          { zone: '압출·소화', temp: '→ 약 200℃', text: '다 구워진 붉은 코크스를 밀어내 물로 급히 식힙니다(소화). 이후 크기별로 골라 고로로 보냅니다.' },
        ],
        interior: [
          { label: '석탄 장입 (공기 차단)', temp: '상온', color: '#3a3d42', h: 0.16, formula: '' },
          { label: '건류 · 타르·가스 방출', temp: '300~700℃', color: '#8f4a2a', h: 0.22, formula: '석탄 → COG + 타르' },
          { label: '코크스화 · 다공질 탄소', temp: '약 1,000℃', color: '#ff7a1a', h: 0.26, formula: '18~24 시간' },
          { label: '연소실 벽 (간접 가열)', temp: '1,200~1,300℃', color: '#ffc23a', h: 0.18, formula: 'COG + O₂ → 열', wall: true },
          { label: '압출 → 물 소화', temp: '약 200℃', color: '#6b7078', h: 0.18, formula: '' },
        ] },
      { id: 'blast_furnace', name: '고로·장입 장치', shape: 'tower', role: '벨리스(Bell-less) 장입 장치로 원료를 위에서 넣고, 아래에서 열풍을 불어 철광석을 환원·용융합니다.',
        input: '소결광, 코크스, 열풍', output: '용선 약 1,500℃, 슬래그', notes: ['높이 약 110m의 거대한 용광로입니다.', '한 번 불을 붙이면 15~20년 동안 멈추지 않습니다.', '탄소 약 4%의 용선이 나옵니다.'],
        facts: [{ v: '약 110m', k: '고로 높이', src: '포스코 뉴스룸(한국철강협회)' }, { v: '6,000m³', k: '광양 1고로 내용적', src: '포스코 뉴스룸 2017' }, { v: '약 1만 4천 톤', k: '포항 3고로 하루 쇳물', src: '포스코 뉴스룸(기사마다 1.4만~1.5만 톤)' }, { v: '약 6시간 30분', k: '원료가 쇳물이 되기까지', src: '포스코 뉴스룸 ‘용광로 해부학①’' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'chunks', color: '#8f3a12', label: '고로 안: 원료가 환원되며 내려감' },
        steps: [
          { zone: '노정 · 장입', temp: '약 150~200℃', text: '코크스·철광석·석회석을 층층이 번갈아 넣습니다. 위로 빠져나가는 뜨거운 가스(고로가스)가 원료를 미리 데워 줍니다.' },
          { zone: '샤프트 · 간접환원', temp: '400~1,000℃', text: '코크스가 타며 생긴 일산화탄소(CO)가 철광석의 산소를 떼어냅니다. Fe₂O₃ + 3CO → 2Fe + 3CO₂. 아직 고체 상태입니다.' },
          { zone: '샤프트 하부 · 석회석 분해', temp: '약 950℃', text: '석회석이 CaCO₃ → CaO + CO₂로 분해됩니다. 생긴 CaO는 광석의 흙 성분(SiO₂)과 만나 슬래그가 됩니다.' },
          { zone: '노복·보시 · 용융', temp: '1,200~1,500℃', text: '철이 녹기 시작합니다. 코크스는 이 구간까지 고체로 남아 원료 층을 받쳐 주고 가스가 통하는 길을 만듭니다.' },
          { zone: '풍구 · 열풍 주입', temp: '약 2,000℃(화염)', text: '열풍로에서 온 1,200℃ 열풍이 풍구를 통해 들어와 코크스를 태웁니다. C + O₂ → CO₂, CO₂ + C → 2CO. 고로에서 가장 뜨거운 곳입니다.' },
          { zone: '노상 · 출선', temp: '용선 약 1,500℃', text: '무거운 용선(탄소 약 4%)은 아래에, 가벼운 슬래그는 그 위에 층을 이룹니다. 출선구를 열어 용선을 토피도카에 담고, 슬래그는 따로 뽑아냅니다.' },
        ] ,
        interior: [
          { label: '장입물 (코크스·철광석·석회석)', temp: '200~400℃', color: '#4a4f57', h: 0.14, formula: '' },
          { label: '예열 · 간접환원 시작', temp: '600~750℃', color: '#8f3a12', h: 0.18, formula: 'Fe₂O₃ + 3CO → 2Fe + 3CO₂' },
          { label: '환원 (고체 상태의 철)', temp: '약 1,000℃', color: '#d8551a', h: 0.18, formula: 'FeO + CO → Fe + CO₂' },
          { label: '용융 · 철이 녹음', temp: '약 1,500℃', color: '#ff7a1a', h: 0.16, formula: 'C + CO₂ → 2CO' },
          { label: '연소대 · 풍구 열풍', temp: '약 2,000℃', color: '#ffc23a', h: 0.12, formula: 'C + O₂ → CO₂' },
          { label: '슬래그 (가벼워서 위에 뜸)', temp: '', color: '#7a7f88', h: 0.09, formula: 'CaO + SiO₂' },
          { label: '용선 (탄소 약 4%)', temp: '약 1,500℃', color: '#ffd08a', h: 0.13, formula: '' },
        ] },
      { id: 'hot_stove', name: '열풍로·풍구', shape: 'cyl', interiorLayout: 'stove', role: '약 1,200℃ 열풍을 만들어 고로 아래쪽 풍구로 불어 넣습니다.',
        input: '공기, 고로 가스', output: '열풍 약 1,200℃', notes: ['열풍이 뜨거울수록 코크스를 덜 씁니다.', '여러 대가 번갈아 가열·송풍합니다.'],
        facts: [{ v: '40개 이상', k: '고로 한 기의 풍구 수', src: '포스코 뉴스룸 ‘용광로 해부학①’' }, { v: '약 1,200℃·4bar', k: '열풍 온도·압력', src: '포스코 뉴스룸(한국철강협회)' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ff7a1a', label: '용선 약 1,500℃: 노상에 고인 쇳물' },
        steps: [
          { zone: '돔 · 연소실', temp: '약 1,400℃', text: '고로가스(BFG)를 태워 뜨거운 연소가스를 만듭니다. 돔은 열풍로에서 가장 뜨거운 곳입니다.' },
          { zone: '체커 상부 · 축열', temp: '1,200~1,300℃', text: '벌집 모양 내화벽돌(체커)이 연소가스의 열을 흡수해 저장합니다. 이 과정을 "축열(on gas)"이라 합니다.' },
          { zone: '체커 중부', temp: '약 800℃', text: '아래로 내려갈수록 온도가 낮아지는 층이 생깁니다. 벽돌 무게만 수천 톤입니다.' },
          { zone: '체커 하부 · 배가스', temp: '약 300℃', text: '열을 빼앗긴 가스는 굴뚝으로 나갑니다. 축열이 끝나면 밸브를 바꿔 반대로 찬 공기를 아래에서 넣습니다.' },
          { zone: '송풍 · 열풍 출구', temp: '약 1,200℃', text: '찬 공기가 뜨거운 체커를 거꾸로 지나며 데워져 1,200℃ 열풍이 되어 고로 풍구로 갑니다. 3~4기가 번갈아 축열·송풍합니다.' },
        ],
        interior: [
          { label: '돔 · 연소실', temp: '약 1,400℃', color: '#ffc23a', h: 0.16, formula: 'BFG + O₂ → 열' },
          { label: '체커 벽돌 상부 · 축열', temp: '1,200~1,300℃', color: '#ff7a1a', h: 0.24, formula: '' },
          { label: '체커 중부', temp: '약 800℃', color: '#c8552a', h: 0.22, formula: '' },
          { label: '체커 하부 · 배가스 출구', temp: '약 300℃', color: '#7a5a48', h: 0.2, formula: '' },
          { label: '열풍 출구 → 고로 풍구', temp: '약 1,200℃', color: '#ffa04a', h: 0.18, formula: '송풍(on blast)' },
        ] },
      { id: 'taphole_casthouse', name: '출선구·주상', shape: 'box', role: '고로 바닥의 출선구를 열어 쇳물과 슬래그를 빼냅니다.',
        input: '노상의 용선·슬래그', output: '용선 / 슬래그 분리', notes: ['주상(캐스트하우스) 바닥의 홈통(탕도)을 따라 쇳물이 흐릅니다.', '가벼운 슬래그는 스키머로 걸러 따로 보냅니다.'],
        materialOut: { shape: 'liquid', color: '#ff8a2a', label: '출선: 쇳물이 탕도를 따라 흐름' } },
      { id: 'torpedo_car', name: '토페도카', shape: 'ladle', role: '어뢰 모양 화차에 쇳물을 담아 제강 공장으로 옮깁니다.',
        input: '용선 약 1,500℃', output: '제강으로 이송된 용선', notes: ['내화벽돌로 감싸 이동 중에도 쇳물 온도를 유지합니다.', '한 대에 약 300톤을 싣습니다.'],
        facts: [{ v: '약 300톤', k: '한 대에 싣는 쇳물(차량 자체도 약 300톤)', src: '포스코 뉴스룸 2019' }, { v: '77대 · 106대', k: '포항 · 광양 토페도카 수', src: '포스코 뉴스룸 2019' }, { v: '1℃ = 약 11억 원', k: '쇳물 온도를 1℃ 지켰을 때 효과', src: '포스코 뉴스룸 2019' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ff7a1a', label: '토페도카: 용선을 제강으로 운반' } },
    ],
  },
  {
    id: 'steelmaking', num: '02', name: '제강', en: 'Steelmaking', sub: '불순물 제거와 성분 조정',
    io: '용선·고철·산소 → 용강',
    summary: '용선의 탄소와 불순물을 산소로 태워 없애고 성분을 맞추어 용강(강철 쇳물)을 만듭니다.',
    materialIn: { shape: 'liquid', color: '#ff7a1a', label: '용선: 탄소 약 4%, 불순물 포함' },
    equipment: [
      { id: 'hot_metal_pretreatment', name: '용선 예비처리', shape: 'ladle', role: '전로에 넣기 전 황(S) 등을 먼저 줄입니다. 공장·제품에 따라 생략되기도 합니다.',
        input: '용선', output: '황·인이 줄어든 용선', notes: ['황·인은 강을 잘 깨지게 만드는 대표 불순물입니다.', '먼저 빼두면 전로 작업이 쉬워집니다.'],
        facts: [{ v: '0.03% → 0.001%', k: '처리 전후 황 함량(탈황률 약 97%)', src: '일본제철엔지니어링 기술지 Vol.11' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ff8a2a', label: '예비처리 용선: 황·인 제거' },
        steps: [
          { zone: '용선 래들 도착', temp: '약 1,350℃', text: '고로에서 토페도카로 운반된 용선을 래들에 받습니다. 아직 황(S)·인(P)·규소(Si)가 많이 들어 있습니다.' },
          { zone: '탈규 (Si 제거)', temp: '약 1,350℃', text: '산화철·산소를 넣어 규소를 먼저 산화시킵니다. 규소가 남아 있으면 다음 탈인 효율이 떨어집니다.' },
          { zone: '탈인·탈황 (P·S 제거)', temp: '약 1,320℃', text: '랜스를 용선 깊이 꽂아 석회·소다회 같은 분말을 불어 넣습니다. 황·인이 슬래그로 옮겨가며 위로 뜹니다.' },
          { zone: '배재 (슬래그 걷어내기)', temp: '', text: '위에 뜬 슬래그를 걷어냅니다. 이 슬래그를 전로로 가져가면 불순물이 되돌아오므로 꼭 제거합니다.' },
        ],
        interior: [
          { label: '용선 (Si·P·S 포함)', temp: '약 1,350℃', color: '#ff7a1a', h: 0.3, formula: '' },
          { label: '탈규 · 규소 산화', temp: '약 1,350℃', color: '#ffa04a', h: 0.22, formula: 'Si + O₂ → SiO₂' },
          { label: '탈인·탈황 · 분말 취입', temp: '약 1,300℃', color: '#ffc23a', h: 0.26, formula: '2P + 5FeO + 3CaO → 3CaO·P₂O₅ + 5Fe' },
          { label: '슬래그 배재', temp: '', color: '#7a7f88', h: 0.22, formula: 'CaO + S → CaS' },
        ] },
      { id: 'bof_converter', name: '전로 (BOF·LD)', shape: 'converter', role: '산소를 불어 탄소를 약 4%에서 0.1% 이하로 낮춥니다.',
        input: '용선, 고철, 산소', output: '용강 약 1,650℃', notes: ['산소가 탄소와 만나 타면서 온도가 스스로 올라갑니다.', '약 20분 만에 300톤을 처리합니다.'],
        facts: [{ v: '300톤급', k: '포항 전로 1회 처리량', src: '한국일보 2008' }, { v: '40~60분', k: '장입부터 출강까지 한 번', src: 'NPTEL 강의, ispatguru' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ffa63a', label: '용강 약 1,650℃: 탄소 0.1% 이하, 밝은 주황' },
        steps: [
          { zone: '장입 (고철 → 용선)', temp: '약 1,300℃', text: '전로를 기울여 고철을 먼저 넣고, 그 위에 용선을 붓습니다. 고철은 냉각재 겸 원료 역할을 합니다.' },
          { zone: '취련 · 산소 랜스', temp: '→ 약 1,650℃', text: '위에서 랜스를 내려 순산소를 초음속으로 불어 넣습니다. 탄소가 타면서 온도가 스스로 올라갑니다. 약 15~20분.' },
          { zone: '슬래그 형성', temp: '약 1,600℃', text: '석회(CaO)를 넣어 슬래그를 만듭니다. 인·규소·망간 산화물이 슬래그로 들어가 위에 뜹니다.' },
          { zone: '배가스 (CO) 회수', temp: '약 1,600~1,700℃', text: '탄소가 타며 나오는 CO 가스는 후드로 모아 연료로 재사용합니다.' },
          { zone: '출강 · 합금 투입', temp: '약 1,650℃', text: '전로를 기울여 옆 구멍(출강구)으로 용강만 래들에 받습니다. 이때 합금철을 넣어 성분을 맞춥니다.' },
        ],
        interior: [
          // 층 번호 = 단계 번호(장입 → 취련 → 슬래그 → 배가스 → 출강). 자리·모양은 anchors-v2b.json interiors.bof_converter.parts
          { label: '용선 + 고철 → 용강 (탄소 4% → 0.1%)', temp: '약 1,300 → 1,650℃', color: '#ffc23a', h: 0.32, formula: '고철 = 냉각재 겸 원료' },
          { label: '산소 랜스 · 초음속 취입', temp: '약 1,650℃', color: '#8fd3ff', h: 0.18, formula: 'C + ½O₂ → CO' },
          { label: '슬래그 (CaO·SiO₂·P₂O₅)', temp: '약 1,600℃', color: '#7a7f88', h: 0.16, formula: '2P + 5O → P₂O₅' },
          { label: '배가스 후드 · CO 회수', temp: '약 1,600℃', color: '#8a8f98', h: 0.16, formula: 'CO → 연료 재사용' },
          { label: '출강구 → 래들 (합금 투입)', temp: '약 1,650℃', color: '#ffa63a', h: 0.18, formula: 'Fe-Mn, Fe-Si, Al' },
        ] },
      { id: 'oxygen_lance_offgas', name: '산소 랜스·배가스 설비', shape: 'gate', role: '랜스로 전로에 산소를 불어 넣고, 생긴 배가스를 후드로 모아 정화합니다.',
        input: '순산소 / 배가스(CO)', output: '정화된 가스(연료로 재사용)', notes: ['랜스 끝은 수냉식이라 쇳물 바로 위에서도 견딥니다.', '집진·냉각 후 CO 가스는 연료로 씁니다.'],
        facts: [{ v: '분당 약 1,000Nm³', k: '산소 유량(250~300톤 전로)', src: 'ispatguru' }, { v: '마하 2', k: '산소 분사 속도', src: 'ispatguru' }, { v: '1톤당 50~100Nm³', k: '회수하는 CO 가스(LDG)', src: 'ispatguru, Clarke Energy' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ffa63a', label: '취련 중 용강: 탄소가 타며 온도 상승' },
        steps: [
          { zone: '랜스 하강', temp: '상온 → 쇳물 위', text: '수냉식 산소 랜스를 전로 입구로 내려 쇳물 표면 약 2m 위에 맞춥니다.' },
          { zone: '순산소 분사', temp: '약 1,650℃', text: '초음속 산소가 쇳물을 때리며 탄소를 태웁니다. 이때 일산화탄소(CO)가 대량으로 생깁니다.' },
          { zone: '후드 · 배가스 회수', temp: '약 1,650℃ → 900℃', text: '전로 위 후드가 뜨거운 배가스를 빨아들이며 약 900℃까지 식힙니다. 공기를 적게 섞어 CO를 그대로 모읍니다.' },
          { zone: '냉각 · 집진', temp: '약 70℃', text: '물을 뿌려 가스를 식히고 먼지를 걸러냅니다. 깨끗해진 CO 가스는 공장 연료로 다시 씁니다.' },
        ],
        interior: [
          // 층 번호 = 단계 번호(랜스 하강 → 산소 분사 → 후드 회수 → 냉각·집진). 자리·모양은 anchors-v2b.json interiors.oxygen_lance_offgas.parts
          { label: '산소 랜스 (수냉 구리 노즐)', temp: '상온', color: '#8fd3ff', h: 0.2, formula: 'O₂' },
          { label: '산소 제트 · CO 발생', temp: '약 1,650℃', color: '#ff9a3a', h: 0.26, formula: '2C + O₂ → 2CO' },
          { label: '후드 · 배가스 회수', temp: '약 1,650 → 900℃', color: '#d8551a', h: 0.26, formula: 'CO를 그대로 모음' },
          { label: '냉각 · 집진 → 연료', temp: '약 70℃', color: '#5a7fa0', h: 0.28, formula: 'LDG 재사용' },
        ] },
      { id: 'tapping_ladle_crane', name: '출강 래들·크레인', shape: 'ladle', role: '정련된 용강을 래들에 받아 크레인으로 옮깁니다. 이때 합금을 넣어 성분을 조절합니다.',
        input: '용강', output: '래들에 담긴 용강', notes: ['전로를 기울여 출강구로 용강만 따릅니다.', '합금철(Fe-Mn, Fe-Si, Al)을 함께 넣습니다.'],
        facts: [{ v: '450톤급', k: '래들 크레인(용강 300톤 래들, 계산)', src: 'China Steel 기술보고 No.35 + 계산, Konecranes' }, { v: '약 115톤', k: '빈 래들 무게(용강 250톤 래들)', src: 'China Steel 기술보고 No.35' }, { v: '130~140회', k: '래들 내화물을 고치기 전까지 사용', src: 'China Steel 기술보고 No.35' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ffb04a', label: '출강: 용강을 래들에 받음' },
        steps: [
          { zone: '전로 경동', temp: '약 1,650℃', text: '전로를 옆으로 기울여 출강구로 용강만 따릅니다. 위에 뜬 슬래그는 최대한 남깁니다.' },
          { zone: '합금 투입', temp: '약 1,640℃', text: '래들에 떨어지는 용강에 망간·규소·알루미늄 합금을 넣어 산소를 빼고 성분을 맞춥니다.' },
          { zone: '슬래그 차단', temp: '약 1,630℃', text: '출강 끝 무렵 다트(마개)로 슬래그가 래들에 섞이지 않게 막습니다.' },
          { zone: '크레인 이송', temp: '약 1,600℃', text: '용강 약 300톤이 든 래들(래들까지 합쳐 약 440톤)을 450톤급 천장 크레인이 들어 2차 정련 설비로 옮깁니다.' },
        ],
        interior: [
          { label: '래들 슬래그층 (얇게)', temp: '', color: '#7a7f88', h: 0.14, formula: '' },
          { label: '용강 · 합금 용해', temp: '약 1,640℃', color: '#ffb04a', h: 0.5, formula: 'Fe-Mn, Fe-Si, Al' },
          { label: '탈산 반응', temp: '약 1,630℃', color: '#ffd08a', h: 0.18, formula: '2Al + 3O → Al₂O₃' },
          { label: '래들 내화벽돌', temp: '', color: '#5a5f68', h: 0.18, formula: '' },
        ] },
      { id: 'secondary_refining', name: '2차 정련 (LF·RH)', shape: 'twin', role: 'LF는 온도·성분을 맞추고, RH 진공 탈가스는 필요할 때 용강 속 가스를 줄입니다.',
        input: '용강', output: '성분이 맞춰진 용강', notes: ['RH: 진공으로 수소·질소 같은 가스를 뺍니다.', 'LF: 전기로 온도를 맞추고 합금을 넣습니다.'],
        facts: [{ v: '약 67Pa', k: 'RH 진공도(대기압의 약 1/1,500)', src: 'Tenova' }, { v: '20~30분', k: 'RH 1회 처리', src: 'ispatguru' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ffb54a', label: '정련 완료 용강: 성분·온도 OK' },
        steps: [
          { zone: 'LF · 전극 가열', temp: '약 1,600℃', text: '래들 위에 뚜껑을 덮고 흑연 전극 3개로 아크를 일으켜, 이동 중 식은 용강의 온도를 다시 올려 정확히 맞춥니다.' },
          { zone: 'LF · 합금·탈황', temp: '약 1,600℃', text: '합금을 넣어 성분을 미세 조정하고, 환원성 슬래그로 황을 추가로 제거합니다.' },
          { zone: '아르곤 버블링', temp: '', text: '래들 바닥에서 아르곤을 불어 용강을 섞습니다. 성분·온도가 균일해지고 개재물이 위로 떠오릅니다.' },
          { zone: 'RH · 진공 탈가스', temp: '약 1,580℃', text: '진공조의 두 다리를 용강에 담가 순환시킵니다. 수소·질소·탄소가 빠져 초저탄소강을 만들 수 있습니다.' },
          { zone: '연주로 이송', temp: '약 1,560℃', text: '성분·온도·청정도가 맞으면 래들을 크레인으로 연주 공정 턴디시 위로 보냅니다.' },
        ],
        interior: [
          { label: 'RH 진공조 · 탈가스', temp: '약 1,580℃', color: '#a8c8e0', h: 0.22, formula: 'H₂, N₂, CO ↑' },
          { label: 'LF 흑연 전극 · 아크 가열', temp: '약 1,600℃', color: '#ffd08a', h: 0.18, formula: '전기 → 열' },
          { label: '환원 슬래그 · 탈황', temp: '약 1,600℃', color: '#7a7f88', h: 0.14, formula: 'CaO + S → CaS + O' },
          { label: '용강 · 합금 미세 조정', temp: '약 1,600℃', color: '#ffb54a', h: 0.3, formula: 'Fe-Mn, Fe-Si, Fe-Cr' },
          { label: '아르곤 버블링 · 교반', temp: '약 1,560℃', color: '#8fd3ff', h: 0.16, formula: 'Ar ↑' },
        ] },
      { id: 'ladle_transfer', name: '래들 이송', shape: 'ladle', role: '정련을 마친 용강 래들을 연주 공장으로 넘깁니다. 연주는 이어지지만 별도의 다음 공정입니다.',
        input: '정련 완료 용강', output: '연주로 보낼 래들', notes: ['래들 카와 크레인으로 연주 터릿까지 옮깁니다.', '이동 중 온도가 떨어지므로 시간을 관리합니다.'],
        facts: [{ v: '90~120분', k: '전로 출강부터 연주까지', src: 'China Steel 기술보고 No.35' }, { v: '분당 약 0.4~0.5℃', k: '래들 속 용강이 식는 속도', src: 'China Steel 기술보고 No.35' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ffb54a', label: '래들 이송: 연주 공정으로' },
        steps: [
          { zone: '정련 완료 · 온도 확인', temp: '약 1,580℃', text: '연주에 맞는 온도인지 측정합니다. 낮으면 다시 LF로 돌아가 가열합니다.' },
          { zone: '래들 카 이동', temp: '약 1,570℃', text: '레일 위 래들 카에 실어 연주 공장 쪽으로 옮깁니다. 뚜껑을 덮어 열이 덜 빠지게 합니다.' },
          { zone: '터릿 안착', temp: '약 1,560℃', text: '크레인이 래들을 연주기의 래들 터릿 위에 올려 둡니다. 여기서부터 연주 공정입니다.' },
        ],
        interior: [
          { label: '래들 뚜껑 · 보온', temp: '', color: '#7a7f88', h: 0.16, formula: '' },
          { label: '용강 (주조 대기)', temp: '약 1,570℃', color: '#ffb54a', h: 0.62, formula: '' },
          { label: '내화벽돌 · 단열', temp: '', color: '#5a5f68', h: 0.22, formula: '' },
        ] },
    ],
  },
  {
    id: 'continuous_casting', num: '03', name: '연주', en: 'Continuous Casting', sub: '용강에서 반제품으로',
    io: '용강 → 슬라브',
    summary: '액체 용강을 틀에 부어 연속으로 굳히면서 뽑아내 두꺼운 판(슬라브)으로 만듭니다.',
    materialIn: { shape: 'liquid', color: '#ffb54a', label: '용강: 래들에서 턴디시로' },
    equipment: [
      { id: 'ladle_turret', name: '래들 터릿', shape: 'twin', role: '제강에서 온 래들을 받쳐 들고 회전시켜 주조 위치로 가져옵니다.',
        input: '용강 래들', output: '주조 위치의 래들', notes: ['한쪽이 주조하는 동안 반대쪽에 다음 래들을 올려 둡니다.', '회전만으로 래들을 바꿔 주조가 끊기지 않습니다.'],
        facts: [{ v: '팔당 500톤', k: '터릿 하중 용량(용강 330톤 래들 대응)', src: 'AIST(SMS Demag 수주)' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'liquid', color: '#ffb54a', label: '래들: 턴디시 위에서 주입 시작' },
        steps: [
          { zone: '래들 안착', temp: '약 1,560℃', text: '제강에서 온 래들을 터릿의 한쪽 팔에 올립니다.' },
          { zone: '회전 · 주조 위치', temp: '약 1,560℃', text: '터릿이 180° 돌아 래들을 턴디시 바로 위로 가져옵니다.' },
          { zone: '슬라이딩 게이트 개방', temp: '약 1,550℃', text: '래들 바닥의 게이트를 열고, 공기와 닿지 않게 보호관(쉬라우드)을 통해 용강을 붓습니다.' },
          { zone: '연연주 교체', temp: '약 1,550℃', text: '빈 래들은 돌려 내리고 대기하던 다음 래들로 바로 교체합니다. 주조가 끊기지 않습니다.' },
        ],
        interior: [
          { label: '래들 용강', temp: '약 1,560℃', color: '#ffb54a', h: 0.5, formula: '' },
          { label: '슬라이딩 게이트', temp: '', color: '#7a7f88', h: 0.14, formula: '' },
          { label: '보호관 (쉬라우드) · 공기 차단', temp: '약 1,550℃', color: '#ffa63a', h: 0.36, formula: '' },
        ] },
      { id: 'tundish', name: '턴디시', shape: 'tray', role: '용강을 잠시 담아 흐름을 안정시키고 여러 주형으로 나눠 보냅니다.',
        input: '용강(래들)', output: '용강(일정한 흐름)', notes: ['래들을 바꿔도 주조가 끊기지 않게 해주는 버퍼입니다.', '불순물이 위로 떠오르게 하는 역할도 합니다.'],
        materialOut: { shape: 'liquid', color: '#ffb54a', label: '용강: 일정한 양으로 주형에 투입' },
        steps: [
          { zone: '용강 수용', temp: '약 1,550℃', text: '래들에서 내려온 용강을 수십 톤(예: 40~60톤) 담아 둡니다. 래들 교체 중에도 주조가 이어집니다.' },
          { zone: '흐름 안정 · 개재물 부상', temp: '약 1,540℃', text: '둑(댐·위어)을 지나며 흐름이 느려지고, 가벼운 불순물이 위로 떠 덮개 분말에 흡수됩니다.' },
          { zone: '노즐 → 주형 공급', temp: '약 1,530℃', text: '바닥의 침지 노즐로 주형 속 쇳물 아래에 일정한 양을 넣습니다.' },
        ],
        interior: [
          { label: '덮개 분말 · 보온', temp: '', color: '#7a7f88', h: 0.14, formula: '' },
          { label: '떠오른 개재물', temp: '', color: '#9a5a3a', h: 0.14, formula: 'Al₂O₃ ↑' },
          { label: '용강 (흐름 안정)', temp: '약 1,540℃', color: '#ffb54a', h: 0.48, formula: '' },
          { label: '침지 노즐 → 주형', temp: '약 1,530℃', color: '#ffa04a', h: 0.24, formula: '' },
        ] },
      { id: 'cc_mold', name: '주형·진동 장치', shape: 'mold', role: '수냉 구리 주형이 겉면을 먼저 굳히고, 주형을 진동시켜 강이 달라붙지 않게 합니다.',
        input: '용강', output: '겉만 굳은 주편', notes: ['구리는 열을 잘 전달해 겉면을 빨리 식힙니다.', '속은 아직 액체라서 껍질(쉘)이 터지지 않게 관리합니다.'],
        facts: [{ v: '분당 60~90회', k: '주형 진동수(진폭 6~10mm)', src: '특허 US4438803' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'slab', color: '#ff8c3a', label: '주형: 겉면만 먼저 굳음, 속은 액체' },
        steps: [
          { zone: '쇳물 유입', temp: '약 1,530℃', text: '침지 노즐로 들어온 용강이 구리 주형 안을 채웁니다. 표면은 몰드 파우더로 덮습니다.' },
          { zone: '응고 쉘 형성', temp: '약 1,530℃ → 1,100~1,300℃(겉면)', text: '물이 흐르는 구리 벽에 닿은 겉면만 먼저 굳어 얇은 껍질(쉘)이 됩니다.' },
          { zone: '진동 · 윤활', temp: '', text: '주형을 위아래로 떨어 껍질이 벽에 달라붙지 않게 합니다. 녹은 파우더가 윤활유 역할을 합니다.' },
          { zone: '주형 출구', temp: '쉘 두께 약 10~25mm', text: '주형을 나올 때 겉만 굳고 속은 아직 액체입니다. 쉘이 터지면 큰 사고(브레이크아웃)입니다.' },
        ],
        interior: [
          { label: '몰드 파우더 (보온·윤활)', temp: '', color: '#7a7f88', h: 0.12, formula: '' },
          { label: '용강 (중심부 액체)', temp: '약 1,530℃', color: '#ffb54a', h: 0.36, formula: '' },
          { label: '응고 쉘 (겉면)', temp: '약 1,100℃', color: '#d8551a', h: 0.24, formula: '' },
          { label: '수냉 구리 벽', temp: '약 300℃', color: '#5a7fa0', h: 0.28, formula: '냉각수 순환' },
        ] },
      { id: 'secondary_cooling', name: '2차 냉각·가이드 롤', shape: 'rollers', interiorLayout: 'strand', role: '물을 분사해 속까지 굳히고, 가이드 롤이 가닥을 받쳐 곡선 경로로 안내합니다.',
        input: '겉만 굳은 주편', output: '속까지 굳은 주편', notes: ['롤러로 받쳐 가며 물을 뿌립니다.', '식는 속도가 품질(내부 결함)을 좌우합니다.'],
        facts: [{ v: '약 10m', k: '연주기 곡률 반경', src: 'Primetals, Colorado School of Mines' }, { v: '약 35m', k: '속까지 굳는 데 필요한 길이', src: 'Primetals' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'slab', color: '#a8514a', label: '2차 냉각: 속까지 굳으며 어두워짐' },
        steps: [
          { zone: '스프레이 냉각', temp: '약 1,100℃ → 900℃', text: '롤 사이 노즐로 물·공기를 뿌려 쉘을 두껍게 만듭니다.' },
          { zone: '가이드 롤 지지', temp: '', text: '아직 속이 액체라 부풀어 오르지 않도록 촘촘한 롤이 양면을 받칩니다.' },
          { zone: '완전 응고점', temp: '약 900℃', text: '곡선 구간 끝 무렵 중심까지 다 굳습니다. 이 위치를 정확히 맞추는 것이 품질의 핵심입니다.' },
        ],
        interior: [
          { label: '냉각수 스프레이', temp: '', color: '#5a7fa0', h: 0.2, formula: '' },
          { label: '응고 쉘 (두꺼워짐)', temp: '약 1,000℃', color: '#d8551a', h: 0.3, formula: '' },
          { label: '중심 액상부 (점점 줄어듦)', temp: '약 1,450℃', color: '#ffb54a', h: 0.22, formula: '' },
          { label: '완전 응고', temp: '약 900℃', color: '#a8514a', h: 0.28, formula: '' },
        ] },
      { id: 'withdrawal_straightener', name: '인발·교정 롤', shape: 'rollers', interiorLayout: 'strand', role: '굳어 가는 강을 일정 속도로 끌어내고 곡선을 수평으로 펴 줍니다.',
        input: '곡선 주편', output: '수평으로 펴진 주편', notes: ['인발 속도가 곧 주조 속도입니다.', '속이 덜 굳었을 때 무리하게 펴면 내부 균열이 생깁니다.'],
        facts: [{ v: '분당 약 2m', k: '최대 주조 속도(1.8~2.2m/분)', src: 'Primetals, AIST' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'slab', color: '#8a5a4a', label: '교정: 수평으로 펴진 주편' },
        steps: [
          { zone: '인발', temp: '약 900℃', text: '구동 롤이 주편을 분당 약 1~2m 속도로 일정하게 끌어냅니다. 이 속도가 곧 주조 속도입니다.' },
          { zone: '교정', temp: '약 850℃', text: '곡선으로 내려온 주편을 여러 롤로 조금씩 펴서 수평으로 만듭니다.' },
          { zone: '수평 배출', temp: '약 800℃', text: '수평이 된 주편이 절단기 쪽으로 이어서 나갑니다.' },
        ],
        interior: [
          { label: '곡선 주편', temp: '약 900℃', color: '#a8514a', h: 0.34, formula: '' },
          { label: '교정 구간 (천천히 펴기)', temp: '약 850℃', color: '#8a5a4a', h: 0.33, formula: '' },
          { label: '수평 주편', temp: '약 800℃', color: '#7d6458', h: 0.33, formula: '' },
        ] },
      { id: 'torch_cutter', name: '절단기·배출 롤러', shape: 'gate', role: '토치나 전단기로 정해진 길이로 자르고 배출 롤러로 냉각대에 보냅니다.',
        input: '연속 주편', output: '슬라브 (두께 약 250mm)', notes: ['가스 토치로 움직이는 주편을 따라가며 자릅니다.', '슬라브 한 장이 약 20~30톤입니다.'],
        facts: [{ v: '약 30톤', k: '슬래브 한 장(0.25×1.5×10m, 계산)', src: '계산(철 7.8t/m³)' }, { v: '수십 톤급', k: '슬래브 집게 크레인(1~3장씩, 사례 최대 70톤)', src: 'Konecranes' }, { v: '약 100톤급', k: '슬래브 야드 크레인(표준 120톤)', src: 'Konecranes' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'slab', color: '#6b6f76', label: '슬라브 약 250mm: 식어서 회색 판' },
        steps: [
          { zone: '길이 측정', temp: '약 900℃', text: '주문한 슬라브 길이에 맞춰 자를 위치를 정합니다.' },
          { zone: '토치 절단', temp: '약 850℃', text: '가스 토치가 움직이는 주편과 같은 속도로 따라가며 자릅니다.' },
          { zone: '배출 · 표시', temp: '약 800℃', text: '자른 슬라브에 번호를 찍고 배출 롤러로 냉각대에 보냅니다.' },
          { zone: '냉각 · 적치', temp: '상온', text: '두께 약 250mm, 한 장 20~30톤의 회색 슬라브가 되어 압연을 기다립니다.' },
        ],
        interior: [
          { label: '연속 주편', temp: '약 800℃', color: '#8a5a4a', h: 0.3, formula: '' },
          { label: '토치 불꽃 · 절단', temp: '약 3,000℃ (불꽃)', color: '#ffd08a', h: 0.16, formula: 'O₂ + 연료가스' },
          { label: '슬라브 배출', temp: '약 600℃', color: '#7d6458', h: 0.24, formula: '' },
          { label: '슬라브 약 250mm', temp: '상온', color: '#6b6f76', h: 0.3, formula: '' },
        ] },
    ],
  },
  {
    id: 'rolling', num: '04', name: '열간압연', en: 'Hot Rolling', sub: '슬라브에서 강판으로',
    io: '슬라브 → 열연 코일',
    summary: '슬라브를 다시 뜨겁게 달군 뒤 롤 사이로 눌러 얇은 강판으로 만들어 코일로 감습니다.',
    materialIn: { shape: 'slab', color: '#6b6f76', label: '슬라브: 상온, 두께 약 250mm' },
    equipment: [
      { id: 'reheating_furnace', name: '재가열로', part: 'PART 1', shape: 'box', role: '슬라브를 약 1,200℃로 다시 가열합니다.',
        input: '슬라브(상온)', output: '슬라브 약 1,200℃', notes: ['뜨거워야 부드러워져 잘 눌립니다.', '재결정 온도 위에서 압연하면 "열간"압연입니다.'],
        facts: [{ v: '시간당 250~300톤', k: '가열로 처리량(슬래브 약 15장)', src: 'AIST, ispatguru' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'slab', color: '#ff7a1a', label: '가열 슬라브 약 1,200℃: 다시 주황빛' },
        steps: [
          { zone: '장입', temp: '상온', text: '슬라브를 가열로 입구에 한 장씩 넣습니다. 바닥 빔이 앞으로 천천히 옮겨 줍니다.' },
          { zone: '예열대', temp: '약 700~1,000℃', text: '앞쪽에서는 뒤에서 넘어온 연소가스로 슬라브를 서서히 데웁니다.' },
          { zone: '가열대', temp: '약 1,250℃', text: '버너로 강하게 가열해 겉면을 목표 온도까지 올립니다.' },
          { zone: '균열대 · 추출', temp: '약 1,200℃', text: '속까지 온도가 고르게 되도록 잠시 둔 뒤 꺼냅니다. 강종·두께에 따라 몇 시간 걸립니다.' },
        ],
        interior: [
          { label: '장입 · 상온 슬라브', temp: '상온', color: '#6b6f76', h: 0.2, formula: '' },
          { label: '예열대', temp: '700~1,000℃', color: '#9a5a3a', h: 0.26, formula: '' },
          { label: '가열대 (버너)', temp: '1,250~1,300℃', color: '#ff7a1a', h: 0.28, formula: '' },
          { label: '균열대 · 속까지 균일', temp: '약 1,200℃', color: '#ffa04a', h: 0.26, formula: '' },
        ] },
      { id: 'descaler', name: '스케일 제거기', shape: 'gate', part: 'PART 1', role: '고압수를 뿌려 가열 중 표면에 생긴 산화철 껍질(스케일)을 떼어냅니다.',
        input: '가열 슬라브(스케일 있음)', output: '표면이 깨끗한 슬라브', notes: ['스케일이 남으면 압연 중 표면에 눌려 들어가 결함이 됩니다.', '약 150~250bar 고압수를 씁니다.'],
        materialOut: { shape: 'slab', color: '#ff8a2a', label: '디스케일링: 표면 산화막 제거' },
        steps: [
          { zone: '스케일 생성', temp: '약 1,200℃', text: '가열로에서 나온 슬라브 표면에는 산화철 껍질(스케일)이 덮여 있습니다.' },
          { zone: '고압수 분사', temp: '약 1,150℃', text: '위아래 노즐에서 약 150~250bar 물을 세게 뿌려 껍질을 깨뜨려 날립니다.' },
          { zone: '깨끗한 표면', temp: '약 1,150℃', text: '맨 강 표면이 드러난 상태로 압연기에 들어갑니다.' },
        ],
        interior: [
          { label: '스케일 (산화철 껍질)', temp: '', color: '#5a5f68', h: 0.22, formula: 'FeO · Fe₃O₄' },
          { label: '고압수 분사', temp: '150~200bar', color: '#5a7fa0', h: 0.3, formula: '' },
          { label: '깨끗한 슬라브 표면', temp: '약 1,150℃', color: '#ff8a2a', h: 0.48, formula: '' },
        ] },
      { id: 'roughing_mill', name: '조압연기', part: 'PART 2', shape: 'stand', role: '두께 250mm를 수십 mm로 크게 줄입니다.',
        input: '슬라브 250mm', output: '바 약 30~40mm', notes: ['큰 롤로 여러 번 왕복해 누릅니다.', '폭도 함께 맞춥니다.'],
        facts: [{ v: '약 6,000톤힘', k: '조압연 최대 압하력(60MN)', src: 'Primetals' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'bar', color: '#ff8c3a', label: '바 약 35mm: 두께가 확 줄어듦' },
        steps: [
          { zone: '폭 압연', temp: '약 1,150℃', text: '세로 롤(에저)이 양옆을 눌러 폭을 맞춥니다.' },
          { zone: '왕복 압연', temp: '약 1,100℃', text: '큰 롤 사이를 5~7번 앞뒤로 오가며 두께를 크게 줄입니다.' },
          { zone: '바 완성', temp: '약 1,050℃', text: '250mm 슬라브가 약 30~40mm 두께의 긴 판(바)이 됩니다. 길이는 약 7배로 늘어납니다.' },
        ],
        interior: [
          { label: '슬라브 250mm', temp: '약 1,150℃', color: '#ff8a2a', h: 0.34, formula: '' },
          { label: '롤 압하 · 왕복', temp: '약 1,100℃', color: '#ff7a1a', h: 0.33, formula: '' },
          { label: '바 약 35mm', temp: '약 1,050℃', color: '#ff8c3a', h: 0.33, formula: '' },
        ] },
      { id: 'finishing_mill', name: '사상압연기', part: 'PART 2', shape: 'stands', role: '여러 스탠드를 연속으로 통과시켜 수 mm 스트립으로 만듭니다.',
        input: '바 약 35mm', output: '스트립 약 1.2~25mm(주로 2~10mm)', notes: ['6~7개의 스탠드가 한 줄로 서 있습니다.', '마지막 온도(사상 온도)가 조직을 결정합니다.'],
        facts: [{ v: '시속 약 72km', k: '마지막 스탠드 출구 속도(약 20m/s)', src: 'ispatguru' }, { v: '약 5,300톤힘', k: '앞쪽 스탠드 압연 하중(52MN)', src: 'SMS 발표(HBIS)' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'strip', color: '#ffa04a', label: '스트립 약 3mm: 얇고 긴 띠' },
        steps: [
          { zone: '크롭 절단', temp: '약 1,050℃', text: '바의 앞뒤 끝 고르지 않은 부분을 잘라 냅니다.' },
          { zone: '연속 압연 (F1~F7)', temp: '1,050℃ → 900℃', text: '6~7개 스탠드를 차례로 지나며 매번 조금씩 얇아집니다. 뒤로 갈수록 빨라집니다.' },
          { zone: '두께·폭 제어', temp: '', text: '센서가 실시간으로 두께를 재고 롤 간격을 자동으로 고칩니다.' },
          { zone: '사상 온도', temp: '약 850~900℃', text: '마지막 스탠드를 나올 때 온도가 강의 조직과 성질을 정합니다.' },
        ],
        interior: [
          { label: '바 약 35mm 입구', temp: '약 1,050℃', color: '#ff8c3a', h: 0.26, formula: '' },
          { label: 'F1~F3 · 큰 압하', temp: '약 1,000℃', color: '#ff9a3a', h: 0.26, formula: '' },
          { label: 'F4~F7 · 정밀 압하', temp: '약 900℃', color: '#ffa04a', h: 0.26, formula: '' },
          { label: '스트립 약 2~10mm', temp: '약 870℃', color: '#ffb04a', h: 0.22, formula: '' },
        ] },
      { id: 'runout_table', name: '런아웃 테이블·냉각', part: 'PART 3', shape: 'table', role: '물을 뿌려 식힙니다. 이때 강도가 결정됩니다.',
        input: '뜨거운 스트립', output: '식힌 스트립 약 600℃', notes: ['냉각 속도로 강도·연성을 조절합니다.', '권취 온도가 핵심 관리 항목입니다.'],
        facts: [{ v: '약 100~150m', k: '런아웃 테이블 길이', src: '특허, ispatguru' }, { v: '시간당 2만m³', k: '최대 냉각수량', src: 'Primetals' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'strip', color: '#9a5a48', label: '냉각 스트립 약 600℃: 어두운 빛' },
        steps: [
          { zone: '고속 이송', temp: '약 870℃', text: '스트립이 긴 롤러 테이블 위를 빠르게 달립니다.' },
          { zone: '층류 냉각', temp: '870℃ → 600℃', text: '위아래에서 물을 커튼처럼 흘려 식힙니다. 식히는 속도로 강도를 조절합니다.' },
          { zone: '권취 온도 도달', temp: '약 550~700℃', text: '목표 온도에 정확히 맞춰 권취기로 보냅니다.' },
        ],
        interior: [
          { label: '뜨거운 스트립', temp: '약 870℃', color: '#ffa04a', h: 0.3, formula: '' },
          { label: '층류 냉각수', temp: '', color: '#5a7fa0', h: 0.3, formula: '' },
          { label: '식힌 스트립', temp: '약 600℃', color: '#9a5a48', h: 0.4, formula: '' },
        ] },
      { id: 'coiler', name: '권취기', part: 'PART 4', shape: 'coiler', role: '스트립을 코일로 감습니다.',
        input: '스트립', output: '열연 코일', notes: ['코일 하나가 약 20~30톤, 얇은 코일은 길이가 1km 안팎입니다.', '이 코일이 자동차·가전 강판의 원재료입니다.'],
        facts: [{ v: '약 5분', k: '슬래브 한 장이 코일이 되기까지', src: '데일리안(현대제철 당진)' }, { v: '30~50톤급 이상', k: '코일 야드 크레인(최대 코일 약 40톤)', src: 'Demag, Konecranes' }], // 숫자로 보기(출처 있는 값, docs/numbers-review-draft.md)
        materialOut: { shape: 'coil', color: '#9a5a48', label: '열연 코일: 완성, 식은 강판 색' },
        steps: [
          { zone: '핀치 롤 유도', temp: '약 600℃', text: '스트립 앞끝을 핀치 롤이 잡아 맨드릴(감는 축) 쪽으로 이끕니다.' },
          { zone: '권취', temp: '약 600℃', text: '랩퍼 롤이 감싸 주며 맨드릴이 돌아 스트립을 단단히 감습니다.' },
          { zone: '결속 · 배출', temp: '약 550℃', text: '다 감은 코일을 묶어 꺼내고 번호를 붙입니다.' },
          { zone: '코일 냉각', temp: '상온', text: '야적장에서 천천히 식힙니다. 약 20~30톤의 열연 코일이 완성됩니다. 두께 2mm면 길이가 약 1km입니다.' },
        ],
        interior: [
          { label: '스트립 유입', temp: '약 600℃', color: '#9a5a48', h: 0.26, formula: '' },
          { label: '맨드릴 권취', temp: '약 600℃', color: '#7d6458', h: 0.28, formula: '' },
          { label: '결속 코일', temp: '약 550℃', color: '#6b6f76', h: 0.22, formula: '' },
          { label: '열연 코일 (완성)', temp: '상온', color: '#5c6068', h: 0.24, formula: '' },
        ] },
    ],
  },
];

export const QUIZZES = {
  ironmaking: [
    { q: '고로에서 코크스의 역할은?', options: ['슬래그를 굳히는 응고제', '열원이자 철광석을 환원하는 환원제', '용선의 탄소를 제거하는 산화제', '열풍의 습도를 낮추는 건조제'], answer: 1,
      explain: '코크스는 타면서 열을 내고(열원), 동시에 철광석의 산소를 떼어내는(환원) 두 가지 일을 합니다.' },
    { q: '소결 설비가 필요한 이유는?', options: ['철광석의 색을 밝게 하기 위해', '철광석을 액체로 만들기 위해', '석탄을 코크스로 바꾸기 위해', '가루 철광석을 덩어리로 만들어 고로에 넣기 위해'], answer: 3,
      explain: '가루 상태로는 고로 안에서 바람이 통하지 않아 덩어리(소결광)로 구워서 넣습니다.' },
  ],
  steelmaking: [
    { q: '전로에서 산소를 불어넣는 이유는?', options: ['용선을 식히기 위해', '용선에 산소를 녹여 넣기 위해', '탄소 등 불순물을 산화시켜 제거하기 위해', '고철을 녹이지 않고 보관하기 위해'], answer: 2,
      explain: '산소가 탄소와 만나 CO 가스로 빠져나가며 탄소가 약 4%에서 0.1% 이하로 줄어듭니다.' },
    { q: '2차 정련(RH)에서 진공을 쓰는 목적은?', options: ['수소·질소 같은 가스를 빼내기 위해', '용강 온도를 급격히 올리기 위해', '슬래그를 더 많이 만들기 위해', '용강을 슬라브로 굳히기 위해'], answer: 0,
      explain: 'RH는 진공 상태에서 용강을 순환시켜 녹아 있던 가스를 빼내는 탈가스 설비입니다.' },
  ],
  continuous_casting: [
    { q: '주형을 막 나온 주편의 상태는?', options: ['겉만 굳고 속은 아직 액체', '속까지 완전히 굳음', '전체가 액체', '가루 상태'], answer: 0,
      explain: '수냉 구리 주형은 겉면(쉘)만 먼저 굳힙니다. 속은 2차 냉각대에서 물을 뿌려 굳힙니다.' },
    { q: '턴디시의 역할은?', options: ['주편을 길이대로 자른다', '주편에 물을 뿌려 식힌다', '용강을 잠시 담아 주형에 일정하게 공급한다', '용강에 산소를 불어넣는다'], answer: 2,
      explain: '턴디시는 래들과 주형 사이의 버퍼로, 흐름을 일정하게 하고 불순물을 떠오르게 합니다.' },
  ],
  rolling: [
    { q: '열간·냉간압연을 나누는 기준은?', options: ['롤의 개수', '강판의 두께', '물을 뿌리는지 여부', '재결정 온도보다 높은지 낮은지'], answer: 3,
      explain: '재결정 온도 위에서 누르면 열간압연, 아래에서 누르면 냉간압연입니다.' },
    { q: '런아웃 테이블에서 물을 뿌리는 이유는?', options: ['스트립을 세척하기 위해', '냉각 속도로 강도를 결정하기 위해', '두께를 더 줄이기 위해', '코일을 풀기 쉽게 하기 위해'], answer: 1,
      explain: '식히는 속도에 따라 강의 내부 조직이 달라져 강도·연성이 결정됩니다.' },
  ],
};

export const SUGGESTED = ['이 설비의 역할은?', '앞뒤 공정과의 연결', '전체 공정 순서', '왜 온도가 중요해?'];

export function findProcess(id) { return PROCESSES.find(p => p.id === id); }
export function findEquipment(processId, eqId) { return findProcess(processId)?.equipment.find(e => e.id === eqId); }

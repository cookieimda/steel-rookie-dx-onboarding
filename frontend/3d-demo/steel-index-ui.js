// 공정 인덱스 페이지(steel-index.js)가 쓰는 UI 자산. v4 페이지(Steel Academy v4.dc.html)의 아이콘 표와 단계·온도 보조 함수를 옮겨 왔다(v4는 그대로 둔다).
// 같은 모양을 v4와 맞추려는 것이므로 v4 쪽이 바뀌면 여기도 맞춘다.

export const ICON = {
  home: '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h5v-6h4v6h5V10"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.2"/><rect x="13" y="4" width="7" height="7" rx="1.2"/><rect x="4" y="13" width="7" height="7" rx="1.2"/><rect x="13" y="13" width="7" height="7" rx="1.2"/>',
  bot: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.5V8M9.5 13v1M14.5 13v1M2 12.5v3M22 12.5v3"/><circle cx="12" cy="3.5" r="1"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M12 2.5v3M12 18.5v3M3.8 7.2l2.6 1.5M17.6 15.3l2.6 1.5M3.8 16.8l2.6-1.5M17.6 8.7l2.6-1.5"/><circle cx="12" cy="12" r="7"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.5M12 19v2.5M2.5 12H5M19 12h2.5M5.3 5.3l1.8 1.8M16.9 16.9l1.8 1.8M5.3 18.7l1.8-1.8M16.9 7.1l1.8-1.8"/>',
  moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6"/>',
  logout: '<path d="M10 4H5v16h5"/><path d="M15 8l4 4-4 4M8 12h11"/>',
  chevD: '<path d="M6 9l6 6 6-6"/>', chevU: '<path d="M6 15l6-6 6 6"/>', chevR: '<path d="M9 6l6 6-6 6"/>', chevL: '<path d="M15 6l-6 6 6 6"/>',
  arrowR: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  frame: '<path d="M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4"/><rect x="9" y="9" width="6" height="6" rx="1"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.6-5.9"/><path d="M20 4v5h-5"/>',
  mouse: '<rect x="7" y="3" width="10" height="18" rx="5"/><path d="M12 7v3"/>',
  film: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M10 9v6l5-3z" fill="C"/>',
  play: '<path d="M8 5.5v13l10.5-6.5z" fill="C"/>', stop: '<rect x="7" y="7" width="10" height="10" rx="1.5" fill="C"/>',
  prev: '<path d="M6 5v14"/><path d="M18 5.5v13L9 12z" fill="C"/>', next: '<path d="M18 5v14"/><path d="M6 5.5v13L15 12z" fill="C"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  warn: '<path d="M12 3.5l9.5 16.5h-19z" fill="C" stroke="none"/><path d="M12 10v4.5M12 17.2v.3" stroke="#3a2a06" stroke-width="2.2"/>',
  alert: '<circle cx="12" cy="12" r="9.5" fill="C" stroke="none"/><path d="M12 7v6.5M12 16.5v.3" stroke="#1a222d" stroke-width="2.4"/>',
  book: '<path d="M3 5.5c3-1.2 6-1 9 1 3-2 6-2.2 9-1v13c-3-1.2-6-1-9 1-3-2-6-2.2-9-1z"/><path d="M12 6.5v13"/>',
  hopper: '<path d="M3.5 4h17l-6.5 7.5V17l-4 3v-8.5z"/>', flame: '<path d="M12 2.5c1.2 3.2 4.5 5.2 4.5 9.5a4.5 4.5 0 0 1-9 0c0-2.2 1.1-3.5 2.2-4.4.1 2 1 3.2 2.3 3.4-.3-3 .2-5.6 0-8.5z"/>',
  heat: '<path d="M6 20c-1.6-2.2 1.6-4.3 0-6.5S7.6 9.2 6 7M12 20c-1.6-2.2 1.6-4.3 0-6.5s1.6-4.3 0-6.5M18 20c-1.6-2.2 1.6-4.3 0-6.5s1.6-4.3 0-6.5"/>', drop: '<path d="M12 3s6.5 6.8 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 9.8 12 3 12 3z"/><path d="M9 15a3 3 0 0 0 3 3"/>',
  cut: '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="M8.2 8.4L20 18M8.2 15.6L20 6"/>', conveyor: '<rect x="2.5" y="13" width="19" height="6" rx="3"/><circle cx="7" cy="16" r=".8"/><circle cx="12" cy="16" r=".8"/><circle cx="17" cy="16" r=".8"/><path d="M6 9.5h4v3.5H6zM12 7h5v6h-5z"/>',
  react: '<path d="M9 3h6M10 3v6.2l-5.2 8.6A2 2 0 0 0 6.5 21h11a2 2 0 0 0 1.7-3.2L14 9.2V3"/><path d="M7.2 15h9.6"/>', gas: '<path d="M4 15.5a4 4 0 0 1 4-4 5 5 0 0 1 9.6 1.4 3.4 3.4 0 0 1-.4 6.6H8a4 4 0 0 1-4-4z"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.7.3-1 .8-1 1.5M12 16.6v.2"/>',
  logo: '<path d="M12 2.5L22 21h-6.2L12 13.6 8.2 21H2z" fill="C" stroke="none"/><path d="M12 13.6L15.8 21H8.2z" fill="#0e3a4a" stroke="none"/>',
  // 공정
  ironmaking: '<path d="M9 21l1-9-2-4h8l-2 4 1 9z"/><path d="M8 8V4h8v4M10 4V2M14 4V2M3 21h18"/>',
  steelmaking: '<path d="M5.5 8h13l-1.6 9.3a3 3 0 0 1-3 2.5h-3.8a3 3 0 0 1-3-2.5z"/><path d="M3.5 11h2M18.5 11h2M9.5 8l1-3.5h3l1 3.5"/>',
  continuous_casting: '<path d="M7 3h8l-2 4H9z"/><path d="M11 7v5c0 3 2 5 5 5h5"/><circle cx="6" cy="18.5" r="1.4"/><circle cx="10" cy="19.5" r="1.4"/><path d="M3 22h18"/>',
  rolling: '<circle cx="8" cy="7.5" r="4"/><circle cx="8" cy="16.5" r="4"/><path d="M12 12h10M2 12h2"/>',
  // 설비 모양(data_v2.js의 shape)
  box: '<path d="M3 20V10l5 3v-3l5 3V7l8 4v9z"/><path d="M2 20h20"/>',
  battery: '<rect x="3" y="7" width="18" height="12" rx="1"/><path d="M7.5 7v12M12 7v12M16.5 7v12M18 3.5V7"/>',
  tower: '<path d="M9 21l1-9-2-4h8l-2 4 1 9z"/><path d="M8 8V4h8v4M10 4V2M14 4V2M3 21h18"/>',
  cyl: '<path d="M4.5 20V8a2.2 2.2 0 0 1 4.4 0v12M9.8 20V8a2.2 2.2 0 0 1 4.4 0v12M15.1 20V8a2.2 2.2 0 0 1 4.4 0v12M2.5 20h19"/>',
  ladle: '<path d="M5 8h14l-1.8 10.5a2 2 0 0 1-2 1.5H8.8a2 2 0 0 1-2-1.5z"/><path d="M3 8h18M8.5 4l3.5 4 3.5-4"/>',
  converter: '<path d="M5.5 8h13l-1.6 9.3a3 3 0 0 1-3 2.5h-3.8a3 3 0 0 1-3-2.5z"/><path d="M3.5 11h2M18.5 11h2M9.5 8l1-3.5h3l1 3.5"/>',
  gate: '<path d="M4 21V5M20 21V5M2 5h20M12 5v7"/><path d="M10 12h4l-2 4z"/>',
  twin: '<path d="M4 20V9a3 3 0 0 1 6 0v11M13 20V6h7v14M2 20h20"/>',
  tray: '<path d="M3 8h18l-2.2 6.5H5.2z"/><path d="M8.5 14.5v5M15.5 14.5v5"/>',
  mold: '<rect x="7" y="3.5" width="10" height="10" rx="1"/><path d="M12 13.5v7.5M9.5 7h5"/>',
  rollers: '<circle cx="5" cy="15" r="2.2"/><circle cx="12" cy="15" r="2.2"/><circle cx="19" cy="15" r="2.2"/><path d="M2 10.5h20"/>',
  stand: '<rect x="5" y="3" width="14" height="18" rx="1"/><circle cx="12" cy="9" r="2.6"/><circle cx="12" cy="15" r="2.6"/>',
  stands: '<rect x="2" y="5" width="5.5" height="14" rx=".6"/><rect x="9.25" y="5" width="5.5" height="14" rx=".6"/><rect x="16.5" y="5" width="5.5" height="14" rx=".6"/>',
  table: '<path d="M2 13h20M4 13v4.5M20 13v4.5"/><path d="M7 8.5v2.5M12 6.5v4.5M17 8.5v2.5"/>',
  coiler: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 4h9"/>',
};

export const icon = (name, color = '#cfd7e1', sw = 1.6) => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${(ICON[name] || ICON.box).replace(/fill="C"/g, `fill="${color}"`)}</svg>`);

export const STEP_ICON = [[/냉각|소화|물|스프레이|수냉/, 'drop'], [/파쇄|절단/, 'cut'], [/점화|연소|아크|취련|가열|열풍|버너/, 'flame'], [/건조|예열|건류/, 'heat'], [/가스|집진|탈가스/, 'gas'], [/환원|반응|정련|탈황|탈인|교반|합금|성분/, 'react'], [/장입|투입|배합|원료/, 'hopper'], [/압연|롤|스탠드|교정|인발/, 'rollers'], [/배출|출선|출강|압출|이송|운반|이동|권취|주상/, 'conveyor'], [/용융|용선|쇳물|용강|주입|주조|응고|노상/, 'ladle']];
export const stepIcon = (z) => (STEP_ICON.find(([re]) => re.test(z || '')) || [0, 'react'])[1];
export const parseTemp = (t) => { if (!t) return null; if (/상온/.test(t)) return [15, 35]; const v = (t.replace(/,/g, '').match(/\d+(\.\d+)?/g) || []).map(Number); if (!v.length) return null; let a = Math.min(...v), b = Math.max(...v); if (/이하/.test(t)) a = Math.max(0, b - 140); if (a === b) { a *= 0.96; b *= 1.04; } return [a, b]; };
export const heatOf = (hi) => hi < 300 ? ['rgba(59,130,246,.5)', 'rgba(96,165,250,.3)', '#9cc6ff'] : hi < 800 ? ['rgba(245,158,11,.5)', 'rgba(251,191,36,.3)', '#ffc46b'] : hi < 1300 ? ['rgba(249,115,22,.6)', 'rgba(251,146,60,.35)', '#ff9e64'] : ['rgba(239,68,68,.6)', 'rgba(249,115,22,.4)', '#ff7a45'];

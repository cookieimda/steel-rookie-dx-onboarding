// 학습자 보고서(learner-report.html): 공정 하나의 내 학습 기록을 A4 보고서로 그리고, 브라우저 인쇄의 'PDF로 저장'으로 내보낸다.
// - 관리자 보고서(admin-report.html)와 같은 방식(독립 페이지 + 인쇄)이라 어느 화면에서든 링크 하나로 연다:
//     /login_ui/learner-report.html?section=ironmaking        (?example=1 예시 데이터, ?print=1 다 그린 뒤 인쇄 창)
// - 데이터: 각 API를 따로 부르고(하나가 실패해도 계속), learner-report-model.js가 보고서 모델로 바꾼다. 그리기는 모델만 본다.
// - 2D 설비 그림은 process-2d.js의 SCENES를 쓴다. 못 읽으면 그림 없이 글만 그린다.
import { buildReportModel, reportFileName, SECTION_NAMES } from './learner-report-model.js';

const TOKEN_KEY = 'st-rookie-token', PASS_KEY = 'st-rookie:passcode', VISIT_KEY = 'st-rookie-map-visits';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const store = (name) => { try { return globalThis[name] ?? null; } catch { return null; } };
const read = (s, k) => { try { return s?.getItem(k) || ''; } catch { return ''; } };

// ---- 데이터 모으기 ----
async function getJson(path) {
  const token = read(store('localStorage'), TOKEN_KEY) || read(store('sessionStorage'), TOKEN_KEY);
  if (!token) return null;
  const headers = { Authorization: `Bearer ${token}` }, pass = read(store('localStorage'), PASS_KEY);
  if (pass) headers['X-Test-Passcode'] = pass;
  try { const res = await fetch(path, { headers }); return res.ok ? await res.json() : null; } catch { return null; }
}
async function optionalImport(path) { try { return await import(path); } catch { return null; } }

/** 보고서에 필요한 응답을 모두 모은다. 실패한 것은 null(보고서는 그 부분만 비운다). */
export async function loadSources(section) {
  const [data, dashboard, me, examSections, supplements, misconceptions, reviews] = await Promise.all([
    optionalImport('../3d-demo/data_v2.js'),
    getJson('/api/me/dashboard'), getJson('/api/auth/me'), getJson('/api/exams/sections'),
    getJson(`/api/learning/supplements?section=${encodeURIComponent(section)}`),
    getJson(`/api/me/misconceptions?section=${encodeURIComponent(section)}`), getJson('/api/me/reviews'),
  ]);
  let visits = null;
  try { visits = JSON.parse(read(store('localStorage'), VISIT_KEY) || 'null'); } catch {}
  return { processes: data?.PROCESSES ?? null, dashboard, me, examSections, supplements, misconceptions, reviews, visits };
}

/** 2D 설비 그림. process-2d.js가 없거나 모양이 바뀌면 null을 돌려준다(그림 없이 그린다). */
export async function loadFigures() {
  const mod = await optionalImport('../3d-demo/process-2d.js');
  if (!mod?.SCENES) return null;
  let defs = '', css = '';
  try {
    const src = await (await fetch('../3d-demo/process-2d.js')).text();
    defs = src.match(/const DEFS = `([\s\S]*?)`;/)?.[1] ?? '';
    css = (src.match(/const SCENE_CSS = `([\s\S]*?)`;/)?.[1] ?? '').replace(/:host(\([^)]*\))?\{[^}]*\}/g, '').replace(/\.svg\{[^}]*\}/, '').replace(/\.svg /g, '.p2d ');
  } catch {}
  return { scenes: mod.SCENES, defs, css };
}

// ---- 그리기(모델 → A4 쪽 HTML). DOM을 쓰지 않는다 ----
const MARK = { fog: '○', seen: '●', ok: '✓', bad: '!' };
const STATE = { fog: '아직 안 봄', seen: '봄', ok: '이해함', bad: '헷갈림' };
const figureSvg = (figures, id, label) => (figures?.scenes?.[id]
  ? `<svg class="p2d" viewBox="0 0 600 320" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${esc(label)}">${figures.scenes[id]}</svg>` : '');

/** @returns {string[]} 쪽마다 HTML */
export function renderPages(model, figures = null) {
  const m = model, eqName = (id) => m.equipment.find((e) => e.id === id)?.name ?? '';
  const seen = m.equipment.filter((e) => e.state !== 'fog').length;
  const pages = [];
  const summary = m.confused.length
    ? `설비 ${m.equipment.length}개 중 <b class="em">${seen}개</b>를 봤고, 헷갈린 개념이 <b class="bad">${m.confused.length}개</b> 있어요. 다음 쪽의 '헷갈린 개념'부터 다시 보면 좋아요.`
    : `설비 ${m.equipment.length}개 중 <b class="em">${seen}개</b>를 봤어요. 헷갈린 개념은 없어요.`;
  pages.push(`
    <h1 class="title">${esc(m.learner.name || '학습자')} · ${esc(m.section.name)} 학습 보고서</h1>
    <p class="meta">공정: ${esc(m.section.num)} ${esc(m.section.name)}${m.section.io ? ` (${esc(m.section.io)})` : ''} &nbsp;&nbsp; 날짜: ${esc(m.generatedAt || '')}</p>
    <hr class="rule">
    <div class="howto"><b>이 보고서를 읽는 법</b><ul>
      <li><b>✓ 이해함</b> — 이해도 확인에서 맞힌 개념이 있는 설비</li>
      <li><b class="bad">! 헷갈림</b> — 오개념이 남았거나 다시 풀어야 하는 개념의 설비</li>
      <li><b>● 봄 / ○ 아직 안 봄</b> — 학습 화면에서 본 설비인지(이 브라우저 기록)</li></ul></div>
    <h2 class="h">1 — 한눈에 보기</h2>
    <p>${summary}</p>
    ${m.equipment.length ? `<div class="thumbs">${m.equipment.map((e) => `<div class="thumb ${e.state}">${figures ? `<div class="pic">${figureSvg(figures, e.id, e.name)}</div>` : ''}<div class="c"><span>${esc(e.name)}</span><span>${MARK[e.state]} ${STATE[e.state]}</span></div></div>`).join('')}</div>` : '<p class="dim">설비 정보를 불러오지 못했어요.</p>'}
    <h2 class="h">2 — 다음에 할 일</h2>
    <ol class="list">${m.next.map((x) => `<li>${x.done ? '✓ ' : ''}<b>${esc(x.title)}</b> — ${esc(x.detail)}</li>`).join('')}</ol>`);
  for (const [i, c] of m.confused.entries()) {
    pages.push(`
      <h2 class="h">3 — 헷갈린 개념${m.confused.length > 1 ? ` (${i + 1}/${m.confused.length})` : ''}</h2>
      <h3 class="h3"><span class="bad">!</span> ${esc(c.name)}</h3>
      ${c.equipmentId && figures ? `<div class="figure"><div class="pic">${figureSvg(figures, c.equipmentId, eqName(c.equipmentId))}</div></div><p class="cap">그림 ${i + 1}. 학습 화면의 ${esc(eqName(c.equipmentId))}</p>` : ''}
      ${c.answer ? `<p><b>내가 쓴 답</b>${c.sourceLabel ? ` (${esc(c.sourceLabel)})` : ''}</p><blockquote class="quote">"${esc(c.answer)}"</blockquote>` : ''}
      <p><b>${c.why === 'retry' ? '다시 풀 이유' : '헷갈린 점'}</b></p>
      <p>${esc(c.summary || (c.why === 'retry' ? '이해도 확인에서 만점을 받지 못한 개념이에요.' : '기록된 설명이 없어요.'))}</p>
      <p><b>다시 보는 방법</b></p>
      <ul class="list"><li>학습 화면에서 ${c.equipmentId ? `<b>${esc(eqName(c.equipmentId))}</b>을(를) 보며 ` : ''}튜터에게 '보충학습 · ${esc(c.name)}'을 눌러 다시 설명을 들어요.</li>
        <li>설명을 들은 뒤 이 개념을 한 문장으로 말해 보고, 이해도 확인에서 다시 풀어요.</li></ul>`);
  }
  const k = m.confused.length ? 4 : 3, unseen = m.equipment.filter((e) => e.state === 'fog');
  pages.push(`
    <h2 class="h">${k} — 이해한 개념</h2>
    ${m.understood.length ? `<ul class="list">${m.understood.map((u) => `<li>✓ ${esc(u.name)}</li>`).join('')}</ul>`
      : m.checkpoint.understanding != null ? `<p>이해도 확인 결과: 이해도 <b>${Math.round(m.checkpoint.understanding * 100)}%</b>${m.checkpoint.status === 'passed' ? ' (통과)' : ' (80% 미만)'}. 개념별 결과는 복습 일정이 잡히면 여기에 나와요.</p>`
      : '<p class="dim">아직 이해도 확인에서 맞힌 개념이 없어요.</p>'}
    <h2 class="h">${k + 1} — 복습 일정</h2>
    ${m.reviews.length ? `<table><tr><th>개념</th><th>복습할 날</th><th>이유</th></tr>${m.reviews.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.due || '—')}</td><td>${esc(r.reason || '')}</td></tr>`).join('')}</table>` : '<p class="dim">잡힌 복습 일정이 없어요.</p>'}
    <h2 class="h">${k + 2} — 아직 안 본 설비</h2>
    ${unseen.length ? `<ul class="list">${unseen.map((e) => `<li>○ <b>${esc(e.name)}</b>${e.input || e.output ? ` — ${esc(e.input)} → ${esc(e.output)}` : ''}</li>`).join('')}</ul>` : '<p class="dim">이 공정의 설비를 모두 봤어요.</p>'}
    <h2 class="h">${k + 3} — 자기 점검</h2>
    <div class="box">${m.section.io && m.section.io.includes('→')
      ? `${esc(m.section.name)}에 들어온 <b>${esc(m.section.io.split('→')[0].trim())}</b>이(가) 어떤 설비를 거쳐 <b>${esc(m.section.io.split('→').pop().trim())}</b>이(가) 되나요? 한 문장으로 말해 보세요.`
      : `${esc(m.section.name)} 공정의 흐름을 한 문장으로 말해 보세요.`}</div>
    <p class="note">이 보고서는 ST-ROOKIE의 이해도 확인·보충학습·복습 기록으로 만들었어요. 점수는 이해도 확인 화면의 결과가 기준이에요.</p>`);
  const name = reportFileName(m);
  return pages.map((html, i) => `<article class="page">${html}<footer class="foot">${i + 1} / ${pages.length} · ${esc(name)}</footer></article>`);
}

// ---- 예시 데이터: 실제 API와 같은 모양(같은 모델 변환을 거친다) ----
export const EXAMPLE_SOURCES = {
  dashboard: { trainee: { name: '예시 학습자', sections: { ironmaking: null } } },
  examSections: { sections: [{ section: 'ironmaking', checkpoint: true }, { section: 'steelmaking', checkpoint: false }, { section: 'continuous_casting', checkpoint: false }, { section: 'rolling', checkpoint: false }] },
  supplements: { candidates: [{ concept_id: 'coke_reduction', name: '고로에서 코크스의 역할', reason: 'misconception', summary: '코크스를 연료로만 설명하고, 철광석을 환원하는 역할을 빠뜨렸어요.' }] },
  misconceptions: { misconceptions: [{ section: 'ironmaking', concept_id: 'coke_reduction', label: '이해도 확인', summary: '코크스를 연료로만 설명함', answer_text: '코크스는 고로 안에서 불을 피우는 연료예요.', resolved: false }] },
  reviews: { tasks: [
    { section: 'ironmaking', concept_id: 'sinter_purpose', concept_name: '소결의 목적', due_date: '2026-10-22', reason: '정답 개념의 간격 복습', completed_at: null },
    { section: 'ironmaking', concept_id: 'coke_reduction', concept_name: '고로에서 코크스의 역할', due_date: '2026-10-16', reason: '다시 확인이 필요한 개념', completed_at: null } ] },
  visits: { sinter_plant: {}, coke_oven: {}, blast_furnace: {}, hot_stove: {} },
};

// ---- 페이지 ----
const $ = (id) => document.getElementById(id);
const today = () => new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Seoul' }).slice(0, 10);
const SOURCE_LABEL = { processes: '설비 목록(data_v2.js)', dashboard: '내 학습 현황', examSections: '이해도 확인 공정', supplements: '보충학습 후보', misconceptions: '내 오개념', reviews: '복습 일정', conceptEquipment: '개념-설비 연결' };

async function main() {
  const qs = new URLSearchParams(location.search);
  let section = SECTION_NAMES[qs.get('section')] ? qs.get('section') : 'ironmaking', example = qs.get('example') === '1';
  const figures = await loadFigures();
  if (figures) { $('defs').innerHTML = figures.defs; document.head.insertAdjacentHTML('beforeend', `<style>${figures.css}</style>`); }
  const draw = async () => {
    $('pages').innerHTML = '<p class="loading">기록을 불러오는 중…</p>';
    const real = await loadSources(section);
    const sources = example ? { ...EXAMPLE_SOURCES, processes: real.processes } : real;
    const model = buildReportModel(sources, { section, today: today() });
    $('pages').innerHTML = renderPages(model, figures).join('');
    $('fname').textContent = `${reportFileName(model)}.pdf`;
    document.title = reportFileName(model);
    $('sources').innerHTML = (example ? '<span class="src ex">예시 데이터</span>' : '') + Object.entries(model.sources)
      .map(([k, v]) => `<span class="src ${v}">${v === 'ok' ? '✓' : '—'} ${esc(SOURCE_LABEL[k] ?? k)}</span>`).join('') + `<span class="src ${figures ? 'ok' : 'missing'}">${figures ? '✓' : '—'} 2D 그림</span>`;
    $('section').value = section; $('exampleBtn').classList.toggle('on', example);
    return model;
  };
  $('section').innerHTML = Object.entries(SECTION_NAMES).map(([id, n]) => `<option value="${id}">${n}</option>`).join('');
  $('section').onchange = (e) => { section = e.target.value; draw(); };
  $('exampleBtn').onclick = () => { example = !example; draw(); };
  // 학습 기록 '학습 랩 › 보고서' 탭 안(iframe)이면: 인쇄는 새 창에서(문서 제목 = PDF 파일 이름), [닫기]는 숨긴다(뒤로 가기가 바깥 화면을 움직인다)
  const framed = window.top !== window;
  $('pdfBtn').onclick = $('printBtn').onclick = () => (framed ? open(`${location.pathname}?section=${section}${example ? '&example=1' : ''}&print=1`, '_blank', 'noopener') : print());
  if (framed) $('closeBtn').hidden = true;
  else $('closeBtn').onclick = () => (history.length > 1 ? history.back() : close());
  await draw();
  if (qs.get('print') === '1') setTimeout(() => print(), 300);
}
if (typeof document !== 'undefined' && document.getElementById('pages')) main();

// 관리자 대시보드 데이터. 화면에는 로그인한 관리자의 DB 응답만 표시한다.
// - GET /api/admin/trainees : docs/auth-api.md '관리자 통계' 형식 그대로
// - GET /api/admin/concepts : 개념(=설비)별 첫 판정 분포. concept_results + attempts로 집계

const TOKEN_KEY = 'st-rookie-token';
function authHeaders() {
  let token = null; try { token = localStorage.getItem(TOKEN_KEY) || sessionStorage.getItem(TOKEN_KEY); } catch (e) {}
  return token ? { authorization: 'Bearer ' + token } : {};
}
async function get(path) {
  const res = await fetch(path, { headers: authHeaders() });
  if (!res.ok) throw new Error(String(res.status));
  return res.json();
}
export async function loadAdminData() {
  const [trainees, concepts] = await Promise.all([
    get('/api/admin/trainees'), get('/api/admin/concepts'),
  ]);
  return { trainees, concepts };
}

// GET /api/admin/trainees/:id : 신입사원 한 명 상세(섹션별 개념 점수·시도 기록·진행 중, 오개념은 개수만). 표에서 사람을 누르면 부른다.
export function loadTraineeDetail(id) {
  return get(`/api/admin/trainees/${encodeURIComponent(id)}`);
}

// GET /api/admin/ai-summary : 오답률 높은 개념의 집계 숫자만 Gemini에 넘겨 만든 1~2문장 요약.
// 실패해도 대시보드는 그대로 보이도록 loadAdminData와 따로 부른다. 실패하면 { error: 상태 코드 문자열 }.
export async function loadAiSummary() {
  try { return await get('/api/admin/ai-summary'); } catch (e) { return { error: e.message }; }
}

// GET /api/admin/report.csv : 신입사원 통계 보고서(CSV, 엑셀에서 열림). 로그인 토큰이 있어야 해서 링크 대신 받아서 내려받기를 연다.
// 파일 이름은 서버가 정한다(신입사원_학습현황_YYYYMMDD.csv).
export async function downloadReport() {
  const res = await fetch('/api/admin/report.csv', { headers: authHeaders() });
  if (!res.ok) throw new Error(String(res.status));
  const m = (res.headers.get('content-disposition') || '').match(/filename\*=UTF-8''([^;]+)/);
  const name = m ? decodeURIComponent(m[1]) : 'trainee-report.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// 튜터 패널 공용 API 요청(메인 페이지 Steel Academy v2.dc.html용). 설계: docs/checkpoint-integration.md
// - 로그인 토큰(st-rookie-token)을 Authorization: Bearer로, 접속 비밀번호(st-rookie:passcode)를 X-Test-Passcode로 붙인다(접속 비밀번호는 ④에서 제거 예정).
//   토큰은 로그인 화면(frontend/login_ui)이 '로그인 상태 유지'면 localStorage, 아니면 sessionStorage에 둔다.
// - 메인 페이지는 로그인 필수라 X-User-Id(?user=이름)는 보내지 않는다.
// - 401(로그인 만료·접속 비밀번호), 429(사용량 초과), 502·503(서버 오류) 안내 문장은 tutor-text.js의 TEXT.errors로 통일한다.
// - DOM을 쓰지 않는다. fetch와 저장소는 넣어 줄 수 있다(테스트).

import { TEXT } from './tutor-text.js';

export const TOKEN_KEY = 'st-rookie-token';
export const PASS_KEY = 'st-rookie:passcode';

/** 실패한 요청. status는 HTTP 상태(연결 실패는 0), code는 서버가 준 code. message는 화면에 그대로 보여 줄 문장. */
export class ApiError extends Error {
  constructor(message, status, code = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

// 사생활 보호 모드 등에서 저장소 접근이 예외를 내도 요청은 계속한다.
const browserStore = (name) => { try { return globalThis[name] ?? null; } catch (e) { return null; } };
const read = (store, key) => { try { return store?.getItem(key) || ''; } catch (e) { return ''; } };
const remove = (store, key) => { try { store?.removeItem(key); } catch (e) {} };
const write = (store, key, value) => { try { store?.setItem(key, value); } catch (e) {} };

/** 응답 상태 → 화면 문장. 그 밖의 4xx는 서버 문장(예: 409 이미 통과한 섹션)을 그대로 쓴다. */
function errorFor(status, data) {
  if (status === 401 && data.code === 'PASSCODE_REQUIRED') return TEXT.errors.passcode;
  if (status === 401 && data.code === 'TOKEN_INVALID') return TEXT.errors.tokenInvalid;
  if (status === 401) return TEXT.errors.loginRequired;
  if (status === 429) return TEXT.errors.usageLimit;
  if (status === 502 || status === 503) return TEXT.errors.server;
  return data.error || TEXT.errors.unknown;
}

/**
 * @param {{ fetch?: typeof fetch, local?: Storage | null, session?: Storage | null }} [options]
 */
export function createApiClient(options = {}) {
  const doFetch = options.fetch ?? ((...args) => globalThis.fetch(...args));
  const local = 'local' in options ? options.local : browserStore('localStorage');
  const session = 'session' in options ? options.session : browserStore('sessionStorage');

  const token = () => read(local, TOKEN_KEY) || read(session, TOKEN_KEY);
  const clearToken = () => { remove(local, TOKEN_KEY); remove(session, TOKEN_KEY); };

  return {
    /** 로그인 토큰이 있는지. 없으면 메인 페이지는 API를 부르지 않고 로그인 안내를 보여 준다. */
    hasToken: () => !!token(),

    /** 접속 비밀번호(TEST_PASSCODE)를 저장한다. 빈 값이면 지운다. ④에서 TEST_PASSCODE와 함께 제거 예정(docs/checkpoint-integration.md). */
    setPasscode(value) { if (value) write(local, PASS_KEY, value); else remove(local, PASS_KEY); },

    /** JSON 요청. 성공하면 응답 본문, 실패하면 ApiError. 로그인이 만료됐으면(TOKEN_INVALID) 저장된 토큰을 지운다. */
    async request(method, path, body, { idempotencyKey } = {}) {
      const headers = body === undefined ? {} : { 'Content-Type': 'application/json' };
      if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
      const t = token();
      if (t) headers['Authorization'] = 'Bearer ' + t;
      const passcode = read(local, PASS_KEY);
      if (passcode) headers['X-Test-Passcode'] = encodeURIComponent(passcode);
      let res;
      try {
        res = await doFetch(path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) {
        throw new ApiError(TEXT.errors.network, 0);
      }
      const data = await res.json().catch(() => ({}));
      if (res.ok) return data;
      if (res.status === 401 && data.code === 'TOKEN_INVALID') clearToken();
      throw new ApiError(errorFor(res.status, data), res.status, data.code ?? null);
    },
  };
}

// 자동 화질 판단(perf-mode.js autoQuality). 외부 모듈 없이 숫자만 다뤄 Node 테스트에서 바로 부른다(backend/test/quality-rule.test.ts).
// 2026-10-26 실제 기기 측정(Intel Iris Plus): 로딩 직후 셰이더 준비 프레임 하나(1.17초)가 3초 평균을 끌어올려, 그 뒤로 60fps인데도
// 렌더 해상도를 1로 낮췄다(첫 화면 캔버스 1911 → 1468). 그래서 평균 대신 중앙값으로 '꾸준히 느린가'만 본다.

export const QUALITY = { warmupMs: 2000, window: 90, slowMs: 24, hiddenMs: 500 };

/**
 * 프레임 간격(ms) 목록을 보고 해상도를 낮출지 정한다. 탭이 숨겨졌던 간격(hiddenMs 이상)은 빼고, 남은 간격의 중앙값이 slowMs보다 크면 true.
 * 한두 번의 긴 멈춤(셰이더 준비·모델 올리기)은 중앙값을 바꾸지 않는다.
 */
export function shouldLowerQuality(dts, { slowMs = QUALITY.slowMs, hiddenMs = QUALITY.hiddenMs } = {}) {
  const ok = dts.filter((d) => d > 0 && d < hiddenMs).sort((a, b) => a - b);
  if (ok.length < 30) return false; // 표본이 적으면(탭을 오래 숨김 등) 판단하지 않는다
  return ok[Math.floor(ok.length / 2)] > slowMs;
}

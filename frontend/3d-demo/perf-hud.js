// 성능 표시(주소에 ?perf=1이 있을 때만 켠다): 왼쪽 아래에 FPS·프레임 시간·드로우 콜·삼각형 수·캔버스 크기를 1초마다 보인다.
// WebGL 그리기 호출(drawElements·drawArrays와 인스턴스 버전)을 세어 프레임마다 묶는다. 그림자·빛번짐 패스의 호출도 모두 들어간다.
// 측정 기록은 window.__perf(최근 1초 요약 목록)에도 남겨 콘솔·자동 점검에서 읽을 수 있다. 화면 코드는 건드리지 않는다.
// 화면들은 대기 중에 프레임을 건너뛰므로(perf-mode.js frameGate) '그린 프레임'만 따로 센다: 그림 FPS · 그린 프레임당 드로우 콜·삼각형.
// [측정값 복사]: 최근 기록·기기 정보(GPU 이름·화면 배율)를 JSON으로 복사한다(실제 기기 측정을 보낼 때).
if (new URLSearchParams(location.search).has('perf')) {
  const counts = { calls: 0, tris: 0 };
  const TRIANGLES = 4;
  for (const Ctx of [globalThis.WebGL2RenderingContext, globalThis.WebGLRenderingContext].filter(Boolean)) {
    const P = Ctx.prototype;
    const wrap = (name, countArg, instanced) => {
      const f = P[name]; if (!f) return;
      P[name] = function (...a) {
        counts.calls++;
        if (a[0] === TRIANGLES) counts.tris += (a[countArg] / 3) * (instanced ? a[a.length - 1] : 1);
        return f.apply(this, a);
      };
    };
    wrap('drawElements', 1, false); wrap('drawArrays', 2, false);
    wrap('drawElementsInstanced', 1, true); wrap('drawArraysInstanced', 2, true);
  }

  const box = document.createElement('div');
  box.setAttribute('aria-live', 'off');
  box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;padding:10px 12px;border-radius:10px;background:rgba(0,0,0,.72);color:#e8ecf2;font:12px/1.5 ui-monospace,Consolas,monospace;pointer-events:none;white-space:pre;min-width:200px';
  box.append(document.createElement('pre'), document.createElement('button'));
  Object.assign(box.firstChild.style, { margin: 0, font: 'inherit' });
  const copyBtn = box.lastChild; copyBtn.type = 'button'; copyBtn.textContent = '측정값 복사';
  copyBtn.style.cssText = 'margin-top:6px;pointer-events:auto;cursor:pointer;border:0;border-radius:6px;padding:4px 8px;background:#ff9e64;color:#1a0b03;font:700 12px system-ui,sans-serif;';
  copyBtn.onclick = async () => {
    let gpu = '-'; try { const gl = document.querySelector('canvas')?.getContext('webgl2'); const ext = gl?.getExtension('WEBGL_debug_renderer_info'); gpu = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl?.getParameter(gl.RENDERER) || '-'; } catch (e) { /* GPU 이름을 못 읽어도 나머지는 복사 */ }
    const report = JSON.stringify({ page: location.pathname + location.search, ua: navigator.userAgent, gpu, screen: `${screen.width}×${screen.height}`, dpr: devicePixelRatio, last: summaries.slice(-15) }, null, 1);
    try { await navigator.clipboard.writeText(report); copyBtn.textContent = '복사했어요'; } catch (e) { console.log(report); copyBtn.textContent = '콘솔에 출력했어요'; }
    setTimeout(() => { copyBtn.textContent = '측정값 복사'; }, 1800);
  };
  const ready = () => document.body.appendChild(box);
  if (document.body) ready(); else addEventListener('DOMContentLoaded', ready);

  const frames = []; // { dt, calls, tris }
  const summaries = (globalThis.__perf = []);
  let last = performance.now(), lastReport = last;
  const pct = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(arr.length * p))];
  function tick(now) {
    frames.push({ dt: now - last, calls: counts.calls, tris: counts.tris });
    counts.calls = 0; counts.tris = 0; last = now;
    if (now - lastReport >= 1000 && frames.length > 1) {
      const f = frames.splice(0), dts = f.map((x) => x.dt).sort((a, b) => a - b);
      const avgDt = dts.reduce((s, x) => s + x, 0) / dts.length, avg = (k) => Math.round(f.reduce((s, x) => s + x[k], 0) / f.length);
      const cv = document.querySelector('canvas');
      const drawn = f.filter((x) => x.calls > 0), sec = (now - lastReport) / 1000, avgD = (k) => (drawn.length ? Math.round(drawn.reduce((a, x) => a + x[k], 0) / drawn.length) : 0);
      const s = { t: Math.round(now / 1000), fps: Math.round(1000 / avgDt), drawFps: Math.round(drawn.length / sec), callsPerDraw: avgD('calls'), trisPerDraw: avgD('tris'), msAvg: +avgDt.toFixed(1), msP95: +pct(dts, .95).toFixed(1), msMax: +dts[dts.length - 1].toFixed(1),
        calls: avg('calls'), tris: avg('tris'), canvas: cv ? `${cv.width}×${cv.height}` : '-', dpr: +devicePixelRatio.toFixed(2) };
      summaries.push(s); if (summaries.length > 120) summaries.shift();
      box.firstChild.textContent = `FPS        ${s.fps} (그림 ${s.drawFps})\n드로우 콜  ${s.callsPerDraw.toLocaleString()} / 그린 프레임\n삼각형     ${s.trisPerDraw.toLocaleString()} / 그린 프레임\n프레임     평균 ${s.msAvg}ms · 95% ${s.msP95}ms · 최대 ${s.msMax}ms\n드로우 콜  ${s.calls.toLocaleString()} / 프레임\n삼각형     ${s.tris.toLocaleString()} / 프레임\n캔버스     ${s.canvas} (DPR ${s.dpr})`;
      lastReport = now;
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

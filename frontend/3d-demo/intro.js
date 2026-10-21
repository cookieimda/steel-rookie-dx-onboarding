// 도입 애니메이션 "철든 신입": 게임기 부팅 화면처럼 불씨 → 강철 기둥 → 섬광 → 로고 → PRESS ANY BUTTON.
// 페이지 <head>에 <script src="./intro.js"></script> 한 줄을 넣으면 화면 전체를 덮었다가 아무 키나 누르면 사라진다.
// 브라우저 탭(세션)마다 한 번만 나온다. ?intro=1이면 항상, ?intro=0이면 건너뛴다. data-always="true"면 항상 나온다.
// 끝나면 window에 'st-intro-end' 이벤트를 보낸다.
(() => {
  const SEEN_KEY = "st-rookie-intro-seen";
  const param = new URLSearchParams(location.search).get("intro");
  if (param === "0") return;
  const always = param === "1" || document.currentScript?.dataset.always === "true";
  try { if (!always && sessionStorage.getItem(SEEN_KEY)) return; } catch {}

  // 시간표(초)
  const T = { towers: 0.8, streak: 3.5, flash: 4.0, logo: 4.25, press: 6.0 };
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  const fonts = document.createElement("link");
  fonts.rel = "stylesheet";
  fonts.href = "https://fonts.googleapis.com/css2?family=Noto+Sans+KR:wght@700;900&family=IBM+Plex+Mono:wght@400;500&family=Noto+Serif+KR:wght@900&display=swap";
  document.head.appendChild(fonts);

  const style = document.createElement("style");
  style.textContent = `
    #st-intro { position: fixed; inset: 0; z-index: 2147483000; background: #020306; overflow: hidden; cursor: pointer; user-select: none;
      font-family: "Noto Sans KR", "IBM Plex Sans KR", sans-serif; color: #eef2f6; transition: opacity .8s ease .15s; }
    #st-intro.out { opacity: 0; pointer-events: none; }
    #st-intro canvas { position: absolute; inset: 0; width: 100%; height: 100%; display: block; }
    #st-intro .sti-vig { position: absolute; inset: 0; pointer-events: none; background: radial-gradient(ellipse at 50% 55%, transparent 35%, rgba(0,0,0,.8) 100%); }
    #st-intro .sti-logo { position: absolute; left: 0; right: 0; top: 50%; transform: translateY(-62%); text-align: center; pointer-events: none; }
    #st-intro .sti-kanji { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%) scale(.82); font-family: "Noto Serif KR", serif; font-weight: 900;
      font-size: min(52vw, 52vh); line-height: 1; color: rgba(255,120,40,.05); -webkit-text-stroke: 1px rgba(255,150,70,.14); opacity: 0; filter: blur(8px); }
    #st-intro.show .sti-kanji { animation: stiKanji 2.6s cubic-bezier(.2,.7,.2,1) forwards; }
    #st-intro .sti-title { position: relative; margin: 0; font-weight: 900; font-size: clamp(52px, 12vw, 156px); letter-spacing: .03em; line-height: 1.05; white-space: nowrap; }
    #st-intro .sti-title span { display: inline-block; opacity: 0; color: transparent; -webkit-background-clip: text; background-clip: text;
      background-image: linear-gradient(105deg, transparent 42%, rgba(255,255,255,.95) 50%, transparent 58%), linear-gradient(180deg, #ffffff 0%, #e3e9f0 36%, #7c8a9b 50%, #c8d2dd 64%, #ffae5e 100%);
      background-repeat: no-repeat; background-size: 300% 100%, 100% 100%; background-position: 150% 0, 0 0; }
    #st-intro .sti-title .sp { width: .26em; }
    #st-intro.show .sti-title span { animation: stiLetter .95s cubic-bezier(.16,.9,.25,1) calc(var(--i) * .09s) forwards, stiShine 4.2s ease-in-out calc(1.3s + var(--i) * .07s) infinite; }
    #st-intro .sti-bar { position: relative; height: 2px; width: min(560px, 72vw); margin: 18px auto 20px; transform: scaleX(0);
      background: linear-gradient(90deg, transparent, #ff7a1a 20%, #fff4dc 50%, #ff7a1a 80%, transparent); box-shadow: 0 0 14px 2px rgba(255,130,40,.55); }
    #st-intro.show .sti-bar { animation: stiBar 1s cubic-bezier(.6,0,.2,1) .55s forwards; }
    #st-intro .sti-sub { position: relative; font: 500 clamp(11px, 1.3vw, 15px) "IBM Plex Mono", monospace; letter-spacing: .55em; padding-left: .55em; color: #a9b8ca; opacity: 0; }
    #st-intro .sti-route { position: relative; margin-top: 12px; font: 700 clamp(11px, 1.2vw, 14px) "Noto Sans KR", sans-serif; letter-spacing: .2em; color: rgba(255,154,46,.85); opacity: 0; }
    #st-intro.show .sti-sub { animation: stiFade 1s ease .9s forwards; }
    #st-intro.show .sti-route { animation: stiFade 1s ease 1.2s forwards; }
    #st-intro .sti-press { position: absolute; left: 0; right: 0; bottom: 15vh; text-align: center; pointer-events: none; opacity: 0; }
    #st-intro .sti-press b { display: block; font: 500 clamp(12px, 1.4vw, 16px) "IBM Plex Mono", monospace; letter-spacing: .5em; padding-left: .5em; color: #eef2f6; }
    #st-intro .sti-press small { display: block; margin-top: 8px; font-size: 12px; letter-spacing: .3em; color: #7d8a9a; }
    #st-intro.ready .sti-press { animation: stiBlink 1.8s ease-in-out infinite; }
    #st-intro .sti-foot { position: absolute; left: 0; right: 0; bottom: 18px; text-align: center; font: 400 11px "IBM Plex Mono", monospace; letter-spacing: .2em; color: #3e4856; pointer-events: none; }
    #st-intro .sti-tools { position: absolute; top: 18px; right: 18px; display: flex; gap: 8px; }
    #st-intro .sti-btn { padding: 6px 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; background: rgba(255,255,255,.04);
      color: #93a0b0; font: 500 11px "IBM Plex Mono", monospace; letter-spacing: .12em; cursor: pointer; }
    #st-intro .sti-btn:hover { color: #eef2f6; border-color: rgba(255,255,255,.3); }
    #st-intro .sti-flash { position: absolute; inset: 0; background: #fff6e8; opacity: 0; pointer-events: none; }
    #st-intro.out .sti-flash { animation: stiPop .5s ease-out; }
    @keyframes stiKanji { to { opacity: 1; transform: translate(-50%, -50%) scale(1); filter: blur(0); } }
    @keyframes stiLetter { 0% { opacity: 0; transform: translateY(.22em) scale(1.4); filter: blur(12px); } 100% { opacity: 1; transform: none; filter: drop-shadow(0 0 22px rgba(255,130,50,.35)); } }
    @keyframes stiShine { 0% { background-position: 150% 0, 0 0; } 35%, 100% { background-position: -50% 0, 0 0; } }
    @keyframes stiBar { to { transform: scaleX(1); } }
    @keyframes stiFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
    @keyframes stiBlink { 0%, 100% { opacity: .15; } 50% { opacity: 1; } }
    @keyframes stiPop { 0% { opacity: .55; } 100% { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) {
      #st-intro *, #st-intro.show *, #st-intro.ready * { animation-duration: .01s !important; animation-delay: 0s !important; animation-iteration-count: 1 !important; }
      #st-intro.ready .sti-press { opacity: 1; }
    }
  `;
  document.head.appendChild(style);

  const root = document.createElement("div");
  root.id = "st-intro";
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", "철든 신입 도입 화면. 아무 키나 누르면 로그인 화면으로 넘어갑니다.");
  const letters = ["철", "든", "", "신", "입"].map((ch, i) => ch ? `<span style="--i:${i}">${ch}</span>` : `<span class="sp"></span>`).join("");
  root.innerHTML = `
    <canvas></canvas>
    <div class="sti-vig"></div>
    <div class="sti-logo">
      <div class="sti-kanji" aria-hidden="true">鐵</div>
      <h1 class="sti-title">${letters}</h1>
      <div class="sti-bar"></div>
      <div class="sti-sub">ST-ROOKIE · STEEL ACADEMY</div>
      <div class="sti-route">제선 → 제강 → 연주 → 열간압연</div>
    </div>
    <div class="sti-press"><b>PRESS ANY BUTTON</b><small>로그인을 해주세요</small></div>
    <div class="sti-foot">ST-ROOKIE · 제철소 신입사원 기초교육</div>
    <div class="sti-tools">
      <button class="sti-btn sti-sound" type="button" hidden>♪ 소리 켜기</button>
      <button class="sti-btn sti-skip" type="button">건너뛰기 · ESC</button>
    </div>
    <div class="sti-flash"></div>
  `;
  (document.body || document.documentElement).appendChild(root);

  const canvas = root.querySelector("canvas");
  const g = canvas.getContext("2d");
  const soundBtn = root.querySelector(".sti-sound");
  let W = 0, H = 0;
  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = innerWidth; H = innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resize();
  addEventListener("resize", resize);

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v) => Math.max(0, Math.min(1, v));
  const ease = (v) => 1 - Math.pow(1 - v, 3);
  const FAR = 36, CAM_Y = 1.5;

  // ---- 소리: 오케스트라 악기를 코드로 합성한다(현악·금관·팀파니·큰북·심벌·글로켄슈필).
  // 불씨부터 현악 크레셴도와 팀파니 롤로 끌어올리고, 섬광에 총주로 터뜨린 뒤, 로고에서 bVI–bVII–I 팡파르로 끝낸다.
  // 브라우저는 클릭 전 소리를 막으므로 '소리와 함께 보기'를 누르면 처음부터 다시 재생한다.
  const NOTE = { D1: 36.71, Bb1: 58.27, C2: 65.41, D2: 73.42, A2: 110, Bb2: 116.54, C3: 130.81, D3: 146.83, F3: 174.61, G3: 196, A3: 220, Bb3: 233.08,
    C4: 261.63, D4: 293.66, E4: 329.63, Fs4: 369.99, G4: 392, A4: 440, D5: 587.33, Fs5: 739.99, A5: 880, D6: 1174.66 };
  const VOLUME = 0.7;
  let ac = null, bus = null, verb = null, noiseBuf = null, muted = false;
  function audio() {
    if (ac) return ac;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ac = new AC();
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4; comp.attack.value = 0.004; comp.release.value = 0.3;
    bus = ac.createGain(); bus.gain.value = VOLUME;
    bus.connect(comp).connect(ac.destination);
    // 콘서트홀 잔향: 짧은 선지연 뒤 3.6초 동안 줄어드는 좌우 독립 잡음
    const len = Math.floor(ac.sampleRate * 3.6), pre = Math.floor(ac.sampleRate * 0.025), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) { const d = ir.getChannelData(c); for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6); }
    verb = ac.createConvolver(); verb.buffer = ir;
    const wet = ac.createGain(); wet.gain.value = 0.55;
    verb.connect(wet).connect(bus);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    return ac;
  }
  const playing = () => ac && ac.state === "running" && !muted;
  function send(node, pan = 0, dry = 1, wet = 1) {
    const p = ac.createStereoPanner(); p.pan.value = pan;
    const d = ac.createGain(); d.gain.value = dry;
    const w = ac.createGain(); w.gain.value = wet;
    node.connect(p); p.connect(d).connect(bus); p.connect(w).connect(verb);
  }
  function adsr(param, at, peak, attack, hold, release) {
    param.setValueAtTime(0.0001, at);
    param.exponentialRampToValueAtTime(peak, at + attack);
    param.setValueAtTime(peak, at + attack + Math.max(0, hold));
    param.exponentialRampToValueAtTime(0.0001, at + attack + Math.max(0, hold) + release);
  }
  function osc(type, fq, at, end) {
    const o = ac.createOscillator(); o.type = type; o.frequency.value = fq;
    o.start(at); o.stop(end);
    return o;
  }
  function noise(at, end) {
    const s = ac.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
    s.start(at); s.stop(end);
    return s;
  }
  // 현악: 음마다 톱니파 세 개를 살짝 어긋나게 겹치고 비브라토를 건다
  function strings(notes, at, attack, hold, release, vol, bright = 2200) {
    const end = at + attack + Math.max(0, hold) + release + 0.1;
    const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = bright; lp.Q.value = 0.4;
    const gn = ac.createGain(); adsr(gn.gain, at, vol, attack, hold, release);
    lp.connect(gn); send(gn, 0, 0.75, 1);
    const vib = osc("sine", 5.3, at, end), depth = ac.createGain(); depth.gain.value = 7; vib.connect(depth);
    notes.forEach((fq, i) => {
      const p = ac.createStereoPanner(); p.pan.value = notes.length > 1 ? (i / (notes.length - 1) - 0.5) * 0.9 : 0;
      const ng = ac.createGain(); ng.gain.value = 0.33 / Math.sqrt(notes.length);
      ng.connect(p).connect(lp);
      for (const cents of [-9, 0, 9]) { const o = osc("sawtooth", fq, at, end); o.detune.value = cents + rand(-2, 2); depth.connect(o.detune); o.connect(ng); }
    });
  }
  // 금관: 필터가 확 열렸다 닫히고 음정이 아래에서 올라붙는 톱니파
  function brass(notes, at, dur, vol, open = 2600, attack = 0.05) {
    const end = at + attack + dur + 0.8;
    notes.forEach((fq, i) => {
      const lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(220, at);
      lp.frequency.exponentialRampToValueAtTime(open, at + attack + 0.04);
      lp.frequency.exponentialRampToValueAtTime(open * 0.55, at + attack + 0.5);
      const gn = ac.createGain(); adsr(gn.gain, at, vol / Math.sqrt(notes.length), attack, dur - attack, 0.6);
      for (const c of [-7, 7]) {
        const o = osc("sawtooth", fq, at, end);
        o.detune.setValueAtTime(c - 40, at); o.detune.linearRampToValueAtTime(c, at + 0.08);
        o.connect(lp);
      }
      lp.connect(gn); send(gn, notes.length > 1 ? (i / (notes.length - 1) - 0.5) * 0.6 : 0, 0.9, 0.7);
    });
  }
  function timpani(fq, at, vol = 0.5, decay = 1.6) {
    const end = at + decay + 0.1;
    const o = osc("sine", fq, at, end);
    o.frequency.setValueAtTime(fq * 1.45, at); o.frequency.exponentialRampToValueAtTime(fq, at + 0.06);
    const g1 = ac.createGain(); adsr(g1.gain, at, vol, 0.004, 0, decay);
    const o2 = osc("sine", fq * 1.51, at, end), g2 = ac.createGain(); adsr(g2.gain, at, vol * 0.3, 0.004, 0, decay * 0.4);
    const n = noise(at, at + 0.2), lp = ac.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 700;
    const g3 = ac.createGain(); adsr(g3.gain, at, vol * 0.5, 0.002, 0, 0.12);
    o.connect(g1); o2.connect(g2); n.connect(lp).connect(g3);
    for (const g of [g1, g2, g3]) send(g, -0.2, 1, 0.6);
  }
  function roll(fq, from, to, v0, v1) {
    for (let t = from; t < to;) {
      const p = (t - from) / (to - from);
      timpani(fq, t, v0 + (v1 - v0) * p * p, 0.3);
      t += 0.08 - 0.035 * p;
    }
  }
  function boom(at, vol = 0.9) {
    const o = osc("sine", 80, at, at + 2.4);
    o.frequency.setValueAtTime(85, at); o.frequency.exponentialRampToValueAtTime(30, at + 0.5);
    const gn = ac.createGain(); adsr(gn.gain, at, vol, 0.003, 0.05, 2.2);
    o.connect(gn); send(gn, 0, 1, 0.4);
  }
  function cymbal(at, vol = 0.25, decay = 3) {
    const n = noise(at, at + decay + 0.1), hp = ac.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 4500;
    const pk = ac.createBiquadFilter(); pk.type = "peaking"; pk.frequency.value = 8000; pk.gain.value = 6;
    const gn = ac.createGain(); adsr(gn.gain, at, vol, 0.003, 0, decay);
    n.connect(hp).connect(pk).connect(gn); send(gn, 0.25, 0.8, 1);
  }
  // 거꾸로 감은 심벌: 섬광 직전까지 차오르다 뚝 끊긴다
  function swell(at, dur, vol) {
    const n = noise(at, at + dur + 0.1), hp = ac.createBiquadFilter(); hp.type = "highpass";
    hp.frequency.setValueAtTime(1500, at); hp.frequency.exponentialRampToValueAtTime(9000, at + dur);
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0.0001, at); gn.gain.exponentialRampToValueAtTime(vol, at + dur); gn.gain.setTargetAtTime(0.0001, at + dur, 0.015);
    n.connect(hp).connect(gn); send(gn, -0.1, 0.9, 0.8);
  }
  function glock(notes, at, step = 0.09, vol = 0.1) {
    notes.forEach((fq, i) => {
      const t = at + i * step;
      const o = osc("sine", fq, t, t + 1.6), g1 = ac.createGain(); adsr(g1.gain, t, vol, 0.002, 0, 1.4);
      const o2 = osc("sine", fq * 2.76, t, t + 0.5), g2 = ac.createGain(); adsr(g2.gain, t, vol * 0.3, 0.002, 0, 0.4);
      o.connect(g1); o2.connect(g2); send(g1, 0.35, 0.8, 1); send(g2, 0.35, 0.8, 1);
    });
  }
  // 쇠를 두드린 듯한 비정수배 배음(제철소 느낌)
  function clang(at, vol = 1) {
    [[196, 0.16, 2.2], [523, 0.09, 1.6], [1047, 0.05, 1.1], [1661, 0.035, 0.8], [2490, 0.02, 0.5]].forEach(([fq, peak, rel]) => {
      const o = osc("sine", fq, at, at + rel + 0.1), gn = ac.createGain(); adsr(gn.gain, at, peak * vol, 0.005, 0, rel);
      o.connect(gn); send(gn, 0.1, 1, 1);
    });
  }

  function overture() {
    const at = ac.currentTime, hit = at + (T.flash - 0.15);
    strings([NOTE.D2, NOTE.D3], at, 2.6, hit - at - 2.6, 0.5, 0.24, 900);
    strings([NOTE.A3, NOTE.D4], at + 1.4, 2.2, hit - at - 3.6, 0.4, 0.13, 1900);
    brass([NOTE.D2, NOTE.A2], at + 2.3, hit - at - 2.3, 0.18, 1100, 1.4);
    roll(NOTE.D2, at + 1.9, hit - 0.05, 0.03, 0.42);
    swell(at + 1.6, hit - at - 1.6, 0.16);
  }
  function impact() {
    const at = ac.currentTime;
    boom(at, 1);
    timpani(NOTE.D2, at, 0.85, 2.2);
    cymbal(at, 0.32, 3.4);
    brass([NOTE.D2, NOTE.A2, NOTE.D3, NOTE.F3, NOTE.A3], at, 1.1, 0.55, 2200);
    strings([NOTE.D2, NOTE.D3, NOTE.A3], at, 0.02, 1.1, 1.2, 0.2, 1400);
    clang(at, 0.8);
  }
  function fanfare() {
    const at = ac.currentTime, b = 0.62, fin = at + b * 2;
    // bVI(B♭) – bVII(C) – I(D 장조): 단조로 쌓다가 장조로 풀리는 영웅풍 종지
    brass([NOTE.Bb2, NOTE.F3, NOTE.Bb3, NOTE.D4], at, b - 0.1, 0.42);
    strings([NOTE.Bb2, NOTE.F3, NOTE.D4], at, 0.06, b - 0.12, 0.3, 0.13, 2000);
    timpani(NOTE.Bb1, at, 0.55);
    brass([NOTE.C3, NOTE.G3, NOTE.C4, NOTE.E4], at + b, b - 0.1, 0.45);
    strings([NOTE.C3, NOTE.G3, NOTE.E4], at + b, 0.06, b - 0.12, 0.3, 0.14, 2200);
    timpani(NOTE.C2, at + b, 0.6);
    brass([NOTE.D3, NOTE.A3, NOTE.D4, NOTE.Fs4, NOTE.A4], fin, 2.4, 0.58, 3000);
    strings([NOTE.D4, NOTE.Fs4, NOTE.A4, NOTE.D5], fin, 0.12, 2.4, 2.4, 0.16, 3400);
    strings([NOTE.D2, NOTE.A2], fin, 0.08, 2.6, 2.2, 0.2, 900);
    timpani(NOTE.D2, fin, 0.8, 2.4);
    boom(fin, 0.75);
    cymbal(fin, 0.28, 3.8);
    glock([NOTE.D5, NOTE.Fs5, NOTE.A5, NOTE.D6], fin + 0.05);
  }
  function confirmSound() {
    const at = ac.currentTime;
    brass([NOTE.D3, NOTE.A3, NOTE.D4, NOTE.Fs4, NOTE.A4], at, 0.28, 0.45, 3200);
    timpani(NOTE.D2, at, 0.6, 1.4);
    boom(at, 0.5);
    cymbal(at, 0.16, 2);
    glock([NOTE.A5, NOTE.D6], at + 0.04, 0.07);
  }
  function unlock() {
    const ctx = audio();
    if (!ctx || ctx.state !== "suspended") return Promise.resolve();
    return ctx.resume().then(syncSoundBtn, () => {});
  }
  function syncSoundBtn() {
    soundBtn.hidden = !ac;
    soundBtn.textContent = !ac || ac.state !== "running" ? "♪ 소리와 함께 보기" : muted ? "♪ 소리 켜기" : "♪ 소리 끄기";
  }
  audio();
  syncSoundBtn();

  // ---- 장면: 바닥 격자, 솟아오르는 강철 기둥, 불티
  function newTower(z, born) {
    let x;
    do { x = rand(-10, 10); } while (Math.abs(x) < 1.4);
    return { x, z, born, h: rand(0.7, 4) * (Math.random() < 0.2 ? 1.7 : 1), w: rand(0.35, 0.95), hot: Math.random() < 0.55, seed: rand(0, 6.28) };
  }
  const towers = Array.from({ length: 34 }, () => newTower(rand(3, FAR), T.towers + rand(0, 1.8)));
  function newEmber(init) {
    return { x: rand(-9, 9), y: init ? rand(0, 5) : rand(-0.3, 0.6), z: rand(1.5, FAR - 4), vy: rand(0.3, 1.1), vx: rand(-0.15, 0.15), life: rand(2.5, 6), age: init ? rand(0, 4) : 0, s: rand(0.5, 1.8), seed: rand(0, 6.28) };
  }
  const embers = Array.from({ length: 170 }, () => newEmber(true));

  let t0 = performance.now(), last = t0, travel = 0, speed = 2.2, done = false, leaving = false, padDown = false;
  const fired = {};
  if (reduceMotion) t0 -= T.press * 1000;

  function cue(t) {
    const once = (key, at, fn) => { if (!fired[key] && t >= at) { fired[key] = true; fn(); } };
    once("overture", 0.15, () => playing() && t < 1 && overture());
    once("impact", T.flash, () => playing() && impact());
    once("show", T.logo, () => root.classList.add("show"));
    once("fanfare", T.logo + 0.1, () => playing() && fanfare());
    once("ready", T.press, () => root.classList.add("ready"));
  }

  function update(dt, t) {
    const target = reduceMotion ? 0 : t < T.flash ? 2.2 : 0.6;
    speed += (target - speed) * Math.min(1, dt * 1.5);
    travel += speed * dt;
    for (const tw of towers) {
      tw.z -= speed * dt;
      if (tw.z < 0.9) Object.assign(tw, newTower(tw.z + FAR, t + rand(0, 0.4)));
    }
    for (const e of embers) {
      e.age += dt; e.y += e.vy * dt; e.x += e.vx * dt + Math.sin(t * 1.3 + e.seed) * 0.12 * dt; e.z -= speed * dt;
      if (e.age > e.life || e.z < 0.6) Object.assign(e, newEmber(false));
    }
  }

  function draw(t) {
    const cx = W / 2, hz = H * 0.6, f = Math.min(W, H) * 1.05;
    const sceneA = ease(clamp((t - 0.7) / 1.6));
    const px = (x, z) => cx + (x / z) * f;
    const py = (y, z) => hz - ((y - CAM_Y) / z) * f;

    g.globalCompositeOperation = "source-over";
    g.fillStyle = "#020306";
    g.fillRect(0, 0, W, H);

    // 지평선의 열기: 섬광 직전까지 달아오르고, 로고가 뜬 뒤에는 천천히 숨쉰다
    const build = ease(clamp((t - T.towers) / (T.flash - T.towers)));
    const heat = sceneA * (t < T.flash ? 0.35 + 0.65 * build : 0.6 + 0.08 * Math.sin(t * 1.4));
    const rg = g.createRadialGradient(cx, hz, 0, cx, hz, Math.max(W, H) * 0.75);
    rg.addColorStop(0, `rgba(255,118,36,${0.24 * heat})`);
    rg.addColorStop(0.3, `rgba(120,46,24,${0.12 * heat})`);
    rg.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = rg;
    g.fillRect(0, 0, W, H);

    // 바닥 격자
    g.lineWidth = 1;
    for (let k = 0; k < 22; k++) {
      const z = 1 + ((((k * 1.7 - travel) % FAR) + FAR) % FAR);
      const a = sceneA * 0.16 * clamp((FAR - z) / 26);
      g.strokeStyle = `rgba(110,150,200,${a})`;
      const y = py(0, z);
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    g.strokeStyle = `rgba(110,150,200,${0.07 * sceneA})`;
    for (let x = -16; x <= 16; x += 2) {
      g.beginPath(); g.moveTo(px(x, 0.8), py(0, 0.8)); g.lineTo(cx, hz); g.stroke();
    }

    // 강철 기둥(먼 것부터)
    towers.sort((a, b) => b.z - a.z);
    for (const tw of towers) {
      const rise = ease(clamp((t - tw.born) / 1.6));
      if (rise <= 0) continue;
      const z = tw.z, a = sceneA * clamp((FAR - z) / 14) * clamp((z - 1.2) / 3.5);
      if (a <= 0.01) continue;
      const x0 = px(tw.x - tw.w / 2, z), x1 = px(tw.x + tw.w / 2, z), w = x1 - x0;
      const yb = py(0, z), yt = py(tw.h * rise, z), h = yb - yt;
      const glow = tw.hot ? 0.65 + 0.35 * Math.sin(t * 2.2 + tw.seed) : 0;

      g.globalCompositeOperation = "source-over";
      const body = g.createLinearGradient(0, yt, 0, yb);
      body.addColorStop(0, tw.hot ? `rgba(255,150,70,${0.5 * a * glow + 0.12 * a})` : `rgba(150,185,225,${0.32 * a})`);
      body.addColorStop(0.25, `rgba(48,66,92,${0.4 * a})`);
      body.addColorStop(1, `rgba(16,24,36,${0.25 * a})`);
      g.fillStyle = body;
      g.fillRect(x0, yt, w, h);
      g.fillStyle = `rgba(190,215,245,${0.28 * a})`;
      g.fillRect(x0, yt, 1, h);
      g.fillRect(x1 - 1, yt, 1, h);

      // 바닥에 비친 그림자
      const refl = g.createLinearGradient(0, yb, 0, yb + h * 0.55);
      refl.addColorStop(0, tw.hot ? `rgba(255,130,50,${0.14 * a * glow})` : `rgba(120,160,210,${0.08 * a})`);
      refl.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = refl;
      g.fillRect(x0, yb, w, h * 0.55);

      // 쇳물처럼 달아오른 꼭대기
      if (tw.hot) {
        g.globalCompositeOperation = "lighter";
        const r = Math.max(6, w * 1.8);
        const cap = g.createRadialGradient(x0 + w / 2, yt, 0, x0 + w / 2, yt, r);
        cap.addColorStop(0, `rgba(255,210,140,${0.55 * a * glow})`);
        cap.addColorStop(0.4, `rgba(255,110,30,${0.25 * a * glow})`);
        cap.addColorStop(1, "rgba(0,0,0,0)");
        g.fillStyle = cap;
        g.fillRect(x0 + w / 2 - r, yt - r, r * 2, r * 2);
        g.fillStyle = `rgba(255,220,170,${0.8 * a * glow})`;
        g.fillRect(x0, yt, w, Math.max(1.5, w * 0.04));
      }
    }

    // 불티
    g.globalCompositeOperation = "lighter";
    for (const e of embers) {
      if (e.z < 0.6) continue;
      const life = e.age / e.life;
      const a = sceneA * Math.sin(Math.PI * clamp(life)) * clamp((FAR - e.z) / 12);
      if (a <= 0.01) continue;
      const x = px(e.x, e.z), y = py(e.y, e.z), r = Math.min(2.6, Math.max(0.6, (e.s * f * 0.018) / e.z));
      const col = life < 0.3 ? "255,232,170" : life < 0.7 ? "255,146,52" : "214,70,34";
      g.fillStyle = `rgba(${col},${a * 0.16})`;
      g.beginPath(); g.arc(x, y, r * 4, 0, 6.283); g.fill();
      g.fillStyle = `rgba(${col},${a})`;
      g.beginPath(); g.arc(x, y, r, 0, 6.283); g.fill();
    }

    // 첫 불씨: 어둠 속에서 깜박이다가 장면으로 퍼진다
    if (t < 1.8) {
      const a = t < 0.8 ? ease(clamp(t / 0.4)) * (0.75 + 0.25 * Math.sin(t * 16)) : 1 - ease(clamp((t - 0.8) / 1));
      const r = 3 + 50 * ease(clamp((t - 0.6) / 1.2));
      const sp = g.createRadialGradient(cx, hz, 0, cx, hz, r * 6);
      sp.addColorStop(0, `rgba(255,236,200,${a})`);
      sp.addColorStop(0.12, `rgba(255,140,50,${0.6 * a})`);
      sp.addColorStop(1, "rgba(0,0,0,0)");
      g.fillStyle = sp;
      g.fillRect(cx - r * 6, hz - r * 6, r * 12, r * 12);
    }

    // 압연판처럼 가로로 뻗는 섬광
    if (t > T.streak && t < T.flash + 0.8) {
      const p = ease(clamp((t - T.streak) / (T.flash - T.streak)));
      const a = t < T.flash ? 1 : 1 - clamp((t - T.flash) / 0.8);
      const half = (W / 2) * p * 1.05;
      for (const [th, al] of [[26, 0.12], [8, 0.35], [2, 1]]) {
        const lg = g.createLinearGradient(cx - half, 0, cx + half, 0);
        lg.addColorStop(0, "rgba(255,120,30,0)");
        lg.addColorStop(0.5, `rgba(255,246,225,${al * a})`);
        lg.addColorStop(1, "rgba(255,120,30,0)");
        g.fillStyle = lg;
        g.fillRect(cx - half, hz - th / 2, half * 2, th);
      }
    }

    g.globalCompositeOperation = "source-over";
    // 흰 섬광
    if (t >= T.flash && t < T.flash + 1) {
      g.fillStyle = `rgba(255,246,232,${0.9 * Math.pow(1 - (t - T.flash), 2)})`;
      g.fillRect(0, 0, W, H);
    }
    // 로고가 뜨면 배경을 조금 눌러 글자를 띄운다
    if (t > T.logo) {
      g.fillStyle = `rgba(2,3,6,${0.38 * ease(clamp((t - T.logo) / 1.5))})`;
      g.fillRect(0, 0, W, H);
    }
  }

  function pollPad() {
    let down = false;
    try {
      for (const pad of navigator.getGamepads?.() || []) if (pad) for (const b of pad.buttons) if (b.pressed) down = true;
    } catch {}
    if (down && !padDown) press();
    padDown = down;
  }

  function frame(now) {
    if (done) return;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const t = (now - t0) / 1000;
    if (!leaving) { cue(t); pollPad(); }
    update(dt, t);
    draw(t);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ---- 입력: 섬광 전에 누르면 로고로 건너뛰고, 로고가 뜬 뒤에 누르면 끝낸다. ESC·건너뛰기는 바로 끝낸다.
  function press() {
    const t = (performance.now() - t0) / 1000;
    if (t < T.flash - 0.05) {
      t0 = performance.now() - (T.flash - 0.55) * 1000;
      fired.overture = true;
      unlock().then(() => playing() && swell(ac.currentTime, 0.5, 0.16));
    } else if (t >= T.logo + 0.6) {
      finish();
    }
  }
  function finish() {
    if (leaving) return;
    leaving = true;
    unlock().then(() => playing() && confirmSound());
    try { sessionStorage.setItem(SEEN_KEY, "1"); } catch {}
    root.classList.add("out");
    removeEventListener("keydown", onKey, true);
    setTimeout(() => {
      done = true;
      removeEventListener("resize", resize);
      root.remove();
      style.remove();
      if (ac) setTimeout(() => ac.close().catch(() => {}), 4000);
      dispatchEvent(new Event("st-intro-end"));
    }, 1000);
  }
  function onKey(e) {
    if (["Shift", "Control", "Alt", "Meta", "CapsLock", "Tab"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === "Escape") finish(); else press();
  }
  addEventListener("keydown", onKey, true);
  root.addEventListener("pointerdown", (e) => { if (!e.target.closest(".sti-btn")) press(); });
  root.querySelector(".sti-skip").addEventListener("click", finish);
  // 막혀 있던 소리를 켜면 오프닝을 처음부터 다시 튼다
  function restart() {
    t0 = performance.now();
    speed = 2.2;
    for (const key of Object.keys(fired)) delete fired[key];
    root.classList.remove("show", "ready");
    for (const tw of towers) tw.born = T.towers + rand(0, 1.8);
  }
  soundBtn.addEventListener("click", () => {
    if (ac && ac.state !== "running") { muted = false; unlock().then(() => playing() && restart()); return; }
    muted = !muted;
    bus.gain.setTargetAtTime(muted ? 0 : VOLUME, ac.currentTime, 0.05);
    syncSoundBtn();
  });
})();

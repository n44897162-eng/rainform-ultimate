/* Rainform Ultimate — procedural rain sound.
   Four layers, all synthesised at runtime: broadband hiss, a mid "sheet of
   rain" band, low storm rumble and individual drop impacts. No audio files.

   The intensity mapping is deliberately steep: a drizzle should be a thin,
   distant hush with sparse high plinks, while a downpour is a close, bright,
   full-spectrum roar with a heavy low end. Roughly 30-40 dB of perceived
   dynamic range between 0.3 and 20 mm/h. */
(function (w) {
  'use strict';

  const A = {
    enabled: false,
    ctx: null,
    ready: false,
    mmh: 0,
    _tickAcc: 0
  };

  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);

  function makeNoise(seconds, brown) {
    const len = Math.round(A.ctx.sampleRate * seconds);
    const buf = A.ctx.createBuffer(1, len, A.ctx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      if (brown) {
        last = (last + 0.02 * white) / 1.02;
        d[i] = Math.max(-1, Math.min(1, last * 3.2));
      } else {
        last = last * 0.35 + white * 0.65;
        d[i] = last * 0.55;
      }
    }
    return buf;
  }

  A.build = function () {
    if (A.ready) {
      if (A.ctx.state === 'suspended') A.ctx.resume();
      return true;
    }
    const AC = w.AudioContext || w.webkitAudioContext;
    if (!AC) return false;
    try {
      A.ctx = new AC();
      const ctx = A.ctx;

      A.master = ctx.createGain();
      A.master.gain.value = 0;
      A.master.connect(ctx.destination);

      /* layer 1 — broadband hiss, the body of the rain ------------------- */
      const hiss = ctx.createBufferSource();
      hiss.buffer = makeNoise(2.5, false);
      hiss.loop = true;
      A.hp = ctx.createBiquadFilter(); A.hp.type = 'highpass'; A.hp.frequency.value = 520; A.hp.Q.value = 0.5;
      A.lp = ctx.createBiquadFilter(); A.lp.type = 'lowpass'; A.lp.frequency.value = 900; A.lp.Q.value = 0.4;
      A.hissGain = ctx.createGain(); A.hissGain.gain.value = 0;

      // slow gusts: only become audible once the rain is heavy
      A.gust = ctx.createGain(); A.gust.gain.value = 1;
      const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.11;
      A.gustDepth = ctx.createGain(); A.gustDepth.gain.value = 0;
      lfo.connect(A.gustDepth); A.gustDepth.connect(A.gust.gain); lfo.start();

      hiss.connect(A.hp); A.hp.connect(A.lp); A.lp.connect(A.hissGain);
      A.hissGain.connect(A.gust); A.gust.connect(A.master);
      hiss.start();

      /* layer 2 — mid "sheet of rain" band, only in real downpours ------- */
      const sheet = ctx.createBufferSource();
      sheet.buffer = makeNoise(2.5, false);
      sheet.loop = true;
      const sbp = ctx.createBiquadFilter(); sbp.type = 'bandpass';
      sbp.frequency.value = 1500; sbp.Q.value = 0.55;
      A.sheetGain = ctx.createGain(); A.sheetGain.gain.value = 0;
      sheet.connect(sbp); sbp.connect(A.sheetGain); A.sheetGain.connect(A.master);
      sheet.start();

      /* layer 3 — distant low rumble, gives the storm its weight --------- */
      const rumble = ctx.createBufferSource();
      rumble.buffer = makeNoise(3, true);
      rumble.loop = true;
      A.rlp = ctx.createBiquadFilter(); A.rlp.type = 'lowpass'; A.rlp.frequency.value = 85;
      A.rumbleGain = ctx.createGain(); A.rumbleGain.gain.value = 0;
      rumble.connect(A.rlp); A.rlp.connect(A.rumbleGain); A.rumbleGain.connect(A.master);
      rumble.start();

      /* layer 4 — individual drop impacts -------------------------------- */
      A.tickBus = ctx.createBiquadFilter();
      A.tickBus.type = 'bandpass'; A.tickBus.frequency.value = 3600; A.tickBus.Q.value = 3.2;
      A.tickBus.connect(A.master);
      const tl = Math.round(ctx.sampleRate * 0.045);
      A.tickBuf = ctx.createBuffer(1, tl, ctx.sampleRate);
      const td = A.tickBuf.getChannelData(0);
      for (let i = 0; i < tl; i++) {
        td[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / tl, 3);
      }

      A.ready = true;
      return true;
    } catch (e) {
      return false;
    }
  };

  A.setEnabled = function (on) {
    A.enabled = !!on;
    if (A.enabled) A.build();
    if (A.ctx && A.ctx.state === 'suspended') A.ctx.resume();
  };

  /* Describe the current mix — also handy for debugging / UI readouts. */
  A.mix = function (mmh) {
    const n = clamp(mmh / 20, 0, 1);
    return {
      n,
      soft: Math.pow(n, 1.7),      // rises slowly at first
      hard: Math.pow(n, 2.3),      // essentially absent until it pours
      bright: Math.pow(n, 0.85)
    };
  };

  A.update = function (dt, mmh) {
    A.mmh = mmh;
    if (!A.ready) return;
    const ctx = A.ctx, now = ctx.currentTime;
    const m = A.mix(mmh);
    const n = m.n, soft = m.soft, hard = m.hard;

    // master climbs ~2.5 dB from drizzle to downpour on top of the layers
    A.master.gain.setTargetAtTime(A.enabled ? 0.62 + 0.38 * n : 0, now, 0.35);
    if (!A.enabled) return;

    // hiss: 0.0035 -> 0.34  (~100x amplitude), lowpass 700 Hz -> 11 kHz
    A.hissGain.gain.setTargetAtTime(0.0035 + 0.335 * soft, now, 0.3);
    A.hp.frequency.setTargetAtTime(560 - 420 * m.bright, now, 0.4);
    A.lp.frequency.setTargetAtTime(700 * Math.pow(16, m.bright), now, 0.4);
    A.gustDepth.gain.setTargetAtTime(0.02 + 0.34 * hard, now, 0.6);

    // mid sheet: boils up only in heavy rain
    A.sheetGain.gain.setTargetAtTime(0.0005 + 0.115 * hard, now, 0.4);

    // rumble: near-silent drizzle, deep chesty storm; 0.0008 -> 0.19
    A.rumbleGain.gain.setTargetAtTime(0.0008 + 0.19 * hard, now, 0.5);
    A.rlp.frequency.setTargetAtTime(80 + 260 * soft, now, 0.5);

    // drop impacts: 1.2/s thin high plinks -> 95/s dense low crackle
    A.tickBus.frequency.setTargetAtTime(3800 - 2900 * m.bright, now, 0.45);
    A.tickBus.Q.setTargetAtTime(3.4 - 2.9 * n, now, 0.45);
    const rate = 1.2 + 94 * soft;
    A._tickAcc += dt * rate;
    let guard = 0;
    while (A._tickAcc >= 1 && guard++ < 8) {
      A._tickAcc -= 1;
      try {
        // drop "size": heavy rain produces more large, low, loud drops
        const size = Math.pow(Math.random(), 1.85 - n * 1.15);
        const s = ctx.createBufferSource();
        s.buffer = A.tickBuf;
        s.playbackRate.value = 2.05 - size * 1.42;
        const g = ctx.createGain();
        g.gain.value = (0.0012 + size * 0.021) * (0.18 + soft * 1.9);
        s.connect(g); g.connect(A.tickBus);
        s.start();
      } catch (e) { /* audio must never break the render loop */ }
    }
    if (A._tickAcc > 6) A._tickAcc = 6;
  };

  w.RainAudio = A;
})(window);

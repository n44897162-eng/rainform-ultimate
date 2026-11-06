/* Rainform Legacy 2D backend
 * -------------------------------------------------------------------------
 * Injected into the Android APK <head>. Activates ONLY when the system WebView
 * has neither WebGL2 nor ANGLE_instanced_arrays (e.g. Chrome <= 86 / software
 * GPU emulators). Instead of showing a "please update" dead end, this backend
 * renders the SAME scene with a weak-perspective 3D projection on Canvas 2D
 * and implements the complete window.Rainform contract, so every feature -
 * 30-degree rotation, chart toggle, Catmull-Rom smoothing, playback, quality
 * tiers, audio, live weather, screenshot, wallpaper and the whole UI - keeps
 * working. Modern devices, Windows and the Web always use the full WebGL2
 * renderer; this file is a no-op for them.
 */
(function () {
  'use strict';
  if (!window.__RAINFORM_NO_WEBGL__) return;

  var $ = function (id) { return document.getElementById(id); };
  var RAD = Math.PI / 180;
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var N = 25, MAX_MM = 20;

  var DEFAULT_DATA = [
    0.6, 0.4, 0.3, 0.5, 0.8, 1.4, 2.2, 3.1, 2.6, 3.8,
    5.2, 7.4, 9.6, 6.8, 4.6, 5.9, 8.8, 12.4, 15.6, 13.2,
    10.1, 7.2, 4.4, 2.5, 1.2
  ];
  var PRESETS = {
    drizzle: [0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1, 1.2, 1.4, 1.6, 1.8, 2, 1.9, 1.7, 1.5, 1.3, 1.1, 0.9, 0.7, 0.6, 0.5, 0.4, 0.3, 0.3, 0.2],
    shower: [1, 2, 4, 7, 11, 15, 18, 16, 12, 8, 5, 3, 2, 2, 4, 8, 14, 19, 17, 12, 7, 4, 2, 1.5, 1],
    storm: [2, 4, 7, 12, 17, 19, 20, 19, 16, 13, 11, 14, 18, 20, 19, 17, 15, 13, 10, 8, 6, 5, 4, 3, 2],
    night: [0.4, 0.3, 0.2, 0.2, 0.4, 0.9, 1.8, 3.2, 5.6, 8.4, 11, 13.6, 15.2, 14.1, 11.4, 8.8, 6.2, 4.1, 2.6, 1.7, 1.2, 0.9, 0.7, 0.5, 0.4]
  };
  var QUALITY = [
    { label: '低', drops: 110, dpr: 1 }, { label: '中', drops: 220, dpr: 1 },
    { label: '高', drops: 360, dpr: 1.25 }, { label: '极致', drops: 520, dpr: 1.5 }
  ];

  var data = DEFAULT_DATA.slice();
  var state = {
    tTheta: 30 * RAD, theta: 30 * RAD, tPhi: 60 * RAD, phi: 60 * RAD, tRadius: 40,
    chartOn: true, smooth: false, smoothAmt: 0.85, panelsHidden: false,
    wallpaper: false, playing: true, t: 12, q: 1, lang: 'zh',
    autoRotate: false, wantShot: false, presetName: 'default', speed: 1, sound: true
  };
  var impactStats = { n: 0, min: 9, max: 0, sum: 0, tiny: 0, big: 0, crowns: 0, jets: 0, beads: 0 };

  var cv, ctx, curveCv, curveCtx, W = 1, H = 1, DPR = 1;
  var drops = [], ripples = [], splashes = [], last = 0, frameCount = 0, fps = 30;
  var drag = null;

  /* -------------------------------------------------------------- helpers */
  function catmull(p0, p1, p2, p3, t) {
    var t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function series() {
    var out = [], i, k, amt = state.smooth ? state.smoothAmt : 0;
    for (i = 0; i < N; i++) {
      var v = data[i];
      if (amt > 0) {
        var a = data[Math.max(0, i - 1)], b = data[i],
            c = data[Math.min(N - 1, i + 1)], d = data[Math.min(N - 1, i + 2)];
        v = lerp(b, catmull(a, b, c, d, 0.5), amt * 0.9);
      }
      out.push(clamp(v, 0, MAX_MM));
    }
    return out;
  }
  function resize() {
    if (!cv) return;
    DPR = clamp(QUALITY[state.q].dpr, 1, 1.5);
    var r = cv.getBoundingClientRect();
    W = Math.max(1, Math.round(r.width || window.innerWidth));
    H = Math.max(1, Math.round(r.height || window.innerHeight));
    /* Software-rendered WebViews cannot blit a multi-megapixel 2D canvas at
       60fps: at 2560x1440 the main thread locks up and CDP stops answering.
       Cap the backing store and let the browser scale it up (aspect is kept
       because we scale the context instead of the drawing coordinates). */
    var cap = 1000 * 720;
    var k = Math.min(1, Math.sqrt(cap / (W * H * DPR * DPR)));
    cv.width = Math.max(1, Math.round(W * DPR * k));
    cv.height = Math.max(1, Math.round(H * DPR * k));
    ctx.setTransform(DPR * k, 0, 0, DPR * k, 0, 0);
    if (curveCv) {
      var cr = curveCv.getBoundingClientRect();
      curveCv.width = Math.max(1, Math.round(Math.min(cr.width, 900) * DPR));
      curveCv.height = Math.max(1, Math.round(Math.min(cr.height, 260) * DPR));
      curveCtx.setTransform(DPR, 0, 0, DPR, 0, 0);
      drawCurve();
    }
    buildDrops();
  }
  function project(x, y, z) {
    var ca = Math.cos(state.theta), sa = Math.sin(state.theta);
    var x1 = x * ca - z * sa, z1 = x * sa + z * ca;
    var tilt = 0.40;
    var y1 = y * Math.cos(tilt) - z1 * Math.sin(tilt);
    var persp = 34 / (34 + z1 + 14);
    return { x: W * 0.5 + x1 * 13.2 * persp, y: H * 0.60 + y1 * 13.2 * persp, p: persp };
  }
  function colorFor(v, alpha) {
    var t = clamp(v / MAX_MM, 0, 1);
    var r = Math.round(90 + t * 70), g = Math.round(180 - t * 40), b = Math.round(235 + t * 20);
    return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
  }

  /* --------------------------------------------------------------- scene */
  function buildDrops() {
    // On oversized viewports keep the per-frame cost bounded.
    var want = Math.min(QUALITY[state.q].drops, W * H > 700000 ? 90 : 520);
    drops.length = 0;
    for (var i = 0; i < want; i++) {
      var v = data[i % N] / MAX_MM;
      drops.push({
        x: (i % N - 12) * 1.55 + (Math.random() - 0.5) * 1.7,
        z: (Math.random() - 0.5) * 5.6,
        y: Math.random() * (2 + v * 11),
        len: 0.35 + Math.random() * 0.7,
        speed: 5 + Math.random() * 7,
        a: 0.16 + Math.random() * 0.45
      });
    }
  }
  function spawnImpact(d) {
    var p = project(d.x, 0, d.z);
    var power = clamp(data[clamp(Math.round(d.x / 1.55) + 12, 0, N - 1)] / MAX_MM, 0.08, 1);
    impactStats.n++; impactStats.sum += power;
    impactStats.min = Math.min(impactStats.min, power);
    impactStats.max = Math.max(impactStats.max, power);
    if (power < 0.35) impactStats.tiny++; else if (power > 0.75) { impactStats.big++; impactStats.crowns++; }
    if (ripples.length < 46) ripples.push({ x: d.x, z: d.z, r: 0, life: 1, power: power });
    if (splashes.length < 34 && Math.random() < 0.42) {
      splashes.push({ x: d.x, z: d.z, life: 1, power: power, beads: 3 + Math.round(power * 9) });
      if (power > 0.7) impactStats.jets++;
      impactStats.beads += 3 + Math.round(power * 9);
    }
  }
  function drawBackground() {
    var g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#050c16'); g.addColorStop(0.52, '#0a1c30');
    g.addColorStop(0.72, '#102b46'); g.addColorStop(1, '#071625');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    // distant fog / light pool on the water
    var pool = ctx.createRadialGradient(W * 0.5, H * 0.74, 4, W * 0.5, H * 0.74, W * 0.62);
    pool.addColorStop(0, 'rgba(85,170,240,0.26)');
    pool.addColorStop(0.5, 'rgba(45,110,175,0.11)');
    pool.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = pool; ctx.fillRect(0, H * 0.55, W, H * 0.45);
    ctx.strokeStyle = 'rgba(120,190,240,0.10)'; ctx.lineWidth = 1;
    for (var i = 0; i < 7; i++) {
      var yy = H * (0.66 + i * 0.048);
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
  }
  function drawRipples() {
    for (var i = ripples.length - 1; i >= 0; i--) {
      var r = ripples[i];
      var p = project(r.x, 0, r.z);
      var rad = (2 + r.r * 26) * p.p * (0.6 + r.power);
      ctx.strokeStyle = 'rgba(150,215,255,' + (0.30 * r.life * (0.4 + r.power)) + ')';
      ctx.lineWidth = 1.1;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, rad, rad * 0.30, 0, 0, Math.PI * 2); ctx.stroke();
      if (r.power > 0.7) {
        ctx.strokeStyle = 'rgba(190,235,255,' + (0.16 * r.life) + ')';
        ctx.beginPath(); ctx.ellipse(p.x, p.y, rad * 0.55, rad * 0.17, 0, 0, Math.PI * 2); ctx.stroke();
      }
      r.r += 0.026; r.life -= 0.018;
      if (r.life <= 0) ripples.splice(i, 1);
    }
  }
  function drawSplashes() {
    for (var i = splashes.length - 1; i >= 0; i--) {
      var s = splashes[i], p = project(s.x, 0, s.z);
      var t = 1 - s.life, h = (3 + 17 * s.power) * p.p;
      // crown
      ctx.strokeStyle = 'rgba(175,225,255,' + (0.55 * s.life) + ')';
      ctx.lineWidth = 1 + s.power;
      ctx.beginPath();
      for (var k = 0; k <= 8; k++) {
        var ang = Math.PI + (k / 8) * Math.PI;
        var rx = p.x + Math.cos(ang) * (2 + 9 * s.power * t) * p.p;
        var ry = p.y + Math.sin(ang) * h * t - h * 0.15;
        k ? ctx.lineTo(rx, ry) : ctx.moveTo(rx, ry);
      }
      ctx.stroke();
      // ballistic beads
      for (var b = 0; b < s.beads; b++) {
        var a = (b / s.beads) * Math.PI * 2 + s.x;
        var spread = (2 + 13 * s.power * t) * p.p;
        var bx = p.x + Math.cos(a) * spread;
        var by = p.y - h * (0.6 + 0.7 * Math.sin(b * 2.3)) * (1 - t * 0.8) + t * t * 8 * p.p;
        ctx.fillStyle = 'rgba(200,238,255,' + (0.75 * s.life) + ')';
        ctx.beginPath(); ctx.arc(bx, by, Math.max(0.6, (0.8 + s.power) * p.p), 0, Math.PI * 2); ctx.fill();
      }
      // Worthington jet for large drops
      if (s.power > 0.7 && t < 0.6) {
        ctx.strokeStyle = 'rgba(215,245,255,' + (0.6 * s.life) + ')';
        ctx.lineWidth = 1.4 * s.power;
        ctx.beginPath(); ctx.moveTo(p.x, p.y);
        ctx.lineTo(p.x, p.y - h * (1.5 - t)); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y - h * (1.5 - t), 1.6 * p.p, 0, Math.PI * 2); ctx.fill();
      }
      s.life -= 0.045;
      if (s.life <= 0) splashes.splice(i, 1);
    }
  }
  function drawChart(vals) {
    if (!state.chartOn) return;
    var i, pts = [];
    for (i = 0; i < N; i++) pts.push(project((i - 12) * 1.55, -vals[i] * 0.62, 0));
    // columns
    for (i = 0; i < N; i++) {
      var base = project((i - 12) * 1.55, 0, 0);
      var top = pts[i];
      var w = Math.max(1.5, 4.6 * top.p);
      var g = ctx.createLinearGradient(0, top.y, 0, base.y);
      g.addColorStop(0, colorFor(vals[i], 0.62));
      g.addColorStop(1, 'rgba(30,90,150,0.06)');
      ctx.fillStyle = g;
      ctx.fillRect(top.x - w / 2, top.y, w, base.y - top.y);
      ctx.strokeStyle = colorFor(vals[i], 0.85); ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(top.x - w / 2, top.y); ctx.lineTo(top.x + w / 2, top.y); ctx.stroke();
    }
    // glow polyline / smoothed curve
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(120,200,255,0.16)'; ctx.lineWidth = 7;
    strokePath(pts, vals); ctx.stroke();
    ctx.strokeStyle = 'rgba(190,235,255,0.92)'; ctx.lineWidth = 1.8;
    strokePath(pts, vals); ctx.stroke();
    // points
    for (i = 0; i < N; i++) {
      ctx.fillStyle = '#dff3ff';
      ctx.beginPath(); ctx.arc(pts[i].x, pts[i].y, Math.max(1.4, 2.1 * pts[i].p), 0, Math.PI * 2); ctx.fill();
    }
    // ground axis
    var a = project(-12 * 1.55, 0, 0), b = project(12 * 1.55, 0, 0);
    ctx.strokeStyle = 'rgba(140,200,240,0.22)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
    // current-hour marker
    var mi = clamp(Math.round(state.t), 0, 24);
    var m = project((mi - 12) * 1.55, 0, 0);
    ctx.strokeStyle = 'rgba(255,220,150,0.65)';
    ctx.beginPath(); ctx.moveTo(m.x, m.y + 6); ctx.lineTo(m.x, m.y - 16); ctx.stroke();
  }
  function strokePath(pts, vals) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (!state.smooth) {
      for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    } else {
      for (var j = 0; j < pts.length - 1; j++) {
        var p0 = pts[Math.max(0, j - 1)], p1 = pts[j], p2 = pts[j + 1], p3 = pts[Math.min(pts.length - 1, j + 2)];
        for (var s = 1; s <= 8; s++) {
          var t = s / 8;
          ctx.lineTo(catmull(p0.x, p1.x, p2.x, p3.x, t), catmull(p0.y, p1.y, p2.y, p3.y, t));
        }
      }
    }
  }
  /* Screen-space foreground rain. The portrait layout covers most of the 3D
     field with translucent glass panels, so a light full-height curtain keeps
     the "it is raining" reading even where the projected columns are hidden. */
  function drawForeRain() {
    var n = Math.max(28, Math.min(74, Math.round(W / 5)));
    ctx.lineWidth = 1;
    for (var i = 0; i < n; i++) {
      var s = (i * 0.6180339887) % 1;
      var x = ((s * (W + 60) + frameCount * (1.1 + (i % 5) * 0.35)) % (W + 60)) - 30;
      var y = ((s * (H + 90) * 1.7 + frameCount * (9 + (i % 7) * 1.6)) % (H + 90)) - 45;
      var len = 10 + (i % 6) * 4;
      ctx.strokeStyle = 'rgba(158,208,246,' + (0.05 + (i % 4) * 0.022) + ')';
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - 2, y + len); ctx.stroke();
    }
  }
  function drawRain(dt, vals) {
    var i, d, p1, p2;
    ctx.lineCap = 'round';
    for (i = 0; i < drops.length; i++) {
      d = drops[i];
      d.y -= d.speed * dt;
      if (d.y <= 0) {
        spawnImpact(d);
        var vi = clamp(Math.round(d.x / 1.55) + 12, 0, N - 1);
        d.y = 2 + (vals[vi] / MAX_MM) * 11 + Math.random() * 2;
        d.x = (Math.random() * 24 - 12) * 1.55;
        d.z = (Math.random() - 0.5) * 5.6;
      }
      p1 = project(d.x, d.y, d.z);
      p2 = project(d.x, d.y + d.len, d.z);
      ctx.strokeStyle = 'rgba(175,220,255,' + d.a + ')';
      ctx.lineWidth = Math.max(0.6, 1.1 * p1.p);
      ctx.beginPath(); ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y); ctx.stroke();
    }
  }
  function drawCurve() {
    if (!curveCtx) return;
    var w = curveCv.width / DPR, h = curveCv.height / DPR;
    curveCtx.clearRect(0, 0, w, h);
    if (!state.chartOn) return;
    var vals = series(), i;
    curveCtx.strokeStyle = 'rgba(143,214,255,0.10)'; curveCtx.lineWidth = 1;
    for (i = 0; i <= 4; i++) {
      var yy = (h - 6) * i / 4 + 3;
      curveCtx.beginPath(); curveCtx.moveTo(0, yy); curveCtx.lineTo(w, yy); curveCtx.stroke();
    }
    curveCtx.fillStyle = 'rgba(80,160,220,0.22)';
    for (i = 0; i < N; i++) {
      var bh = Math.max(1, (vals[i] / MAX_MM) * (h - 10));
      curveCtx.fillRect(i * (w / N) + 1, h - bh - 2, Math.max(1, w / N - 2), bh);
    }
    curveCtx.strokeStyle = 'rgba(190,235,255,0.95)'; curveCtx.lineWidth = 1.6;
    curveCtx.beginPath();
    for (i = 0; i < N; i++) {
      var x = (i + 0.5) * (w / N), y = h - 3 - (vals[i] / MAX_MM) * (h - 10);
      i ? curveCtx.lineTo(x, y) : curveCtx.moveTo(x, y);
    }
    curveCtx.stroke();
  }

  /* -------------------------------------------------------------- UI text */
  function txt(id, v) { var e = $(id); if (e) e.textContent = v; }
  function syncUI() {
    var zh = state.lang === 'zh';
    txt('yawValue', Math.round(((state.theta / RAD % 360) + 360) % 360) + '°');
    txt('pitchValue', Math.round(state.phi / RAD) + '°');
    txt('qualityValue', QUALITY[state.q].label);
    txt('qualityHint', QUALITY[state.q].label);
    txt('curveMode', state.smooth ? (zh ? '平滑' : 'SMOOTH') : (zh ? '折线' : 'LINEAR'));
    txt('smoothPct', Math.round(state.smoothAmt * 100) + '%');
    txt('timeValue', (Math.floor(state.t) < 10 ? '0' : '') + Math.floor(state.t) + ':00');
    var cur = data[clamp(Math.round(state.t), 0, 24)] || 0;
    txt('rainValue', cur.toFixed(1));
    txt('levelValue', zh ? (cur < 1 ? '小雨' : cur < 6 ? '中雨' : cur < 12 ? '大雨' : '暴雨')
      : (cur < 1 ? 'Light' : cur < 6 ? 'Moderate' : cur < 12 ? 'Heavy' : 'Storm'));
    txt('dropValue', String(QUALITY[state.q].drops));
    txt('fpsValue', String(Math.round(fps)));
    var bar = $('rainBar'); if (bar) bar.style.width = clamp(cur / MAX_MM * 100, 0, 100) + '%';
    txt('curveBtn', state.chartOn ? (zh ? '隐藏图表' : 'Hide chart') : (zh ? '显示图表' : 'Show chart'));
    txt('smoothBtn', state.smooth ? (zh ? '平滑 ✓' : 'Smooth ✓') : (zh ? '平滑拟合' : 'Smooth fit'));
    txt('playIcon', state.playing ? '❚❚' : '▶');
    txt('miniPlayIcon', state.playing ? '❚❚' : '▶');
    txt('playLabel', state.playing ? (zh ? '暂停' : 'Pause') : (zh ? '播放' : 'Play'));
    txt('langBtn', zh ? 'EN' : '中');
    var cb = $('curveBtn'), sb = $('smoothBtn'), mc = $('miniChart');
    if (cb) { cb.classList.toggle('active', state.chartOn); cb.setAttribute('aria-pressed', String(state.chartOn)); }
    if (sb) { sb.classList.toggle('active', state.smooth); sb.setAttribute('aria-pressed', String(state.smooth)); }
    if (mc) mc.classList.toggle('active', state.chartOn);
    var sr = $('smoothRange'); if (sr) sr.value = Math.round(state.smoothAmt * 100);
    document.querySelectorAll('#qualityBtns button').forEach(function (b, i) { b.classList.toggle('active', i === state.q); });
    var app = $('app');
    if (app) { app.classList.toggle('chart-off', !state.chartOn); app.classList.toggle('panels-hidden', state.panelsHidden); app.classList.toggle('wallpaper', state.wallpaper); }
    var fab = $('fabToggle'); if (fab) fab.setAttribute('aria-pressed', String(state.panelsHidden));
  }
  function applyLang() {
    document.querySelectorAll('[data-zh]').forEach(function (el) {
      var v = state.lang === 'zh' ? el.dataset.zh : el.dataset.en;
      if (v) el.textContent = v;
    });
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
    syncUI();
  }
  function toast(msg) {
    var t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    setTimeout(function () { t.classList.remove('on'); }, 2200);
  }

  /* ------------------------------------------------------------- contract */
  var API = {
    state: state,
    impactStats: impactStats,
    update: function (values) {
      if (!Array.isArray(values) || values.length !== N) return;
      data = values.map(function (v) { return clamp(+v || 0, 0, MAX_MM); });
      buildDrops(); drawCurve();
    },
    rotate: function (deg) { state.tTheta += deg * RAD; },
    setQuality: function (q, silent) {
      state.q = clamp(q | 0, 0, 3); resize(); buildDrops(); syncUI();
      if (!silent) toast((state.lang === 'zh' ? '画质：' : 'Quality: ') + QUALITY[state.q].label);
    },
    setChart: function (on) { state.chartOn = !!on; syncUI(); drawCurve(); },
    setSmooth: function (on, amt, silent) {
      state.smooth = !!on;
      if (typeof amt === 'number') state.smoothAmt = clamp(amt, 0, 1);
      syncUI(); drawCurve();
      if (!silent) toast(state.lang === 'zh' ? (state.smooth ? '已拟合为平滑曲线' : '已恢复折线') : (state.smooth ? 'Smooth curve' : 'Polyline'));
    },
    setPanels: function (hidden) { state.panelsHidden = !!hidden; syncUI(); },
    setTime: function (t) { state.t = clamp(+t || 0, 0, 24); syncUI(); },
    audioMix: function (mmh) {
      return window.RainAudio && window.RainAudio.mix ? window.RainAudio.mix(mmh) : { volume: clamp(mmh / 20, 0, 1) };
    },
    snapshot: function () {
      state.wantShot = true;
      try {
        var a = document.createElement('a');
        a.download = 'rainform-' + Date.now() + '.png';
        a.href = cv.toDataURL('image/png'); a.click();
      } catch (e) {}
    }
  };

  /* ------------------------------------------------------------- bindings */
  function on(id, fn) { var e = $(id); if (e) e.addEventListener('click', fn); }
  function bindUI() {
    on('rotateBtn', function () { API.rotate(30); });
    on('rotateBack', function () { API.rotate(-30); });
    on('miniRotate', function () { API.rotate(30); });
    on('resetView', function () { state.tTheta = 30 * RAD; state.tPhi = 60 * RAD; });
    on('autoRotate', function () { state.autoRotate = !state.autoRotate; });
    on('curveBtn', function () { API.setChart(!state.chartOn); });
    on('miniChart', function () { API.setChart(!state.chartOn); });
    on('smoothBtn', function () { API.setSmooth(!state.smooth); });
    var sr = $('smoothRange');
    if (sr) sr.addEventListener('input', function () { API.setSmooth(state.smooth, (+sr.value || 0) / 100, true); syncUI(); });
    on('playBtn', function () { state.playing = !state.playing; syncUI(); });
    on('miniPlay', function () { state.playing = !state.playing; syncUI(); });
    on('speedBtn', function () { state.speed = state.speed >= 2 ? 0.5 : state.speed * 2; toast('×' + state.speed); });
    on('resetData', function () { API.update(DEFAULT_DATA.slice()); toast(state.lang === 'zh' ? '已恢复示例数据' : 'Demo data restored'); });
    on('langBtn', function () { state.lang = state.lang === 'zh' ? 'en' : 'zh'; applyLang(); });
    on('wallpaperBtn', function () { state.wallpaper = !state.wallpaper; syncUI(); });
    on('shotBtn', function () { API.snapshot(); });
    on('soundToggle', function () { state.sound = !state.sound; });
    on('panelToggle', function () { API.setPanels(!state.panelsHidden); });
    on('fabToggle', function () { API.setPanels(!state.panelsHidden); });
    on('miniShow', function () { API.setPanels(!state.panelsHidden); });
    document.querySelectorAll('#qualityBtns button').forEach(function (b, i) {
      b.addEventListener('click', function () { API.setQuality(i); });
    });
    document.querySelectorAll('#presetBtns button').forEach(function (b) {
      b.addEventListener('click', function () {
        var p = b.dataset.p;
        if (p === 'random') {
          var v = 1 + Math.random() * 3, arr = [];
          for (var i = 0; i < N; i++) { v = clamp(v + (Math.random() - 0.5) * 4.2, 0.1, 19.5); arr.push(Math.round(v * 10) / 10); }
          API.update(arr);
        } else if (PRESETS[p]) API.update(PRESETS[p].slice());
        state.presetName = p;
        document.querySelectorAll('#presetBtns button').forEach(function (x) { x.classList.toggle('on', x === b); });
      });
    });
    var track = $('timeTrack');
    if (track) track.addEventListener('pointerdown', function (e) {
      var r = track.getBoundingClientRect();
      API.setTime(clamp((e.clientX - r.left) / r.width, 0, 1) * 24);
    });
    cv.addEventListener('pointerdown', function (e) { drag = { x: e.clientX, y: e.clientY, t: state.tTheta }; });
    window.addEventListener('pointermove', function (e) {
      if (!drag) return;
      state.tTheta = drag.t - (e.clientX - drag.x) * 0.0052;
    });
    window.addEventListener('pointerup', function () { drag = null; });
    document.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === 'ArrowRight') { API.rotate(30); e.preventDefault(); }
      else if (k === 'ArrowLeft') { API.rotate(-30); e.preventDefault(); }
      else if (k === 'c' || k === 'C') API.setChart(!state.chartOn);
      else if (k === 's' || k === 'S') API.setSmooth(!state.smooth);
      else if (k === 'h' || k === 'H') API.setPanels(!state.panelsHidden);
      else if (k === 'w' || k === 'W' || k === 'Escape') { state.wallpaper = false; syncUI(); }
      else if (k === 'd' || k === 'D') { var b = $('weatherOpen'); if (b) b.click(); }
    });
    window.addEventListener('resize', resize);
  }

  /* ------------------------------------------------------------ main loop */
  var lastRender = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    /* Hard 25fps cap: on a software GPU an uncapped 2D loop can starve the
       main thread so badly that even CDP Runtime.evaluate times out. */
    if (now - lastRender < 40) return;
    lastRender = now;
    var dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    frameCount++;
    if (frameCount % 20 === 0) fps = lerp(fps, 1 / Math.max(dt, 0.001), 0.2);
    if (state.autoRotate) state.tTheta += dt * 0.09;
    state.theta += (state.tTheta - state.theta) * Math.min(1, dt * 5);
    state.phi += (state.tPhi - state.phi) * Math.min(1, dt * 5);
    if (state.playing) { state.t += dt * state.speed * 0.35; if (state.t > 24) state.t = 0; }
    var vals = series();
    drawBackground();
    drawForeRain();
    drawRipples();
    drawChart(vals);
    drawRain(dt, vals);
    drawSplashes();
    if (frameCount % 8 === 0) { syncUI(); drawCurve(); }
    if (state.wantShot) state.wantShot = false;
    window.__RAINFORM_LEGACY_STATS__ = {
      frames: frameCount, drops: drops.length,
      ripples: ripples.length, splashes: splashes.length
    };
  }

  /* ----------------------------------------------------------------- boot */
  function boot() {
    cv = $('scene');
    if (!cv) return;
    try { ctx = cv.getContext('2d'); } catch (e) {}
    if (!ctx) return;
    curveCv = $('curve');
    if (curveCv) { try { curveCtx = curveCv.getContext('2d'); } catch (e) {} }
    var err = $('webglError'); if (err) err.classList.remove('on');
    var loader = $('loader'); if (loader) loader.classList.add('done');
    document.body.classList.remove('compat-only');
    window.Rainform = API;
    window.__RAINFORM_LEGACY__ = 'canvas2d-v1';
    window.__RAINFORM_LEGACY_STATS__ = { frames: 0, drops: 0, ripples: 0, splashes: 0 };
    bindUI();
    resize(); buildDrops(); applyLang(); syncUI(); drawCurve();
    if (window.RainWeather && window.RainWeather.on) {
      RainWeather.on('frame', function (f) { if (f && f.values) API.update(f.values); });
      try {
        var s = RainWeather.getState();
        if (s && s.lastFrame && s.lastFrame.values) API.update(s.lastFrame.values);
      } catch (e) {}
    }
    last = performance.now();
    requestAnimationFrame(frame);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();

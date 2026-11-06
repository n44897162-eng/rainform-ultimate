/* Rainform Ultimate — main program
   Independent WebGL implementation. Everything procedural, no network assets. */
(function () {
  'use strict';

  const TH = window.THREE;
  const SH = window.RAIN_SH;
  const RA = window.RainAudio;
  const $ = id => document.getElementById(id);
  const app = $('app');
  const RAD = Math.PI / 180;
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const fract = x => x - Math.floor(x);

  if (!TH || !SH || window.__RAINFORM_NO_WEBGL__) { $('webglError').classList.add('on'); $('loader').classList.add('done'); return; }

  /* ------------------------------------------------------------------ config */
  const CFG = {
    hourSpacing: 1.55,
    clusterWidth: 2.35,
    clusterDepth: 5.6,
    baseColumnHeight: 1.6,
    heightPerMm: 0.88,
    fadeNear: 42,
    fadeFar: 92,
    HD: 3.1
  };
  const QUALITY = [
    { label: '低',   drops: 900,  ripple: 110, splash: 70,  jet: 24,  impact: 200, droplet: 520,  dpr: 1.0, bloom: 0.55, blurScale: 4 },
    { label: '中',   drops: 1900, ripple: 190, splash: 120, jet: 40,  impact: 340, droplet: 900,  dpr: 1.25, bloom: 0.75, blurScale: 3 },
    { label: '高',   drops: 3400, ripple: 300, splash: 200, jet: 70,  impact: 560, droplet: 1500, dpr: 1.6, bloom: 0.9, blurScale: 2 },
    { label: '极致', drops: 5200, ripple: 420, splash: 300, jet: 110, impact: 820, droplet: 2200, dpr: 2.0, bloom: 1.05, blurScale: 2 }
  ];
  const DEFAULT_DATA = [
    0.6, 0.4, 0.3, 0.5, 0.8, 1.4, 2.2, 3.1, 2.6, 3.8,
    5.2, 7.4, 9.6, 6.8, 4.6, 5.9, 8.8, 12.4, 15.6, 13.2,
    10.1, 7.2, 4.4, 2.5, 1.2
  ];
  const PRESETS = {
    drizzle: [0.3,0.2,0.2,0.3,0.4,0.6,0.9,1.2,1.4,1.1,1.6,2.1,2.6,2.2,1.8,2.0,2.4,2.8,3.1,2.6,2.1,1.7,1.2,0.8,0.5],
    shower:  [1.2,0.9,0.7,0.8,1.6,3.2,6.4,9.8,5.2,2.4,1.8,3.6,8.2,12.6,6.4,2.8,1.4,4.2,10.8,14.2,7.6,3.4,2.1,1.6,1.2],
    storm:   [2.4,2.8,3.6,4.2,5.8,7.6,9.4,11.2,13.8,16.4,18.2,19.6,17.8,15.2,13.6,14.8,16.9,18.4,19.8,17.2,13.4,9.8,6.4,4.2,3.1],
    random:  null
  };
  let data = DEFAULT_DATA.slice();
  const N = 25, HOURS = 24, MAX_MM = 20;

  const state = {
    t: 18, playing: true, speedIdx: 1, speeds: [0.5, 1, 2],
    q: 2, lang: 'zh', panelsHidden: false, wallpaper: false,
    autoRotate: false, sound: false,
    theta: 30 * RAD, phi: 60 * RAD, radius: 40,
    tTheta: 30 * RAD, tPhi: 60 * RAD, tRadius: 40,
    hoverIdx: -1, dragCurve: -1,
    water: 0.42, dropAcc: 0,
    elapsed: 0, frames: 0, fpsTime: 0, fps: 60, wantShot: false,
    presetName: '', chartOn: true, smooth: false, smoothAmt: 0.85
  };

  const hourX = h => (h - 12) * CFG.hourSpacing;
  const heightOf = mmh => CFG.baseColumnHeight + mmh * CFG.heightPerMm;

  /* A Catmull-Rom spline through the 25 hourly samples turns the angular
     polyline into a C1-continuous curve. smoothAmt blends between the raw
     linear polyline (0) and the fitted spline (1), so the fit is gradual.
     A 1201-entry LUT keeps the ~260k strand updates cheap while dragging. */
  const LUT_N = 1200;
  const curveLUT = new Float32Array(LUT_N + 1);
  function catmull(p0, p1, p2, p3, t) {
    const t2 = t * t, t3 = t2 * t;
    return 0.5 * ((2 * p1) + (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3);
  }
  function computeValueAt(h) {
    const x = clamp(h, 0, 24), i = Math.floor(x), f = x - i;
    if (i >= 24) return data[24];
    const linear = data[i] * (1 - f) + data[i + 1] * f;
    if (!state.smooth || state.smoothAmt <= 0) return linear;
    const p0 = data[Math.max(i - 1, 0)], p1 = data[i];
    const p2 = data[i + 1], p3 = data[Math.min(i + 2, 24)];
    const spline = clamp(catmull(p0, p1, p2, p3, f), 0, MAX_MM);
    return clamp(lerp(linear, spline, state.smoothAmt), 0, MAX_MM);
  }
  function rebuildLUT() {
    for (let i = 0; i <= LUT_N; i++) curveLUT[i] = computeValueAt(i * 24 / LUT_N);
  }
  function valueAt(h) {
    const x = clamp(h, 0, 24) * (LUT_N / 24);
    const i = Math.floor(x), f = x - i;
    if (i >= LUT_N) return curveLUT[LUT_N];
    return curveLUT[i] * (1 - f) + curveLUT[i + 1] * f;
  }
  rebuildLUT();
  function fmtTime(t) {
    const h = Math.floor(Math.min(t, 23.999));
    const m = Math.floor((t - h) * 60);
    return String(h).padStart(2, '0') + ':' + String(m).padStart(2, '0');
  }
  function levelName(v) {
    if (state.lang === 'en') {
      if (v < 0.5) return 'MIST'; if (v < 2.5) return 'LIGHT';
      if (v < 8) return 'MODERATE'; if (v < 16) return 'HEAVY'; return 'TORRENTIAL';
    }
    if (v < 0.5) return '微量'; if (v < 2.5) return '小雨';
    if (v < 8) return '中雨'; if (v < 16) return '大雨'; return '暴雨';
  }

  /* -------------------------------------------------------------- renderer */
  const canvas = $('scene');
  let renderer;
  try {
    renderer = new TH.WebGLRenderer({
      canvas, antialias: false, alpha: false,
      powerPreference: 'high-performance', preserveDrawingBuffer: true
    });
  } catch (e) {
    $('webglError').classList.add('on'); $('loader').classList.add('done'); return;
  }
  renderer.setClearColor(0x02060c, 1);
  renderer.outputEncoding = TH.LinearEncoding;
  renderer.toneMapping = TH.NoToneMapping;
  renderer.autoClear = true;

  const scene = new TH.Scene();
  scene.background = new TH.Color(0x02060c);
  scene.fog = new TH.FogExp2(0x02060c, 0.0075);
  const camera = new TH.PerspectiveCamera(46, 1, 0.1, 240);
  const camTarget = new TH.Vector3(0, 5.0, 0);

  const U = {
    uTime: { value: 0 },
    uSelected: { value: 18 },
    uBaseHeight: { value: CFG.baseColumnHeight },
    uHeightPerMm: { value: CFG.heightPerMm },
    uClusterWidth: { value: CFG.clusterWidth },
    uHourSpacing: { value: CFG.hourSpacing },
    uFadeNear: { value: CFG.fadeNear },
    uFadeFar: { value: CFG.fadeFar },
    uWind: { value: 1 },
    uGain: { value: 1 },
    uReflectAmount: { value: 0.19 }
  };
  const waterU = { value: 0.42 };
  const rainU = { value: 0.5 };

  /* ------------------------------------------------------------ rain strands */
  let rainGeo = null, rainMesh = null, reflMesh = null, rainMat = null, reflMat = null;
  function blended(hh, x) {
    const h = hh + (x - hourX(hh)) / CFG.hourSpacing;
    return valueAt(h);
  }
  function makeRainMat(reflection) {
    return new TH.ShaderMaterial({
      uniforms: Object.assign({}, U, {
        uReflection: { value: reflection ? 1 : 0 },
        uReflectAmount: U.uReflectAmount
      }),
      vertexShader: SH.RAIN_VERT,
      fragmentShader: SH.RAIN_FRAG,
      transparent: true, depthWrite: false, blending: TH.AdditiveBlending
    });
  }
  function buildRain() {
    if (rainGeo) {
      scene.remove(rainMesh, reflMesh);
      rainGeo.dispose(); rainMat.dispose(); reflMat.dispose();
    }
    const dph = QUALITY[state.q].drops;
    const total = dph * N;
    const pos = new Float32Array(total * 2 * 3);
    const rnd = new Float32Array(total * 2 * 4);
    const tail = new Float32Array(total * 2);
    const hour = new Float32Array(total * 2);
    const inten = new Float32Array(total * 2);
    let v = 0;
    for (let h = 0; h < N; h++) {
      for (let j = 0; j < dph; j++) {
        const x = hourX(h) + (Math.random() - 0.5) * CFG.clusterWidth;
        const y = Math.random();
        const z = (Math.random() - 0.5) * CFG.clusterDepth;
        const r0 = Math.random(), r1 = Math.random(), r2 = Math.random(), r3 = Math.random();
        const iv = blended(h, x);
        for (let e = 0; e < 2; e++, v++) {
          pos[v * 3] = x; pos[v * 3 + 1] = y; pos[v * 3 + 2] = z;
          rnd[v * 4] = r0; rnd[v * 4 + 1] = r1; rnd[v * 4 + 2] = r2; rnd[v * 4 + 3] = r3;
          tail[v] = e; hour[v] = h; inten[v] = iv;
        }
      }
    }
    rainGeo = new TH.BufferGeometry();
    rainGeo.setAttribute('position', new TH.BufferAttribute(pos, 3));
    rainGeo.setAttribute('aRandom', new TH.BufferAttribute(rnd, 4));
    rainGeo.setAttribute('aTail', new TH.BufferAttribute(tail, 1));
    rainGeo.setAttribute('aHour', new TH.BufferAttribute(hour, 1));
    rainGeo.setAttribute('aIntensity', new TH.BufferAttribute(inten, 1));
    rainMat = makeRainMat(false);
    reflMat = makeRainMat(true);
    reflMesh = new TH.LineSegments(rainGeo, reflMat);
    reflMesh.frustumCulled = false; reflMesh.renderOrder = 1;
    rainMesh = new TH.LineSegments(rainGeo, rainMat);
    rainMesh.frustumCulled = false; rainMesh.renderOrder = 3;
    scene.add(reflMesh, rainMesh);
    $('dropValue').textContent = (total / 1000).toFixed(1) + 'k';
  }
  function updateRainData() {
    rebuildLUT();
    if (!rainGeo) return;
    const pos = rainGeo.getAttribute('position');
    const hrs = rainGeo.getAttribute('aHour');
    const it = rainGeo.getAttribute('aIntensity');
    for (let i = 0; i < pos.count; i++) it.array[i] = blended(hrs.array[i], pos.array[i * 3]);
    it.needsUpdate = true;
    updatePools();
    updateSurface();
  }
  // light-weight variant used while dragging the fit slider
  function applyCurveShape() {
    rebuildLUT();
    updatePools();
    updateSurface();
    drawCurve();
  }

  /* --------------------------------------------------------------- wet ground */
  const puddleGeo = new TH.PlaneGeometry(74, 30);
  puddleGeo.rotateX(-Math.PI / 2);
  const puddle = new TH.Mesh(puddleGeo, new TH.ShaderMaterial({
    uniforms: { uTime: U.uTime, uWater: waterU, uRain: rainU },
    vertexShader: SH.PUDDLE_VERT, fragmentShader: SH.PUDDLE_FRAG,
    transparent: true, depthWrite: false, side: TH.DoubleSide
  }));
  puddle.position.set(0, 0.004, 0.6);
  puddle.frustumCulled = false; puddle.renderOrder = 0;
  scene.add(puddle);

  /* ------------------------------------------------------------- light pools */
  const poolBase = new TH.PlaneGeometry(1, 1);
  poolBase.rotateX(-Math.PI / 2);
  const poolGeo = new TH.InstancedBufferGeometry();
  poolGeo.index = poolBase.index;
  poolGeo.setAttribute('position', poolBase.attributes.position);
  poolGeo.setAttribute('uv', poolBase.attributes.uv);
  poolGeo.instanceCount = N;
  const poOff = new Float32Array(N * 3), poVal = new Float32Array(N);
  const poHour = new Float32Array(N), poSeed = new Float32Array(N);
  for (let h = 0; h < N; h++) {
    poOff.set([hourX(h), 0.025, 0], h * 3);
    poHour[h] = h; poSeed[h] = Math.random();
  }
  poolGeo.setAttribute('aOffset', new TH.InstancedBufferAttribute(poOff, 3));
  const poValAttr = new TH.InstancedBufferAttribute(poVal, 1);
  poolGeo.setAttribute('aIntensity', poValAttr);
  poolGeo.setAttribute('aHour', new TH.InstancedBufferAttribute(poHour, 1));
  poolGeo.setAttribute('aSeed', new TH.InstancedBufferAttribute(poSeed, 1));
  const pools = new TH.Mesh(poolGeo, new TH.ShaderMaterial({
    uniforms: { uTime: U.uTime, uSelected: U.uSelected, uWater: waterU, uHourSpacing: U.uHourSpacing },
    vertexShader: SH.POOL_VERT, fragmentShader: SH.POOL_FRAG,
    transparent: true, depthWrite: false, blending: TH.AdditiveBlending, side: TH.DoubleSide
  }));
  pools.frustumCulled = false; pools.renderOrder = 2;
  scene.add(pools);
  function updatePools() {
    for (let h = 0; h < N; h++) {
      poVal[h] = (data[h] * 2 + data[Math.max(h - 1, 0)] + data[Math.min(h + 1, 24)]) / 4;
    }
    poValAttr.needsUpdate = true;
  }

  /* ======================================================== drop impact system
     One impact event owns: a strike flash, one or two capillary wave packets,
     an optional lopsided crown sheet, an optional Worthington jet, and a
     spray of secondary beads. Drop size follows a power law, so most hits are
     tiny pinpricks while a few throw big, legible crown splashes.

     Impact sites come from the same per-hour weights that drive the GPU rain
     strands (a paired-proxy approximation: the rain lives entirely on the
     GPU), so the boiling follows the data and the playhead, not a fixed loop. */
  let ripples = null, splashes = null, jets = null, impacts = null, droplets = null;
  let rippleAttrs = null, splashAttrs = null, jetAttrs = null, impactAttrs = null, dropletAttrs = null;
  let rippleLimit = 0, splashLimit = 0, jetLimit = 0, impactLimit = 0, dropletLimit = 0;
  let rippleCursor = 0, splashCursor = 0, jetCursor = 0, impactCursor = 0, dropletCursor = 0;
  const dropPR = { value: 1 };
  const fxRes = { value: new TH.Vector2(1, 1) };
  const fxAttrs = [];
  const hourWeights = new Float32Array(N);

  function instAttr(geo, name, arr, size) {
    const a = new TH.InstancedBufferAttribute(arr, size);
    a.setUsage(TH.DynamicDrawUsage);
    geo.setAttribute(name, a);
    fxAttrs.push(a);
    return a;
  }
  function fxMat(vs, fs, uniforms) {
    return new TH.ShaderMaterial({
      uniforms, vertexShader: vs, fragmentShader: fs,
      transparent: true, depthWrite: false,
      blending: TH.AdditiveBlending, side: TH.DoubleSide
    });
  }
  function groundGeo(limit) {
    const base = new TH.PlaneGeometry(2, 2); base.rotateX(-Math.PI / 2);
    const g = new TH.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    g.instanceCount = limit;
    return g;
  }
  function seedArray(n) {
    const a = new Float32Array(n);
    for (let i = 0; i < n; i++) a[i] = Math.random();
    return a;
  }
  /* A lathed ring sheet: the crown and the central jet are real 3D surfaces,
     not crossed billboards. uv.x = angle 0..1, uv.y = height 0..1.        */
  function latheGeo(limit, seg, rows) {
    const count = (seg + 1) * (rows + 1);
    const pos = new Float32Array(count * 3);
    const uv = new Float32Array(count * 2);
    const idx = [];
    for (let j = 0; j <= rows; j++) {
      const v = j / rows;
      for (let i = 0; i <= seg; i++) {
        const u = i / seg, ang = u * Math.PI * 2, k = j * (seg + 1) + i;
        pos[k * 3] = Math.cos(ang); pos[k * 3 + 1] = v; pos[k * 3 + 2] = Math.sin(ang);
        uv[k * 2] = u; uv[k * 2 + 1] = v;
      }
    }
    for (let j = 0; j < rows; j++) for (let i = 0; i < seg; i++) {
      const a = j * (seg + 1) + i, b = a + 1, c = a + seg + 1, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
    const g = new TH.InstancedBufferGeometry();
    g.setIndex(idx);
    g.setAttribute('position', new TH.BufferAttribute(pos, 3));
    g.setAttribute('uv', new TH.BufferAttribute(uv, 2));
    g.instanceCount = limit;
    return g;
  }
  /* Screen-space bead quad; four corners shared by every instance. */
  function beadGeo(limit) {
    const g = new TH.InstancedBufferGeometry();
    g.setAttribute('position', new TH.BufferAttribute(new Float32Array(12), 3));
    g.setAttribute('aCorner', new TH.BufferAttribute(new Float32Array([
      -1, -1, 1, -1, 1, 1, -1, 1
    ]), 2));
    g.setIndex([0, 1, 2, 0, 2, 3]);
    g.instanceCount = limit;
    return g;
  }
  function buildImpacts() {
    if (ripples) {
      scene.remove(ripples, splashes, jets, impacts, droplets);
      [ripples, splashes, jets, impacts, droplets].forEach(m => {
        m.geometry.dispose(); m.material.dispose();
      });
    }
    fxAttrs.length = 0;
    const Q = QUALITY[state.q];
    rippleLimit = Q.ripple; splashLimit = Q.splash; jetLimit = Q.jet;
    impactLimit = Q.impact; dropletLimit = Q.droplet;
    rippleCursor = splashCursor = jetCursor = impactCursor = dropletCursor = 0;

    const rg = groundGeo(rippleLimit);
    rippleAttrs = {
      offset: instAttr(rg, 'aOffset', new Float32Array(rippleLimit * 3), 3),
      birth:  instAttr(rg, 'aBirth',  new Float32Array(rippleLimit).fill(-1000), 1),
      life:   instAttr(rg, 'aLife',   new Float32Array(rippleLimit).fill(1), 1),
      size:   instAttr(rg, 'aSize',   new Float32Array(rippleLimit).fill(1), 1),
      seed:   instAttr(rg, 'aSeed',   seedArray(rippleLimit), 1),
      power:  instAttr(rg, 'aPower',  new Float32Array(rippleLimit).fill(1), 1)
    };
    ripples = new TH.Mesh(rg, fxMat(SH.RIPPLE_VERT, SH.RIPPLE_FRAG, { uTime: U.uTime }));
    ripples.frustumCulled = false; ripples.renderOrder = 4; scene.add(ripples);

    const ig = groundGeo(impactLimit);
    impactAttrs = {
      offset: instAttr(ig, 'aOffset', new Float32Array(impactLimit * 3), 3),
      birth:  instAttr(ig, 'aBirth',  new Float32Array(impactLimit).fill(-1000), 1),
      life:   instAttr(ig, 'aLife',   new Float32Array(impactLimit).fill(0.25), 1),
      size:   instAttr(ig, 'aSize',   new Float32Array(impactLimit).fill(1), 1),
      power:  instAttr(ig, 'aPower',  new Float32Array(impactLimit).fill(1), 1)
    };
    impacts = new TH.Mesh(ig, fxMat(SH.IMPACT_VERT, SH.IMPACT_FRAG, { uTime: U.uTime }));
    impacts.frustumCulled = false; impacts.renderOrder = 5; scene.add(impacts);

    const seg = state.q <= 1 ? 28 : 40, rows = state.q <= 1 ? 5 : 6;
    const cg = latheGeo(splashLimit, seg, rows);
    splashAttrs = {
      offset: instAttr(cg, 'aOffset', new Float32Array(splashLimit * 3), 3),
      birth:  instAttr(cg, 'aBirth',  new Float32Array(splashLimit).fill(-1000), 1),
      life:   instAttr(cg, 'aLife',   new Float32Array(splashLimit).fill(0.45), 1),
      scale:  instAttr(cg, 'aScale',  new Float32Array(splashLimit).fill(1), 1),
      seed:   instAttr(cg, 'aSeed',   seedArray(splashLimit), 1),
      power:  instAttr(cg, 'aPower',  new Float32Array(splashLimit).fill(1), 1),
      spikes: instAttr(cg, 'aSpikes', new Float32Array(splashLimit).fill(12), 1)
    };
    splashes = new TH.Mesh(cg, fxMat(SH.SPLASH_VERT, SH.SPLASH_FRAG, { uTime: U.uTime }));
    splashes.frustumCulled = false; splashes.renderOrder = 5; scene.add(splashes);

    const jg = latheGeo(jetLimit, 12, 6);
    jetAttrs = {
      offset: instAttr(jg, 'aOffset', new Float32Array(jetLimit * 3), 3),
      birth:  instAttr(jg, 'aBirth',  new Float32Array(jetLimit).fill(-1000), 1),
      life:   instAttr(jg, 'aLife',   new Float32Array(jetLimit).fill(0.6), 1),
      scale:  instAttr(jg, 'aScale',  new Float32Array(jetLimit).fill(1), 1),
      seed:   instAttr(jg, 'aSeed',   seedArray(jetLimit), 1),
      power:  instAttr(jg, 'aPower',  new Float32Array(jetLimit).fill(1), 1)
    };
    jets = new TH.Mesh(jg, fxMat(SH.JET_VERT, SH.JET_FRAG, { uTime: U.uTime }));
    jets.frustumCulled = false; jets.renderOrder = 5; scene.add(jets);

    const bg = beadGeo(dropletLimit);
    dropletAttrs = {
      offset: instAttr(bg, 'aOffset', new Float32Array(dropletLimit * 3), 3),
      vel:    instAttr(bg, 'aVel',    new Float32Array(dropletLimit * 3), 3),
      birth:  instAttr(bg, 'aBirth',  new Float32Array(dropletLimit).fill(-1000), 1),
      life:   instAttr(bg, 'aLife',   new Float32Array(dropletLimit).fill(0.5), 1),
      seed:   instAttr(bg, 'aSeed',   seedArray(dropletLimit), 1),
      size:   instAttr(bg, 'aSize',   new Float32Array(dropletLimit).fill(1), 1),
      power:  instAttr(bg, 'aPower',  new Float32Array(dropletLimit).fill(1), 1)
    };
    droplets = new TH.Mesh(bg, fxMat(SH.DROPLET_VERT, SH.DROPLET_FRAG,
      { uTime: U.uTime, uPR: dropPR, uRes: fxRes }));
    droplets.frustumCulled = false; droplets.renderOrder = 6; scene.add(droplets);
  }
  function flushFx() { for (let i = 0; i < fxAttrs.length; i++) fxAttrs[i].needsUpdate = true; }

  /* Impacts cluster where the rain is heavy AND near the playhead. */
  function weightedHour() {
    let total = 0;
    for (let i = 0; i < N; i++) {
      const d = (i - state.t) / 2.2;
      hourWeights[i] = (data[i] + 0.08) * (1 + 2.4 * Math.exp(-d * d));
      total += hourWeights[i];
    }
    let r = Math.random() * total;
    for (let h = 0; h < N; h++) { r -= hourWeights[h]; if (r <= 0) return h; }
    return 24;
  }
  const powerAt = h => clamp(0.30 + data[h] / 11, 0.30, 2.0);
  // live statistics: proof that splashes really span a wide size range
  const impactStats = { n: 0, min: 9, max: 0, sum: 0, tiny: 0, big: 0, crowns: 0, jets: 0, beads: 0 };

  function spawnImpact(t, x, z, size, power) {
    const i = impactCursor++ % impactLimit;
    impactAttrs.offset.array.set([x, 0.034, z], i * 3);
    impactAttrs.birth.array[i] = t;
    impactAttrs.life.array[i] = 0.14 + Math.random() * 0.14;
    impactAttrs.size.array[i] = 0.09 + size * 0.19 + Math.random() * 0.05;
    impactAttrs.power.array[i] = (0.42 + Math.random() * 0.58) * power;
  }
  function spawnRipple(t, x, z, size, power, delay) {
    const i = rippleCursor++ % rippleLimit;
    rippleAttrs.offset.array.set([x, 0.046, z], i * 3);
    rippleAttrs.birth.array[i] = t + (delay || 0);
    rippleAttrs.life.array[i] = 0.72 + Math.random() * 0.62 + size * 0.14;
    rippleAttrs.size.array[i] = 0.18 + size * 0.52 + Math.random() * 0.16;
    rippleAttrs.seed.array[i] = Math.random();
    rippleAttrs.power.array[i] = (0.45 + Math.random() * 0.55) * power;
  }
  function spawnCrown(t, x, z, size, power) {
    const i = splashCursor++ % splashLimit;
    splashAttrs.offset.array.set([x, 0.022, z], i * 3);
    splashAttrs.birth.array[i] = t;
    splashAttrs.life.array[i] = 0.34 + size * 0.15 + Math.random() * 0.10;
    splashAttrs.scale.array[i] = 0.16 + size * 0.40;
    splashAttrs.seed.array[i] = Math.random();
    splashAttrs.power.array[i] = (0.5 + Math.random() * 0.5) * power;
    splashAttrs.spikes.array[i] = 8 + Math.round(size * 5);
  }
  function spawnJet(t, x, z, size, power) {
    const i = jetCursor++ % jetLimit;
    jetAttrs.offset.array.set([x, 0.03, z], i * 3);
    jetAttrs.birth.array[i] = t + 0.05;
    jetAttrs.life.array[i] = 0.46 + size * 0.16;
    jetAttrs.scale.array[i] = 0.16 + size * 0.20;
    jetAttrs.seed.array[i] = Math.random();
    jetAttrs.power.array[i] = (0.55 + Math.random() * 0.45) * power;
  }
  function spawnDroplet(t, x, z, size, power, delay, rebound) {
    const i = dropletCursor++ % dropletLimit;
    const a = Math.random() * Math.PI * 2;
    const sp = (0.55 + Math.random() * 1.85) * (0.50 + size * 0.85);
    let vx = Math.cos(a) * sp, vz = Math.sin(a) * sp;
    let vy = (1.50 + Math.random() * 2.40) * (0.60 + size * 0.60);
    if (rebound) { vx *= 0.12; vz *= 0.12; vy = 3.35 + size * 0.70; }
    dropletAttrs.offset.array.set([
      x + (Math.random() - 0.5) * 0.12 * size, 0.06,
      z + (Math.random() - 0.5) * 0.12 * size
    ], i * 3);
    dropletAttrs.vel.array.set([vx, vy, vz], i * 3);
    dropletAttrs.birth.array[i] = t + (delay || 0);
    dropletAttrs.life.array[i] = 0.38 + Math.random() * 0.46 + (rebound ? 0.28 : 0);
    dropletAttrs.seed.array[i] = Math.random();
    // bead size varies inside one splash AND with the parent drop size
    dropletAttrs.size.array[i] = rebound
      ? 2.5 + Math.random() * 1.2
      : 0.55 + Math.pow(Math.random(), 1.8) * 2.5 * (0.55 + size * 0.45);
    dropletAttrs.power.array[i] = (0.45 + Math.random() * 0.60) * clamp(power, 0.4, 1.7);
  }
  /* Three size regimes, each with its own morphology:
       micro  (<0.50)  flash + fine ring + 1-2 beads, no crown
       medium (<1.02)  low lopsided crown + 4-8 beads
       large  (>1.02)  tall crown + Worthington jet + 9-16 beads + 2 rings  */
  function spawnDrop(t) {
    const h = weightedHour();
    const power = powerAt(h);
    const x = hourX(h) + (Math.random() - 0.5) * 2.7;
    const z = (Math.random() - 0.5) * CFG.clusterDepth;
    // power law: many fine drops, a few fat ones -> visibly different splashes
    const size = clamp((0.22 + 1.50 * Math.pow(Math.random(), 2.7)) *
                       (0.78 + power * 0.25), 0.18, 2.10);
    const S = impactStats;
    S.n++; S.sum += size;
    S.min = Math.min(S.min, size); S.max = Math.max(S.max, size);
    if (size < 0.50) S.tiny++; else if (size > 1.02) S.big++;

    spawnImpact(t, x, z, size, power);
    if (size > 0.42 || Math.random() < 0.60) spawnRipple(t, x, z, size, power, 0);
    if (size > 1.02) spawnRipple(t, x, z, size * 0.78, power * 0.7, 0.13);
    if (size > 0.50) { spawnCrown(t, x, z, size, power); S.crowns++; }

    if (size > 1.02 && Math.random() < 0.78) {
      spawnJet(t, x, z, size, power); S.jets++;
      spawnDroplet(t, x, z, size, power, 0.22, true); // pinched-off rebound drop
    }
    const nd = size < 0.50 ? 1 + (Math.random() * 2 | 0)
             : size < 1.02 ? 4 + (Math.random() * 5 | 0)
             : 12 + (Math.random() * 11 | 0);
    for (let k = 0; k < nd; k++) {
      spawnDroplet(t, x, z, size, power, Math.random() * 0.09, false);
      S.beads++;
    }
  }

  /* ------------------------------------------------- data surface + curve lines */
  const SEG = 96;
  const surfGeo = new TH.BufferGeometry();
  const surfPos = new Float32Array((SEG + 1) * 2 * 3);
  const surfIdx = [];
  for (let i = 0; i < SEG; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    surfIdx.push(a, b, c, b, d, c);
  }
  surfGeo.setAttribute('position', new TH.BufferAttribute(surfPos, 3));
  surfGeo.setIndex(surfIdx);
  const surface = new TH.Mesh(surfGeo, new TH.MeshBasicMaterial({
    color: 0x3d8fd0, transparent: true, opacity: 0.075,
    side: TH.DoubleSide, depthWrite: false, blending: TH.AdditiveBlending
  }));
  surface.frustumCulled = false; surface.renderOrder = 2;
  scene.add(surface);

  const lineBack = makeLine(0x6fb4e8, 0.34), lineFront = makeLine(0x6fb4e8, 0.34);
  const lineCore = makeLine(0xdaf3ff, 0.95);
  function makeLine(color, opacity) {
    const g = new TH.BufferGeometry();
    g.setAttribute('position', new TH.BufferAttribute(new Float32Array((SEG + 1) * 3), 3));
    const l = new TH.Line(g, new TH.LineBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, blending: TH.AdditiveBlending
    }));
    l.frustumCulled = false; l.renderOrder = 5;
    scene.add(l);
    return l;
  }
  const dotGeo = new TH.BufferGeometry();
  dotGeo.setAttribute('position', new TH.BufferAttribute(new Float32Array(N * 3), 3));
  const dots = new TH.Points(dotGeo, new TH.PointsMaterial({
    color: 0xeaf9ff, size: 0.22, sizeAttenuation: true,
    transparent: true, opacity: 0.95, depthWrite: false, blending: TH.AdditiveBlending
  }));
  dots.frustumCulled = false; dots.renderOrder = 6;
  scene.add(dots);

  // peak waterfall — bright strands falling through the tallest column
  const WF = 110;
  const wfGeo = new TH.BufferGeometry();
  const wfPos = new Float32Array(WF * 2 * 3);
  const wfRnd = new Float32Array(WF * 2);
  const wfSeed = new Float32Array(WF * 2 * 2);
  for (let i = 0; i < WF; i++) {
    const a = Math.random(), b = Math.random(), c = Math.random();
    for (let e = 0; e < 2; e++) {
      const v = i * 2 + e;
      wfRnd[v] = e;
      wfSeed[v * 2] = a; wfSeed[v * 2 + 1] = b;
      wfPos[v * 3 + 1] = c;
    }
  }
  wfGeo.setAttribute('position', new TH.BufferAttribute(wfPos, 3));
  wfGeo.setAttribute('aTail', new TH.BufferAttribute(wfRnd, 1));
  wfGeo.setAttribute('aSeed', new TH.BufferAttribute(wfSeed, 2));
  const wfMat = new TH.ShaderMaterial({
    uniforms: { uTime: U.uTime, uPeak: { value: 20 }, uPeakX: { value: 0 } },
    vertexShader: `
      attribute float aTail; attribute vec2 aSeed;
      uniform float uTime, uPeak, uPeakX;
      varying float vT; varying float vA;
      void main(){
        float phase = fract(aSeed.y + uTime * (0.28 + aSeed.x * 0.22));
        float y = (1.0 - phase) * uPeak;
        float x = uPeakX + (aSeed.x - 0.5) * 1.5;
        float z = (fract(aSeed.x * 17.3) - 0.5) * 4.4;
        vT = aTail;
        vA = smoothstep(0.0, 0.16, phase) * (1.0 - smoothstep(0.72, 1.0, phase));
        gl_Position = projectionMatrix * modelViewMatrix * vec4(x, y + aTail * 0.9, z, 1.0);
      }
    `,
    fragmentShader: `
      precision highp float;
      varying float vT; varying float vA;
      void main(){
        float a = pow(1.0 - vT, 1.5) * vA * 0.20;
        if (a < 0.004) discard;
        gl_FragColor = vec4(0.72, 0.89, 1.0, a);
      }
    `,
    transparent: true, depthWrite: false, blending: TH.AdditiveBlending
  });
  const waterfall = new TH.LineSegments(wfGeo, wfMat);
  waterfall.frustumCulled = false; waterfall.renderOrder = 3;
  scene.add(waterfall);

  function updateSurface() {
    const HD = CFG.HD;
    for (let i = 0; i <= SEG; i++) {
      const h = i / SEG * 24, x = hourX(h), y = heightOf(valueAt(h));
      const a = i * 6;
      surfPos[a] = x; surfPos[a + 1] = y; surfPos[a + 2] = -HD;
      surfPos[a + 3] = x; surfPos[a + 4] = y; surfPos[a + 5] = HD;
      const bp = lineBack.geometry.getAttribute('position');
      const fp = lineFront.geometry.getAttribute('position');
      const cp = lineCore.geometry.getAttribute('position');
      bp.array[i * 3] = x; bp.array[i * 3 + 1] = y; bp.array[i * 3 + 2] = -HD;
      fp.array[i * 3] = x; fp.array[i * 3 + 1] = y; fp.array[i * 3 + 2] = HD;
      cp.array[i * 3] = x; cp.array[i * 3 + 1] = y; cp.array[i * 3 + 2] = 0;
    }
    surfGeo.getAttribute('position').needsUpdate = true;
    surfGeo.computeVertexNormals();
    [lineBack, lineFront, lineCore].forEach(l => l.geometry.getAttribute('position').needsUpdate = true);
    const dp = dotGeo.getAttribute('position');
    let peak = 0, peakH = 0;
    for (let h = 0; h < N; h++) {
      dp.array[h * 3] = hourX(h);
      dp.array[h * 3 + 1] = heightOf(data[h]);
      dp.array[h * 3 + 2] = 0;
      if (data[h] > peak) { peak = data[h]; peakH = h; }
    }
    dp.needsUpdate = true;
    wfMat.uniforms.uPeak.value = heightOf(peak);
    wfMat.uniforms.uPeakX.value = hourX(peakH);
    waterfall.visible = peak > 6;
  }

  /* --------------------------------------------------------------- 3D axes */
  function makeLabel(text, color, scale) {
    const c = document.createElement('canvas');
    c.width = 256; c.height = 64;
    const g = c.getContext('2d');
    g.clearRect(0, 0, 256, 64);
    g.font = '500 26px SFMono-Regular, Consolas, monospace';
    g.fillStyle = color; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, 128, 32);
    const tex = new TH.CanvasTexture(c);
    tex.minFilter = TH.LinearFilter;
    const s = new TH.Sprite(new TH.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, opacity: 0.72, blending: TH.AdditiveBlending
    }));
    s.scale.set(scale, scale / 4, 1);
    return s;
  }
  const axisPts = [];
  const chartLabels = [];
  function addAxis(a, b) { axisPts.push(a[0], a[1], a[2], b[0], b[1], b[2]); }
  const zF = CFG.HD + 1.0;
  const x0 = hourX(0) - 1.5, x1 = hourX(24) + 1.5;
  addAxis([x0, 0.02, zF], [x1, 0.02, zF]);
  for (let h = 0; h <= 24; h++) {
    addAxis([hourX(h), 0.02, zF], [hourX(h), 0.02, zF + (h % 6 === 0 ? 0.4 : 0.2)]);
    if (h % 6 === 0) {
      const s = makeLabel(String(h).padStart(2, '0') + ':00', 'rgba(150,205,245,0.9)', 3.4);
      s.position.set(hourX(h), 0.1, zF + 1.35);
      chartLabels.push(s); scene.add(s);
    }
  }
  const yx = x0 - 0.15;
  addAxis([yx, 0.02, zF], [yx, heightOf(20) + 0.8, zF]);
  for (const v of [0, 5, 10, 15, 20]) {
    const y = heightOf(v);
    addAxis([yx, y, zF], [yx + 0.35, y, zF]);
    const s = makeLabel(String(v), 'rgba(168,230,200,0.9)', 1.9);
    s.position.set(yx - 1.0, y, zF);
    chartLabels.push(s); scene.add(s);
  }
  addAxis([x0, 0.02, -CFG.HD], [x0, 0.02, CFG.HD]);
  const axisGeo = new TH.BufferGeometry();
  axisGeo.setAttribute('position', new TH.Float32BufferAttribute(axisPts, 3));
  const axes = new TH.LineSegments(axisGeo, new TH.LineBasicMaterial({
    color: 0x74b6e6, transparent: true, opacity: 0.32,
    depthWrite: false, blending: TH.AdditiveBlending
  }));
  axes.frustumCulled = false; axes.renderOrder = 5;
  scene.add(axes);

  /* ------------------------------------------------------------ time marker */
  const markerGeo = new TH.BufferGeometry();
  markerGeo.setAttribute('position', new TH.BufferAttribute(new Float32Array(6), 3));
  const marker = new TH.Line(markerGeo, new TH.LineBasicMaterial({
    color: 0xc8ecff, transparent: true, opacity: 0.5, depthWrite: false, blending: TH.AdditiveBlending
  }));
  marker.frustumCulled = false; marker.renderOrder = 6; scene.add(marker);
  const ringN = 48, ringPos = new Float32Array(ringN * 3);
  const ringGeo = new TH.BufferGeometry();
  ringGeo.setAttribute('position', new TH.BufferAttribute(ringPos, 3));
  const ring = new TH.LineLoop(ringGeo, new TH.LineBasicMaterial({
    color: 0xbfe8ff, transparent: true, opacity: 0.72, depthWrite: false, blending: TH.AdditiveBlending
  }));
  ring.frustumCulled = false; ring.renderOrder = 6; scene.add(ring);
  const markerDot = new TH.Mesh(new TH.SphereGeometry(0.14, 12, 8),
    new TH.MeshBasicMaterial({ color: 0xeaf9ff, transparent: true, opacity: 0.95, blending: TH.AdditiveBlending }));
  markerDot.renderOrder = 7; scene.add(markerDot);
  function updateMarker() {
    const x = hourX(state.t), y = heightOf(valueAt(state.t));
    const mp = marker.geometry.getAttribute('position');
    mp.array[0] = x; mp.array[1] = 0.02; mp.array[2] = 0;
    mp.array[3] = x; mp.array[4] = y; mp.array[5] = 0;
    mp.needsUpdate = true;
    const rp = ring.geometry.getAttribute('position');
    for (let i = 0; i < ringN; i++) {
      const a = i / ringN * Math.PI * 2;
      rp.array[i * 3] = x + Math.cos(a) * 0.62;
      rp.array[i * 3 + 1] = 0.035;
      rp.array[i * 3 + 2] = Math.sin(a) * 0.62;
    }
    rp.needsUpdate = true;
    markerDot.position.set(x, y, 0);
  }

  /* ------------------------------------------------------------ bloom pipeline */
  const rtOpt = {
    minFilter: TH.LinearFilter, magFilter: TH.LinearFilter,
    format: TH.RGBAFormat, type: TH.UnsignedByteType,
    depthBuffer: true, stencilBuffer: false
  };
  let rtScene = new TH.WebGLRenderTarget(1, 1, rtOpt);
  const rtOptNoDepth = Object.assign({}, rtOpt, { depthBuffer: false });
  let rtBright = new TH.WebGLRenderTarget(1, 1, rtOptNoDepth);
  let rtBlurA = new TH.WebGLRenderTarget(1, 1, rtOptNoDepth);
  let rtBlurB = new TH.WebGLRenderTarget(1, 1, rtOptNoDepth);
  const quadScene = new TH.Scene();
  const quadCam = new TH.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new TH.PlaneGeometry(2, 2);
  const brightMat = new TH.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uThreshold: { value: 0.52 } },
    vertexShader: SH.QUAD_VERT, fragmentShader: SH.BRIGHT_FRAG, depthTest: false, depthWrite: false
  });
  const blurMat = new TH.ShaderMaterial({
    uniforms: { tDiffuse: { value: null }, uDir: { value: new TH.Vector2(0.002, 0) } },
    vertexShader: SH.QUAD_VERT, fragmentShader: SH.BLUR_FRAG, depthTest: false, depthWrite: false
  });
  const compMat = new TH.ShaderMaterial({
    uniforms: {
      tScene: { value: null }, tBloom: { value: null },
      uTime: { value: 0 }, uBloom: { value: 0.9 }, uExposure: { value: 1.12 },
      uRes: { value: new TH.Vector2(1, 1) }
    },
    vertexShader: SH.QUAD_VERT, fragmentShader: SH.COMPOSITE_FRAG,
    depthTest: false, depthWrite: false
  });
  const quad = new TH.Mesh(quadGeo, compMat);
  quad.frustumCulled = false;
  quadScene.add(quad);
  let bw = 1, bh = 1;

  function resize() {
    const w = Math.max(1, window.innerWidth), h = Math.max(1, window.innerHeight);
    const q = QUALITY[state.q];
    // A 24-hour timeline is very wide: pull the camera back on tall screens
    // so the whole rainfall field stays in frame instead of being cropped.
    const aspect = w / h;
    const baseR = aspect < 0.75 ? 88 : (aspect < 1.2 ? 50 : 40);
    camera.fov = aspect < 0.75 ? 54 : (aspect < 1.2 ? 48 : 46);
    // Tall screens: bias the framing upward so the rain field occupies the
    // free space under the header instead of hiding behind the control dock.
    camTarget.y = aspect < 0.75 ? -3.6 : 5.0;
    U.uGain.value = aspect < 0.75 ? 1.5 : 1.0;
    camera.updateProjectionMatrix();
    if (state.baseRadius === undefined) {
      state.baseRadius = baseR;
      state.radius = state.tRadius = baseR;
    } else if (state.baseRadius !== baseR) {
      const d = baseR - state.baseRadius;
      state.radius = clamp(state.radius + d, 22, 140);
      state.tRadius = clamp(state.tRadius + d, 22, 140);
      state.baseRadius = baseR;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, q.dpr));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const dpr = renderer.getPixelRatio();
    dropPR.value = dpr;
    const pw = Math.max(1, Math.floor(w * dpr)), ph = Math.max(1, Math.floor(h * dpr));
    rtScene.setSize(pw, ph);
    bw = Math.max(1, Math.floor(pw / q.blurScale));
    bh = Math.max(1, Math.floor(ph / q.blurScale));
    rtBright.setSize(bw, bh); rtBlurA.setSize(bw, bh); rtBlurB.setSize(bw, bh);
    compMat.uniforms.uRes.value.set(pw, ph);
    fxRes.value.set(pw, ph);
    resizeCurve();
  }
  function renderFrame() {
    renderer.setRenderTarget(rtScene);
    renderer.clear();
    renderer.render(scene, camera);

    quad.material = brightMat;
    brightMat.uniforms.tDiffuse.value = rtScene.texture;
    renderer.setRenderTarget(rtBright);
    renderer.render(quadScene, quadCam);

    quad.material = blurMat;
    blurMat.uniforms.uDir.value.set(1.4 / bw, 0);
    blurMat.uniforms.tDiffuse.value = rtBright.texture;
    renderer.setRenderTarget(rtBlurA);
    renderer.render(quadScene, quadCam);
    blurMat.uniforms.uDir.value.set(0, 1.4 / bh);
    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    renderer.setRenderTarget(rtBlurB);
    renderer.render(quadScene, quadCam);
    blurMat.uniforms.uDir.value.set(2.2 / bw, 0);
    blurMat.uniforms.tDiffuse.value = rtBlurB.texture;
    renderer.setRenderTarget(rtBlurA);
    renderer.render(quadScene, quadCam);
    blurMat.uniforms.uDir.value.set(0, 2.2 / bh);
    blurMat.uniforms.tDiffuse.value = rtBlurA.texture;
    renderer.setRenderTarget(rtBlurB);
    renderer.render(quadScene, quadCam);

    quad.material = compMat;
    compMat.uniforms.tScene.value = rtScene.texture;
    compMat.uniforms.tBloom.value = rtBlurB.texture;
    compMat.uniforms.uBloom.value = QUALITY[state.q].bloom;
    compMat.uniforms.uTime.value = state.elapsed;
    renderer.setRenderTarget(null);
    renderer.render(quadScene, quadCam);
  }

  /* -------------------------------------------------------------- orbit camera */
  function updateCamera() {
    const sp = Math.sin(state.phi), cp = Math.cos(state.phi);
    camera.position.set(
      camTarget.x + state.radius * sp * Math.sin(state.theta),
      camTarget.y + state.radius * cp,
      camTarget.z + state.radius * sp * Math.cos(state.theta)
    );
    camera.lookAt(camTarget);
  }
  function rotateBy(deg) { state.tTheta += deg * RAD; }
  function resetView() {
    state.tTheta = 30 * RAD; state.tPhi = 60 * RAD;
    state.tRadius = state.baseRadius || 40;
  }

  let ptr = null;
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    ptr = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: 0 };
  });
  canvas.addEventListener('pointermove', e => {
    if (!ptr || e.pointerId !== ptr.id) return;
    const dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
    ptr.x = e.clientX; ptr.y = e.clientY; ptr.moved += Math.abs(dx) + Math.abs(dy);
    state.tTheta -= dx * 0.0052;
    state.tPhi = clamp(state.tPhi - dy * 0.0045, 0.22, Math.PI * 0.478);
  });
  const endPtr = e => { if (ptr && e.pointerId === ptr.id) ptr = null; };
  canvas.addEventListener('pointerup', endPtr);
  canvas.addEventListener('pointercancel', endPtr);
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    state.tRadius = clamp(state.tRadius + e.deltaY * 0.026, 22, 140);
  }, { passive: false });
  canvas.addEventListener('dblclick', resetView);
  // pinch zoom
  const touches = new Map();
  let pinchDist = 0;
  canvas.addEventListener('touchstart', e => {
    for (const t of e.changedTouches) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    if (touches.size === 2) {
      const a = [...touches.values()];
      pinchDist = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
    }
  }, { passive: true });
  canvas.addEventListener('touchmove', e => {
    for (const t of e.changedTouches) {
      if (touches.has(t.identifier)) touches.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (touches.size === 2) {
      const a = [...touches.values()];
      const d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y);
      if (pinchDist > 0) state.tRadius = clamp(state.tRadius - (d - pinchDist) * 0.075, 22, 140);
      pinchDist = d;
      e.preventDefault();
    }
  }, { passive: false });
  const endTouch = e => {
    for (const t of e.changedTouches) touches.delete(t.identifier);
    if (touches.size < 2) pinchDist = 0;
  };
  canvas.addEventListener('touchend', endTouch);
  canvas.addEventListener('touchcancel', endTouch);

  /* ------------------------------------------------------------ curve editor */
  const curveCv = $('curve'), cx = curveCv.getContext('2d');
  let cw = 0, chh = 0, cdpr = 1;
  const CP = { l: 30, r: 14, t: 12, b: 17 };
  function resizeCurve() {
    cdpr = Math.min(window.devicePixelRatio || 1, 2);
    cw = curveCv.clientWidth || 600;
    chh = curveCv.clientHeight || 88;
    curveCv.width = Math.round(cw * cdpr);
    curveCv.height = Math.round(chh * cdpr);
    cx.setTransform(cdpr, 0, 0, cdpr, 0, 0);
  }
  const ex = i => CP.l + (i / 24) * (cw - CP.l - CP.r);
  const ey = v => chh - CP.b - (v / MAX_MM) * (chh - CP.t - CP.b);
  function drawCurve() {
    if (!cw) return;
    cx.clearRect(0, 0, cw, chh);
    // grid
    cx.lineWidth = 1;
    for (let v = 0; v <= 20; v += 5) {
      const y = ey(v);
      cx.strokeStyle = v === 0 ? 'rgba(130,195,255,.20)' : 'rgba(130,195,255,.07)';
      cx.beginPath(); cx.moveTo(CP.l, y); cx.lineTo(cw - CP.r, y); cx.stroke();
      cx.fillStyle = 'rgba(120,160,195,.55)';
      cx.font = '8px ' + 'monospace'; cx.textAlign = 'right'; cx.textBaseline = 'middle';
      cx.fillText(String(v), CP.l - 6, y);
    }
    for (let h = 0; h <= 24; h += 6) {
      const x = ex(h);
      cx.strokeStyle = 'rgba(130,195,255,.06)';
      cx.beginPath(); cx.moveTo(x, CP.t); cx.lineTo(x, chh - CP.b); cx.stroke();
      cx.fillStyle = 'rgba(120,160,195,.5)';
      cx.font = '8px monospace'; cx.textAlign = 'center'; cx.textBaseline = 'top';
      cx.fillText(String(h).padStart(2, '0') + ':00', x, chh - CP.b + 4);
    }
    // sampled path — smooth when fitted, otherwise the raw polyline
    const P = 120;
    const sx = k => ex(k / P * 24);
    const sy = k => ey(valueAt(k / P * 24));
    // filled area
    cx.beginPath(); cx.moveTo(sx(0), chh - CP.b);
    if (state.smooth) { for (let k = 0; k <= P; k++) cx.lineTo(sx(k), sy(k)); }
    else { for (let i = 0; i < N; i++) cx.lineTo(ex(i), ey(data[i])); }
    cx.lineTo(sx(P), chh - CP.b); cx.closePath();
    const g = cx.createLinearGradient(0, CP.t, 0, chh - CP.b);
    g.addColorStop(0, 'rgba(96,180,255,.28)');
    g.addColorStop(1, 'rgba(60,130,210,.02)');
    cx.fillStyle = g; cx.fill();
    // the original angular polyline stays visible as a ghost when fitted
    if (state.smooth) {
      cx.save();
      cx.setLineDash([3, 3]); cx.lineWidth = 1;
      cx.strokeStyle = 'rgba(150,205,245,.34)';
      cx.beginPath();
      for (let i = 0; i < N; i++) {
        const x = ex(i), y = ey(data[i]);
        i ? cx.lineTo(x, y) : cx.moveTo(x, y);
      }
      cx.stroke(); cx.restore();
    }
    // main line
    cx.beginPath();
    if (state.smooth) {
      for (let k = 0; k <= P; k++) { k ? cx.lineTo(sx(k), sy(k)) : cx.moveTo(sx(k), sy(k)); }
    } else {
      for (let i = 0; i < N; i++) { const x = ex(i), y = ey(data[i]); i ? cx.lineTo(x, y) : cx.moveTo(x, y); }
    }
    cx.strokeStyle = 'rgba(190,232,255,.92)'; cx.lineWidth = 1.7;
    cx.shadowColor = 'rgba(120,200,255,.75)'; cx.shadowBlur = 10; cx.stroke(); cx.shadowBlur = 0;
    // points
    for (let i = 0; i < N; i++) {
      const x = ex(i), y = ey(data[i]);
      const hot = i === state.hoverIdx || i === state.dragCurve;
      cx.beginPath(); cx.arc(x, y, hot ? 4.2 : 2.1, 0, Math.PI * 2);
      cx.fillStyle = hot ? '#ffffff' : '#dbf2ff'; cx.fill();
      if (hot) { cx.strokeStyle = 'rgba(140,215,255,.6)'; cx.lineWidth = 1; cx.stroke(); }
    }
    // now marker
    const nowX = CP.l + (state.t / 24) * (cw - CP.l - CP.r);
    cx.setLineDash([3, 4]); cx.strokeStyle = 'rgba(160,225,255,.6)'; cx.lineWidth = 1;
    cx.beginPath(); cx.moveTo(nowX, CP.t - 4); cx.lineTo(nowX, chh - CP.b); cx.stroke();
    cx.setLineDash([]);
  }
  function curvePoint(e) {
    const r = curveCv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function nearestIndex(p) {
    let best = -1, dist = 1e9;
    for (let i = 0; i < N; i++) {
      const d = Math.hypot(ex(i) - p.x, ey(data[i]) - p.y);
      if (d < dist) { dist = d; best = i; }
    }
    return dist < 26 ? best : -1;
  }
  curveCv.addEventListener('pointerdown', e => {
    curveCv.setPointerCapture(e.pointerId);
    const p = curvePoint(e);
    state.dragCurve = nearestIndex(p);
    if (state.dragCurve >= 0) setCurveValue(p);
  });
  curveCv.addEventListener('pointermove', e => {
    const p = curvePoint(e);
    if (state.dragCurve >= 0) { setCurveValue(p); }
    else {
      const i = nearestIndex(p);
      state.hoverIdx = i;
      $('hoverInfo').textContent = i >= 0
        ? String(i).padStart(2, '0') + ':00 · ' + data[i].toFixed(1) + ' mm/h' : '—';
    }
  });
  const endCurve = () => { state.dragCurve = -1; };
  curveCv.addEventListener('pointerup', endCurve);
  curveCv.addEventListener('pointercancel', endCurve);
  curveCv.addEventListener('pointerleave', () => { state.hoverIdx = -1; $('hoverInfo').textContent = '—'; });
  function setCurveValue(p) {
    const i = state.dragCurve;
    const v = clamp((chh - CP.b - p.y) / (chh - CP.t - CP.b) * MAX_MM, 0, MAX_MM);
    data[i] = Math.round(v * 10) / 10;
    state.presetName = '';
    document.querySelectorAll('#presetBtns button').forEach(b => b.classList.remove('on'));
    updateRainData();
  }

  /* ------------------------------------------------------------------- UI */
  let toastTimer = null;
  function toast(msg) {
    const el = $('toast');
    el.textContent = msg; el.classList.add('on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('on'), 1600);
  }
  function setPanels(hidden) {
    state.panelsHidden = hidden;
    app.classList.toggle('panels-hidden', hidden);
    $('fabToggle').setAttribute('aria-pressed', String(hidden));
  }

  /* The "line chart" is both the 3D data overlay and the 2D editor graph.
     Turning it off leaves a pure rain scene; the transport controls stay. */
  const chartObjects = [surface, lineBack, lineFront, lineCore, dots,
    waterfall, marker, ring, markerDot, axes];
  function setChart(on) {
    state.chartOn = !!on;
    app.classList.toggle('chart-off', !state.chartOn);
    chartObjects.forEach(o => { o.visible = state.chartOn; });
    chartLabels.forEach(o => { o.visible = state.chartOn; });
    syncCurveUI();
  }
  function syncCurveUI() {
    const zh = state.lang === 'zh';
    $('curveBtn').textContent = state.chartOn
      ? (zh ? '隐藏图表' : 'Hide chart')
      : (zh ? '显示图表' : 'Show chart');
    $('curveBtn').classList.toggle('active', state.chartOn);
    $('curveBtn').setAttribute('aria-pressed', String(state.chartOn));
    $('miniChart').classList.toggle('active', state.chartOn);
    $('smoothBtn').textContent = state.smooth
      ? (zh ? '平滑 ✓' : 'Smooth ✓')
      : (zh ? '平滑拟合' : 'Smooth fit');
    $('smoothBtn').classList.toggle('active', state.smooth);
    $('smoothBtn').setAttribute('aria-pressed', String(state.smooth));
    $('smoothRange').value = Math.round(state.smoothAmt * 100);
    $('smoothPct').textContent = Math.round(state.smoothAmt * 100) + '%';
    $('curveMode').textContent = state.smooth
      ? (zh ? '平滑' : 'SMOOTH') : (zh ? '折线' : 'LINEAR');
  }
  function setSmooth(on, amt, silent) {
    state.smooth = !!on;
    if (typeof amt === 'number') state.smoothAmt = clamp(amt, 0, 1);
    updateRainData();
    syncCurveUI();
    if (!silent) toast(state.smooth
      ? (state.lang === 'zh' ? '已拟合为平滑曲线' : 'Fitted to a smooth curve')
      : (state.lang === 'zh' ? '已恢复折线' : 'Back to polyline'));
  }
  function toggleWallpaper() {
    state.wallpaper = !state.wallpaper;
    app.classList.toggle('wallpaper', state.wallpaper);
    toast(state.wallpaper
      ? (state.lang === 'zh' ? '壁纸模式 · 按 W / Esc 或点击画面退出' : 'Wallpaper · press W / Esc or tap to exit')
      : (state.lang === 'zh' ? '已退出壁纸模式' : 'Wallpaper off'));
  }
  function applyLang() {
    document.querySelectorAll('[data-zh]').forEach(el => {
      const v = state.lang === 'zh' ? el.dataset.zh : el.dataset.en;
      if (v) el.textContent = v;
    });
    $('langBtn').textContent = state.lang === 'zh' ? 'EN' : '中';
    document.documentElement.lang = state.lang === 'zh' ? 'zh-CN' : 'en';
    syncPlay();
    syncCurveUI();
  }
  function syncPlay() {
    $('playIcon').textContent = state.playing ? '❚❚' : '▶';
    $('miniPlayIcon').textContent = $('playIcon').textContent;
    const label = state.playing
      ? (state.lang === 'zh' ? '暂停' : 'Pause')
      : (state.lang === 'zh' ? '播放' : 'Play');
    $('playLabel').textContent = label;
  }
  function setQuality(q, silent) {
    state.q = clamp(q, 0, 3);
    document.querySelectorAll('#qualityBtns button').forEach((b, i) => b.classList.toggle('active', i === state.q));
    $('qualityValue').textContent = QUALITY[state.q].label;
    $('qualityHint').textContent = QUALITY[state.q].label.toUpperCase();
    buildRain(); buildImpacts(); resize();
    if (!silent) toast((state.lang === 'zh' ? '画质：' : 'Quality: ') + QUALITY[state.q].label);
  }
  function applyPreset(name) {
    if (name === 'random') {
      let v = 1 + Math.random() * 3;
      data = [];
      for (let i = 0; i < N; i++) {
        v = clamp(v + (Math.random() - 0.5) * 4.2, 0.1, 19.5);
        data.push(Math.round(v * 10) / 10);
      }
    } else data = PRESETS[name].slice();
    state.presetName = name;
    document.querySelectorAll('#presetBtns button').forEach(b => b.classList.toggle('on', b.dataset.p === name));
    updateRainData();
    toast(state.lang === 'zh' ? '已载入数据预设' : 'Preset loaded');
  }
  function updateUI() {
    const v = valueAt(state.t);
    $('timeValue').textContent = fmtTime(state.t);
    $('rainValue').textContent = v.toFixed(1);
    $('levelValue').textContent = levelName(v);
    $('rainBar').style.width = (clamp(v / MAX_MM, 0, 1) * 100).toFixed(1) + '%';
    $('fpsValue').textContent = Math.round(state.fps);
    $('yawValue').textContent = Math.round(((state.theta / RAD % 360) + 360) % 360) + '°';
    $('pitchValue').textContent = Math.round(90 - state.phi / RAD) + '°';
    $('axisNow').textContent = fmtTime(state.t);
    $('timeTrack').style.width = (state.t / 24 * 100).toFixed(1) + '%';
  }

  /* --------------------------------------------------------------- events */
  $('rotateBtn').addEventListener('click', () => rotateBy(30));
  $('rotateBack').addEventListener('click', () => rotateBy(-30));
  $('resetView').addEventListener('click', resetView);
  $('autoRotate').addEventListener('change', e => { state.autoRotate = e.target.checked; });
  $('soundToggle').addEventListener('change', e => {
    state.sound = e.target.checked;
    RA.setEnabled(state.sound);
    if (state.sound) toast(state.lang === 'zh' ? '雨声已开启' : 'Rain sound on');
  });
  $('langBtn').addEventListener('click', () => {
    state.lang = state.lang === 'zh' ? 'en' : 'zh';
    applyLang();
  });
  $('wallpaperBtn').addEventListener('click', toggleWallpaper);
  $('shotBtn').addEventListener('click', () => { state.wantShot = true; });
  $('playBtn').addEventListener('click', () => { state.playing = !state.playing; syncPlay(); });
  $('speedBtn').addEventListener('click', () => {
    state.speedIdx = (state.speedIdx + 1) % 3;
    $('speedBtn').textContent = ['0.5×', '1×', '2×'][state.speedIdx];
  });
  $('resetData').addEventListener('click', () => {
    data = DEFAULT_DATA.slice(); state.presetName = '';
    document.querySelectorAll('#presetBtns button').forEach(b => b.classList.remove('on'));
    updateRainData();
    toast(state.lang === 'zh' ? '数据已还原' : 'Data reset');
  });
  document.querySelectorAll('#qualityBtns button').forEach(b => {
    b.addEventListener('click', () => setQuality(+b.dataset.q));
  });
  document.querySelectorAll('#presetBtns button').forEach(b => {
    b.addEventListener('click', () => applyPreset(b.dataset.p));
  });
  $('curveBtn').addEventListener('click', () => setChart(!state.chartOn));
  $('miniChart').addEventListener('click', () => setChart(!state.chartOn));
  $('smoothBtn').addEventListener('click', () => setSmooth(!state.smooth));
  $('smoothRange').addEventListener('input', e => {
    state.smoothAmt = clamp(+e.target.value / 100, 0, 1);
    if (!state.smooth) state.smooth = true;
    $('smoothPct').textContent = Math.round(state.smoothAmt * 100) + '%';
    $('smoothBtn').classList.add('active');
    $('curveMode').textContent = state.lang === 'zh' ? '平滑' : 'SMOOTH';
    applyCurveShape();
  });
  $('smoothRange').addEventListener('change', () => { updateRainData(); syncCurveUI(); });
  $('panelToggle').addEventListener('click', () => setPanels(!state.panelsHidden));
  $('fabToggle').addEventListener('click', () => {
    if (state.wallpaper) { toggleWallpaper(); return; }
    setPanels(!state.panelsHidden);
  });
  $('miniRotate').addEventListener('click', () => rotateBy(30));
  $('miniPlay').addEventListener('click', () => { state.playing = !state.playing; syncPlay(); });
  $('miniShow').addEventListener('click', () => {
    if (state.wallpaper) { toggleWallpaper(); return; }
    setPanels(false);
  });
  canvas.addEventListener('click', () => {
    if (state.wallpaper && (!ptr || ptr.moved < 6)) toggleWallpaper();
  });
  window.addEventListener('keydown', e => {
    if (e.key === 'ArrowRight') { rotateBy(30); e.preventDefault(); }
    else if (e.key === 'ArrowLeft') { rotateBy(-30); e.preventDefault(); }
    else if (e.code === 'Space') { state.playing = !state.playing; syncPlay(); e.preventDefault(); }
    else if (e.key === 'h' || e.key === 'H') setPanels(!state.panelsHidden);
    else if (e.key === 'r' || e.key === 'R') resetView();
    else if (e.key === 'a' || e.key === 'A') {
      state.autoRotate = !state.autoRotate;
      $('autoRotate').checked = state.autoRotate;
    }     else if (e.key === 'w' || e.key === 'W') toggleWallpaper();
    else if (e.key === 'c' || e.key === 'C') setChart(!state.chartOn);
    else if (e.key === 's' || e.key === 'S') setSmooth(!state.smooth);
    else if (e.key === 'Escape' && state.wallpaper) toggleWallpaper();
  });
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 250));

  /* ------------------------------------------------------------------ loop */
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    // rAF timestamps can be on a different time base than performance.now()
    // (headless Chrome, restored tabs). Clamp to [0, 50ms] or the very first
    // frame would push elapsed/dropAcc negative and stall every effect.
    const dt = Math.max(0, Math.min(((now || 0) - last) / 1000, 0.05));
    last = now || last;
    state.elapsed += dt;
    U.uTime.value = state.elapsed;

    if (state.playing) { state.t += dt * state.speeds[state.speedIdx]; if (state.t > 24) state.t -= 24; }
    U.uSelected.value = state.t;

    let sum = 0;
    for (let i = 0; i < N; i++) sum += data[i];
    const mean = sum / N;
    const targetWater = clamp(0.12 + mean / 11, 0, 1);
    waterU.value += (targetWater - waterU.value) * Math.min(1, dt * 1.2);
    rainU.value = clamp(mean / 14, 0, 1);
    U.uReflectAmount.value = 0.32 + waterU.value * 0.34;

    // one unified drop-hit stream; every hit can produce a flash, a ring,
    // a crown and a handful of ballistic beads, weighted by local mm/h
    // A deliberately moderate hit rate: every instance gets to live out its
    // full animation instead of being overwritten mid-ripple by the cursor.
    state.dropAcc += dt * (2.5 + sum * 0.42);
    let guard = 0;
    while (state.dropAcc >= 1 && guard++ < 16) {
      state.dropAcc -= 1;
      spawnDrop(state.elapsed);
    }
    if (state.dropAcc > 16) state.dropAcc = 16;
    if (guard > 0) flushFx();

    if (state.autoRotate) state.tTheta += dt * 0.09;
    const k = Math.min(1, dt * 8.5);
    state.theta += (state.tTheta - state.theta) * k;
    state.phi += (state.tPhi - state.phi) * k;
    state.radius += (state.tRadius - state.radius) * k;
    updateCamera();
    updateMarker();

    RA.update(dt, valueAt(state.t));

    state.frames++;
    state.fpsTime += dt;
    if (state.fpsTime >= 0.5) {
      state.fps = state.frames / state.fpsTime;
      state.frames = 0; state.fpsTime = 0;
    }
    updateUI();
    drawCurve();
    renderFrame();

    if (state.wantShot) {
      state.wantShot = false;
      try {
        const a = document.createElement('a');
        a.href = renderer.domElement.toDataURL('image/png');
        a.download = 'rainform-' + Date.now() + '.png';
        a.click();
        toast(state.lang === 'zh' ? '画面已保存' : 'Frame saved');
      } catch (err) { toast('PNG export unavailable'); }
    }
  }

  /* ------------------------------------------------------------------ boot */
  function boot() {
    // pick a sensible initial quality tier
    const params = new URLSearchParams(location.search);
    const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent) || window.innerWidth < 760;
    const cores = navigator.hardwareConcurrency || 8;
    let q = 2;
    if (mobile || cores <= 4) q = 1;
    if (window.innerWidth >= 1400 && cores >= 8 && !mobile) q = 3;
    if (params.has('q')) q = clamp(parseInt(params.get('q'), 10) || 0, 0, 3);
    /* Old Android System WebView builds (Chrome <= 86) expose only WebGL1 and
       sometimes lack ANGLE_instanced_arrays. Keep the scene usable there by
       forcing the lightest tier and skipping the bloom pass. The flag is set
       by the native Android shell before any other script runs. */
    if (window.__RAINFORM_LOW__) {
      q = 0;
      QUALITY[0].bloom = 0;
      QUALITY[0].dpr = 1;
    }
    setQuality(q, true);
    if (params.has('preset') && PRESETS[params.get('preset')] || params.get('preset') === 'random') {
      applyPreset(params.get('preset'));
    }
    if (params.has('t')) state.t = clamp(parseFloat(params.get('t')) || 0, 0, 24);
    if (params.get('wallpaper') === '1') { state.wallpaper = true; app.classList.add('wallpaper'); }
    if (params.get('smooth') === '1') state.smooth = true;
    if (params.has('fit')) state.smoothAmt = clamp(parseFloat(params.get('fit')) || 0, 0, 1);
    rebuildLUT();
    if (params.get('chart') === '0') setChart(false);
    updatePools();
    updateSurface();
    applyLang();
    syncCurveUI();
    syncPlay();
    updateUI();
    resize();
    setTimeout(() => $('loader').classList.add('done'), 620);
    requestAnimationFrame(frame);
    // expose a tiny API for automation / wallpaper engines
    window.Rainform = {
      update(values) {
        if (!Array.isArray(values) || values.length !== 25) return;
        data = values.map(v => clamp(+v || 0, 0, MAX_MM));
        updateRainData();
      },
      rotate: rotateBy,
      setQuality,
      setChart,
      setSmooth,
      setPanels,
      setTime(t) { state.t = clamp(t, 0, 24); },
      audioMix: mmh => RA.mix(mmh),
      impactStats,
      snapshot() { state.wantShot = true; },
      state
    };
  }
  boot();
})();

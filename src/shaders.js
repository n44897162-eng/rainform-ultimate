/* Rainform Ultimate — GLSL programs.
   All visuals are procedural; no textures are loaded from the network. */
(function (w) {
  'use strict';

  /* ------------------------------------------------------------ full-screen quad */
  const QUAD_VERT = `
    varying vec2 vUv;
    void main(){
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `;

  /* ------------------------------------------------------------------ rain strands
     24 hourly columns share one geometry. aIntensity drives density, height,
     speed, strand length and brightness for every individual drop.            */
  const RAIN_VERT = `
    precision highp float;
    attribute vec4 aRandom;
    attribute float aTail;
    attribute float aHour;
    attribute float aIntensity;
    uniform float uTime, uSelected, uBaseHeight, uHeightPerMm, uClusterWidth;
    uniform float uFadeNear, uFadeFar, uReflection, uWind, uHourSpacing, uGain;
    varying float vAlpha, vTail, vSelected, vReflection, vFog;
    void main(){
      float mmh  = aIntensity;
      float n    = clamp(mmh / 20.0, 0.0, 1.0);
      float density = 0.03 + 0.88 * n;
      float center  = (aHour - 12.0) * uHourSpacing;
      float edge    = abs(position.x - center) / max(uClusterWidth * 0.5, 0.001);
      density *= 0.55 + 0.45 * (1.0 - smoothstep(0.25, 1.35, edge));
      density *= smoothstep(-19.7, -16.8, position.x)
               * (1.0 - smoothstep(16.8, 19.7, position.x));
      float dropActive = step(aRandom.x, density);
      float speed      = 8.0 + mmh * 0.6;
      float lengthRain = mix(0.18, 1.05, n) + max(0.0, mmh - 20.0) * 0.012;
      float feather    = 0.84 + 0.16 * aRandom.w;
      float colHeight  = (uBaseHeight + mmh * uHeightPerMm) * feather;
      float selected   = 1.0 - smoothstep(0.35, 1.35, abs(aHour - uSelected));

      vec3 p = position;
      float headY = mod(p.y * colHeight - uTime * speed + aRandom.y * colHeight, colHeight);
      p.y = headY + aTail * lengthRain;
      float verticalFade = smoothstep(0.0, 1.25 + n * 0.6, headY)
                         * (1.0 - smoothstep(colHeight - (2.1 + n * 0.8), colHeight, headY));
      p.x += sin(uTime * 0.55 + aRandom.z * 6.2831) * 0.016 * uWind
           + aTail * aTail * 0.018;
      p.z += sin(uTime * 0.21 + aRandom.w * 6.2831) * 0.009 * uWind;

      float strand = 0.68 + 0.64 * fract(aRandom.z * 37.0 + aRandom.w * 11.0);
      vAlpha = (0.125 + mmh * 0.013) * dropActive * verticalFade * strand
             * (1.0 + selected * 0.42) * uGain;
      vSelected = selected;
      vTail = aTail;
      vReflection = uReflection;

      vec4 world = modelMatrix * vec4(p, 1.0);
      vFog = 1.0 - smoothstep(uFadeNear, uFadeFar, distance(cameraPosition, world.xyz));

      if (uReflection > 0.5) {
        p.y = -p.y * 0.32 - 0.06;
        p.x += sin(p.y * 18.0 + uTime * 1.4 + aRandom.z * 4.0) * 0.045;
      }
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  const RAIN_FRAG = `
    precision highp float;
    varying float vAlpha, vTail, vSelected, vReflection, vFog;
    uniform float uReflectAmount;
    void main(){
      float tail  = pow(clamp(1.0 - vTail, 0.0, 1.0), 1.35);
      float alpha = vAlpha * tail * vFog;
      if (vReflection > 0.5) alpha *= uReflectAmount;
      if (alpha < 0.004) discard;
      vec3 color = mix(vec3(0.46, 0.60, 0.70), vec3(0.90, 0.97, 1.0), tail);
      color += vSelected * 0.045;
      if (vReflection > 0.5) color *= vec3(0.55, 0.74, 0.88);
      gl_FragColor = vec4(color, alpha);
    }
  `;

  /* --------------------------------------------------------------- ground water
     Procedural fbm puddles, hard water line, grazing sheen, three ripple
     scales and twinkling micro-impacts. Coverage follows accumulated rain.   */
  const PUDDLE_VERT = `
    varying vec3 vWorld;
    void main(){
      vec4 world = modelMatrix * vec4(position, 1.0);
      vWorld = world.xyz;
      gl_Position = projectionMatrix * viewMatrix * world;
    }
  `;

  const PUDDLE_FRAG = `
    precision highp float;
    uniform float uTime, uWater, uRain;
    varying vec3 vWorld;

    float hash21(vec2 p){
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    float vnoise(vec2 p){
      vec2 i = floor(p), f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      float a = hash21(i), b = hash21(i + vec2(1.0, 0.0));
      float c = hash21(i + vec2(0.0, 1.0)), d = hash21(i + vec2(1.0, 1.0));
      return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }
    float fbm(vec2 p){
      float v = 0.0, amp = 0.5;
      for (int i = 0; i < 4; i++){ v += amp * vnoise(p); p *= 2.03; amp *= 0.5; }
      return v;
    }
    float ringLayer(vec2 q, float cell, float speed, float seed, float width){
      vec2 g = q / cell + seed;
      vec2 id = floor(g);
      vec2 f = fract(g) - 0.5;
      float rnd = hash21(id + seed);
      vec2 jitter = vec2(hash21(id + 3.1), hash21(id + 7.7)) - 0.5;
      float phase = fract(uTime * (speed * (0.55 + rnd * 0.9)) + rnd);
      float radius = phase * 0.44;
      float dist = length(f - jitter * 0.34);
      float ring = 1.0 - smoothstep(width, width * 2.7, abs(dist - radius));
      ring *= (1.0 - phase) * (1.0 - phase);
      // double wavefront + a hard pinprick at the moment of the hit
      float ring2 = 1.0 - smoothstep(width * 1.8, width * 4.0, abs(dist - radius * 0.56));
      ring2 *= (1.0 - phase) * 0.30;
      float hit = 1.0 - smoothstep(0.0, 0.055, dist);
      hit *= smoothstep(0.22, 0.0, phase);
      return ring + ring2 + hit * 1.15;
    }
    void main(){
      vec2 q = vWorld.xz;
      float maskNoise = fbm(q * 0.42 + 9.3) * 0.72 + fbm(q * 1.35 + 3.1) * 0.28;
      float threshold = mix(0.82, 0.44, uWater);
      float puddle = smoothstep(threshold - 0.012, threshold + 0.012, maskNoise);
      float rim = 1.0 - smoothstep(0.0, 0.022, abs(maskNoise - threshold));
      float field = smoothstep(-25.0, -17.5, q.x) * (1.0 - smoothstep(17.5, 25.0, q.x));
      puddle *= field;
      rim *= field;

      vec3 viewDir = normalize(cameraPosition - vWorld);
      float grazing = pow(1.0 - clamp(viewDir.y, 0.0, 1.0), 3.0);
      float depth = smoothstep(threshold, threshold + 0.3, maskNoise);
      vec3 water = mix(vec3(0.018, 0.027, 0.038), vec3(0.007, 0.011, 0.017), depth);

      // three scales of expanding wavefronts, the finest one very fast
      float ripples = ringLayer(q, 2.6, 0.55, 4.4, 0.028)
                    + ringLayer(q + 13.0, 1.35, 0.80, 11.7, 0.040) * 0.58
                    + ringLayer(q * 2.15 + 7.0, 0.92, 1.45, 23.1, 0.052) * 0.26;
      ripples *= puddle * (0.34 + uRain * 1.15);

      // countless tiny fresh impacts twinkling across the wet surface
      vec2 mcell = floor(q * 6.0);
      float mrnd = hash21(mcell + floor(uTime * 11.0) * 7.13);
      float mphase = fract(uTime * 11.0);
      float micro = step(0.968, mrnd) * pow(1.0 - mphase, 2.0)
                  * puddle * (0.16 + uRain * 0.62);

      // faint drifting specular streaks sell the wet, mirror-like surface
      float streak = pow(max(0.0, sin(q.x * 3.1 + sin(q.y * 2.3 + uTime * 0.6) * 2.0)), 28.0);
      streak *= puddle * grazing * 0.08;

      vec3 sheen = vec3(0.50, 0.68, 0.84) *
                   (grazing * 0.045 + ripples * 0.72 + rim * 0.15 + streak * 0.5
                    + micro * 0.85);
      float alpha = puddle * (0.36 + grazing * 0.22) + rim * 0.10;
      alpha *= 1.0 - smoothstep(34.0, 68.0, distance(vWorld, cameraPosition));
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(water + sheen, clamp(alpha, 0.0, 1.0));
    }
  `;

  /* ------------------------------------------------------------- per-hour light pools */
  const POOL_VERT = `
    attribute vec3 aOffset;
    attribute float aIntensity, aHour, aSeed;
    uniform float uSelected, uHourSpacing;
    varying vec2 vUv;
    varying float vMmH, vSeed, vSelected;
    void main(){
      vec3 p = position * vec3(3.35 + aIntensity * 0.1, 1.0, 6.0 + aIntensity * 0.08) + aOffset;
      vUv = uv; vMmH = aIntensity; vSeed = aSeed;
      vSelected = 1.0 - smoothstep(0.35, 1.35, abs(aHour - uSelected));
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  const POOL_FRAG = `
    precision highp float;
    uniform float uTime, uWater;
    varying vec2 vUv;
    varying float vMmH, vSeed, vSelected;
    void main(){
      vec2 p = vUv * 2.0 - 1.0;
      float n = clamp(vMmH / 20.0, 0.0, 1.0);
      float r = length(p * vec2(0.82, 1.3));
      float core = exp(-r * r * 3.0);
      float band = exp(-abs(p.y) * 4.0) * exp(-p.x * p.x * 1.1);
      float ripple = pow(0.5 + 0.5 * sin(r * 40.0 - uTime * (2.0 + n * 2.0) + vSeed * 6.2831), 12.0);
      ripple *= exp(-r * 2.0) * 0.14;
      float sparkle = pow(max(0.0, sin(p.x * 52.0 + sin(p.y * 17.0 + uTime) * 2.0)), 24.0);
      sparkle *= exp(-r * r * 2.2) * (0.25 + n);
      band *= 0.25 + 0.75 * step(0.42, fract(vSeed * 7.31));
      float alpha = (core * 0.10 + band * 0.075 + ripple * 0.09 + sparkle * 0.05) * (0.24 + n * 0.82);
      alpha *= 1.0 + vSelected * 0.48;
      alpha *= 0.78 + uWater * 0.55;
      if (alpha < 0.004) discard;
      gl_FragColor = vec4(0.58, 0.75, 0.86, alpha);
    }
  `;

  /* ====================================================== drop impact system
     Independently designed from published drop-impact morphology:
       - Deegan, Brunet & Eggers, "Rayleigh-Plateau instability causes the
         crown splash" (arXiv:0806.3050): the ejecta-sheet rim breaks into
         evenly spaced cusps; each cusp sheds secondary droplets; their
         number and size distribution follow the instability spectrum.
       - Worthington / A.M. Worthington: crater collapse refocuses radial
         inflow into a thin central jet whose tip pinches off a rebound drop.
       - MengTo/Skills "water-crystal-skill-vfx" (MIT) for the practical VFX
         recipe: lopsided lathe crown (56x7), aerated-white foot and rim,
         clear thin sheet, analytic ripple packets, screen-space beads.
     Every instance carries its OWN drop size, so a fine drizzle and a fat
     drop produce visibly different crowns, jets and spray.                  */
  const RIPPLE_VERT = `
    attribute vec3 aOffset;
    attribute float aBirth, aLife, aSize, aSeed, aPower;
    uniform float uTime;
    varying vec2 vUv;
    varying float vAge, vSeed, vPower;
    void main(){
      float age = (uTime - aBirth) / aLife;
      float alive = step(0.0, age) * step(age, 1.0);
      float t = clamp(age, 0.0, 1.0);
      float grow = 0.18 + 0.82 * (1.0 - pow(1.0 - t, 1.6));
      vec3 p = position * (aSize * grow * alive) + aOffset;
      vUv = uv; vAge = age; vSeed = aSeed; vPower = aPower;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  /* Leading crest plus trailing capillary waves; width and wavelength grow
     with time, amplitude decays, and both ends ease so recycled slots never pop. */
  const RIPPLE_FRAG = `
    precision highp float;
    varying vec2 vUv;
    varying float vAge, vSeed, vPower;
    void main(){
      if (vAge < 0.0 || vAge > 1.0) discard;
      vec2 p = vUv * 2.0 - 1.0;
      float r = length(p);
      if (r > 1.0) discard;
      float t = vAge;
      float front = 0.28 + 0.66 * t;
      float w = 0.028 + 0.052 * t;
      float lead = exp(-pow((r - front) / w, 2.0));
      float tail = exp(-pow((r - front + 0.15) / (w * 1.7), 2.0)) * 0.40
                 + exp(-pow((r - front + 0.29) / (w * 2.2), 2.0)) * 0.18;
      float ang = atan(p.y, p.x);
      float spokes = pow(0.5 + 0.5 * sin(ang * 17.0 + vSeed * 31.0), 10.0);
      float flash = exp(-r * r * 120.0) * smoothstep(0.14, 0.0, t) * 1.7;
      float halo  = exp(-r * r * 10.0) * smoothstep(0.30, 0.0, t) * 0.38;
      float ease  = smoothstep(0.0, 0.07, t) * (1.0 - smoothstep(0.70, 1.0, t));
      float a = (lead * 0.30 + tail * 0.24 + lead * spokes * 0.10) * ease + flash + halo;
      a *= (0.45 + vPower * 0.72) * (1.0 - smoothstep(0.90, 1.0, r));
      if (a < 0.004) discard;
      vec3 col = mix(vec3(0.40, 0.64, 0.84), vec3(0.92, 0.99, 1.0),
                     clamp(flash + lead * 0.5, 0.0, 1.0));
      gl_FragColor = vec4(col, a);
    }
  `;

  /* ------------------------------------------------- short-lived strike flash */
  const IMPACT_VERT = `
    attribute vec3 aOffset;
    attribute float aBirth, aLife, aSize, aPower;
    uniform float uTime;
    varying vec2 vUv;
    varying float vAge, vPower;
    void main(){
      float age = (uTime - aBirth) / aLife;
      float alive = step(0.0, age) * step(age, 1.0);
      vec3 p = position * (aSize * (0.30 + age * 0.85) * alive) + aOffset;
      vUv = uv; vAge = age; vPower = aPower;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }
  `;

  const IMPACT_FRAG = `
    precision highp float;
    varying vec2 vUv;
    varying float vAge, vPower;
    void main(){
      if (vAge < 0.0 || vAge > 1.0) discard;
      float r = length(vUv * 2.0 - 1.0);
      if (r > 1.0) discard;
      float t = vAge;
      float pin   = exp(-r * r * 110.0) * smoothstep(0.24, 0.0, t) * 2.2;
      float glow  = exp(-r * r * 9.0)  * smoothstep(0.58, 0.0, t) * 0.46;
      float shock = exp(-pow((r - (0.12 + t * 0.72)) / (0.06 + t * 0.05), 2.0))
                  * pow(1.0 - t, 1.5) * 0.28;
      float a = (pin + glow + shock) * (0.5 + vPower * 0.7) * 1.10;
      if (a < 0.004) discard;
      gl_FragColor = vec4(mix(vec3(0.52, 0.74, 0.90), vec3(0.95, 0.99, 1.0), clamp(pin, 0.0, 1.0)), a);
    }
  `;

  /* ------------------------------------------------------------- crown sheet
     A real lathed ring (40 segments x 6 rows per instance), NOT crossed
     billboards. The ejecta sheet rises and flares, is deliberately lopsided,
     and its rim breaks into Rayleigh-Plateau cusps.                        */
  const SPLASH_VERT = `
    attribute vec3 aOffset;
    attribute float aBirth, aLife, aScale, aSeed, aPower, aSpikes;
    uniform float uTime;
    varying vec2 vUv;
    varying float vAge, vSeed, vPower, vCusp, vSide, vFres;
    void main(){
      float age = (uTime - aBirth) / aLife;
      float alive = step(0.0, age) * step(age, 1.0);
      float t = clamp(age, 0.0, 1.0);
      float u = uv.x, v = uv.y;
      float ang = u * 6.2831853;
      float lift = sin(3.1415926 * min(1.0, 1.15 * t));
      float side = 0.5 + 0.5 * cos(ang - vSeed * 6.2831853);
      float asym = mix(0.36, 1.0, pow(side, 1.5));
      float cusp = pow(0.5 + 0.5 * cos(ang * aSpikes + vSeed * 57.0), 9.0);
      float rim  = 1.0 + cusp * 1.35 * pow(v, 3.0);
      float flare = 0.40 + 0.95 * t;
      float R = aScale * (0.38 + 0.62 * v) * flare;
      float H = aScale * 0.76 * lift * v * asym * rim;
      R += aScale * 0.08 * pow(v, 4.0) * lift;
      vec3 p = vec3(cos(ang) * R, H, sin(ang) * R) * alive + aOffset;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vec3 n = normalize(vec3(cos(ang), 0.42, sin(ang)));
      vec3 nv = normalize((modelViewMatrix * vec4(n, 0.0)).xyz);
      vFres = pow(1.0 - abs(dot(nv, normalize(-mv.xyz))), 2.0);
      vUv = vec2(u, v); vAge = age; vSeed = aSeed; vPower = aPower;
      vCusp = cusp; vSide = side;
      gl_Position = projectionMatrix * mv;
    }
  `;

  const SPLASH_FRAG = `
    precision highp float;
    varying vec2 vUv;
    varying float vAge, vSeed, vPower, vCusp, vSide, vFres;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main(){
      if (vAge < 0.0 || vAge > 1.0) discard;
      float t = vAge, u = vUv.x, v = vUv.y;
      float tear = hash(vec2(floor(u * 64.0), floor(vSeed * 97.0)));
      float rip = smoothstep(0.50, 1.0, t) * (0.30 + tear * 0.65) * (1.0 - vCusp * 0.45);
      if (v > 1.0 - rip) discard;
      float foot = exp(-pow(v / 0.17, 2.0));
      float rim  = smoothstep(0.78, 1.0, v);
      float fil  = pow(0.5 + 0.5 * cos(u * 6.2831853 * 46.0 + vSeed * 31.0), 12.0) * (1.0 - v);
      // a thin, mostly clear sheet: only the foot, the aerated rim and the
      // silver grazing edge carry light. Low alpha is essential here: the
      // near and far walls of the ring add together under additive blending.
      float a = foot * 0.22 + rim * 0.40 + (0.06 + 0.20 * vFres) * 0.38 + fil * 0.085;
      a *= (0.50 + vPower * 0.48) * (0.55 + 0.45 * vSide);
      a *= smoothstep(0.0, 0.05, t) * (1.0 - smoothstep(0.60, 1.0, t));
      if (a < 0.004) discard;
      vec3 clear = vec3(0.36, 0.60, 0.82);
      vec3 foam  = vec3(0.93, 0.98, 1.0);
      vec3 col = mix(clear, foam, clamp(foot * 0.75 + rim * 0.85 + vFres * 0.5, 0.0, 1.0));
      gl_FragColor = vec4(col, a);
    }
  `;

  /* --------------------------------------------------- Worthington jet column
     Only big drops: the collapsed crater fires a thin tapered column whose
     bead-like tip pinches off. The detached drop is emitted separately.      */
  const JET_VERT = `
    attribute vec3 aOffset;
    attribute float aBirth, aLife, aScale, aSeed, aPower;
    uniform float uTime;
    varying vec2 vUv;
    varying float vAge, vPower, vFres;
    void main(){
      float age = (uTime - aBirth) / aLife;
      float alive = step(0.0, age) * step(age, 1.0);
      float t = clamp(age, 0.0, 1.0);
      float u = uv.x, v = uv.y;
      float ang = u * 6.2831853;
      float rise = sin(3.1415926 * min(1.0, 1.05 * t));
      float H = aScale * 2.7 * rise;
      float R = aScale * 0.105 * (1.0 - 0.78 * v) * (0.55 + 0.45 * rise);
      R += aScale * 0.052 * exp(-pow((v - 0.93) / 0.075, 2.0)) * smoothstep(0.25, 0.55, t);
      float sway = aScale * 0.06 * sin(t * 7.0 + aSeed * 19.0) * v;
      vec3 p = vec3(cos(ang) * R + sway, H * v, sin(ang) * R) * alive + aOffset;
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vec3 n = normalize(vec3(cos(ang), 0.18, sin(ang)));
      vec3 nv = normalize((modelViewMatrix * vec4(n, 0.0)).xyz);
      vFres = pow(1.0 - abs(dot(nv, normalize(-mv.xyz))), 2.0);
      vUv = vec2(u, v); vAge = age; vPower = aPower;
      gl_Position = projectionMatrix * mv;
    }
  `;

  const JET_FRAG = `
    precision highp float;
    varying vec2 vUv;
    varying float vAge, vPower, vFres;
    void main(){
      if (vAge < 0.0 || vAge > 1.0) discard;
      float v = vUv.y;
      float tip = exp(-pow((v - 0.93) / 0.10, 2.0));
      float a = (0.14 + 0.42 * vFres + tip * 0.58) * (0.45 + vPower * 0.55);
      a *= smoothstep(0.0, 0.06, vAge) * (1.0 - smoothstep(0.58, 1.0, vAge));
      if (a < 0.004) discard;
      vec3 col = mix(vec3(0.42, 0.68, 0.88), vec3(0.95, 0.99, 1.0), clamp(tip + vFres * 0.6, 0.0, 1.0));
      gl_FragColor = vec4(col, a);
    }
  `;

  /* ------------------------------------------------ ballistic secondary beads
     Instanced screen-space quads, stretched along the projected velocity,
     with a dark core, a silver rim, one highlight and a thin trailing
     filament. aSize varies per bead AND per parent drop.                    */
  const DROPLET_VERT = `
    precision highp float;
    attribute vec2 aCorner;
    attribute vec3 aOffset, aVel;
    attribute float aBirth, aLife, aSeed, aSize, aPower;
    uniform float uTime, uPR;
    uniform vec2 uRes;
    varying vec2 vUv;
    varying float vAlpha, vPower, vSeed;
    void main(){
      float age = uTime - aBirth;
      vUv = aCorner; vSeed = aSeed; vPower = aPower;
      if (age < 0.0 || age > aLife) {
        gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
        vAlpha = 0.0; return;
      }
      float t = age;
      vec3 vel = aVel * (1.0 - 0.16 * t);
      vec3 p = aOffset + vel * t;
      p.y -= 5.2 * t * t;
      p.y = max(p.y, 0.035);
      vec4 mv = modelViewMatrix * vec4(p, 1.0);
      vec4 mv2 = modelViewMatrix * vec4(p + vel * 0.02, 1.0);
      vec2 dir = (mv2.xy / mv2.w - mv.xy / mv.w) * vec2(uRes.x / uRes.y, 1.0);
      float sp = length(dir);
      vec2 axis = sp > 1e-5 ? dir / sp : vec2(0.0, 1.0);
      vec2 perp = vec2(-axis.y, axis.x);
      float px = clamp(aSize * uPR * (62.0 / max(-mv.z, 1.0)), 0.9, 7.5 * uPR);
      float stretch = 1.0 + min(sp * 16.0, 1.25);
      vec2 offPx = (perp * aCorner.x + axis * aCorner.y * stretch) * px;
      vec4 clip = projectionMatrix * mv;
      clip.xy += (offPx / uRes) * 2.0 * clip.w;
      gl_Position = clip;
      float k = age / aLife;
      vAlpha = smoothstep(0.0, 0.06, k) * pow(1.0 - k, 1.18);
    }
  `;

  const DROPLET_FRAG = `
    precision highp float;
    varying vec2 vUv;
    varying float vAlpha, vPower, vSeed;
    void main(){
      vec2 p = vUv;
      // the bead occupies the upper part of the quad; everything below is a
      // thin trailing filament. Without this mask the quad fills as a bar.
      float beadMask = smoothstep(-0.42, -0.08, p.y);
      float body = length(vec2(p.x * 1.12, max(p.y, 0.0) + min(p.y, 0.0) * 0.42));
      float core = (1.0 - smoothstep(0.30, 1.0, body)) * beadMask;
      float rim  = exp(-pow((body - 0.76) / 0.22, 2.0)) * beadMask;
      float hi   = exp(-pow(length(p - vec2(-0.24, 0.30)) / 0.23, 2.0));
      float tail = exp(-pow(p.x / 0.11, 2.0)) * smoothstep(0.10, 0.55, -p.y)
                 * (1.0 - smoothstep(0.75, 1.0, -p.y)) * 0.28;
      float a = (core * 0.24 + rim * 0.72 + hi * 0.80 + tail * 1.25) * vAlpha * (0.55 + vPower * 0.70);
      if (a < 0.004) discard;
      vec3 col = mix(vec3(0.40, 0.66, 0.88), vec3(0.96, 0.99, 1.0), clamp(rim * 0.7 + hi, 0.0, 1.0));
      gl_FragColor = vec4(col, a);
    }
  `;

  /* ------------------------------------------------------------------- bloom */
  const BRIGHT_FRAG = `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform float uThreshold;
    varying vec2 vUv;
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, l), 1.0);
    }
  `;

  const BLUR_FRAG = `
    precision highp float;
    uniform sampler2D tDiffuse;
    uniform vec2 uDir;
    varying vec2 vUv;
    void main(){
      vec3 s = texture2D(tDiffuse, vUv).rgb * 0.227027;
      s += (texture2D(tDiffuse, vUv + uDir * 1.3846).rgb +
            texture2D(tDiffuse, vUv - uDir * 1.3846).rgb) * 0.316216;
      s += (texture2D(tDiffuse, vUv + uDir * 3.2307).rgb +
            texture2D(tDiffuse, vUv - uDir * 3.2307).rgb) * 0.070270;
      gl_FragColor = vec4(s, 1.0);
    }
  `;

  const COMPOSITE_FRAG = `
    precision highp float;
    uniform sampler2D tScene, tBloom;
    uniform float uTime, uBloom, uExposure;
    uniform vec2 uRes;
    varying vec2 vUv;
    void main(){
      vec2 uv = vUv;
      vec2 d = uv - 0.5;
      float ca = dot(d, d) * 0.0024;
      vec3 c;
      c.r = texture2D(tScene, uv + d * ca).r;
      c.g = texture2D(tScene, uv).g;
      c.b = texture2D(tScene, uv - d * ca).b;
      c += texture2D(tBloom, uv).rgb * uBloom;
      float glow = exp(-length((uv - vec2(0.5, 0.42)) * vec2(1.0, 1.3)) * 3.2);
      c += vec3(0.010, 0.025, 0.046) * glow;
      float vig = 1.0 - smoothstep(0.34, 0.96, length(d * vec2(1.05, 1.0)));
      c *= mix(0.42, 1.0, vig);
      c *= uExposure;
      c = c / (1.0 + c * 0.22);
      c = clamp(c, 0.0, 1.0);
      float g = fract(sin(dot(uv * uRes + uTime * 13.0, vec2(12.9898, 78.233))) * 43758.5453);
      c += (g - 0.5) * 0.011;
      gl_FragColor = vec4(c, 1.0);
    }
  `;

  w.RAIN_SH = {
    QUAD_VERT, RAIN_VERT, RAIN_FRAG,
    PUDDLE_VERT, PUDDLE_FRAG, POOL_VERT, POOL_FRAG,
    RIPPLE_VERT, RIPPLE_FRAG, IMPACT_VERT, IMPACT_FRAG,
    SPLASH_VERT, SPLASH_FRAG, JET_VERT, JET_FRAG,
    DROPLET_VERT, DROPLET_FRAG,
    BRIGHT_FRAG, BLUR_FRAG, COMPOSITE_FRAG
  };
})(window);

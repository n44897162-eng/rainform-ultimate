/* Pure-Node PNG / ICO generator — no npm packages, no Python, no ImageMagick.
 * Draws the Rainform mark (rain strands + droplet + data bars) at 3x
 * supersampling, then box-downsamples for clean edges at every size.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const PROJECT = path.resolve(__dirname, '..');
const SS = 3;                       // supersampling factor

/* ------------------------------------------------------------ PNG encoder */
const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, 'ascii');
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, c]);
}
function png(width, height, rgba) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;                       // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6;                          // 8-bit RGBA
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}
function ico(pngBuf, size) {
  const head = Buffer.alloc(6);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(1, 4);
  const entry = Buffer.alloc(16);
  entry[0] = size >= 256 ? 0 : size;
  entry[1] = size >= 256 ? 0 : size;
  entry[2] = 0; entry[3] = 0;
  entry.writeUInt16LE(1, 4); entry.writeUInt16LE(32, 6);
  entry.writeUInt32LE(pngBuf.length, 8);
  entry.writeUInt32LE(22, 12);
  return Buffer.concat([head, entry, pngBuf]);
}

/* --------------------------------------------------------------- artwork */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const mix = (a, b, t) => a + (b - a) * t;

function drawIcon(size, maskable) {
  const ss = size >= 1024 ? 2 : SS;              // keep the 1024 asset fast
  const W = size * ss, H = size * ss;
  const hi = Buffer.alloc(W * H * 4);
  const contentScale = maskable ? 0.60 : 0.80;
  const radius = maskable ? 0 : 0.225;             // rounded square vs full-bleed

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const u = (x + 0.5) / W, v = (y + 0.5) / H;
      let a = 255;

      // rounded-rect silhouette: only the four CORNERS are rounded;
      // straight edges stay fully opaque (no halo after downsampling).
      if (radius > 0) {
        const qx = Math.min(u, 1 - u), qy = Math.min(v, 1 - v);
        if (qx < radius && qy < radius) {
          const d = Math.hypot(radius - qx, radius - qy);
          a = clamp((radius - d) * W, 0, 255);
        }
      }

      // base gradient + soft top-left halo
      const grad = v;
      let r = mix(10, 2, grad), g = mix(32, 7, grad), b = mix(56, 14, grad);
      const halo = Math.exp(-(((u - 0.32) ** 2) / 0.10 + ((v - 0.18) ** 2) / 0.10));
      r += 12 * halo; g += 34 * halo; b += 56 * halo;
      const vig = 1 - 0.28 * Math.min(1, ((u - 0.5) ** 2 + (v - 0.5) ** 2) / 0.5);
      r *= vig; g *= vig; b *= vig;

      // content coordinate system (keeps the mark inside the maskable safe zone)
      const cx = (u - 0.5) / contentScale + 0.5;
      const cy = (v - 0.5) / contentScale + 0.46;

      // --- falling strands: 4 tapered diagonal lines -----------------------
      for (let i = 0; i < 4; i++) {
        const x0 = 0.20 + i * 0.19;
        const seg = clamp((cy - 0.03 - i * 0.012) / 0.40, 0, 1);
        if (seg <= 0 || seg >= 1) continue;
        const lx = x0 + seg * 0.085;
        const d = Math.abs(cx - lx);
        const w = 0.010 * (1 - 0.45 * seg);
        if (d < w) {
          const iA = (1 - d / w) * (1 - seg * 0.55) * 0.85;
          r = mix(r, 150, iA); g = mix(g, 216, iA); b = mix(b, 255, iA);
        }
      }

      // --- central droplet (circle + pointed crown) ------------------------
      const dcx = cx - 0.50, dcy = cy - 0.455;
      const inCircle = dcx * dcx + dcy * dcy < 0.118 * 0.118;
      const inCrown = cy >= 0.245 && cy <= 0.47 &&
        Math.abs(dcx) < 0.118 * (cy - 0.245) / (0.47 - 0.245);
      if (inCircle || inCrown) {
        const shade = clamp((cy - 0.27) / 0.30, 0, 1);
        const k = 0.92;
        r = mix(r, mix(196, 66, shade), k);
        g = mix(g, mix(238, 168, shade), k);
        b = mix(b, mix(255, 240, shade), k);
        // specular highlight
        const hl = Math.exp(-(((dcx + 0.035) ** 2) / 0.0011 + ((dcy + 0.035) ** 2) / 0.0022));
        r = mix(r, 255, hl * 0.85); g = mix(g, 255, hl * 0.85); b = mix(b, 255, hl * 0.85);
      }

      // --- data bars at the bottom -----------------------------------------
      const bars = [0.22, 0.36, 0.58, 0.92, 0.70, 0.44, 0.26];
      for (let i = 0; i < bars.length; i++) {
        const bx0 = 0.225 + i * 0.079;
        const hgt = bars[i] * 0.155;
        if (cx > bx0 && cx < bx0 + 0.043 && cy > 0.80 - hgt && cy < 0.80) {
          const fade = 0.35 + 0.55 * clamp((0.80 - cy) / 0.16, 0, 1);
          r = mix(r, 120, fade); g = mix(g, 200, fade); b = mix(b, 255, fade);
        }
      }
      // water line
      if (cy > 0.802 && cy < 0.814 && cx > 0.20 && cx < 0.80) {
        r = mix(r, 143, 0.55); g = mix(g, 214, 0.55); b = mix(b, 255, 0.55);
      }

      const p = (y * W + x) * 4;
      hi[p] = clamp(Math.round(r), 0, 255);
      hi[p + 1] = clamp(Math.round(g), 0, 255);
      hi[p + 2] = clamp(Math.round(b), 0, 255);
      hi[p + 3] = Math.round(a);
    }
  }

  // 3x box downsample
  const out = Buffer.alloc(size * size * 4);
  const n = ss * ss;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) for (let sx = 0; sx < ss; sx++) {
        const p = ((y * ss + sy) * W + (x * ss + sx)) * 4;
        r += hi[p]; g += hi[p + 1]; b += hi[p + 2]; a += hi[p + 3];
      }
      const o = (y * size + x) * 4;
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n);
      out[o + 2] = Math.round(b / n); out[o + 3] = Math.round(a / n);
    }
  }
  return png(size, size, out);
}

/* ------------------------------------------------------------------ build */
function build() {
  const dirs = [
    path.join(PROJECT, 'app/pwa/icons'),
    path.join(PROJECT, 'app/desktop/icons'),
    path.join(PROJECT, 'app/mobile/icons')
  ];
  dirs.forEach(d => fs.mkdirSync(d, { recursive: true }));

  const sizes = [48, 64, 72, 96, 144, 180, 192, 256, 512];
  const cache = new Map();
  for (const s of sizes) cache.set(s, drawIcon(s, false));
  const mask512 = drawIcon(512, true);

  const write = (p, buf) => { fs.writeFileSync(p, buf); console.log('icon:', path.relative(PROJECT, p), (buf.length / 1024).toFixed(1) + ' KB'); };
  const pwa = dirs[0], desk = dirs[1], mob = dirs[2];
  write(path.join(pwa, 'icon-64.png'), cache.get(64));
  write(path.join(pwa, 'icon-192.png'), cache.get(192));
  write(path.join(pwa, 'icon-512.png'), cache.get(512));
  write(path.join(pwa, 'maskable-512.png'), mask512);
  write(path.join(pwa, 'apple-touch-icon.png'), cache.get(180));
  write(path.join(desk, 'icon.png'), cache.get(512));
  write(path.join(desk, 'icon.ico'), ico(cache.get(256), 256));
  write(path.join(mob, 'icon-1024.png'), drawIcon(1024, false));
  write(path.join(mob, 'icon-512.png'), cache.get(512));
  [48, 72, 96, 144, 192].forEach(s => write(path.join(mob, 'icon-' + s + '.png'), cache.get(s)));
  write(path.join(PROJECT, 'app/pwa/favicon.png'), cache.get(64));
  return true;
}

if (require.main === module) build();
module.exports = { build, drawIcon, png, ico };

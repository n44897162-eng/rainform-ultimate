#!/usr/bin/env node
/* =============================================================================
 * Build every installable edition from the ONE source of truth:
 *
 *   node build-apps.js
 *
 *   Rainform-Ultimate-standalone.html   single file, zero external refs
 *   app/pwa/index.html                 installable PWA (PC / Android / iOS)
 *   app/desktop/www/index.html         Electron desktop app shell
 *   app/mobile/www/index.html          Capacitor Android + iOS app shell
 *   icons/*                            generated PNG / ICO assets
 *
 * The app logic lives ONLY in src/* — nothing is hand-edited in the copies.
 * ========================================================================== */
'use strict';
const fs = require('fs');
const path = require('path');
const R = __dirname;
const read = p => fs.readFileSync(path.join(R, p), 'utf8');
const write = (p, s) => {
  fs.mkdirSync(path.dirname(path.join(R, p)), { recursive: true });
  fs.writeFileSync(path.join(R, p), s, 'utf8');
};
const copy = (a, b) => {
  const dst = path.join(R, b);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(path.join(R, a), dst);
};

/* 1. rebuild the standalone single-file edition --------------------------- */
require('./build-standalone.js');
const html = read('Rainform-Ultimate-standalone.html');
console.log('');

/* 2. generate all icons --------------------------------------------------- */
require('./tools/make-icons.js').build();
console.log('');

/* 2.5 per-platform boot flags --------------------------------------------
 * 三端行为差异只从这里注入，src/ 里不写平台判断：
 *   __RAINFORM_TARGET__      pwa | desktop | mobile（Android 由 bridge.js 补）
 *   __RAINFORM_API_BASE__    可选：打包时指定后端，例如
 *                            RAINFORM_API_BASE=https://rain.example.com node build-apps.js
 *                            不指定则运行时按「同源 → ?api= → 已保存的服务器地址」解析。
 */
const API_BASE = (process.env.RAINFORM_API_BASE || '').replace(/['"\\\r\n]/g, '').trim();
function platformScript(target) {
  return '<script>window.__RAINFORM_TARGET__=' + JSON.stringify(target) + ';' +
    (API_BASE ? 'window.__RAINFORM_API_BASE__=' + JSON.stringify(API_BASE) + ';' : '') +
    '</script>';
}

/* 3. PWA edition ----------------------------------------------------------- */
const pwaHead = [
  '<link rel="manifest" href="manifest.webmanifest">',
  '<link rel="icon" type="image/png" sizes="64x64" href="favicon.png">',
  '<link rel="apple-touch-icon" href="icons/apple-touch-icon.png">',
  '<link rel="apple-touch-startup-image" href="icons/icon-512.png">',
  '<meta name="application-name" content="Rainform">',
  '<meta name="msapplication-TileColor" content="#03070d">'
].join('\n');
const pwaHtml = html.replace('</head>', pwaHead + '\n' + platformScript('pwa') + '\n</head>');
write('app/pwa/index.html', pwaHtml);
console.log('PWA      :', 'app/pwa/index.html', (Buffer.byteLength(pwaHtml, 'utf8') / 1024).toFixed(1) + ' KB');

/* 4. Electron desktop edition --------------------------------------------- */
write('app/desktop/www/index.html', html.replace('</head>', platformScript('desktop') + '\n</head>'));
console.log('Desktop  :', 'app/desktop/www/index.html');
copy('app/desktop/icons/icon.png', 'app/desktop/www/icon.png');

/* 5. Capacitor mobile edition (Android + iOS) ------------------------------ */
const bridge = read('app/mobile/native-bridge.js');
const mobileHtml = html.replace('</head>', platformScript('mobile') + '\n</head>')
  .replace('</body>', '<script>\n' + bridge + '\n</script>\n</body>');
write('app/mobile/www/index.html', mobileHtml);
console.log('Mobile   :', 'app/mobile/www/index.html', '(Capacitor bridge inlined)');
for (const f of ['icon-192.png', 'icon-512.png', 'maskable-512.png', 'apple-touch-icon.png']) {
  copy('app/pwa/icons/' + f, 'app/mobile/www/icons/' + f);
}

console.log('');
console.log('All editions built. Next steps:');
console.log('  node weather/server/server.js --root app/pwa     # serve PWA + live data');
console.log('  cd app/desktop && npm install && npm start       # Electron');
console.log('  cd app/mobile  && npm install && npm run add:android');
console.log('  see docs/APPS.md for Android / iOS / store builds');

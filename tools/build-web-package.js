#!/usr/bin/env node
/** Build the installable Web/PWA delivery: dist/Rainform-Web-1.0.0.zip
 *  Contains the full PWA site, the zero-dependency standalone HTML, and the
 *  bundled local weather gateway so the package is startable offline.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(ROOT, 'tools', '.web-stage');
const VER = require(path.join(ROOT, 'app', 'desktop', 'package.json')).version;
const OUT = path.join(DIST, `Rainform-Web-${VER}.zip`);

function copyTree(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d);
    else if (!/\.(idsig|log|tmp)$/.test(e.name)) fs.copyFileSync(s, d);
  }
}

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });
copyTree(path.join(ROOT, 'app', 'pwa'), path.join(STAGE, 'pwa'));
fs.mkdirSync(path.join(STAGE, 'server', 'providers'), { recursive: true });
['server.js', 'sample-frame.json', 'README.md', 'config.example.json'].forEach(f => {
  const s = path.join(ROOT, 'weather', 'server', f);
  if (fs.existsSync(s)) fs.copyFileSync(s, path.join(STAGE, 'server', f));
});
copyTree(path.join(ROOT, 'weather', 'server', 'providers'), path.join(STAGE, 'server', 'providers'));
fs.copyFileSync(path.join(ROOT, 'Rainform-Ultimate-standalone.html'), path.join(STAGE, 'Rainform-Ultimate-standalone.html'));

fs.writeFileSync(path.join(STAGE, '启动-实时天气站点.cmd'), [
  '@echo off',
  'chcp 65001 >nul',
  'cd /d "%~dp0"',
  'echo Rainform Ultimate - local web + live weather gateway',
  'echo Open http://127.0.0.1:8787/ in your browser, then use "Install app".',
  'node server/server.js --host 127.0.0.1 --port 8787 --root pwa --offline',
  'pause'
].join('\r\n'), 'utf8');

fs.writeFileSync(path.join(STAGE, 'README.txt'), [
  'Rainform Ultimate ' + VER + ' - Web / PWA delivery',
  '',
  '1) Simplest: double-click Rainform-Ultimate-standalone.html (zero dependencies).',
  '2) Installable PWA (needs Node.js): run 启动-实时天气站点.cmd,',
  '   open http://127.0.0.1:8787/ and choose "Install app" in Chrome / Edge.',
  '   The bundled server also exposes the live weather REST / crawler / SSE / WS API.',
  '3) For real internet data: node server/server.js --root pwa  (without --offline)',
  '   and select Open-Meteo in the app\'s Live weather drawer.',
  '',
  'Everything is offline-capable; no CDN, no external assets.'
].join('\r\n'), 'utf8');

// Zip via Python (stdlib zipfile) so no npm dependency is needed.
const py = [
  'import os,sys,zipfile',
  'root=sys.argv[1]; out=sys.argv[2]',
  'if os.path.exists(out): os.remove(out)',
  'z=zipfile.ZipFile(out,"w",zipfile.ZIP_DEFLATED,compresslevel=9)',
  'for dp,dn,fn in os.walk(root):',
  '  dn[:]=[d for d in dn if d not in ("__pycache__",".git")]',
  '  for f in fn:',
  '    p=os.path.join(dp,f)',
  '    z.write(p,os.path.relpath(p,root))',
  'z.close()',
  'print("entries",len(zipfile.ZipFile(out).namelist()))'
].join('\n');
const r = execFileSync('python', ['-c', py, STAGE, OUT], { encoding: 'utf8' });
console.log('written: ' + OUT);
console.log('size   : ' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + ' MB');
console.log(r.trim());
fs.rmSync(STAGE, { recursive: true, force: true });

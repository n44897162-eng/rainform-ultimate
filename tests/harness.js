/* Platform adapters: Web (PWA over local gateway), Windows (packaged Electron),
 * Android (native APK in the emulator). Every adapter exposes the same shape so
 * tests/contract.js is literally shared across the three platforms.
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./lib');

const ROOT = L.ROOT;
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const BASE = 'http://127.0.0.1:8787/';
const GATEWAY = 'http://127.0.0.1:8787';
const ADB = 'F:/Android/Sdk/platform-tools/adb.exe';
const EMULATOR = 'F:/Android/Sdk/emulator/emulator.exe';
const APK = path.join(ROOT, 'dist', 'Rainform-Ultimate-v1.1.0.apk');
const PORTABLE = path.join(ROOT, 'dist', 'Rainform-Ultimate-Portable-1.1.0.exe');
const SETUP = path.join(ROOT, 'dist', 'Rainform-Ultimate-Setup-1.1.0.exe');

const PW = (() => { try { return require('playwright-core'); } catch (e) { return null; } })();

function sh(cmd, args, opts) {
  return execFileSync(cmd, args, Object.assign({ encoding: 'utf8', timeout: 180000, stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
}
function trySh(cmd, args, opts) {
  try { return sh(cmd, args, opts); } catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

async function waitFor(fn, ms, label) {
  const end = Date.now() + ms;
  let last;
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v; } catch (e) { last = e; }
    await L.sleep(400);
  }
  throw new Error('timeout waiting for ' + label + (last ? ' (' + last.message + ')' : ''));
}

/* ------------------------------------------------------------------- WEB */
async function web(rec) {
  if (!PW) throw new Error('playwright-core is not installed; run npm install in tests/');
  const browser = await PW.chromium.launch({
    executablePath: CHROME,
    headless: true,
    args: [
      '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
      '--no-first-run', '--no-default-browser-check', '--disable-dev-shm-usage'
    ]
  });
  const context = await browser.newContext({
    viewport: { width: 1600, height: 1000 },
    deviceScaleFactor: 1,
    ignoreHTTPSErrors: true,
    serviceWorkers: 'allow'
  });
  const page = await context.newPage();
  const meta = {
    driver: 'playwright-core ' + (require('playwright-core/package.json').version),
    browser: 'Google Chrome (headless, SwiftShader WebGL2)',
    url: BASE,
    standalone: path.join(ROOT, 'Rainform-Ultimate-standalone.html')
  };
  const a = L.playwrightAdapter(page, context, 'web', '网页端 Web / PWA', meta, async () => {
    try { await browser.close(); } catch (e) {}
  });
  await a.init();
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await L.sleep(2600);
  rec.env.web = meta;
  return a;
}

/* --------------------------------------------------------------- WINDOWS */
function resolveWindowsExe() {
  // Drive the packaged application directory: it is byte-identical to what
  // both installers deploy, and (unlike the silent self-extractor) it accepts
  // --remote-debugging-port directly. Installer/portable startup is covered by
  // a separate smoke test in run.js.
  const candidates = [
    path.join(ROOT, 'app', 'desktop', 'dist', 'win-unpacked', 'Rainform Ultimate.exe'),
    PORTABLE,
    path.join(ROOT, 'app', 'desktop', 'dist', 'win-unpacked', 'Rainform-Ultimate.exe')
  ];
  for (const p of candidates) if (fs.existsSync(p)) return p;
  return null;
}

async function win(rec) {
  const exe = resolveWindowsExe();
  if (!exe) throw new Error('Windows portable exe not built yet: ' + PORTABLE);
  if (!PW) throw new Error('playwright-core is not installed');

  const PORT = 9332;
  /* The host session exports ELECTRON_RUN_AS_NODE=1 and a NODE_OPTIONS
     shim. Inherited by a spawned Electron app those turn it into a plain Node
     process ("bad option: --remote-debugging-port"), so scrub them here.
     End users never have these variables; the packages themselves are fine. */
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.NODE_OPTIONS;
  const DBG = !!process.env.RAINFORM_TEST_DEBUG;
  const proc = spawn(exe, [
    '--remote-debugging-port=' + PORT,
    '--no-sandbox', '--disable-gpu-sandbox',
    // Keep the renderer alive while the CDP session drives a window that Windows
    // considers occluded/backgrounded. Without these, Chromium can suspend the
    // renderer mid-run and Playwright reports "Target page ... has been closed".
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--weather=server', '--weather-server=' + GATEWAY, '--weather-auto'
  ], { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], detached: false, env });
  const ts = () => new Date().toISOString().slice(11, 23);
  // Always drain the pipes: an unread stdio pipe can stall the child on Windows.
  proc.stdout.on('data', d => { if (DBG) console.error('[win-diag ' + ts() + ' stdout] ' + String(d).slice(0, 240)); });
  proc.stderr.on('data', d => { if (DBG) console.error('[win-diag ' + ts() + ' stderr] ' + String(d).slice(0, 240)); });
  if (DBG) proc.on('exit', (c, s) => console.error('[win-diag ' + ts() + ' proc exit] code=' + c + ' signal=' + s));

  await waitFor(async () => {
    const t = await L.devtoolsTargets(PORT);
    return t.find(x => x.type === 'page');
  }, 60000, 'Electron devtools endpoint');

  const browser = await PW.chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  const context = browser.contexts()[0];
  const page = context.pages()[0] || await context.newPage();
  if (DBG) {
    const ts = () => new Date().toISOString().slice(11, 23);
    browser.on('disconnected', () => console.error('[win-diag ' + ts() + ' browser disconnected]'));
    page.on('close', () => console.error('[win-diag ' + ts() + ' page close]'));
    page.on('crash', () => console.error('[win-diag ' + ts() + ' page crash]'));
    page.on('pageerror', e => console.error('[win-diag ' + ts() + ' pageerror] ' + String(e.message).slice(0, 200)));
  }
  const meta = {
    driver: 'playwright-core connectOverCDP',
    exe, port: PORT,
    url: page.url(),
    runtime: 'Electron 33 / Chromium'
  };
  const a = L.playwrightAdapter(page, context, 'win', 'Windows PC 端', meta, async () => {
    try { await browser.close(); } catch (e) {}
    try { proc.kill(); } catch (e) {}
    trySh('taskkill', ['/F', '/IM', path.basename(exe), '/T']);
    trySh('taskkill', ['/F', '/IM', 'Rainform Ultimate.exe', '/T']);
  });
  await a.init();
  await L.sleep(2600);
  rec.env.win = meta;
  return a;
}

/* --------------------------------------------------------------- ANDROID */
function adb(args, timeout) {
  return sh(ADB, ['-s', 'emulator-5554'].concat(args), { timeout: timeout || 180000 });
}
function adbTry(args, timeout) {
  return trySh(ADB, ['-s', 'emulator-5554'].concat(args), { timeout: timeout || 180000 });
}

async function android(rec) {
  if (!fs.existsSync(APK)) throw new Error('APK not built: ' + APK);

  /* 1. emulator */
  let devices = adbTry(['devices']);
  if (!/emulator-5554\s+device/.test(devices)) {
    const emu = spawn(EMULATOR, [
      '-avd', 'RainformTest', '-no-snapshot-save', '-no-audio', '-no-boot-anim',
      '-no-window', '-gpu', 'swiftshader_indirect', '-memory', '2048'
    ], { stdio: 'ignore', detached: false });
    emu.unref && emu.unref();
    await waitFor(async () => /emulator-5554\s+device/.test(adbTry(['devices'])), 180000, 'emulator connection');
  }
  adb(['wait-for-device'], 180000);
  adb(['shell', 'i=0; while [ "$(getprop sys.boot_completed)" != "1" ] && [ $i -lt 90 ]; do sleep 2; i=$((i+1)); done; echo BOOT=$(getprop sys.boot_completed)'], 240000);

  /* 2. install + launch */
  const install = adbTry(['install', '-r', APK], 240000);
  if (!/Success/i.test(install)) throw new Error('adb install failed: ' + install.slice(-400));
  adbTry(['reverse', 'tcp:8787', 'tcp:8787']);
  adbTry(['shell', 'am', 'force-stop', 'cn.rainform.ultimate']);
  adbTry(['logcat', '-c']);
  adb(['shell', 'monkey', '-p', 'cn.rainform.ultimate', '-c', 'android.intent.category.LAUNCHER', '1']);
  await L.sleep(9000);

  /* 3. WebView devtools forward (pid changes on every launch) */
  const pid = String(adb(['shell', 'pidof', 'cn.rainform.ultimate'])).trim().split(/\s+/)[0];
  if (!/^\d+$/.test(pid)) throw new Error('app process not running; pidof=' + pid);
  adbTry(['forward', '--remove', 'tcp:9229']);
  adb(['forward', 'tcp:9229', 'localabstract:webview_devtools_remote_' + pid]);

  const target = await waitFor(async () => {
    const t = await L.devtoolsTargets(9229);
    return t.find(x => x.type === 'page' && /127\.0\.0\.1|about:blank/.test(x.url || ''));
  }, 60000, 'Android WebView devtools target');

  const cdp = await L.connectRaw(target.webSocketDebuggerUrl);
  const a = L.rawAdapter(cdp, 'android', 'Android 端', {
    driver: 'raw CDP over adb forward',
    apk: APK, pid, emulator: 'Android 11 / API 30 / x86_64 / SwiftShader',
    url: target.url
  }, null);
  await a.init();
  await a.bringToFront();
  rec.env.android = a.meta;
  return a;
}

module.exports = { web, win, android, BASE, GATEWAY, APK, PORTABLE, SETUP, CHROME, ADB, adb, adbTry, trySh };

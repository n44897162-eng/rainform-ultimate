#!/usr/bin/env node
/* Headless CDP self-check for every edition / viewport / transport.
 * Uses only Node built-ins (Node 22 global WebSocket) + a local Chrome.
 *
 *   node tools/verify.js
 *
 * Expects: node weather/server/server.js --offline --port 8787 --root app/pwa
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'previews');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9223;
const BASE = 'http://127.0.0.1:8787/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

const VIEWPORTS = [
  { name: 'pc',        width: 1600, height: 1000, dsf: 1, mobile: false, ua: '' },
  { name: 'android',   width: 390,  height: 844,  dsf: 2, mobile: true,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' },
  { name: 'iphone',    width: 393,  height: 852,  dsf: 3, mobile: true,
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1' },
  { name: 'landscape', width: 844,  height: 390,  dsf: 2, mobile: true,
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36' }
];

let chrome, cdp, page;
const errors = [];
const results = [];

class CDP {
  constructor(ws) {
    this.ws = ws; this.id = 0; this.pending = new Map(); this.handlers = [];
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id); this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method) this.handlers.forEach(h => h(m));
    };
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); rej(new Error('CDP timeout: ' + method)); } }, 30000);
    });
  }
  on(fn) { this.handlers.push(fn); }
}
async function evaluate(expr, awaitPromise) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise: !!awaitPromise,
    userGesture: true
  });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception && r.exceptionDetails.exception.description || ''));
  return r.result.value;
}
async function shot(name) {
  const r = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const p = path.join(OUT, name + '.png');
  fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
  return p;
}
function ok(label, cond, detail) {
  results.push({ label, pass: !!cond, detail: detail || '' });
  console.log((cond ? '  PASS ' : '  FAIL ') + label + (detail ? '  → ' + detail : ''));
}

async function launch() {
  const profile = path.join(os.tmpdir(), 'rainform-cdp-' + Date.now());
  chrome = spawn(CHROME, [
    '--headless=new', '--remote-debugging-port=' + PORT,
    '--user-data-dir=' + profile, '--no-first-run', '--no-default-browser-check',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--allow-insecure-localhost', '--window-size=1600,1000', 'about:blank'
  ], { stdio: 'ignore' });
  let target = null;
  for (let i = 0; i < 40; i++) {
    await sleep(250);
    try {
      const r = await fetch('http://127.0.0.1:' + PORT + '/json/new?about:blank', { method: 'PUT' });
      if (r.ok) { target = await r.json(); break; }
    } catch (e) { /* waiting */ }
  }
  if (!target) throw new Error('Chrome DevTools did not start');
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  cdp = new CDP(ws);
  cdp.on(m => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails;
      errors.push('EXCEPTION: ' + (d.exception && d.exception.description || d.text));
    }
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('CONSOLE: ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 240));
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('LOG: ' + m.params.entry.text.slice(0, 240));
    }
  });
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Network.enable');
}

async function load(vp, extraQuery) {
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: vp.width, height: vp.height, deviceScaleFactor: vp.dsf,
    mobile: vp.mobile, screenWidth: vp.width, screenHeight: vp.height
  });
  await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: vp.mobile, maxTouchPoints: 5 });
  if (vp.ua) await cdp.send('Emulation.setUserAgentOverride', { userAgent: vp.ua, platform: vp.mobile ? 'Mobile' : 'Win32' });
  // A same-origin query-only CDP navigation can reuse a stale execution
  // context; an about:blank hop forces a real document rebuild (like a user
  // actually opening the shared link).
  if (extraQuery) { await cdp.send('Page.navigate', { url: 'about:blank' }); await sleep(180); }
  await cdp.send('Page.navigate', { url: BASE + (extraQuery || '') });
  await sleep(2600);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  console.log('\n=== Rainform Ultimate · full self-check ===\n');
  await launch();

  /* ---------------------------------------------------------- viewports */
  for (const vp of VIEWPORTS) {
    console.log('\n[' + vp.name + ' ' + vp.width + 'x' + vp.height + ']');
    const errBefore = errors.length;
    await load(vp);
    const boot = await evaluate(`JSON.stringify({
      rainform: !!window.Rainform,
      weather: !!window.RainWeather,
      providers: window.RainWeather ? window.RainWeather.providers().length : 0,
      canvas: !!document.querySelector('#scene'),
      width: document.documentElement.scrollWidth,
      inner: window.innerWidth,
      drawer: !!document.querySelector('#weatherPanel'),
      glerr: document.querySelector('#webglError').classList.contains('on'),
      sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller)
    })`);
    const b = JSON.parse(boot);
    ok('boot: Rainform + RainWeather', b.rainform && b.weather, 'providers=' + b.providers);
    ok('provider count >= 11', b.providers >= 11, String(b.providers));
    ok('no WebGL error screen', !b.glerr);
    ok('no horizontal overflow', b.width <= b.inner + 1, b.width + ' <= ' + b.inner);
    ok('weather drawer present', b.drawer);

    // open the drawer and screenshot
    await evaluate(`document.getElementById('weatherOpen').click()`);
    await sleep(450);
    const open = await evaluate(`JSON.stringify({
      open: document.getElementById('weatherPanel').classList.contains('open'),
      w: document.documentElement.scrollWidth, inner: window.innerWidth,
      box: (function(){const r=document.getElementById('weatherPanel').getBoundingClientRect();return [Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]})()
    })`);
    const o = JSON.parse(open);
    ok('drawer opens + fits viewport', o.open && o.w <= o.inner + 1, 'box=' + o.box.join(','));
    await shot('apps-' + vp.name + '-weather');
    await evaluate(`document.getElementById('weatherClose').click()`);
    await sleep(300);
    await shot('apps-' + vp.name + '-scene');
    ok('no JS errors this viewport', errors.length === errBefore,
      errors.slice(errBefore).join(' | ').slice(0, 200));
  }

  /* ------------------------------------------------------ transport tests */
  console.log('\n[live transports @ PC]');
  const pc = VIEWPORTS[0];
  await load(pc);
  const setSource = async (id, patch) => {
    await evaluate(`(function(){
      RainWeather.stop();
      RainWeather.configure(Object.assign({provider:${JSON.stringify(id)},autoStart:false,
        server:'http://127.0.0.1:8787',useNative:false,transitionMs:200}, ${JSON.stringify(patch || {})}));
      RainWeather.start();
    })()`);
    await sleep(1500);
    return JSON.parse(await evaluate(`JSON.stringify({
      status: RainWeather.getState().status,
      frame: !!RainWeather.getState().lastFrame,
      source: RainWeather.getState().lastFrame && RainWeather.getState().lastFrame.source,
      values: RainWeather.getState().lastFrame && RainWeather.getState().lastFrame.values.length,
      lastError: RainWeather.getState().lastError
    })`));
  };

  const rest = await setSource('server');
  ok('REST /api/weather live', rest.status === 'live' && rest.values === 25, JSON.stringify(rest));
  const crawl = await setSource('crawler');
  ok('CRAWL /api/crawl live', crawl.status === 'live' && crawl.values === 25, JSON.stringify(crawl));
  const sse = await setSource('sse');
  ok('SSE /api/stream live', sse.status === 'live' && sse.values === 25, JSON.stringify(sse));
  const ws = await setSource('ws');
  ok('WebSocket /ws live', ws.status === 'live' && ws.values === 25, JSON.stringify(ws));

  /* custom endpoint + JSON path mapping */
  const custom = await setSource('custom', { url: 'http://127.0.0.1:8787/api/latest',
    mapping: { valuePath: 'values', timePath: '', scale: 1, align: 'day' } });
  ok('custom HTTP + valuePath mapping', custom.status === 'live' && custom.values === 25, JSON.stringify(custom));

  /* manual import */
  const imported = JSON.parse(await evaluate(`(function(){
    var f = RainWeather.import('time,precip\\n00:00,1.2\\n01:00,3.4\\n02:00,0.0', {});
    return JSON.stringify({n:f.values.length, v0:f.values[0], v1:f.values[1], mode:f.mode});
  })()`));
  ok('manual CSV import', imported.n === 25 && imported.v0 === 1.2 && imported.v1 === 3.4, JSON.stringify(imported));

  /* fallback chain: a provider that always throws must not break the scene.
     Simulating the outage (instead of hitting a dead port) avoids expected
     browser network-error log noise in this check. */
  const fb = JSON.parse(await evaluate(`(function(){
    RainWeather.register('verify-outage', {label:'Outage',kind:'poll',group:'custom',
      async fetch(){ throw new Error('simulated outage'); }});
    RainWeather.stop();
    RainWeather.configure({provider:'verify-outage', retries:0, fallback:['cache','demo'], transitionMs:100});
    RainWeather.start();
    return '{}';
  })()`));
  await sleep(700);
  const fbState = JSON.parse(await evaluate(`JSON.stringify({
    status: RainWeather.getState().status,
    values: RainWeather.getState().lastFrame && RainWeather.getState().lastFrame.values.length,
    lastError: RainWeather.getState().lastError
  })`));
  ok('fallback chain survives dead provider',
    fbState.status === 'stale' && fbState.values === 25, JSON.stringify(fbState));
  await evaluate(`RainWeather.useDemo(true)`);
  await sleep(200);

  /* custom provider registration (the future-proof extension point) */
  const reg = JSON.parse(await evaluate(`(function(){
    RainWeather.register('verify-station', {label:'Verify',kind:'poll',group:'custom',
      async fetch(){ return {values:[1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,19,18,17,16,15]}; }});
    var p = RainWeather.providers().filter(x=>x.id==='verify-station');
    RainWeather.setProvider('verify-station'); RainWeather.start();
    return JSON.stringify({registered:p.length===1, total:RainWeather.providers().length});
  })()`));
  await sleep(900);
  const regState = JSON.parse(await evaluate(`JSON.stringify({status:RainWeather.getState().status,
    v0:RainWeather.getState().lastFrame && RainWeather.getState().lastFrame.values[0]})`));
  ok('register() custom provider', reg.registered && regState.status === 'live', JSON.stringify(regState));

  /* PWA registration + manifest */
  const pwa = JSON.parse(await evaluate(`(async function(){
    var m = await fetch('manifest.webmanifest').then(r=>r.json()).catch(()=>null);
    var reg = await navigator.serviceWorker.getRegistration().catch(()=>null);
    var icons = m && m.icons ? m.icons.length : 0;
    return JSON.stringify({manifest:!!m, display:m&&m.display, icons, sw:!!reg,
      scope: reg && reg.scope});
  })()`, true));
  ok('PWA manifest + icons', pwa.manifest && pwa.display === 'standalone' && pwa.icons >= 4, JSON.stringify(pwa));
  ok('Service Worker registered', pwa.sw, pwa.scope || '');

  /* 30-degree rotation + chart toggle still work after all changes */
  const inter = JSON.parse(await evaluate(`(function(){
    var a0 = Rainform.state.tTheta; Rainform.rotate(30); Rainform.rotate(30);
    var a1 = Rainform.state.tTheta;
    var before = Rainform.state.chartOn; Rainform.setChart(!before); var after = Rainform.state.chartOn;
    Rainform.setChart(before);
    return JSON.stringify({rot:Math.round((a1-a0)*180/Math.PI), chart:before!==after});
  })()`));
  ok('rotate 30 x 2 = 60 deg', inter.rot === 60, JSON.stringify(inter));
  ok('chart toggle', inter.chart);

  /* final screenshots: URL-preconfigured live boot */
  await load(pc, '?weather=server&server=http://127.0.0.1:8787&auto=1');
  await sleep(1600);
  const urlBoot = JSON.parse(await evaluate(`JSON.stringify({
    status: RainWeather.getState().status,
    provider: RainWeather.getConfig().provider,
    source: RainWeather.getState().lastFrame && RainWeather.getState().lastFrame.source,
    badge: document.getElementById('weatherBadge').textContent,
    search: location.search.slice(0, 40),
    logs: RainWeather.logs.slice(-5).map(l => l.msg)
  })`));
  ok('URL auto-connect (weather=server&auto=1)', urlBoot.status === 'live' && urlBoot.badge === 'LIVE', JSON.stringify(urlBoot));
  await shot('apps-live-rest');
  // check + click inside one evaluation so the screenshot can't race a
  // stale CDP execution context after the about:blank hop
  for (let i = 0; i < 3; i++) {
    const opened = await evaluate(`(function(){
      var p = document.getElementById('weatherPanel');
      if (p && !p.classList.contains('open')) document.getElementById('weatherOpen').click();
      return !!(p && p.classList.contains('open'));
    })()`);
    await sleep(450);
    if (opened && await evaluate(`document.getElementById('weatherPanel').classList.contains('open')`)) break;
  }
  await shot('apps-live-panel');

  /* ------------------------------------------------------------- summary */
  const pass = results.filter(r => r.pass).length;
  console.log('\n=== summary ===');
  console.log('checks: ' + pass + '/' + results.length + ' passed');
  console.log('JS errors: ' + errors.length);
  if (errors.length) errors.slice(0, 12).forEach(e => console.log('  ! ' + e.slice(0, 220)));
  console.log('screenshots: ' + fs.readdirSync(OUT).filter(f => f.startsWith('apps-')).length + ' in previews/');
  console.log('');
  return pass === results.length && errors.length === 0;
}

main().then(good => {
  try { if (cdp) cdp.send('Browser.close').catch(() => {}); } catch (e) {}
  try { if (chrome) chrome.kill(); } catch (e) {}
  setTimeout(() => process.exit(good ? 0 : 1), 400);
}).catch(e => {
  console.error('VERIFY FAILED:', e.stack || e.message);
  try { if (chrome) chrome.kill(); } catch (err) {}
  process.exit(1);
});

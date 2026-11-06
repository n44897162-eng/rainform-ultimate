'use strict';
const { spawn } = require('child_process');
const L = require('./lib');
const PW = require('playwright-core');
const path = require('path');
const ROOT = L.ROOT;
const exe = path.join(ROOT, 'app', 'desktop', 'dist', 'win-unpacked', 'Rainform Ultimate.exe');
const PORT = 9333;
const env = Object.assign({}, process.env);
delete env.ELECTRON_RUN_AS_NODE;
delete env.NODE_OPTIONS;
const proc = spawn(exe, ['--remote-debugging-port=' + PORT, '--no-sandbox', '--disable-gpu-sandbox',
  '--weather=server', '--weather-server=http://127.0.0.1:8787', '--weather-auto'],
  { cwd: path.dirname(exe), stdio: ['ignore', 'pipe', 'pipe'], env });
proc.stdout.on('data', d => console.log('[stdout]', String(d).slice(0, 300)));
proc.stderr.on('data', d => console.log('[stderr]', String(d).slice(0, 300)));
proc.on('exit', (c, s) => console.log('[proc exit]', c, s, new Date().toISOString()));

(async () => {
  let target;
  for (let i = 0; i < 120; i++) {
    try { target = (await L.devtoolsTargets(PORT)).find(x => x.type === 'page'); } catch (e) {}
    if (target) break;
    await L.sleep(500);
  }
  if (!target) throw new Error('no devtools target');
  console.log('[target]', target.url);
  const browser = await PW.chromium.connectOverCDP('http://127.0.0.1:' + PORT);
  browser.on('disconnected', () => console.log('[browser disconnected]', new Date().toISOString()));
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0];
  page.on('close', () => console.log('[page close]', new Date().toISOString()));
  page.on('crash', () => console.log('[page crash]', new Date().toISOString()));
  page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)));
  console.log('[connected]', new Date().toISOString());
  await L.sleep(2600);
  for (let i = 0; i < 14; i++) {
    if (i === 5) {
      const expr = `(function(){RainWeather.configure({provider:'server',server:'http://127.0.0.1:8788',autoStart:false,useNative:false,timeoutMs:1500,retries:0,intervalMs:60000,fallback:['cache','demo']});RainWeather.refresh('t-fallback');return 'ok'})()`;
      try { await page.evaluate(expr); console.log('[F09 config sent]', new Date().toISOString()); }
      catch (e) { console.log('[F09 config ERR]', String(e.message).slice(0, 200)); }
    }
    try {
      const v = await page.evaluate(`JSON.stringify({t:Date.now(),title:document.title,st:RainWeather.getState().status,frames:(window.Rainform&&Rainform.impactStats&&Rainform.impactStats.n)||0})`);
      console.log('[tick ' + i + ']', v);
    } catch (e) { console.log('[tick ' + i + ' ERR]', String(e.message).slice(0, 220)); break; }
    await L.sleep(700);
  }
  try { await browser.close(); } catch (e) {}
  try { proc.kill(); } catch (e) {}
  process.exit(0);
})().catch(e => { console.error('[FATAL]', e); try { proc.kill(); } catch (x) {} process.exit(1); });

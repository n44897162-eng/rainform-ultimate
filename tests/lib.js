/* Shared test plumbing for the three-platform suite.
 * Node 22 built-ins only (global WebSocket) + playwright-core for browser
 * lifecycle on the Web / Windows targets. The Android WebView is driven over
 * a raw CDP socket because old System WebView builds predate the protocol
 * assumptions that Playwright's connectOverCDP makes.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = path.join(ROOT, 'tests', 'evidence');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');
const nowISO = () => new Date().toISOString();

function ensureDirs() {
  fs.mkdirSync(EVIDENCE, { recursive: true });
}

/* ------------------------------------------------------------ raw CDP */
class RawCDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.handlers = [];
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      if (m.id && this.pending.has(m.id)) {
        const p = this.pending.get(m.id);
        clearTimeout(p.timer);
        this.pending.delete(m.id);
        m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result);
      } else if (m.method) {
        this.handlers.forEach(h => { try { h(m); } catch (err) {} });
      }
    };
  }
  send(method, params) {
    const id = ++this.id;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          rej(new Error('CDP timeout: ' + method));
        }
      }, 30000);
      this.pending.set(id, { res, rej, timer });
      this.ws.send(JSON.stringify({ id, method, params: params || {} }));
    });
  }
  on(fn) { this.handlers.push(fn); }
  close() { try { this.ws.close(); } catch (e) {} }
}

async function connectRaw(url) {
  let lastErr;
  for (let i = 0; i < 40; i++) {
    try {
      const ws = new WebSocket(url);
      await new Promise((res, rej) => {
        ws.onopen = res;
        ws.onerror = () => rej(new Error('ws connect failed'));
        setTimeout(() => rej(new Error('ws connect timeout')), 3000);
      });
      return new RawCDP(ws);
    } catch (e) { lastErr = e; await sleep(300); }
  }
  throw lastErr;
}

async function devtoolsTargets(port) {
  const r = await fetch('http://127.0.0.1:' + port + '/json');
  if (!r.ok) throw new Error('devtools endpoint ' + port + ' -> ' + r.status);
  return r.json();
}

/* --------------------------------------------------------- raw adapter */
function rawAdapter(cdp, platform, name, meta) {
  const errors = [];
  cdp.on(m => {
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails || {};
      errors.push('exception: ' + (d.text || '') + ' ' +
        ((d.exception && d.exception.description) || ''));
    } else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      errors.push('console: ' + m.params.args.map(a => a.value || a.description || '').join(' ').slice(0, 220));
    } else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') {
      errors.push('log: ' + String(m.params.entry.text).slice(0, 220));
    }
  });
  return {
    platform, name, meta, errors,
    async init() {
      await cdp.send('Runtime.enable');
      await cdp.send('Page.enable');
      try { await cdp.send('Log.enable'); } catch (e) {}
    },
    async evaluate(expr, awaitPromise) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: expr, returnByValue: true,
        awaitPromise: !!awaitPromise, userGesture: true
      });
      if (r.exceptionDetails) {
        throw new Error('eval: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      }
      return r.result && r.result.value !== undefined ? r.result.value : undefined;
    },
    async screenshot(file) {
      const r = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: false });
      if (!r || !r.data) throw new Error('captureScreenshot failed');
      const p = path.join(EVIDENCE, file);
      fs.writeFileSync(p, Buffer.from(r.data, 'base64'));
      return p;
    },
    async setViewport(v) {
      await cdp.send('Emulation.setDeviceMetricsOverride', {
        width: v.width, height: v.height,
        deviceScaleFactor: v.dsf || 1, mobile: !!v.mobile,
        screenWidth: v.width, screenHeight: v.height
      });
      if (v.ua) await cdp.send('Emulation.setUserAgentOverride', {
        userAgent: v.ua, platform: v.mobile ? 'Linux armv8l' : 'Win32'
      });
      await sleep(260);
    },
    async reload(url) {
      if (url) await cdp.send('Page.navigate', { url });
      else await cdp.send('Page.reload', { ignoreCache: true });
    },
    async bringToFront() { try { await cdp.send('Page.bringToFront'); } catch (e) {} },
    async dispatch(method, params) { return cdp.send(method, params || {}); },
    clearErrors() { errors.length = 0; },
    async close() { cdp.close(); }
  };
}

/* --------------------------------------------------- playwright adapter */
function playwrightAdapter(page, context, platform, name, meta, closeFn) {
  const errors = [];
  page.on('pageerror', e => errors.push('exception: ' + String(e.message || e).slice(0, 240)));
  page.on('console', m => {
    if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 240));
  });
  return {
    platform, name, meta, errors,
    async init() {},
    async evaluate(expr, awaitPromise) {
      return page.evaluate(expr);
    },
    async screenshot(file) {
      const p = path.join(EVIDENCE, file);
      await page.screenshot({ path: p, animations: 'disabled' });
      return p;
    },
    async setViewport(v) {
      await page.setViewportSize({ width: v.width, height: v.height });
      try {
        const s = await context.newCDPSession(page);
        await s.send('Emulation.setDeviceMetricsOverride', {
          width: v.width, height: v.height,
          deviceScaleFactor: v.dsf || 1, mobile: !!v.mobile,
          screenWidth: v.width, screenHeight: v.height
        });
      } catch (e) {}
      await sleep(260);
    },
    async reload(url) {
      if (url) await page.goto(url, { waitUntil: 'domcontentloaded' });
      else await page.reload({ waitUntil: 'domcontentloaded' });
      await sleep(900);
    },
    async bringToFront() { await page.bringToFront(); },
    async dispatch(method, params) {
      const s = await context.newCDPSession(page);
      const r = await s.send(method, params || {});
      await s.detach();
      return r;
    },
    clearErrors() { errors.length = 0; },
    async close() { await closeFn(); }
  };
}

/* ------------------------------------------------------------- recorder */
class Recorder {
  constructor() { this.rows = []; this.defects = []; this.env = {}; }
  check(platform, group, label, ok, detail, severity) {
    const row = {
      platform, group, label,
      status: ok ? 'PASS' : 'FAIL',
      detail: detail === undefined ? '' : String(detail).slice(0, 400),
      time: nowISO()
    };
    this.rows.push(row);
    if (!ok) {
      this.defects.push({
        id: 'D' + String(this.defects.length + 1).padStart(3, '0'),
        platform, group, label, detail: row.detail,
        severity: severity || 'Major'
      });
    }
    return ok;
  }
  skip(platform, group, label, why) {
    this.rows.push({ platform, group, label, status: 'SKIP', detail: why, time: nowISO() });
  }
  get passed() { return this.rows.filter(r => r.status === 'PASS').length; }
  get skipped() { return this.rows.filter(r => r.status === 'SKIP').length; }
  get failed() { return this.rows.filter(r => r.status === 'FAIL').length; }
  byPlatform(p) { return this.rows.filter(r => r.platform === p); }
  save() {
    ensureDirs();
    const out = {
      generatedAt: nowISO(),
      environment: this.env,
      summary: { total: this.rows.length, passed: this.passed, failed: this.failed, skipped: this.skipped },
      rows: this.rows,
      defects: this.defects
    };
    fs.writeFileSync(path.join(ROOT, 'tests', 'results.json'), JSON.stringify(out, null, 2));
    return out;
  }
}

/* Filter out known GPU/driver noise that is not an application defect. */
function isIgnorableError(s) {
  return /ANGLE_instanced_arrays|EXT_blend_minmax|WebGL: INVALID|SwiftShader|GPU stall|Automatic fallback to software|favicon\.ico|net::ERR_INTERNET_DISCONNECTED|net::ERR_CONNECTION_REFUSED/.test(s);
}

module.exports = {
  ROOT, EVIDENCE, sleep, sha256, nowISO, ensureDirs,
  RawCDP, connectRaw, devtoolsTargets, rawAdapter, playwrightAdapter,
  Recorder, isIgnorableError
};

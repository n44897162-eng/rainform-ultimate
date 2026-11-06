/* =============================================================================
 * Regional weather CRAWL interface (generic, configurable, compliance-first)
 * -----------------------------------------------------------------------------
 * GET /api/crawl?city=上海&lat=31.23&lon=121.47
 * GET /api/crawl?url=https://your-own-station.example/hourly&mode=auto
 * GET /api/crawl?url=...&regex=(\d{1,2}):00[^0-9]*([\d.]+)
 * GET /api/crawl?url=...&jsonPath=data.hourly.rain
 * GET /api/crawl?source=open-meteo            (recommended default)
 *
 * The browser cannot scrape third-party pages (CORS, ToS, legal exposure).
 * This server-side adapter is the reserved interface the user asked for:
 * point it at a data source you own or are licensed to read, describe how to
 * extract the numbers, and the gateway normalizes it into a WeatherFrame.
 *
 * COMPLIANCE BY DESIGN
 *   - No third-party weather site is hard-coded.
 *   - /robots.txt is fetched and Disallow rules are honoured by default
 *     (pass respectRobots=0 only for your own infrastructure).
 *   - Only http/https, 1 MB max body, 12 s timeout, no redirects to file://.
 *   - Default mode falls back to the official keyless Open-Meteo API.
 *   - Always prefer an official API or a licensed feed over HTML scraping.
 * ========================================================================== */
'use strict';

const OFFICIAL = require('./open-meteo');

const MAX_BYTES = 1024 * 1024;
const UA = 'Rainform-Weather-Gateway/1.0 (+local educational use)';

function stripTags(s) {
  return String(s).replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
}
function pick(obj, p) {
  if (!p) return undefined;
  return String(p).split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
}

async function robotsAllowed(target, ctx) {
  try {
    const u = new URL('/robots.txt', target.origin);
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), 3000);
    let text = '';
    try {
      const r = await fetch(u.toString(), { signal: ac.signal, headers: { 'User-Agent': UA } });
      if (r.ok) text = (await r.text()).slice(0, 200000);
    } finally { clearTimeout(t); }
    if (!text) return { allowed: true, note: 'robots.txt unavailable' };
    // minimal crawler-independent check: any global Disallow matching our path
    let agentAll = false;
    const rules = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.replace(/#.*/, '').trim();
      if (!line) continue;
      const m = line.match(/^(user-agent|disallow|allow)\s*:\s*(.*)$/i);
      if (!m) continue;
      const [, key, val] = m;
      if (key.toLowerCase() === 'user-agent') agentAll = val === '*' || /rainform/i.test(val);
      else if (agentAll && key.toLowerCase() === 'disallow' && val) rules.push(val);
    }
    const p = target.pathname;
    const blocked = rules.some(r => r === '/' || (r && p.startsWith(r)));
    return { allowed: !blocked, note: blocked ? 'Disallow rule matched ' + p : 'no matching Disallow' };
  } catch (e) { return { allowed: true, note: 'robots check skipped: ' + e.message }; }
}

/* ---- extraction strategies, ordered from most explicit to most generic ---- */
function extract(text, query, contentType) {
  const out = { time: [], precipitation: [], strategy: '' };

  // 1) explicit JSON path
  if (query.jsonPath) {
    let obj;
    try { obj = JSON.parse(text); } catch (e) { throw new Error('jsonPath set but body is not JSON'); }
    const v = pick(obj, query.jsonPath);
    const arr = Array.isArray(v) ? v : (v && typeof v === 'object' ? Object.keys(v).sort().map(k => v[k]) : [v]);
    if (!arr || !arr.length) throw new Error('jsonPath did not resolve to a non-empty array: ' + query.jsonPath);
    out.precipitation = arr.map(x => parseFloat((x && typeof x === 'object') ? (x.precipitation || x.rain || x.value || x.mmh) : x) || 0);
    out.time = Array.isArray(pick(obj, query.timePath)) ? pick(obj, query.timePath) : [];
    out.strategy = 'jsonPath:' + query.jsonPath;
    return out;
  }

  // 2) explicit regex with capture groups (hour, rainfall)
  if (query.regex) {
    let re;
    try { re = new RegExp(query.regex, 'g'); } catch (e) { throw new Error('Invalid regex: ' + e.message); }
    let m, guard = 0;
    while ((m = re.exec(text)) !== null && guard++ < 200) {
      if (m.length >= 3) { out.time.push(m[1].padStart(2, '0') + ':00'); out.precipitation.push(parseFloat(m[2]) || 0); }
      else { out.time.push(String(out.time.length).padStart(2, '0') + ':00'); out.precipitation.push(parseFloat(m[1]) || 0); }
    }
    if (!out.precipitation.length) throw new Error('regex matched nothing');
    out.strategy = 'regex';
    return out;
  }

  // 3) whole JSON body in a common shape
  if (/json/i.test(contentType) || /^\s*[{[]/.test(text)) {
    try {
      const obj = JSON.parse(text);
      const h = obj.hourly || obj.data || obj;
      const vals = h.precipitation || h.rain || h.rainfall || h.values || h.list || obj.values;
      if (Array.isArray(vals) && vals.length) {
        out.precipitation = vals.map(x => parseFloat((x && typeof x === 'object') ? (x.precipitation || x.rain || x.value || x.mmh) : x) || 0);
        out.time = h.time || h.times || obj.time || [];
        out.strategy = 'json-auto';
        return out;
      }
    } catch (e) { /* not JSON, continue to HTML */ }
  }

  // 4) embedded JSON contract: <script id="rainform-data" type="application/json"> ... </script>
  const embedded = text.match(/<script[^>]*(?:id|data-role)=["'][^"']*rain[^"']*["'][^>]*>([\s\S]*?)<\/script>/i);
  if (embedded) {
    try {
      const obj = JSON.parse(embedded[1]);
      const vals = obj.values || obj.precipitation || (obj.hourly && obj.hourly.precipitation);
      if (Array.isArray(vals) && vals.length) {
        out.precipitation = vals.map(Number);
        out.time = obj.time || (obj.hourly && obj.hourly.time) || [];
        out.strategy = 'embedded-json';
        return out;
      }
    } catch (e) { /* fall through */ }
  }

  // 5) data-hour / data-rain attributes
  const attrRe = /data-(?:hour|time)=["'](\d{1,2})[^"']*["'][^>]*data-(?:rain|precip|mmh|value)=["']([\d.]+)["']/gi;
  let am, guard = 0;
  while ((am = attrRe.exec(text)) !== null && guard++ < 100) {
    out.time.push(am[1].padStart(2, '0') + ':00');
    out.precipitation.push(parseFloat(am[2]) || 0);
  }
  if (out.precipitation.length) { out.strategy = 'data-attributes'; return out; }

  // 6) HTML table rows: first cell contains an hour, last numeric cell = mm/h
  const rows = text.match(/<tr[\s\S]*?<\/tr>/gi) || [];
  rows.forEach(row => {
    const cells = (row.match(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi) || []).map(stripTags);
    if (cells.length < 2) return;
    const hm = cells[0].match(/(\d{1,2})\s*[:：时]/);
    const nums = cells.slice(1).map(c => c.match(/-?\d+(?:\.\d+)?/)).filter(Boolean).map(m => parseFloat(m[0]));
    if (!nums.length) return;
    out.time.push(hm ? hm[1].padStart(2, '0') + ':00' : String(out.time.length).padStart(2, '0') + ':00');
    out.precipitation.push(nums[nums.length - 1]);
  });
  if (out.precipitation.length) { out.strategy = 'html-table'; return out; }

  throw new Error('No hourly rainfall could be extracted. Provide regex=, jsonPath=, or expose an hourly table / data-* attributes / a rainform-data JSON block.');
}

module.exports = {
  id: 'crawler',
  label: 'Configurable regional weather crawler',
  description: 'Fetch + parse an authorized regional page into hourly rainfall. Robots-aware; no third-party site hard-coded.',

  async fetch(query, ctx) {
    // compliant default: no explicit URL -> official API
    if (!query.url) {
      // allow-list only; never require() arbitrary user input
      if (ctx.config && ctx.config.offline) {
        return Object.assign({}, require('../sample-frame.json'), {
          city: query.city || '示例 / Sample', source: 'sample-offline'
        });
      }
      try { return await OFFICIAL.fetch(query, ctx); }
      catch (e) {
        // fully offline development: return a clearly-labelled sample
        ctx.log && ctx.log('crawler: official API unavailable (' + e.message + '), using sample frame');
        const sample = require('../sample-frame.json');
        return Object.assign({}, sample, { city: query.city || '示例 / Sample', source: 'sample-offline' });
      }
    }

    let target;
    try { target = new URL(query.url); } catch (e) { throw new Error('Invalid url'); }
    if (!/^https?:$/.test(target.protocol)) throw new Error('Only http/https URLs are allowed');
    if (query.respectRobots !== '0') {
      const rb = await robotsAllowed(target, ctx);
      if (!rb.allowed) throw new Error('robots.txt disallows this path (' + rb.note + '). Use respectRobots=0 only for sources you own.');
      ctx.log && ctx.log('crawler robots:', rb.note);
    }

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ctx.timeoutMs || 12000);
    try {
      const r = await fetch(target.toString(), {
        signal: ac.signal, redirect: 'follow',
        headers: Object.assign({ 'User-Agent': query.ua || UA, 'Accept': 'text/html,application/json,text/plain,*/*' },
          query.header ? JSON.parse(query.header) : {})
      });
      if (!r.ok) throw new Error('Upstream HTTP ' + r.status);
      const reader = r.body && r.body.getReader ? r.body.getReader() : null;
      let text = '', bytes = 0;
      if (reader) {
        const dec = new TextDecoder('utf-8');
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.length;
          if (bytes > MAX_BYTES) throw new Error('Upstream body exceeds 1 MB');
          text += dec.decode(value, { stream: true });
        }
      } else {
        text = await r.text();
        if (text.length > MAX_BYTES) throw new Error('Upstream body exceeds 1 MB');
      }
      const found = extract(text, query, r.headers.get('content-type') || '');
      return {
        city: query.city || target.hostname,
        observedAt: new Date().toISOString(),
        sourceUrl: target.toString(),
        crawlStrategy: found.strategy,
        hourly: { time: found.time, precipitation: found.precipitation }
      };
    } finally { clearTimeout(timer); }
  }
};

#!/usr/bin/env node
/* =============================================================================
 * Rainform Weather Gateway — zero-dependency reference server  v1.0
 * -----------------------------------------------------------------------------
 * Exposes EVERY real-time transport the browser bridge can talk to:
 *
 *   GET  /api/health              health + active transports + provider list
 *   GET  /api/providers           pluggable server-side provider registry
 *   GET  /api/weather             normalized hourly rainfall (REST poll)
 *   GET  /api/crawl               regional weather crawl interface (proxy)
 *   GET  /api/stream              Server-Sent Events push
 *   GET  /api/poll?since=<seq>    long polling
 *   WS   /ws                      WebSocket push (hand-written, no deps)
 *   POST /api/push                external systems push a frame in
 *   GET  /api/latest              newest cached frame
 *   GET|POST /api/config          runtime configuration
 *   GET  /                         static PWA / desktop / mobile www
 *
 * Run:  node weather/server/server.js --port 8787 --root app/pwa
 * Npm:  node weather/server/server.js --help
 *
 * PROVIDER PLUGINS: drop a .js file into ./providers exporting
 *   { id, label, fetch(query, ctx) -> payload }
 * It is auto-loaded at startup. See providers/template.js.
 *
 * COMPLIANCE: /api/crawl is a generic, configurable fetch+parse interface for
 * data sources you own or are authorized to use. No third-party site is
 * hard-coded. Respect robots.txt, terms of service and applicable law;
 * prefer official APIs (the default provider is Open-Meteo).
 * ========================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const ROOT = __dirname;
const PROJECT = path.resolve(ROOT, '../..');
const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const bus = new EventEmitter();
bus.setMaxListeners(0);

/* --------------------------------------------------------------- argv / cfg */
function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')
    ? process.argv[i + 1] : def;
}
const config = {
  port: parseInt(arg('port', process.env.PORT || 8787), 10),
  host: arg('host', '0.0.0.0'),
  root: path.resolve(PROJECT, arg('root', 'app/pwa')),
  token: arg('token', process.env.RAINFORM_TOKEN || ''),
  intervalMs: Math.max(5000, parseInt(arg('interval', 30), 10) * 1000),
  upstreamMs: 12000,
  provider: arg('provider', 'open-meteo'),
  crawlSource: arg('crawl-source', 'open-meteo'),
  offline: process.argv.indexOf('--offline') >= 0,
  verbose: process.argv.indexOf('--verbose') >= 0
};
if (process.argv.indexOf('--help') >= 0 || process.argv.indexOf('-h') >= 0) {
  console.log([
    'Rainform Weather Gateway',
    '',
    '  node weather/server/server.js [options]',
    '',
    '  --port N          HTTP port (default 8787)',
    '  --root PATH       static web root (default app/pwa)',
    '  --token STR       optional Bearer token for /api/*',
    '  --interval SEC    push interval for SSE / WebSocket (default 30)',
    '  --provider ID     default upstream provider (default open-meteo)',
    '  --offline         never call the internet, use the bundled sample frame',
    '  --verbose         log requests',
    ''
  ].join('\n'));
  process.exit(0);
}

const state = {
  startedAt: Date.now(),
  seq: 0,
  lastFrame: null,
  lastError: null,
  requests: 0,
  pushes: 0,
  cache: new Map(),
  sseClients: new Set(),
  wsClients: new Set(),
  pollWaiters: new Set()
};

function log() {
  if (!config.verbose) return;
  console.log('[' + new Date().toISOString().slice(11, 19) + ']', ...arguments);
}

/* ------------------------------------------------------------ provider hub */
const providers = new Map();
function loadProviders() {
  const dir = path.join(ROOT, 'providers');
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith('.js') || f === 'template.js') continue;
    try {
      const p = require(path.join(dir, f));
      if (p && p.id && typeof p.fetch === 'function') {
        providers.set(p.id, p);
        log('provider loaded:', p.id);
      }
    } catch (e) { console.error('provider', f, 'failed:', e.message); }
  }
}
loadProviders();

/* -------------------------------------------------------------- normalize */
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
function toFrame(payload, query, source) {
  if (!payload) throw new Error('Empty upstream payload');
  if (payload.schema === 'rainform.weather/1' && Array.isArray(payload.values)) {
    return Object.assign({}, payload, { source: source || payload.source, observedAt: payload.observedAt || new Date().toISOString() });
  }
  let hours = [];
  const h = payload.hourly || (payload.data && payload.data.hourly) || {};
  const times = h.time || payload.time || [];
  const vals = h.precipitation || h.rain || h.value || payload.values || payload.data || [];
  const arr = Array.isArray(vals) ? vals : Object.keys(vals).map(k => vals[k]);
  for (let i = 0; i < arr.length; i++) {
    const v = arr[i];
    let mmh = (v && typeof v === 'object') ? (v.precipitation || v.rain || v.mmh || v.value || 0) : v;
    mmh = parseFloat(mmh);
    let hour = i % 24;
    const t = times[i];
    if (typeof t === 'string') {
      const m = t.match(/[T\s](\d{1,2}):/);
      if (m) hour = parseInt(m[1], 10);
      else { const d = new Date(t); if (!isNaN(d.getTime())) hour = d.getUTCHours(); }
    }
    hours.push({ time: t || null, hour: clamp(hour, 0, 23), mmh: isFinite(mmh) ? mmh : 0 });
  }
  const bucket = new Array(24).fill(null);
  hours.forEach(x => { bucket[x.hour] = x.mmh; });
  for (let i = 0; i < 24; i++) {
    if (bucket[i] !== null) continue;
    let a = i - 1, b = i + 1;
    while (a >= 0 && bucket[a] === null) a--;
    while (b < 24 && bucket[b] === null) b++;
    bucket[i] = (a >= 0 && b < 24) ? bucket[a] + (bucket[b] - bucket[a]) * (i - a) / (b - a)
      : (a >= 0 ? bucket[a] : (b < 24 ? bucket[b] : 0));
  }
  const values = bucket.map(v => clamp(+v || 0, 0, 20));
  values.push(values[23]);
  return {
    schema: 'rainform.weather/1',
    source: source || 'server',
    mode: 'live',
    location: {
      name: query.city || payload.city || 'Unknown',
      lat: parseFloat(query.lat) || payload.latitude || 0,
      lon: parseFloat(query.lon) || payload.longitude || 0,
      timezone: payload.timezone || query.timezone || 'auto'
    },
    observedAt: payload.observedAt || new Date().toISOString(),
    fetchedAt: new Date().toISOString(),
    unit: 'mm/h',
    hours, values,
    meta: { gateway: 'rainform-weather-gateway/1.0', points: hours.length },
    raw: payload.rawOnly === true ? undefined : undefined
  };
}

const SAMPLE = (() => {
  try { return JSON.parse(fs.readFileSync(path.join(ROOT, 'sample-frame.json'), 'utf8')); }
  catch (e) {
    return { schema: 'rainform.weather/1', values: [0.6,0.4,0.3,0.5,0.8,1.4,2.2,3.1,2.6,3.8,5.2,7.4,9.6,6.8,4.6,5.9,8.8,12.4,15.6,13.2,10.1,7.2,4.4,2.5,1.2], location: { name: 'Demo' } };
  }
})();

async function fetchUpstream(query, providerId) {
  const id = providerId || query.provider || config.provider;
  if (config.offline) {
    const f = toFrame(SAMPLE, query, 'offline-sample');
    f.location = Object.assign({}, SAMPLE.location, {
      name: query.city || SAMPLE.location.name,
      lat: parseFloat(query.lat) || SAMPLE.location.lat,
      lon: parseFloat(query.lon) || SAMPLE.location.lon
    });
    f.fetchedAt = new Date().toISOString();
    return f;
  }
  const p = providers.get(id);
  if (!p) throw new Error('Unknown provider: ' + id + ' (available: ' + [...providers.keys()].join(', ') + ')');
  const key = id + '|' + [query.lat, query.lon, query.city, query.url].join('|');
  const hit = state.cache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60 * 1000) return hit.frame;
  const payload = await p.fetch(query, { config, timeoutMs: config.upstreamMs, log });
  const frame = toFrame(payload, query, id);
  state.cache.set(key, { at: Date.now(), frame });
  return frame;
}

/* -------------------------------------------------------------- broadcast */
function publish(frame) {
  if (!frame) return frame;
  state.seq++;
  state.lastFrame = Object.assign({}, frame, { fetchedAt: new Date().toISOString() });
  state.lastError = null;
  const wire = JSON.stringify(Object.assign({}, state.lastFrame, { seq: state.seq }));
  // SSE
  for (const res of state.sseClients) {
    try { res.write('id: ' + state.seq + '\nevent: weather\ndata: ' + wire + '\n\n'); }
    catch (e) { state.sseClients.delete(res); }
  }
  // WebSocket
  const wsFrame = encodeWSFrame(wire);
  for (const sock of state.wsClients) {
    try { sock.write(wsFrame); } catch (e) { state.wsClients.delete(sock); }
  }
  // long-poll waiters
  for (const w of state.pollWaiters) {
    clearTimeout(w.timer);
    try { w.res.writeHead(200, jsonHeaders()); w.res.end(wire); } catch (e) {}
    state.pollWaiters.delete(w);
  }
  bus.emit('frame', state.lastFrame);
  return state.lastFrame;
}

async function tick(reason) {
  try {
    const frame = await fetchUpstream({ city: '上海', lat: 31.2304, lon: 121.4737 }, config.provider);
    publish(frame);
    log('tick', reason, 'seq', state.seq);
  } catch (e) {
    state.lastError = e.message;
    log('tick error:', e.message);
    // never push a broken frame; clients keep their last good data + fallback chain
  }
}

/* ----------------------------------------------------------- WebSocket io */
function encodeWSFrame(text) {
  const payload = Buffer.from(text, 'utf8');
  const len = payload.length;
  let head;
  if (len < 126) { head = Buffer.alloc(2); head[1] = len; }
  else if (len < 65536) { head = Buffer.alloc(4); head[1] = 126; head.writeUInt16BE(len, 2); }
  else { head = Buffer.alloc(10); head[1] = 127; head.writeUInt32BE(Math.floor(len / 2 ** 32), 2); head.writeUInt32BE(len >>> 0, 6); }
  head[0] = 0x81;                       // FIN + text
  return Buffer.concat([head, payload]);
}
function encodeWS(opcode, payload) {
  const b = Buffer.isBuffer(payload) ? payload : Buffer.from(payload || '');
  const head = Buffer.alloc(b.length < 126 ? 2 : 4);
  head[0] = 0x80 | opcode;
  if (b.length < 126) head[1] = b.length;
  else { head[1] = 126; head.writeUInt16BE(b.length, 2); }
  return Buffer.concat([head, b]);
}
function handleUpgrade(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  state.wsClients.add(socket);
  let buf = Buffer.alloc(0);
  const onData = chunk => {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 2) {
      const op = buf[0] & 0x0f;
      let len = buf[1] & 0x7f, off = 2;
      if (len === 126) { if (buf.length < 4) return; len = buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (buf.length < 10) return; len = Number(buf.readBigUInt64BE(2)); off = 10; }
      const masked = !!(buf[1] & 0x80);
      const mask = masked ? buf.slice(off, off + 4) : null;
      if (masked) off += 4;
      if (buf.length < off + len) return;
      let payload = Buffer.from(buf.slice(off, off + len));
      if (mask) for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
      buf = buf.slice(off + len);
      if (op === 0x8) { socket.end(encodeWS(0x8, Buffer.alloc(0))); cleanup(); return; }
      if (op === 0x9) { socket.write(encodeWS(0xA, payload)); continue; }   // ping -> pong
      if (op === 0x1 || op === 0x2) {
        const text = payload.toString('utf8');
        if (text === 'ping' || text === 'refresh') { tick('ws-refresh'); continue; }
        try {
          const f = toFrame(JSON.parse(text), {}, 'ws-push');
          publish(f); log('frame pushed by WS client');
        } catch (e) { socket.write(encodeWSFrame(JSON.stringify({ error: e.message }))); }
      }
    }
  };
  const cleanup = () => {
    state.wsClients.delete(socket);
    socket.removeListener('data', onData);
  };
  socket.on('data', onData);
  socket.on('close', cleanup);
  socket.on('error', cleanup);
  if (head && head.length) onData(head);
  if (state.lastFrame) {
    try { socket.write(encodeWSFrame(JSON.stringify(Object.assign({}, state.lastFrame, { seq: state.seq })))); } catch (e) {}
  }
}

/* -------------------------------------------------------------- HTTP utils */
function jsonHeaders(extra) {
  return Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store, no-cache, must-revalidate',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Api-Key',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Rainform-Seq',
    'X-Rainform-Seq': String(state.seq)
  }, extra || {});
}
function send(res, code, body, headers) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(code, jsonHeaders(headers));
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let s = '';
    req.on('data', c => { s += c; if (s.length > 2e6) { reject(new Error('Body too large')); req.destroy(); } });
    req.on('end', () => resolve(s));
    req.on('error', reject);
  });
}
function authorized(req) {
  if (!config.token) return true;
  const h = req.headers.authorization || '';
  return h === 'Bearer ' + config.token || h === config.token;
}
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8'
};
function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.join(config.root, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(config.root)) { send(res, 403, { error: 'Forbidden' }); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback
      const fallback = path.join(config.root, 'index.html');
      if (fs.existsSync(fallback) && !path.extname(rel)) {
        res.writeHead(200, { 'Content-Type': MIME['.html'], 'Cache-Control': 'no-cache' });
        fs.createReadStream(fallback).pipe(res);
      } else send(res, 404, { error: 'Not found: ' + rel });
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': /sw\.js$|manifest|index\.html/.test(file) ? 'no-cache' : 'public, max-age=86400',
      'Content-Length': st.size
    });
    fs.createReadStream(file).pipe(res);
  });
}

/* ------------------------------------------------------------- API router */
async function api(req, res, u) {
  const q = Object.fromEntries(u.searchParams.entries());
  state.requests++;
  if (!authorized(req)) { send(res, 401, { error: 'Unauthorized (Bearer token required)' }); return; }

  switch (u.pathname) {
    case '/api/health':
      send(res, 200, {
        ok: true, service: 'rainform-weather-gateway', version: '1.0.0',
        uptimeSec: Math.round((Date.now() - state.startedAt) / 1000),
        seq: state.seq, requests: state.requests, pushes: state.pushes,
        transports: ['rest', 'crawler', 'sse', 'long-poll', 'websocket', 'push'],
        providers: [...providers.keys()],
        defaultProvider: config.provider,
        sseClients: state.sseClients.size, wsClients: state.wsClients.size,
        lastFrameAt: state.lastFrame && state.lastFrame.fetchedAt,
        lastError: state.lastError, offline: config.offline
      });
      return;

    case '/api/providers':
      send(res, 200, {
        default: config.provider,
        providers: [...providers.values()].map(p => ({ id: p.id, label: p.label || p.id, description: p.description || '' })),
        howToAdd: 'Drop a .js file into weather/server/providers/ exporting {id, fetch(query,ctx)} — see template.js'
      });
      return;

    case '/api/latest':
      if (!state.lastFrame) { send(res, 404, { error: 'No frame yet' }); return; }
      send(res, 200, Object.assign({}, state.lastFrame, { seq: state.seq }));
      return;

    case '/api/weather':
    case '/api/crawl': {
      const isCrawl = u.pathname === '/api/crawl';
      const providerId = isCrawl ? (q.source || 'crawler') : (q.provider || config.provider);
      try {
        const frame = await fetchUpstream(Object.assign({}, q, { from: isCrawl ? 'crawl' : 'rest' }), providerId);
        frame.mode = 'live';
        frame.meta = Object.assign({}, frame.meta, { endpoint: u.pathname, provider: providerId });
        publish(frame);
        send(res, 200, Object.assign({}, frame, { seq: state.seq }));
      } catch (e) {
        state.lastError = e.message;
        send(res, 502, { error: e.message, endpoint: u.pathname, provider: providerId,
          hint: 'Use --offline for a bundled sample frame, or configure your own provider.' });
      }
      return;
    }

    case '/api/stream': {
      res.writeHead(200, Object.assign(jsonHeaders(), {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'
      }));
      res.write('retry: 4000\n\n');
      res.write('event: hello\ndata: ' + JSON.stringify({ service: 'rainform-sse', intervalMs: config.intervalMs }) + '\n\n');
      state.sseClients.add(res);
      if (state.lastFrame) res.write('event: weather\ndata: ' + JSON.stringify(Object.assign({}, state.lastFrame, { seq: state.seq })) + '\n\n');
      const ka = setInterval(() => { try { res.write(': keepalive\n\n'); } catch (e) {} }, 15000);
      req.on('close', () => { clearInterval(ka); state.sseClients.delete(res); });
      return;
    }

    case '/api/poll': {
      const since = parseInt(q.since || '0', 10);
      if (state.seq > since && state.lastFrame) {
        send(res, 200, Object.assign({}, state.lastFrame, { seq: state.seq })); return;
      }
      const w = { res, timer: null };
      w.timer = setTimeout(() => {
        state.pollWaiters.delete(w);
        try { send(res, 200, { seq: state.seq, timeout: true, hint: 'No new frame; retry' }); } catch (e) {}
      }, Math.min(30000, parseInt(q.wait || '25000', 10)));
      state.pollWaiters.add(w);
      req.on('close', () => { clearTimeout(w.timer); state.pollWaiters.delete(w); });
      return;
    }

    case '/api/push': {
      let body;
      try { body = JSON.parse(await readBody(req) || '{}'); }
      catch (e) { send(res, 400, { error: 'Invalid JSON: ' + e.message }); return; }
      try {
        const frame = toFrame(body, q, body.source || 'external-push');
        state.pushes++;
        publish(Object.assign(frame, { mode: 'push' }));
        send(res, 200, { ok: true, seq: state.seq, values: frame.values.length });
      } catch (e) { send(res, 400, { error: e.message }); }
      return;
    }

    case '/api/config':
      if (req.method === 'POST') {
        let body;
        try { body = JSON.parse(await readBody(req) || '{}'); } catch (e) { send(res, 400, { error: 'Invalid JSON' }); return; }
        ['intervalMs', 'upstreamMs', 'provider', 'crawlSource'].forEach(k => {
          if (body[k] !== undefined) config[k] = body[k];
        });
        send(res, 200, { ok: true, config: safeConfig() });
      } else send(res, 200, safeConfig());
      return;

    default:
      send(res, 404, { error: 'Unknown endpoint', endpoints: [
        '/api/health', '/api/providers', '/api/weather', '/api/crawl', '/api/latest',
        '/api/stream', '/api/poll', '/api/push', '/api/config'
      ] });
  }
}
function safeConfig() {
  const c = Object.assign({}, config);
  c.token = c.token ? '***set***' : '';
  return c;
}

/* ------------------------------------------------------------------ server */
const server = http.createServer((req, res) => {
  let u;
  try { u = new url.URL(req.url, 'http://' + (req.headers.host || 'localhost')); }
  catch (e) { send(res, 400, { error: 'Bad URL' }); return; }
  log(req.method, u.pathname);
  if (req.method === 'OPTIONS') { res.writeHead(204, jsonHeaders()); res.end(); return; }
  if (u.pathname.startsWith('/api/')) { api(req, res, u).catch(e => send(res, 500, { error: e.message })); return; }
  serveStatic(req, res, u.pathname);
});
server.on('upgrade', (req, socket, head) => {
  const p = (req.url || '').split('?')[0];
  if (p === '/ws' || p === config.wsPath || p === '/') handleUpgrade(req, socket, head);
  else socket.destroy();
});

server.listen(config.port, config.host, () => {
  const addr = 'http://127.0.0.1:' + config.port;
  console.log('');
  console.log('  Rainform Weather Gateway  v1.0');
  console.log('  -------------------------------------------------------------');
  console.log('  static root : ' + config.root);
  console.log('  providers   : ' + [...providers.keys()].join(', '));
  console.log('  offline     : ' + config.offline);
  console.log('  -------------------------------------------------------------');
  console.log('  ' + addr + '/                     web app');
  console.log('  ' + addr + '/api/health            health / transports');
  console.log('  ' + addr + '/api/weather           REST normalized frame');
  console.log('  ' + addr + '/api/crawl             regional crawl interface');
  console.log('  ' + addr + '/api/stream            SSE push');
  console.log('  ' + addr + '/api/poll?since=0      long poll');
  console.log('  ws://127.0.0.1:' + config.port + '/ws' + '        WebSocket push');
  console.log('  POST ' + addr + '/api/push   external system ingest');
  console.log('  -------------------------------------------------------------');
  console.log('');
  tick('boot');
  setInterval(() => tick('interval'), config.intervalMs);
});
process.on('SIGINT', () => { console.log('\nshutting down'); process.exit(0); });

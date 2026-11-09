/* =============================================================================
 * Rainform Weather Bridge  v1.0
 * -----------------------------------------------------------------------------
 * A transport-agnostic, provider-pluggable live weather layer.
 *
 * DESIGN CONTRACT  (see docs/WEATHER-API.md)
 * -----------------------------------------------------------------------------
 *   WeatherFrame  {
 *     schema     : 'rainform.weather/1',
 *     source     : string,            // provider id
 *     mode       : 'live'|'push'|'cache'|'demo'|'manual'|'fallback'|'custom',
 *     location   : {name,lat,lon,timezone},
 *     observedAt : ISO string,
 *     fetchedAt  : ISO string,
 *     unit       : 'mm/h',
 *     hours      : [{time,hour,mmh,temp,humidity,code,desc}],
 *     values     : number[25],       // 00:00 .. 24:00, clamped 0..maxMm
 *     meta       : object,
 *     raw        : any               // untouched provider payload
 *   }
 *
 *   Provider {
 *     id, group, label, hint, kind : 'poll'|'push'|'local',
 *     needs : ['city'|'server'|'key'|'url'|'none'],
 *     fetch(ctx)      -> payload | WeatherFrame        (poll)
 *     subscribe(ctx,emit) -> dispose()                 (push)
 *   }
 *
 *   ctx = {cfg, signal, http(url,opts), json(url,opts), now, log, locate, maxMm}
 *
 * Any payload (number[25], CSV text, {values:[]}, Open-Meteo hourly object,
 * one-call JSON, a JSONPath-ish custom mapping, or a full WeatherFrame) is
 * normalized by `normalize()` into 25 hourly mm/h values before it reaches
 * `Rainform.update()`.
 *
 * The bridge NEVER hard-codes a single vendor. New transports can be added at
 * runtime with RainWeather.register(id, providerDef) — that is the intended
 * extension point for future real-time backends.
 * ========================================================================== */
(function () {
  'use strict';

  const SCHEMA = 'rainform.weather/1';
  const VERSION = '1.0.0';
  const CFG_KEY = 'rainform.weather.config.v1';
  const CACHE_KEY = 'rainform.weather.cache.v1';
  const isNum = v => typeof v === 'number' && isFinite(v);
  const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
  const $ = id => document.getElementById(id);
  const nowISO = () => new Date().toISOString();
  const L = (zh, en) => (window.Rainform && window.Rainform.state && window.Rainform.state.lang === 'en') ? en : zh;

  /* ------------------------------------------------------------- storage */
  function storeGet(key, fallback) {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : fallback; }
    catch (e) { return fallback; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch (e) { return false; }
  }

  /* -------------------------------------------------------------- config */
  const DEFAULTS = {
    provider: 'demo',
    autoStart: false,
    intervalMs: 10 * 60 * 1000,
    timeoutMs: 12000,
    retries: 2,
    backoffMs: 1600,
    fallback: ['cache', 'demo'],
    cacheTTL: 6 * 60 * 60 * 1000,
    city: '上海',
    lat: 31.2304,
    lon: 121.4737,
    timezone: 'auto',
    server: 'http://127.0.0.1:8787',
    restPath: '/api/weather',
    crawlPath: '/api/crawl',
    streamPath: '/api/stream',
    wsPath: '/ws',
    pollPath: '/api/poll',
    url: '',
    token: '',
    apiKey: '',
    apiHost: '',
    topic: 'rainform/weather',
    mqttUrl: '',
    extraHeaders: '',
    mapping: { valuePath: '', timePath: '', scale: 1, align: 'day' },
    maxMm: 20,
    autoApply: true,
    transitionMs: 1400,
    pauseOnEdit: true,
    useNative: true,
    debug: false
  };

  let cfg = Object.assign({}, DEFAULTS, storeGet(CFG_KEY, {}));
  cfg.mapping = Object.assign({}, DEFAULTS.mapping, cfg.mapping || {});

  /* ------------------------------------------------------------ api base
     三端取后端地址的顺序（前者优先）：
       1. 打包时注入的 window.__RAINFORM_API_BASE__（Electron / 安卓壳可预置）
       2. 页面 URL 上的 ?api=https://your-host（分享链接临时切后端）
       3. 同源 —— 网页 / PWA 直接请求同源的 /api/
       4. file:// 下退回用户保存过的「服务器地址」（桌面 / 安卓手动填）
     返回空串表示当前没有可用后端，实时源会自动降级到离线数据。 */
  function apiBase() {
    const injected = window.__RAINFORM_API_BASE__ || window.RAINFORM_API_BASE;
    if (injected) return String(injected).replace(/\/+$/, '');
    try {
      const q = new URLSearchParams(location.search || '').get('api');
      if (q) return String(q).replace(/\/+$/, '');
    } catch (e) {}
    if (/^https?:$/.test(location.protocol)) {
      /* 只有网页 / PWA 的「同源」才是后端。安卓壳把页面跑在本地资源服务器上
         （http://127.0.0.1:<随机端口>），Capacitor 是 capacitor://localhost，
         拿它们当后端只会 404 —— 这两端必须走显式配置。 */
      const target = window.__RAINFORM_TARGET__ || '';
      if (target !== 'android' && target !== 'mobile') return location.origin;
    }
    const saved = storeGet(CFG_KEY, {});
    /* 默认值是内置网关 http://127.0.0.1:8787，只在开发时有效；
       用户没改过就当作「未配置」，避免桌面/安卓一启动就空转重试。 */
    if (saved && saved.server && saved.server !== DEFAULTS.server) {
      return String(saved.server).replace(/\/+$/, '');
    }
    return '';
  }

  function saveCfg() {
    const copy = Object.assign({}, cfg);
    delete copy.transform;                 // functions are not serializable
    storeSet(CFG_KEY, copy);
  }

  /* ------------------------------------------------------------ emitter */
  const listeners = Object.create(null);
  function emit(type, payload) {
    (listeners[type] || []).slice().forEach(fn => {
      try { fn(payload); } catch (e) { console.warn('[weather] listener', e); }
    });
    (listeners['*'] || []).slice().forEach(fn => {
      try { fn({ type, payload }); } catch (e) { /* noop */ }
    });
  }
  function on(type, fn) {
    (listeners[type] || (listeners[type] = [])).push(fn);
    return () => off(type, fn);
  }
  function off(type, fn) {
    const a = listeners[type]; if (!a) return;
    const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  function log(msg, level) {
    const line = { at: Date.now(), msg: String(msg), level: level || 'info' };
    if (cfg.debug) console[level === 'error' ? 'error' : 'log']('[RainWeather]', msg);
    recentLogs.push(line);
    if (recentLogs.length > 60) recentLogs.shift();
    emit('log', line);
  }
  const recentLogs = [];

  /* ------------------------------------------------------------- status */
  const runtime = {
    status: 'idle',       // idle | connecting | live | stale | error | stopped
    running: false,
    lastFrame: null,
    lastError: null,
    lastFetchAt: 0,
    nextFetchAt: 0,
    attempts: 0,
    seq: 0,
    provider: cfg.provider
  };
  function setStatus(s, detail) {
    runtime.status = s;
    emit('status', { status: s, detail: detail || '', at: Date.now(), provider: cfg.provider });
    render();
  }

  /* --------------------------------------------------------------- HTTP
   * Three transparent transports, in priority order:
   *   1. window.RainNative.fetch  (Electron preload / any native shell)
   *   2. CapacitorHttp            (Android / iOS Capacitor runtime)
   *   3. browser fetch            (PWA / plain web / file:// where allowed)
   * The first two bypass CORS, which is what makes "crawl a regional weather
   * page" possible inside a packaged app. */
  function parseHeaders(text) {
    const out = {};
    String(text || '').split(/\r?\n/).forEach(line => {
      const i = line.indexOf(':');
      if (i > 0) out[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
    });
    return out;
  }
  function httpError(status, url, body) {
    const e = new Error('HTTP ' + status + ' · ' + url);
    e.status = status; e.url = url; e.body = body;
    return e;
  }
  function wsURL(base, path) {
    if (/^wss?:\/\//i.test(path)) return path;
    return base.replace(/^http/i, 'ws').replace(/\/$/, '') + (path[0] === '/' ? path : '/' + path);
  }
  function restURL(base, path) {
    if (/^https?:\/\//i.test(path)) return path;
    return base.replace(/\/$/, '') + (path[0] === '/' ? path : '/' + path);
  }
  function authHeaders() {
    const h = { 'Accept': 'application/json,text/csv,text/plain,*/*' };
    if (cfg.token) h['Authorization'] = 'Bearer ' + cfg.token;
    const extra = parseHeaders(cfg.extraHeaders);
    Object.keys(extra).forEach(k => { h[k] = extra[k]; });
    return h;
  }

  async function http(url, opts) {
    opts = opts || {};
    const method = opts.method || 'GET';
    const headers = Object.assign(authHeaders(), opts.headers || {});
    /* 必须是 let：没有外部 signal 时会在这里新建 AbortController 并回填，
       用 const 会在降级链（无 signal 的 fallback 调用）里抛
       "Assignment to constant variable."，把整条降级链打断。 */
    let signal = opts.signal;
    let ac, timer;
    if (!signal && window.AbortController) {
      ac = new AbortController(); signal = ac.signal;
      timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    }
    const clean = () => { if (timer) clearTimeout(timer); };

    try {
      /* --- 1. native bridge (Electron / custom shell) --- */
      if (cfg.useNative && window.RainNative && typeof window.RainNative.fetch === 'function') {
        const r = await window.RainNative.fetch(url, {
          method, headers, body: opts.body || null, timeout: cfg.timeoutMs
        });
        clean();
        if (!r || r.ok === false) throw httpError(r && r.status || 0, url, r && r.body);
        return (typeof r.body === 'string') ? r.body : JSON.stringify(r.body);
      }
      /* --- 2. Capacitor native HTTP (Android / iOS) --- */
      if (cfg.useNative && window.Capacitor && window.Capacitor.Plugins &&
          window.Capacitor.Plugins.CapacitorHttp) {
        const P = window.Capacitor.Plugins.CapacitorHttp;
        let data;
        try { data = opts.body ? JSON.parse(opts.body) : undefined; }
        catch (e) { data = opts.body; }
        const r = await P.request({
          url, method, headers, data,
          responseType: 'text', connectTimeout: cfg.timeoutMs, readTimeout: cfg.timeoutMs
        });
        clean();
        if (r.status < 200 || r.status >= 300) throw httpError(r.status, url, r.data);
        return (typeof r.data === 'string') ? r.data : JSON.stringify(r.data);
      }
      /* --- 3. browser fetch --- */
      const res = await fetch(url, { method, headers, body: opts.body || undefined, signal,
        cache: 'no-store', credentials: 'omit' });
      clean();
      const text = await res.text();
      if (!res.ok) throw httpError(res.status, url, text);
      return text;
    } catch (e) {
      clean();
      if (e && e.name === 'AbortError') {
        const t = new Error('Timeout · ' + url); t.timeout = true; throw t;
      }
      throw e;
    }
  }
  async function json(url, opts) {
    const text = await http(url, opts);
    try { return JSON.parse(text); } catch (e) {
      throw new Error('Response is not JSON: ' + String(text).slice(0, 90));
    }
  }

  /* --------------------------------------------------------- path helpers */
  function pick(obj, path) {
    if (!path || !obj) return undefined;
    const parts = String(path).replace(/\[(\d+)\]/g, '.$1').split('.').filter(Boolean);
    let cur = obj;
    for (const p of parts) {
      if (cur == null || (typeof cur !== 'object' && typeof cur !== 'function')) return undefined;
      // own properties only — otherwise an array's native `values()` method
      // shadows real data during auto-detection
      if (!Object.prototype.hasOwnProperty.call(cur, p)) return undefined;
      cur = cur[p];
    }
    return cur;
  }
  function firstOf(obj, keys) {
    for (const k of keys) {
      const v = pick(obj, k);
      if (v !== undefined && v !== null) return v;
    }
    return undefined;
  }
  const VALUE_KEYS = ['mmh', 'precip', 'precipitation', 'rain', 'rainfall', 'value', 'p', 'intensity', 'amount', 'prcp', 'tp', 'v'];
  const TIME_KEYS = ['time', 'timestamp', 'datetime', 'date', 'hour', 't', 'fxTime', 'obsTime'];

  /* ----------------------------------------------------------- CSV / text */
  function parseText(text) {
    const t = String(text).trim();
    if (!t) throw new Error('Empty payload');
    if (t[0] === '{' || t[0] === '[') { try { return JSON.parse(t); } catch (e) { /* fall through */ } }
    const lines = t.split(/\r?\n/).filter(l => l.trim() && !/^\s*#/.test(l));
    const sep = (lines[0].indexOf('\t') >= 0) ? '\t' : (lines[0].indexOf(';') >= 0 ? ';' : ',');
    const rows = lines.map(l => l.split(sep).map(s => s.trim().replace(/^["']|["']$/g, '')));
    const head = rows[0].map(s => s.toLowerCase());
    const hasHead = head.some(h => /[a-z]/.test(h)) && !isNum(parseFloat(head[0]));
    let vIdx = hasHead ? head.findIndex(h => /mm|rain|precip|value|p$|v$/.test(h)) : 1;
    let tIdx = hasHead ? head.findIndex(h => /time|date|hour/.test(h)) : 0;
    if (vIdx < 0) vIdx = rows[0].length - 1;
    if (tIdx < 0) tIdx = 0;
    if (vIdx === tIdx && rows[0].length > 1) vIdx = rows[0].length - 1;
    return rows.slice(hasHead ? 1 : 0).map(r => ({ time: r[tIdx], mmh: parseFloat(r[vIdx]) }))
      .filter(r => isNum(r.mmh));
  }

  /* ---------------------------------------------------------- normalize
   * Everything ends here. It accepts:
   *   - a full WeatherFrame (schema match)
   *   - number[25] / number[24] / number[]
   *   - {values:[...]}, {data:[...]}, {hourly:{time:[],precipitation:[]}}
   *   - [{time, mmh}, ...] / plain pairs
   *   - CSV / JSON text
   *   - anything reachable via cfg.mapping.valuePath (+ timePath)
   * and always returns a WeatherFrame with 25 hourly values.
   */
  function normalize(raw, opts) {
    opts = opts || {};
    const source = opts.source || cfg.provider || 'custom';
    const maxMm = opts.maxMm || cfg.maxMm || 20;
    let payload = raw;
    if (typeof payload === 'string') payload = parseText(payload);
    if (payload && payload.schema === SCHEMA) {
      const f = Object.assign({}, payload);
      f.values = (Array.isArray(f.values) ? f.values.slice(0, 25) : [])
        .map(v => clamp(+v || 0, 0, maxMm));
      while (f.values.length < 25) f.values.push(0);
      f.hours = f.hours || [];
      f.location = f.location || { name: cfg.city, lat: cfg.lat, lon: cfg.lon, timezone: cfg.timezone };
      f.fetchedAt = f.fetchedAt || nowISO();
      f.mode = f.mode || 'custom';
      return f;
    }

    /* custom JSON path mapping — the "any server, any shape" escape hatch */
    let timeArr = null, valArr = null, tempArr = null, humArr = null, codeArr = null;
    // Manual / file payloads are explicit: never let a leftover valuePath
    // from a previous "custom HTTP" source reinterpret them.
    const mp = (opts.ignoreMapping || opts.source === 'manual' || /^file:/.test(String(opts.source || '')))
      ? { scale: 1, align: 'day' } : (cfg.mapping || {});
    if (mp.valuePath) {
      const explicit = pick(payload, mp.valuePath);
      timeArr = mp.timePath ? pick(payload, mp.timePath) : null;
      tempArr = pick(payload, 'hourly.temperature_2m');
      humArr = pick(payload, 'hourly.relativehumidity_2m');
      codeArr = pick(payload, 'hourly.weather_code');
      if (Array.isArray(explicit)) valArr = explicit;
      else if (explicit && typeof explicit === 'object') valArr = Object.keys(explicit).sort().map(k => explicit[k]);
      else if (isNum(explicit) || (typeof explicit === 'string' && explicit !== '')) valArr = [Number(explicit)];
      // path not present in this payload -> valArr stays null, auto-detect below
    }

    if (!valArr) {
      const hourly = payload && (payload.hourly || (payload.data && payload.data.hourly) ||
        (payload.result && payload.result.hourly) || (payload.forecast && payload.forecast.hourly));
      if (hourly && typeof hourly === 'object') {
        valArr = firstOf(hourly, VALUE_KEYS);
        timeArr = firstOf(hourly, TIME_KEYS);
        tempArr = firstOf(hourly, ['temperature_2m', 'temp', 'temperature']);
        humArr = firstOf(hourly, ['relative_humidity_2m', 'relativehumidity_2m', 'humidity']);
        codeArr = firstOf(hourly, ['weather_code', 'weathercode', 'code']);
      }
    }
    if (!valArr) valArr = firstOf(payload, ['values', 'data', 'series', 'list', 'precipitation', 'rain', 'result']);
    if (!valArr && Array.isArray(payload)) valArr = payload;
    if (!valArr && payload && typeof payload === 'object') {
      // an object keyed by hour, e.g. {"0":0.2,"1":0.4,...}
      const keys = Object.keys(payload).filter(k => /^\d{1,2}$/.test(k));
      if (keys.length) { timeArr = keys; valArr = keys.map(k => payload[k]); }
    }
    if (!valArr) throw new Error('Cannot find precipitation values in payload (set mapping.valuePath)');
    if (!Array.isArray(valArr)) throw new Error('Precipitation field is not an array (got ' +
      (Array.isArray(valArr) ? 'array' : typeof valArr) + ': ' + String(valArr).slice(0, 90) + ')');
    if (!valArr.length) throw new Error('Precipitation array is empty');

    const hours = [];
    for (let i = 0; i < valArr.length; i++) {
      const item = valArr[i];
      let mmh, time = null, temp = null, humidity = null, code = null, desc = null;
      if (isNum(item)) mmh = item;
      else if (item && typeof item === 'object') {
        mmh = firstOf(item, VALUE_KEYS);
        time = firstOf(item, TIME_KEYS);
        temp = firstOf(item, ['temp', 'temperature', 'temperature_2m', 'temperatureC']);
        humidity = firstOf(item, ['humidity', 'rh', 'relative_humidity_2m']);
        code = firstOf(item, ['code', 'weather_code', 'weathercode', 'icon']);
        desc = firstOf(item, ['desc', 'text', 'description', 'weather']);
      }
      if (!isNum(mmh)) mmh = parseFloat(mmh);
      if (!isNum(mmh)) mmh = 0;
      if (time == null && timeArr && timeArr[i] != null) time = timeArr[i];
      if (temp == null && tempArr && tempArr[i] != null) temp = +tempArr[i];
      if (humidity == null && humArr && humArr[i] != null) humidity = +humArr[i];
      if (code == null && codeArr && codeArr[i] != null) code = codeArr[i];
      hours.push({ time, hour: hourOf(time, i), mmh: mmh * (Number(mp.scale) || 1),
        temp: isNum(temp) ? temp : null, humidity: isNum(humidity) ? humidity : null,
        code: code == null ? null : code, desc: desc || null });
    }

    const values = buildDay(hours, maxMm, (mp.align || 'day'));
    const loc = (payload && (payload.location || payload.geo)) || {};
    const frame = {
      schema: SCHEMA,
      source,
      mode: opts.mode || 'live',
      location: {
        name: payload && (payload.city || payload.locationName) || loc.name || cfg.city || '',
        lat: isNum(payload && payload.latitude) ? payload.latitude : (isNum(loc.lat) ? loc.lat : cfg.lat),
        lon: isNum(payload && payload.longitude) ? payload.longitude : (isNum(loc.lon) ? loc.lon : cfg.lon),
        timezone: payload && (payload.timezone || payload.tz) || (loc.tz) || cfg.timezone
      },
      observedAt: (payload && (payload.observedAt || payload.updateTime)) || nowISO(),
      fetchedAt: nowISO(),
      unit: 'mm/h',
      hours,
      values,
      meta: {
        version: VERSION,
        points: hours.length,
        align: mp.align || 'day',
        maxMm,
        transport: opts.transport || source,
        tailExtrapolated: true
      },
      raw: payload
    };
    return frame;
  }

  function hourOf(time, index) {
    if (typeof time === 'string') {
      // explicit zone (Z / +08:00) -> convert to the viewer's local hour
      if (/(?:Z|[+-]\d{2}:?\d{2})$/.test(time)) {
        const dz = new Date(time);
        if (!isNaN(dz.getTime())) return dz.getHours();
      }
      const m = time.match(/[T\s](\d{1,2}):/);           // Open-Meteo local "2026-11-05T14:00"
      if (m) return clamp(parseInt(m[1], 10), 0, 23);
      if (/^\d{1,2}$/.test(time.trim())) return clamp(parseInt(time, 10), 0, 23);
      const d = new Date(time);
      if (!isNaN(d.getTime())) return d.getHours();
    }
    if (isNum(time)) {
      const d = new Date(time > 1e11 ? time : time * 1000);
      if (!isNaN(d.getTime())) return d.getHours();
    }
    return index % 24;
  }
  function buildDay(hours, maxMm, align) {
    // 25+ values with no timestamps already mean 00:00..24:00 — keep them
    // verbatim (otherwise the 25th sample would wrap around onto hour 0).
    const noTime = hours.every(h => h.time == null);
    if (noTime && hours.length >= 25 && (align || 'day') === 'day') {
      return hours.slice(0, 25).map(h => clamp(Number(h.mmh) || 0, 0, maxMm));
    }
    const bucket = new Array(24).fill(null);
    hours.forEach(h => { bucket[clamp(h.hour, 0, 23)] = h.mmh; });
    // linear-fill interior gaps; unknown leading/trailing hours stay dry (0)
    for (let i = 0; i < 24; i++) {
      if (bucket[i] !== null) continue;
      let a = i - 1, b = i + 1;
      while (a >= 0 && bucket[a] === null) a--;
      while (b < 24 && bucket[b] === null) b++;
      bucket[i] = (a >= 0 && b < 24)
        ? bucket[a] + (bucket[b] - bucket[a]) * (i - a) / (b - a) : 0;
    }
    let src = bucket;
    if (align === 'now' && hours.length > 24) {
      // rolling 25h window: 6h history + 18h forecast, mapped onto 0..24
      const seq = hours.map(h => h.mmh);
      const cur = new Date().getHours();
      const start = Math.max(0, Math.min(seq.length - 25, cur - 6));
      src = seq.slice(start, start + 24);
      while (src.length < 24) src.push(src[src.length - 1] || 0);
    }
    const out = src.map(v => clamp(Number(v) || 0, 0, maxMm));
    out.push(out[23]);                 // 25th sample = 24:00, hold last hour
    return out;
  }
  /* ------------------------------------------------------------- demo data */
  const DEMO = [0.6, 0.4, 0.3, 0.5, 0.8, 1.4, 2.2, 3.1, 2.6, 3.8,
    5.2, 7.4, 9.6, 6.8, 4.6, 5.9, 8.8, 12.4, 15.6, 13.2,
    10.1, 7.2, 4.4, 2.5, 1.2];
  function demoFrame(mode) {
    return normalize({ values: DEMO.slice(), city: 'Demo / 示例数据', timezone: 'local' },
      { source: 'demo', mode: mode || 'demo' });
  }

  /* ------------------------------------------------------------ providers */
  const providers = Object.create(null);

  function define(def) { providers[def.id] = def; return def; }

  function qs(obj) {
    return Object.keys(obj).filter(k => obj[k] !== undefined && obj[k] !== null && obj[k] !== '')
      .map(k => encodeURIComponent(k) + '=' + encodeURIComponent(obj[k])).join('&');
  }
  function coordQuery() {
    return qs({ lat: cfg.lat, lon: cfg.lon, city: cfg.city, timezone: cfg.timezone });
  }

  /* -- 0. Rainform 服务器实时降雨（自建后端，serve 版默认源） ----------- */
  define({
    id: 'liverain', group: 'server',
    label: '服务器实时降雨 · LIVE', en: 'Rainform server · LIVE',
    hint: '按访客 IP 自动定位 · 服务器每 30 分钟刷新缓存 · 需要后端 /api/rainfall',
    kind: 'poll', needs: [],
    async fetch(ctx) {
      const base = apiBase();
      if (!base) throw new Error('未配置服务器地址（自建服务器 → 服务器地址）');
      /* 不传 city 时后端按访客 IP 定位；传了就走指定城市。
         refresh=1 让后端跳过缓存强制回源（后端有 10 秒最小间隔保护）。 */
      const q = qs({ city: ctx.cfg.city, refresh: ctx.cfg.forceRefresh ? 1 : '' });
      const raw = await ctx.json(base + '/api/rainfall' + (q ? '?' + q : ''));
      if (!raw || !Array.isArray(raw.values) || !raw.values.length) {
        throw new Error('服务器返回的降雨数据格式不正确');
      }
      return {
        schema: SCHEMA,
        values: raw.values,
        city: raw.city || ctx.cfg.city,
        location: {
          name: raw.city || ctx.cfg.city,
          lat: raw.lat, lon: raw.lon,
          timezone: ctx.cfg.timezone
        },
        source: raw.source || 'Rainform Server',
        updatedAt: raw.updated_at,
        cached: !!raw.cached,
        mode: 'live'
      };
    }
  });

  /* -- 1. offline demo -------------------------------------------------- */
  define({
    id: 'demo', group: 'local', label: '内置演示数据', en: 'Built-in demo',
    hint: '离线可用 · 25 点示例数据，无需网络', kind: 'poll', needs: [],
    async fetch() { return { values: DEMO.slice(), city: 'Demo / 示例数据' }; }
  });

  /* -- 2. Open-Meteo: free, keyless, CORS enabled (works TODAY) --------- */
  define({
    id: 'openmeteo', group: 'public', label: 'Open-Meteo 官方实时', en: 'Open-Meteo live',
    hint: '免费 · 免 Key · 浏览器直连 · 逐小时降水', kind: 'poll', needs: ['city'],
    async fetch(ctx) {
      const q = qs({
        latitude: ctx.cfg.lat, longitude: ctx.cfg.lon,
        hourly: 'precipitation,temperature_2m,relative_humidity_2m,weather_code',
        past_hours: 6, forecast_hours: 24, forecast_days: 2,
        timezone: ctx.cfg.timezone === 'auto' ? 'auto' : ctx.cfg.timezone
      });
      const raw = await ctx.json('https://api.open-meteo.com/v1/forecast?' + q);
      raw.city = ctx.cfg.city || (raw.latitude + ',' + raw.longitude);
      return raw;
    }
  });

  /* -- 3. OpenWeatherMap (key required, interface reserved) ------------- */
  define({
    id: 'openweather', group: 'public', label: 'OpenWeatherMap', en: 'OpenWeatherMap',
    hint: '需 API Key · OneCall 3.0 逐小时', kind: 'poll', needs: ['city', 'key'],
    async fetch(ctx) {
      if (!ctx.cfg.apiKey) throw new Error('Missing API key (cfg.apiKey)');
      const q = qs({ lat: ctx.cfg.lat, lon: ctx.cfg.lon, appid: ctx.cfg.apiKey,
        units: 'metric', exclude: 'minutely,daily,alerts' });
      const raw = await ctx.json('https://api.openweathermap.org/data/3.0/onecall?' + q);
      if (!raw || !raw.hourly) throw new Error('Unexpected OneCall payload');
      return {
        city: ctx.cfg.city,
        hourly: {
          time: raw.hourly.map(h => new Date(h.dt * 1000).toISOString()),
          precipitation: raw.hourly.map(h => (h.rain && h.rain['1h']) || 0),
          temperature_2m: raw.hourly.map(h => h.temp),
          relative_humidity_2m: raw.hourly.map(h => h.humidity),
          weather_code: raw.hourly.map(h => h.weather && h.weather[0] && h.weather[0].id)
        }
      };
    }
  });

  /* -- 4. QWeather 和风天气 (domestic CN, key + host required) ---------- */
  define({
    id: 'qweather', group: 'public', label: '和风天气 / QWeather', en: 'QWeather',
    hint: '国内可用 · 需 Key + API Host · 24h 逐小时', kind: 'poll', needs: ['city', 'key', 'host'],
    async fetch(ctx) {
      if (!ctx.cfg.apiKey || !ctx.cfg.apiHost) throw new Error('Missing apiKey / apiHost');
      const host = ctx.cfg.apiHost.replace(/^https?:\/\//, '').replace(/\/$/, '');
      const q = qs({ location: ctx.cfg.lon + ',' + ctx.cfg.lat, key: ctx.cfg.apiKey });
      const raw = await ctx.json('https://' + host + '/v7/weather/24h?' + q);
      if (!raw || !raw.hourly) throw new Error('Unexpected QWeather payload');
      return {
        city: ctx.cfg.city, updateTime: raw.updateTime,
        hourly: {
          time: raw.hourly.map(h => h.fxTime),
          precipitation: raw.hourly.map(h => parseFloat(h.precip) || 0),
          temperature_2m: raw.hourly.map(h => parseFloat(h.temp)),
          relative_humidity_2m: raw.hourly.map(h => parseFloat(h.humidity)),
          weather_code: raw.hourly.map(h => h.icon)
        }
      };
    }
  });

  /* -- 5. self-hosted REST server ---------------------------------------- */
  define({
    id: 'server', group: 'server', label: '自建服务器 REST', en: 'Your server (REST)',
    hint: 'GET /api/weather · 可接数据库 / 气象站 / 任意后端', kind: 'poll', needs: ['server'],
    async fetch(ctx) {
      if (!ctx.cfg.server) throw new Error('Missing server URL');
      return await ctx.json(restURL(ctx.cfg.server, ctx.cfg.restPath) + '?' + coordQuery());
    }
  });

  /* -- 6. regional weather crawler (server-side, CORS-free) -------------- */
  define({
    id: 'crawler', group: 'server', label: '地区天气爬取接口', en: 'Regional crawler',
    hint: 'GET /api/crawl · 服务端抓取+解析地区气象页面，浏览器端只留接口',
    kind: 'poll', needs: ['server', 'city'],
    async fetch(ctx) {
      if (!ctx.cfg.server) throw new Error('Missing server URL (weather/server)');
      const url = restURL(ctx.cfg.server, ctx.cfg.crawlPath) + '?' +
        qs({ city: ctx.cfg.city, lat: ctx.cfg.lat, lon: ctx.cfg.lon,
          url: (ctx.cfg.mapping && ctx.cfg.mapping.crawlUrl) || '' });
      return await ctx.json(url);
    }
  });

  /* -- 7. custom HTTP endpoint + JSON path mapping ----------------------- */
  define({
    id: 'custom', group: 'server', label: '自定义 HTTP 接口', en: 'Custom HTTP',
    hint: '任意 URL + JSON 字段路径 + 自定义请求头，最通用的接入口',
    kind: 'poll', needs: ['url'],
    async fetch(ctx) {
      if (!ctx.cfg.url) throw new Error('Missing URL (cfg.url)');
      return await ctx.json(ctx.cfg.url);
    }
  });

  /* -- 8. SSE push ------------------------------------------------------- */
  define({
    id: 'sse', group: 'push', label: 'SSE 服务器推送', en: 'Server-Sent Events',
    hint: 'EventSource /api/stream · 服务端有新数据即推送', kind: 'push', needs: ['server'],
    subscribe(ctx, emitFrame) {
      if (typeof EventSource === 'undefined') { emitFrame(new Error('EventSource unsupported')); return () => {}; }
      const url = restURL(ctx.cfg.server, ctx.cfg.streamPath) + '?' + coordQuery();
      let es, alive = true, retry;
      const open = () => {
        if (!alive) return;
        try { es = new EventSource(url, { withCredentials: false }); } catch (e) {
          emitFrame(e); retry = setTimeout(open, 4000); return;
        }
        es.onmessage = ev => { try { emitFrame(JSON.parse(ev.data)); } catch (e) { emitFrame(ev.data); } };
        es.addEventListener('weather', ev => { try { emitFrame(JSON.parse(ev.data)); } catch (e) { emitFrame(ev.data); } });
        es.onerror = () => { try { es.close(); } catch (e) {} retry = setTimeout(open, 4000); };
      };
      open();
      return () => { alive = false; clearTimeout(retry); if (es) es.close(); };
    }
  });

  /* -- 9. WebSocket push ------------------------------------------------- */
  define({
    id: 'ws', group: 'push', label: 'WebSocket 实时推送', en: 'WebSocket stream',
    hint: 'ws://…/ws · 双向实时帧，断线自动重连', kind: 'push', needs: ['server'],
    subscribe(ctx, emitFrame) {
      const url = wsURL(ctx.cfg.server, ctx.cfg.wsPath);
      let sock, alive = true, retry;
      const open = () => {
        if (!alive) return;
        try { sock = new WebSocket(url); } catch (e) { emitFrame(e); retry = setTimeout(open, 4000); return; }
        sock.onmessage = ev => { try { emitFrame(JSON.parse(ev.data)); } catch (e) { emitFrame(ev.data); } };
        sock.onclose = () => { if (alive) retry = setTimeout(open, 3500); };
        sock.onerror = () => { /* onclose handles reconnect */ };
      };
      open();
      return () => { alive = false; clearTimeout(retry); if (sock) sock.close(); };
    }
  });

  /* -- 10. MQTT over WebSocket (reserved interface) ---------------------- */
  define({
    id: 'mqtt', group: 'push', label: 'MQTT over WS（预留）', en: 'MQTT over WS (reserved)',
    hint: '需页面注入 mqtt.js 或由服务端桥接；协议接口已就绪', kind: 'push', needs: ['url'],
    subscribe(ctx, emitFrame) {
      const mq = window.mqtt;
      if (!mq || typeof mq.connect !== 'function') {
        emitFrame(new Error('MQTT: inject mqtt.js (window.mqtt) or bridge via server WebSocket'));
        return () => {};
      }
      const c = mq.connect(ctx.cfg.mqttUrl || ctx.cfg.url, { reconnectPeriod: 4000 });
      c.on('message', (topic, msg) => { try { emitFrame(JSON.parse(msg.toString())); } catch (e) { emitFrame(msg.toString()); } });
      if (ctx.cfg.topic) c.on('connect', () => c.subscribe(ctx.cfg.topic));
      return () => { try { c.end(true); } catch (e) {} };
    }
  });

  /* -- 11. manual / file import ------------------------------------------ */
  define({
    id: 'manual', group: 'local', label: '本地文件 / 粘贴导入', en: 'File / paste import',
    hint: 'JSON / CSV / 25 个数字，完全离线', kind: 'local', needs: [],
    async fetch() {
      const f = runtime.lastFrame;
      if (!f) throw new Error('Import JSON/CSV first');
      return f;
    }
  });

  /* ------------------------------------------------------- public registry */
  function register(id, def) {
    if (!id || !def) throw new Error('register(id, providerDef)');
    if (typeof def === 'function') def = { fetch: def };
    return define(Object.assign({
      id, group: 'custom', label: id, en: id, hint: 'Custom provider', kind: 'poll', needs: []
    }, def));
  }
  function providerList() {
    return Object.keys(providers).map(k => {
      const p = providers[k];
      return { id: p.id, group: p.group, label: p.label, en: p.en || p.label,
        hint: p.hint || '', kind: p.kind, needs: p.needs || [] };
    });
  }

  /* --------------------------------------------------------------- context */
  function context(signal) {
    return {
      cfg, signal, maxMm: cfg.maxMm, version: VERSION, now: nowISO,
      http: (url, o) => http(url, Object.assign({ signal }, o)),
      json: (url, o) => json(url, Object.assign({ signal }, o)),
      log, normalize,
      locate: geolocate,
      geocode: geocode
    };
  }

  /* ----------------------------------------------------------- geolocation */
  function geolocate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) { reject(new Error('Geolocation unavailable')); return; }
      navigator.geolocation.getCurrentPosition(pos => {
        cfg.lat = +pos.coords.latitude.toFixed(4);
        cfg.lon = +pos.coords.longitude.toFixed(4);
        cfg.city = cfg.city || (cfg.lat + ',' + cfg.lon);
        saveCfg(); render();
        resolve({ lat: cfg.lat, lon: cfg.lon });
      }, err => reject(new Error('Geolocation: ' + err.message)),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 });
    });
  }
  async function geocode(name) {
    const q = qs({ name: name || cfg.city, count: 1, language: 'zh', format: 'json' });
    const r = await json('https://geocoding-api.open-meteo.com/v1/search?' + q);
    if (!r || !r.results || !r.results.length) throw new Error('City not found: ' + name);
    const g = r.results[0];
    cfg.lat = g.latitude; cfg.lon = g.longitude; cfg.city = g.name;
    cfg.timezone = g.timezone || 'auto';
    saveCfg(); render();
    return { name: g.name, lat: g.latitude, lon: g.longitude, country: g.country };
  }

  /* --------------------------------------------------------- apply to viz */
  let tween = { raf: 0, from: null, to: null, start: 0 };
  function pushToRain(values, immediate) {
    const R = window.Rainform;
    if (!R || typeof R.update !== 'function' || !cfg.autoApply) return;
    if (cfg.pauseOnEdit && R.state && R.state.dragCurve >= 0) return;
    if (tween.raf) cancelAnimationFrame(tween.raf);
    const to = values.slice(0, 25);
    if (immediate || !cfg.transitionMs || !R.state) { R.update(to); return; }
    // read current curve through the LUT-free public state is not exposed, so
    // tween from the last applied frame (or from the demo curve on cold start)
    const from = runtime.lastApplied ? runtime.lastApplied.slice() : DEMO.slice();
    const dur = Math.max(120, cfg.transitionMs);
    tween.from = from; tween.to = to; tween.start = performance.now();
    const step = t => {
      const k = clamp((t - tween.start) / dur, 0, 1);
      const e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      const mix = from.map((v, i) => v + (to[i] - v) * e);
      R.update(mix);
      runtime.lastApplied = mix;
      if (k < 1) tween.raf = requestAnimationFrame(step);
      else { tween.raf = 0; runtime.lastApplied = to.slice(); }
    };
    tween.raf = requestAnimationFrame(step);
  }
  function acceptFrame(frame, why) {
    runtime.lastFrame = frame;
    runtime.lastFetchAt = Date.now();
    runtime.seq++;
    if (frame.mode === 'live' || frame.mode === 'push' || frame.mode === 'custom' || frame.mode === 'manual') {
      storeSet(CACHE_KEY, { at: Date.now(), frame: Object.assign({}, frame, { raw: null }) });
    }
    pushToRain(frame.values, why === 'immediate');
    emit('frame', frame);
    render();
  }

  /* ------------------------------------------------------------- fallback */
  function fromCache() {
    const c = storeGet(CACHE_KEY, null);
    if (!c || !c.frame || !c.frame.values) return null;
    if (Date.now() - c.at > cfg.cacheTTL) return null;
    const f = Object.assign({}, c.frame, {
      mode: 'cache', fetchedAt: nowISO(),
      meta: Object.assign({}, c.frame.meta, { cacheAgeMin: Math.round((Date.now() - c.at) / 60000) })
    });
    return f;
  }
  async function runFallback(err) {
    runtime.lastError = err && err.message || String(err);
    log('Provider failed: ' + runtime.lastError, 'error');
    for (const id of (cfg.fallback || [])) {
      try {
        if (id === 'cache') {
          const f = fromCache();
          if (f) { setStatus('stale', 'cache'); acceptFrame(f, 'immediate'); log('Fallback -> localStorage cache'); return true; }
        } else if (id === 'demo') {
          setStatus('stale', 'demo');
          acceptFrame(demoFrame('fallback'), 'immediate');
          log('Fallback -> built-in demo data'); return true;
        } else if (providers[id] && providers[id].fetch) {
          const def = providers[id];
          const raw = await def.fetch(context());
          const f = normalize(raw, { source: id, mode: 'fallback' });
          setStatus('stale', id);
          acceptFrame(f); log('Fallback -> ' + id); return true;
        }
      } catch (e) { log('Fallback ' + id + ': ' + e.message, 'error'); }
    }
    setStatus('error', runtime.lastError);
    emit('error', err);
    return false;
  }

  /* -------------------------------------------------------------- refresh */
  let inflight = null, controller = null;
  async function refresh(reason) {
    const def = providers[cfg.provider];
    if (!def) throw new Error('Unknown provider: ' + cfg.provider);
    /* Push transports (SSE / WebSocket / MQTT) have no fetch(). Pressing
       "Fetch now" on one of them means "re-subscribe", not "poll once".
       Delegating keeps the action meaningful and, importantly, never creates
       an unhandled rejection from an async public API. */
    if (def.kind === 'push') { start(); return null; }
    if (!def.fetch) throw new Error('Provider does not support fetch: ' + cfg.provider);
    if (inflight) return inflight;
    if (controller) { try { controller.abort(); } catch (e) {} }
    if (window.AbortController) controller = new AbortController();
    setStatus('connecting', reason || '');
    log('Fetch ← ' + cfg.provider + (reason ? ' (' + reason + ')' : ''));

    inflight = (async () => {
      let lastErr;
      for (let attempt = 0; attempt <= (cfg.retries || 0); attempt++) {
        try {
          const raw = await def.fetch(context(controller && controller.signal));
          // if a custom transform is supplied, it owns the mapping entirely
          const shaped = (typeof cfg.transform === 'function')
            ? cfg.transform(raw, context())
            : raw;
          const frame = (shaped && shaped.schema === SCHEMA)
            ? normalize(shaped, { source: cfg.provider, mode: 'custom' })
            : normalize(shaped, { source: cfg.provider, mode: cfg.provider === 'demo' ? 'demo' : 'live' });
          runtime.lastError = null;
          runtime.attempts = 0;
          runtime.nextFetchAt = Date.now() + cfg.intervalMs;
          setStatus('live', cfg.provider);
          log('OK → ' + frame.values.length + ' points · ' + frame.location.name);
          acceptFrame(frame);
          return frame;
        } catch (e) {
          lastErr = e;
          log('Attempt ' + (attempt + 1) + ' failed: ' + e.message, 'error');
          if (attempt < (cfg.retries || 0)) {
            await new Promise(r => setTimeout(r, cfg.backoffMs * Math.pow(2, attempt)));
          }
        }
      }
      await runFallback(lastErr);
      return null;
    })().finally(() => { inflight = null; });
    return inflight;
  }

  /* -------------------------------------------------------------- scheduler */
  let pollTimer = 0, disposePush = null, pushWatchdog = 0;
  function stop() {
    runtime.running = false;
    if (pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
    /* A push source's "no frame yet" watchdog belongs to that subscription.
       Leaving it armed would fire after the user switches to another provider
       and wrongly force the NEW source into stale/fallback state. */
    if (pushWatchdog) { clearTimeout(pushWatchdog); pushWatchdog = 0; }
    if (disposePush) { try { disposePush(); } catch (e) {} disposePush = null; }
    if (controller) { try { controller.abort(); } catch (e) {} controller = null; }
    if (tween.raf) { cancelAnimationFrame(tween.raf); tween.raf = 0; }
    setStatus('stopped', 'user');
  }
  function start() {
    stop();
    const def = providers[cfg.provider];
    if (!def) { setStatus('error', 'unknown provider'); return; }
    runtime.running = true;
    runtime.provider = cfg.provider;
    setStatus('connecting', 'start');
    if (def.kind === 'local') { refresh('local'); return; }
    if (def.kind === 'push') {
      let got = false;
      disposePush = def.subscribe(context(), payload => {
        if (payload instanceof Error) {
          runtime.lastError = payload.message;
          log('Stream error: ' + payload.message, 'error');
          setStatus('error', payload.message);
          return;
        }
        try {
          const frame = normalize(payload, { source: cfg.provider, mode: 'push', transport: def.kind });
          got = true;
          runtime.lastError = null;
          setStatus('live', 'push');
          acceptFrame(frame);
        } catch (e) {
          log('Bad push frame: ' + e.message, 'error');
          setStatus('error', e.message);
        }
      });
      // if no frame arrives quickly, fall back so the scene never looks broken
      const watchedProvider = cfg.provider;
      pushWatchdog = setTimeout(() => {
        pushWatchdog = 0;
        const stillSame = cfg.provider === watchedProvider && runtime.provider === watchedProvider;
        if (stillSame && runtime.running && !got) runFallback(new Error('No stream frame'));
      }, 5000);
      return;
    }
    refresh('start');
    pollTimer = setInterval(() => {
      runtime.nextFetchAt = Date.now() + cfg.intervalMs;
      refresh('interval');
    }, Math.max(15000, cfg.intervalMs));
  }

  /* ---------------------------------------------------------- public API */
  const API = {
    version: VERSION, schema: SCHEMA,
    get config() { return cfg; },
    get runtime() { return runtime; },
    get logs() { return recentLogs.slice(); },
    providers: providerList,
    register,
    on, off,
    normalize,
    getConfig: () => Object.assign({}, cfg),
    getState: () => Object.assign({}, runtime),
    configure(patch) {
      if (!patch || typeof patch !== 'object') return cfg;
      /* Never persist an unregistered provider id: a typo in an URL param or
         in a script would otherwise poison every later refresh()/start() call. */
      if (patch.provider && !providers[patch.provider]) {
        log('Unknown provider rejected: ' + patch.provider, 'warn');
        patch = Object.assign({}, patch, { provider: cfg.provider });
      }
      const wasRunning = runtime.running;
      const prevProvider = cfg.provider;
      Object.assign(cfg, patch);
      if (patch.mapping) cfg.mapping = Object.assign({}, DEFAULTS.mapping, cfg.mapping, patch.mapping);
      saveCfg();
      emit('config', cfg);
      render();
      if (wasRunning && (patch.provider && patch.provider !== prevProvider || patch.intervalMs)) start();
      return cfg;
    },
    setProvider(id) { if (!providers[id]) throw new Error('Unknown provider: ' + id); return API.configure({ provider: id }); },
    start, stop, refresh,
    restart() { start(); },
    useDemo(immediate) {
      stop();
      API.configure({ provider: 'demo', autoStart: false });
      const f = demoFrame('demo');
      acceptFrame(f, immediate !== false);
      setStatus('idle', 'demo');
      log('Switched to built-in demo data');
      return f;
    },
    /* direct injection — the simplest integration point for any future script */
    setValues(values, meta) {
      const f = normalize({ values: values, city: (meta && meta.city) || cfg.city },
        { source: (meta && meta.source) || 'custom', mode: 'custom', ignoreMapping: true });
      if (meta) Object.assign(f.meta, meta);
      acceptFrame(f);
      return f;
    },
    /* manual import: JSON / CSV / JSON string / number[25] */
    import(payload, opts) {
      const f = normalize(payload, Object.assign({ source: 'manual', mode: 'manual', ignoreMapping: true }, opts));
      acceptFrame(f);
      setStatus('live', 'manual');
      log('Imported ' + f.values.length + ' points');
      return f;
    },
    applyFrame(frame) { acceptFrame(normalize(frame), true); },
    geocode, geolocate,
    cache: fromCache,
    clearCache() { try { localStorage.removeItem(CACHE_KEY); } catch (e) {} log('Cache cleared'); },
    http, json,
    restURL, wsURL
  };

  window.RainWeather = API;

  /* ---------------------------------------------------- global top rain
     全球强降雨城市 TOP5，口径见后端 /api/top-rain：UTC 当日 24 个逐时值的
     平均（mm/h），等级按 24 小时累计标准换算。点击某城 = 把城市名写进
     「城市」输入框并触发 change，走与手动输入完全相同的链路。 */
  let trRows = [], trSelected = '', trTimer = 0, trLast = 0, trInflight = null;
  const TR_HALF = 30 * 60 * 1000;

  function trNode(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  function fmtMm(v) {
    const n = Number(v || 0);
    return n >= 10 ? n.toFixed(1) : n.toFixed(2);
  }
  function trSetStatus(text, warn) {
    const el = $('trStatus');
    if (!el) return;
    el.textContent = text || '';
    el.className = 'tr-status' + (warn ? ' warn' : '');
  }
  function renderTopRain(d) {
    const list = $('trList');
    if (!list) return;
    list.textContent = '';
    const rows = (d && d.cities) || [];
    if (!rows.length) {
      list.appendChild(trNode('div', 'tr-loading', L('榜单暂不可用，稍后点「刷新」重试', 'Ranking unavailable, tap Refresh')));
      trSetStatus((d && d.error) ? String(d.error) : L('未获取到榜单数据', 'No ranking data'), true);
      return;
    }
    trRows = rows;
    rows.forEach(x => {
      const row = trNode('div', 'tr-item');
      row.setAttribute('role', 'button');
      row.tabIndex = 0;
      row.title = x.city + ' · ' + L('日均 ', 'avg ') + fmtMm(x.day_avg) + ' mm/h · ' +
        L('24h 累计 ', '24h sum ') + fmtMm(x.day_sum) + ' mm · ' + L('峰值 ', 'peak ') + fmtMm(x.day_peak) + ' mm/h';
      row.appendChild(trNode('span', 'tr-rank', '0' + (x.rank || '?')));
      const main = trNode('div', 'tr-main');
      main.appendChild(trNode('div', 'tr-name', x.city));
      main.appendChild(trNode('div', 'tr-sub',
        (x.region || '') + ' · ' + (x.level || '') + ' · ' + L('累计 ', 'sum ') + fmtMm(x.day_sum) + ' mm'));
      row.appendChild(main);
      const val = trNode('div', 'tr-val');
      val.appendChild(trNode('div', 'tr-mm', fmtMm(x.day_avg)));
      val.appendChild(trNode('div', 'tr-unit', L('mm/h 日均', 'mm/h avg')));
      row.appendChild(val);
      row.appendChild(trNode('span', 'tr-arrow', '›'));
      if (trSelected === x.city) row.classList.add('sel');
      const pick = () => importTopCity(x.city, row);
      row.addEventListener('click', pick);
      row.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); }
      });
      list.appendChild(row);
    });
    const meta = $('trMeta');
    if (meta) {
      meta.textContent = L('口径 ', 'Ranked by ') + (d.rank_by || '-') + ' · ' +
        L('样本 ', 'sample ') + (d.sample_size || 0) + L(' 城', ' cities') + ' · ' +
        L('更新 ', 'updated ') + (d.updated_at || '-') +
        (d.cached ? L(' · 缓存', ' · cached') : L(' · 实时回源', ' · fresh')) +
        (d.stale ? L(' · 上游异常沿用上次', ' · stale upstream') : '') +
        (d.throttled ? L(' · 60 秒内刚刷新过', ' · throttled') : '');
    }
    const note = $('trNote');
    if (note) { note.textContent = d.note ? String(d.note) : ''; note.title = note.textContent; }
    trSetStatus(L('点击任一城市，即可自动导入当地 25 个逐时降雨值',
      'Tap a city to import its 25 hourly values'), false);
  }
  function importTopCity(name, row) {
    const input = $('weatherCity');
    if (!input) { trSetStatus(L('页面尚未就绪，请稍后再点', 'Not ready yet, try again'), true); return; }
    trSelected = name;
    const list = $('trList');
    if (list) Array.prototype.forEach.call(list.children, n => n.classList.remove('sel'));
    if (row) row.classList.add('sel');
    input.value = name;
    input.dispatchEvent(new Event('change', { bubbles: true }));
    trSetStatus(L('正在导入「', 'Importing ') + name + L('」的 25 个逐时降雨值…', ' hourly values…'), false);
    /* 以真实数据帧为准给反馈，不用固定延时假装完成 */
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const f = runtime.lastFrame;
      const fc = f && f.location ? String(f.location.name || '') : '';
      const hit = fc && (fc.indexOf(name) >= 0 || name.indexOf(fc) >= 0);
      if (hit) {
        clearInterval(timer);
        if (trSelected === name) {
          trSetStatus(L('已导入 ', 'Imported ') + name + L(' · 雨幕与曲线已更新，每 30 分钟自动刷新',
            ' · scene updated, refreshes every 30 min'), false);
        }
      } else if (tries >= 40) {
        clearInterval(timer);
        if (trSelected === name) {
          trSetStatus(L('已发起导入 ', 'Requested ') + name + L('，若曲线未更新请点「立即拉取」',
            ', tap Fetch now if the curve did not move'), true);
        }
      }
    }, 300);
  }
  async function loadTopRain(force) {
    const list = $('trList');
    if (!list) return null;
    const base = apiBase();
    if (!base) {
      list.textContent = '';
      list.appendChild(trNode('div', 'tr-loading', L('未配置服务器，无法获取全球榜单', 'No server configured')));
      trSetStatus('', false);
      return null;
    }
    if (trInflight) return trInflight;
    const btn = $('trRefresh');
    if (btn) btn.disabled = true;
    list.textContent = '';
    list.appendChild(trNode('div', 'tr-loading', L('正在查询全球主要城市的当前雨势…', 'Querying global rainfall…')));
    trInflight = fetch(base + '/api/top-rain' + (force ? '?refresh=1' : ''), { cache: 'no-store' })
      .then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(d => { trLast = Date.now(); renderTopRain(d); return d; })
      .catch(e => {
        list.textContent = '';
        list.appendChild(trNode('div', 'tr-loading', L('榜单加载失败，点「刷新」重试', 'Failed, tap Refresh')));
        trSetStatus(L('无法连接降雨数据服务：', 'Cannot reach the rainfall service: ') + (e && e.message ? e.message : e), true);
        return null;
      })
      .then(d => { trInflight = null; if (btn) btn.disabled = false; return d; });
    return trInflight;
  }
  /* 与 server 的 :00 / :30 定时器同拍：整点/半点后延 6 秒再读，避免拿到旧缓存；
     若当前已过边界 6 秒就直接等下一拍，不在整点刚过时白等半小时。 */
  function scheduleTopRain() {
    if (!apiBase()) return;
    if (trTimer) clearTimeout(trTimer);
    const now = Date.now();
    const boundary = Math.floor(now / TR_HALF) * TR_HALF;
    let target = boundary + 6000;
    if (target <= now) target = boundary + TR_HALF + 6000;
    trTimer = setTimeout(() => {
      loadTopRain(false);
      trTimer = setInterval(() => loadTopRain(false), TR_HALF);
    }, Math.max(1000, target - now));
  }
  function mountTopRain() {
    const box = $('trBox');
    if (!box || box.dataset.bound === '1') return;
    box.dataset.bound = '1';
    const btn = $('trRefresh');
    if (btn) btn.addEventListener('click', () => loadTopRain(true));
    loadTopRain(false);
    scheduleTopRain();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) return;
      if (Date.now() - trLast > 5 * 60 * 1000) loadTopRain(false);
    });
  }

  /* ------------------------------------------------------------------- UI */
  let mounted = false;
  const GROUPS = {
    local:  { zh: '本地 / 离线', en: 'Local / offline' },
    public: { zh: '公开气象 API', en: 'Public weather API' },
    server: { zh: '自建服务器 / 通用接口', en: 'Your server / generic' },
    push:   { zh: '实时推送', en: 'Live push' },
    custom: { zh: '自定义扩展', en: 'Custom' }
  };
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function fillSelect() {
    const sel = $('weatherProvider'); if (!sel) return;
    const list = providerList();
    const en = L('zh', 'en') === 'en';
    let html = '';
    Object.keys(GROUPS).forEach(g => {
      const items = list.filter(p => p.group === g);
      if (!items.length) return;
      html += '<optgroup label="' + esc(en ? GROUPS[g].en : GROUPS[g].zh) + '">';
      items.forEach(p => { html += '<option value="' + esc(p.id) + '">' + esc(en ? p.en : p.label) + '</option>'; });
      html += '</optgroup>';
    });
    sel.innerHTML = html;
    sel.value = cfg.provider;
  }
  function readForm() {
    const v = id => { const e = $(id); return e ? e.value.trim() : ''; };
    const c = {
      provider: v('weatherProvider') || cfg.provider,
      city: v('weatherCity'),
      lat: parseFloat(v('weatherLat')) || cfg.lat,
      lon: parseFloat(v('weatherLon')) || cfg.lon,
      server: v('weatherServer'),
      url: v('weatherUrl'),
      token: v('weatherToken'),
      apiKey: v('weatherKey'),
      apiHost: v('weatherHost'),
      extraHeaders: v('weatherExtraHeaders'),
      mqttUrl: v('weatherMqttUrl'),
      topic: v('weatherTopic') || cfg.topic,
      intervalMs: clamp((parseInt(v('weatherInterval'), 10) || 10) * 60000, 15000, 86400000),
      autoStart: $('weatherAuto') ? $('weatherAuto').checked : cfg.autoStart,
      useNative: $('weatherNative') ? $('weatherNative').checked : cfg.useNative
    };
    const mp = {
      valuePath: v('weatherValuePath'), timePath: v('weatherTimePath'),
      scale: parseFloat(v('weatherScale')) || 1, align: v('weatherAlign') || 'day'
    };
    c.mapping = Object.assign({}, cfg.mapping, mp);
    return c;
  }
  function writeForm() {
    const set = (id, v) => { const e = $(id); if (e) e.value = v == null ? '' : v; };
    fillSelect();
    set('weatherCity', cfg.city); set('weatherLat', cfg.lat); set('weatherLon', cfg.lon);
    set('weatherServer', cfg.server); set('weatherUrl', cfg.url);
    set('weatherToken', cfg.token); set('weatherKey', cfg.apiKey); set('weatherHost', cfg.apiHost);
    set('weatherExtraHeaders', cfg.extraHeaders); set('weatherMqttUrl', cfg.mqttUrl); set('weatherTopic', cfg.topic);
    set('weatherInterval', Math.round(cfg.intervalMs / 60000));
    set('weatherValuePath', cfg.mapping.valuePath); set('weatherTimePath', cfg.mapping.timePath);
    set('weatherScale', cfg.mapping.scale); set('weatherAlign', cfg.mapping.align);
    const a = $('weatherAuto'); if (a) a.checked = !!cfg.autoStart;
    const n = $('weatherNative'); if (n) n.checked = !!cfg.useNative;
    const needs = (providers[cfg.provider] || {}).needs || [];
    document.querySelectorAll('[data-when]').forEach(el => {
      const keys = el.dataset.when.split(',').map(s => s.trim());
      el.classList.toggle('w-hidden', !keys.some(k => needs.indexOf(k) >= 0 || k === 'always'));
    });
    const hint = $('weatherHint');
    if (hint) { const d = providers[cfg.provider]; hint.textContent = d ? d.hint : ''; }
    render();
  }
  function fmtAgo(ts) {
    if (!ts) return '—';
    const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return s + 's';
    if (s < 3600) return Math.round(s / 60) + 'min';
    return (s / 3600).toFixed(1) + 'h';
  }
  function render() {
    const box = $('weatherStatus'); if (!box) return;
    const en = L('zh', 'en') === 'en';
    const f = runtime.lastFrame;
    const map = {
      idle:       [en ? 'Idle' : '待机', 'w-idle'],
      connecting: [en ? 'Connecting' : '连接中', 'w-wait'],
      live:       [en ? 'LIVE' : '实时', 'w-live'],
      stale:      [en ? 'Cached / fallback' : '缓存 / 降级', 'w-stale'],
      error:      [en ? 'Error' : '连接失败', 'w-err'],
      stopped:    [en ? 'Stopped' : '已停止', 'w-idle']
    };
    const s = map[runtime.status] || map.idle;
    const dot = $('weatherDot'), txt = $('weatherStatusText');
    if (dot) dot.className = 'w-dot ' + s[1];
    if (txt) txt.textContent = s[0];
    const src = $('weatherSrc');
    if (src) {
      const p = providers[cfg.provider] || {};
      src.textContent = (en ? (p.en || p.label) : p.label) || cfg.provider;
    }
    const loc = $('weatherLoc');
    if (loc) loc.textContent = f && f.location ? (f.location.name || cfg.city) : cfg.city;
    /* 服务器按 IP 定位后把城市回填输入框；只在输入框为空时回填，
       否则会盖掉用户刚点选的城市。也不写回 cfg，下次进入仍会重新定位。 */
    if (cfg.provider === 'liverain' && f && f.location && f.location.name) {
      const ci = $('weatherCity');
      if (ci && document.activeElement !== ci && !ci.value.trim()) ci.value = f.location.name;
    }
    const upd = $('weatherUpdated');
    if (upd) upd.textContent = f
      ? (fmtAgo(runtime.lastFetchAt) + ' · ' + f.values.length + ' pts')
      : 'DEMO · 25 pts';
    const err = $('weatherError');
    if (err) { err.textContent = runtime.lastError ? (en ? 'Last error: ' : '最近错误：') + runtime.lastError : ''; err.style.display = runtime.lastError ? 'block' : 'none'; }
    const mini = $('miniWeather');
    if (mini) mini.classList.toggle('live', runtime.status === 'live');
    const badge = $('weatherBadge');
    if (badge) {
      badge.textContent = runtime.status === 'live' ? 'LIVE' : (f && f.mode === 'cache' ? 'CACHE' : 'DEMO');
      badge.className = 'w-badge ' + (runtime.status === 'live' ? 'on' : '');
    }
    const list = $('weatherLog');
    if (list && list.dataset.open === '1') {
      list.innerHTML = recentLogs.slice(-14).reverse().map(l =>
        '<div class="w-log-line ' + esc(l.level) + '"><i>' +
        new Date(l.at).toLocaleTimeString('zh-CN', { hour12: false }) + '</i>' + esc(l.msg) + '</div>').join('');
    }
    const spark = $('weatherSpark');
    if (spark) drawSpark(spark, f ? f.values : DEMO, !f);
  }
  function drawSpark(canvas, values, isDemo) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = canvas.clientWidth || 260, h = canvas.clientHeight || 46;
    canvas.width = w * dpr; canvas.height = h * dpr;
    const c = canvas.getContext('2d'); if (!c) return;
    c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, w, h);
    const max = Math.max(2, Math.max.apply(null, values));
    c.beginPath(); c.moveTo(0, h);
    values.forEach((v, i) => c.lineTo(i / 24 * w, h - 3 - (v / max) * (h - 8)));
    c.lineTo(w, h); c.closePath();
    const g = c.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, 'rgba(143,214,255,.35)'); g.addColorStop(1, 'rgba(143,214,255,0)');
    c.fillStyle = g; c.fill();
    c.beginPath();
    values.forEach((v, i) => { const x = i / 24 * w, y = h - 3 - (v / max) * (h - 8); i ? c.lineTo(x, y) : c.moveTo(x, y); });
    c.strokeStyle = isDemo ? 'rgba(143,214,255,.62)' : '#8fd6ff';
    c.lineWidth = 1.4; c.stroke();
    if (isDemo) {
      c.fillStyle = 'rgba(138,167,192,.5)';
      c.font = '9px Consolas, Menlo, monospace';
      c.textAlign = 'left';
      c.fillText('DEMO CURVE / 示例曲线', 7, 12);
    }
  }
  function openPanel(open) {
    const p = $('weatherPanel'), m = $('weatherMask');
    if (!p) return;
    p.classList.toggle('open', !!open);
    p.setAttribute('aria-hidden', open ? 'false' : 'true');
    if (m) m.classList.toggle('on', !!open);
    if (open) { writeForm(); render(); }
  }
  function toast(msg) {
    if (window.Rainform && window.Rainform.toast) { window.Rainform.toast(msg); return; }
    const t = $('toast'); if (!t) return;
    t.textContent = msg; t.classList.add('on');
    setTimeout(() => t.classList.remove('on'), 2400);
  }

  function mount() {
    if (mounted) return; mounted = true;
    const p = $('weatherPanel'); if (!p) return;
    writeForm();

    $('weatherOpen').addEventListener('click', () => openPanel(!p.classList.contains('open')));
    $('weatherClose').addEventListener('click', () => openPanel(false));
    const mini = $('miniWeather');
    if (mini) mini.addEventListener('click', () => openPanel(!p.classList.contains('open')));
    const mask = $('weatherMask');
    if (mask) mask.addEventListener('click', () => openPanel(false));
    $('weatherProvider').addEventListener('change', e => {
      const needs = (providers[e.target.value] || {}).needs || [];
      document.querySelectorAll('[data-when]').forEach(el => {
        const keys = el.dataset.when.split(',').map(s => s.trim());
        el.classList.toggle('w-hidden', !keys.some(k => needs.indexOf(k) >= 0 || k === 'always'));
      });
      const hint = $('weatherHint');
      if (hint) { const d = providers[e.target.value]; hint.textContent = d ? (L('zh', 'en') === 'en' ? (d.en || d.label) + ' · ' + d.hint : d.hint) : ''; }
    });
    $('weatherRefresh').addEventListener('click', () => {
      API.configure(readForm());
      if (runtime.running && providers[cfg.provider] && providers[cfg.provider].kind === 'push') {
        toast(L('推送模式已重连', 'Stream reconnected')); start();
      } else {
        start(); toast(L('正在拉取最新数据…', 'Fetching latest data…'));
      }
    });
    $('weatherStop').addEventListener('click', () => { stop(); toast(L('实时更新已停止', 'Live updates stopped')); });
    $('weatherDemo').addEventListener('click', () => { API.useDemo(true); toast(L('已恢复演示数据', 'Demo data restored')); });
    $('weatherLocate').addEventListener('click', async () => {
      try {
        const c = await geolocate(); writeForm();
        toast(L('已定位：', 'Location: ') + c.lat.toFixed(2) + ', ' + c.lon.toFixed(2));
      } catch (e) { toast(L('定位失败：', 'Location failed: ') + e.message); }
    });
    $('weatherSearch').addEventListener('click', async () => {
      const name = $('weatherCity').value.trim();
      if (!name) { toast(L('请输入城市名', 'Enter a city name')); return; }
      try {
        const g = await geocode(name); writeForm();
        toast(L('已找到：', 'Found: ') + g.name);
      } catch (e) { toast(L('未找到该城市：', 'City not found: ') + e.message); }
    });
    /* 城市名改变即拉取（全球榜单点击走的就是这条链路，等价于手动回车） */
    $('weatherCity').addEventListener('change', () => {
      const name = $('weatherCity').value.trim();
      if (!name) return;
      const patch = { city: name };
      if (cfg.provider === 'demo') patch.provider = 'liverain';
      API.configure(patch);
      try { start(); } catch (e) { log('city change start failed: ' + e.message, 'error'); }
      toast(L('正在拉取「', 'Fetching ') + name + L('」的数据…', '…'));
    });
    $('weatherFile').addEventListener('change', e => {
      const file = e.target.files && e.target.files[0]; if (!file) return;
      const r = new FileReader();
      r.onload = () => {
        try { const f = API.import(r.result, { source: 'file:' + file.name }); toast(L('已导入 ', 'Imported ') + f.values.length + ' pts'); }
        catch (err) { toast(L('导入失败：', 'Import failed: ') + err.message); }
      };
      r.readAsText(file);
      e.target.value = '';
    });
    $('weatherCopy').addEventListener('click', () => {
      const f = runtime.lastFrame;
      if (!f) return;
      const s = JSON.stringify({ schema: SCHEMA, location: f.location, values: f.values }, null, 2);
      if (navigator.clipboard) navigator.clipboard.writeText(s).then(() => toast(L('已复制当前数据 JSON', 'JSON copied')), () => {});
    });
    const lg = $('weatherLogToggle');
    if (lg) lg.addEventListener('click', () => {
      const l = $('weatherLog');
      l.dataset.open = l.dataset.open === '1' ? '0' : '1';
      l.style.display = l.dataset.open === '1' ? 'block' : 'none';
      render();
    });
    window.addEventListener('keydown', e => {
      if (e.key === 'd' || e.key === 'D') {
        if (/input|textarea|select/i.test((e.target.tagName || ''))) return;
        openPanel(!p.classList.contains('open'));
      }
      if (e.key === 'Escape') openPanel(false);
    });
    window.addEventListener('online', () => { if (runtime.running) refresh('online'); });
    on('frame', render); on('status', render);

    mountTopRain();
    writeForm();
  }

  /* URL boot parameters, kept OUTSIDE mount() so a UI wiring hiccup can never
     prevent a published/preconfigured live link from connecting.
     ?weather=openmeteo&city=Shanghai&lat=..&lon=..&interval=5&auto=1 */
  function bootFromURL() {
    let q;
    try { q = new URLSearchParams(location.search || ''); }
    catch (e) { log('URL params unavailable: ' + e.message, 'error'); return; }
    if (!q.toString()) return;
    /* ?api=https://host —— 桌面/app 壳可以把后端地址直接带进来，
       优先级高于「同源」，也高于已保存的服务器地址 */
    if (q.has('api')) {
      try { window.__RAINFORM_API_BASE__ = String(q.get('api')).replace(/\/+$/, ''); } catch (e) {}
    }
    if (q.has('weather')) urlExplicitProvider = true;
    const patch = {};
    const str = ['city', 'server', 'url', 'token', 'apiKey', 'apiHost', 'mqttUrl', 'topic', 'timezone'];
    str.forEach(k => { if (q.has(k)) patch[k] = q.get(k); });
    if (q.has('lat')) patch.lat = parseFloat(q.get('lat'));
    if (q.has('lon')) patch.lon = parseFloat(q.get('lon'));
    if (q.has('interval')) patch.intervalMs = clamp((parseFloat(q.get('interval')) || 10) * 60000, 15000, 86400000);
    if (q.has('valuePath')) patch.mapping = Object.assign({}, cfg.mapping,
      { valuePath: q.get('valuePath'), timePath: q.get('timePath') || '' });
    if (q.has('weather')) patch.provider = q.get('weather');
    if (q.has('auto')) patch.autoStart = q.get('auto') === '1';
    if (Object.keys(patch).length) {
      try { API.configure(patch); }
      catch (e) { log('URL configure failed: ' + e.message, 'error'); }
    }
    log('URL boot → ' + cfg.provider + ' (auto=' + !!cfg.autoStart + ')');
    if (q.get('panel') === 'weather') setTimeout(() => openPanel(true), 950);
    const weather = q.get('weather');
    if (weather !== 'manual' && (patch.autoStart || (q.has('weather') && weather !== 'demo'))) {
      try { start(); }
      catch (e) { log('URL start failed: ' + e.message, 'error'); }
    } else {
      const cached = fromCache();
      if (cached && cfg.autoStart) acceptFrame(cached, true);
    }
  }

  /* app.js boots synchronously right after this file; defer UI wiring by one
     tick so window.Rainform already exists when we start applying frames. */
  /* 有后端时（网页 / PWA，以及配好地址的桌面与安卓）：
     默认走服务器实时源，并清掉上次手动选的城市 —— 每次进入都按访客 IP 重新定位。
     用户明确选过别的数据源（open-meteo / 自建 REST 等）时不动他的选择。 */
  function applyServerDefaults() {
    if (!apiBase()) return;
    /* URL / 启动参数里明确写了 weather=xxx，就按用户说的来 */
    if (urlExplicitProvider) return;
    if (cfg.provider !== 'liverain' && cfg.provider !== 'demo') return;
    let dirty = false;
    if (cfg.provider !== 'liverain') { cfg.provider = 'liverain'; dirty = true; }
    if (cfg.city) { cfg.city = ''; dirty = true; }
    if (!cfg.autoStart) { cfg.autoStart = true; dirty = true; }
    if (dirty) { saveCfg(); try { writeForm(); } catch (e) {} }
  }

  /* URL 是否明确指定过数据源（显式指定时不做「默认走服务器」的覆盖） */
  let urlExplicitProvider = false;
  let bridgeStarted = false;
  function startBridge() {
    if (bridgeStarted) return;
    bridgeStarted = true;
    try { mount(); } catch (e) { log('mount failed: ' + e.message, 'error'); }
    /* URL / 启动参数优先落地（?api= / ?weather= / ?city=），再补服务器默认值 */
    try { bootFromURL(); } catch (e) { log('URL boot failed: ' + e.message, 'error'); }
    try { applyServerDefaults(); } catch (e) { log('server defaults failed: ' + e.message, 'error'); }
    if (cfg.autoStart && !runtime.running) {
      try { start(); } catch (e) { log('auto start failed: ' + e.message, 'error'); }
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(startBridge, 0));
  else setTimeout(startBridge, 0);
  // Some WebViews / SW-controlled navigations delay DOMContentLoaded; this
  // idempotent fallback guarantees preconfigured live links always start.
  setTimeout(startBridge, 1200);

  /* PWA / native shell hooks ------------------------------------------------ */
  if ('serviceWorker' in navigator && location.protocol.indexOf('http') === 0 &&
      document.querySelector('link[rel="manifest"]')) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && runtime.running && Date.now() - runtime.lastFetchAt > cfg.intervalMs) refresh('resume');
  });
})();

/* Rainform Ultimate — Electron desktop shell (Windows / macOS / Linux)
 * The renderer is the exact same single-file HTML used by the web / mobile
 * editions. This layer only adds:
 *   - a frameless-capable dark window with remembered bounds
 *   - a native HTTP bridge (window.RainNative.fetch) that ignores CORS, so
 *     the crawler / custom endpoints work without a proxy
 *   - CLI flags to preconfigure the live weather source
 */
'use strict';
const { app, BrowserWindow, ipcMain, shell, Menu, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const INDEX = path.join(__dirname, 'www', 'index.html');
const ICON = path.join(__dirname, 'icons', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const STATE = path.join(app.getPath('userData'), 'window-state.json');
let win = null;

/* --------------------------------------------------------------- CLI flags */
function argv() {
  const out = {};
  const a = process.argv.slice(1);
  for (let i = 0; i < a.length; i++) {
    const m = a[i].match(/^--([^=]+)(?:=(.*))?$/);
    if (!m) continue;
    const k = m[1];
    if (m[2] !== undefined) out[k] = m[2];
    else if (a[i + 1] && !a[i + 1].startsWith('--')) out[k] = a[++i];
    else out[k] = '1';
  }
  return out;
}
const flags = argv();
function loadQuery() {
  const q = {};
  if (flags.weather) {
    q.weather = flags.weather;
    q.auto = (flags['weather-auto'] === '0' || flags.weatherAuto === '0') ? '0' : '1';
  }
  if (flags['weather-server'] || flags.weatherServer) q.server = flags['weather-server'] || flags.weatherServer;
  if (flags.city) q.city = flags.city;
  if (flags.lat) q.lat = flags.lat;
  if (flags.lon) q.lon = flags.lon;
  if (flags.interval) q.interval = flags.interval;
  if (flags.wallpaper) q.wallpaper = flags.wallpaper;
  if (flags.q) q.q = flags.q;
  return q;
}

/* -------------------------------------------------------------- single lock */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });

  app.whenReady().then(() => {
    createWindow();
    buildMenu();
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
  });
}
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });

function readState() {
  const base = { width: 1440, height: 900, x: undefined, y: undefined, fullscreen: false };
  try { return Object.assign(base, JSON.parse(fs.readFileSync(STATE, 'utf8'))); }
  catch (e) { return base; }
}
function saveState() {
  if (!win || win.isDestroyed()) return;
  try {
    const b = win.getBounds();
    fs.writeFileSync(STATE, JSON.stringify(Object.assign(b, { fullscreen: win.isFullScreen() })), 'utf8');
  } catch (e) { /* non-fatal */ }
}

function createWindow() {
  const st = readState();
  const display = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(st.width || 1440, display.width);
  const height = Math.min(st.height || 900, display.height);

  win = new BrowserWindow({
    width, height, x: st.x, y: st.y,
    minWidth: 880, minHeight: 520,
    backgroundColor: '#03070d',
    title: 'Rainform Ultimate · 如果降雨数据变成雨',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    show: false,
    autoHideMenuBar: false,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      webSecurity: true
    }
  });

  win.loadFile(INDEX, { query: loadQuery() });
  win.once('ready-to-show', () => {
    win.show();
    if (st.fullscreen) win.setFullScreen(true);
  });
  win.on('close', saveState);
  win.on('closed', () => { win = null; });

  // external links open in the system browser, never inside the app
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (/^https?:/.test(url) && !url.startsWith('file:')) { e.preventDefault(); shell.openExternal(url); }
  });

  if (flags.dev) win.webContents.openDevTools({ mode: 'detach' });
}

/* ------------------------------------------------------------ native HTTP */
ipcMain.handle('rain:fetch', async (_e, urlStr, opts) => {
  opts = opts || {};
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeout || 12000);
  try {
    let res;
    const init = {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body || undefined,
      signal: ac.signal,
      redirect: 'follow'
    };
    if (typeof fetch === 'function') {
      res = await fetch(urlStr, init);
    } else {
      const { net } = require('electron');
      res = await net.fetch(urlStr, init);
    }
    const body = await res.text();
    return { ok: res.ok, status: res.status, body };
  } catch (e) {
    return { ok: false, status: 0, body: String(e && e.message || e) };
  } finally {
    clearTimeout(timer);
  }
});
ipcMain.handle('rain:external', (_e, urlStr) => {
  if (/^https?:/.test(urlStr)) shell.openExternal(urlStr);
});
ipcMain.handle('rain:info', () => ({
  platform: process.platform,
  arch: process.arch,
  electron: process.versions.electron,
  appVersion: app.getVersion()
}));

/* ------------------------------------------------------------------- menu */
function buildMenu() {
  const zh = (app.getLocale() || '').toLowerCase().startsWith('zh');
  const T = (a, b) => zh ? a : b;
  const template = [
    {
      label: T('文件', 'File'),
      submenu: [
        { label: T('重新载入', 'Reload'), accelerator: 'CmdOrCtrl+R', click: () => win && win.reload() },
        { label: T('截图存到…', 'Save frame…'), accelerator: 'CmdOrCtrl+S', click: () => win && win.webContents.executeJavaScript('window.Rainform && window.Rainform.snapshot()') },
        { type: 'separator' },
        { label: T('退出', 'Quit'), accelerator: 'CmdOrCtrl+Q', click: () => app.quit() }
      ]
    },
    {
      label: T('视图', 'View'),
      submenu: [
        { label: T('全屏', 'Fullscreen'), accelerator: 'F11', click: () => win && win.setFullScreen(!win.isFullScreen()) },
        { label: T('壁纸模式', 'Wallpaper mode'), accelerator: 'CmdOrCtrl+W', click: () => win && win.webContents.executeJavaScript("document.getElementById('wallpaperBtn').click()") },
        { label: T('实时天气面板', 'Live weather'), accelerator: 'CmdOrCtrl+D', click: () => win && win.webContents.executeJavaScript("document.getElementById('weatherOpen').click()") },
        { type: 'separator' },
        { label: T('开发者工具', 'DevTools'), accelerator: 'F12', click: () => win && win.webContents.toggleDevTools() }
      ]
    },
    {
      label: T('帮助', 'Help'),
      submenu: [
        { label: T('接口文档', 'Weather API docs'), click: () => shell.openExternal('https://open-meteo.com/') },
        { label: T('关于', 'About'), click: () => win && win.webContents.executeJavaScript("alert('Rainform Ultimate v1.0\\nRainWeather live-data bridge v1\\n\\nSee docs/WEATHER-API.md')") }
      ]
    }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

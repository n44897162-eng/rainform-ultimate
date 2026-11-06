# Rainform Ultimate · PC 桌面应用（Windows / macOS / Linux）

基于 Electron，渲染的是与网页/手机**完全相同**的 `www/index.html`（由 `node build-apps.js` 从 `src/*` 生成）。
额外的原生能力只有两个：记住窗口状态、以及一个绕过 CORS 的 HTTP 桥 —— 这样「自建服务器 / 地区天气爬取 / 自定义接口」在桌面端可以直接访问任意地址。

## 运行

```bash
cd F:/Rainform-Ultimate
node build-apps.js                     # 先生成 www/index.html 与图标
cd app/desktop
npm install
npm start
```

直接接实时数据（先启动 `node weather/server/server.js`）：

```bash
npm run start:live
# 等价于
electron . --weather=server --weather-server=http://127.0.0.1:8787 --weather-auto
```

可用启动参数：

| 参数 | 说明 |
| --- | --- |
| `--weather=<provider>` | `server` / `crawler` / `sse` / `ws` / `openmeteo` / `custom` / `demo` … |
| `--weather-server=<url>` | 自建服务器地址 |
| `--city` / `--lat` / `--lon` | 地区坐标 |
| `--interval=<分钟>` | 轮询间隔 |
| `--weather-auto=0` | 不自动连接，只预填配置 |
| `--wallpaper=1` | 启动即壁纸模式 |
| `--q=0..3` | 画质档位 |
| `--dev` | 打开 DevTools |

## 打包

```bash
npm run dist:win       # Windows: NSIS 安装包 + 便携版 → dist/
npm run dist:mac       # 需在 macOS 上执行 → dmg + zip
npm run dist:linux     # AppImage
npm run pack           # 只出免安装目录，便于快速验证
```

产物在 `app/desktop/dist/`。Windows 图标为 `icons/icon.ico`，mac/Linux 用 `icons/icon.png`。

## 原生桥接口

`preload.js` 通过 `contextBridge` 暴露：

```js
window.RainNative.fetch(url, { method, headers, body, timeout })
// -> Promise<{ ok: boolean, status: number, body: string }>
```

`src/weather.js` 会优先使用它（`useNative` 开关，默认开）。所以桌面端可以：
- 直接请求没有 CORS 头的气象接口
- 访问局域网内的自建网关 / NAS / 气象站
- 通过服务端爬虫接口间接抓取地区天气页面

Electron 安全设置：`contextIsolation: true`、`nodeIntegration: false`、外链一律交给系统浏览器，渲染进程无法直接访问 Node。

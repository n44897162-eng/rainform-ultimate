# Rainform Ultimate · PWA（一套代码覆盖 PC / Android / iPhone）

`index.html` 是 `Rainform-Ultimate-standalone.html` 加上 PWA 标签的版本，由 `node build-apps.js` 生成，请勿手工编辑。
`sw.js` 只缓存应用外壳（那个单文件网页 + 图标），**所有 `/api/*` 实时数据一律不缓存**，保证天气永远是新的；断网时回退到缓存帧 / 内置演示数据。

## 本地体验

```bash
cd F:/Rainform-Ultimate
node build-apps.js
node weather/server/server.js --root app/pwa
# 浏览器打开 http://127.0.0.1:8787/
```

## 安装成应用

| 平台 | 操作 |
| --- | --- |
| Windows / macOS（Chrome、Edge） | 地址栏右侧「安装」图标，或 菜单 → 应用 → 安装此站点 |
| Android（Chrome） | 菜单 → 「安装应用 / 添加到主屏幕」 |
| iPhone / iPad（Safari） | 分享 → 「添加到主屏幕」（`apple-mobile-web-app-capable` 已开启，全屏无地址栏） |

> 除 `localhost` 外，PWA 安装与 Service Worker、设备定位都要求 **HTTPS**。正式部署请给网关套一层反向代理证书。

## 发布

把 `app/pwa/` 整个目录丢到任意静态托管（Netlify / Vercel / GitHub Pages / Nginx / 对象存储）即可。
若同时要实时数据，把 `weather/server` 部署在同源或配置好 CORS（网关已默认 `Access-Control-Allow-Origin: *`），然后在应用里填服务器地址，或用 `?weather=server&server=https://...&auto=1` 预置。

`manifest.webmanifest` 里已配置两个快捷方式（长按图标出现）：「实时天气」与「壁纸模式」。

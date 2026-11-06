# Rainform Ultimate · 总览

把 25 个逐时降雨数据点变成一场可以走进去的 3D 雨。这一版在原有雨景之上，新增了：

1. **三端应用**：同一份源码 → 单文件网页 / PWA（PC、Android、iPhone 可安装）/ Electron 桌面应用 / Capacitor 安卓与 iOS 原生工程。
2. **RainWeather v1 实时数据桥**：一个与厂商无关的、可插拔的实时天气数据层。现在就能用的数据源 + 为未来预留的接口都有。
3. **参考服务端**：REST、地区天气爬取接口、SSE、WebSocket、长轮询、外部系统推入 —— 六种实时通道，零第三方依赖。

全部文件都在 `F:/Rainform-Ultimate/`，早期 E 盘文件与 `archive/` 原样保留。

## 60 秒开始

```bash
cd F:/Rainform-Ultimate

# 1. 重新生成所有版本（单文件 + PWA + 桌面 + 手机 + 图标）
node build-apps.js

# 2. 启动带实时数据的本地服务
node weather/server/server.js --root app/pwa --verbose

# 3. 浏览器打开
#    http://127.0.0.1:8787/
```

只想离线看雨：直接双击 `Rainform-Ultimate-standalone.html`（779 KB，零外部引用，手机/电脑都能打开）。

## 目录

```
Rainform-Ultimate/
├─ index.html                         开发版入口（src/* 分模块）
├─ Rainform-Ultimate-standalone.html  生成物：单文件离线版
├─ build-standalone.js                生成单文件
├─ build-apps.js                      生成全部应用版本 + 图标
├─ src/
│  ├─ app.js        雨景主程序（WebGL / 交互 / 曲线 / 旋转 30°）
│  ├─ shaders.js    GLSL：雨幕、水面、涟漪、冠冕飞溅、Bloom
│  ├─ audio.js      三层 WebAudio 雨声
│  ├─ weather.js    ★ RainWeather v1 实时数据桥 + 数据源面板
│  └─ style.css     UI 样式（含天气抽屉三套响应式布局）
├─ vendor/three.min.js                本地 Three.js，不联网
├─ weather/server/                    ★ 零依赖参考服务端
│  ├─ server.js                      REST / 爬虫 / SSE / WS / 长轮询 / 推送
│  ├─ providers/{open-meteo,crawler,template}.js
│  ├─ sample-frame.json / push-example.js / config.example.json
│  └─ README.md
├─ app/
│  ├─ pwa/            index.html · manifest.webmanifest · sw.js · icons/
│  ├─ desktop/        Electron：package.json · main.js · preload.js · www/
│  └─ mobile/         Capacitor：capacitor.config.ts · native-bridge.js ·
│                     scripts/patch-{android,ios}.js · www/
├─ tools/make-icons.js               纯 Node PNG/ICO 生成器（无外部依赖）
├─ docs/              README.md · WEATHER-API.md · APPS.md
├─ archive/           早期 E 盘全部文件
└─ previews/          各视口预览图
```

## 能力矩阵

| 能力 | 单文件网页 | PWA | Electron | Capacitor Android | Capacitor iOS |
| --- | --- | --- | --- | --- | --- |
| 离线雨景 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 安装到桌面 / 主屏幕 | — | ✅ | ✅ 安装包 | ✅ APK/AAB | ✅ IPA |
| 实时天气（公开 API） | ✅\* | ✅ | ✅ | ✅ | ✅ |
| 自建服务器 REST | ✅ | ✅ | ✅ | ✅ | ✅ |
| 地区天气爬取接口 | 需服务端 | 需服务端 | ✅ 原生桥 | ✅ 原生桥 | ✅ 原生桥 |
| SSE / WebSocket 推送 | ✅ | ✅ | ✅ | ✅ | ✅ |
| 绕过 CORS 访问任意地址 | — | — | ✅ | ✅ | ✅ |
| 原生定位 / 状态栏 / 返回键 | — | — | 部分 | ✅ | ✅ |
| 渲染引擎 | 同一份 WebGL 代码 | 同左 | 同左 | 同左 | 同左 |

\* 直接双击 `file://` 打开时，公开 API 可能因浏览器 CORS/混合内容策略受限；用本地服务或原生应用即可完全正常。

## 常用命令

```bash
node build-standalone.js                                  # 只重建单文件
node build-apps.js                                        # 重建全部版本 + 图标
node weather/server/server.js --offline                   # 离线演示服务端
node weather/server/server.js --token secret --interval 10
node weather/server/push-example.js                       # 模拟外部系统推数据
cd app/desktop && npm install && npm start                # 桌面应用
cd app/mobile  && npm install && npm run add:android      # 安卓工程
```

页面也可用 URL 预置：

```
?weather=openmeteo&city=Shanghai&auto=1
?weather=server&server=https://your-domain&interval=5&auto=1
?weather=ws&server=https://your-domain&auto=1
?weather=crawler&server=http://127.0.0.1:8787&city=Shanghai
?panel=weather          打开数据源面板
?wallpaper=1            壁纸模式
```

## 进一步阅读

- `docs/WEATHER-API.md` — 数据契约、11 种数据源、自定义适配器、字段映射、降级链、合规
- `docs/APPS.md` — PC / Android / iOS 完整构建与发布步骤，以及本机可做到的边界
- `weather/server/README.md` — 服务端每个接口的 curl 示例
- `app/{pwa,desktop,mobile}/README.md` — 各端专属说明

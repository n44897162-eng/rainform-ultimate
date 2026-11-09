# Rainform Ultimate · 如果降雨数据变成雨

把 **25 个逐时降雨数据点**变成一场可以走进去的 3D 雨。3D 雨景 + 30° 旋转 + 逐时降雨曲面/折线 + Catmull-Rom 平滑拟合 + 四档画质 + 三层 WebAudio 雨声，并接入可插拔的实时天气数据层。

同一份源码产出 **网页端（单文件 / PWA）、Windows PC 端（Electron）、Android 端（原生 WebView）** 三个平台；苹果端按需求未纳入本轮交付。


## 下载

预编译产物在 [Releases](https://github.com/n44897162-eng/rainform-ultimate/releases) 页面，源码在仓库内。

| 平台 | 文件 | 说明 |
| --- | --- | --- |
| Windows | `Rainform-Ultimate-Setup-1.1.0.exe` | 安装版，可选安装目录，自带卸载器 |
| Windows | `Rainform-Ultimate-Portable-1.1.0.exe` | 免安装单文件，双击即用 |
| Android | `Rainform-Ultimate-v1.1.0.apk` | 已签名，可直接安装（最低 Android 6.0 / API 23） |
| Web | `Rainform-Web-1.1.0.zip` | PWA 站点 + 单文件版 + 本地数据网关，解压即用 |

## 快速开始

```bash
# 0) 只想离线看雨：直接双击
#    Rainform-Ultimate-standalone.html   （单文件、零外部引用，手机/电脑浏览器均可）

# 1) 安装依赖（仅测试与桌面构建需要）
cd tests && npm install && cd ..
cd app/desktop && npm install && cd ../..

# 2) 生成单文件与各端 www
node build-standalone.js
node build-apps.js

# 3) 启动带实时数据的本地站点
node weather/server/server.js --root app/pwa --verbose
#    打开 http://127.0.0.1:8787/
```

## 功能

| 模块 | 说明 |
| --- | --- |
| 3D 雨景 | WebGL2 / Three.js 程序化雨幕、水面、积水光池、涟漪、冠冕喷溅、Worthington 射流、Bloom / tone mapping |
| 3D 旋转 | 30° 步进、拖拽轨道相机、阻尼、角度读数同步、自动旋转 |
| 数据可视化 | 25 点逐时降雨柱状曲面、发光折线、坐标轴、曲线编辑器拖拽 |
| 图表与拟合 | 图表整体开关（API / 按钮 / 快捷键 `C`）；Catmull-Rom 平滑拟合、`S` 键、0–100% 拟合度 |
| 强化显示 | Y 轴上限改为当天峰值 ×1.1，小雨起伏清晰可读；默认开启，可持久化关闭 |
| 雨幕背景 | 8 色板（初始 / 曜黑 / 深靛 / 墨绿 / 暗紫 / 赤褐 / 石墨 / 白昼）；白昼用 canvas 反色，UI 同步转亮色 |
| 全球雨榜 | 天气面板内 TOP5 强降雨城市，点击即导入该城 25 个逐时值，每 30 分钟整点/半点同拍刷新 |
| 播放与时间轴 | 播放暂停、0–24h 拖动、数据预设 |
| 画质 | 低 / 中 / 高 / 极致四档，DPR、雨丝数、Bloom 强度联动 |
| 音频 | 三层 WebAudio 雨声，按 mm/h 非线性映射，动态范围约 100 倍 |
| 实时天气 | RainWeather v1：11 种数据源、REST / 爬取 / SSE / WebSocket / 长轮询 / 外部推送、自定义字段映射、CSV/JSON 导入、缓存降级链、URL 自动连接 |
| UI | 中英双语、面板收起展开、壁纸模式、截图、日志、天气抽屉、状态角标与曲线预览 |
| 离线 | 零外部引用，断网可用，数据变化 1.4s 平滑过渡 |

## 三端构建

| 平台 | 命令 | 产物 |
| --- | --- | --- |
| 网页 / PWA | `node build-standalone.js && node build-apps.js && node tools/build-web-package.js` | `Rainform-Ultimate-standalone.html`、`app/pwa/`、`dist/Rainform-Web-*.zip` |
| Windows | `node tools/build-windows.js` | `dist/Rainform-Ultimate-Setup-*.exe`、`dist/Rainform-Ultimate-Portable-*.exe` |
| Android | `node app/android-native/build-apk.js` | `dist/Rainform-Ultimate-v*.apk`（v1+v2+v3 签名） |

> 本仓库只提交源码与文档；`dist/` 下的安装包（exe/apk/zip）体积较大且可由上面的命令完全重建，不纳入版本库。Windows 构建需要 `app/desktop/node_modules`（`electron-builder --dir` 产出 `win-unpacked/` 后由 `tools/build-windows.js` 编译 NSIS 安装包）。

## 目录结构

```
Rainform-Ultimate/
├─ index.html                     开发版入口（src/* 分模块）
├─ Rainform-Ultimate-standalone.html  单文件离线版（可直接打开）
├─ build-standalone.js            生成单文件
├─ build-apps.js                  生成各端 www 与图标
├─ src/
│  ├─ app.js       雨景主程序（WebGL / 交互 / 曲线 / 30° 旋转）
│  ├─ shaders.js   GLSL：雨幕、水面、涟漪、冠花飞溅、Bloom
│  ├─ audio.js     三层 WebAudio 雨声
│  ├─ weather.js   RainWeather v1 实时数据桥 + 数据源面板 + 全球雨榜
│  ├─ backdrop.js   雨幕背景色板（WebGL 与 Canvas 2D 共用）
│  └─ style.css    UI 样式与响应式布局
├─ vendor/three.min.js            本地 Three.js，不联网
├─ weather/server/                零依赖参考服务端（REST / 爬取 / SSE / WS / 长轮询 / 推送）
├─ app/
│  ├─ pwa/                        PWA 工程
│  ├─ desktop/                    Electron 33 工程
│  ├─ android-native/             原生 WebView 壳 + 内置 loopback 服务 + 离线 APK 构建链
│  └─ mobile/                     Capacitor 工程（预留，苹果端本轮未交付）
├─ tools/                         构建与验证脚本
├─ tests/                         三端统一测试套件与报告
├─ docs/                          平台、API、构建、老 WebView 渲染与版本记录
└─ archive/                       早期版本原样保留
```

## 测试与验证

三端共用一份功能契约 `tests/contract.js`（每端 73 项，A 启动渲染 / B 3D 旋转 / C 图表拟合 / D 数据播放 / E UI（含强化显示、背景色板、全球雨榜）/ F 实时天气 / G 边界 / H 平台差异）：

| 验证 | 命令 | 结果 |
| --- | --- | --- |
| 三端统一契约 | `node tests/run.js` | **216 通过 / 0 失败 / 3 项平台不适用跳过**（web 72/0/1、win 72/0/1、android 72/0/1） |
| 网页端回归 | `node tools/verify.js` | **41/41** |
| 安装包实装 | `node tests/smoke-installers.js` | **9/9**（静默安装 → 启动 → CDP 校验 3D 旋转 → 卸载、便携版启动、APK 签名） |

报告：`tests/CONCLUSION.md`（结论）、`tests/TEST-RECORD.md`（逐项记录）、`tests/DEFECTS.md`（缺陷清单）、`tests/FIXES.md`（修复说明）、`tests/INSTALLERS.md`（安装包验证）。本轮 14 项缺陷全部修复，测试范围内无未修复缺陷。

> 测试报告中的截图证据（`tests/evidence/*.png`）与安装包一样属于本地生成物，未纳入仓库。

## 文档

- `docs/PLATFORMS.md` — 三端目标平台、构建配置与交付验收清单
- `docs/WEATHER-API.md` — 数据契约、11 种数据源、自定义适配器、字段映射、降级链
- `docs/APPS.md` — PC / Android 完整构建与发布步骤
- `docs/LEGACY-RENDERER.md` — Android 老 WebView 的等效 Canvas 2D 后端
- `docs/CHANGELOG.md` — 版本记录：三端功能同步、缺陷修复与验证结果
- `weather/server/README.md` — 服务端接口与 curl 示例
- `tests/README.md` — 测试工具安装、用例结构与报告说明

## 说明

- 实时天气网关默认可用离线样本帧跑通全部传输链路；接入真实地区天气只需在 `weather/server/` 配置 Open-Meteo 或自定义 provider / 爬取映射，无需改动三端应用代码。
- Windows 安装包未做商业代码签名，首次运行 SmartScreen 可能提示「更多信息 → 仍要运行」。
- PWA 的 Service Worker 与地理定位需 HTTPS 或 localhost。

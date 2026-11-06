# Rainform Ultimate · 三端测试套件

## 1. 工具安装与配置（本轮已执行）

| 工具 | 版本 / 路径 | 用途 | 安装命令 |
| --- | --- | --- | --- |
| `playwright-core` | 1.64.1，`tests/node_modules/` | 驱动本机 Chrome（网页端）与 `connectOverCDP`（Windows Electron） | `cd tests && npm install` |
| Node 22 原生 `WebSocket` | v22.22.2 | 原生 CDP 客户端，驱动 Android System WebView（旧协议） | 内置 |
| Google Chrome | `C:/Program Files/Google/Chrome/Application/chrome.exe` | 网页端测试浏览器（headless + SwiftShader WebGL2） | 已安装 |
| Electron 33.4.11 + electron-builder 25.1.8 | `app/desktop/node_modules/` | Windows 应用与 `win-unpacked/` | `cd app/desktop && npm install` |
| NSIS 3.0.4.2 | `tools/.nsis/pkg/` | 编译 Windows 安装程序 | 由 `tools/build-windows.js` 首次自动下载 |
| Android SDK platform-tools / emulator | `F:/Android/Sdk` | 安装 APK、端口转发、Android 11 API 30 模拟器 | 已安装 |
| JDK 22 + build-tools 34/37 | `C:/Program Files/Java/jdk-22`、`F:/Android/Sdk` | APK 编译与签名 | 已安装 |
| Python 3.13 + Pillow | 系统 Python | PNG 像素统计（画面非空白、旋转前后差异） | 已安装 |
| 天气网关 | `weather/server/server.js` | REST / 爬取 / SSE / WS 被测端点 | 测试脚本自动拉起（若未监听 8787） |

**宿主环境污染处理**：WorkBuddy 会话导出 `ELECTRON_RUN_AS_NODE=1` 与 `NODE_OPTIONS` shim，会让被启动的 Electron 退化成纯 Node 进程。测试适配器在 `spawn` 时清除这两个变量（见 `tests/harness.js` / `tests/smoke-installers.js`）。用户机器不存在该问题。

## 2. 执行

```bash
cd F:/Rainform-Ultimate

# 0) 前置：三端产物（任一源码改动后必须全量重建）
node build-standalone.js && node build-apps.js
node tools/build-web-package.js
node app/android-native/build-apk.js
node tools/build-windows.js

# 1) 网页端原有回归（41 项）
node tools/verify.js

# 2) 三端共用功能契约（每端 70 项；自动拉起天气网关）
node tests/run.js                        # 全部三端
node tests/run.js --platform=web        # 单端
node tests/run.js --platform=win,android
node tests/run.js --no-android          # 跳过模拟器

# 3) 安装包实装验证（静默安装 / 启动 / 卸载 / 便携版 / APK 签名）
node tests/smoke-installers.js
```

> Android 用例会自动启动 `RainformTest` AVD（若未连接）、安装 `dist/*.apk`、通过 `adb forward tcp:9229` 连 WebView devtools、`adb reverse tcp:8787` 把设备请求转发到宿主机网关。

## 3. 用例结构

`tests/contract.js` 是**三端逐字共用**的一份契约：

| 组 | 覆盖 |
| --- | --- |
| A 启动与渲染 | 加载、API 契约完整性、画布尺寸、无溢出、渲染循环推进（A12 后端无关）、画面非空白、零 JS 异常 |
| B 3D 旋转 | 30°×2=60°、-30°、顶部/反向/胶囊按钮、键盘、拖拽、复位、**旋转前后画面差异**、角度读数、自动旋转 |
| C 图表与拟合 | 图表开关（API/按钮/胶囊/快捷键）、平滑拟合、拟合度滑块、模式文本 |
| D 数据与播放 | `update()` 25 点、非法长度拒绝、时间轴、播放暂停、四档画质、预设、雨声映射 |
| E UI | 面板收起展开状态同步、双语、壁纸、截图、天气抽屉、声音 |
| F 实时天气 | 11 种数据源、REST / 爬取 / SSE / WS / 自定义映射 / CSV / JSON / 降级链 / 运行时注册 / 状态 UI / 非法数据 |
| G 边界场景 | 320×480、390×844、844×390、2560×1440 四视口；横竖屏切换；连点 20 次；极端数据；损坏 localStorage；断网回演示数据；零异常 |
| H 平台差异 | Web：PWA manifest + SW + 单文件零外部引用；Windows：`RainNative.info()` + 原生桥；Android：原生桥 + 触控/安全区 |

不适用的用例记为 `SKIP`（例如桌面端没有 Service Worker、网页端没有原生桥），不计入失败。

## 4. 产物与报告

| 文件 | 内容 |
| --- | --- |
| `tests/results.json` | 机器可读逐项结果、环境、缺陷 |
| `tests/TEST-RECORD.md` | 测试环境、执行范围、逐项结果表 |
| `tests/DEFECTS.md` | 缺陷清单（复现条件 / 影响范围 / 严重程度 / 状态） |
| `tests/FIXES.md` | 每个缺陷的根因与修复说明 |
| `tests/CONCLUSION.md` | 最终验证结论 |
| `tests/INSTALLERS.md` + `results-installers.json` | 安装包安装 / 启动 / 卸载验证 |
| `tests/evidence/*.png` | 各端启动、旋转前后、最终画面截图证据 |

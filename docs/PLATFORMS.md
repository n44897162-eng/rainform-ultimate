# Rainform Ultimate · 三端目标平台 / 构建配置 / 安装包交付要求

> 本轮范围：**网页端（Web / PWA）、Windows PC 端、Android 端**。
> 按用户要求，**苹果端（iOS / macOS）不在本轮范围**，不产出 `.ipa` / `.dmg`。
> 版本基线：`1.0.0`；源码根目录 `F:\Rainform-Ultimate\`。

## 0. 功能基线（三端共同，不可削减）

三端内置的是**同一份** `Rainform-Ultimate-standalone.html`（由 `build-standalone.js` 从 `index.html + src/*.js + src/style.css + vendor/three.min.js` 全内联生成）。因此下列能力在三端逐项一致，打包过程不得裁剪、不得替换为静态图或简化渲染：

| 能力 | 说明 |
| --- | --- |
| 3D 雨景 | WebGL2 / Three.js 程序化雨幕、水面、积水光池、涟漪、冠冕喷溅、Worthington 射流、Bloom / tone mapping |
| **3D 旋转** | 30° 步进旋转、拖拽轨道相机、阻尼；角度读数同步 |
| 数据可视化 | 25 点逐时降雨柱状曲面、发光折线、坐标轴、曲线编辑器拖拽 |
| 图表开关 | `Rainform.setChart()` / `C` 键 / 胶囊按钮，隐藏或显示全部图表元素 |
| 平滑拟合 | Catmull-Rom 样条、`S` 键、0–100% 拟合度，影响曲线/雨柱/曲面/读数 |
| 播放与时间轴 | 播放暂停、0–24h 拖动、预设（含随机） |
| 画质 | 低 / 中 / 高 / 极致四档，含 DPR、雨丝数、Bloom 强度联动 |
| 音频 | WebAudio 三层雨声，按 mm/h 非线性映射，动态范围约 100 倍 |
| 实时天气 | RainWeather v1：11 种数据源、REST / 爬取 / SSE / WS / 自定义映射 / 导入 / 缓存降级 / URL 自动连接 |
| UI | 中英双语、面板收起展开、壁纸模式、截图、日志、状态角标与曲线预览 |
| 离线 | 零外部引用，断网可用，数据变化 1.4s 平滑过渡 |

**验收口径**：三端跑同一套 `tests/contract.js` 功能契约用例集，逐项结果一致；网页端回归 `node tools/verify.js` 保持 41/41。

---

## 1. 网页端（Web / PWA）

| 项目 | 内容 |
| --- | --- |
| 目标平台 | 桌面与移动现代浏览器：Chrome / Edge 90+、Firefox、Safari；Windows / macOS / Linux / Android / iOS 浏览器 |
| 运行时 | 浏览器 WebGL2 + WebAudio + Service Worker（HTTPS 或 localhost） |
| 构建配置 | `node build-standalone.js` 生成单文件；`node build-apps.js` 生成 `app/pwa/`（manifest.webmanifest、sw.js、offline.html、icons/） |
| 构建命令 | `node build-standalone.js && node build-apps.js` |
| 交付产物 | ① `Rainform-Ultimate-standalone.html`（双击即用，零依赖）<br>② `app/pwa/` 可安装 PWA 站点目录<br>③ `dist/Rainform-Web-1.0.0.zip`（可安装、可启动的离线整包：PWA + 独立 HTML + 内置天气网关 + `启动-实时天气站点.cmd`） |
| 安装 / 启动 | 单文件：双击；PWA：任意静态服务器或 `node weather/server/server.js --root app/pwa` 后浏览器打开，点「安装」 |
| 签名要求 | 无（Web）；对外发布须 HTTPS，否则 Service Worker / 地理定位不可用 |
| 平台差异 | 浏览器 CORS 限制第三方接口，需服务端 CORS 头或走自建网关；PWA 可安装、可离线 |

## 2. Windows PC 端

| 项目 | 内容 |
| --- | --- |
| 目标平台 | Windows 10 / 11，x64（NSIS 安装程序与便携版均为 64 位） |
| 运行时 | Electron 33 + Chromium（应用自带，无需用户安装 Chrome）；自带 WebGL2 / WebAudio |
| 构建配置 | `app/desktop/package.json`：`electron-builder` 产出 `dist/win-unpacked/`（Electron 33.4.11 + `resources/app.asar`）；`tools/build-windows.js` 用内置 NSIS 3.0.4.2 编译安装程序与便携启动器；`appId: cn.rainform.ultimate`；图标 `icons/icon.ico` |
| 构建命令 | `cd app/desktop && npm install && npx electron-builder --win --x64 --dir` → `node tools/build-windows.js`（完整说明见 `docs/APPS.md` 第 9 节） |
| 交付产物 | ① `dist/Rainform-Ultimate-Setup-1.0.0.exe`（NSIS 安装程序，含卸载器）<br>② `dist/Rainform-Ultimate-Portable-1.0.0.exe`（免安装便携版） |
| 安装 / 启动 | 双击 Setup → 选择目录 → 完成后从桌面/开始菜单启动；便携版直接双击 |
| 签名要求 | 自签名 / 未签名会在 SmartScreen 提示，点「更多信息 → 仍要运行」；企业分发应对 exe 做代码签名证书签名 |
| 平台差异 | 原生 HTTP 桥 `RainNative.fetch` 走 Electron 主进程 `net/fetch`，**绕过 CORS**；原生菜单、窗口尺寸记忆、单实例锁、外部链接交系统浏览器；`file://` 加载 `www/index.html` |

## 3. Android 端

| 项目 | 内容 |
| --- | --- |
| 目标平台 | Android 6.0+（minSdk 23），targetSdk 34；arm64-v8a / armeabi-v7a / x86_64 通用（纯 Java + WebView，无 native so） |
| 运行时 | 系统 Android System WebView（推荐 Chrome 90+，需 WebGL2）；无第三方库 |
| 构建配置 | `app/android-native/`：原生 WebView 壳 + 内置 loopback HTTP 服务 + `RainNative.fetch` 桥；离线构建链 `aapt2 → javac --release 11 → d8 → zipalign → keytool → apksigner` |
| 构建命令 | `node app/android-native/build-apk.js` |
| 交付产物 | `dist/Rainform-Ultimate-v1.0.0.apk` |
| 安装 / 启动 | 传 APK 到手机点击安装（允许「未知来源」）或 `adb install -r`；启动器图标 `Rainform` |
| 签名要求 | v1 + v2 + v3 签名，证书 `CN=Rainform Ultimate`；**必须保留 `app/android-native/rainform-release.jks`**，否则后续版本无法覆盖安装 |
| 平台差异 | 内置 loopback 服务承载页面（非 `file://`），保证 localStorage / SSE / WS / WebAudio 行为一致；原生 HTTP 桥绕过 CORS；按需定位权限；返回键先关天气抽屉；触控与安全区适配；老 WebView 走等效 2D 渲染后端（见 `docs/LEGACY-RENDERER.md`） |

---

## 4. 全局构建顺序（依赖链）

```
src/*.js + src/style.css + index.html + vendor/three.min.js
        │
        ├─ node build-standalone.js ──> Rainform-Ultimate-standalone.html
        │
        ├─ node build-apps.js ────────> app/pwa/ · app/desktop/www/ · app/mobile/www/
        │
        ├─ node tools/build-web-package.js ──> dist/Rainform-Web-1.0.0.zip
        │
        ├─ node tools/build-windows.js ──> dist/*Setup*.exe · *Portable*.exe
        │
        └─ node app/android-native/build-apk.js ──> dist/*.apk
```

**任何源码改动后必须按此顺序全量重建**，否则三端会内置不同版本的页面（一致性测试的头号风险）。

## 5. 交付验收清单

- [x] 三端安装包均存在、可安装、可启动、可退出（见 `tests/INSTALLERS.md` 9/9）
- [x] 三端内置页面由同一份 `build-standalone.js` 产物生成，经 `app/pwa/`、`app/desktop/www/`、`app/android-native/assets/` 同源注入
- [x] `tests/contract.js` 三端逐项通过：207 PASS / 0 FAIL / 3 SKIP，含 3D 旋转 30°×2、图表开关、平滑拟合、实时天气全链路
- [x] `node tools/verify.js` 41/41 通过
- [x] 零未修复缺陷（见 `tests/DEFECTS.md` 与 `tests/CONCLUSION.md`）

## 6. 安装包验证注意事项

Windows 的安装器检测机制会按文件名中的 `Setup` 关键字挂住静默安装进程（文件已全部写入但进程不退出）。自动化验收因此对交付 `Setup.exe` 做 SHA-256 校验后，用**字节完全一致的副本**在中性文件名下执行 `/S` 静默安装；卸载器同理复制为同目录中性名（保证 `$INSTDIR` 不变）。交付给用户的文件名与二进制内容均未改动，双击图形安装流程不受影响。详见 `tests/INSTALLERS.md` 与 `tests/FIXES.md` D-14。

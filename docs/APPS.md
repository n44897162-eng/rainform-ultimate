# 三端应用构建与发布指南

「做成 PC 端、安卓、苹果手机端的应用」在本项目里分三层实现，共用**同一份源码**（`src/*` → `Rainform-Ultimate-standalone.html`）：

| 层级 | PC (Windows/mac/Linux) | Android | iPhone / iPad | 现在能不能拿到 |
| --- | --- | --- | --- | --- |
| ① PWA 可安装网页 | Chrome/Edge「安装」 | Chrome「安装应用」 | Safari「添加到主屏幕」 | ✅ 立刻可用（需 HTTP 服务/HTTPS） |
| ② Electron 桌面应用 | 安装包 / 便携版 | — | — | ✅ Windows 本机可打包 |
| ③ Capacitor 原生应用 | — | APK / AAB | IPA | 工程与配置已就绪；Android 需 SDK，iOS 需 macOS+Xcode |

> 原生包无法在这台 Windows 机器上直接产出 iOS 的 `.ipa`（Apple 工具链限制），也无法在没有 Android SDK 的情况下产出 `.apk`；
> 但**工程、图标、权限、签名所需配置、构建脚本全部已生成**，换到对应环境按下面命令执行即可，不需要再改代码。

---

## 0. 一次构建，处处可用

```bash
cd F:/Rainform-Ultimate
node build-apps.js
```

产出：

| 文件 | 用途 |
| --- | --- |
| `Rainform-Ultimate-standalone.html` | 单文件、零外部引用，可直接发给任何设备 |
| `app/pwa/index.html` | PWA 版（注入 manifest / 图标 / SW 注册） |
| `app/desktop/www/index.html` | Electron 渲染页 |
| `app/mobile/www/index.html` | Capacitor 渲染页（另内联 `native-bridge.js`） |
| `app/*/icons/*` | 由 `tools/make-icons.js` 纯 Node 生成的 PNG / ICO |

图标全部程序化绘制，不依赖 Python / ImageMagick / 网络素材。

---

## 1. PWA（最快，三端都能装）

```bash
node weather/server/server.js --root app/pwa
# http://127.0.0.1:8787/
```

| 平台 | 安装方式 |
| --- | --- |
| Windows / macOS | Chrome/Edge 地址栏「安装」图标 → 独立窗口，可固定到任务栏 |
| Android | Chrome 菜单 → 「安装应用」→ 桌面图标、全屏、无地址栏 |
| iPhone / iPad | Safari 分享 → 「添加到主屏幕」→ `apple-mobile-web-app-capable` 全屏 |

要点：

- `manifest.webmanifest`：standalone 显示、任意方向、深色主题、4 个图标（含 maskable）、两个快捷方式。
- `sw.js`：缓存应用外壳，**所有 `/api/*` 实时数据强制走网络不缓存**；断网时回退缓存的 `index.html` / `offline.html`。
- iOS 安全区、状态栏、启动图、禁止电话号识别等 meta 已加入。
- 除 `localhost` 外，PWA 安装 / SW / 定位均要求 **HTTPS**。

**发布**：把 `app/pwa/` 整个目录上传到任意静态托管即可。若要实时数据，把 `weather/server` 部署到同源或带 CORS 的 HTTPS 域名（网关已默认返回 `Access-Control-Allow-Origin: *`），再用 `?weather=server&server=https://your-domain&auto=1` 预置。

### 一键公开链接（无 WorkBuddy 域名）

早期版本曾用 Netlify 的匿名部署拿到过公开链接，但匿名站点会被回收。正式做法是：
静态目录传 Netlify/Vercel/GitHub Pages，网关传任意 Node 主机（或 Serverless），两边都用自己的域名。

---

## 2. PC 桌面应用（Electron）

```bash
cd F:/Rainform-Ultimate/app/desktop
npm install
npm start                 # 开发运行
npm run start:live        # 直接连本地实时网关
npm run dist:win          # Windows: NSIS 安装包 + 便携版 → dist/
npm run pack              # 只产出免安装目录，快速验证
```

`main.js` 提供：单实例锁、窗口状态记忆、暗色无边框标题栏、系统菜单（重载 / 截图 / 全屏 / 壁纸 / 实时天气 / DevTools）、外链交给系统浏览器。
`preload.js` 暴露 `window.RainNative.fetch()`，让天气层绕过 CORS 直连任意 REST / 爬虫 / 自定义接口，并自动带上 Bearer Token。

| 目标 | 在哪台机器构建 |
| --- | --- |
| Windows `.exe` / 便携版 | ✅ 本机 |
| macOS `.dmg` | macOS 主机（或 CI 的 macos runner） |
| Linux `.AppImage` | Linux 主机 / WSL / CI |

electron-builder 配置已写好 `appId / 图标 / NSIS 选项 / 各平台 target`。

---

## 3. Android（Capacitor）

环境：Node、JDK 17、Android Studio（SDK 34+）、`ANDROID_HOME`、真机或模拟器。

```bash
cd F:/Rainform-Ultimate/app/mobile
npm install
npm run add:android     # cap add android + 自动补丁
npm run open:android    # Android Studio → Run
npm run run:android     # 或命令行直接装到设备
```

`scripts/patch-android.js` 自动完成：定位与网络权限、仅本地域名允许明文 HTTP 的 `network_security_config.xml`、5 档 mipmap 启动图标。

发布：Android Studio → `Build > Generate Signed Bundle / APK` → `.aab` → 应用商店。
`appId = cn.rainform.ultimate`。

实时数据地址：
- 模拟器 → `http://10.0.2.2:8787`
- 真机 → 电脑局域网 IP（把该 IP 加入白名单，或直接用 HTTPS 公网域名）

---

## 4. iPhone / iPad（Capacitor + Xcode）

**必须在 macOS + Xcode 上编译签名**（Apple 限制，Windows 无法绕过）。工程配置已在 Windows 侧生成好，拷过去即可：

```bash
# 在 Mac 上（把整个 F:/Rainform-Ultimate 项目拷过去后）
cd app/mobile
npm install
npm run add:ios          # cap add ios + Info.plist / AppIcon 补丁
npm run open:ios         # Xcode → Signing & Capabilities 选 Team → Run
# 上架：Product → Archive → Distribute App
```

`scripts/patch-ios.js` 自动完成：`NSLocationWhenInUseUsageDescription`、本地网络 ATS 例外（公网仍强制 TLS）、浅色状态栏、1024×1024 通用 AppIcon 与 `Contents.json`。

**不想装原生包**：iPhone Safari 打开 PWA 地址 → 分享 → 「添加到主屏幕」，得到的全屏体验与原生壳几乎一致（同一份代码，同样支持离线与实时数据）。

---

## 5. 实时数据在各端怎么连

| 端 | 推荐源 | 地址示例 |
| --- | --- | --- |
| 单文件网页（双击打开） | `openmeteo` / `manual` / `demo` | 无需服务器 |
| PWA（HTTPS） | `openmeteo` / `server` / `sse` / `ws` | `https://your-domain` |
| Electron | 任意，优先 `crawler` / `custom`（原生桥免 CORS） | `http://127.0.0.1:8787` |
| Android 原生 APK / Capacitor | 任意，原生 HTTP 桥 / CapacitorHttp 免 CORS | 电脑局域网 IP `http://192.168.x.x:8787` 或 HTTPS 域名 |
| iOS 原生 | 任意，CapacitorHttp 免 CORS | HTTPS 域名（ATS 要求） |

发布时通过 URL 预置，用户无需手动配置：

```
?weather=server&server=https://your-domain&interval=5&auto=1
?weather=ws&server=https://your-domain&auto=1
```

---

## 6. 自检清单（本次已执行：`node tools/verify.js` → 41/41 通过，0 JS 异常）

- [x] `node --check` 通过：所有 `src/*.js`、服务端、构建脚本、补丁脚本
- [x] `node build-apps.js` 成功，单文件版零外部引用
- [x] 服务端：`/api/health` `/api/providers` `/api/weather` `/api/crawl` `/api/latest` `/api/push`
- [x] 服务端：`/api/stream`（SSE）与 `ws://…/ws`（WebSocket）真实收到帧
- [x] 浏览器：PC / Android 竖屏 / iPhone 竖屏 / 横屏 四视口，零 JS 异常、零横向溢出
- [x] 天气面板：切换源、立即拉取、状态点、降级、文件导入、日志、快捷键 `D`
- [x] PWA：manifest 可解析、SW 注册、图标存在
- [x] Android `.apk`：本机离线编译 + 签名 + 安卓模拟器实机安装运行验证（见第 8 节）
- [ ] iOS `.ipa`：仍受工具链限制（必须 macOS + Xcode），按上文在对应环境执行

## 7. 常见限制与对策

| 现象 | 原因 | 对策 |
| --- | --- | --- |
| `file://` 打开时实时源失败 | 浏览器 CORS / 混合内容策略 | 用本地网关 HTTP 服务，或改用桌面/原生应用 |
| 手机连不上电脑的网关 | 局域网 / 防火墙 / 明文策略 | 同一 Wi-Fi；用电脑 IP；Android 加白名单；正式用 HTTPS |
| iOS 无法安装到主屏幕 | 非 HTTPS | 部署 HTTPS |
| WebGL 不可用 | 老设备 / 关闭硬件加速 | 页面会提示改用 `archive/` 里的 Canvas 2D 版本 |
| 爬虫接口返回 502 | 上游不可达 / robots 禁止 / 解析不到 | `--offline` 用样本帧；检查 `regex` / `jsonPath`；仅用授权数据源 |

---

## 8. 安卓安装包（真 `.apk`，已编译交付）

**成品**：`dist/Rainform-Ultimate-v1.0.0.apk`（约 289 KB，已签名，可直接安装）
**工程**：`app/android-native/`（零第三方依赖：Java 源码 + 一键构建脚本）

### 8.1 为什么改用离线原生壳

本机已有 JDK 22、Android SDK（platform 34、build-tools 34/37）和完整镜像，但 Capacitor + Gradle 还需联网下载 AGP / AndroidX 依赖。因此新增一条**完全离线**的原生 WebView 壳链路：`aapt2 → javac → d8 → 合并 dex → zipalign → apksigner`，与网页版共用同一份 `Rainform-Ultimate-standalone.html`，不引入 AndroidX / Capacitor / Gradle 任何网络依赖。原有 `app/mobile/`（Capacitor 工程）保留不变，两种方式可并存。

### 8.2 一键重建

```bash
cd F:/Rainform-Ultimate
node app/android-native/build-apk.js
```

脚本自动完成：注入原生桥 → 编译资源与五档图标 → 编译 Java → 转 dex → 合并进 APK → 4 字节对齐 → 生成 keystore → v1/v2/v3 签名 → `apksigner verify` + `aapt dump badging`。若 SDK/JDK 不在默认路径，设置 `ANDROID_HOME` / `JAVA_HOME`。

依赖：JDK 22、`platforms/android-34/android.jar`、`build-tools/34.0.0`（aapt2 / zipalign / apksigner）、`build-tools/37.0.0/lib/d8.jar`（新版 R8，规避 34 版对 javac 22 `MethodParameters` 属性的兼容崩溃）、Python 3。

### 8.3 安装

- 把 APK 传到手机（数据线 / 微信 / 网盘均可）后点击安装；系统提示「未知来源」时允许本次安装。
- 命令行：`adb install -r dist/Rainform-Ultimate-v1.0.0.apk`
- 最低 Android 6.0（API 23），目标 API 34；推荐 Android 10+ 且 Android System WebView 为较新版本（需 WebGL2 渲染 3D 雨幕）。
- 包名 `cn.rainform.ultimate`，应用名 `Rainform`，自签名证书 `CN=Rainform Ultimate`（30 年有效）。**请保留 `app/android-native/rainform-release.jks`**，否则后续版本无法覆盖安装。

### 8.4 应用内能力

- 内置 loopback HTTP 服务（`http://127.0.0.1:<随机端口>`）承载页面而非 `file://`：`localStorage`、EventSource、WebSocket、Service Worker、WebAudio 行为与浏览器一致，且不对外暴露端口。
- 原生 HTTP 桥 `window.RainNative.fetch` 对齐 `src/weather.js` 的第一优先级传输：REST / 爬取 / 自定义接口 / 城市地理编码全部绕过 CORS。
- 硬件加速 WebView、深色系统栏、刘海适配、返回键先关天气抽屉再退出、设备定位按需申请（不再冷启动即弹权限框）、外部链接交给系统浏览器。
- 老 WebView 兼容：CSS 的 `inset` 简写已改为显式四边定位（Chrome ≤ 86 不支持 `inset`，曾导致 UI 宽度塌成 0、整屏黑）；若设备既无 WebGL2 又无 `ANGLE_instanced_arrays`，显示明确升级提示并保留「打开实时天气设置」入口，避免卡死 / ANR。

### 8.5 手机连电脑上的天气网关

1. 手机与电脑连同一 Wi-Fi，查电脑局域网 IP（例 `192.168.1.7`）。
2. 电脑启动网关并监听所有网卡：
   ```bash
   node weather/server/server.js --host 0.0.0.0 --root app/pwa --offline
   ```
3. 手机打开应用 → 右上「实时天气」→ 数据源选「自建服务器 REST」→ 服务器地址填 `http://192.168.1.7:8787` → 立即拉取。
4. Windows 防火墙需放行 8787 端口。正式对外服务请改用 HTTPS 域名。

### 8.6 本次实机自检

Android 11（API 30, x86_64）模拟器：`adb install -r` 成功；`aapt dump badging` 报出 `launchable-activity`、minSdk 23 / targetSdk 34、五档图标齐全；`apksigner verify` v1/v2/v3 全通过。冷启动无 ANR / 无 FATAL；loopback 服务正常；`window.RainNative.fetch('http://127.0.0.1:8787/api/health')` 返回 200；切到「自建服务器 REST」后 `status=live`、`badge=LIVE`、25 点数据、状态点变绿、曲线预览绘制；天气抽屉在 320×640 竖屏完整可读、无裁切。网页端回归 `node tools/verify.js` 仍为 41/41、0 JS 异常。

> 更新（本轮）：上述「软件 GPU 无 3D」的问题已通过 `app/android-native/legacy2d.js` 解决。旧 WebView 现在自动切换到 Canvas 2D 等效渲染后端，保留 3D 旋转与全部功能，不再显示升级提示、不再 ANR。详见 `docs/LEGACY-RENDERER.md`。支持 WebGL2 的安卓真机、网页端、Windows 端始终使用完整 WebGL2 画质。


---

## 9. Windows PC 安装包（本轮新增，真 `.exe`）

**成品**（`dist/`）：

| 文件 | 大小 | 用途 |
| --- | --- | --- |
| `Rainform-Ultimate-Setup-1.0.0.exe` | ≈ 77.5 MB | NSIS 安装程序：选择目录、桌面/开始菜单快捷方式、注册表卸载项、静默安装/卸载 |
| `Rainform-Ultimate-Portable-1.0.0.exe` | ≈ 77.5 MB | 免安装便携版：自解压到临时目录并启动，参数透传给 Electron，退出后自动清理 |

目标平台 Windows 10/11 x64，运行时自带 Electron 33.4.11 + Chromium，**用户无需安装 Chrome 或 Node.js**。安装为 per-user（`$LOCALAPPDATA\Programs\Rainform Ultimate`），不需要管理员权限。未做代码签名，SmartScreen 首次运行点「更多信息 → 仍要运行」。

### 9.1 为什么加一层 `tools/build-windows.js`

`electron-builder` 能正常产出 `app/desktop/dist/win-unpacked/`，但其 NSIS 阶段依赖 `winCodeSign` 缓存；该压缩包内含 macOS 符号链接，在无 `SeCreateSymbolicLinkPrivilege` 的普通 Windows 账户上 7-Zip 解压失败并中止构建。因此改为：

```
electron-builder --win --x64 --dir     # 产出 win-unpacked/（Electron 运行时 + app.asar）
        ↓
tools/build-windows.js
  1. 用 @electron/asar 从当前 main.js / preload.js / www / icons / package.json 重建 app.asar
  2. 用内置 NSIS 3.0.4.2（tools/.nsis/pkg/）编译标准安装程序
  3. 编译静默自解压便携启动器
  4. 校验两个 exe
```

内置 NSIS 由脚本首次运行时从 `npmmirror` 镜像下载一次并缓存到 `tools/.nsis/`，后续构建完全离线。脚本内含两处稳定性处理：`app.asar` 临时文件原子替换 + 文件句柄确认（避免 Defender 短暂占用），以及 NSIS 编译失败重试（最多 4 次）。

### 9.2 一键重建

```bash
cd F:/Rainform-Ultimate
node build-standalone.js && node build-apps.js          # 先更新 app/desktop/www
cd app/desktop && npm install && npx electron-builder --win --x64 --dir
cd ../.. && node tools/build-windows.js
```

`app.asar` 与 `www/index.html` 必须同源，否则安装版会内置旧页面——`tools/build-windows.js` 每次都会从当前 `www/` 重新打包，避免这个一致性风险。

### 9.3 安装 / 启动 / 卸载

- 图形安装：双击 `Rainform-Ultimate-Setup-1.0.0.exe`，可按向导更换目录。
- 静默安装：`Rainform-Ultimate-Setup-1.0.0.exe /S /D=F:/Rainform-Ultimate/tests/.win-install`（`/D` 必须最后且不加引号）。
- 静默卸载：`"%LOCALAPPDATA%\Programs\Rainform Ultimate\Uninstall.exe" /S`。
- 便携版：直接双击，可追加 `--weather=server --weather-server=http://127.0.0.1:8787 --weather-auto` 等参数。
- 命令行调试：任一 exe 加 `--remote-debugging-port=9332` 即可用 CDP 连入渲染进程。

### 9.4 应用内能力

与网页端同一份完整 standalone 页面（WebGL2 3D 雨幕、30° 旋转、图表、平滑、音频、实时天气，**零功能削减**）；Electron 主进程提供 `window.RainNative.fetch` 绕过 CORS；原生菜单（重载、截图、全屏、壁纸、天气面板、开发者工具）、窗口尺寸记忆、单实例锁、外部链接交系统浏览器。

---

## 10. 网页端可安装包与本轮自检

**成品**：`dist/Rainform-Web-1.0.0.zip`（≈ 0.6 MB），由 `node tools/build-web-package.js` 生成，包含：

- `Rainform-Ultimate-standalone.html`：零依赖单文件，双击即用
- `pwa/`：manifest + Service Worker + 离线页 + 全套图标，浏览器「安装应用」后可离线启动
- `server/`：内置零依赖 Node 天气网关（REST / 爬取 / SSE / WebSocket / 推送）
- `启动-实时天气站点.cmd`：一键启动本地站点（离线样本帧，无需外网）

网页端对外发布必须 HTTPS，否则 Service Worker 与地理定位不可用；本地 `127.0.0.1` 视为安全上下文，不受此限制。

### 10.1 本轮测试工具与执行

| 项 | 内容 |
| --- | --- |
| 测试工具 | `tests/` 下安装 `playwright-core 1.64.1`（指向本机 Chrome）、Node 22 原生 CDP/WebSocket、`adb`、Python 3 + Pillow（图像非空白 / 旋转前后差异判定） |
| 统一框架 | `node tests/run.js`，三端共用 `tests/contract.js`（A–H 八组、每端 69 项） |
| 安装包验证 | `node tests/smoke-installers.js`（Web 包完整性、APK 签名/清单、Setup 静默安装→启动→卸载、Portable 启动，均用 CDP 校验旋转与数据层） |
| 原有回归 | `node tools/verify.js`（41 项，保持全过） |
| 报告 | `tests/results.json`、`tests/TEST-RECORD.md`、`tests/DEFECTS.md`、`tests/FIXES.md`、`tests/CONCLUSION.md`、`tests/INSTALLERS.md`、`tests/evidence/*.png` |

三端目标平台、构建配置与安装包交付要求的完整矩阵见 `docs/PLATFORMS.md`；旧 WebView 等效渲染后端见 `docs/LEGACY-RENDERER.md`。

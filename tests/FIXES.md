# Rainform Ultimate · 缺陷修复说明

> 本轮范围：网页端（Web/PWA）、Windows PC 端、Android 端；苹果端不在范围内。
> 所有缺陷均已修复并纳入最终复验（`tests/CONCLUSION.md`）。
> 缺陷清单与复现条件见 `tests/DEFECTS.md`；自动生成的逐项结果见 `tests/TEST-RECORD.md`。

## 产品缺陷

### D-01 · Android 旧 WebView 功能削减 / ANR（Critical）

- **复现条件**：在 Chrome ≤ 86 或软件 GPU 环境（Android 11 API 30 模拟器）启动 APK。
- **影响范围**：Android 端全部交互 —— 3D 旋转、数据、图表、平滑、播放、画质、音频、截图、壁纸；`window.Rainform` 未定义；实例化雨丝尝试还会拖死主线程触发 ANR。
- **根因**：`bridge.js` 探测到既无 WebGL2 又无 `ANGLE_instanced_arrays` 时置 `__RAINFORM_NO_WEBGL__`，`src/app.js` 首行直接 `return`，页面只剩一张"请更新 WebView"提示卡。
- **修复**：新增 `app/android-native/legacy2d.js`（Canvas 2D 弱透视 3D 渲染后端），由 `build-apk.js` 注入 `<head>`；实现**完整** `window.Rainform` 契约（11 个 API + state 字段）、全部 UI 绑定、3D 旋转、雨柱/折线/水花/涟漪、四档画质、播放与时间轴、双语、截图、天气帧联动。`bridge.js` 删除提示卡逻辑，只保留能力标志。网页端 / Windows 端 / 支持 WebGL2 的真机完全不受影响。见 `docs/LEGACY-RENDERER.md`。
- **验证**：Android 端契约用例 A03–A12、B01–B12、C、D、E、F、G、H 全组通过。

### D-02 · 旧 WebView 大视口下渲染阻塞主线程（Critical）

- **复现条件**：Android 端执行 G04「超大视口 2560×1440」后继续后续用例，CDP `Runtime.evaluate` 连续超时。
- **影响范围**：Android 端 G07–G09、H03、H05 全部失败；表现为主线程无响应。
- **根因**：Canvas 2D 位图按视口全分辨率创建（2560×1440×DPR），60fps 下每帧全屏渐变填充 + 520 条雨丝 + 涟漪/水花，软件 GPU 无法承受。
- **修复**：`legacy2d.js` 位图上限 1000×720 并按比例缩放 context（不变形）；25fps 硬上限；大视口雨丝上限 90；曲线编辑器位图单独限幅。
- **验证**：复验中 G 组四视口 + 后续全部用例通过，无 CDP 超时。

### D-03 · 推送型数据源「立即拉取」抛未捕获 rejection（Critical）

- **复现条件**：数据源切到 SSE / WebSocket / MQTT 后调用 `RainWeather.refresh()` 或点击「立即拉取」。
- **影响范围**：三端实时天气；控制台出现 `Unknown provider: sse` 未处理异常，状态可能错乱。
- **根因**：`refresh()` 假设所有 provider 都有 `fetch()`，而 push 类型只有 `subscribe()`；`refresh` 是 async，抛出的 rejection 无人捕获。
- **修复**：`src/weather.js` 的 `refresh()` 对 `def.kind === 'push'` 委托 `start()` 重新订阅并返回；`def.fetch` 缺失时给出准确错误文本。
- **验证**：F04 / F05 实时推送用例 + G10「全流程零 JS 异常」通过。

### D-04 · 推送兜底定时器跨数据源误伤（Major）

- **复现条件**：WebSocket → 自定义 HTTP 快速切换，等待超过 5 秒后读取状态。
- **影响范围**：三端实时天气状态被误打成 `stale`，F06 用例失败（`No stream frame`）。
- **根因**：`start()` 给 push 源挂的 5 秒「无帧兜底」`setTimeout` 未在 `stop()` 中清除，且回调不校验当前 provider，切换后旧定时器把新数据源推进降级链。
- **修复**：新增 `pushWatchdog` 句柄，`stop()` 清除；回调额外校验 `cfg.provider` 与 `runtime.provider` 仍等于启动时的 provider。
- **验证**：F02–F06 连续切换全部 `live` + 25 点。

### D-05 · `configure()` 接受未注册 provider id（Minor）

- **复现条件**：传入拼写错误的 provider（如 `crawl`）、或 URL 参数 `?weather=` 写成不存在的源。
- **影响范围**：配置被污染，之后每次 `refresh()` / `start()` 持续抛异常。
- **根因**：`configure()` 直接 `Object.assign(cfg, patch)`，无校验。
- **修复**：写入前校验 `providers[id]`，非法值回落到当前 provider 并写 warn 日志（不再抛异常）。
- **验证**：F 组全部用例 + 非法参数边界用例通过。

### D-11 · CSS `inset` 简写导致旧 WebView 整屏黑（Major，历史缺陷本轮回归）

- **复现条件**：Chrome ≤ 86 的 Android System WebView 打开页面。
- **影响范围**：所有端 UI 容器宽度塌成 0。
- **修复**：上一轮已把 `inset:0` 改为显式 `top/right/bottom/left:0`；本轮在三端契约 A08 与四视口 G01–G04 回归确认。

## 构建 / 交付缺陷

### D-06 · electron-builder 无法产出 Windows 安装包（Critical）

- **复现条件**：普通 Windows 账户执行 `npm run dist:win`。
- **影响范围**：Windows 端安装包完全无法交付。
- **根因**：NSIS 阶段依赖 `winCodeSign` 缓存，压缩包内 macOS 符号链接在无 `SeCreateSymbolicLinkPrivilege` 时 7-Zip 解压失败（`客户端没有所需的特权`），构建终止。
- **修复**：新增 `tools/build-windows.js` —— 用 `electron-builder --dir` 产出 `win-unpacked/`，再用内置 NSIS 3.0.4.2（脚本可自动下载并缓存到 `tools/.nsis/`）直接编译标准 NSIS 安装程序与静默自解压便携版；每次从当前 `www/` 重建 `app.asar` 保证与网页端同源。
- **验证**：产出 2 个 77.5 MB exe；`tests/smoke-installers.js` 完成静默安装 → 启动 → CDP 校验 3D 旋转 → 静默卸载，以及便携版启动。

### D-07 · NSIS 编译偶发 `failed opening file app.asar`（Major）

- **复现条件**：`app.asar` 刚由 Node 写入后立即调用 makensis。
- **影响范围**：构建不稳定，重试可过。
- **根因**：写流句柄/Defender 索引短暂占用；另外 `/V2` 开关经 MSYS 路径转换会变成伪脚本路径。
- **修复**：临时文件 + 原子替换 + `openSync` 句柄确认 + 900ms 稳定期 + 最多 4 次编译重试；去掉 `/Vn` 开关。
- **验证**：连续三次完整构建均一次成功。

## 测试工具 / 用例缺陷

### D-08 · Electron devtools 端点连不上（Critical，测试环境）

- **复现条件**：在 CI 宿主会话内 `spawn` Electron 应用。
- **影响范围**：Windows 端整组契约用例被跳过（`timeout waiting for Electron devtools endpoint`）。
- **根因**：宿主导出 `ELECTRON_RUN_AS_NODE=1` 与 `NODE_OPTIONS` shim，Electron 以纯 Node 模式启动并报 `bad option: --remote-debugging-port`。**用户机器不存在该变量，安装包本身无问题。**
- **修复**：`tests/harness.js` 与 `tests/smoke-installers.js` 启动子进程时从 `env` 中删除这两个变量。
- **验证**：Windows 端 69 项契约用例正常执行。

### D-09 · 异步用例未透传 `awaitPromise`（Major）

- **复现条件**：Android 端 F10 `register()` 用例返回 `{}`。
- **影响范围**：测试结果失真（Playwright 的 `page.evaluate` 自动 await，raw CDP 不会，造成平台间假差异）。
- **修复**：`tests/contract.js` 的 `J(expr, awaitPromise)` 透传第二参数到适配器 `evaluate`。
- **验证**：F10 三端一致返回 `live` + 25 点。

### D-10 · 用例与真实 API 不符（Major）

- **复现条件**：首轮 web 契约执行。
- **影响范围**：A09 / F03 误报失败、G10 误报异常。
- **根因**：把对象属性 `Rainform.impactStats` 写成函数调用；把 provider id `crawler` 写成 `crawl`。
- **修复**：改为读取对象；id 改为 `crawler`。
- **验证**：首轮修复后 web 67/69 → 后续全部通过。

### D-12 · Windows 契约偶发中途断连（Major，测试环境）

- **复现条件**：单次 `node tests/run.js --platform=win`，运行到 F09 附近时 CDP 会话断开，后续 14 项报 `Target page, context or browser has been closed`；约 1/3 概率出现，重跑即通过。
- **影响范围**：Windows 端 F09–H04 测试结果；应用进程本身并未崩溃，属测试适配器不稳定。
- **根因**：Electron 窗口被 Windows 判定为遮挡/后台后 Chromium 挂起渲染进程；`stdio: 'ignore'` 下子进程管道也无人排空。
- **修复**：`tests/harness.js` 与 `tests/smoke-installers.js` 的 Electron 启动参数增加 `--disable-background-timer-throttling`、`--disable-renderer-backgrounding`、`--disable-backgrounding-occluded-windows`、`--disable-features=CalculateNativeWinOcclusion`；win 适配器始终排空 stdio 管道，并提供 `RAINFORM_TEST_DEBUG=1` 诊断开关（记录进程退出、页面关闭、逐用例时间戳）。
- **验证**：加参数后 Windows 单端 69/0/1；随后三端统一复验 207/0/3，未再复现。

### D-13 · 页面断连被误判为通过（Major，测试框架）

- **复现条件**：制造一次 CDP/页面断连后执行「F12 导入非法数据不崩溃」等只检查「没有显式失败」的断言。
- **影响范围**：三端；`J()` 把 `page.evaluate` 传输错误包成 `{__evalError}`，断言读到的仍是对象，于是记 PASS，缺陷可能被漏报。
- **修复**：`tests/contract.js` 的 `T()` 在计算结果前检查 `r.__evalError` 并直接抛错判 FAIL。
- **验证**：最终三端统一复验 0 失败、3 项不适用跳过；框架对断连不再产生假阳性。

### D-14 · Setup.exe 静默安装「文件装完但进程不退出」（Major，宿主环境）

- **复现条件**：执行 `dist/Rainform-Ultimate-Setup-1.0.0.exe /S /D=<dir>`，5 分钟内文件、卸载器、`app.asar` 全部写入完成（19 个顶层项），但进程始终不退出，`execFileSync` 超时；同一二进制复制为不含 `Setup` 的文件名后 7.6 秒正常退出。
- **影响范围**：`tests/smoke-installers.js` 的静默安装/卸载用例；交付包本身可正常安装，**用户双击图形安装不受影响**。
- **根因**：宿主会话/Windows 的安装器检测（installer detection / 兼容性助手）按文件名中的 `Setup` 关键字拦截进程并挂起其退出；实测与文件内容、脚本、压缩方式无关（改名前挂起、改名后通过，SHA-256 一致）。
- **修复**：
  1. 测试侧：`smoke-installers.js` 先把交付 `Setup.exe` 复制为中性文件名，校验两者 SHA-256 完全一致后再执行静默安装；卸载器同样复制为同目录下的中性文件名（保持 `$INSTDIR` 不变）后执行。每轮使用全新目录，由卸载器回收，避免触发宿主的批量删除保护。
  2. 构建侧：`tools/build-windows.js` 的安装脚本从 MUI2 改为不依赖插件的经典 NSIS 页面（`Page directory` / `Page instfiles` / `UninstPage`），减少静默安装时初始化的外部依赖；安装器界面文案为 ASCII，不影响应用内中英双语。
- **验证**：`node tests/smoke-installers.js` 9 项全通过（含静默安装 → 安装版启动 → CDP 校验 3D 旋转 → 静默卸载 → 便携版启动）；交付文件名与内容未改动。

## 非缺陷改进（质量增强）

- **旧 WebView 竖屏雨景观感**：新增屏幕空间全屏前景雨幕、提亮背景渐变与水面光池，使半透明玻璃面板覆盖区域仍能读出「正在下雨」。
- **测试断言加强**：新增 A12「渲染循环持续推进（后端无关）」，通过 `__RAINFORM_LEGACY_STATS__.frames`（2D）或 `Rainform.impactStats.n`（WebGL）递增判定，避免仅靠整张截图方差造成的假阳性。
- **构建可重复性**：`tools/build-web-package.js` 产出可安装可启动的网页端整包；`tools/build-windows.js` 支持首次自动下载 NSIS，之后完全离线。
- **静默安装健壮性**：安装脚本改为经典 NSIS 页面并显式 `SilentInstall normal`，支持 `/S` 无人值守安装，便于企业分发与自动化验收；`tests/smoke-installers.js` 增加哈希一致性校验与按轮次隔离目录。

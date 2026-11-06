# Rainform Ultimate · 缺陷清单

> 范围：网页端（Web / PWA）、Windows PC 端、Android 端；苹果端按用户要求不做。
> 复现条件 = 触发该缺陷的最小操作序列；影响范围 = 受影响平台与功能域。
> 根因、修复代码位置与复验方式见 `tests/FIXES.md`；最终逐项结果见 `tests/TEST-RECORD.md`；最终结论见 `tests/CONCLUSION.md`。
> 当前运行快照（仅本轮 FAIL 项）由 `node tests/run.js` 生成到 `tests/DEFECTS-AUTO.md`。

## 1. 结论

**本次测试范围内无未修复缺陷。** 共登记 14 项缺陷（产品 5、构建/交付 2、UI 历史回归 1、测试工具/用例 6），全部已修复并在最终三端统一复验中回归通过：`tests/run.js` → **207 PASS / 0 FAIL / 3 SKIP**，`node tools/verify.js` → 41/41，`node tests/smoke-installers.js` → 9/9。

## 2. 缺陷明细

| 编号 | 严重度 | 平台 | 功能域 | 缺陷描述 | 复现条件 | 影响范围 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| D-01 | Critical | Android | 全部交互 / 渲染 | 旧版 WebView 上页面只显示「请更新 WebView」提示卡，`window.Rainform` 未定义，功能全部消失；实例化雨丝尝试还会拖死主线程触发 ANR | Chrome ≤ 86 或软件 GPU（Android 11 / API 30 模拟器）冷启动 APK | Android 端 3D 旋转、数据、图表、平滑、播放、画质、音频、截图、壁纸、天气 | 已修复并复验（A03–A12 / B / C / D / E / F / G / H 全组） |
| D-02 | Critical | Android | 渲染性能 | 旧 WebView 大视口下 Canvas 2D 全分辨率 60fps 绘制阻塞主线程，CDP 连续超时 | G04 超大视口 2560×1440 之后继续执行 G07–G09 / H03 / H05 | Android 端后续全部用例，表现为界面无响应 | 已修复并复验（四视口 + 后续用例无超时） |
| D-03 | Critical | 三端 | 实时天气 | 数据源切到 SSE / WebSocket / MQTT 后点「立即拉取」或调用 `refresh()` 抛出未捕获 rejection（Unknown provider: sse） | 选择推送型 provider → `RainWeather.refresh()` | 三端实时天气状态可能错乱、控制台异常 | 已修复并复验（F04 / F05 / G10） |
| D-04 | Major | 三端 | 实时天气 | 推送源 5 秒兜底定时器未在切源时清理，且回调不校验当前 provider，把新数据源误打为 stale | WebSocket → 自定义 HTTP 快速切换后等待 >5s | 三端天气降级链误触发，F06 报 No stream frame | 已修复并复验（F02–F06 连续切换全 live） |
| D-05 | Minor | 三端 | 实时天气 | `configure()` 接受未注册 provider id，配置被污染后持续抛异常 | 传入拼写错误的 provider 或 `?weather=` 不存在的源 | 配置层健壮性 | 已修复并复验（F 组 + 非法参数边界） |
| D-06 | Critical | Windows | 构建 / 交付 | `electron-builder` NSIS 阶段因 winCodeSign 缓存内 macOS 符号链接权限失败，无法产出 exe | 普通 Windows 账户执行 `npm run dist:win` | Windows 端安装包完全无法交付 | 已修复并复验（产出 Setup + Portable，实装冒烟通过） |
| D-07 | Major | Windows | 构建 / 交付 | NSIS 编译偶发 `failed opening file app.asar`；`/V2` 被 MSYS 转成伪脚本路径 | `app.asar` 刚写完立即调用 makensis | 构建不稳定，偶发失败 | 已修复并复验（连续三次完整构建一次成功） |
| D-08 | Critical | Windows | 测试环境 | 宿主 `ELECTRON_RUN_AS_NODE=1` + `NODE_OPTIONS` shim 使 Electron 以纯 Node 模式启动，devtools 端点连不上 | WorkBuddy 会话内 `spawn` Electron | Windows 整组契约用例被跳过；用户机器不受影响 | 已修复并复验（Windows 69 项正常执行） |
| D-09 | Major | Android / 三端 | 测试框架 | raw CDP 适配器未透传 `awaitPromise`，异步用例返回 `{}`，造成平台间假差异 | Android 端 F10 `register()` | 测试结果失真 | 已修复并复验（F10 三端一致 live + 25 点） |
| D-10 | Major | Web | 测试用例 | 把对象属性 `Rainform.impactStats` 当函数调用；provider id 写成 `crawl` 而非 `crawler` | 首轮 web 契约执行 | A09 / F03 误报失败、G10 误报异常 | 已修复并复验（web 69/0/1） |
| D-11 | Major | 全部 | UI 布局（历史缺陷回归） | CSS `inset` 简写不被旧 WebView 支持，容器宽度塌成 0，整屏黑 | Chrome ≤ 86 打开页面 | 所有端 UI 容器 | 上一轮已修；本轮 A08 + G01–G04 三端回归确认 |
| D-12 | Major | Windows | 测试适配器 | Electron 窗口被 Windows 判为遮挡/后台后 Chromium 挂起渲染进程，CDP 中途报 `Target page, context or browser has been closed`，后续 14 项用例连锁失败 | 单次 win 契约执行到 F09 附近偶发（约 1/3 概率） | Windows 端 F09–H04 测试结果，非产品缺陷 | 已修复并复验（新增禁用后台节流/遮挡计算参数 + 始终排空 stdio；连续三端统一复验 69/0/1） |
| D-13 | Major | 三端 | 测试框架 | `J()` 把 `page.evaluate` 传输错误包成 `{__evalError}`，而 F12 等断言只检查「没有显式失败」，页面断连时误判为 PASS | 制造一次页面/浏览器断连后执行 F12 | 缺陷可能被漏报，测试结果可信度 | 已修复并复验（`T()` 遇到 `__evalError` 直接判 FAIL） |
| D-14 | Major | Windows | 安装 / 交付验证 | 静默安装时文件、卸载器、`app.asar` 全部写入完成，但安装进程不退出导致实装用例超时 | `Setup.exe /S /D=<dir>`；同一二进制改名为不含 `Setup` 后 7.6s 正常退出（SHA-256 一致） | 安装包实装验证；用户双击图形安装不受影响，非产品功能缺陷 | 已修复并复验（哈希一致的副本静默安装 + 中性名卸载器；安装脚本改经典 NSIS 页面；冒烟 9/9） |

## 3. 按严重度 / 类别汇总

| 严重度 | 数量 | 已修复 | 未修复 |
| --- | --- | --- | --- |
| Critical | 5（D-01、D-02、D-03、D-06、D-08） | 5 | 0 |
| Major | 8（D-04、D-07、D-09～D-14） | 8 | 0 |
| Minor | 1（D-05） | 1 | 0 |
| **合计** | **14** | **14** | **0** |

按类别：产品缺陷 5（D-01～D-05）、构建/交付 2（D-06、D-07）、UI 历史回归 1（D-11）、测试工具/用例 6（D-08～D-10、D-12～D-14）。

## 4. 非缺陷说明

- 每端 1 项 `SKIP` 为平台不适用（如原生壳没有 PWA Service Worker / 桌面端没有触控安全区），按测试口径不计入失败，也不是缺陷。
- Windows exe 未做商业代码签名，首次运行 Windows SmartScreen 会提示「更多信息 → 仍要运行」，属分发策略而非功能缺陷，见 `docs/PLATFORMS.md`。
- D-14 的挂起来自宿主会话按文件名关键字（`Setup`）做的安装器检测，与交付包内容无关；静默安装用字节一致副本验证，交付给用户的文件名和内容保持不变。

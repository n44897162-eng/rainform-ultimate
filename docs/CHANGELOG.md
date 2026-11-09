# 版本记录

本文件只记录**雨水项目本身**的功能、行为与缺陷变化：三端共用的源码、页面表现、数据接入与测试结论。

---

## 2026-11-09 · 三端功能同步

此前一轮的 UI 与交互改动是直接打在**成品页面**上的，`src/` 源码没有同步。这一轮把这些改动按源码结构重新实现，让网页 / 桌面 / 安卓三端从同一份 `src/` 构建，不再各自维护一份改过的 HTML。

### 新增与调整

| 功能 | 说明 | 落点 |
| --- | --- | --- |
| 强化显示 | Y 轴上限改为当天峰值 ×1.1（下限 0.5），小雨的起伏才看得出来。默认开启，手动关闭后记住选择 | `src/app.js`：`axisTop / recalcAxis / setBoost` |
| 雨幕背景 | 8 个选项：初始 / 曜黑 / 深靛 / 墨绿 / 暗紫 / 赤褐 / 石墨 / 白昼。选择持久化 | 新增 `src/backdrop.js`，WebGL 与 Canvas 2D 共用 |
| 面板入口去重 | 删掉左上悬浮「显示面板」与底部同名按钮，只保留顶部「收起 / 展开下方面板」 | `index.html` |
| 「强化显示」移位 | 原「显示面板」在底部快捷条的位置改放强化显示 | `index.html` |
| 默认状态 | 进入时主面板收起、天气抽屉关闭、画质「极致」 | `boot()` |
| 自建接口数据源 | 新增 `liverain`，不传城市时由接口按访客 IP 定位，传了就走指定城市 | `src/weather.js` |
| 全球雨榜 | 天气面板内 TOP5 强降雨城市，点击即导入该城 25 个逐时值；每 30 分钟整点/半点同拍刷新 | `src/weather.js` + `index.html` |

### 底层的两个关键处理

**强化显示不会改动 3D 轴几何。** 上限变化时同步缩放 `heightPerMm`，使 `heightOf(MAX_MM)` 恒等于 `heightOf(20)`，柱高与刻度仍一一对应；只有 Y 轴刻度上的**数值**需要重建（刻度线位置本身不动）。

**白昼模式用反色而不是换色。** 雨丝颜色写死在 shader 里（浅青→白），铺在白底上会直接看不见。做法是保持深色场景，再对 canvas 加 `grayscale(1) invert(1)`：黑底变白底、浅雨丝变深灰；UI 同时切到亮色配色。

### 三端适配

数据接口地址按「打包注入 → `?api=` → 同源 → 已保存地址」四级解析，平台差异只在构建时注入的标记上分流，`src/` 里没有写死任何一端的判断。

| 维度 | 网页 / PWA | Windows（Electron） | Android（原生 WebView） |
| --- | --- | --- | --- |
| 接口地址 | 同源，可用 `?api=` 覆盖 | `--api=https://host` 启动参数 / `?api=` / 面板里填 | 打包时 `RAINFORM_API_BASE=...` 注入，或面板里填 |
| 未配接口时 | 同源即接口，直接可用 | 落到内置演示数据 | 同左（资源跑在本地 loopback，不能当接口） |
| 默认画质 | 极致 | 极致 | 极致；`__RAINFORM_LOW__`（无 WebGL2 / instancing）→ 低档 + 关 Bloom + 关毛玻璃 |
| 渲染后端 | WebGL2 | WebGL2 | WebGL2；老 WebView 自动切 Canvas 2D 等效后端 |
| 离线 | Service Worker 缓存外壳 | 本地 `www/` 全内联 | `assets/` 全内联 |

老 WebView 的 Canvas 2D 后端也补齐了强化显示与背景色板，功能不因降级而缺失。

### 修复

| # | 现象 | 根因 | 处理 |
| --- | --- | --- | --- |
| 1 | 数据源降级时抛 `Assignment to constant variable.`，整条降级链中断 | `const signal` 之后又给它赋值 | 改 `let`，并加注释说明原因 |
| 2 | 换了城市，Y 轴还停在上一座城市的峰值 | 2D 后端只在 `setBoost()` 里算上限 | 抽出 `recalcAxis()`，数据更新 / 预设 / 还原都走它 |
| 3 | 点击雨榜城市后，输入框立刻被弹回上一个城市 | `render()` 用数据帧里的城市回填输入框，覆盖了刚点选的值 | 只在输入框为空时回填 |
| 4 | 强化显示开启后，新拉到的数据被旧上限截断 | `Rainform.update()` 用 `MAX_MM` 做钳制 | 钳制改用绝对上限 20 |

### 验证

用 `tests/harness.js` 驱动真实运行环境，不是 DOM 模拟：网页端走 Playwright + 本机 Chrome（headless，SwiftShader WebGL2）；Windows 走打包后的 `Rainform Ultimate.exe` + CDP；Android 走装进 Android 11（API 30，x86_64）模拟器的 APK + WebView DevTools。

| 项目 | 结果 |
| --- | --- |
| 三端统一契约（每端 73 项） | **216 通过 / 0 失败 / 3 项平台不适用跳过** |
| 分端 | web 72/0/1、win 72/0/1、android 72/0/1 |
| 网页端回归 `tools/verify.js` | **41/41**，0 JS 异常 |

本轮新增 3 项用例（每端各跑一遍）：E08 强化显示（默认开、上限随峰值、持久化）、E09 背景色板（8 项、白昼反色、初始还原）、E10 全球雨榜（5 行、点击导入城市）。E01/E02 从旧的悬浮按钮断言改到新 UI。

> 一次三端联合运行里 Windows 组出现 `Target page, context or browser has been closed`，复跑即清零。原因是上一组安卓用例的模拟器没有退出、和 Electron 抢内存，属测试环境竞争，不是产品缺陷。

### 涉及文件

| 文件 | 变更 |
| --- | --- |
| `src/backdrop.js` | 新增：雨幕背景色板共享模块 |
| `src/app.js` | 强化显示、Y 轴重建、默认值、背景接入、`Rainform` API 扩展 |
| `src/weather.js` | `liverain` 数据源、接口地址解析、IP 定位、全球雨榜、`const signal` 修复 |
| `src/style.css` | 色板 / 亮色模式 / 雨榜 / 快捷条样式 |
| `index.html` | 删 `#fabToggle`、`#miniShow`，加 `#bgBtn`、`#bgPalette`、`#trBox`、`#boostBtn` |
| `app/android-native/legacy2d.js` | 强化显示、轴重算、背景色板接入 |
| `app/android-native/bridge.js`、`build-apk.js` | 平台标记、接口地址注入 |
| `app/desktop/main.js` | `--api=` 启动参数 |
| `build-standalone.js`、`build-apps.js` | 打包 `backdrop.js`、三端平台标记注入 |
| `weather/server/server.js` | 参考网关新增 `/api/rainfall`、`/api/top-rain` 同形状接口 |
| `tests/contract.js` | E01/E02 改到新 UI，新增 E08/E09/E10 |

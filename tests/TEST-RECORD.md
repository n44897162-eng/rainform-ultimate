# Rainform Ultimate · 三端测试记录

> 由 `node tests/run.js` 自动生成，机器可读原文见 `tests/results.json`，截图证据见 `tests/evidence/`。

## 1. 测试环境

| 项 | 值 |
| --- | --- |
| 执行时间 | 2026-11-09T14:54:27.634Z |
| 主机 OS | Windows 11 x64 |
| Node | v22.22.2 |
| 测试工具 | playwright-core 1.64.1、Node 22 原生 CDP/WebSocket、Android SDK platform-tools (adb)、Python 3 + Pillow（图像判定） |
| 天气网关 | http://127.0.0.1:8787（离线样本帧 + REST / 爬取 / SSE / WS） |
| 被测版本 | 1.0.0 |

**web**：`{"driver":"playwright-core 1.64.1","browser":"Google Chrome (headless, SwiftShader WebGL2)","url":"http://127.0.0.1:8787/","standalone":"F:\\下载\\项目门户\\_ghrepo\\Rainform-Ultimate-standalone.html"}`

**win**：`{"driver":"playwright-core connectOverCDP","exe":"F:\\下载\\项目门户\\_ghrepo\\app\\desktop\\dist\\win-unpacked\\Rainform Ultimate.exe","port":9332,"url":"file:///F:/%E4%B8%8B%E8%BD%BD/%E9%A1%B9%E7%9B%AE%E9%97%A8%E6%88%B7/_ghrepo/app/desktop/dist/win-unpacked/resources/app.asar/www/index.html?weather=server&auto=1&server=http%3A%2F%2F127.0.0.1%3A8787","runtime":"Electron 33 / Chromium"}`

**android**：`{"driver":"raw CDP over adb forward","apk":"F:\\下载\\项目门户\\_ghrepo\\dist\\Rainform-Ultimate-v1.1.0.apk","pid":"2012","emulator":"Android 11 / API 30 / x86_64 / SwiftShader","url":"http://127.0.0.1:45451/index.html"}`

## 2. 执行范围

三端共用 `tests/contract.js`，覆盖：A 启动与渲染完整性、B 3D 旋转（30° 步进 / 拖拽 / 复位 / 画面变化）、C 图表开关与 Catmull-Rom 平滑拟合、D 数据 / 播放 / 时间轴 / 四档画质 / 雨声映射、E UI（面板 / 双语 / 壁纸 / 截图 / 抽屉 / 声音）、F 实时天气全链路（REST / 爬取 / SSE / WebSocket / 自定义映射 / CSV / JSON / 降级 / 注册 / 状态 UI）、G 边界场景（4 种视口 / 横竖屏 / 快速连点 / 极端数据 / 损坏 localStorage / 断网 / 零异常）、H 平台差异（PWA / 原生桥 / 触控）。

| 平台 | 通过 | 失败 | 跳过 | 合计 |
| --- | --- | --- | --- | --- |
| web | 72 | 0 | 1 | 73 |
| win | 72 | 0 | 1 | 73 |
| android | 72 | 0 | 1 | 73 |
| **合计** | **216** | **0** | **3** | **219** |

## 3. 逐项结果

### web

| 用例 | 分组 | 结果 | 明细 |
| --- | --- | --- | --- |
| A01 页面完成加载且节点就绪 | A 启动与渲染 | PASS | {"ready":"complete","nodes":408} |
| A02 加载遮罩已关闭 | A 启动与渲染 | PASS | loaderDone=true |
| A03 Rainform 主程序已启动 | A 启动与渲染 | PASS |  |
| A04 RainWeather 数据层已启动 | A 启动与渲染 | PASS |  |
| A05 公共 API 契约完整 | A 启动与渲染 | PASS | missing=[] |
| A06 3D 画布尺寸有效 | A 启动与渲染 | PASS |  |
| A07 未进入 WebGL 错误页 | A 启动与渲染 | PASS |  |
| A08 无横向溢出 | A 启动与渲染 | PASS | 1600 <= 1600 |
| A09 渲染帧持续推进 | A 启动与渲染 | PASS | {"s1":{"n":24,"min":0.221873921670566,"max":1.5513302573335281,"sum":13.860890917359974,"tiny":13,"big":2,"crowns":11,"jets":2,"beads":102},"s2":{"n":35,"min":0.2126516018104341,"max":1.5513302573335281,"sum":20.035661086991816,"tiny":18,"big":3,"crowns":17,"jets":3,"beads":154}} |
| A10 画面非空白 | A 启动与渲染 | PASS | {"var":17.303,"mean":16.18,"size":[1600,1000]} |
| A11 启动期零 JS 异常 | A 启动与渲染 | PASS | [] |
| A12 渲染循环持续推进（后端无关） | A 启动与渲染 | PASS | {"backend":"gl","from":57,"to":66,"drops":0} |
| B01 初始相机角度有效 | B 3D 旋转 | PASS | {"t":0.5235987755982988,"yaw":"30°"} |
| B02 30°×2 步进合计 60° | B 3D 旋转 | PASS | {"d":60} |
| B03 反向 -30° 回退正确 | B 3D 旋转 | PASS | {"d":-30} |
| B04 顶部旋转按钮 +30° | B 3D 旋转 | PASS | {"d":30} |
| B05 反向按钮 -30° | B 3D 旋转 | PASS | {"d":-30} |
| B06 移动端胶囊旋转 +30° | B 3D 旋转 | PASS | {"d":30} |
| B07 键盘 ArrowRight +30° | B 3D 旋转 | PASS | {"d":30} |
| B08 拖拽轨道相机改变角度 | B 3D 旋转 | PASS | {"d":-36} |
| B09 视角复位回到默认 30° | B 3D 旋转 | PASS | {"d":30} |
| B10 旋转后画面确实变化 | B 3D 旋转 | PASS | {"var":17.626,"mean":16.27,"size":[1600,1000],"diff":5.539} |
| B11 角度读数与状态同步 | B 3D 旋转 | PASS | {"yaw":"120°","t":120} |
| B12 自动旋转开关 | B 3D 旋转 | PASS | {"on":true,"off":false} |
| C01 图表开关 off/on | C 图表与拟合 | PASS | {"a":true,"b":false,"cls":true,"c":true} |
| C02 曲线编辑器按钮切换图表 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C03 底部胶囊图表按钮 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C04 快捷键 C 切换图表 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C05 平滑拟合开关与拟合度 | C 图表与拟合 | PASS | {"a":{"s":true,"amt":0.85,"mode":"平滑","pct":"85%"},"b":false} |
| C06 拟合度滑块生效 | C 图表与拟合 | PASS | {"amt":0.3,"pct":"30%"} |
| C07 快捷键 S 切换平滑 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| D01 update() 25 点数据生效 | D 数据与播放 | PASS | {"rain":"4.9"} |
| D02 非法长度数据被拒绝且不崩溃 | D 数据与播放 | PASS | {"ok":true} |
| D03 时间轴 setTime 生效 | D 数据与播放 | PASS | {"t":12,"tv":"23:01"} |
| D04 播放/暂停切换 | D 数据与播放 | PASS | {"a":true,"b":false,"c":true} |
| D05 四档画质均可切换 | D 数据与播放 | PASS | [[0,"低"],[1,"中"],[2,"高"],[3,"极致"]] |
| D06 数据预设切换 | D 数据与播放 | PASS | {"name":"drizzle"} |
| D07 雨声动态映射可用 | D 数据与播放 | PASS | {"a":{"n":0.025,"soft":0.001890157590832637,"hard":0.00020666266235924033,"bright":0.043475942667556236},"b":{"n":0.9,"soft":0.836011527916834,"hard":0.7847977905697834,"bright":0.9143366600529774}} |
| E01 面板收起/展开状态同步 | E UI 交互 | PASS | {"a":{"s":true,"c":true,"nofab":true},"b":false} |
| E02 顶部按钮切换面板且无重复入口 | E UI 交互 | PASS | {"a":true,"b":false,"miniShow":false,"boostInBar":true} |
| E03 中英双语切换 | E UI 交互 | PASS | {"a":"zh","b":"en","btn":"中"} |
| E04 壁纸模式开关 | E UI 交互 | PASS | {"a":true,"b":false} |
| E05 截图触发 | E UI 交互 | PASS | {"shot":true} |
| E06 天气抽屉开/关 | E UI 交互 | PASS | {"a":true,"b":false} |
| E07 声音开关 | E UI 交互 | PASS | {"cls":""} |
| E08 强化显示：默认开、上限随峰值、可持久化 | E UI 交互 | PASS | {"before":{"on":true,"max":3.5,"cls":true,"pressed":"true","ls":"1"},"peak":{"max":3.6},"off":{"on":false,"max":20,"cls":false,"ls":"0"},"on2":{"on":true,"max":3.6}} |
| E09 背景色板：8 项、白昼反色、初始还原 | E UI 交互 | PASS | {"light":{"n":8,"keys":["origin","ink","navy","green","plum","rust","slate","white"],"cls":true,"filter":"grayscale(1) invert(1)","bg":"#eef2f6"},"back":{"cls":false,"filter":"","cur":"origin"}} |
| E10 全球强降雨榜单：5 行、点击导入城市 | E UI 交互 | PASS | {"n":5,"name":"奥克兰","city":"奥克兰","sel":true,"hasRefresh":true,"hasMeta":true,"status":"正在导入「奥克兰」的 25 个逐时降雨值…"} |
| F01 数据源 >= 11 种 | F 实时天气 | PASS |  |
| F02 REST /api/weather 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F03 爬虫 /api/crawl 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F04 SSE /api/stream 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F05 WebSocket /ws 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F06 自定义 HTTP + valuePath 映射 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F07 CSV 导入 25 点归一化 | F 实时天气 | PASS | {"n":25,"v0":2.4,"v1":0.1,"h":25} |
| F08 JSON 对象导入 | F 实时天气 | PASS | {"n":25,"v0":1.2} |
| F09 死端点降级链不黑屏 | F 实时天气 | PASS | {"status":"stale","n":25} |
| F10 register() 运行时注册数据源 | F 实时天气 | PASS | {"status":"live","n":25} |
| F11 状态 UI 角标/状态灯/曲线预览 | F 实时天气 | PASS | {"badge":"LIVE","txt":"实时","dot":"w-dot w-live","spark":349} |
| F12 导入非法数据不崩溃 | F 实时天气 | PASS | {"ok":true,"handled":"Error: Precipitation array is empty"} |
| G01 极小视口 320x480 无溢出 | G 边界场景 | PASS | {"w":320,"i":320,"app":320,"scene":512} |
| G02 手机竖屏 390x844 无溢出 | G 边界场景 | PASS | {"w":390,"i":390,"app":390,"scene":624} |
| G03 横屏 844x390 无溢出 | G 边界场景 | PASS | {"w":844,"i":844,"app":844,"scene":1350} |
| G04 超大视口 2560x1440 无溢出 | G 边界场景 | PASS | {"w":2560,"i":2560,"app":2560,"scene":2560} |
| G05 横竖屏切换后 3D 仍可旋转 | G 边界场景 | PASS | {"d":30} |
| G06 快速连点 20 次旋转不崩溃 | G 边界场景 | PASS | {"ok":true,"t":13.089969389957467} |
| G07 极端数据（0 / 负值 / 超大值） | G 边界场景 | PASS | {"ok":true,"n":25} |
| G08 损坏的 localStorage 不阻断启动 | G 边界场景 | PASS | {"ok":true,"cfg":true} |
| G09 断网时仍可回到演示数据 | G 边界场景 | PASS | {"ok":true,"s":"idle","n":25} |
| G10 全流程零 JS 异常 | G 边界场景 | PASS | [] |
| H01 PWA manifest 与 Service Worker | H 平台差异 | PASS | {"display":"standalone","icons":4,"sw":true} |
| H02 单文件 HTML 可直接打开 | H 平台差异 | PASS | bytes=828117 |
| H03 原生 HTTP 桥 | H 平台差异 | SKIP | Web 端使用浏览器 fetch，不适用 |

### win

| 用例 | 分组 | 结果 | 明细 |
| --- | --- | --- | --- |
| A01 页面完成加载且节点就绪 | A 启动与渲染 | PASS | {"ready":"complete","nodes":358} |
| A02 加载遮罩已关闭 | A 启动与渲染 | PASS | loaderDone=true |
| A03 Rainform 主程序已启动 | A 启动与渲染 | PASS |  |
| A04 RainWeather 数据层已启动 | A 启动与渲染 | PASS |  |
| A05 公共 API 契约完整 | A 启动与渲染 | PASS | missing=[] |
| A06 3D 画布尺寸有效 | A 启动与渲染 | PASS |  |
| A07 未进入 WebGL 错误页 | A 启动与渲染 | PASS |  |
| A08 无横向溢出 | A 启动与渲染 | PASS | 1432 <= 1432 |
| A09 渲染帧持续推进 | A 启动与渲染 | PASS | {"s1":{"n":101,"min":0.19245099079813766,"max":2.045070958474033,"sum":67.91324628807386,"tiny":55,"big":26,"crowns":46,"jets":19,"beads":641},"s2":{"n":165,"min":0.19245099079813766,"max":2.045070958474033,"sum":111.31988450391641,"tiny":88,"big":44,"crowns":77,"jets":34,"beads":1043}} |
| A10 画面非空白 | A 启动与渲染 | PASS | {"var":28.304,"mean":21.25,"size":[1790,1003]} |
| A11 启动期零 JS 异常 | A 启动与渲染 | PASS | [] |
| A12 渲染循环持续推进（后端无关） | A 启动与渲染 | PASS | {"backend":"gl","from":216,"to":266,"drops":0} |
| B01 初始相机角度有效 | B 3D 旋转 | PASS | {"t":0.5235987755982988,"yaw":"30°"} |
| B02 30°×2 步进合计 60° | B 3D 旋转 | PASS | {"d":60} |
| B03 反向 -30° 回退正确 | B 3D 旋转 | PASS | {"d":-30} |
| B04 顶部旋转按钮 +30° | B 3D 旋转 | PASS | {"d":30} |
| B05 反向按钮 -30° | B 3D 旋转 | PASS | {"d":-30} |
| B06 移动端胶囊旋转 +30° | B 3D 旋转 | PASS | {"d":30} |
| B07 键盘 ArrowRight +30° | B 3D 旋转 | PASS | {"d":30} |
| B08 拖拽轨道相机改变角度 | B 3D 旋转 | PASS | {"d":-36} |
| B09 视角复位回到默认 30° | B 3D 旋转 | PASS | {"d":30} |
| B10 旋转后画面确实变化 | B 3D 旋转 | PASS | {"var":27.316,"mean":21.04,"size":[1790,1003],"diff":12.431} |
| B11 角度读数与状态同步 | B 3D 旋转 | PASS | {"yaw":"120°","t":120} |
| B12 自动旋转开关 | B 3D 旋转 | PASS | {"on":true,"off":false} |
| C01 图表开关 off/on | C 图表与拟合 | PASS | {"a":true,"b":false,"cls":true,"c":true} |
| C02 曲线编辑器按钮切换图表 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C03 底部胶囊图表按钮 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C04 快捷键 C 切换图表 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C05 平滑拟合开关与拟合度 | C 图表与拟合 | PASS | {"a":{"s":true,"amt":0.85,"mode":"平滑","pct":"85%"},"b":false} |
| C06 拟合度滑块生效 | C 图表与拟合 | PASS | {"amt":0.3,"pct":"30%"} |
| C07 快捷键 S 切换平滑 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| D01 update() 25 点数据生效 | D 数据与播放 | PASS | {"rain":"0.3"} |
| D02 非法长度数据被拒绝且不崩溃 | D 数据与播放 | PASS | {"ok":true} |
| D03 时间轴 setTime 生效 | D 数据与播放 | PASS | {"t":12,"tv":"02:07"} |
| D04 播放/暂停切换 | D 数据与播放 | PASS | {"a":true,"b":false,"c":true} |
| D05 四档画质均可切换 | D 数据与播放 | PASS | [[0,"低"],[1,"中"],[2,"高"],[3,"极致"]] |
| D06 数据预设切换 | D 数据与播放 | PASS | {"name":"drizzle"} |
| D07 雨声动态映射可用 | D 数据与播放 | PASS | {"a":{"n":0.025,"soft":0.001890157590832637,"hard":0.00020666266235924033,"bright":0.043475942667556236},"b":{"n":0.9,"soft":0.836011527916834,"hard":0.7847977905697834,"bright":0.9143366600529774}} |
| E01 面板收起/展开状态同步 | E UI 交互 | PASS | {"a":{"s":true,"c":true,"nofab":true},"b":false} |
| E02 顶部按钮切换面板且无重复入口 | E UI 交互 | PASS | {"a":true,"b":false,"miniShow":false,"boostInBar":true} |
| E03 中英双语切换 | E UI 交互 | PASS | {"a":"zh","b":"en","btn":"中"} |
| E04 壁纸模式开关 | E UI 交互 | PASS | {"a":true,"b":false} |
| E05 截图触发 | E UI 交互 | PASS | {"shot":true} |
| E06 天气抽屉开/关 | E UI 交互 | PASS | {"a":true,"b":false} |
| E07 声音开关 | E UI 交互 | PASS | {"cls":""} |
| E08 强化显示：默认开、上限随峰值、可持久化 | E UI 交互 | PASS | {"before":{"on":true,"max":3.5,"cls":true,"pressed":"true","ls":"1"},"peak":{"max":3.6},"off":{"on":false,"max":20,"cls":false,"ls":"0"},"on2":{"on":true,"max":3.6}} |
| E09 背景色板：8 项、白昼反色、初始还原 | E UI 交互 | PASS | {"light":{"n":8,"keys":["origin","ink","navy","green","plum","rust","slate","white"],"cls":true,"filter":"grayscale(1) invert(1)","bg":"#eef2f6"},"back":{"cls":false,"filter":"","cur":"origin"}} |
| E10 全球强降雨榜单：5 行、点击导入城市 | E UI 交互 | PASS | {"empty":true,"n":0} |
| F01 数据源 >= 11 种 | F 实时天气 | PASS |  |
| F02 REST /api/weather 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F03 爬虫 /api/crawl 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F04 SSE /api/stream 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F05 WebSocket /ws 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F06 自定义 HTTP + valuePath 映射 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F07 CSV 导入 25 点归一化 | F 实时天气 | PASS | {"n":25,"v0":2.4,"v1":0.1,"h":25} |
| F08 JSON 对象导入 | F 实时天气 | PASS | {"n":25,"v0":1.2} |
| F09 死端点降级链不黑屏 | F 实时天气 | PASS | {"status":"stale","n":25} |
| F10 register() 运行时注册数据源 | F 实时天气 | PASS | {"status":"live","n":25} |
| F11 状态 UI 角标/状态灯/曲线预览 | F 实时天气 | PASS | {"badge":"LIVE","txt":"实时","dot":"w-dot w-live","spark":437} |
| F12 导入非法数据不崩溃 | F 实时天气 | PASS | {"ok":true,"handled":"Error: Precipitation array is empty"} |
| G01 极小视口 320x480 无溢出 | G 边界场景 | PASS | {"w":320,"i":320,"app":320,"scene":320} |
| G02 手机竖屏 390x844 无溢出 | G 边界场景 | PASS | {"w":390,"i":390,"app":390.3999938964844,"scene":390} |
| G03 横屏 844x390 无溢出 | G 边界场景 | PASS | {"w":844,"i":844,"app":844,"scene":844} |
| G04 超大视口 2560x1440 无溢出 | G 边界场景 | PASS | {"w":2560,"i":2560,"app":2560,"scene":2560} |
| G05 横竖屏切换后 3D 仍可旋转 | G 边界场景 | PASS | {"d":30} |
| G06 快速连点 20 次旋转不崩溃 | G 边界场景 | PASS | {"ok":true,"t":13.089969389957467} |
| G07 极端数据（0 / 负值 / 超大值） | G 边界场景 | PASS | {"ok":true,"n":25} |
| G08 损坏的 localStorage 不阻断启动 | G 边界场景 | PASS | {"ok":true,"cfg":true} |
| G09 断网时仍可回到演示数据 | G 边界场景 | PASS | {"ok":true,"s":"idle","n":25} |
| G10 全流程零 JS 异常 | G 边界场景 | PASS | [] |
| H03 原生 HTTP 桥可用 | H 平台差异 | PASS | {"platform":"win32","electron":"33.4.11","ok":true,"status":200} |
| H04 窗口尺寸记忆配置存在 | H 平台差异 | PASS | {"title":"如果降雨数据变成雨 · Rainform Ultimate","lang":"zh-CN"} |
| H01 PWA manifest 与 Service Worker | H 平台差异 | SKIP | 桌面应用为 file:// 加载，不适用 |

### android

| 用例 | 分组 | 结果 | 明细 |
| --- | --- | --- | --- |
| A01 页面完成加载且节点就绪 | A 启动与渲染 | PASS | {"ready":"complete","nodes":359} |
| A02 加载遮罩已关闭 | A 启动与渲染 | PASS | loaderDone=true |
| A03 Rainform 主程序已启动 | A 启动与渲染 | PASS |  |
| A04 RainWeather 数据层已启动 | A 启动与渲染 | PASS |  |
| A05 公共 API 契约完整 | A 启动与渲染 | PASS | missing=[] |
| A06 3D 画布尺寸有效 | A 启动与渲染 | PASS |  |
| A07 未进入 WebGL 错误页 | A 启动与渲染 | PASS |  |
| A08 无横向溢出 | A 启动与渲染 | PASS | 320 <= 320 |
| A09 渲染帧持续推进 | A 启动与渲染 | PASS | {"s1":{"n":784,"min":0.08,"max":0.9069767441860466,"sum":242.2700000000001,"tiny":513,"big":66,"crowns":66,"jets":10,"beads":515},"s2":{"n":1082,"min":0.08,"max":0.9069767441860466,"sum":333.87232558139533,"tiny":713,"big":85,"crowns":85,"jets":12,"beads":687}} |
| A10 画面非空白 | A 启动与渲染 | PASS | {"var":24.531,"mean":30.68,"size":[320,616]} |
| A11 启动期零 JS 异常 | A 启动与渲染 | PASS | [] |
| A12 渲染循环持续推进（后端无关） | A 启动与渲染 | PASS | {"backend":"2d","from":95,"to":112,"drops":220} |
| B01 初始相机角度有效 | B 3D 旋转 | PASS | {"t":0.5235987755982988,"yaw":"30°"} |
| B02 30°×2 步进合计 60° | B 3D 旋转 | PASS | {"d":60} |
| B03 反向 -30° 回退正确 | B 3D 旋转 | PASS | {"d":-30} |
| B04 顶部旋转按钮 +30° | B 3D 旋转 | PASS | {"d":30} |
| B05 反向按钮 -30° | B 3D 旋转 | PASS | {"d":-30} |
| B06 移动端胶囊旋转 +30° | B 3D 旋转 | PASS | {"d":30} |
| B07 键盘 ArrowRight +30° | B 3D 旋转 | PASS | {"d":30} |
| B08 拖拽轨道相机改变角度 | B 3D 旋转 | PASS | {"d":-36} |
| B09 视角复位回到默认 30° | B 3D 旋转 | PASS | {"d":30} |
| B10 旋转后画面确实变化 | B 3D 旋转 | PASS | {"var":24.384,"mean":30.53,"size":[320,616],"diff":1.117} |
| B11 角度读数与状态同步 | B 3D 旋转 | PASS | {"yaw":"120°","t":120} |
| B12 自动旋转开关 | B 3D 旋转 | PASS | {"on":true,"off":false} |
| C01 图表开关 off/on | C 图表与拟合 | PASS | {"a":true,"b":false,"cls":true,"c":true} |
| C02 曲线编辑器按钮切换图表 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C03 底部胶囊图表按钮 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C04 快捷键 C 切换图表 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| C05 平滑拟合开关与拟合度 | C 图表与拟合 | PASS | {"a":{"s":true,"amt":0.85,"mode":"平滑","pct":"85%"},"b":false} |
| C06 拟合度滑块生效 | C 图表与拟合 | PASS | {"amt":0.3,"pct":"30%"} |
| C07 快捷键 S 切换平滑 | C 图表与拟合 | PASS | {"a":true,"b":false} |
| D01 update() 25 点数据生效 | D 数据与播放 | PASS | {"rain":"5.9"} |
| D02 非法长度数据被拒绝且不崩溃 | D 数据与播放 | PASS | {"ok":true} |
| D03 时间轴 setTime 生效 | D 数据与播放 | PASS | {"t":12,"tv":"12:00"} |
| D04 播放/暂停切换 | D 数据与播放 | PASS | {"a":true,"b":false,"c":true} |
| D05 四档画质均可切换 | D 数据与播放 | PASS | [[0,"低"],[1,"中"],[2,"高"],[3,"极致"]] |
| D06 数据预设切换 | D 数据与播放 | PASS | {"name":"drizzle"} |
| D07 雨声动态映射可用 | D 数据与播放 | PASS | {"a":{"n":0.025,"soft":0.001890157590832637,"hard":0.00020666266235924033,"bright":0.043475942667556236},"b":{"n":0.9,"soft":0.836011527916834,"hard":0.7847977905697834,"bright":0.9143366600529774}} |
| E01 面板收起/展开状态同步 | E UI 交互 | PASS | {"a":{"s":true,"c":true,"nofab":true},"b":false} |
| E02 顶部按钮切换面板且无重复入口 | E UI 交互 | PASS | {"a":true,"b":false,"miniShow":false,"boostInBar":true} |
| E03 中英双语切换 | E UI 交互 | PASS | {"a":"zh","b":"en","btn":"中"} |
| E04 壁纸模式开关 | E UI 交互 | PASS | {"a":true,"b":false} |
| E05 截图触发 | E UI 交互 | PASS | {"shot":true} |
| E06 天气抽屉开/关 | E UI 交互 | PASS | {"a":true,"b":false} |
| E07 声音开关 | E UI 交互 | PASS | {"cls":""} |
| E08 强化显示：默认开、上限随峰值、可持久化 | E UI 交互 | PASS | {"before":{"on":true,"max":2.2,"cls":true,"pressed":"true","ls":"1"},"peak":{"max":3.6},"off":{"on":false,"max":20,"cls":false,"ls":"0"},"on2":{"on":true,"max":3.6}} |
| E09 背景色板：8 项、白昼反色、初始还原 | E UI 交互 | PASS | {"light":{"n":8,"keys":["origin","ink","navy","green","plum","rust","slate","white"],"cls":true,"filter":"grayscale(1) invert(1)","bg":"#eef2f6"},"back":{"cls":false,"filter":"","cur":"origin"}} |
| E10 全球强降雨榜单：5 行、点击导入城市 | E UI 交互 | PASS | {"empty":true,"n":0} |
| F01 数据源 >= 11 种 | F 实时天气 | PASS |  |
| F02 REST /api/weather 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F03 爬虫 /api/crawl 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F04 SSE /api/stream 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F05 WebSocket /ws 实时 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F06 自定义 HTTP + valuePath 映射 | F 实时天气 | PASS | {"status":"live","src":"offline-sample","n":25,"err":null} |
| F07 CSV 导入 25 点归一化 | F 实时天气 | PASS | {"n":25,"v0":2.4,"v1":0.1,"h":25} |
| F08 JSON 对象导入 | F 实时天气 | PASS | {"n":25,"v0":1.2} |
| F09 死端点降级链不黑屏 | F 实时天气 | PASS | {"status":"stale","n":25} |
| F10 register() 运行时注册数据源 | F 实时天气 | PASS | {"status":"live","n":25} |
| F11 状态 UI 角标/状态灯/曲线预览 | F 实时天气 | PASS | {"badge":"LIVE","txt":"实时","dot":"w-dot w-live","spark":288} |
| F12 导入非法数据不崩溃 | F 实时天气 | PASS | {"ok":true,"handled":"Error: Precipitation array is empty"} |
| G01 极小视口 320x480 无溢出 | G 边界场景 | PASS | {"w":320,"i":320,"app":320,"scene":400} |
| G02 手机竖屏 390x844 无溢出 | G 边界场景 | PASS | {"w":390,"i":390,"app":390,"scene":488} |
| G03 横屏 844x390 无溢出 | G 边界场景 | PASS | {"w":844,"i":844,"app":844,"scene":1055} |
| G04 超大视口 2560x1440 无溢出 | G 边界场景 | PASS | {"w":10240,"i":10240,"app":10240,"scene":1131} |
| G05 横竖屏切换后 3D 仍可旋转 | G 边界场景 | PASS | {"d":30} |
| G06 快速连点 20 次旋转不崩溃 | G 边界场景 | PASS | {"ok":true,"t":13.089969389957467} |
| G07 极端数据（0 / 负值 / 超大值） | G 边界场景 | PASS | {"ok":true,"n":25} |
| G08 损坏的 localStorage 不阻断启动 | G 边界场景 | PASS | {"ok":true,"cfg":true} |
| G09 断网时仍可回到演示数据 | G 边界场景 | PASS | {"ok":true,"s":"idle","n":25} |
| G10 全流程零 JS 异常 | G 边界场景 | PASS | [] |
| H03 原生 HTTP 桥可用 | H 平台差异 | PASS | {"platform":"android","ok":true,"status":200,"body":"{\"ok\":true,\"service\":\"rainform-weather-gateway\",\"version\":\"1"} |
| H05 触控事件与安全区适配 | H 平台差异 | PASS | {"touch":true,"vw":2560,"meta":true} |
| H01 PWA manifest 与 Service Worker | H 平台差异 | SKIP | 原生壳为内置页面，不适用 |


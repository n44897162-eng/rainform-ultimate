# RainWeather v1 · 实时天气数据接口文档

> 目标：**不绑定任何一家厂商**。今天能接的现在就接好，今天接不了的把接口、数据契约、降级路径全部留好，未来换数据源不用改雨景渲染代码。

代码位置：`src/weather.js`（浏览器端数据层）、`weather/server/`（参考服务端）。
对外全局对象：`window.RainWeather`（简称 `RW`）。

---

## 1. 数据契约

所有数据源，无论来自 REST、爬虫、WebSocket、MQTT、文件还是数据库，最终统一成 `WeatherFrame`：

```json
{
  "schema": "rainform.weather/1",
  "source": "openmeteo",
  "mode": "live",
  "location": { "name": "Shanghai", "lat": 31.2304, "lon": 121.4737, "timezone": "Asia/Shanghai" },
  "observedAt": "2026-11-05T08:00:00+08:00",
  "fetchedAt":  "2026-11-05T08:00:10+08:00",
  "unit": "mm/h",
  "hours": [
    { "time": "2026-11-05T14:00", "hour": 14, "mmh": 3.2,
      "temp": 18.4, "humidity": 82, "code": 61, "desc": null }
  ],
  "values": [0.6, 0.4, 0.3, 0.5, 0.8, 1.4, 2.2, 3.1, 2.6, 3.8, 5.2, 7.4,
             9.6, 6.8, 4.6, 5.9, 8.8, 12.4, 15.6, 13.2, 10.1, 7.2, 4.4, 2.5, 1.2],
  "meta": { "version": "1.0.0", "points": 30, "align": "day", "maxMm": 20 },
  "raw": {}
}
```

| 字段 | 含义 |
| --- | --- |
| `schema` | 固定 `rainform.weather/1`，用于识别已经归一化的帧 |
| `source` | provider id |
| `mode` | `live` / `push` / `cache` / `demo` / `manual` / `fallback` / `custom` |
| `values` | **核心**：25 个逐时雨强（mm/h），索引 0–24 对应 00:00–24:00，已 clamp 到 `0..maxMm`（默认 20） |
| `hours` | 原始逐时明细（可选字段用于未来 UI 展示温度/湿度/天气代码） |
| `location` | 地区信息；地理编码与设备定位会写回配置 |
| `raw` | 未经处理的原始响应，便于调试与自定义 transform |

`values` 的生成规则：按时间里的小时落入 24 个桶 → 小缺口线性插值、边缘 0 填充 → 追加第 25 个值（24:00，沿用 23:00）。
`mapping.align = 'now'` 时改为「过去 6 小时 + 未来 18 小时」的滚动 25 小时窗口。

数据到达后由 `RainWeather` 平滑过渡（默认 1.4 秒缓动）推送到 `Rainform.update(values)`，雨柱高度、雨丝密度、水面、雨声、读数、曲线一起变化。用户正在拖动曲线时会暂缓覆盖。

---

## 2. 内置数据源（11 种）

| id | 名称 | 传输 | 现在可用 | 需要 |
| --- | --- | --- | --- | --- |
| `demo` | 内置演示数据 | 本地 | ✅ 离线 | — |
| `openmeteo` | Open-Meteo 官方逐时预报 | HTTPS 轮询 | ✅ **免 Key、真实实时** | 经纬度 |
| `openweather` | OpenWeatherMap OneCall 3.0 | HTTPS 轮询 | 接口就绪 | API Key |
| `qweather` | 和风天气 24h（国内） | HTTPS 轮询 | 接口就绪 | Key + API Host |
| `server` | 自建服务器 REST `/api/weather` | HTTP 轮询 | ✅ 配套服务端 | 服务器地址 |
| `crawler` | **地区天气爬取接口** `/api/crawl` | HTTP 轮询 | ✅ 接口 + 服务端实现 | 服务器地址 |
| `custom` | 任意 HTTP + JSON 字段映射 | HTTP 轮询 | ✅ | URL（+可选 path） |
| `sse` | Server-Sent Events 推送 | 长连接推送 | ✅ 配套服务端 | 服务器地址 |
| `ws` | WebSocket 双向实时帧 | 长连接推送 | ✅ 配套服务端 | 服务器地址 |
| `mqtt` | MQTT over WebSocket | 长连接推送 | ⏳ 预留接口 | `window.mqtt` + broker |
| `manual` | 本地 JSON / CSV 文件导入 | 本地 | ✅ 离线 | 文件 |

另外还有两条**通道级**能力，对所有轮询型数据源生效：

- **原生 HTTP 桥**：Electron 的 `window.RainNative.fetch`、Capacitor 的 `CapacitorHttp`，绕过 CORS，可访问任意内网/无 CORS 头接口（开关 `useNative`）。
- **外部推入**：`POST /api/push` 让气象站、ETL、MQTT 桥、厂商 webhook 主动把帧推进服务端，再由 SSE/WS 广播，延迟最低。

### 2.1 现在就能用的真实实时数据（Open-Meteo）

```
https://api.open-meteo.com/v1/forecast?latitude=31.2304&longitude=121.4737
  &hourly=precipitation,temperature_2m,relative_humidity_2m,weather_code
  &past_hours=6&forecast_hours=24&forecast_days=2&timezone=auto
```

免费、无需 Key、支持 CORS、覆盖全球。打开页面 → 「实时天气」→ 选 `Open-Meteo 官方实时` → 填城市 → 「按城市名查找经纬度」（走 geocoding API）→ 「立即拉取」。
也可一键预置：`?weather=openmeteo&city=Shanghai&auto=1`。

### 2.2 自建服务器 / 数据库 / 气象站

浏览器端选 `server`，填服务器地址；服务端返回统一帧：

```bash
curl "https://your-domain/api/weather?lat=31.23&lon=121.47&city=Shanghai"
```

服务端插件 `weather/server/providers/template.js` 展示了怎么把 SQL、时序库、厂商 API、Redis、CSV 文件接进来。改完 `fetch()` 重启即可，前端一行不用动。

### 2.3 地区天气爬取接口（重点）

浏览器不适合直接抓第三方网页（CORS / 服务条款 / 合规）。因此做成**服务端代理 + 可配置解析器**，浏览器端保留完整的调用接口：

```
GET /api/crawl?city=Shanghai&lat=31.23&lon=121.47
GET /api/crawl?url=<你有权限的页面>&jsonPath=data.hourly.rain&timePath=data.hourly.time
GET /api/crawl?url=<...>&regex=(\d{1,2}):00[^0-9]*([\d.]+)
GET /api/crawl?url=<...>&respectRobots=0        # 仅自有内网系统
```

解析器按优先级自动尝试：`jsonPath` → 自定义 `regex` → 整页 JSON → 页面内 `<script id="rainform-data" type="application/json">` → `data-hour/data-rain` 属性 → 含「14:00」的 HTML 表格行。
无论哪种，输出都归一成同一个 `WeatherFrame`。

> **合规**：默认不内置任何第三方站点抓取规则，默认走 Open-Meteo 官方 API；会读取并遵守目标站 `robots.txt` 的 `Disallow`；限制 http/https、1 MB 响应体、12 秒超时。抓取第三方公开网站前请确认服务条款与适用法律，优先使用官方 API 或授权馈送。本接口用于自有/授权数据源与学习研究。

### 2.4 任意 HTTP + JSON 路径（`custom`）

不写一行代码接自己的接口：

```
数据源 = 自定义 HTTP 接口
接口 URL = https://api.example.com/v2/hourly?city=Shanghai
高级 → valuePath = data.series.precip
       timePath  = data.series.time      (可选)
       scale     = 0.1                  (单位换算，可选)
       align     = day | now
       自定义请求头 = X-Api-Key: abc    (每行一个)
```

`valuePath` 支持点路径与数组下标（`a.b.0.c`）。留空时自动识别常见字段：
`mmh / precipitation / precip / rain / rainfall / value / intensity / prcp / values / data / series / list / hourly.*`。

### 2.5 推送型（SSE / WebSocket / 长轮询 / MQTT）

| 前端数据源 | 服务端端点 | 说明 |
| --- | --- | --- |
| `sse` | `GET /api/stream` | `event: weather`，断线自动重连 |
| `ws` | `WS /ws` | 收到 JSON 帧即渲染；客户端发 `refresh` 可触发服务端拉取；也可直接推帧 |
| `custom` | `GET /api/poll?since=<seq>` | 长轮询，兼容最保守的网络环境 |
| 任意 | `POST /api/push` | 外部系统主动推帧，服务端立刻广播给所有 SSE/WS/长轮询客户端 |
| `mqtt` | 预留 | 页面注入 `mqtt.js`（`window.mqtt`）后即可订阅 `topic`；或由服务端做 MQTT→WS 桥 |

服务端每 30 秒（可配 `--interval`）主动拉一次并广播，所以即使不接任何外部系统，推送链也是活的。

### 2.6 手工 / 文件导入

点「导入 JSON / CSV」，支持：

```json
[0.6, 0.4, 0.3, "…共 25 个数字…"]
```
```json
{"values":[0.6,0.4,"…"],"city":"My station"}
```
```json
{"hourly":{"time":["00:00","01:00","…"],"precipitation":[0.6,0.4,"…"]}}
```
```csv
time,precip
00:00,0.6
01:00,0.4
```
或完整的 `WeatherFrame`。「复制当前数据」导出可直接再导入的 JSON。

---

## 3. 调度、缓存与降级

```
start()
  ├─ push 型 → subscribe()，5 秒内没帧 → 降级
  └─ poll 型 → refresh() → setInterval(intervalMs)
        refresh() 失败 → 指数退避重试 retries 次
                       → fallback 链：cache → demo（或你指定的其它 provider）
```

- **缓存**：成功帧写入 `localStorage`（`rainform.weather.cache.v1`），TTL 默认 6 小时；断网/失败时自动用缓存帧（状态显示「缓存 / 降级」）。
- **配置持久化**：`rainform.weather.config.v1`，含选中的源、地区、服务器、间隔、自动连接开关。
- **状态机**：`idle → connecting → live / stale / error / stopped`，事件 `status / frame / error / log / config`。
- **自动恢复**：`online` 事件与页面重新可见时，若超过间隔会立即刷新；SSE/WS 自带重连。
- **平滑过渡**：数据变化用 1.4 秒缓动插值，不会突跳。

---

## 4. 扩展点：注册全新的数据源（未来实时更新）

### 浏览器端（运行时，无需重新构建）

```js
// 轮询型：fetch(ctx) 返回任意 payload，RW 自动归一化
RainWeather.register('my-station', {
  label: '我的气象站', en: 'My station', kind: 'poll', group: 'custom',
  async fetch(ctx) {
    return await ctx.json('https://my.example/hourly?city=' + encodeURIComponent(ctx.cfg.city));
  }
});

// 推送型：subscribe(ctx, emit) 返回 dispose
RainWeather.register('my-stream', {
  label: '我的实时流', kind: 'push', group: 'push',
  subscribe(ctx, emit) {
    const s = new WebSocket('wss://my.example/stream');
    s.onmessage = e => emit(JSON.parse(e.data));   // 也可以 emit(new Error(...))
    return () => s.close();
  }
});

RainWeather.setProvider('my-stream');
RainWeather.configure({ autoStart: true });
RainWeather.start();
```

`ctx` 提供：`cfg / signal / http(url,opts) / json(url,opts) / now() / log() / locate() / geocode() / normalize() / maxMm`。
`http()` 自动选择 Electron 原生桥 → CapacitorHttp → 浏览器 fetch。

### 服务端（新增插件文件）

复制 `weather/server/providers/template.js`，实现 `fetch(query, ctx)`，重启后自动注册并出现在 `/api/providers`。

### 完全接管映射

```js
RainWeather.configure({
  transform(raw, ctx) {
    // 返回 number[25] / {values:[]} / 完整 WeatherFrame
    return raw.mystation.map(row => row.mm_per_hour);
  }
});
```

---

## 5. JS API 速查

| 方法 | 说明 |
| --- | --- |
| `RW.providers()` | 列出全部数据源元信息 |
| `RW.register(id, def)` | 注册/覆盖一个数据源 |
| `RW.configure(patch)` | 合并配置并持久化；运行中改 `provider`/`intervalMs` 会自动重启 |
| `RW.getConfig()` / `RW.getState()` | 当前配置 / 运行状态 |
| `RW.setProvider(id)` / `RW.start()` / `RW.stop()` / `RW.refresh()` | 选源与调度 |
| `RW.setValues(arr, meta)` | 直接把 25 个值推进雨景（最简单的脚本接入口） |
| `RW.import(jsonOrCsv)` | 手工导入 JSON/CSV |
| `RW.applyFrame(frame)` | 应用一个完整 WeatherFrame |
| `RW.normalize(raw, opts)` | 把任意 payload 归一成 WeatherFrame |
| `RW.geocode(city)` / `RW.geolocate()` | 城市名 → 经纬度 / 设备定位 |
| `RW.on(type, fn)` / `RW.off(type, fn)` | 订阅 `frame / status / error / log / config / *` |
| `RW.cache()` / `RW.clearCache()` | 读/清缓存帧 |
| `RW.useDemo()` | 断开实时源，恢复演示数据 |
| `RW.http(url, opts)` / `RW.json(url, opts)` | 走统一传输层发请求 |

另有 `window.Rainform.update(values25)`、`rotate()`、`setChart()`、`setSmooth()`、`setPanels()` 等雨景 API。

## 6. URL 参数

| 参数 | 示例 | 作用 |
| --- | --- | --- |
| `weather` | `openmeteo` / `server` / `crawler` / `sse` / `ws` / `custom` / `demo` | 预置数据源并自动连接 |
| `auto` | `1` / `0` | 启动自动连接 |
| `city` / `lat` / `lon` | `Shanghai` / `31.23` / `121.47` | 地区 |
| `server` | `https://your-domain` | 自建服务器地址 |
| `interval` | `5` | 轮询分钟数 |
| `valuePath` / `timePath` | `data.hourly.rain` | 自定义字段映射 |
| `token` / `apiKey` / `apiHost` | — | 凭据 |
| `panel` | `weather` | 启动后自动打开数据源面板 |

## 7. 合规与稳健性

- 默认数据源是**官方 API**（Open-Meteo），不是爬虫；爬虫接口只对自有/授权数据源开放，且默认遵守 `robots.txt`。
- 所有网络请求带超时、重试、指数退避、缓存与降级，任何一层挂掉都不会让雨景黑屏。
- API Key / Token 只存在本机 `localStorage`，不会写进日志或上传；`apiKey` 打包时不含真实值。
- 公网部署请全程 HTTPS（PWA 安装、Service Worker、设备定位、WebSocket 都要求安全上下文）。

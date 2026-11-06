# Rainform Weather Gateway

零依赖的参考服务端（只用 Node 内置模块），给网页 / 桌面 / 手机应用提供**多种可实时的数据接入方式**。
浏览器里的 `RainWeather` 数据层已经内置了对应适配器，配好地址即可切换。

## 启动

```bash
cd F:/Rainform-Ultimate
node weather/server/server.js --port 8787 --root app/pwa --verbose
# 完全离线演示（不访问外网，使用内置样本帧）
node weather/server/server.js --offline
# 带令牌
node weather/server/server.js --token my-secret
```

打开 <http://127.0.0.1:8787/> 就是 PWA 版网页；应用里把「服务器地址」填 `http://127.0.0.1:8787` 即可。

| 参数 | 默认 | 说明 |
| --- | --- | --- |
| `--port` | 8787 | HTTP / WS 端口 |
| `--root` | `app/pwa` | 静态站点根目录（也可指到 `app/desktop/www`） |
| `--token` | 空 | 非空时 `/api/*` 需要 `Authorization: Bearer <token>` |
| `--interval` | 30 | SSE / WebSocket 主动推送间隔（秒） |
| `--provider` | `open-meteo` | 默认上游数据插件 |
| `--offline` | false | 禁止外网，用 `sample-frame.json` |
| `--verbose` | false | 打印请求日志 |

## 接口一览

| 方法 | 路径 | 用途 | 浏览器适配器 |
| --- | --- | --- | --- |
| GET | `/api/health` | 健康检查、在线客户端、已注册插件 | — |
| GET | `/api/providers` | 服务端插件列表 | — |
| GET | `/api/weather?lat=&lon=&city=` | 归一化逐时降雨（REST 轮询） | `server` |
| GET | `/api/crawl?city=&url=&regex=&jsonPath=` | **地区天气爬取接口** | `crawler` |
| GET | `/api/stream` | Server-Sent Events 推送 | `sse` |
| GET | `/api/poll?since=<seq>` | 长轮询 | `custom` |
| WS | `/ws` | WebSocket 双向实时帧 | `ws` |
| POST | `/api/push` | 外部系统主动推入数据帧 | 任意 |
| GET | `/api/latest` | 最近一帧缓存 | — |
| GET / POST | `/api/config` | 运行时改间隔 / 上游插件 | — |

```bash
curl "http://127.0.0.1:8787/api/health"
curl "http://127.0.0.1:8787/api/weather?lat=31.23&lon=121.47&city=Shanghai"
curl "http://127.0.0.1:8787/api/crawl?city=Shanghai&lat=31.23&lon=121.47"
curl -N "http://127.0.0.1:8787/api/stream"
curl -X POST "http://127.0.0.1:8787/api/push" -H "Content-Type: application/json" \
  -d "{\"values\":[0,0,1,2,5,8,6,3,1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0],\"city\":\"My station\"}"
node weather/server/push-example.js
```

返回统一为 `RainWeather` 数据契约（详见 `docs/WEATHER-API.md`），核心字段：

```json
{
  "schema": "rainform.weather/1",
  "source": "open-meteo",
  "mode": "live",
  "location": {"name":"Shanghai","lat":31.23,"lon":121.47,"timezone":"Asia/Shanghai"},
  "observedAt": "2026-11-05T08:00:00+08:00",
  "fetchedAt":  "2026-11-05T08:00:00+08:00",
  "unit": "mm/h",
  "values": [0.1, 0, "... 共 25 个逐时值 00:00–24:00 ..."],
  "meta": {"gateway":"rainform-weather-gateway/1.0"}
}
```

## 地区天气爬取接口 `/api/crawl`

浏览器受 CORS 与合规限制，不适合直接抓第三方页面。这里把**爬取动作放到服务端**，浏览器端只保留一个可配置的接口，未来接任何数据源都不用改前端。

支持四种抽取方式（按优先级自动尝试）：

1. `jsonPath=data.hourly.rain`（可配 `timePath`）——最推荐，服务端返回结构化 JSON 时
2. `regex=(\d{1,2}):00[^0-9]*([\d.]+)`——自定义正则，捕获组 1=小时、2=雨强
3. 页面内嵌 `<script id="rainform-data" type="application/json">[...]</script>` 或整页 JSON
4. `data-hour="14" data-rain="1.2"` 属性、或含「14:00」的 HTML 表格行

```bash
# 官方 API（默认，合规、稳定）
curl "http://127.0.0.1:8787/api/crawl?city=Shanghai&lat=31.23&lon=121.47"

# 指向你自己有权限的地区气象页 / 内部系统
curl "http://127.0.0.1:8787/api/crawl?city=Shanghai&url=https://data.example.cn/hourly&jsonPath=data.hourly.rain&timePath=data.hourly.time"
```

> **合规说明**：本接口默认不内置任何第三方站点的抓取规则；默认走 Open-Meteo 官方 API。
> 会读取并遵守目标站 `robots.txt` 的 `Disallow`（自有内网系统可加 `respectRobots=0`），
> 限制 http/https、1 MB 响应体、12 秒超时。抓取第三方公开网站前请确认其服务条款、
> robots 协议与适用法律，并优先使用官方 API 或授权数据馈送。本项目仅供学习/自用。

## 新增数据源（未来实时更新）

**服务端**：复制 `providers/template.js` → `providers/my-station.js`，实现 `fetch(query, ctx)`，
重启即可自动注册。可接数据库、时序库、Kafka/MQTT 桥、厂商 API、自建爬虫。

**浏览器端**：无需改本服务端，直接在控制台注册新适配器即可：

```js
RainWeather.register('my-ws', {
  label: '我的气象站', kind: 'push',
  subscribe(ctx, emit) {
    const s = new WebSocket('wss://my.example/stream');
    s.onmessage = e => emit(JSON.parse(e.data));
    return () => s.close();
  }
});
RainWeather.setProvider('my-ws'); RainWeather.start();
```

## 部署到公网（让手机在外面也能实时）

1. 把本目录放到任意 Node 主机 / 云函数 / 容器（`Dockerfile` 可用 `node:22-alpine`，`CMD ["node","weather/server/server.js"]`）。
2. 用 Nginx / Caddy 反代并配置 HTTPS（浏览器定位、PWA、WebSocket 都要求安全上下文）。
3. 在应用的「服务器地址」里填 `https://your-domain`，或发布时通过 `?weather=server&server=https://your-domain&auto=1` 预置。
4. 需要鉴权时设置 `--token` 并在应用「访问令牌」里填同一个值（或 `extraHeaders`）。

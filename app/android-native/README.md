# Rainform Ultimate — 离线安卓 APK 工程

零第三方依赖的原生 WebView 壳。与网页版共用同一份 `Rainform-Ultimate-standalone.html`，
不需要 Gradle、AndroidX、Capacitor，也不需要联网下载任何依赖。

## 构建

```bash
cd F:/Rainform-Ultimate
node app/android-native/build-apk.js
```

产物：`dist/Rainform-Ultimate-v1.0.0.apk`（已 v1/v2/v3 签名，可直接 `adb install -r` 或传到手机安装）。

依赖（本机已具备）：

| 组件 | 路径 / 环境变量 |
| --- | --- |
| JDK 22 | `JAVA_HOME` 或 `C:/Program Files/Java/jdk-22` |
| Android SDK | `ANDROID_HOME` 或 `F:/Android/Sdk` |
| android.jar | `platforms/android-34/android.jar` |
| aapt2 / zipalign / apksigner | `build-tools/34.0.0` |
| d8 (R8) | `build-tools/37.0.0/lib/d8.jar` |
| Python 3 | 合并 `classes.dex` 用 |

> 为什么 d8 用 37：build-tools 34 自带的 R8 8.2 解析 javac 22 生成的
> `MethodParameters` 属性（参数名为 null）会抛 NPE。37 版无此问题，同时
> javac 加了 `-parameters` 双保险。

## 目录

```
AndroidManifest.xml          包名 cn.rainform.ultimate，minSdk 23 / targetSdk 34
src/cn/rainform/ultimate/
  MainActivity.java          WebView 配置、全屏、返回键、按需定位权限、外部链接
  AssetServer.java           仅绑定 127.0.0.1 的极简静态服务器（避免 file:// 限制）
  NativeBridge.java          window.RainNative.fetch 原生 HTTP 桥（免 CORS）
bridge.js                    注入 <head> 的 JS 桥 + WebGL 能力探测 / 兼容降级
res/                         主题、字符串、明文流量策略、五档图标（构建时复制）
merge.py                     把 classes.dex 合入 aapt2 产出的 base.apk
build-apk.js                 全流程一键构建与校验
rainform-release.jks         自签名证书（自动生成，务必保留以便后续覆盖安装）
```

## 运行时结构

```
MainActivity
  └─ WebView  →  http://127.0.0.1:<随机端口>/index.html
       ├─ assets/index.html      = standalone HTML + <head> 注入 bridge.js
       ├─ window.RainNative      → Java HttpURLConnection（REST / 爬取 / 自定义接口）
       └─ EventSource/WebSocket → 浏览器栈（普通 http origin，可直连网关）
```

- 用 loopback HTTP 而不是 `file://`，是为了让 `localStorage`、SSE、WebSocket、
  Service Worker、WebAudio 与浏览器行为一致；端口只绑定 127.0.0.1，不对外暴露。
- 天气网关在电脑上时需监听 `0.0.0.0` 并填局域网 IP；详见 `docs/APPS.md` 第 8 节。
- 若设备 WebView 既无 WebGL2 也无 `ANGLE_instanced_arrays`，会显示升级提示，
  并保留「打开实时天气设置」入口；不会卡在加载或 ANR。
- CSS 中所有 `inset: 0` 已改为显式四边定位，兼容 Chrome ≤ 86 的 Android WebView。

## 验证

```bash
adb install -r dist/Rainform-Ultimate-v1.0.0.apk
adb shell monkey -p cn.rainform.ultimate -c android.intent.category.LAUNCHER 1
```

WebView 调试已开启，可用 `adb forward tcp:9229 localabstract:webview_devtools_remote_<pid>`
后访问 `http://127.0.0.1:9229/json` 连接 CDP。完整自检结果见 `docs/APPS.md` 第 8.6 节。

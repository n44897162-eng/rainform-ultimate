# Rainform Ultimate · Android / iOS 原生应用（Capacitor）

同一份 `www/index.html`（单文件、零外部引用）被装进原生 WebView；`native-bridge.js` 会由 `build-apps.js` 内联注入，负责原生定位、状态栏、启动屏、Android 返回键与网络恢复重连。

> 在 Windows 上可以完成：`npm install`、`cap add android`、生成全部工程与图标、Gradle 构建（若已装 Android SDK）。
> **iOS 的编译/签名/上架必须在 macOS + Xcode 上完成**（Apple 工具链限制）；但 `cap add ios` 的工程、`Info.plist` 与图标配置已由脚本准备好，拿到 Mac 上直接打开即可。

## 一次性准备

```bash
cd F:/Rainform-Ultimate
node build-apps.js              # 生成 www/ 与全部图标
cd app/mobile
npm install
```

## Android

```bash
npm run add:android             # cap add android + 自动打补丁（权限/图标/明文策略）
npm run open:android            # Android Studio，连真机或模拟器后 Run
# 或命令行（需 Android SDK + JAVA_HOME）
npm run run:android
```

发布包：Android Studio → `Build > Generate Signed Bundle / APK` → Android App Bundle (`.aab`)，上传 Google Play / 国内应用商店。

补丁脚本 `scripts/patch-android.js` 做了三件事：
1. 加 `INTERNET / ACCESS_NETWORK_STATE / COARSE+FINE_LOCATION` 权限
2. 写 `network_security_config.xml`：**仅** `127.0.0.1` / `10.0.2.2` / `localhost` 允许明文 HTTP，公网强制 HTTPS
3. 把生成的 48/72/96/144/192 px 图标装进 `mipmap-*` 目录

模拟器访问宿主机上的网关用 `http://10.0.2.2:8787`；真机用电脑的局域网 IP（如 `http://192.168.1.10:8787`），并把该域名加进上面的白名单，或直接用 HTTPS 公网地址。

## iOS（需 macOS + Xcode）

```bash
npm run add:ios                 # cap add ios + Info.plist / AppIcon 补丁
npm run open:ios                # Xcode → 选 Team 签名 → Run / Archive
# 或命令行
npm run run:ios
```

补丁脚本 `scripts/patch-ios.js`：加定位用途说明、允许本地网络明文（公网仍强制 TLS）、状态栏浅色、安装 1024×1024 通用图标。

App Store 上架：Xcode → Product → Archive → Distribute App；`appId` 为 `cn.rainform.ultimate`。

## 不装原生应用也能用（推荐先用这个）

- **Android Chrome / Edge**：打开 PWA 地址 → 菜单「安装应用 / 添加到主屏幕」，得到全屏独立窗口
- **iPhone Safari**：打开 PWA 地址 → 分享 → 「添加到主屏幕」，支持全屏、安全区、离线缓存
- 详见 `docs/APPS.md`

## 实时天气

1. 开发期：在电脑上运行 `node weather/server/server.js`，应用「服务器地址」填局域网地址
2. 上线：把网关部署到 HTTPS 域名，发布时预置
   `?weather=server&server=https://your-domain&auto=1`
3. 原生端默认走 CapacitorHttp / Electron 原生桥，不受浏览器 CORS 限制

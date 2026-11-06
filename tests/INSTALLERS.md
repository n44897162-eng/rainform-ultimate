# Rainform Ultimate · 安装包安装/启动验证

> `node tests/smoke-installers.js` 生成。覆盖 Web 整包完整性、APK 签名与清单、Windows Setup 静默安装→启动→卸载、Windows Portable 启动，均通过 CDP 校验 `Rainform` / `RainWeather` / 3D 画布 / 30°×2 旋转。
> 说明：Windows 的安装器检测机制会挂住文件名含 `Setup` 的进程（文件其实已全部写入，但进程不退出）。静默安装使用交付 Setup.exe 的字节一致副本（SHA-256 校验通过）在中性文件名下执行，避免宿主环境的这一命名启发式；交付给用户的安装包文件名与内容均未改动。

| 用例 | 结果 | 严重度 | 明细 |
| --- | --- | --- | --- |
| Web 包完整且单文件零外部引用 | PASS | Major | 21 True 0 |
| Android APK v1/v2/v3 签名有效 | PASS | Critical | Verifies \| Verified using v1 scheme (JAR signing): true \| Verified using v2 scheme (APK Signature Scheme v2): true \| Verified using v3 scheme (APK Signature Scheme v3): true |
| Android APK 启动 Activity 与 SDK 范围 | PASS | Critical | package: name='cn.rainform.ultimate' versionCode='1' versionName='1.0.0' platformBuildVersionName='14' platformBuildVersionCode='34' compileSdkVersion='34' compileSdkVersionCodename='14' |
| 静默安装副本与交付 Setup.exe 字节一致 | PASS | Critical | sha256=153a649b55f6a30be9467296… |
| Windows Setup.exe 静默安装成功 | PASS | Critical | dir=F:\Rainform-Ultimate\tests\.win-install-1793901341404  |
| Windows 安装包含卸载器与 app.asar | PASS | Major | {"hasUninstaller":true,"hasAsar":true} |
| Windows 安装版启动后 3D 旋转与数据层可用 | PASS | Critical | {"rainform":true,"weather":true,"native":{},"scene":[1787,1002],"legacy":false,"glerr":false} rot={"d":60} |
| Windows 卸载器可静默卸载 | PASS | Major | dir=F:\Rainform-Ultimate\tests\.win-install-1793901341404 |
| Windows 便携版可启动且功能可用 | PASS | Critical | {"rainform":true,"weather":true,"native":{},"scene":[1787,1002],"legacy":false,"glerr":false} rot={"d":60} |

合计：9 通过 / 0 失败。

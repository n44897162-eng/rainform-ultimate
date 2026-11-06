# 旧 WebView 等效渲染后端（Legacy 2D Backend）

## 为什么存在

Android 原生壳运行在系统 **Android System WebView** 上。极老的设备（Chrome ≤ 86）或部分软件 GPU 环境（如无硬件加速的 x86 模拟器）只提供 WebGL1，甚至缺少 `ANGLE_instanced_arrays`。本项目主渲染器用 WebGL2 + GPU 实例化绘制数万条雨丝，在这类环境里会让主线程长时间阻塞、触发 ANR。

早期版本的做法是「显示升级提示 + 只保留天气面板」。**这属于功能削减，不满足三端功能一致的要求**。因此改为渲染后端替换：

> 检测不到 WebGL2 且无实例化扩展时，`app.js` 让出渲染权，`app/android-native/legacy2d.js` 用 Canvas 2D + 弱透视投影绘制同一个场景，并实现完整的 `window.Rainform` 契约。

**关键：这是渲染实现替换，不是功能裁剪。**

## 触发条件与影响范围

| 项 | 内容 |
| --- | --- |
| 触发 | `bridge.js` 在 `<head>` 同步探测：`!canvas.getContext('webgl2') && !gl1.getExtension('ANGLE_instanced_arrays')` → 置 `__RAINFORM_NO_WEBGL__` |
| 生效范围 | **仅 Android APK**（`legacy2d.js` 只由 `app/android-native/build-apk.js` 注入） |
| 不触发 | 网页端、Windows PC 端、所有支持 WebGL2 的安卓真机 —— 一律走完整 WebGL2 3D 渲染 |
| 标志 | `window.__RAINFORM_LEGACY__ === 'canvas2d-v1'`，可在控制台确认当前后端 |

## 保留的能力（逐项）

| 功能 | Legacy 2D 实现 |
| --- | --- |
| **3D 旋转** | 绕 Y 轴旋转 + 倾斜的弱透视投影 `project(x,y,z)`；`rotate(30)` 步进、拖拽轨道、复位、自动旋转、角度读数全部保留 |
| 雨景 | 按降雨强度分布的分级雨丝（头亮尾渐隐）、落地方向、距离雾、水面光池 |
| 落地水花 | 冠冕轮廓、弹道飞溅珠（数量随雨滴尺寸变化）、大滴 Worthington 射流、双层解析涟漪；`impactStats` 持续统计 |
| 数据可视化 | 25 根渐变数据柱、发光折线、数据点、地面坐标轴、当前小时游标 |
| 图表开关 | `setChart()` / 按钮 / 胶囊 / `C` 键，同步隐藏曲线编辑器 |
| 平滑拟合 | Catmull-Rom 样条、拟合度 0–100%、`S` 键，作用于柱高、折线与曲线编辑器 |
| 播放 / 时间轴 | 播放暂停、速度档位、时间游标、`setTime()`、时间轴点击定位 |
| 画质 | 四档（雨丝数 110 / 220 / 360 / 520，DPR 联动） |
| 预设 | 四种预设 + 随机数据、复位示例数据 |
| 音频 | 复用 `RainAudio.mix(mmh)` 的雨量映射 |
| 实时天气 | `RainWeather` 完全独立运行；监听 `frame` 事件把 25 点数据喂给渲染器，11 种数据源 / 降级 / 缓存全部可用 |
| UI | 中英双语、面板收起展开、壁纸模式、截图导出、声音开关、toast、天气抽屉 |
| 截图 | `Rainform.snapshot()` 导出当前 Canvas 为 PNG |

`window.Rainform` 暴露的 `update / rotate / setQuality / setChart / setSmooth / setPanels / setTime / audioMix / impactStats / snapshot / state` 与 WebGL 版本**同签名**，因此 `tests/contract.js` 一套用例可以逐字在三端复用。

## 与 WebGL2 的已知差异（如实披露）

| 维度 | WebGL2（默认） | Canvas 2D（旧 WebView） |
| --- | --- | --- |
| 雨丝规模 | 900–5200 条 GPU 实例 | 110–520 条 CPU 绘制 |
| 后处理 | Bloom、ACES tone mapping、暗角、色差、颗粒 | 无（用渐变与 alpha 模拟层次） |
| 水面 | 程序化 fbm 积水、反射光池 | 径向渐变光池 + 水平雾线 |
| 水花 | 车削冠膜 shader + 二次液滴 GL points | 2D 冠形路径 + 弹道珠 + 射流 |
| 视觉保真度 | 完整 | 降低，但构图、动势、尺寸分级、旋转语义一致 |
| 功能项 | 全部 | **全部** |

若需要完整画质，把 Android System WebView / Chrome 更新到支持 WebGL2 的版本即可自动切回主渲染器，无需重装应用。

## 验证

- `tests/run.js --platform=android` 在 Android 11 / API 30 软件 GPU 模拟器上执行与网页端、Windows 端**完全相同**的契约用例，包含 `B 3D 旋转` 全组（30°×2、拖拽、复位、旋转前后画面差异）与 `A10 画面非空白`。
- `tests/evidence/Z-android-final.png` 为该后端下的最终画面证据。
- 网页端与 Windows 端运行时 `window.__RAINFORM_LEGACY__` 应为 `undefined`，可用作回归断言。

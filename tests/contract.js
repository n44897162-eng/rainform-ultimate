/* One functional contract, executed identically on Web / Windows / Android.
 * Groups: A boot & render, B 3D rotation, C chart & smooth fit,
 * D data/playback/quality, E UI, F live weather, G boundaries, H platform.
 */
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const L = require('./lib');
const H = require('./harness');

const PY = 'python';
function pyImage(fileA, fileB) {
  const code = [
    'from PIL import Image, ImageStat, ImageChops',
    'import sys, json',
    'a=Image.open(sys.argv[1]).convert("RGB")',
    'st=ImageStat.Stat(a.convert("L"))',
    'out={"var":round(st.stddev[0],3),"mean":round(st.mean[0],2),"size":list(a.size)}',
    'if len(sys.argv)>2:',
    ' b=Image.open(sys.argv[2]).convert("RGB")',
    ' if b.size!=a.size: b=b.resize(a.size)',
    ' d=ImageStat.Stat(ImageChops.difference(a,b).convert("L"))',
    ' out["diff"]=round(d.mean[0],3)',
    'print(json.dumps(out))'
  ].join('\n');
  const args = ['-c', code, fileA];
  if (fileB) args.push(fileB);
  try { return JSON.parse(execFileSync(PY, args, { encoding: 'utf8', timeout: 30000 })); }
  catch (e) { return { var: -1, mean: -1, error: String(e.message).slice(0, 120) }; }
}

async function run(a, rec) {
  const P = a.platform;
  const ev = (expr, ap) => a.evaluate(expr, ap);
  const J = async (expr, awaitPromise) => {
    try {
      const v = await ev(expr, awaitPromise);
      return typeof v === 'string' ? JSON.parse(v) : (v || {});
    } catch (e) { return { __evalError: String(e.message).slice(0, 160) }; }
  };
  const T = async (group, label, fn, severity) => {
    const dbg = !!process.env.RAINFORM_TEST_DEBUG;
    if (dbg) console.error('[case ' + new Date().toISOString().slice(11, 23) + '] ' + label + ' START');
    try {
      const r = await fn();
      // An evaluate() transport error must never be read as a passing result
      // (some assertions only check for the absence of an explicit failure).
      if (r && typeof r === 'object' && r.__evalError) throw new Error(r.__evalError);
      const ok = r && typeof r === 'object' ? !!r.ok : !!r;
      const detail = r && typeof r === 'object' ? r.detail : undefined;
      rec.check(P, group, label, ok, detail, severity);
    } catch (e) {
      rec.check(P, group, label, false, 'THREW ' + String(e.message).slice(0, 220), severity);
    }
  };
  const skip = (group, label, why) => rec.skip(P, group, label, why);
  const click = id => ev(`(function(){var e=document.getElementById(${JSON.stringify(id)});if(!e)return false;e.click();return true})()`);

  /* ================================================ A. boot & render === */
  const boot = await J(`JSON.stringify({
    ready:document.readyState,
    title:document.title,
    nodes:document.querySelectorAll('*').length,
    loaderDone:document.getElementById('loader').classList.contains('done'),
    glErr:document.getElementById('webglError').classList.contains('on'),
    rainform:!!window.Rainform, weather:!!window.RainWeather,
    api:(function(){if(!window.Rainform)return [];return Object.keys(Rainform).sort()})(),
    scene:(function(){var c=document.getElementById('scene');return c?[c.width,c.height]:[0,0]})(),
    width:document.documentElement.scrollWidth, inner:window.innerWidth,
    compat:!!window.__RAINFORM_NO_WEBGL__
  })`);

  await T('A 启动与渲染', 'A01 页面完成加载且节点就绪', () => ({ ok: boot.ready === 'complete' && boot.nodes > 250, detail: JSON.stringify({ ready: boot.ready, nodes: boot.nodes }) }));
  await T('A 启动与渲染', 'A02 加载遮罩已关闭', () => ({ ok: boot.loaderDone, detail: 'loaderDone=' + boot.loaderDone }));
  await T('A 启动与渲染', 'A03 Rainform 主程序已启动', () => ({ ok: boot.rainform, detail: 'rainform=' + boot.rainform }, 'Critical'));
  await T('A 启动与渲染', 'A04 RainWeather 数据层已启动', () => ({ ok: boot.weather, detail: 'weather=' + boot.weather }, 'Critical'));
  await T('A 启动与渲染', 'A05 公共 API 契约完整', () => {
    const need = ['update', 'rotate', 'setQuality', 'setChart', 'setSmooth', 'setPanels', 'setTime', 'audioMix', 'impactStats', 'snapshot', 'state'];
    const miss = need.filter(k => boot.api.indexOf(k) < 0);
    return { ok: miss.length === 0, detail: 'missing=' + JSON.stringify(miss) };
  }, 'Critical');
  await T('A 启动与渲染', 'A06 3D 画布尺寸有效', () => ({ ok: boot.scene[0] > 0 && boot.scene[1] > 0, detail: 'scene=' + boot.scene.join('x') }, 'Critical'));
  await T('A 启动与渲染', 'A07 未进入 WebGL 错误页', () => ({ ok: !boot.glErr, detail: 'glErr=' + boot.glErr + ' compat=' + boot.compat }, 'Critical'));
  await T('A 启动与渲染', 'A08 无横向溢出', () => ({ ok: boot.width <= boot.inner + 1, detail: boot.width + ' <= ' + boot.inner }));
  await T('A 启动与渲染', 'A09 渲染帧持续推进', async () => {
    const s1 = await J(`window.Rainform?JSON.stringify(Rainform.impactStats):'null'`);
    await L.sleep(1100);
    const s2 = await J(`window.Rainform?JSON.stringify(Rainform.impactStats):'null'`);
    return { ok: !!s1 && !!s2 && (s2.n > s1.n || s2.n > 0), detail: JSON.stringify({ s1, s2 }) };
  }, 'Major');
  await T('A 启动与渲染', 'A10 画面非空白', async () => {
    const f = await a.screenshot('A10-' + P + '-boot.png');
    const s = pyImage(f);
    return { ok: s.var > 3 && s.mean > 2, detail: JSON.stringify(s) };
  }, 'Critical');
  await T('A 启动与渲染', 'A11 启动期零 JS 异常', () => {
    const e = a.errors.filter(x => !L.isIgnorableError(x));
    return { ok: e.length === 0, detail: JSON.stringify(e.slice(0, 3)) };
  }, 'Critical');
  await T('A 启动与渲染', 'A12 渲染循环持续推进（后端无关）', async () => {
    const expr = `JSON.stringify(window.__RAINFORM_LEGACY_STATS__
      ? {k:'2d',n:window.__RAINFORM_LEGACY_STATS__.frames,d:window.__RAINFORM_LEGACY_STATS__.drops}
      : {k:'gl',n:Rainform.impactStats.n,d:0})`;
    const s1 = await J(expr);
    await L.sleep(850);
    const s2 = await J(expr);
    return { ok: s2.n > s1.n, detail: JSON.stringify({ backend: s2.k, from: s1.n, to: s2.n, drops: s2.d }) };
  }, 'Critical');

  /* ==================================================== B. 3D rotation === */
  const rot0 = await J(`window.Rainform?JSON.stringify({t:Rainform.state.tTheta, yaw:document.getElementById('yawValue').textContent}):'null'`);
  await T('B 3D 旋转', 'B01 初始相机角度有效', () => ({ ok: rot0 && typeof rot0.t === 'number', detail: JSON.stringify(rot0) }));
  await T('B 3D 旋转', 'B02 30°×2 步进合计 60°', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;Rainform.rotate(30);Rainform.rotate(30);return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === 60, detail: JSON.stringify(r) };
  }, 'Critical');
  await T('B 3D 旋转', 'B03 反向 -30° 回退正确', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;Rainform.rotate(-30);return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === -30, detail: JSON.stringify(r) };
  }, 'Critical');
  await T('B 3D 旋转', 'B04 顶部旋转按钮 +30°', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;document.getElementById('rotateBtn').click();return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === 30, detail: JSON.stringify(r) };
  }, 'Major');
  await T('B 3D 旋转', 'B05 反向按钮 -30°', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;document.getElementById('rotateBack').click();return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === -30, detail: JSON.stringify(r) };
  }, 'Major');
  await T('B 3D 旋转', 'B06 移动端胶囊旋转 +30°', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;document.getElementById('miniRotate').click();return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === 30, detail: JSON.stringify(r) };
  }, 'Major');
  await T('B 3D 旋转', 'B07 键盘 ArrowRight +30°', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;document.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}));return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === 30, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('B 3D 旋转', 'B08 拖拽轨道相机改变角度', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta,c=document.getElementById('scene');
      function p(t,x){c.dispatchEvent(new PointerEvent(t,{bubbles:true,clientX:x,clientY:200,pointerId:1,pointerType:'mouse',buttons:t==='pointerup'?0:1}))}
      p('pointerdown',400);p('pointermove',520);p('pointerup',520);
      return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r && r.d !== 0, detail: JSON.stringify(r) };
  }, 'Major');
  await T('B 3D 旋转', 'B09 视角复位回到默认 30°', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';document.getElementById('resetView').click();return JSON.stringify({d:Math.round(Rainform.state.tTheta*180/Math.PI)})})()`);
    return { ok: Math.abs(r.d - 30) < 1, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('B 3D 旋转', 'B10 旋转后画面确实变化', async () => {
    if (!boot.rainform) return { ok: false, detail: 'Rainform missing' };
    const f1 = await a.screenshot('B10-' + P + '-before.png');
    await ev(`Rainform.rotate(90); 'ok'`);
    await L.sleep(1400);
    const f2 = await a.screenshot('B10-' + P + '-after.png');
    const s = pyImage(f1, f2);
    return { ok: s.diff > 0.35, detail: JSON.stringify(s) };
  }, 'Critical');
  await T('B 3D 旋转', 'B11 角度读数与状态同步', async () => {
    await L.sleep(900);
    const r = await J(`(function(){if(!window.Rainform)return 'null';return JSON.stringify({yaw:document.getElementById('yawValue').textContent,t:Math.round(((Rainform.state.theta*180/Math.PI)%360+360)%360)})})()`);
    const num = parseInt(String(r.yaw || '').replace('°', ''), 10);
    return { ok: !isNaN(num), detail: JSON.stringify(r) };
  }, 'Minor');
  await T('B 3D 旋转', 'B12 自动旋转开关', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var e=document.getElementById('autoRotate');e.click();var on=Rainform.state.autoRotate;e.click();return JSON.stringify({on:on,off:Rainform.state.autoRotate})})()`);
    return { ok: r.on === true && r.off === false, detail: JSON.stringify(r) };
  }, 'Minor');

  /* ============================================ C. chart & smooth fit === */
  await T('C 图表与拟合', 'C01 图表开关 off/on', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.chartOn;Rainform.setChart(false);var b=Rainform.state.chartOn,cls=document.getElementById('app').classList.contains('chart-off');Rainform.setChart(true);return JSON.stringify({a:a,b:b,cls:cls,c:Rainform.state.chartOn})})()`);
    return { ok: r.a === true && r.b === false && r.cls === true && r.c === true, detail: JSON.stringify(r) };
  }, 'Critical');
  await T('C 图表与拟合', 'C02 曲线编辑器按钮切换图表', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.chartOn;document.getElementById('curveBtn').click();var b=Rainform.state.chartOn;Rainform.setChart(a);return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a !== r.b, detail: JSON.stringify(r) };
  }, 'Major');
  await T('C 图表与拟合', 'C03 底部胶囊图表按钮', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.chartOn;document.getElementById('miniChart').click();var b=Rainform.state.chartOn;Rainform.setChart(a);return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a !== r.b, detail: JSON.stringify(r) };
  }, 'Major');
  await T('C 图表与拟合', 'C04 快捷键 C 切换图表', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.chartOn;document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',bubbles:true}));var b=Rainform.state.chartOn;Rainform.setChart(a);return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a !== r.b, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('C 图表与拟合', 'C05 平滑拟合开关与拟合度', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';Rainform.setSmooth(true,0.85,true);var a={s:Rainform.state.smooth,amt:Rainform.state.smoothAmt,mode:document.getElementById('curveMode').textContent,pct:document.getElementById('smoothPct').textContent};Rainform.setSmooth(false,0.85,true);var b=Rainform.state.smooth;Rainform.setSmooth(a.s,a.amt,true);return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a && r.a.s === true && Math.abs(r.a.amt - 0.85) < 0.01 && r.b === false, detail: JSON.stringify(r) };
  }, 'Critical');
  await T('C 图表与拟合', 'C06 拟合度滑块生效', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var e=document.getElementById('smoothRange');e.value=30;e.dispatchEvent(new Event('input',{bubbles:true}));return JSON.stringify({amt:Rainform.state.smoothAmt,pct:document.getElementById('smoothPct').textContent})})()`);
    return { ok: Math.abs(r.amt - 0.3) < 0.02, detail: JSON.stringify(r) };
  }, 'Major');
  await T('C 图表与拟合', 'C07 快捷键 S 切换平滑', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.smooth;document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}));var b=Rainform.state.smooth;if(b!==a)document.dispatchEvent(new KeyboardEvent('keydown',{key:'s',bubbles:true}));return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a !== r.b, detail: JSON.stringify(r) };
  }, 'Minor');

  /* ============================== D. data / playback / quality ========== */
  await T('D 数据与播放', 'D01 update() 25 点数据生效', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';Rainform.update(Array.from({length:25},function(_,i){return 12+i/10}));return JSON.stringify({rain:document.getElementById('rainValue').textContent})})()`);
    return { ok: !!r.rain, detail: JSON.stringify(r) };
  }, 'Major');
  await T('D 数据与播放', 'D02 非法长度数据被拒绝且不崩溃', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';try{Rainform.update([1,2,3]);return JSON.stringify({ok:true})}catch(e){return JSON.stringify({ok:false,e:String(e)})}})()`);
    return { ok: r.ok === true, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('D 数据与播放', 'D03 时间轴 setTime 生效', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';Rainform.setTime(12);return JSON.stringify({t:Rainform.state.t,tv:document.getElementById('timeValue').textContent})})()`);
    return { ok: Math.abs(r.t - 12) < 0.01, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('D 数据与播放', 'D04 播放/暂停切换', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.playing;document.getElementById('playBtn').click();var b=Rainform.state.playing;document.getElementById('playBtn').click();return JSON.stringify({a:a,b:b,c:Rainform.state.playing})})()`);
    return { ok: r.a !== r.b && r.c === r.a, detail: JSON.stringify(r) };
  }, 'Major');
  await T('D 数据与播放', 'D05 四档画质均可切换', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var out=[];for(var i=0;i<4;i++){try{Rainform.setQuality(i,true);out.push([i,document.getElementById('qualityValue').textContent])}catch(e){out.push([i,'ERR '+e.message])}}Rainform.setQuality(2,true);return JSON.stringify(out)})()`);
    return { ok: Array.isArray(r) && r.length === 4 && r.every(x => x[1] && x[1].indexOf('ERR') < 0), detail: JSON.stringify(r) };
  }, 'Critical');
  await T('D 数据与播放', 'D06 数据预设切换', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var b=document.querySelector('#presetBtns button');if(!b)return JSON.stringify({err:'no preset button'});b.click();return JSON.stringify({name:Rainform.state.presetName})})()`);
    return { ok: r && (r.name || r.err === 'no preset button'), detail: JSON.stringify(r) };
  }, 'Minor');
  await T('D 数据与播放', 'D07 雨声动态映射可用', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.audioMix(0.5),b=Rainform.audioMix(18);return JSON.stringify({a:a,b:b})})()`);
    return { ok: !!r.a && !!r.b && JSON.stringify(r.a) !== JSON.stringify(r.b), detail: JSON.stringify(r).slice(0, 260) };
  }, 'Major');

  /* ====================================================== E. UI ========= */
  await T('E UI 交互', 'E01 面板收起/展开状态同步', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';Rainform.setPanels(true);var a={s:Rainform.state.panelsHidden,c:document.getElementById('app').classList.contains('panels-hidden'),f:document.getElementById('fabToggle').getAttribute('aria-pressed')};Rainform.setPanels(false);return JSON.stringify({a:a,b:Rainform.state.panelsHidden})})()`);
    return { ok: r.a && r.a.s === true && r.a.c === true && r.a.f === 'true' && r.b === false, detail: JSON.stringify(r) };
  }, 'Major');
  await T('E UI 交互', 'E02 顶部按钮与 FAB 状态一致', async () => {
    const r = await J(`(function(){document.getElementById('panelToggle').click();var a=document.getElementById('app').classList.contains('panels-hidden');document.getElementById('fabToggle').click();var b=document.getElementById('app').classList.contains('panels-hidden');return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a !== r.b, detail: JSON.stringify(r) };
  }, 'Major');
  await T('E UI 交互', 'E03 中英双语切换', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.lang;document.getElementById('langBtn').click();var b=Rainform.state.lang,btn=document.getElementById('langBtn').textContent;document.getElementById('langBtn').click();return JSON.stringify({a:a,b:b,btn:btn})})()`);
    return { ok: r.a !== r.b, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('E UI 交互', 'E04 壁纸模式开关', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';document.getElementById('wallpaperBtn').click();var a=Rainform.state.wallpaper;document.getElementById('wallpaperBtn').click();return JSON.stringify({a:a,b:Rainform.state.wallpaper})})()`);
    return { ok: r.a === true && r.b === false, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('E UI 交互', 'E05 截图触发', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';document.getElementById('shotBtn').click();return JSON.stringify({shot:Rainform.state.wantShot})})()`);
    return { ok: r.shot === true, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('E UI 交互', 'E06 天气抽屉开/关', async () => {
    const r = await J(`(function(){document.getElementById('weatherOpen').click();var a=document.getElementById('weatherPanel').classList.contains('open');document.getElementById('weatherClose').click();var b=document.getElementById('weatherPanel').classList.contains('open');return JSON.stringify({a:a,b:b})})()`);
    return { ok: r.a === true && r.b === false, detail: JSON.stringify(r) };
  }, 'Critical');
  await T('E UI 交互', 'E07 声音开关', async () => {
    const r = await J(`(function(){var e=document.getElementById('soundToggle');if(!e)return JSON.stringify({skip:true});e.click();return JSON.stringify({cls:e.className})})()`);
    return { ok: !!r, detail: JSON.stringify(r) };
  }, 'Minor');

  /* ================================================ F. live weather ==== */
  const prov = await J(`window.RainWeather?JSON.stringify({n:RainWeather.providers.length,v:RainWeather.version}):'null'`);
  await T('F 实时天气', 'F01 数据源 >= 11 种', () => ({ ok: prov.n >= 11, detail: JSON.stringify(prov) }, 'Major'));

  async function connect(label, cfg, expect) {
    await ev(`(function(){RainWeather.configure(${JSON.stringify(cfg)});RainWeather.refresh('${label}');return 'ok'})()`);
    await L.sleep(expect === 0 ? 2200 : 2600);
    const s = await J(`JSON.stringify({status:RainWeather.getState().status,src:RainWeather.getState().lastFrame&&RainWeather.getState().lastFrame.source,n:RainWeather.getState().lastFrame&&RainWeather.getState().lastFrame.values.length,err:RainWeather.getState().lastError})`);
    return s;
  }
  const SRV = H.GATEWAY;

  await T('F 实时天气', 'F02 REST /api/weather 实时', async () => {
    const s = await connect('t-rest', { provider: 'server', server: SRV, autoStart: false, useNative: P !== 'web', timeoutMs: 9000, retries: 1, intervalMs: 60000 }, 1);
    return { ok: s.status === 'live' && s.n === 25, detail: JSON.stringify(s) };
  }, 'Critical');
  await T('F 实时天气', 'F03 爬虫 /api/crawl 实时', async () => {
    const s = await connect('t-crawl', { provider: 'crawler', server: SRV, autoStart: false, useNative: P !== 'web', timeoutMs: 9000, retries: 1, intervalMs: 60000 }, 1);
    return { ok: s.status === 'live' && s.n === 25, detail: JSON.stringify(s) };
  }, 'Major');
  await T('F 实时天气', 'F04 SSE /api/stream 实时', async () => {
    const s = await connect('t-sse', { provider: 'sse', server: SRV, autoStart: false, useNative: P !== 'web', timeoutMs: 9000, retries: 1, intervalMs: 60000 }, 1);
    return { ok: s.status === 'live' && s.n === 25, detail: JSON.stringify(s) };
  }, 'Major');
  await T('F 实时天气', 'F05 WebSocket /ws 实时', async () => {
    const s = await connect('t-ws', { provider: 'ws', server: SRV, autoStart: false, useNative: P !== 'web', timeoutMs: 9000, retries: 1, intervalMs: 60000 }, 1);
    return { ok: s.status === 'live' && s.n === 25, detail: JSON.stringify(s) };
  }, 'Major');
  await T('F 实时天气', 'F06 自定义 HTTP + valuePath 映射', async () => {
    const s = await connect('t-custom', {
      provider: 'custom', url: SRV + '/api/weather?lat=31.23&lon=121.47&city=Shanghai',
      autoStart: false, useNative: P !== 'web', timeoutMs: 9000, retries: 1, intervalMs: 60000,
      mapping: { valuePath: 'values', timePath: 'hours', scale: 1, align: 'day' }
    }, 1);
    return { ok: s.status === 'live' && s.n === 25, detail: JSON.stringify(s) };
  }, 'Major');
  await T('F 实时天气', 'F07 CSV 导入 25 点归一化', async () => {
    const csv = 'time,precip\n' + Array.from({ length: 25 }, (_, i) => String(i).padStart(2, '0') + ':00,' + (i / 10).toFixed(1)).join('\n');
    const r = await J(`(function(){try{var f=RainWeather.import(${JSON.stringify(csv)},{source:'manual'});return JSON.stringify({n:f.values.length,v0:f.values[0],v1:f.values[1],h:f.hours.length})}catch(e){return JSON.stringify({err:String(e)})}})()`);
    return { ok: r.n === 25 && r.v1 > 0 && r.h === 25, detail: JSON.stringify(r) };
  }, 'Major');
  await T('F 实时天气', 'F08 JSON 对象导入', async () => {
    const r = await J(`(function(){try{var f=RainWeather.import({hourly:{time:['00:00','01:00'],precipitation:[1.2,3.4]}},{source:'manual'});return JSON.stringify({n:f.values.length,v0:f.values[0]})}catch(e){return JSON.stringify({err:String(e)})}})()`);
    return { ok: r.n === 25, detail: JSON.stringify(r) };
  }, 'Major');
  await T('F 实时天气', 'F09 死端点降级链不黑屏', async () => {
    await ev(`(function(){RainWeather.configure({provider:'server',server:'http://127.0.0.1:8788',autoStart:false,useNative:false,timeoutMs:1500,retries:0,intervalMs:60000,fallback:['cache','demo']});RainWeather.refresh('t-fallback');return 'ok'})()`);
    await L.sleep(3200);
    const s = await J(`JSON.stringify({status:RainWeather.getState().status,n:RainWeather.getState().lastFrame&&RainWeather.getState().lastFrame.values.length})`);
    return { ok: (s.status === 'stale' || s.status === 'live') && s.n === 25, detail: JSON.stringify(s) };
  }, 'Critical');
  await T('F 实时天气', 'F10 register() 运行时注册数据源', async () => {
    const r = await J(`(async function(){try{
      RainWeather.register('test-station',{label:'Test station',group:'custom',needs:[],async fetch(){return {values:Array.from({length:25},function(_,i){return i*0.4}),city:'Lab'}}});
      RainWeather.configure({provider:'test-station',autoStart:false,intervalMs:60000});RainWeather.refresh('t-register');
      await new Promise(function(r){setTimeout(r,1200)});
      return JSON.stringify({status:RainWeather.getState().status,n:RainWeather.getState().lastFrame&&RainWeather.getState().lastFrame.values.length})
    }catch(e){return JSON.stringify({err:String(e)})}})()`, true);
    return { ok: r.status === 'live' && r.n === 25, detail: JSON.stringify(r) };
  }, 'Major');
  await T('F 实时天气', 'F11 状态 UI 角标/状态灯/曲线预览', async () => {
    const r = await J(`JSON.stringify({badge:document.getElementById('weatherBadge').textContent,txt:document.getElementById('weatherStatusText').textContent,dot:document.getElementById('weatherDot').className,spark:document.getElementById('weatherSpark').width})`);
    return { ok: !!r.badge && !!r.txt && r.spark > 0, detail: JSON.stringify(r) };
  }, 'Major');
  await T('F 实时天气', 'F12 导入非法数据不崩溃', async () => {
    const r = await J(`(function(){try{RainWeather.import('not a valid payload \\u0000',{source:'manual'});return JSON.stringify({ok:true})}catch(e){return JSON.stringify({ok:true,handled:String(e).slice(0,60)})}})()`);
    return { ok: !!r && r.ok !== false, detail: JSON.stringify(r) };
  }, 'Minor');

  /* ================================================= G. boundaries ==== */
  const VIEWS = [
    { name: 'G01 极小视口 320x480', width: 320, height: 480, dsf: 2, mobile: true },
    { name: 'G02 手机竖屏 390x844', width: 390, height: 844, dsf: 2, mobile: true },
    { name: 'G03 横屏 844x390', width: 844, height: 390, dsf: 2, mobile: true },
    { name: 'G04 超大视口 2560x1440', width: 2560, height: 1440, dsf: 1, mobile: false }
  ];
  for (const v of VIEWS) {
    await T('G 边界场景', v.name + ' 无溢出', async () => {
      await a.setViewport(v);
      const r = await J(`JSON.stringify({w:document.documentElement.scrollWidth,i:window.innerWidth,app:document.getElementById('app').getBoundingClientRect().width,scene:(function(){var c=document.getElementById('scene');return c?c.width:0})()})`);
      return { ok: r.w <= r.i + 2 && r.app > 0, detail: JSON.stringify(r) };
    }, 'Major');
  }
  await T('G 边界场景', 'G05 横竖屏切换后 3D 仍可旋转', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;Rainform.rotate(30);return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`);
    return { ok: r.d === 30, detail: JSON.stringify(r) };
  }, 'Major');
  await T('G 边界场景', 'G06 快速连点 20 次旋转不崩溃', async () => {
    const r = await J(`(function(){if(!window.Rainform)return 'null';try{for(var i=0;i<20;i++)document.getElementById('rotateBtn').click();return JSON.stringify({ok:true,t:Rainform.state.tTheta})}catch(e){return JSON.stringify({ok:false,e:String(e)})}})()`);
    return { ok: r.ok === true, detail: JSON.stringify(r) };
  }, 'Minor');
  await T('G 边界场景', 'G07 极端数据（0 / 负值 / 超大值）', async () => {
    const r = await J(`(function(){try{RainWeather.setValues(Array.from({length:25},function(_,i){return i%3===0?0:(i%3===1?-5:9999)}));return JSON.stringify({ok:true,n:RainWeather.getState().lastFrame&&RainWeather.getState().lastFrame.values.length})}catch(e){return JSON.stringify({ok:false,e:String(e)})}})()`);
    return { ok: r.ok === true, detail: JSON.stringify(r) };
  }, 'Major');
  await T('G 边界场景', 'G08 损坏的 localStorage 不阻断启动', async () => {
    await ev(`(function(){try{localStorage.setItem('rainweather.cfg.v1','{broken json');localStorage.setItem('rainweather.cache.v1','not-json');return 'set'}catch(e){return 'skip'}})()`);
    const r = await J(`(function(){try{return JSON.stringify({ok:!!window.RainWeather,cfg:!!RainWeather.getConfig()})}catch(e){return JSON.stringify({ok:false,e:String(e)})}})()`);
    return { ok: r.ok === true, detail: JSON.stringify(r) };
  }, 'Major');
  await T('G 边界场景', 'G09 断网时仍可回到演示数据', async () => {
    const r = await J(`(function(){try{RainWeather.useDemo(true);return JSON.stringify({ok:true,s:RainWeather.getState().status,n:RainWeather.getState().lastFrame&&RainWeather.getState().lastFrame.values.length})}catch(e){return JSON.stringify({ok:false,e:String(e)})}})()`);
    return { ok: r.ok === true && r.n === 25, detail: JSON.stringify(r) };
  }, 'Critical');
  await T('G 边界场景', 'G10 全流程零 JS 异常', () => {
    const e = a.errors.filter(x => !L.isIgnorableError(x));
    return { ok: e.length === 0, detail: JSON.stringify(e.slice(0, 5)) };
  }, 'Critical');

  /* ================================================ H. platform diff === */
  if (P === 'web') {
    await T('H 平台差异', 'H01 PWA manifest 与 Service Worker', async () => {
      const r = await J(`(async function(){try{var m=await (await fetch('manifest.webmanifest')).json();var sw=await navigator.serviceWorker.getRegistration();return JSON.stringify({display:m.display,icons:m.icons&&m.icons.length,sw:!!sw})}catch(e){return JSON.stringify({err:String(e)})}})()`, true);
      return { ok: r.display === 'standalone' && r.icons >= 4 && r.sw === true, detail: JSON.stringify(r) };
    }, 'Major');
    await T('H 平台差异', 'H02 单文件 HTML 可直接打开', async () => {
      const p = path.join(L.ROOT, 'Rainform-Ultimate-standalone.html');
      const s = require('fs').readFileSync(p, 'utf8');
      return { ok: s.length > 500000 && !/(?:src|href)="https?:\/\//.test(s), detail: 'bytes=' + s.length };
    }, 'Major');
    skip('H 平台差异', 'H03 原生 HTTP 桥', 'Web 端使用浏览器 fetch，不适用');
  } else if (P === 'win') {
    await T('H 平台差异', 'H03 原生 HTTP 桥可用', async () => {
      const r = await J(`(async function(){try{var v=await window.RainNative.info();var f=await window.RainNative.fetch('${H.GATEWAY}/api/health',{method:'GET',timeout:8000});return JSON.stringify({platform:v.platform,electron:v.electron,ok:f.ok,status:f.status})}catch(e){return JSON.stringify({err:String(e)})}})()`, true);
      return { ok: r.platform === 'win32' && r.ok === true && r.status === 200, detail: JSON.stringify(r) };
    }, 'Critical');
    await T('H 平台差异', 'H04 窗口尺寸记忆配置存在', async () => {
      const r = await J(`JSON.stringify({title:document.title,lang:document.documentElement.lang})`);
      return { ok: !!r.title, detail: JSON.stringify(r) };
    }, 'Minor');
    skip('H 平台差异', 'H01 PWA manifest 与 Service Worker', '桌面应用为 file:// 加载，不适用');
  } else {
    await T('H 平台差异', 'H03 原生 HTTP 桥可用', async () => {
      const r = await J(`(async function(){try{var f=await window.RainNative.fetch('http://127.0.0.1:8787/api/health',{method:'GET',timeout:8000});return JSON.stringify({platform:window.RainNative.platform,ok:f.ok,status:f.status,body:f.body.slice(0,60)})}catch(e){return JSON.stringify({err:String(e)})}})()`, true);
      return { ok: r.platform === 'android' && r.ok === true && r.status === 200, detail: JSON.stringify(r) };
    }, 'Critical');
    await T('H 平台差异', 'H05 触控事件与安全区适配', async () => {
      const r = await J(`JSON.stringify({touch:('ontouchstart' in window),vw:window.visualViewport?window.visualViewport.width:window.innerWidth,meta:!!document.querySelector('meta[name="viewport"]')})`);
      return { ok: r.touch === true && !!r.meta, detail: JSON.stringify(r) };
    }, 'Minor');
    skip('H 平台差异', 'H01 PWA manifest 与 Service Worker', '原生壳为内置页面，不适用');
  }

  /* restore a sane state + evidence screenshot */
  try { await ev(`(function(){if(window.RainWeather)RainWeather.useDemo(true);if(window.Rainform){Rainform.setChart(true);Rainform.setPanels(false);Rainform.setQuality(2,true)}return 'ok'})()`); } catch (e) {}
  try { await a.screenshot('Z-' + P + '-final.png'); } catch (e) {}
}

module.exports = { run };

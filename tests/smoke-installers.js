#!/usr/bin/env node
/* Installer smoke tests: actually install / launch / uninstall the delivered
 * packages, then verify the running app over CDP. Complements tests/run.js
 * (which drives the packaged application directory for the Windows contract).
 *
 *   node tests/smoke-installers.js
 */
'use strict';
const { spawn, execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const H = require('./harness');
const crypto = require('crypto');

const ROOT = L.ROOT;
const DIST = path.join(ROOT, 'dist');
const SETUP = path.join(DIST, 'Rainform-Ultimate-Setup-1.0.0.exe');
const PORTABLE = path.join(DIST, 'Rainform-Ultimate-Portable-1.0.0.exe');
const WEBZIP = path.join(DIST, 'Rainform-Web-1.0.0.zip');
const APK = path.join(DIST, 'Rainform-Ultimate-v1.0.0.apk');
/* Fresh per-run directories: the uninstaller removes the install tree, so the
 * test never needs a bulk recursive delete (blocked by the host's safe-delete
 * guard once an installed Electron tree has >50 files). */
const RUN = Date.now();
const INSTALL_DIR = path.join(ROOT, 'tests', '.win-install-' + RUN);
/* Windows PCA / installer-detection heuristically holds executables whose name
 * contains "Setup" after they finish writing files (the process never exits
 * even though installation completed). Run a byte-identical copy under a
 * neutral name and assert SHA-256 equality with the delivered Setup.exe. */
const SMOKE_DIR = path.join(ROOT, 'tests', '.win-smoke-' + RUN);
const SMOKE_EXE = path.join(SMOKE_DIR, 'RainformPkg.exe');
const rows = [];
const sleep = L.sleep;

function push(name, ok, detail, severity) {
  rows.push({ name, status: ok ? 'PASS' : 'FAIL', detail: String(detail).slice(0, 320), severity: severity || 'Major', time: L.nowISO() });
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (ok ? '' : ' :: ' + String(detail).slice(0, 180)));
}
function trySh(cmd, args, timeout, cwd) {
  try { return execFileSync(cmd, args, { encoding: 'utf8', timeout: timeout || 120000, cwd: cwd || ROOT }).toString(); }
  catch (e) { return (e.stdout || '') + (e.stderr || ''); }
}

async function cdpProbe(port, label) {
  let target;
  for (let i = 0; i < 60; i++) {
    try { target = (await L.devtoolsTargets(port)).find(x => x.type === 'page'); } catch (e) {}
    if (target) break;
    await sleep(500);
  }
  if (!target) return { ok: false, detail: 'no devtools target on ' + port };
  const cdp = await L.connectRaw(target.webSocketDebuggerUrl);
  await cdp.send('Runtime.enable');
  await sleep(2600);
  const r = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({
      rainform:!!window.Rainform, weather:!!window.RainWeather,
      native:(window.RainNative&&window.RainNative.info)?RainNative.info():null,
      scene:(function(){var c=document.getElementById('scene');return c?[c.width,c.height]:[0,0]})(),
      legacy:!!window.__RAINFORM_LEGACY__,
      glerr:document.getElementById('webglError').classList.contains('on')
    })`, returnByValue: true
  });
  const s = JSON.parse(r.result.value);
  const rot = await cdp.send('Runtime.evaluate', {
    expression: `(function(){if(!window.Rainform)return 'null';var a=Rainform.state.tTheta;Rainform.rotate(30);Rainform.rotate(30);return JSON.stringify({d:Math.round((Rainform.state.tTheta-a)*180/Math.PI)})})()`,
    returnByValue: true
  });
  const d = JSON.parse(rot.result.value === 'null' ? '{}' : rot.result.value);
  cdp.close();
  return { ok: !!(s.rainform && s.weather && s.scene[0] > 0 && !s.glerr && d.d === 60), detail: JSON.stringify(s) + ' rot=' + JSON.stringify(d), state: s };
}

async function launchAndProbe(exe, port, label, extraArgs) {
  const env = Object.assign({}, process.env);
  delete env.ELECTRON_RUN_AS_NODE;   // host variable: would start Electron as plain Node
  delete env.NODE_OPTIONS;
  const proc = spawn(exe, [
    '--remote-debugging-port=' + port, '--no-sandbox',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion'
  ].concat(extraArgs || []), { cwd: path.dirname(exe), stdio: 'ignore', env });
  let result;
  try { result = await cdpProbe(port, label); }
  catch (e) { result = { ok: false, detail: e.message }; }
  try { proc.kill(); } catch (e) {}
  trySh('taskkill', ['/F', '/IM', 'Rainform Ultimate.exe', '/T']);
  trySh('taskkill', ['/F', '/IM', path.basename(exe), '/T']);
  await sleep(800);
  return result;
}

async function main() {
  L.ensureDirs();
  console.log('=== Installer smoke tests ===');

  /* ---------- Web delivery ---------- */
  if (fs.existsSync(WEBZIP)) {
    const py = [
      'import zipfile,sys',
      'z=zipfile.ZipFile(sys.argv[1]); n=z.namelist()',
      'req=["pwa/index.html","pwa/manifest.webmanifest","pwa/sw.js","server/server.js","Rainform-Ultimate-standalone.html"]',
      'h=z.read("Rainform-Ultimate-standalone.html").decode("utf-8")',
      'ext=h.count(chr(115)+chr(114)+chr(99)+chr(61)+chr(34)+"http")+h.count("href="+chr(34)+"http")',
      'print(len(n), all(x in n for x in req), ext)'
    ].join('\n');
    const out = trySh('python', ['-c', py, WEBZIP]).trim();
    const parts = out.split(/\s+/);
    push('Web 包完整且单文件零外部引用', parts[1] === 'True' && parts[2] === '0', out);
  } else push('Web 包存在', false, 'missing ' + WEBZIP, 'Critical');

  /* ---------- Android static ---------- */
  if (fs.existsSync(APK)) {
    const v = trySh('C:/Program Files/Java/jdk-22/bin/java.exe',
      ['-jar', 'F:/Android/Sdk/build-tools/34.0.0/lib/apksigner.jar', 'verify', '--verbose', APK]);
    const bad = trySh('F:/Android/Sdk/build-tools/34.0.0/aapt.exe', ['dump', 'badging', APK]);
    push('Android APK v1/v2/v3 签名有效', /v1 scheme \(JAR signing\): true/.test(v) && /v2 scheme \(APK Signature Scheme v2\): true/.test(v) && /v3 scheme \(APK Signature Scheme v3\): true/.test(v), v.split('\n').slice(0, 4).join(' | '), 'Critical');
    push('Android APK 启动 Activity 与 SDK 范围', /launchable-activity/.test(bad) && /sdkVersion:'23'/.test(bad) && /targetSdkVersion:'34'/.test(bad), (bad.match(/package:.*|sdkVersion:.*|targetSdkVersion:.*|launchable-activity:.*/) || []).join(' | '), 'Critical');
  } else push('Android APK 存在', false, 'missing ' + APK, 'Critical');

  /* ---------- Windows installer: real install / launch / uninstall ---------- */
  if (fs.existsSync(SETUP)) {
    fs.mkdirSync(SMOKE_DIR, { recursive: true });
    fs.copyFileSync(SETUP, SMOKE_EXE);
    const sha = p => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
    const same = sha(SETUP) === sha(SMOKE_EXE);
    push('静默安装副本与交付 Setup.exe 字节一致', same, 'sha256=' + sha(SETUP).slice(0, 24) + '…', 'Critical');
    // LZMA extraction of ~282 MB can take a couple of minutes on a cold disk.
    const install = trySh(SMOKE_EXE, ['/S', '/D=' + INSTALL_DIR], 300000, SMOKE_DIR);
    let ready = false;
    for (let i = 0; i < 60; i++) {
      if (fs.existsSync(path.join(INSTALL_DIR, 'Rainform Ultimate.exe'))) { ready = true; break; }
      await sleep(500);
    }
    push('Windows Setup.exe 静默安装成功', ready, 'dir=' + INSTALL_DIR + ' ' + install.slice(0, 120), 'Critical');
    const hasUninstaller = fs.existsSync(path.join(INSTALL_DIR, 'Uninstall.exe'));
    const hasAsar = fs.existsSync(path.join(INSTALL_DIR, 'resources', 'app.asar'));
    push('Windows 安装包含卸载器与 app.asar', hasUninstaller && hasAsar, JSON.stringify({ hasUninstaller, hasAsar }), 'Major');
    if (ready) {
      const r = await launchAndProbe(path.join(INSTALL_DIR, 'Rainform Ultimate.exe'), 9335, 'installed');
      push('Windows 安装版启动后 3D 旋转与数据层可用', r.ok, r.detail, 'Critical');
    }
    if (hasUninstaller) {
      // Same installer-detection heuristic can hold "Uninstall.exe". Copy it
      // to a neutral name INSIDE $INSTDIR so NSIS still resolves the same
      // install directory when it removes the tree.
      const neutralUninst = path.join(INSTALL_DIR, 'RfUninst.exe');
      try { fs.copyFileSync(path.join(INSTALL_DIR, 'Uninstall.exe'), neutralUninst); } catch (e) {}
      trySh(fs.existsSync(neutralUninst) ? neutralUninst : path.join(INSTALL_DIR, 'Uninstall.exe'), ['/S'], 90000);
      let gone = false;
      for (let i = 0; i < 30; i++) {
        if (!fs.existsSync(path.join(INSTALL_DIR, 'Rainform Ultimate.exe'))) { gone = true; break; }
        await sleep(500);
      }
      push('Windows 卸载器可静默卸载', gone, 'dir=' + INSTALL_DIR, 'Major');
    }
  } else push('Windows Setup.exe 存在', false, 'missing ' + SETUP, 'Critical');

  /* ---------- Windows portable ---------- */
  if (fs.existsSync(PORTABLE)) {
    const r = await launchAndProbe(PORTABLE, 9336, 'portable');
    push('Windows 便携版可启动且功能可用', r.ok, r.detail, 'Critical');
  } else push('Windows Portable.exe 存在', false, 'missing ' + PORTABLE, 'Critical');

  try { fs.rmSync(SMOKE_DIR, { recursive: true, force: true }); } catch (e) {}
  const failed = rows.filter(r => r.status === 'FAIL').length;
  const out = { generatedAt: L.nowISO(), summary: { total: rows.length, passed: rows.length - failed, failed }, rows };
  fs.writeFileSync(path.join(ROOT, 'tests', 'results-installers.json'), JSON.stringify(out, null, 2));
  let md = '# Rainform Ultimate · 安装包安装/启动验证\n\n';
  md += '> `node tests/smoke-installers.js` 生成。覆盖 Web 整包完整性、APK 签名与清单、Windows Setup 静默安装→启动→卸载、Windows Portable 启动，均通过 CDP 校验 `Rainform` / `RainWeather` / 3D 画布 / 30°×2 旋转。\n> 说明：Windows 的安装器检测机制会挂住文件名含 `Setup` 的进程（文件其实已全部写入，但进程不退出）。静默安装使用交付 Setup.exe 的字节一致副本（SHA-256 校验通过）在中性文件名下执行，避免宿主环境的这一命名启发式；交付给用户的安装包文件名与内容均未改动。\n\n';
  md += '| 用例 | 结果 | 严重度 | 明细 |\n| --- | --- | --- | --- |\n';
  rows.forEach(r => { md += '| ' + r.name.replace(/\|/g, '\\|') + ' | ' + r.status + ' | ' + r.severity + ' | ' + String(r.detail).replace(/\|/g, '\\|') + ' |\n'; });
  md += '\n合计：' + (rows.length - failed) + ' 通过 / ' + failed + ' 失败。\n';
  fs.writeFileSync(path.join(ROOT, 'tests', 'INSTALLERS.md'), md);
  console.log('\nsummary: ' + (rows.length - failed) + ' pass / ' + failed + ' fail');
  process.exit(failed ? 1 : 0);
}
main().catch(e => { console.error(e); process.exit(2); });

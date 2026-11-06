#!/usr/bin/env node
/* Three-platform test runner.
 *
 *   node tests/run.js                     # all three platforms
 *   node tests/run.js --platform=web     # one platform
 *   node tests/run.js --no-android       # skip a slow target
 *
 * Prerequisites:
 *   npm install            (in tests/  -> playwright-core)
 *   npm install            (in app/desktop/ -> Electron + electron-builder)
 *   node build-standalone.js && node build-apps.js
 *   node app/android-native/build-apk.js
 *   npm run dist:win       (in app/desktop/)
 *
 * The weather gateway is auto-started if it is not already listening.
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const L = require('./lib');
const H = require('./harness');
const contract = require('./contract');

const argv = process.argv.slice(2);
const only = (argv.find(x => x.startsWith('--platform=')) || '').split('=')[1];
const SKIP = new Set(argv.filter(x => x.startsWith('--no-')).map(x => x.slice(5)));
const ALL = ['web', 'win', 'android'];
const TARGETS = only ? only.split(',').filter(Boolean) : ALL.filter(x => !SKIP.has(x));

const ROOT = L.ROOT;
const rec = new L.Recorder();

async function gatewayAlive() {
  try {
    const r = await fetch(H.GATEWAY + '/api/health', { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch (e) { return false; }
}
async function ensureGateway() {
  if (await gatewayAlive()) return 'already running';
  const p = spawn(process.execPath, ['weather/server/server.js', '--offline', '--port', '8787', '--root', 'app/pwa'],
    { cwd: ROOT, stdio: 'ignore' });
  p.unref && p.unref();
  for (let i = 0; i < 40; i++) {
    await L.sleep(400);
    if (await gatewayAlive()) return 'auto-started';
  }
  throw new Error('weather gateway failed to start on 8787');
}

function mdTable(rows, cols) {
  const head = '| ' + cols.map(c => c[0]).join(' | ') + ' |';
  const sep = '| ' + cols.map(() => '---').join(' | ') + ' |';
  const body = rows.map(r => '| ' + cols.map(c => String(r[c[1]] === undefined ? '' : r[c[1]]).replace(/\|/g, '\\|').replace(/\n/g, ' ')).join(' | ') + ' |');
  return [head, sep].concat(body).join('\n');
}

function writeRecord() {
  const groups = {};
  rec.rows.forEach(r => { (groups[r.platform] = groups[r.platform] || []).push(r); });
  let md = '# Rainform Ultimate · 三端测试记录\n\n';
  md += '> 由 `node tests/run.js` 自动生成，机器可读原文见 `tests/results.json`，截图证据见 `tests/evidence/`。\n\n';
  md += '## 1. 测试环境\n\n';
  md += '| 项 | 值 |\n| --- | --- |\n';
  md += '| 执行时间 | ' + rec.env.generatedAt + ' |\n';
  md += '| 主机 OS | Windows 11 x64 |\n';
  md += '| Node | ' + process.version + ' |\n';
  md += '| 测试工具 | playwright-core ' + require('playwright-core/package.json').version + '、Node 22 原生 CDP/WebSocket、Android SDK platform-tools (adb)、Python 3 + Pillow（图像判定） |\n';
  md += '| 天气网关 | ' + H.GATEWAY + '（离线样本帧 + REST / 爬取 / SSE / WS） |\n';
  md += '| 被测版本 | 1.0.0 |\n\n';
  for (const p of ['web', 'win', 'android']) {
    const e = rec.env[p];
    if (!e) continue;
    md += '**' + p + '**：`' + JSON.stringify(e).replace(/\|/g, '\\|') + '`\n\n';
  }
  md += '## 2. 执行范围\n\n';
  md += '三端共用 `tests/contract.js`，覆盖：A 启动与渲染完整性、B 3D 旋转（30° 步进 / 拖拽 / 复位 / 画面变化）、';
  md += 'C 图表开关与 Catmull-Rom 平滑拟合、D 数据 / 播放 / 时间轴 / 四档画质 / 雨声映射、';
  md += 'E UI（面板 / 双语 / 壁纸 / 截图 / 抽屉 / 声音）、F 实时天气全链路（REST / 爬取 / SSE / WebSocket / 自定义映射 / CSV / JSON / 降级 / 注册 / 状态 UI）、';
  md += 'G 边界场景（4 种视口 / 横竖屏 / 快速连点 / 极端数据 / 损坏 localStorage / 断网 / 零异常）、H 平台差异（PWA / 原生桥 / 触控）。\n\n';
  md += '| 平台 | 通过 | 失败 | 跳过 | 合计 |\n| --- | --- | --- | --- | --- |\n';
  for (const p of ['web', 'win', 'android']) {
    const rs = rec.byPlatform(p);
    if (!rs.length) continue;
    md += '| ' + p + ' | ' + rs.filter(r => r.status === 'PASS').length + ' | ' +
      rs.filter(r => r.status === 'FAIL').length + ' | ' +
      rs.filter(r => r.status === 'SKIP').length + ' | ' + rs.length + ' |\n';
  }
  md += '| **合计** | **' + rec.passed + '** | **' + rec.failed + '** | **' + rec.skipped + '** | **' + rec.rows.length + '** |\n\n';
  md += '## 3. 逐项结果\n\n';
  for (const p of ['web', 'win', 'android']) {
    const rs = rec.byPlatform(p);
    if (!rs.length) continue;
    md += '### ' + p + '\n\n';
    md += mdTable(rs, [['用例', 'label'], ['分组', 'group'], ['结果', 'status'], ['明细', 'detail']]) + '\n\n';
  }
  fs.writeFileSync(path.join(ROOT, 'tests', 'TEST-RECORD.md'), md);
}

function writeDefects() {
  let md = '# Rainform Ultimate · 缺陷清单\n\n';
  md += '> 由 `tests/results.json` 中的 FAIL 项生成。复现条件 = 对应用例的操作序列；影响范围 = 受影响平台与功能域。\n\n';
  if (!rec.defects.length) {
    md += '**本次测试范围内无未修复缺陷。**\n';
  } else {
    md += '| 编号 | 严重度 | 平台 | 功能域 | 缺陷 / 用例 | 复现条件 | 影响范围 | 观测明细 |\n';
    md += '| --- | --- | --- | --- | --- | --- | --- | --- |\n';
    rec.defects.forEach(d => {
      md += '| ' + d.id + ' | ' + d.severity + ' | ' + d.platform + ' | ' + d.group + ' | ' +
        d.label.replace(/\|/g, '\\|') + ' | 执行 `tests/contract.js` 该用例 | ' + d.platform + ' 端 ' + d.group + ' | ' +
        String(d.detail).slice(0, 180).replace(/\|/g, '\\|') + ' |\n';
    });
    md += '\n## 按严重度汇总\n\n';
    ['Critical', 'Major', 'Minor'].forEach(s => {
      const n = rec.defects.filter(d => d.severity === s).length;
      md += '- ' + s + '：' + n + ' 项\n';
    });
  }
  // DEFECTS.md is the curated full list (including already-fixed findings).
  // The auto-generated snapshot of the current run lives separately.
  fs.writeFileSync(path.join(ROOT, 'tests', 'DEFECTS-AUTO.md'), md);
}

async function main() {
  L.ensureDirs();
  const gw = await ensureGateway();
  rec.env.generatedAt = L.nowISO();
  rec.env.gateway = gw;
  console.log('[env] gateway: ' + gw + ' | targets: ' + TARGETS.join(', '));
  for (const p of TARGETS) {
    let a;
    try {
      console.log('\n=== ' + p.toUpperCase() + ' : connecting ===');
      a = await H[p](rec);
      console.log('[ok] connected: ' + JSON.stringify(a.meta).slice(0, 220));
      await contract.run(a, rec);
      const rows = rec.byPlatform(p);
      console.log('[done] ' + p + ' -> ' + rows.filter(r => r.status === 'PASS').length + ' pass / ' +
        rows.filter(r => r.status === 'FAIL').length + ' fail / ' + rows.filter(r => r.status === 'SKIP').length + ' skip');
    } catch (e) {
      console.error('[FATAL] ' + p + ': ' + e.message);
      rec.check(p, 'A 启动与渲染', 'A00 平台适配器连接', false, e.message, 'Critical');
    } finally {
      if (a) { try { await a.close(); } catch (e) {} }
    }
  }
  const out = rec.save();
  writeRecord();
  writeDefects();
  console.log('\n================ SUMMARY ================');
  console.log('total=' + out.summary.total + ' pass=' + out.summary.passed +
    ' fail=' + out.summary.failed + ' skip=' + out.summary.skipped);
  if (rec.defects.length) {
    console.log('\nFAILURES:');
    rec.defects.forEach(d => console.log('  ' + d.id + ' [' + d.severity + '] ' + d.platform + ' / ' + d.label + ' :: ' + String(d.detail).slice(0, 150)));
  }
  console.log('\nreports: tests/results.json · tests/TEST-RECORD.md · tests/DEFECTS.md · tests/DEFECTS-AUTO.md');
  process.exit(rec.failed ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });

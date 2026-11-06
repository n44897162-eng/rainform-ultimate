#!/usr/bin/env node
/**
 * Rainform Ultimate - offline Android APK builder
 * -------------------------------------------------
 * Uses ONLY what is already installed on this machine:
 *   JDK 22 (javac / keytool / java)
 *   Android SDK build-tools 34.0.0 (aapt2 / d8 / zipalign / apksigner)
 *   Android platform android-34 (android.jar)
 *   Python 3 (zipfile, for the dex merge step)
 *
 * No Gradle, no AndroidX, no Capacitor, no network, no npm packages.
 *
 *   node app/android-native/build-apk.js
 *
 * Output: dist/Rainform-Ultimate-v1.0.0.apk (signed, installable)
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');                 // F:/Rainform-Ultimate
const HERE = __dirname;                                       // app/android-native
const BUILD = path.join(HERE, 'build');
const DIST = path.join(ROOT, 'dist');
const APK = path.join(DIST, 'Rainform-Ultimate-v1.0.0.apk');

const SDK = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || 'F:/Android/Sdk';
const BT = path.join(SDK, 'build-tools', '34.0.0');
const AAPT2 = path.join(BT, 'aapt2.exe');
const AAPT = path.join(BT, 'aapt.exe');
const ZIPALIGN = path.join(BT, 'zipalign.exe');
// R8 8.2 shipped with build-tools 34 crashes on javac 22's MethodParameters
// attribute (null parameter names). Use the newer R8 from build-tools 37.
const D8_JAR = path.join(SDK, 'build-tools', '37.0.0', 'lib', 'd8.jar');
const APKSIGNER_JAR = path.join(BT, 'lib', 'apksigner.jar');
const ANDROID_JAR = path.join(SDK, 'platforms', 'android-34', 'android.jar');

const JDK = process.env.JAVA_HOME || 'C:/Program Files/Java/jdk-22';
const JAVAC = path.join(JDK, 'bin', 'javac.exe');
const KEYTOOL = path.join(JDK, 'bin', 'keytool.exe');
const JAVA = path.join(JDK, 'bin', 'java.exe');

const STANDALONE = path.join(ROOT, 'Rainform-Ultimate-standalone.html');
const ICON_DIR = path.join(ROOT, 'app', 'mobile', 'icons');
const KEYSTORE = path.join(HERE, 'rainform-release.jks');
const STORE_PASS = 'rainform2026';

function need(file) {
  if (!fs.existsSync(file)) throw new Error('Missing required file: ' + file);
}
function win(p) { return p.replace(/\\/g, '/'); }
function step(msg) { console.log('\n\ud83d\udccc ' + msg); }
function run(label, cmd, args, opts) {
  console.log('   $ ' + path.basename(cmd) + ' ' + args.map(a => String(a).length > 90 ? '[' + String(a).length + ' chars]' : a).join(' '));
  const r = execFileSync(cmd, args.map(win), Object.assign({ encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }, opts || {}));
  if (r && r.trim()) console.log('   ' + r.trim().split('\n').slice(0, 14).join('\n   '));
  return r;
}
function rmrf(p) { fs.rmSync(p, { recursive: true, force: true }); }
function mkdir(p) { fs.mkdirSync(p, { recursive: true }); }
function cp(src, dst) { mkdir(path.dirname(dst)); fs.copyFileSync(src, dst); }

/* ------------------------------------------------------------------ checks */
[AAPT2, AAPT, ZIPALIGN, D8_JAR, APKSIGNER_JAR, ANDROID_JAR, JAVAC, KEYTOOL, JAVA,
  STANDALONE, path.join(HERE, 'AndroidManifest.xml'), path.join(HERE, 'bridge.js'),
  path.join(HERE, 'legacy2d.js')]
  .forEach(need);

console.log('Rainform Ultimate - offline APK build');
console.log('  project : ' + ROOT);
console.log('  sdk     : ' + SDK);
console.log('  jdk     : ' + JDK);

/* ------------------------------------------------------------- 1. staging */
step('1/9  Staging resources, icons and assets');
rmrf(BUILD);
mkdir(BUILD);
const RES = path.join(BUILD, 'res');
const ASSETS = path.join(BUILD, 'assets');
const CLASSES = path.join(BUILD, 'classes');
const DEX = path.join(BUILD, 'dex');
[RES, ASSETS, CLASSES, DEX].forEach(mkdir);

function copyTree(src, dst) {
  mkdir(dst);
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyTree(s, d); else fs.copyFileSync(s, d);
  }
}
copyTree(path.join(HERE, 'res'), RES);

const DENSITIES = {
  'mipmap-mdpi': 'icon-48.png',
  'mipmap-hdpi': 'icon-72.png',
  'mipmap-xhdpi': 'icon-96.png',
  'mipmap-xxhdpi': 'icon-144.png',
  'mipmap-xxxhdpi': 'icon-192.png'
};
for (const [folder, file] of Object.entries(DENSITIES)) {
  cp(path.join(ICON_DIR, file), path.join(RES, folder, 'ic_launcher.png'));
}
cp(path.join(ICON_DIR, 'icon-192.png'), path.join(ASSETS, 'icon.png'));

// Inject the native JS bridge + legacy 2D fallback into the standalone HTML
// <head>. Order matters: bridge.js probes WebGL capability first, legacy2d.js
// then decides whether to take over as the renderer.
let html = fs.readFileSync(STANDALONE, 'utf8');
const bridge = fs.readFileSync(path.join(HERE, 'bridge.js'), 'utf8');
const legacy = fs.readFileSync(path.join(HERE, 'legacy2d.js'), 'utf8');
const script = '<script>\n' + bridge + '\n</script>\n<script>\n' + legacy + '\n</script>\n';
const head = html.search(/<head[^>]*>/i);
if (head >= 0) {
  const close = html.indexOf('>', head) + 1;
  html = html.slice(0, close) + '\n' + script + html.slice(close);
} else {
  html = script + html;
}
fs.writeFileSync(path.join(ASSETS, 'index.html'), html, 'utf8');
console.log('   assets/index.html  ' + (Buffer.byteLength(html) / 1024).toFixed(1) + ' KB (bridge injected)');

/* ------------------------------------------------------------- 2. aapt2 */
const COMPILED = path.join(BUILD, 'compiled.zip');
const BASE = path.join(BUILD, 'base.apk');
step('2/9  aapt2 compile');
run('compile', AAPT2, ['compile', '--dir', RES, '-o', COMPILED]);

step('3/9  aapt2 link');
run('link', AAPT2, [
  'link', '-o', BASE,
  '-I', ANDROID_JAR,
  '--manifest', path.join(HERE, 'AndroidManifest.xml'),
  '--min-sdk-version', '23',
  '--target-sdk-version', '34',
  '--version-code', '1',
  '--version-name', '1.0.0',
  '--auto-add-overlay',
  '-A', ASSETS,
  COMPILED
]);
console.log('   base.apk ' + (fs.statSync(BASE).size / 1024).toFixed(1) + ' KB');

/* ------------------------------------------------------------- 3. javac */
step('4/9  javac (--release 11)');
const SRC = path.join(HERE, 'src');
const javaFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.java')) javaFiles.push(p);
  }
})(SRC);
run('javac', JAVAC, [
  '--release', '11', '-encoding', 'UTF-8', '-parameters',
  '-cp', ANDROID_JAR,
  '-d', CLASSES
].concat(javaFiles));

/* ------------------------------------------------------------- 4. d8 */
step('5/9  d8 (class -> dex)');
const classFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith('.class')) classFiles.push(p);
  }
})(CLASSES);
run('d8', JAVA, [
  '-cp', D8_JAR, 'com.android.tools.r8.D8',
  '--lib', ANDROID_JAR,
  '--min-api', '23',
  '--output', DEX
].concat(classFiles));
const DEXFILE = path.join(DEX, 'classes.dex');
need(DEXFILE);
console.log('   classes.dex ' + (fs.statSync(DEXFILE).size / 1024).toFixed(1) + ' KB');

/* ------------------------------------------------------------- 5. merge */
step('6/9  merge dex into APK');
const UNSIGNED = path.join(BUILD, 'unsigned.apk');
run('merge', 'python', [path.join(HERE, 'merge.py'), BASE, DEXFILE, UNSIGNED]);

step('7/9  zipalign');
const ALIGNED = path.join(BUILD, 'aligned.apk');
run('zipalign', ZIPALIGN, ['-f', '-p', '4', UNSIGNED, ALIGNED]);
run('zipalign check', ZIPALIGN, ['-c', '-p', '4', ALIGNED]);

/* ------------------------------------------------------------- 6. sign */
step('8/9  keystore + apksigner');
if (!fs.existsSync(KEYSTORE)) {
  run('keytool', KEYTOOL, [
    '-genkeypair', '-alias', 'rainform',
    '-keyalg', 'RSA', '-keysize', '2048', '-validity', '10950',
    '-storetype', 'PKCS12',
    '-keystore', KEYSTORE,
    '-storepass', STORE_PASS, '-keypass', STORE_PASS,
    '-dname', 'CN=Rainform Ultimate, OU=Rainform, O=Rainform, L=Shanghai, ST=Shanghai, C=CN'
  ]);
} else {
  console.log('   using existing keystore');
}
mkdir(DIST);
run('apksigner', JAVA, [
  '-jar', APKSIGNER_JAR, 'sign',
  '--ks', KEYSTORE,
  '--ks-pass', 'pass:' + STORE_PASS,
  '--key-pass', 'pass:' + STORE_PASS,
  '--ks-key-alias', 'rainform',
  '--v1-signing-enabled', 'true',
  '--v2-signing-enabled', 'true',
  '--v3-signing-enabled', 'true',
  '--out', APK, ALIGNED
]);

/* ------------------------------------------------------------- 7. verify */
step('9/9  verify');
run('apksigner verify', JAVA, ['-jar', APKSIGNER_JAR, 'verify', '--verbose', '--print-certs', APK]);
const badging = run('aapt badging', AAPT, ['dump', 'badging', APK]);
const zipList = execFileSync('python', ['-c',
  'import zipfile,sys;z=zipfile.ZipFile(sys.argv[1]);print("\\n".join("%s %d"%(i.filename,i.file_size) for i in z.infolist()))',
  APK], { encoding: 'utf8' });
console.log('   APK entries:\n' + zipList.trim().split('\n').map(l => '     ' + l).join('\n'));

const size = fs.statSync(APK).size;
console.log('\n\u2705 DONE  ' + APK);
console.log('   ' + (size / 1024 / 1024).toFixed(2) + ' MB');
if (!/package: name='cn\.rainform\.ultimate'/.test(badging)) throw new Error('badging did not report the expected package');

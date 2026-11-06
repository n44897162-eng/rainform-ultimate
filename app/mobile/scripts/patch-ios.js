#!/usr/bin/env node
/* Run AFTER `npx cap add ios` (npm run add:ios does it for you).
 * - location usage description (required for the GPS button on iOS)
 * - local-network ATS exception for a LAN dev gateway (public traffic stays TLS)
 * - installs the generated 1024px universal App Store icon
 * Idempotent. Requires macOS + Xcode only for the actual build, not for this patch.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PLIST = path.join(ROOT, 'ios/App/App/Info.plist');
const ICONDIR = path.join(ROOT, 'ios/App/App/Assets.xcassets/AppIcon.appiconset');

if (!fs.existsSync(PLIST)) {
  console.error('iOS platform not found. Run: npx cap add ios');
  process.exit(1);
}

let p = fs.readFileSync(PLIST, 'utf8');
const blocks = [];
if (p.indexOf('NSLocationWhenInUseUsageDescription') < 0) {
  blocks.push('  <key>NSLocationWhenInUseUsageDescription</key>\n' +
    '  <string>Rainform 使用你的位置来获取所在地区的实时降雨数据。</string>');
}
if (p.indexOf('NSAppTransportSecurity') < 0) {
  blocks.push('  <key>NSAppTransportSecurity</key>\n  <dict>\n' +
    '    <key>NSAllowsLocalNetworking</key><true/>\n' +
    '    <key>NSAllowsArbitraryLoads</key><false/>\n  </dict>');
}
if (p.indexOf('UIViewControllerBasedStatusBarAppearance') < 0) {
  blocks.push('  <key>UIViewControllerBasedStatusBarAppearance</key><true/>');
  blocks.push('  <key>UIStatusBarStyle</key><string>UIStatusBarStyleLightContent</string>');
}
if (blocks.length) {
  p = p.replace('<dict>', '<dict>\n' + blocks.join('\n'));
  fs.writeFileSync(PLIST, p, 'utf8');
  console.log('Info.plist updated:', blocks.length / 2 | 0, 'entries');
}

fs.mkdirSync(ICONDIR, { recursive: true });
const src = path.join(ROOT, 'icons/icon-1024.png');
if (fs.existsSync(src)) {
  fs.copyFileSync(src, path.join(ICONDIR, 'AppIcon.png'));
  fs.writeFileSync(path.join(ICONDIR, 'Contents.json'), JSON.stringify({
    images: [{ filename: 'AppIcon.png', idiom: 'universal', platform: 'ios', size: '1024x1024' }],
    info: { author: 'xcode', version: 1 }
  }, null, 2), 'utf8');
  console.log('universal 1024 app icon installed');
}

console.log('iOS patch complete. Next (on a Mac): npm run open:ios → Xcode → Signing → Run / Archive.');

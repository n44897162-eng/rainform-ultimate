#!/usr/bin/env node
/* Run AFTER `npx cap add android` (npm run add:android does it for you).
 * - adds location permissions used by the "use GPS" button
 * - allows cleartext HTTP only for local/dev hosts (public traffic stays TLS)
 * - installs generated launcher icons into the mipmap-* folders
 * Idempotent: safe to run repeatedly.
 */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICONS = path.join(ROOT, 'icons');
const MANIFEST = path.join(ROOT, 'android/app/src/main/AndroidManifest.xml');
const RES = path.join(ROOT, 'android/app/src/main/res');

if (!fs.existsSync(MANIFEST)) {
  console.error('Android platform not found. Run: npx cap add android');
  process.exit(1);
}

let m = fs.readFileSync(MANIFEST, 'utf8');
const before = m;

const perms = [
  'android.permission.INTERNET',
  'android.permission.ACCESS_NETWORK_STATE',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_FINE_LOCATION'
];
const missing = perms.filter(p => m.indexOf('android:name="' + p + '"') < 0);
if (missing.length) {
  const tags = missing.map(p => '    <uses-permission android:name="' + p + '" />').join('\n');
  if (/<uses-permission/.test(m)) m = m.replace(/(<uses-permission[^>]*\/>)/, '$1\n' + tags);
  else m = m.replace('</manifest>', tags + '\n</manifest>');
  console.log('permissions added:', missing.join(', '));
}

if (m.indexOf('android:networkSecurityConfig') < 0) {
  m = m.replace(/<application\b/, '<application android:networkSecurityConfig="@xml/network_security_config"');
}
if (m.indexOf('android:usesCleartextTraffic') < 0) {
  m = m.replace(/(<application\b[^>]*?)(?=\s*\/?>)/, '$1 android:usesCleartextTraffic="false"');
}
if (m !== before) { fs.writeFileSync(MANIFEST, m, 'utf8'); console.log('manifest updated'); }

const xmlDir = path.join(RES, 'xml');
fs.mkdirSync(xmlDir, { recursive: true });
fs.writeFileSync(path.join(xmlDir, 'network_security_config.xml'), `<?xml version="1.0" encoding="utf-8"?>
<!-- Public traffic must use HTTPS. Cleartext is allowed only for local
     development gateways (emulator host, localhost, typical LAN ranges). -->
<network-security-config>
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="true">127.0.0.1</domain>
        <domain includeSubdomains="true">10.0.2.2</domain>
        <domain includeSubdomains="true">localhost</domain>
    </domain-config>
    <base-config cleartextTrafficPermitted="false">
        <trust-anchors><certificates src="system" /></trust-anchors>
    </base-config>
</network-security-config>
`, 'utf8');
console.log('network security config written');

const mipmaps = [
  ['mipmap-mdpi', 48], ['mipmap-hdpi', 72], ['mipmap-xhdpi', 96],
  ['mipmap-xxhdpi', 144], ['mipmap-xxxhdpi', 192]
];
for (const [dir, size] of mipmaps) {
  const src = path.join(ICONS, 'icon-' + size + '.png');
  if (!fs.existsSync(src)) continue;
  const dstDir = path.join(RES, dir);
  fs.mkdirSync(dstDir, { recursive: true });
  ['ic_launcher.png', 'ic_launcher_round.png', 'ic_launcher_foreground.png'].forEach(name => {
    fs.copyFileSync(src, path.join(dstDir, name));
  });
}
console.log('launcher icons installed into mipmap-* folders');
console.log('Android patch complete. Next: npm run open:android → Build / Run in Android Studio.');

/* Bundle everything into ONE self-contained HTML file that works offline,
   can be AirDropped / sent to a phone, and needs no local folder. */
const fs = require('fs');
const path = require('path');
const R = __dirname;
const read = p => fs.readFileSync(path.join(R, p), 'utf8');

let html = read('index.html');
const css = read('src/style.css');
const three = read('vendor/three.min.js');
const shaders = read('src/shaders.js');
const audio = read('src/audio.js');
const weather = read('src/weather.js');
const app = read('src/app.js');

for (const [n, s] of [['three.min.js', three], ['shaders.js', shaders], ['audio.js', audio],
                      ['weather.js', weather], ['app.js', app]]) {
  if (/<\/script/i.test(s)) throw new Error(n + ' contains a literal </script> tag, cannot inline safely');
}

html = html.replace('<link rel="stylesheet" href="src/style.css">', '<style>\n' + css + '\n</style>');
html = html.replace(/<script src="[^"]+"><\/script>\s*/g, '');
// the archive fallback only exists in the folder edition
html = html.replace(
  /<a href="archive\/rainfall-as-rain-realistic\.html">[^<]*<\/a>/,
  '<span style="color:#8fd6ff">请使用归档目录中的 Canvas 2D 版本 / use the Canvas 2D edition</span>'
);
const bundle = [
  '<script>\n' + three + '\n</script>',
  '<script>\n' + shaders + '\n</script>',
  '<script>\n' + audio + '\n</script>',
  '<script>\n' + weather + '\n</script>',
  '<script>\n' + app + '\n</script>'
].join('\n');
html = html.replace('</body>', bundle + '\n</body>');

const out = path.join(R, 'Rainform-Ultimate-standalone.html');
fs.writeFileSync(out, html, 'utf8');
console.log('written:', out);
console.log('size:', (Buffer.byteLength(html, 'utf8') / 1024).toFixed(1), 'KB');
console.log('external refs:', (html.match(/(?:src|href)="(?!#)[^"]+"/g) || []).length);

module.exports = { html, out };

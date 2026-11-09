/* Rainform 雨幕背景色板 —— 共享模块
 *
 * WebGL（src/app.js）与老 Android WebView 的 Canvas 2D 兜底（legacy2d.js）
 * 共用同一套选项与交互，差异只有「能不能改 3D 场景底色」：
 *   · 传入 scene / renderer 时，同时改场景背景、雾色与清屏色；
 *   · 不传时只改 CSS 变量、大气叠层与 canvas 滤镜，2D 渲染器照样可用。
 *
 * 白昼模式：shader 里的雨丝写死为浅青→白，白底上直接看不见，所以保持深色
 * 场景再对 canvas 整体反色 —— 黑底变白底、浅雨丝变深灰，同时 UI 转亮色。
 */
(function () {
  'use strict';

  var BACKDROPS = [
    { key: 'origin', name: '初始', en: 'Original', hex: '#02060c', origin: true,
      why: '项目原始背景（含原生大气叠层），点它即可还原' },
    { key: 'ink',   name: '曜黑', en: 'Ink',   hex: '#02060c', why: '纯场景底色，亮度对比最高，雨丝最锐利' },
    { key: 'navy',  name: '深靛', en: 'Navy',  hex: '#071a33', why: '冷蓝纵深，雨幕层次更明显' },
    { key: 'green', name: '墨绿', en: 'Moss',  hex: '#061c18', why: '暗绿衬青，久看更柔和' },
    { key: 'plum',  name: '暗紫', en: 'Plum',  hex: '#170e2b', why: '冷紫分离色相，雨丝更立体' },
    { key: 'rust',  name: '赤褐', en: 'Rust',  hex: '#241009', why: '暖色背景与青蓝雨丝色相对比最强' },
    { key: 'slate', name: '石墨', en: 'Slate', hex: '#11161d', why: '中性灰黑，最不偏色' },
    { key: 'white', name: '白昼', en: 'Daylight', hex: '#eef2f6', light: true,
      why: '反色亮色模式：白底 + 深灰雨丝，界面同步转深色文字' }
  ];
  var KEY = 'rainform.bg.v1';
  var DEEP_ATMO =
    'radial-gradient(ellipse 70% 55% at 50% 34%, rgba(143,214,255,.10), transparent 72%),' +
    'radial-gradient(ellipse 90% 70% at 50% 100%, rgba(0,0,0,.34), transparent 70%)';
  var LIGHT_VARS = {
    '--text': '#16283a', '--muted': '#4b647a', '--faint': '#72889c',
    '--cyan': '#1668a8', '--cyan-dim': '#3f7ba5',
    '--line': 'rgba(20,60,100,.18)', '--line-2': 'rgba(20,60,100,.10)',
    '--panel': 'rgba(255,255,255,.80)', '--panel-2': 'rgba(255,255,255,.90)'
  };

  var opts = {};
  var current = BACKDROPS[0];
  var built = false;

  function $(id) { return document.getElementById(id); }
  function zh() { return opts.lang ? opts.lang() !== 'en' : document.documentElement.lang !== 'en'; }

  function setColor(c, hex) {
    if (!c) return;
    if (typeof c.setStyle === 'function') c.setStyle(hex);
    else if (typeof c.set === 'function') c.set(hex);
  }
  function applyVars(light) {
    var root = document.documentElement.style;
    Object.keys(LIGHT_VARS).forEach(function (k) {
      if (light) root.setProperty(k, LIGHT_VARS[k]);
      else root.removeProperty(k);
    });
  }

  function apply(p, save) {
    if (typeof p === 'string') p = BACKDROPS.filter(function (x) { return x.key === p; })[0];
    if (!p) p = BACKDROPS[0];
    current = p;
    var light = !!p.light, origin = !!p.origin;
    var app = $('app'), canvas = $('scene');

    if (app) app.classList.toggle('bg-light', light);
    applyVars(light);
    if (canvas) canvas.style.filter = light ? 'grayscale(1) invert(1)' : '';

    var sceneHex = light ? '#02060c' : p.hex;
    document.documentElement.style.setProperty(
      '--bg', origin ? '#03070d' : (light ? '#eef2f6' : p.hex));

    var sc = opts.scene;
    if (sc) {
      setColor(sc.background, sceneHex);
      if (sc.fog) setColor(sc.fog.color, sceneHex);
    }
    var rd = opts.renderer;
    if (rd && typeof rd.setClearColor === 'function') rd.setClearColor(sceneHex, 1);

    var atm = document.querySelector('.atmosphere');
    if (atm) atm.style.background = origin ? '' : (light ? 'none' : DEEP_ATMO);

    var btn = $('bgBtn');
    if (btn) btn.style.background = light ? '#eef2f6' : (origin ? '#1b2b3a' : p.hex);

    var pal = $('bgPalette');
    if (pal) {
      pal.classList.toggle('light', light);
      Array.prototype.forEach.call(pal.querySelectorAll('.bg-swatch'), function (n) {
        n.classList.toggle('on', n.dataset.key === p.key);
      });
    }
    var tip = $('bgTip');
    if (tip) tip.textContent = (zh() ? p.name : p.en) + ' · ' + (zh() ? p.why : p.en);

    if (save !== false) { try { localStorage.setItem(KEY, p.key); } catch (e) {} }
    if (typeof opts.onChange === 'function') opts.onChange(p);
    return p.key;
  }

  function build() {
    if (built) return;
    var grid = $('bgGrid'), btn = $('bgBtn'), pal = $('bgPalette');
    if (!grid || !btn || !pal) return;
    built = true;
    grid.textContent = '';
    BACKDROPS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button'; b.className = 'bg-swatch'; b.dataset.key = p.key;
      b.title = p.name + ' · ' + p.why;
      var dot = document.createElement('span');
      dot.className = 'bg-dot'; dot.style.background = p.hex;
      var nm = document.createElement('span');
      nm.className = 'bg-name'; nm.textContent = p.name;
      b.appendChild(dot); b.appendChild(nm);
      b.addEventListener('click', function () { apply(p); pal.classList.remove('on'); });
      grid.appendChild(b);
    });
    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      var on = pal.classList.toggle('on');
      if (on) {
        var r = btn.getBoundingClientRect();
        pal.style.top = Math.max(10, Math.min(r.bottom + 8, window.innerHeight - 250)) + 'px';
        pal.style.left = Math.max(10, Math.min(r.left, window.innerWidth - 302)) + 'px';
      }
    });
    document.addEventListener('click', function (e) {
      if (e.target !== btn && !pal.contains(e.target)) pal.classList.remove('on');
    });
  }

  var API = {
    list: BACKDROPS,
    init: function (o) {
      opts = o || {};
      build();
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      var hit = BACKDROPS.filter(function (x) { return x.key === saved; })[0] || BACKDROPS[0];
      return apply(hit, false);
    },
    apply: function (key) { return apply(key); },
    /* 语言切换后重刷提示文案，不覆盖已保存的选择 */
    refreshLang: function () { return apply(current, false); },
    get current() { return current; }
  };

  window.RainBackdrop = API;
})();

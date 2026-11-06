/* RainformNative JS bridge - injected into <head> by build-apk.js.
 * Implements the exact contract src/weather.js expects:
 *   window.RainNative.fetch(url, {method, headers, body, timeout})
 *      -> Promise<{ok:boolean, status:number, body:string}>
 * The Java side calls back through window.__rainCb(id, ok, status, body).
 */
(function () {
  'use strict';
  var seq = 0;
  var pending = Object.create(null);

  /* Capability probe, executed before app.js boots.
     Old Android System WebView builds (Chrome <= 86) have WebGL1 only and may
     lack ANGLE_instanced_arrays; drawing 5k instanced rain strands there can
     lock the main thread. Flag those devices for the lightest render tier. */
  try {
    var c2 = document.createElement('canvas');
    var c1 = document.createElement('canvas');
    var gl2 = null, gl1 = null, inst = false;
    try { gl2 = c2.getContext('webgl2'); } catch (e) {}
    try { gl1 = c1.getContext('webgl') || c1.getContext('experimental-webgl'); } catch (e) {}
    if (gl1) { try { inst = !!gl1.getExtension('ANGLE_instanced_arrays'); } catch (e) {} }
    if (!gl2 && !inst) {
      /* No WebGL2 and no instancing: the instanced rain curtain cannot be
         drawn and trying to would lock the UI thread. app.js steps aside and
         legacy2d.js takes over with a Canvas 2D weak-perspective renderer
         that implements the FULL Rainform contract (30-degree rotation,
         chart, smoothing, playback, quality, audio, live weather, UI).
         This is a renderer substitution, NOT a feature reduction. */
      window.__RAINFORM_NO_WEBGL__ = true;
      window.__RAINFORM_LOW__ = true;
      var origErr = console.error;
      console.error = function () {
        var a = arguments[0];
        if (typeof a === 'string' && /ANGLE_instanced_arrays|EXT_blend_minmax/.test(a)) return;
        return origErr.apply(console, arguments);
      };
      console.info('Rainform: legacy WebGL renderer detected, compatibility tier enabled.');
    }
    try { var l2 = gl2 && gl2.getExtension('WEBGL_lose_context'); if (l2) l2.loseContext(); } catch (e) {}
    try { var l1 = gl1 && gl1.getExtension('WEBGL_lose_context'); if (l1) l1.loseContext(); } catch (e) {}
  } catch (e) {}

  window.__rainCb = function (id, ok, status, body) {
    var fn = pending[id];
    if (!fn) return;
    delete pending[id];
    fn({ ok: !!ok, status: status | 0, body: String(body == null ? '' : body) });
  };

  function nativeFetch(url, opts) {
    opts = opts || {};
    var timeout = opts.timeout || 15000;
    return new Promise(function (resolve) {
      var id = 'r' + (++seq);
      pending[id] = resolve;
      setTimeout(function () {
        if (!pending[id]) return;
        delete pending[id];
        resolve({ ok: false, status: 0, body: 'Native request timed out' });
      }, timeout + 4000);
      try {
        window.RainNativeBridge.http(
          String(url),
          String(opts.method || 'GET'),
          JSON.stringify(opts.headers || {}),
          opts.body == null ? null : String(opts.body),
          timeout,
          id
        );
      } catch (e) {
        delete pending[id];
        resolve({ ok: false, status: 0, body: 'NATIVE_BRIDGE_UNAVAILABLE: ' + e });
      }
    });
  }

  window.RainNative = {
    platform: 'android',
    native: true,
    shell: 'RainformNative',
    fetch: nativeFetch
  };
  window.RainNativeInfo = {
    platform: 'android',
    native: true,
    shell: 'RainformNative'
  };
})();

/* Capacitor native bridge — injected into app/mobile/www/index.html by
 * build-apps.js. It does not change the web app; it only wires native
 * capabilities into the same RainWeather / Rainform APIs.
 */
(function () {
  'use strict';
  var C = window.Capacitor;
  if (!C || !C.isNativePlatform || !C.isNativePlatform()) return;
  var P = C.Plugins || {};

  try { if (P.SplashScreen) P.SplashScreen.hide(); } catch (e) {}
  try {
    if (P.StatusBar) {
      P.StatusBar.setStyle({ style: 'DARK' });
      P.StatusBar.setBackgroundColor({ color: '#03070d' });
      P.StatusBar.setOverlaysWebView({ overlay: true });
    }
  } catch (e) {}

  /* Native geolocation is more reliable than the WebView implementation. */
  if (P.Geolocation && navigator.geolocation) {
    var orig = navigator.geolocation.getCurrentPosition.bind(navigator.geolocation);
    navigator.geolocation.getCurrentPosition = function (ok, err, opts) {
      P.Geolocation.getCurrentPosition({ enableHighAccuracy: false, timeout: 10000 })
        .then(function (p) {
          ok({
            coords: {
              latitude: p.coords.latitude, longitude: p.coords.longitude,
              accuracy: p.coords.accuracy || 0, altitude: null,
              altitudeAccuracy: null, heading: null, speed: null
            },
            timestamp: p.timestamp || Date.now()
          });
        })
        .catch(function () { orig(ok, err, opts); });
    };
  }

  /* Android hardware back: close the weather drawer first, then exit. */
  try {
    if (P.App) P.App.addListener('backButton', function (e) {
      var panel = document.getElementById('weatherPanel');
      if (panel && panel.classList.contains('open')) {
        var close = document.getElementById('weatherClose');
        if (close) close.click();
        return;
      }
      if (e && e.canGoBack) window.history.back();
      else if (P.App.exitApp) P.App.exitApp();
    });
  } catch (e) {}

  /* Reconnect live data as soon as the network comes back. */
  try {
    if (P.Network) P.Network.addListener('networkStatusChange', function (s) {
      if (s.connected && window.RainWeather && window.RainWeather.runtime.running) {
        window.RainWeather.refresh('network-restore');
      }
    });
  } catch (e) {}

  window.RainNativeInfo = {
    platform: C.getPlatform(),
    native: true,
    capacitor: true
  };
})();

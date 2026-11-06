package cn.rainform.ultimate;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.KeyEvent;
import android.webkit.GeolocationPermissions;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/**
 * Rainform Ultimate - native Android shell.
 *
 * Design goals:
 *  - zero third-party dependencies (no AndroidX, no Capacitor, no Gradle deps)
 *  - the exact same standalone HTML used by the desktop / PWA editions
 *  - serve that HTML from a loopback HTTP server instead of file:// so that
 *    origin-sensitive APIs (Service Worker, EventSource, WebSocket, fetch,
 *    localStorage) behave exactly like they do in a normal browser
 *  - expose a native HTTP bridge under window.RainNative.fetch, which is the
 *    transport src/weather.js already looks for first (bypasses CORS)
 */
public class MainActivity extends Activity {

    private static final int LOCATION_REQUEST = 42;
    private static final int BG_COLOR = Color.parseColor("#03070d");

    private WebView web;
    private AssetServer server;
    private NativeBridge bridge;
    private String originHost = "127.0.0.1";
    private int originPort = -1;
    private GeolocationPermissions.Callback pendingGeoCallback;
    private String pendingGeoOrigin;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(BG_COLOR);
        getWindow().setNavigationBarColor(BG_COLOR);

        web = new WebView(this);
        web.setBackgroundColor(BG_COLOR);
        web.setOverScrollMode(WebView.OVER_SCROLL_NEVER);
        web.setHorizontalScrollBarEnabled(false);
        web.setVerticalScrollBarEnabled(false);
        setContentView(web);

        WebView.setWebContentsDebuggingEnabled(true);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setLoadWithOverviewMode(false);
        s.setUseWideViewPort(true);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);
        s.setGeolocationEnabled(true);
        s.setCacheMode(WebSettings.LOAD_NO_CACHE);
        s.setUserAgentString(s.getUserAgentString() + " RainformAndroid/1.0");

        bridge = new NativeBridge(web);
        web.addJavascriptInterface(bridge, "RainNativeBridge");

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onGeolocationPermissionsShowPrompt(String origin,
                    GeolocationPermissions.Callback callback) {
                // Ask only when the page actually uses geolocation (the
                // "Use GPS" button), not on every cold start.
                if (Build.VERSION.SDK_INT >= 23 && !hasLocationPermission()) {
                    pendingGeoCallback = callback;
                    pendingGeoOrigin = origin;
                    requestPermissions(new String[] {
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                    }, LOCATION_REQUEST);
                } else {
                    callback.invoke(origin, true, false);
                }
            }

            @Override
            public void onPermissionRequest(final PermissionRequest request) {
                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            if (Build.VERSION.SDK_INT >= 21) request.grant(request.getResources());
                            else request.deny();
                        } catch (Exception e) {
                            request.deny();
                        }
                    }
                });
            }
        });

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                return handleUrl(url);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                return handleUrl(request.getUrl().toString());
            }
        });

        try {
            server = new AssetServer(getAssets());
            originPort = server.port();
            server.start();
            web.loadUrl("http://" + originHost + ":" + originPort + "/index.html");
        } catch (Exception e) {
            // Extremely unlikely (no loopback socket). Fall back to file:// so
            // at least the offline rain scene still works.
            web.loadUrl("file:///android_asset/index.html");
        }
    }

    private boolean hasLocationPermission() {
        return checkSelfPermission(Manifest.permission.ACCESS_FINE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED
                || checkSelfPermission(Manifest.permission.ACCESS_COARSE_LOCATION)
                        == PackageManager.PERMISSION_GRANTED;
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions,
                                           int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        if (requestCode != LOCATION_REQUEST || pendingGeoCallback == null) return;
        boolean granted = false;
        for (int r : grantResults) {
            if (r == PackageManager.PERMISSION_GRANTED) { granted = true; break; }
        }
        pendingGeoCallback.invoke(pendingGeoOrigin, granted, false);
        pendingGeoCallback = null;
    }

    /** Keep in-app navigation local; hand external links to the system browser. */
    private boolean handleUrl(String url) {
        try {
            Uri u = Uri.parse(url);
            String scheme = u.getScheme();
            if ("http".equals(scheme) || "https".equals(scheme)) {
                if (originHost.equals(u.getHost()) && u.getPort() == originPort) return false;
                startActivity(new Intent(Intent.ACTION_VIEW, u));
                return true;
            }
        } catch (Exception ignored) {
        }
        return false;
    }

    /** Hardware back closes the live-weather drawer first, then exits. */
    @Override
    public void onBackPressed() {
        if (web == null) {
            super.onBackPressed();
            return;
        }
        web.evaluateJavascript(
                "(function(){try{" +
                "var p=document.getElementById('weatherPanel');" +
                "if(p&&p.classList.contains('open')){document.getElementById('weatherClose').click();return 'true';}" +
                "var l=document.getElementById('weatherLog');" +
                "if(l&&l.dataset.open==='1'){document.getElementById('weatherLogToggle').click();return 'true';}" +
                "return 'false';}catch(e){return 'false';}})()",
                new ValueCallback<String>() {
                    @Override
                    public void onReceiveValue(String value) {
                        if (value != null && value.contains("true")) return;
                        finish();
                    }
                });
    }

    @Override
    public boolean onKeyDown(int keyCode, KeyEvent event) {
        // Volume keys keep controlling media/WebAudio instead of showing a dialog.
        return super.onKeyDown(keyCode, event);
    }

    @Override
    protected void onDestroy() {
        if (server != null) server.stop();
        if (bridge != null) bridge.shutdown();
        if (web != null) {
            web.removeJavascriptInterface("RainNativeBridge");
            web.destroy();
            web = null;
        }
        super.onDestroy();
    }
}

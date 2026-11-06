package cn.rainform.ultimate;

import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.Iterator;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Native HTTP transport exposed to the page as window.RainNative.fetch.
 *
 * src/weather.js checks for this object before browser fetch and CapacitorHttp,
 * so all REST / crawl / geocoding / custom-endpoint traffic from the Android
 * app goes through here and is therefore immune to browser CORS rules.
 * SSE and WebSocket sources stay on the browser stack (their loopback origin
 * is a normal http:// origin, so they work as-is).
 */
final class NativeBridge {

    private final WebView web;
    private final ExecutorService pool = Executors.newFixedThreadPool(4);

    NativeBridge(WebView web) {
        this.web = web;
    }

    void shutdown() {
        pool.shutdownNow();
    }

    @JavascriptInterface
    public void http(final String url, final String method, final String headersJson,
                     final String body, final int timeout, final String callbackId) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                doHttp(url, method, headersJson, body, timeout, callbackId);
            }
        });
    }

    @JavascriptInterface
    public String info() {
        return "{\"platform\":\"android\",\"shell\":\"RainformNative\",\"native\":true}";
    }

    @JavascriptInterface
    public void toast(final String message) {
        web.post(new Runnable() {
            @Override
            public void run() {
                Toast.makeText(web.getContext(), message, Toast.LENGTH_SHORT).show();
            }
        });
    }

    private void doHttp(String url, String method, String headersJson,
                        String body, int timeout, String callbackId) {
        HttpURLConnection conn = null;
        final int ms = Math.max(1500, Math.min(timeout <= 0 ? 15000 : timeout, 120000));
        try {
            String verb = (method == null || method.length() == 0)
                    ? "GET" : method.toUpperCase(java.util.Locale.US);
            URL target = new URL(url);
            conn = (HttpURLConnection) target.openConnection();
            conn.setRequestMethod(verb);
            conn.setConnectTimeout(ms);
            conn.setReadTimeout(ms);
            conn.setInstanceFollowRedirects(true);
            conn.setUseCaches(false);
            conn.setRequestProperty("User-Agent", "RainformAndroid/1.0");
            conn.setRequestProperty("Accept", "*/*");
            conn.setRequestProperty("Accept-Encoding", "identity");

            if (headersJson != null && headersJson.length() > 2) {
                JSONObject h = new JSONObject(headersJson);
                Iterator<String> keys = h.keys();
                while (keys.hasNext()) {
                    String k = keys.next();
                    Object v = h.opt(k);
                    if (v != null && !v.equals(JSONObject.NULL)) {
                        conn.setRequestProperty(k, String.valueOf(v));
                    }
                }
            }

            if (body != null && body.length() > 0 && !"GET".equals(verb) && !"HEAD".equals(verb)) {
                conn.setDoOutput(true);
                if (conn.getRequestProperty("Content-Type") == null) {
                    conn.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                }
                OutputStream os = conn.getOutputStream();
                os.write(body.getBytes(StandardCharsets.UTF_8));
                os.flush();
                os.close();
            }

            int status = conn.getResponseCode();
            InputStream is = (status >= 400) ? conn.getErrorStream() : conn.getInputStream();
            String text = (is == null) ? "" : readAll(is);
            deliver(callbackId, status >= 200 && status < 300, status, text);
        } catch (Exception e) {
            deliver(callbackId, false, 0, "NATIVE_HTTP_ERROR: " + e.getClass().getSimpleName()
                    + ": " + e.getMessage());
        } finally {
            if (conn != null) conn.disconnect();
        }
    }

    private void deliver(final String callbackId, final boolean ok,
                         final int status, final String body) {
        if (callbackId == null) return;
        final String script = "window.__rainCb("
                + JSONObject.quote(callbackId) + ","
                + ok + "," + status + ","
                + JSONObject.quote(body == null ? "" : body) + ")";
        web.post(new Runnable() {
            @Override
            public void run() {
                try {
                    web.evaluateJavascript(script, null);
                } catch (Exception ignored) {
                }
            }
        });
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        try {
            in.close();
        } catch (java.io.IOException ignored) {
        }
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }
}

package cn.rainform.ultimate;

import android.content.res.AssetManager;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Tiny loopback-only static server for the bundled WebView page.
 *
 * Serving over http://127.0.0.1 instead of file:// gives the page a real,
 * secure origin: localStorage, EventSource, WebSocket, fetch and WebAudio all
 * behave as they do in Chrome. Only 127.0.0.1 is bound, so the app exposes
 * nothing to the network.
 */
final class AssetServer {

    private final ServerSocket serverSocket;
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final byte[] page;
    private final byte[] icon;
    private volatile boolean running = true;

    AssetServer(AssetManager assets) throws IOException {
        page = readAsset(assets, "index.html");
        byte[] ico = new byte[0];
        try {
            ico = readAsset(assets, "icon.png");
        } catch (IOException ignored) {
        }
        icon = ico;
        serverSocket = new ServerSocket(0, 24, InetAddress.getByName("127.0.0.1"));
    }

    int port() {
        return serverSocket.getLocalPort();
    }

    void start() {
        Thread t = new Thread(new Runnable() {
            @Override
            public void run() {
                loop();
            }
        }, "rainform-asset-server");
        t.setDaemon(true);
        t.start();
    }

    void stop() {
        running = false;
        try {
            serverSocket.close();
        } catch (IOException ignored) {
        }
        pool.shutdownNow();
    }

    private void loop() {
        while (running) {
            try {
                final Socket client = serverSocket.accept();
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        serve(client);
                    }
                });
            } catch (IOException e) {
                if (!running) break;
            }
        }
    }

    private void serve(Socket client) {
        try {
            client.setSoTimeout(10000);
            BufferedReader in = new BufferedReader(
                    new InputStreamReader(client.getInputStream(), StandardCharsets.ISO_8859_1));
            String requestLine = in.readLine();
            String header;
            while ((header = in.readLine()) != null && header.length() > 0) {
                // drain request headers
            }

            String path = "/";
            if (requestLine != null) {
                String[] parts = requestLine.split(" ");
                if (parts.length > 1) path = parts[1];
            }
            int q = path.indexOf('?');
            if (q >= 0) path = path.substring(0, q);

            int code = 200;
            String type = "text/html; charset=utf-8";
            byte[] body = page;

            if (path.equals("/") || path.equals("/index.html") || path.startsWith("/index.html?")) {
                body = page;
            } else if (path.equals("/favicon.ico") || path.equals("/icon.png")) {
                if (icon.length > 0) {
                    body = icon;
                    type = "image/png";
                } else {
                    code = 404;
                    body = new byte[0];
                    type = "image/png";
                }
            } else if (path.equals("/sw.js")) {
                // The native shell has no offline need: everything is bundled.
                body = "self.addEventListener('install',function(){self.skipWaiting()});"
                        .getBytes(StandardCharsets.UTF_8);
                type = "application/javascript; charset=utf-8";
            } else if (path.equals("/manifest.webmanifest")) {
                body = ("{\"name\":\"Rainform\",\"short_name\":\"Rainform\","
                        + "\"display\":\"standalone\",\"start_url\":\"/\"}")
                        .getBytes(StandardCharsets.UTF_8);
                type = "application/manifest+json";
            } else if (path.equals("/api/shell")) {
                body = ("{\"shell\":\"RainformNative\",\"platform\":\"android\","
                        + "\"localServer\":true}")
                        .getBytes(StandardCharsets.UTF_8);
                type = "application/json; charset=utf-8";
            } else {
                code = 404;
                body = "Not found".getBytes(StandardCharsets.UTF_8);
                type = "text/plain; charset=utf-8";
            }

            OutputStream out = client.getOutputStream();
            StringBuilder head = new StringBuilder(220);
            head.append("HTTP/1.1 ").append(code == 200 ? "200 OK" : "404 Not Found").append("\r\n");
            head.append("Content-Type: ").append(type).append("\r\n");
            head.append("Content-Length: ").append(body.length).append("\r\n");
            head.append("Cache-Control: no-store, no-cache, must-revalidate\r\n");
            head.append("Access-Control-Allow-Origin: *\r\n");
            head.append("X-Content-Type-Options: nosniff\r\n");
            head.append("Connection: close\r\n\r\n");
            out.write(head.toString().getBytes(StandardCharsets.US_ASCII));
            out.write(body);
            out.flush();
        } catch (Exception ignored) {
        } finally {
            try {
                client.close();
            } catch (IOException ignored) {
            }
        }
    }

    private static byte[] readAsset(AssetManager assets, String name) throws IOException {
        InputStream in = assets.open(name);
        try {
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
            return out.toByteArray();
        } finally {
            in.close();
        }
    }
}

#!/usr/bin/env node
/* Demonstrates the "external system pushes data into the gateway" transport.
 *
 *   node weather/server/push-example.js --port 8787 --count 5
 *
 * Any real system can POST the same shape to /api/push: a rain gauge, an ETL
 * job, a scraper, a vendor webhook, a MQTT bridge, a database trigger...
 * The gateway normalizes it and broadcasts to SSE / WebSocket / long-poll
 * clients immediately. This is the lowest-latency real-time path.
 */
'use strict';
const http = require('http');

const port = 8787;
const count = 5;
const token = process.env.RAINFORM_TOKEN || '';

function frame(i) {
  const values = Array.from({ length: 25 }, (_, h) =>
    Math.max(0, Math.round((3 + 6 * Math.sin((h + i) / 3.2) + Math.random() * 2) * 10) / 10));
  return {
    schema: 'rainform.weather/1',
    source: 'rain-gauge-network',
    mode: 'push',
    location: { name: '区域雨量站 #' + (i % 3 + 1), lat: 31.2304, lon: 121.4737, timezone: 'Asia/Shanghai' },
    observedAt: new Date().toISOString(),
    unit: 'mm/h',
    values,
    meta: { batch: i, gauges: 12 }
  };
}

function push(i) {
  const body = JSON.stringify(frame(i));
  const req = http.request({
    host: '127.0.0.1', port, path: '/api/push', method: 'POST',
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
      token ? { Authorization: 'Bearer ' + token } : {})
  }, res => {
    let s = '';
    res.on('data', c => s += c);
    res.on('end', () => console.log('push', i, '->', res.statusCode, s.slice(0, 140)));
  });
  req.on('error', e => console.error('push failed:', e.message));
  req.end(body);
}

let i = 0;
push(i++);
const t = setInterval(() => {
  push(i++);
  if (i >= count) { clearInterval(t); setTimeout(() => process.exit(0), 500); }
}, 3000);

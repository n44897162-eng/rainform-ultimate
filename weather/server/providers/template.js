/* =============================================================================
 * PROVIDER TEMPLATE — copy this file, rename it, and restart the gateway.
 * This is the server-side "future real-time" extension point.
 * -----------------------------------------------------------------------------
 *   cp template.js my-station.js
 *   node ../../server.js --provider my-station
 *
 * A provider may return EITHER:
 *   A) a raw payload the gateway normalizes:
 *        { hourly: { time: ['2026-11-05T00:00', ...],
 *                    precipitation: [0.1, 0.0, ...] },
 *          city: '上海', latitude: 31.23, longitude: 121.47 }
 *      (also accepted: {values:[...]}, {data:[...]}, CSV-ish arrays)
 *   B) a complete WeatherFrame (schema + values[25]) — returned verbatim.
 *
 * Ideas for real integrations:
 *   - SQL / InfluxDB / TimescaleDB query for a regional gauge network
 *   - Redis / Kafka / MQTT consumer bridged to HTTP
 *   - a licensed vendor feed (CMA, QWeather, OpenWeather, MeteoBlue…)
 *   - your own ESP32 rain gauge posting to /api/push
 *   - a scheduled ETL job writing hourly JSON to disk
 * ========================================================================== */
'use strict';

module.exports = {
  id: 'my-station',                  // <- change to a unique id
  label: 'My regional rain gauges',
  description: 'Template provider — replace fetch() with your own data source.',

  /**
   * @param {object} query  URL query: {city, lat, lon, timezone, provider, ...}
   * @param {object} ctx    {config, timeoutMs, log}
   * @returns {Promise<object>} raw payload or a full WeatherFrame
   */
  async fetch(query, ctx) {
    // ---- EXAMPLE 1: read a JSON file written by your ETL job ---------------
    // const fs = require('fs'); const path = require('path');
    // const p = path.join(__dirname, '..', 'data', 'hourly.json');
    // return JSON.parse(fs.readFileSync(p, 'utf8'));

    // ---- EXAMPLE 2: licensed vendor API -----------------------------------
    // const u = 'https://api.vendor.example/hourly?lat=' + query.lat + '&lon=' + query.lon;
    // const r = await fetch(u, {headers:{Authorization:'Bearer ' + process.env.VENDOR_KEY}});
    // return await r.json();

    // ---- EXAMPLE 3: SQL database (pseudo-code) ----------------------------
    // const rows = await db.query('SELECT hour, mmh FROM rainfall WHERE city=$1 ORDER BY hour', [query.city]);
    // return { hourly: { time: rows.map(r => r.hour + ':00'), precipitation: rows.map(r => r.mmh) }, city: query.city };

    ctx.log && ctx.log('template provider called for', query.city);
    const time = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0') + ':00');
    const precipitation = time.map((_, i) =>
      Math.max(0, Math.round((2 + 5 * Math.sin(i / 3) + Math.random() * 1.5) * 10) / 10));
    return {
      city: query.city || 'My station',
      latitude: parseFloat(query.lat) || 0,
      longitude: parseFloat(query.lon) || 0,
      observedAt: new Date().toISOString(),
      hourly: { time, precipitation }
    };
  }
};

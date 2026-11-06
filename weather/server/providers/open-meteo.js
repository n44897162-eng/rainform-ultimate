/* Default upstream provider: Open-Meteo forecast API.
 * Free, no API key, CORS-enabled, global hourly precipitation.
 * https://open-meteo.com/en/docs
 *
 * Provider contract: module.exports = { id, label, description, fetch(query, ctx) }
 *   query : parsed URL query (lat, lon, city, timezone, provider, ...)
 *   ctx   : { config, timeoutMs, log }
 *   return: a payload that server.js `toFrame()` can normalize, or a full
 *           WeatherFrame (schema: 'rainform.weather/1' + values[25]).
 */
'use strict';

module.exports = {
  id: 'open-meteo',
  label: 'Open-Meteo (official, keyless)',
  description: 'Global hourly precipitation via the official Open-Meteo forecast API.',

  async fetch(query, ctx) {
    const lat = parseFloat(query.lat);
    const lon = parseFloat(query.lon);
    if (!isFinite(lat) || !isFinite(lon)) throw new Error('lat / lon required');

    const u = new URL('https://api.open-meteo.com/v1/forecast');
    u.searchParams.set('latitude', String(lat));
    u.searchParams.set('longitude', String(lon));
    u.searchParams.set('hourly', 'precipitation,temperature_2m,relative_humidity_2m,weather_code');
    u.searchParams.set('past_hours', '6');
    u.searchParams.set('forecast_hours', '24');
    u.searchParams.set('forecast_days', '2');
    u.searchParams.set('timezone', query.timezone && query.timezone !== 'auto' ? query.timezone : 'auto');

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), ctx.timeoutMs || 12000);
    try {
      const r = await fetch(u.toString(), {
        signal: ac.signal,
        headers: { 'Accept': 'application/json', 'User-Agent': 'Rainform-Weather-Gateway/1.0' }
      });
      if (!r.ok) throw new Error('Open-Meteo HTTP ' + r.status);
      const data = await r.json();
      if (!data || !data.hourly || !Array.isArray(data.hourly.precipitation)) {
        throw new Error('Unexpected Open-Meteo payload');
      }
      data.city = query.city || (lat.toFixed(2) + ', ' + lon.toFixed(2));
      return data;
    } finally {
      clearTimeout(timer);
    }
  }
};

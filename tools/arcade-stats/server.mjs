import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';

export const PORT = 4217;
export const UPSTREAM = 'https://rarerush.app/api/arcade-stats';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../..');
const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
const counters = ['uniquePlayers', 'startedRuns', 'completedRuns', 'survivedRuns', 'lostRuns', 'unfinishedRuns'];
const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']],
  ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']],
  ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/assets/rare-friend.svg', ['../../games/rare-rush/assets/favicon.svg', 'image/svg+xml']],
  ['/assets/sometype-mono.woff2', ['../../games/rare-rush/assets/fonts/sometype-mono-variable.woff2', 'font/woff2']],
  ['/assets/silkscreen.woff2', ['../../games/rare-rush/assets/fonts/silkscreen-regular.woff2', 'font/woff2']],
]);

function safeError(code, status = 503) {
  return Object.assign(new Error(code), { code, status });
}

/** Only these two settings are read. Values never reach the browser or logs. */
export function parseConfig(text, environment = {}) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(RUSH_ANALYTICS_URL|RUSH_ANALYTICS_ADMIN_KEY)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  const url = environment.RUSH_ANALYTICS_URL ?? values.RUSH_ANALYTICS_URL;
  const key = environment.RUSH_ANALYTICS_ADMIN_KEY ?? values.RUSH_ANALYTICS_ADMIN_KEY;
  if (!url || !key) throw safeError('not-configured');
  // A fixed public destination prevents this local reader from becoming a proxy.
  if (url !== UPSTREAM || typeof key !== 'string' || key.length < 16 || key.length > 4096 || /\s/.test(key)) throw safeError('invalid-config');
  return { url, key };
}

export async function loadConfig() {
  let text = '';
  try { text = await readFile(resolve(root, '.env.analytics.local'), 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw safeError('invalid-config'); }
  return parseConfig(text, process.env);
}

function iso(value, nullable = false) {
  if (nullable && value === null) return null;
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d\d-\d\dT/.test(value) || !Number.isFinite(Date.parse(value))) throw safeError('invalid-response');
  return new Date(value).toISOString();
}
function countSet(value) {
  if (!value || typeof value !== 'object') throw safeError('invalid-response');
  const result = Object.fromEntries(counters.map(key => {
    const number = value[key];
    if (!Number.isSafeInteger(number) || number < 0) throw safeError('invalid-response');
    return [key, number];
  }));
  if (result.completedRuns !== result.survivedRuns + result.lostRuns || result.startedRuns !== result.completedRuns + result.unfinishedRuns || result.uniquePlayers > result.startedRuns) throw safeError('invalid-response');
  return result;
}

/** Return only aggregate fields. Unexpected upstream data cannot leak through. */
export function sanitizeStats(value, days) {
  if (!value || value.version !== 1 || value.window?.days !== days || value.window?.timezone !== 'UTC' || value.scope?.source !== 'client-reported-arcade-events' || value.scope?.historicalBackfill !== false || value.scope?.ownerExcluded !== true || value.scope?.complete !== true || !Array.isArray(value.daily) || value.daily.length > 5000) throw safeError('invalid-response');
  const daily = value.daily.map(day => {
    if (!day || typeof day.date !== 'string' || !/^\d{4}-\d\d-\d\d$/.test(day.date) || new Date(day.date).toISOString().slice(0, 10) !== day.date) throw safeError('invalid-response');
    return { date: day.date, ...countSet(day) };
  });
  for (let index = 1; index < daily.length; index++) if (daily[index].date <= daily[index - 1].date) throw safeError('invalid-response');
  return {
    version: 1,
    generatedAt: iso(value.generatedAt),
    window: { days, from: iso(value.window.from, true), to: iso(value.window.to), timezone: 'UTC' },
    totals: countSet(value.totals),
    byCollection: Object.fromEntries(['genesis', 'generations'].map(key => [key, countSet(value.byCollection?.[key])])),
    byDifficulty: Object.fromEntries(['easy', 'normal', 'degen'].map(key => [key, countSet(value.byDifficulty?.[key])])),
    daily,
    earliestObservedStart: iso(value.earliestObservedStart, true),
    scope: { source: 'client-reported-arcade-events', historicalBackfill: false, ownerExcluded: true, complete: true },
  };
}

async function limitedText(response, limit) {
  const declared = Number(response.headers.get('content-length') ?? 0);
  if (declared > limit) throw safeError('invalid-response');
  const reader = response.body?.getReader();
  if (!reader) throw safeError('invalid-response');
  let size = 0;
  const chunks = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) { await reader.cancel(); throw safeError('invalid-response'); }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchStats(config, days, request, timeoutMs) {
  const abort = new AbortController();
  let timer;
  try {
    return await Promise.race([
      (async () => {
        const url = new URL(config.url);
        url.searchParams.set('days', days);
        const response = await request(url, { headers: { Authorization: `Bearer ${config.key}`, Accept: 'application/json' }, redirect: 'error', cache: 'no-store', signal: abort.signal });
        if (response.status === 401 || response.status === 403) throw safeError('unauthorized');
        if (!response.ok) {
          // Never return raw error bodies, headers, URLs, or exception messages.
          if (response.status === 503) {
            const hint = await limitedText(response, 4096);
            if (hint.length < 4096) {
              try { if (JSON.parse(hint).code === 'scan-limit') throw safeError('scan-limit'); }
              catch (error) { if (error.code === 'scan-limit') throw error; }
            }
          }
          throw safeError('upstream-unavailable');
        }
        const text = await limitedText(response, 1_000_000);
        let data;
        try { data = JSON.parse(text); }
        catch { throw safeError('invalid-response'); }
        return sanitizeStats(data, days);
      })(),
      new Promise((_, reject) => { timer = setTimeout(() => { abort.abort(); reject(safeError('timeout')); }, timeoutMs); }),
    ]);
  } catch (error) {
    if (['unauthorized', 'scan-limit', 'upstream-unavailable', 'invalid-response', 'timeout'].includes(error.code)) throw error;
    throw safeError('upstream-unavailable');
  } finally { clearTimeout(timer); abort.abort(); }
}

const messages = {
  'not-configured': 'Add the analytics URL and admin key to .env.analytics.local, then refresh.',
  'invalid-config': 'Check the two settings in .env.analytics.local, then refresh.',
  unauthorized: 'The analytics service did not accept the admin key. Check the saved key, then refresh.',
  'scan-limit': 'This date range is too large. Choose 7 days or 30 days.',
  'upstream-unavailable': 'The analytics service is unavailable. Try refreshing shortly.',
  'invalid-response': 'The analytics service returned an incomplete or unexpected response. No counts were replaced.',
  timeout: 'The analytics request timed out. Try refreshing shortly.',
};

export function createRequestHandler({ configLoader = loadConfig, request = fetch, timeoutMs = 10_000 } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Rare-Rush-Dashboard', 'arcade-stats-local-v1');
    res.setHeader('Content-Security-Policy', "default-src 'none'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'");
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const send = (status, body, type = 'application/json; charset=utf-8') => {
      res.statusCode = status;
      res.setHeader('Content-Type', type);
      res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
    };
    const host = req.headers.host;
    if (!hosts.has(host)) return send(403, { error: 'This dashboard is available only on its local address.' });
    const origin = req.headers.origin;
    if ((origin && origin !== `http://${host}`) || (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) return send(403, { error: 'Cross-origin requests are not allowed.' });
    if (req.method !== 'GET') return send(405, { error: 'Only GET is supported.' });
    let url;
    try { url = new URL(req.url, `http://${host}`); }
    catch { return send(400, { error: 'Invalid request.' }); }
    if (url.origin !== `http://${host}`) return send(400, { error: 'Invalid request.' });
    if (url.pathname === '/stats') {
      // A browser on another origin cannot add this header without a rejected CORS preflight.
      if (req.headers['x-rare-rush-local'] !== '1') return send(403, { error: 'Open the local dashboard to read stats.' });
      const days = url.searchParams.get('days') ?? '7';
      if (!['7', '30', 'all'].includes(days) || [...url.searchParams.keys()].some(key => key !== 'days') || url.searchParams.getAll('days').length > 1) return send(400, { error: 'Choose 7 days, 30 days, or all tracked time.' });
      try { return send(200, await fetchStats(await configLoader(), days, request, timeoutMs)); }
      catch (error) {
        const code = Object.hasOwn(messages, error.code) ? error.code : 'upstream-unavailable';
        return send(503, { code, error: messages[code] });
      }
    }
    if (url.search) return send(404, { error: 'Not found.' });
    const asset = files.get(url.pathname);
    if (!asset) return send(404, { error: 'Not found.' });
    try { return send(200, await readFile(resolve(here, asset[0])), asset[1]); }
    catch { return send(404, { error: 'Not found.' }); }
  };
}

export function startDashboard() {
  const server = http.createServer({ maxHeaderSize: 8192 }, createRequestHandler());
  server.requestTimeout = 15_000;
  server.headersTimeout = 5000;
  server.keepAliveTimeout = 5000;
  server.on('error', error => {
    console.error(error.code === 'EADDRINUSE' ? 'Port 4217 is already in use. Close the existing local dashboard and retry.' : 'The local dashboard could not start.');
    process.exitCode = 1;
  });
  server.listen(PORT, '127.0.0.1', () => console.log(`Rare Rush private Arcade stats: http://127.0.0.1:${PORT}`));
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) startDashboard();

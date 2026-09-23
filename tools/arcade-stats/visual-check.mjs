import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createRequestHandler, UPSTREAM } from './server.mjs';
const output = new URL('./artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const count = (startedRuns = 0, completedRuns = 0, survivedRuns = 0, uniquePlayers = 0) => ({ startedRuns, completedRuns, survivedRuns, lostRuns: completedRuns - survivedRuns, unfinishedRuns: startedRuns - completedRuns, uniquePlayers });
const fixture = days => ({ version: 1, generatedAt: '2026-09-23T12:00:00.000Z', window: { days, from: days === 'all' ? null : '2026-09-17T00:00:00.000Z', to: '2026-09-24T00:00:00.000Z', timezone: 'UTC' }, totals: count(241, 190, 124, 68), byCollection: { genesis: count(93, 82, 61, 28), generations: count(148, 108, 63, 46) }, byDifficulty: { easy: count(41, 38, 32, 21), normal: count(98, 80, 55, 37), degen: count(102, 72, 37, 42) }, daily: [15, 22, 29, 38, 45, 41, 51].map((starts, i) => ({ date: `2026-09-${17 + i}`, ...count(starts, Math.floor(starts * .79), Math.floor(starts * .5), Math.floor(starts * .55)) })), earliestObservedStart: '2026-09-17T12:00:00.000Z', scope: { source: 'client-reported-arcade-events', historicalBackfill: false, ownerExcluded: true, complete: true } });
let mode = 'success';
const upstreamCalls = [];
const secret = 'isolated-visual-check-not-a-real-admin-key';
const handler = createRequestHandler({ configLoader: async () => ({ url: UPSTREAM, key: secret }), request: async (url, options) => {
  upstreamCalls.push({ days: url.searchParams.get('days'), protected: options.headers.Authorization === `Bearer ${secret}` });
  if (mode === 'error') return Response.json({ error: 'Test outage' }, { status: 503 });
  const data = fixture(url.searchParams.get('days'));
  if (mode === 'empty') { data.totals = count(); data.daily = []; data.earliestObservedStart = null; for (const group of [data.byCollection, data.byDifficulty]) for (const key of Object.keys(group)) group[key] = count(); }
  return Response.json(data);
} });
const server = http.createServer(handler);
await new Promise((resolve, reject) => server.once('error', reject).listen(4217, '127.0.0.1', resolve));
let browser;
const errors = [], externalRequests = [];
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  async function pageAt(width, height) {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === 'http://127.0.0.1:4217') return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:4217'); await page.locator('#unique-players').filter({ hasText: '68' }).waitFor(); await page.evaluate(() => document.fonts.ready);
    return { context, page };
  }
  const { context, page } = await pageAt(1440, 1100);
  assert.equal(await page.locator('#window-label').textContent(), 'Sep 17, 2026 – Sep 23, 2026 · run start dates · UTC');
  assert.equal(await page.locator('#first-observed').textContent(), 'Sep 17, 2026 · UTC');
  assert.equal(await page.locator('#collection-rows tr').count(), 2); assert.equal(await page.locator('#mode-rows tr').count(), 3);
  async function markedShot(page, file) {
    await page.evaluate(() => { const badge = document.querySelector('.private-badge'); badge.textContent = 'TEST PREVIEW / MOCK COUNTS'; });
    await page.screenshot({ path: fileURLToPath(new URL(file, output)), fullPage: true });
  }
  await markedShot(page, 'desktop-mock.png');
  const download = page.waitForEvent('download'); await page.locator('#export').click(); const file = await download;
  await file.saveAs(fileURLToPath(new URL('mock-export.csv', output)));
  const csv = await readFile(new URL('mock-export.csv', output), 'utf8'); assert.ok(csv.includes('Unique playing wallets')); assert.ok(csv.includes('241')); assert.ok(!csv.includes(secret));
  await page.locator('[data-days="30"]').click(); await page.waitForFunction(() => document.querySelector('#refresh').disabled === false); assert.equal(await page.locator('[data-days="30"]').getAttribute('aria-pressed'), 'true');
  mode = 'error'; await page.locator('[data-days="all"]').click(); await page.waitForFunction(() => document.querySelector('#notice').classList.contains('error'));
  assert.match(await page.locator('#notice').textContent(), /last successful view/); assert.equal(await page.locator('#unique-players').textContent(), '68'); assert.equal(await page.locator('[data-days="30"]').getAttribute('aria-pressed'), 'true');
  await markedShot(page, 'error-stale-mock.png');
  mode = 'empty'; await page.locator('#refresh').click(); await page.locator('#unique-players').filter({ hasText: /^0$/ }).waitFor(); assert.match(await page.locator('#chart').textContent(), /No Arcade runs/); assert.equal(await page.locator('#export').isEnabled(), true);
  await markedShot(page, 'empty-mock.png'); await context.close();
  mode = 'success'; const mobile = await pageAt(390, 844); assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await markedShot(mobile.page, 'mobile-mock.png');
  assert.equal(await mobile.page.locator('#unique-players').textContent(), '68'); await mobile.context.close();
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.ok(upstreamCalls.every(call => call.protected));
  await writeFile(new URL('visual-check.json', output), JSON.stringify({ testDataOnly: true, liveAnalyticsRequests: 0, secretFileReads: 0, screenshots: ['desktop-mock.png', 'mobile-mock.png', 'error-stale-mock.png', 'empty-mock.png'], checks: ['responsive desktop and mobile', 'inclusive UTC end date', 'CSV only after valid data', 'failed refresh retains labeled stale data and matching selector', 'genuine zero distinct from error', 'no browser external requests', 'no browser errors', 'Bearer only in server-side mock transport'], upstreamCalls, errors, externalRequests }, null, 2));
  console.log('Private dashboard visual checks passed with isolated mock data; no real secret or live API accessed.');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

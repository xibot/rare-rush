import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
const output = new URL('./artifacts/', import.meta.url);
await mkdir(output, { recursive: true });
const arcadeCount = (startedRuns = 0, completedRuns = 0, survivedRuns = 0, uniquePlayers = 0) => ({ startedRuns, completedRuns, survivedRuns, lostRuns: completedRuns - survivedRuns, unfinishedRuns: startedRuns - completedRuns, uniquePlayers });
const testnetCount = (startedRuns = 0, claimedRuns = 0, abandonedRuns = 0, openRuns = 0, uniquePlayers = 0) => ({ startedRuns, claimedRuns, abandonedRuns, openRuns, expiredRuns: startedRuns - claimedRuns - abandonedRuns - openRuns, unresolvedRuns: startedRuns - claimedRuns - abandonedRuns, uniquePlayers });
const fixtures = (game, days, version) => {
  const common = { version: 1, mode: game, generatedAt: '2026-09-23T12:00:00.000Z', window: { days, from: days === 'all' ? null : '2026-09-17T00:00:00.000Z', to: '2026-09-24T00:00:00.000Z', timezone: 'UTC' }, earliestObservedStart: '2026-09-17T12:00:00.000Z' };
  if (game === 'arcade') return { ...common, totals: arcadeCount(241, 190, 124, 68), byCollection: { genesis: arcadeCount(93, 82, 61, 28), generations: arcadeCount(148, 108, 63, 46) }, byDifficulty: { easy: arcadeCount(41, 38, 32, 21), normal: arcadeCount(98, 80, 55, 37), degen: arcadeCount(102, 72, 37, 42) }, daily: [15, 22, 29, 38, 45, 41, 51].map((starts, i) => ({ date: `2026-09-${17 + i}`, ...arcadeCount(starts, Math.floor(starts * .79), Math.floor(starts * .5), Math.floor(starts * .55)) })), scope: { source: 'client-reported-arcade-events', historicalBackfill: false, ownerExcluded: true, complete: true } };
  const total = version === 'v1' ? testnetCount(6, 4, 1, 0, 3) : version === 'v2' ? testnetCount(18, 13, 1, 3, 7) : testnetCount(24, 17, 2, 3, 9);
  return { ...common, selection: { version }, totals: total, byCollection: { genesis: total, generations: testnetCount() }, byDifficulty: { easy: testnetCount(), normal: total, degen: testnetCount() }, daily: [{ date: '2026-09-23', ...total }], byVersion: { v1: testnetCount(6, 4, 1, 0, 3), v2: testnetCount(18, 13, 1, 3, 7) }, snapshot: { chainId: 46630, blockNumber: 123456789, blockTimestamp: '2026-09-23T11:59:59.000Z' }, scope: { source: 'onchain-testnet-runs', historicalBackfill: true, ownerExcluded: true, complete: true, versions: version === 'all' ? ['v1', 'v2'] : [version] } };
};
// This UI-only fixture server deliberately cannot load credentials or call a remote service.
// An ephemeral port leaves the real dashboard on 4217 undisturbed.
const files = new Map([
  ['/', ['public/index.html', 'text/html; charset=utf-8']], ['/app.js', ['public/app.js', 'text/javascript; charset=utf-8']], ['/style.css', ['public/style.css', 'text/css; charset=utf-8']],
  ['/assets/rare-friend.svg', ['../../games/rare-rush/assets/favicon.svg', 'image/svg+xml']],
  ['/assets/sometype-mono.woff2', ['../../games/rare-rush/assets/fonts/sometype-mono-variable.woff2', 'font/woff2']],
  ['/assets/silkscreen.woff2', ['../../games/rare-rush/assets/fonts/silkscreen-regular.woff2', 'font/woff2']],
]);
let behavior = 'success', delayMs = 0;
const localCalls = [];
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/stats') {
    const mode = url.searchParams.get('mode'), days = url.searchParams.get('days'), version = url.searchParams.get('version');
    localCalls.push({ mode, days, version, guarded: request.headers['x-rare-rush-local'] === '1' });
    const requestedBehavior = behavior, delay = delayMs;
    const data = fixtures(mode, days, version);
    if (requestedBehavior === 'empty') { const zero = mode === 'testnet' ? testnetCount : arcadeCount; data.totals = zero(); data.daily = []; data.earliestObservedStart = null; for (const group of [data.byCollection, data.byDifficulty]) for (const key of Object.keys(group)) group[key] = zero(); }
    if (requestedBehavior === 'wrong-source') data.scope.source = 'wrong-mode-source';
    if (delay) await new Promise(resolve => setTimeout(resolve, delay));
    response.setHeader('Content-Type', 'application/json');
    response.statusCode = requestedBehavior === 'error' ? 503 : 200;
    return response.end(JSON.stringify(requestedBehavior === 'error' ? { error: 'Test outage' } : data));
  }
  const file = files.get(url.pathname);
  if (!file) { response.statusCode = 404; return response.end(); }
  response.setHeader('Content-Type', file[1]);
  response.end(await readFile(new URL(file[0], import.meta.url)));
});
await new Promise((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
const errors = [], externalRequests = [], screenshots = [];
try {
  browser = await chromium.launch({ headless: true, channel: 'chrome' });
  const ready = page => page.waitForFunction(() => document.querySelector('#refresh').disabled === false);
  async function pageAt(width, height, hash = '') {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, acceptDownloads: true });
    await context.route('**/*', route => {
      if (new URL(route.request().url()).origin === origin) return route.continue();
      externalRequests.push(route.request().url()); return route.abort();
    });
    const page = await context.newPage(); page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${origin}/${hash}`); await ready(page); await page.evaluate(() => document.fonts.ready);
    return { context, page };
  }
  async function markedShot(page, file) {
    await page.evaluate(() => { document.querySelector('.private-badge').textContent = 'TEST PREVIEW / MOCK COUNTS'; });
    await page.screenshot({ path: fileURLToPath(new URL(file, output)), fullPage: true }); screenshots.push(file);
  }
  async function exportCsv(page, filename) {
    const download = page.waitForEvent('download'); await page.locator('#export').click(); const file = await download;
    await file.saveAs(fileURLToPath(new URL(filename, output)));
    return { content: await readFile(new URL(filename, output), 'utf8'), filename: file.suggestedFilename() };
  }
  const { context, page } = await pageAt(1440, 1100);
  assert.equal(await page.locator('#unique-players').textContent(), '68');
  assert.equal(await page.locator('#window-label').textContent(), 'Sep 17, 2026 – Sep 23, 2026 · run start dates · UTC');
  assert.equal(await page.locator('#first-observed').textContent(), 'Sep 17, 2026 · UTC');
  assert.equal(await page.locator('#collection-rows tr').count(), 2); assert.equal(await page.locator('#mode-rows tr').count(), 3);
  assert.equal(await page.locator('#contract-filter').isVisible(), false);
  await markedShot(page, 'arcade-desktop-mock.png');
  const arcadeCsv = await exportCsv(page, 'arcade-mock-export.csv'); assert.match(arcadeCsv.content, /Client-reported events/); assert.match(arcadeCsv.filename, /arcade-7days/);
  behavior = 'error'; await page.locator('[data-game="testnet"]').click(); await ready(page);
  assert.equal(await page.locator('#unique-players').textContent(), '—'); assert.equal(await page.locator('#export').isDisabled(), true);
  assert.match(await page.locator('#notice').textContent(), /No Testnet counts/); assert.equal(await page.locator('#third-label').textContent(), 'RUNS CLAIMED');
  await markedShot(page, 'testnet-first-error-mock.png');
  behavior = 'success'; await page.locator('#refresh').click(); await ready(page);
  assert.equal(await page.locator('#unique-players').textContent(), '9'); assert.equal(await page.locator('#completed-runs').textContent(), '17'); assert.equal(await page.locator('#survived-runs').textContent(), '5');
  assert.match(await page.locator('#survival-note').textContent(), /3 within claim window · 2 expired/); assert.equal(await page.locator('#daily-head th').count(), 8);
  assert.match(await page.locator('#snapshot-block').textContent(), /123,456,789/); assert.equal(await page.locator('[data-days="all"]').getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('#backfill').textContent(), 'From contract deployment');
  assert.match(await page.locator('#testnet-method').textContent(), /not a confirmed loss/);
  await markedShot(page, 'testnet-desktop-mock.png');
  const testnetCsv = await exportCsv(page, 'testnet-mock-export.csv'); assert.match(testnetCsv.content, /Claimed runs/); assert.ok(!testnetCsv.content.includes('Survived runs')); assert.match(testnetCsv.content, /123456789/); assert.match(testnetCsv.filename, /testnet-all-all-time/);
  await page.locator('[data-version="v1"]').click(); await ready(page); assert.equal(await page.locator('#started-runs').textContent(), '6');
  const legacyCsv = await exportCsv(page, 'testnet-v1-mock-export.csv'); assert.match(legacyCsv.filename, /testnet-v1-all-time/);
  behavior = 'error'; await page.locator('#refresh').click(); await ready(page); assert.equal(await page.locator('#started-runs').textContent(), '6'); assert.match(await page.locator('#notice').textContent(), /last successful Testnet snapshot for this exact view/);
  await markedShot(page, 'testnet-stale-error-mock.png');
  await page.locator('[data-days="30"]').click(); await ready(page); assert.equal(await page.locator('#started-runs').textContent(), '—'); assert.equal(await page.locator('#export').isDisabled(), true);
  behavior = 'wrong-source'; await page.locator('#refresh').click(); await ready(page); assert.equal(await page.locator('#started-runs').textContent(), '—'); assert.match(await page.locator('#notice').textContent(), /could not be loaded/);
  behavior = 'empty'; await page.locator('#refresh').click(); await ready(page); assert.equal(await page.locator('#unique-players').textContent(), '0'); assert.match(await page.locator('#chart').textContent(), /No Testnet runs/); assert.equal(await page.locator('#export').isEnabled(), true);
  await markedShot(page, 'testnet-empty-mock.png');
  behavior = 'success'; await page.locator('[data-game="arcade"]').click(); await ready(page); assert.equal(await page.locator('#unique-players').textContent(), '68'); assert.equal(await page.locator('#third-label').textContent(), 'RUNS FINISHED'); assert.equal(await page.locator('#daily-head th').count(), 7);
  // A slower Testnet response cannot overwrite Arcade after the user switches back.
  delayMs = 350; await page.locator('[data-game="testnet"]').click(); await page.locator('[data-game="arcade"]').click(); await ready(page); await page.waitForTimeout(400);
  assert.equal(await page.locator('#unique-players').textContent(), '68'); assert.equal(await page.locator('[data-game="arcade"]').getAttribute('aria-pressed'), 'true');
  delayMs = 0; behavior = 'empty'; await page.locator('#refresh').click(); await ready(page); assert.equal(await page.locator('#unique-players').textContent(), '0'); assert.match(await page.locator('#chart').textContent(), /No Arcade runs/);
  await markedShot(page, 'arcade-empty-mock.png'); await context.close();
  behavior = 'success'; const mobile = await pageAt(390, 844, '#testnet'); assert.equal(await mobile.page.locator('#unique-players').textContent(), '9'); assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await markedShot(mobile.page, 'testnet-mobile-mock.png');
  await mobile.page.locator('[data-game="arcade"]').click(); await ready(mobile.page); assert.equal(await mobile.page.locator('#unique-players').textContent(), '68'); assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)); await markedShot(mobile.page, 'arcade-mobile-mock.png');
  await mobile.page.setViewportSize({ width: 320, height: 700 }); assert.ok(await mobile.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await mobile.context.close();
  assert.deepEqual(errors, []); assert.deepEqual(externalRequests, []); assert.ok(localCalls.every(call => call.guarded));
  assert.ok(localCalls.filter(call => call.mode === 'arcade').every(call => call.version === null));
  assert.ok(localCalls.some(call => call.mode === 'testnet' && call.version === 'v1'));
  await writeFile(new URL('visual-check.json', output), JSON.stringify({ testDataOnly: true, liveAnalyticsRequests: 0, secretFileReads: 0, screenshots, checks: ['Arcade and Testnet responsive desktop and mobile', 'inclusive UTC end date', 'CSV matches active game, dates, and contract', 'source switch never labels Arcade counts as Testnet', 'exact-view stale data preserved and clearly labeled on failure', 'new date window errors do not reuse unrelated counts', 'wrong-source response rejected', 'late response cannot overwrite selected mode', 'genuine zero distinct from error', 'Testnet history and chain snapshot shown', 'claim and unresolved labels never infer losses', 'no browser external requests', 'no browser errors', 'guard header on every local stats request'], localCalls, errors, externalRequests }, null, 2));
  console.log('Arcade + Testnet dashboard visual checks passed with isolated mock data; no real secret or live API accessed.');
} finally { await browser?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }

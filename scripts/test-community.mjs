import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import { createRushSiteServer } from './rush-site.mjs';
import { createAgentSession, runSessionToEnd, exportAgentReplay, checkAgentReplay } from '../agent-play/runner.ts';

// Only this browser test supplies fixture replays; none enters the public build/store.
const seed = '0x' + '51'.repeat(32);
const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
const records = [1, 2].map(n => ({ id: String(n).repeat(64), source: 'testnet', collection: 1,
  tokenId: String(n), runId: String(n), difficulty: 'degen', seed, replay,
  player: '0x' + '1'.repeat(40), actor: n === 1 ? 'human' : 'agentic',
  createdAt: '2026-09-24T12:00:00Z', metrics: checkAgentReplay(seed, 'degen', replay),
  agent: n === 1 ? 'Human player' : 'Agentic player', verification: 'testnet-start-and-replay' }));
const summary = ({ replay, ...record }) => record;
const server = createRushSiteServer(fileURLToPath(new URL('../dist', import.meta.url)));
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, ...(process.env.RUSH_BROWSER_CHANNEL ? { channel: process.env.RUSH_BROWSER_CHANNEL } : {}) });
await mkdir('artifacts/community', { recursive: true });
try {
  for (const width of [1440, 1024, 768, 390, 320]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], writes = [];
    page.on('pageerror', error => { errors.push(error.message); console.error('PAGE:',error.message); });
    await page.route('**/api/runs**', async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      const id = url.pathname.split('/')[3];
      await route.fulfill({ json: id ? records.find(record => record.id === id)
        : { runs: [summary(records[url.searchParams.has('cursor') ? 1 : 0])], nextCursor: url.searchParams.has('cursor') ? null : 'next' } });
    });
    await page.goto(origin + '/runs-feed/');
    await page.locator('.runs-feed-card').waitFor().catch(async e=>{console.error((await page.locator('body').innerText()).slice(0,1500));throw e;});
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.title(), 'Rare Rush | Runs Feed');
    assert.equal(await page.locator('.site-header nav a').count(), 8);
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false, `${width}: feed overflow`);
    assert.equal(await page.getByRole('button', { name: 'PREVIEW', exact: true }).count(), 0, 'Public feed contains only actual Arcade/Testnet runs');
    assert.equal(await page.locator('.rush-leaderboard').count(), 0, 'Best of the Rush only appears on the Leaderboard page');
    const heart = page.locator('.runs-feed-like').first();
    await heart.click(); assert.equal(await heart.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'LOAD MORE RUNS', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.runs-feed-card').length === 2);
    await page.locator('.runs-feed-cover').first().click();
    await page.getByRole('dialog').waitFor();
    await page.locator('dialog .agent-stage-world').waitFor();
    assert.equal(await page.getByRole('dialog').getByRole('alert').count(), 0);
    await page.keyboard.press('Escape');
    await page.screenshot({ path: `artifacts/community/feed-${width}.png`, fullPage: true });
    await page.reload(); await page.locator('.runs-feed-card').waitFor();
    assert.equal(await page.locator('.runs-feed-like').first().getAttribute('aria-pressed'), 'true');
    await page.goto(`${origin}/runs-feed/?run=${records[1].id}`);
    await page.locator('dialog .agent-stage-world').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.site-header a[href="/leaderboard/"]').click();
    await page.locator('.leaderboard-row').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.title(), 'Rare Rush | Leaderboard');
    assert.equal(await page.locator('.site-header a[href="/leaderboard/"]').getAttribute('aria-current'), 'page');
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false, `${width}: Leaderboard overflow`);
    assert.equal(await page.locator('.runs-feed-card').count(), 0, 'Leaderboard uses ranked rows instead of the feed grid');
    await page.getByRole('button', { name: 'LOAD OLDER RUNS ↓', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.leaderboard-row').length === 2);
    const leaderboardRow = page.locator('.leaderboard-row').first();
    assert.deepEqual(await leaderboardRow.evaluate(row => [...row.children].slice(0, 3).map(child => child.className)),
      ['leaderboard-rank', 'leaderboard-thumbnail', 'leaderboard-friend'], 'Replay thumbnail sits between rank and Friend');
    await leaderboardRow.locator('.leaderboard-thumbnail').scrollIntoViewIfNeeded();
    await leaderboardRow.locator('[data-preview-state="ready"] .runs-feed-preview-scene').waitFor();
    const watch = leaderboardRow.locator('.leaderboard-watch');
    await watch.click();
    const leaderboardReplay = page.getByRole('dialog', { name: 'Watch saved run', exact: true });
    await leaderboardReplay.locator('.agent-stage-world').waitFor();
    assert.equal(await leaderboardReplay.getByRole('alert').count(), 0);
    await leaderboardReplay.getByRole('button', { name: 'Play replay', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.replay-modal progress')?.value > 0);
    await page.keyboard.press('Escape');
    assert.equal(await watch.evaluate(element => element === document.activeElement), true, 'Closing the popup restores the Watch button');
    assert.equal(new URL(page.url()).pathname, '/leaderboard/', 'Watching keeps the Leaderboard route');
    await page.screenshot({ path: `artifacts/community/leaderboard-${width}.png`, fullPage: true });
    await leaderboardRow.locator('.leaderboard-thumbnail').click();
    await leaderboardReplay.locator('.agent-stage-world').waitFor();
    await leaderboardReplay.getByRole('button', { name: 'Close replay', exact: true }).click();
    await page.locator('.site-header a[href="/agent-play/"]').click();
    assert.equal(await page.title(), 'Rare Rush | Agent Play');
    assert.equal(await page.locator('.rush-leaderboard, .library').count(), 0, 'Agent Play no longer includes the leaderboard');
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false, `${width}: Agent Play overflow`);
    await page.getByRole('tab', { name: /AGENTIC/ }).click();
    await page.locator('[data-agentic-skill]').waitFor();
    assert.equal(await page.locator('.agentic-local').innerText(), 'AGENT SKILL');
    assert.match(await page.locator('[data-agentic-skill]').innerText(), /cli.mjs publish --job/);
    await page.screenshot({ path: `artifacts/community/agentic-${width}.png`, fullPage: true });
    await page.getByRole('tab', { name: /AUTOPILOT/ }).click();
    await page.screenshot({ path: `artifacts/community/autopilot-${width}.png`, fullPage: true });
    if (width === 1440) {
      await page.clock.install();
      await page.getByRole('button', { name: /WATCH AGENT PLAY/ }).click();
      await page.getByRole('button', { name: '1× PLAYBACK', exact: true }).click();
      await page.getByRole('button', { name: '2× PLAYBACK', exact: true }).click();
      await page.clock.runFor(16_000);
      await page.getByRole('dialog', { name: 'Agent run result' }).waitFor();
      assert.equal(await page.getByRole('button', { name: 'SAVE RUN', exact: true }).count(), 0, 'Sample preview cannot publish');
    }
    assert.deepEqual(writes, [], 'Viewing/liking/Preview never publishes');
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`${width}px: public feed, leaderboard thumbnails/popups, paging, local favorites, deep link, skill and proportions passed`);
  }
  // Exercise both the server cursor and the locally buffered cards through the
  // same control. A fetched page must be visible after that one click.
  for (const remotePages of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
    const errors = [], listRequests = [], writes = [];
    const pagingRecords = Array.from({ length: 25 }, (_, index) => ({ ...summary(records[0]),
      id: (index + 10).toString(16).padStart(64, '0'), tokenId: String(index + 1), runId: String(index + 1),
      createdAt: new Date(Date.parse('2026-09-24T12:00:00Z') - index * 1000).toISOString() }));
    let failNextPage = remotePages, releasePage;
    const pendingPage = new Promise(resolve => { releasePage = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/runs**', async route => {
      const url = new URL(route.request().url());
      if (route.request().method() !== 'GET') writes.push(route.request().method());
      const id = url.pathname.split('/')[3];
      if (id) return route.fulfill({ json: { ...pagingRecords.find(record => record.id === id), replay } });
      const cursor = url.searchParams.get('cursor');
      listRequests.push(cursor);
      if (cursor === '12' && failNextPage) {
        failNextPage = false;
        return route.fulfill({ status: 503, json: { error: 'Temporary feed error. Try again.' } });
      }
      if (cursor === '12') await pendingPage;
      const offset = Number(cursor || 0), end = remotePages ? offset + 12 : pagingRecords.length;
      await route.fulfill({ json: { runs: pagingRecords.slice(offset, end), nextCursor: end < pagingRecords.length ? String(end) : null } });
    });
    try {
      await page.goto(origin + '/runs-feed/');
      await page.waitForFunction(() => document.querySelectorAll('.runs-feed-card').length === 12);
      const more = page.getByRole('button', { name: 'LOAD MORE RUNS', exact: true });
      assert.equal(await more.count(), 1, 'The feed has exactly one pagination control');
      assert.equal(await page.getByRole('button', { name: /LOAD OLDER RUNS/ }).count(), 0);
      if (remotePages) {
        await more.click();
        await page.getByRole('alert').filter({ hasText: 'Temporary feed error' }).waitFor();
        assert.equal(await page.locator('.runs-feed-card').count(), 12, 'A failed page preserves existing cards');
        assert.equal(await more.isEnabled(), true, 'The same load-more control retries a failed page');
        assert.deepEqual(listRequests, [null, '12']);
        await more.click();
        const loading = page.getByRole('button', { name: 'LOADING RUNS…', exact: true });
        await loading.waitFor();
        assert.equal(await loading.isDisabled(), true, 'Pagination is disabled while its request is pending');
        await loading.evaluate(button => { button.click(); button.click(); });
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
        assert.deepEqual(listRequests, [null, '12', '12'], 'Repeated clicks cannot start duplicate cursor requests');
        assert.equal(await page.locator('.runs-feed-card').count(), 12, 'Existing cards stay visible while loading');
        releasePage();
      } else {
        await more.click();
      }
      await page.waitForFunction(() => document.querySelectorAll('.runs-feed-card').length === 24);
      assert.equal(await more.count(), 1, 'One click reveals the next twelve cards without an extra reveal step');
      assert.equal(await page.getByRole('alert').count(), 0, 'A successful retry clears the page error');
      await more.click();
      await page.waitForFunction(() => document.querySelectorAll('.runs-feed-card').length === 25);
      assert.equal(await more.count(), 0, 'Pagination disappears after the final run');
      const runIds = await page.locator('.runs-feed-card').evaluateAll(cards => cards.map(card => card.dataset.runId));
      assert.deepEqual(runIds, pagingRecords.map(record => record.id), 'Cards remain unique and correctly ordered across pages');
      assert.deepEqual(listRequests, remotePages ? [null, '12', '12', '24'] : [null]);
      assert.deepEqual(errors, []);
      assert.deepEqual(writes, [], 'Loading more runs is read-only');
      console.log(`${remotePages ? 'Server cursor' : 'Buffered cards'}: single-control 12 → 24 → 25 paging, exhaustion${remotePages ? ', failure retry and duplicate-request protection' : ''} passed`);
    } finally {
      releasePage();
      await page.close();
    }
  }
  for (const file of ['agent-play/index.html', 'runs-feed/index.html', 'leaderboard/index.html', 'agent-skill/SKILL.md']) {
    assert.ok((await readFile(new URL('../dist/' + file, import.meta.url), 'utf8')).length);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

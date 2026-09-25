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
    assert.equal(await page.locator('.site-header nav a').count(), 7);
    assert.equal(await page.evaluate(() => document.body.scrollWidth > innerWidth), false, `${width}: feed overflow`);
    assert.equal(await page.getByRole('button', { name: 'PREVIEW', exact: true }).count(), 0, 'Public feed contains only actual Arcade/Testnet runs');
    const heart = page.locator('.runs-feed-like').first();
    await heart.click(); assert.equal(await heart.getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'LOAD OLDER RUNS ↓', exact: true }).click();
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
    await page.locator('.site-header a[href="/agent-play/"]').click();
    assert.equal(await page.title(), 'Rare Rush | Agent Play');
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
    console.log(`${width}px: public feed, paging, local favorites, deep link, skill and proportions passed`);
  }
  for (const file of ['agent-play/index.html', 'runs-feed/index.html', 'agent-skill/SKILL.md']) {
    assert.ok((await readFile(new URL('../dist/' + file, import.meta.url), 'utf8')).length);
  }
} finally {
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}

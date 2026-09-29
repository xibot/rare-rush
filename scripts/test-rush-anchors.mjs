import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildRushSite, createRushSiteServer } from './rush-site.mjs';

const outdir = await mkdtemp(path.join(tmpdir(), 'rare-rush-anchors-'));
let built, server, browser;

try {
  built = await buildRushSite({ outdir });
  server = createRushSiteServer(outdir);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.RUSH_BROWSER_CHANNEL ? { channel: process.env.RUSH_BROWSER_CHANNEL } : {}) });

  async function newPage(width = 1440, reducedMotion = 'no-preference') {
    const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion });
    const errors = [];
    const delayed = { scripts: 0, fonts: 0 };
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.origin !== origin) return route.abort();
      // These pages only need their navigation for this check, not a public feed.
      if (url.pathname === '/api/runs') return route.fulfill({ json: { runs: [], nextCursor: null } });
      if (url.pathname === '/landing.js') {
        delayed.scripts++;
        await new Promise(resolve => setTimeout(resolve, 600));
      } else if (request.resourceType() === 'font' && new URL(page.url()).pathname === '/') {
        delayed.fonts++;
        await new Promise(resolve => setTimeout(resolve, 900));
      }
      return route.continue();
    });
    return { page, errors, delayed };
  }

  async function assertAtHowToPlay(page) {
    await page.waitForURL(`${origin}/#how-to-play`);
    await page.locator('#how-to-play').waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Near the document bottom, native anchor scrolling stops at maxScroll.
    // Both the root padding and target margin contribute to its desired offset.
    const aligned = () => {
      const target = document.getElementById('how-to-play');
      if (!target) return false;
      const root = document.documentElement;
      const offset = (parseFloat(getComputedStyle(root).scrollPaddingTop) || 0)
        + (parseFloat(getComputedStyle(target).scrollMarginTop) || 0);
      const desired = target.getBoundingClientRect().top + window.scrollY - offset;
      const expected = Math.max(0, Math.min(desired, root.scrollHeight - innerHeight));
      return expected > 0 && Math.abs(window.scrollY - expected) <= 2;
    };
    try {
      await page.waitForFunction(aligned, undefined, { timeout: 5000 });
    } catch (error) {
      console.error(await page.locator('#how-to-play').evaluate(target => ({
        url: location.href, scroll: window.scrollY, targetTop: target.getBoundingClientRect().top,
        maxScroll: document.documentElement.scrollHeight - innerHeight,
        rootPadding: getComputedStyle(document.documentElement).scrollPaddingTop,
        targetMargin: getComputedStyle(target).scrollMarginTop,
      })));
      throw error;
    }
    assert(await page.locator('#how-to-play').evaluate(element => element.getBoundingClientRect().top < innerHeight), 'How to Play is in the viewport');
  }

  for (const from of ['/docs/', '/pitch/', '/arcade/', '/free-play/', '/agent-play/', '/runs-feed/', '/leaderboard/', '/genesis/', '/play/']) {
    const { page, errors, delayed } = await newPage();
    await page.goto(origin + from);
    const link = page.locator('.site-header .nav-how-to-play');
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), '/#how-to-play');
    await link.click();
    await assertAtHowToPlay(page);
    assert(delayed.scripts > 0, 'Cross-page checks delay React startup');
    assert.deepEqual(errors, [], `No browser errors from ${from}`);
    await page.close();
    console.log(`${from} → landing How to Play: correct anchor position after delayed React startup`);
  }

  for (const [width, reducedMotion] of [[1440, 'no-preference'], [390, 'reduce']]) {
    const { page, errors, delayed } = await newPage(width, reducedMotion);
    await page.goto(`${origin}/#how-to-play`);
    await assertAtHowToPlay(page);
    assert(delayed.fonts > 0, 'Direct navigation checks delay local fonts');
    await page.reload();
    await assertAtHowToPlay(page);

    await page.goto(origin);
    await page.locator('#how-to-play').waitFor();
    await page.evaluate(() => document.fonts.ready);
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'Plain homepage stays at the top');
    if (width > 800) {
      // A second click with the same hash must still return to the section.
      for (let repeat = 0; repeat < 2; repeat++) {
        await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
        await page.locator('.site-header .nav-how-to-play').click();
        await assertAtHowToPlay(page);
      }
    }
    assert.deepEqual(errors, [], `No browser errors at ${width}px`);
    await page.close();
    console.log(`${width}px: direct hash, reload, delayed fonts, plain homepage${width > 800 ? ', same-page and repeated clicks' : ', reduced motion'} passed`);
  }
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await built?.close();
  await rm(outdir, { recursive: true, force: true });
}

/** Isolated replay-thumbnail QA: temporary data, local requests, no wallet actions. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { advanceReplay, createAgentSession, createReplaySession, runSessionToEnd, exportAgentReplay, FIXED_STEP } from './runner.ts';
import { analyzeReplayPreview } from './replay-preview.ts';

const here = dirname(fileURLToPath(import.meta.url)), repo = resolve(here, '..');
const temporary = await mkdtemp(resolve(tmpdir(), 'rare-rush-thumbnail-qa-'));
const artifacts = resolve(here, 'artifacts/thumbnail-check');
const port = 4224, origin = `http://127.0.0.1:${port}`;
const failures = [], checks = [], requests = [];
let server, browser, page, serverOutput = '';
const check = message => { checks.push(message); console.log(`✓ ${message}`); };
const seed = number => '0x' + number.toString(16).padStart(64, '0');
const previewFor = (targetPage, id) => targetPage.locator(`.runs-feed-card[data-run-id="${id}"] .runs-feed-preview`);
const tick = async preview => Number(await preview.getAttribute('data-preview-tick'));
const loop = async preview => Number(await preview.getAttribute('data-preview-loop'));
const assignments = targetPage => targetPage.locator('.runs-feed-card').evaluateAll(cards => cards.map(card => {
  const preview = card.querySelector('.runs-feed-preview');
  return { id: card.getAttribute('data-run-id'), kind: preview?.getAttribute('data-preview-kind'),
    start: Number(preview?.getAttribute('data-preview-start')), end: Number(preview?.getAttribute('data-preview-end')) };
}));

function possibleDiversity(records) {
  const kinds = [...new Set(records.flatMap(record => record.catalogue.candidates.map(candidate => candidate.kind)))];
  let choices = new Set([0]);
  for (const record of records) {
    const bits = [...new Set(record.catalogue.candidates.map(candidate => 1 << kinds.indexOf(candidate.kind)))];
    choices = new Set([...choices].flatMap(mask => bits.map(bit => mask | bit)));
  }
  return Math.max(...[...choices].map(mask => mask.toString(2).replaceAll('0', '').length));
}

async function save(number) {
  const value = seed(number), session = runSessionToEnd(createAgentSession(value, 'degen'));
  const input = { source: 'local', collection: 1, tokenId: String(number), difficulty: 'degen', seed: value, replay: exportAgentReplay(session) };
  const response = await fetch(origin + '/api/runs', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
  const saved = await response.json();
  assert.equal(response.status, 200, saved.error);
  return { ...saved, replay: input.replay, catalogue: analyzeReplayPreview(input, input.replay) };
}

async function contextFor(reducedMotion, viewport) {
  const context = await browser.newContext({ viewport, reducedMotion });
  context.on('page', newPage => newPage.on('pageerror', error => failures.push(error.message)));
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    requests.push({ method: request.method(), path: url.pathname });
    if (url.origin !== origin) { failures.push(`Unexpected external request: ${url.origin}`); return route.abort(); }
    if (['/api/rpc', '/api/status', '/api/verify-run'].includes(url.pathname)) return route.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"Network disabled in thumbnail QA"}' });
    return route.continue();
  });
  return context;
}

async function expectAttribute(locator, name, expected) {
  // Playwright's timeout remains live while the page's animation clock is paused.
  await locator.locator(`xpath=self::*[@${name}="${expected}"]`).waitFor({ state: 'attached', timeout: 10_000 });
}

async function noOverflow(targetPage, label) {
  const size = await targetPage.evaluate(() => ({ width: innerWidth, content: document.documentElement.scrollWidth }));
  assert.ok(size.content <= size.width + 1, `${label}: ${JSON.stringify(size)}`);
}

async function pauseClock(targetPage) {
  await targetPage.clock.pauseAt(await targetPage.evaluate(() => Date.now() + 100));
  await targetPage.clock.runFor(150);
}

try {
  await mkdir(artifacts, { recursive: true });
  server = spawn(process.execPath, [resolve(here, 'serve.mjs')], { cwd: repo, env: { ...process.env, AGENT_PLAY_PORT: String(port), AGENT_PLAY_DATA_DIR: resolve(temporary, 'data'), AGENT_PLAY_OUT_DIR: resolve(temporary, 'out') }, stdio: ['ignore', 'pipe', 'pipe'] });
  server.stdout.on('data', chunk => serverOutput += chunk);
  server.stderr.on('data', chunk => serverOutput += chunk);
  for (let attempt = 0; attempt < 100 && !serverOutput.includes(`AGENT PLAY (local only): ${origin}/`); attempt++) {
    if (server.exitCode !== null) throw Error(serverOutput);
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(serverOutput.includes(`AGENT PLAY (local only): ${origin}/`), serverOutput);
  const saved = [];
  for (let number = 41; number < 49; number++) saved.push(await save(number));
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const context = await contextFor('no-preference', { width: 1440, height: 2600 });
  page = await context.newPage();
  await page.clock.install();
  await page.goto(origin + '/#runs-feed', { waitUntil: 'networkidle' });
  const cards = page.locator('.runs-feed-card');
  const toggle = page.getByRole('button', { name: 'ANIMATED PREVIEWS', exact: true });
  await toggle.waitFor();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'true');
  await page.waitForFunction(() => document.querySelectorAll('[data-preview-state="ready"]').length === 8);
  const activity = await page.locator('.runs-feed-preview').evaluateAll(elements => elements.map(element => {
    const rect = element.getBoundingClientRect();
    return { active: element.getAttribute('data-preview-animating') === 'true', visible: rect.top < innerHeight && rect.bottom > 0 };
  }));
  assert.equal(activity.filter(item => item.visible).length, 8, 'Eight covers are visible for the activity-cap check');
  assert.equal(activity.filter(item => item.active).length, 4, 'Only four visible covers animate');
  assert.equal(await cards.locator('[data-scene="connected-track"]').count(), 8, 'Ready previews use DirectionScene');
  check('Eight genuine saved replays render connected-track scenes; four visible covers animate');

  const selected = await assignments(page);
  assert.ok(new Set(selected.map(item => item.kind)).size >= Math.min(4, possibleDiversity(saved)), 'Assignments use at least four distinct excerpt kinds when the fixture catalogues support it');
  for (let index = 0; index < selected.length; index++) {
    const selection = selected[index], record = saved.find(item => item.id === selection.id);
    assert.ok(Number.isInteger(selection.start) && Number.isInteger(selection.end) && selection.end > selection.start, 'Selected excerpt has valid tick boundaries');
    assert.ok(record.catalogue.candidates.some(candidate => candidate.kind === selection.kind && candidate.startTick === selection.start && candidate.endTick === selection.end), 'Displayed excerpt is an actual candidate from that recording');
    const previous = selected[index - 1];
    if (previous && record.catalogue.candidates.some(candidate => candidate.kind !== previous.kind)) {
      assert.notEqual(selection.kind, previous.kind, `Adjacent excerpts should differ when ${selection.id} has alternatives`);
    }
    if (selection.kind === 'side') {
      const canonical = createReplaySession(record.seed, record.difficulty, record.replay);
      while (canonical.run._tick < selection.start) advanceReplay(canonical);
      const through = Math.min(selection.end - 1, selection.start + Math.round(1 / FIXED_STEP));
      while (canonical.run._tick <= through) {
        assert.equal(canonical.run.phase, 'side', 'Side excerpt stays on the horizontal track for its opening second');
        assert.equal(!!canonical.run.transition, false, 'Side excerpt does not immediately enter a transition');
        if (canonical.run._tick === through) break;
        advanceReplay(canonical);
      }
    }
  }
  check(`Adjacent covers use varied actual excerpts (${[...new Set(selected.map(item => item.kind))].join(', ')}); side excerpts remain horizontal`);

  await page.setViewportSize({ width: 1440, height: 850 });
  const targetId = await cards.first().getAttribute('data-run-id');
  const target = page.locator(`.runs-feed-card[data-run-id="${targetId}"]`);
  const preview = previewFor(page, targetId);
  await target.scrollIntoViewIfNeeded();
  await expectAttribute(preview, 'data-preview-animating', 'true');
  await pauseClock(page);
  const before = await tick(preview), beforeLoop = await loop(preview);
  await page.clock.runFor(1000);
  const after = await tick(preview), afterLoop = await loop(preview);
  const chosen = selected.find(record => record.id === targetId), clipTicks = chosen.end - chosen.start;
  const advanced = after - before + (afterLoop - beforeLoop) * clipTicks;
  assert.ok(advanced >= 100 && advanced <= 140, `One second should advance about 120 physics ticks, got ${advanced}`);
  const firstLoop = await loop(preview);
  const clipMs = clipTicks * FIXED_STEP * 1000, loopMs = Math.max(6500, Math.ceil(clipMs + 500));
  const polled = page.waitForResponse(response => response.url() === origin + '/api/runs' && response.status() === 200, { timeout: 10_000 });
  await page.clock.runFor(loopMs);
  await polled;
  const loops = await loop(preview) - firstLoop;
  assert.ok(loops >= 1 && loops <= Math.ceil(loopMs / clipMs), `The selected ${clipMs}ms excerpt should loop in ${loopMs}ms, got ${loops}`);
  assert.deepEqual(await assignments(page), selected, 'Polling and looping preserve the selected excerpts');
  check('Saved input previews advance at approximately 1× and loop their selected excerpt without changing assignments after polling');

  await cards.last().scrollIntoViewIfNeeded();
  await expectAttribute(preview, 'data-preview-animating', 'false');
  const offscreen = await preview.evaluate(element => element.getBoundingClientRect().bottom <= 0);
  assert.equal(offscreen, true, 'The observed cover is outside the viewport');
  const hiddenTick = await tick(preview), hiddenLoop = await loop(preview);
  await page.clock.runFor(1100);
  assert.equal(await tick(preview), hiddenTick);
  assert.equal(await loop(preview), hiddenLoop);
  await target.scrollIntoViewIfNeeded();
  await expectAttribute(preview, 'data-preview-animating', 'true');
  check('Offscreen covers stop advancing and resume when visible');

  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-pressed'), 'false');
  await expectAttribute(preview, 'data-preview-animating', 'false');
  const disabledTick = await tick(preview);
  await page.clock.runFor(1100);
  assert.equal(await tick(preview), disabledTick);
  await toggle.click();
  await target.scrollIntoViewIfNeeded();
  await expectAttribute(preview, 'data-preview-animating', 'true');
  check('Animated Previews toggle freezes playback without replacing the real frame');

  const heart = target.locator('.runs-feed-like');
  await heart.click();
  assert.equal(await heart.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByRole('dialog').count(), 0, 'Heart does not open the run');
  assert.deepEqual(await assignments(page), selected, 'Heart rerender preserves every excerpt assignment');
  await target.locator('.runs-feed-cover').click();
  const dialog = page.getByRole('dialog', { name: 'Watch saved run' });
  await dialog.locator('.agent-stage').waitFor();
  await expectAttribute(preview, 'data-preview-animating', 'false');
  const modalTick = await tick(preview), modalLoop = await loop(preview);
  await page.clock.runFor(1100);
  assert.equal(await tick(preview), modalTick);
  assert.equal(await loop(preview), modalLoop);
  assert.equal(await page.locator('[data-preview-animating="true"]').count(), 0, 'Popup pauses all cover previews');
  await dialog.getByRole('button', { name: 'Close replay' }).click();
  await dialog.waitFor({ state: 'detached' });
  await expectAttribute(preview, 'data-preview-animating', 'true');
  const resumeTick = await tick(preview), resumeLoop = await loop(preview);
  await page.clock.runFor(500);
  assert.ok(await tick(preview) !== resumeTick || await loop(preview) !== resumeLoop, 'Cover resumes after popup closes');
  check('Hearts and replay opening still work; popup pauses covers and closing resumes them');

  for (const width of [1440, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await target.scrollIntoViewIfNeeded();
    await page.clock.runFor(150);
    await noOverflow(page, `${width}px thumbnails`);
    await page.screenshot({ path: resolve(artifacts, `thumbnails-${width}.png`), fullPage: true });
  }
  check('1440px and 320px thumbnail layouts have no horizontal overflow');
  assert.deepEqual(await assignments(page), selected, 'Responsive layout and popup rerenders preserve excerpt assignments');

  const reducedContext = await contextFor('reduce', { width: 1440, height: 1000 });
  const reducedPage = await reducedContext.newPage();
  await reducedPage.clock.install();
  await reducedPage.goto(origin + '/#runs-feed', { waitUntil: 'networkidle' });
  const reducedId = await reducedPage.locator('.runs-feed-card').first().getAttribute('data-run-id');
  const reducedPreview = previewFor(reducedPage, reducedId);
  await expectAttribute(reducedPreview, 'data-preview-state', 'ready');
  await expectAttribute(reducedPreview, 'data-preview-animating', 'false');
  assert.equal(await reducedPreview.locator('[data-scene="connected-track"]').count(), 1, 'Reduced motion shows a real replay frame');
  const reducedSelection = (await assignments(reducedPage)).find(record => record.id === reducedId);
  const reducedRecord = saved.find(record => record.id === reducedId);
  assert.ok(reducedRecord.catalogue.candidates.some(candidate => candidate.kind === reducedSelection.kind && candidate.startTick === reducedSelection.start && candidate.endTick === reducedSelection.end), 'Reduced motion still selects an actual recorded candidate');
  assert.equal(await tick(reducedPreview), reducedSelection.start, 'Static cover is the selected saved excerpt start');
  await pauseClock(reducedPage);
  const staticTick = await tick(reducedPreview), staticLoop = await loop(reducedPreview);
  await reducedPage.clock.runFor(6500);
  assert.equal(await tick(reducedPreview), staticTick);
  assert.equal(await loop(reducedPreview), staticLoop);
  await reducedPage.screenshot({ path: resolve(artifacts, 'thumbnails-reduced-motion.png'), fullPage: true });
  await reducedContext.close();
  check('Reduced motion keeps an authentic saved frame static for more than a full loop');

  assert.equal(requests.filter(request => request.method !== 'GET').length, 0, 'Thumbnail browsing and hearts perform GET requests only');
  assert.deepEqual(failures, []);
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ status: 'passed', checks, failures }, null, 2));
  console.log(`Thumbnail QA passed. Artifacts: ${artifacts}`);
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: resolve(artifacts, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(resolve(artifacts, 'report.json'), JSON.stringify({ status: 'failed', checks, failures, error: error.stack, serverOutput }, null, 2));
  throw error;
} finally {
  await browser?.close();
  if (server && server.exitCode === null && server.signalCode === null) { server.kill('SIGTERM'); await new Promise(resolve => server.once('exit', resolve)); }
  await rm(temporary, { recursive: true, force: true });
}

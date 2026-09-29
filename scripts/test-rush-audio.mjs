import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { createRushSiteServer } from './rush-site.mjs';
import { createAgentSession, runSessionToEnd, exportAgentReplay, checkAgentReplay } from '../agent-play/runner.ts';

// Audio is synthesized locally. Browser fixtures never call a wallet, RPC or
// public replay store; native OfflineAudioContext verifies the actual waveform.
const repo = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin: { resolveDir: repo, loader: 'tsx', contents: `
    import { useEffect, useState } from 'react';
    import { createRoot } from 'react-dom/client';
    import { ChipSynth } from './games/rare-rush/audio/synth.ts';
    import { musicStep, effectNotes, sixteenthSeconds } from './games/rare-rush/audio/score.ts';
    import { useRunAudio, RunAudioControls } from './games/rare-rush/audio/useRunAudio.tsx';
    import { createRun, stepRun, demoControls, setPace, setSliding, jump, FIXED_STEP } from './games/rare-rush/twist/engine.ts';
    function AudioHarness() {
      const [run] = useState(() => createRun('0x' + '42'.repeat(32), 'degen'));
      const [playing, setPlaying] = useState(false);
      const [, draw] = useState(0);
      const audio = useRunAudio(run, playing);
      useEffect(() => {
        if (!playing) return;
        const timer = setInterval(() => {
          for (let tick = 0; tick < 12 && run.status === 'running'; tick++) {
            const input = demoControls(run);
            setPace(run, input.axis); setSliding(run, input.slide); if (input.jump) jump(run);
            stepRun(run, FIXED_STEP);
          }
          draw(tick => tick + 1);
        }, 100);
        return () => clearInterval(timer);
      }, [playing]);
      return <><RunAudioControls audio={audio}/><button onClick={() => setPlaying(true)}>Start fixture run</button><button onClick={() => setPlaying(false)}>Pause fixture run</button><output>{Math.floor(run.elapsed)}</output></>;
    }
    const root = createRoot(document.getElementById('app'));
    root.render(<AudioHarness/>);
    window.unmountRushAudio = () => root.unmount();
    window.renderRushAudio = async (mode, scene, effectsOnly = false) => {
      const seconds = effectsOnly ? 32 : 8;
      const context = new OfflineAudioContext(2, 44100 * seconds, 44100);
      const synth = new ChipSynth(context);
      if (effectsOnly) {
        const effects = ['start','jump','double-jump','slide','coin','rare-coin','hit','shield','magnet','up','down','reverse','world','countdown','win','lose'];
        effects.forEach((effect, index) => synth.schedule(effectNotes(effect, mode), index * 2 + .05, 'effects'));
      } else {
        const step = sixteenthSeconds(mode);
        for (let index = 0; index * step < seconds - .4; index++) synth.schedule(musicStep(mode, index, scene), index * step, 'music');
      }
      const buffer = await context.startRendering();
      const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
      let peak = 0, energy = 0, stereo = 0, invalid = 0, checksum = 2166136261;
      for (let index = 0; index < left.length; index++) {
        if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) invalid++;
        peak = Math.max(peak, Math.abs(left[index]), Math.abs(right[index]));
        energy += left[index] ** 2 + right[index] ** 2;
        stereo += Math.abs(left[index] - right[index]);
        checksum = Math.imul(checksum ^ Math.round(left[index] * 32767), 16777619);
      }
      synth.dispose();
      return { peak, rms: Math.sqrt(energy / left.length / 2), stereo: stereo / left.length, invalid, checksum: checksum >>> 0, channels: buffer.numberOfChannels };
    };
  ` },
  bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', write: false,
  outfile: 'audio-qa.js',
});
const site = createRushSiteServer(fileURLToPath(new URL('../dist', import.meta.url)));
const server = createServer((request, response) => {
  if (request.url === '/audio-qa/') return response.writeHead(200, { 'content-type': 'text/html' }).end('<!doctype html><html><body><div id="app"></div><script type="module" src="/audio-qa.js"></script></body></html>');
  if (request.url === '/audio-qa.js') return response.writeHead(200, { 'content-type': 'text/javascript' }).end(bundle.outputFiles.find(file => file.path.endsWith('.js')).contents);
  site.emit('request', request, response);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true, channel: process.env.RUSH_BROWSER_CHANNEL || 'chrome' });
const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
const errors = [], external = [];
context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
await context.route('**/*', async route => {
  const url = new URL(route.request().url());
  if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
  external.push(url.origin);
  return route.abort('blockedbyclient');
});

try {
  const page = await context.newPage();
  await page.goto(origin + '/audio-qa/');
  await page.waitForFunction(() => typeof window.renderRushAudio === 'function');
  const signatures = new Set();
  for (const mode of ['easy', 'normal', 'degen']) {
    for (const scene of [
      { world: 0, direction: 'right', urgent: false },
      { world: 1, direction: 'up', urgent: false },
      { world: 2, direction: 'down', urgent: false },
      { world: 2, direction: 'left', urgent: true },
    ]) {
      const rendered = await page.evaluate(({ mode, scene }) => window.renderRushAudio(mode, scene), { mode, scene });
      assert.equal(rendered.channels, 2);
      assert.equal(rendered.invalid, 0, 'No NaN or infinite samples');
      assert(rendered.peak > .01 && rendered.peak < .99, 'Audible PCM without clipping');
      assert(rendered.rms > .003 && rendered.rms < .3, 'Useful music loudness with headroom');
      assert(rendered.stereo > .0001, 'Stereo arrangement reaches both channels differently');
      signatures.add(rendered.checksum);
      console.log(`${mode}/${scene.world}/${scene.direction}: peak=${rendered.peak.toFixed(4)}, rms=${rendered.rms.toFixed(4)}`);
    }
    const cues = await page.evaluate(mode => window.renderRushAudio(mode, { world: 0, direction: 'right', urgent: false }, true), mode);
    assert.equal(cues.invalid, 0);
    assert(cues.peak > .01 && cues.peak < .99 && cues.rms > .002, 'All effect cues render with headroom');
  }
  assert.equal(signatures.size, 12, 'Difficulty, world and direction arrangements sound different');
  await page.close();

  const controls = await context.newPage();
  await controls.addInitScript(() => {
    window.__audioContexts = []; window.__audioSources = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native {
      constructor(...args) { super(...args); window.__audioContexts.push(this); }
      createOscillator() { window.__audioSources++; return super.createOscillator(); }
      createBufferSource() { window.__audioSources++; return super.createBufferSource(); }
    };
    window.__qaHidden = false;
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.__qaHidden });
  });
  await controls.goto(origin + '/audio-qa/');
  await controls.getByRole('button', { name: 'Mute sound', exact: true }).waitFor();
  assert.equal(await controls.getByRole('button', { name: 'Mute sound', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.getByRole('button', { name: 'Mute effects', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.evaluate(() => window.__audioContexts.length), 0, 'Both channels default ON without creating a context before a gesture');
  await controls.getByRole('button', { name: 'Start fixture run', exact: true }).click();
  await controls.waitForFunction(() => window.__audioContexts.length === 1 && window.__audioContexts[0].state === 'running' && window.__audioSources > 0);
  await controls.getByRole('button', { name: 'Mute sound', exact: true }).click();
  assert.equal(await controls.getByRole('button', { name: 'Turn sound on', exact: true }).getAttribute('aria-pressed'), 'false');
  assert.equal(await controls.getByRole('button', { name: 'Mute effects', exact: true }).getAttribute('aria-pressed'), 'true', 'Muting music leaves effects ON');
  assert.deepEqual(await controls.evaluate(() => JSON.parse(localStorage.getItem('rare-rush-audio-v1'))), { music: false, effects: true });
  await controls.reload();
  await controls.getByRole('button', { name: 'Turn sound on', exact: true }).waitFor();
  assert.equal(await controls.getByRole('button', { name: 'Mute effects', exact: true }).getAttribute('aria-pressed'), 'true', 'Independent channel preferences survive reload');
  assert.equal(await controls.evaluate(() => window.__audioContexts.length), 0);
  await controls.getByRole('button', { name: 'Mute effects', exact: true }).click();
  assert.deepEqual(await controls.evaluate(() => JSON.parse(localStorage.getItem('rare-rush-audio-v1'))), { music: false, effects: false });
  await controls.reload();
  await controls.getByRole('button', { name: 'Turn sound on', exact: true }).waitFor();
  assert.equal(await controls.getByRole('button', { name: 'Turn effects on', exact: true }).getAttribute('aria-pressed'), 'false', 'Explicit OFF preferences survive reload');
  await controls.getByRole('button', { name: 'Start fixture run', exact: true }).click();
  await controls.waitForTimeout(220);
  assert.equal(await controls.evaluate(() => window.__audioContexts.length), 0, 'Playing with both channels explicitly OFF creates no context');
  await controls.getByRole('button', { name: 'Turn sound on', exact: true }).click();
  await controls.waitForFunction(() => window.__audioContexts.length === 1 && window.__audioContexts[0].state === 'running' && window.__audioSources > 0);
  assert.equal(await controls.getByRole('button', { name: 'Mute sound', exact: true }).getAttribute('aria-pressed'), 'true');
  assert.equal(await controls.getByRole('button', { name: 'Turn effects on', exact: true }).getAttribute('aria-pressed'), 'false');
  await controls.getByRole('button', { name: 'Turn effects on', exact: true }).click();
  assert.equal(await controls.getByRole('button', { name: 'Mute effects', exact: true }).getAttribute('aria-pressed'), 'true');
  await controls.getByRole('button', { name: 'Pause fixture run', exact: true }).click();
  const pausedSources = await controls.evaluate(() => window.__audioSources);
  await controls.waitForTimeout(200);
  assert.equal(await controls.evaluate(() => window.__audioSources), pausedSources, 'Pause cancels future scheduling');
  await controls.getByRole('button', { name: 'Start fixture run', exact: true }).click();
  await controls.waitForFunction(count => window.__audioSources > count, pausedSources);
  await controls.evaluate(() => window.dispatchEvent(new Event('blur')));
  const blurredSources = await controls.evaluate(() => window.__audioSources);
  await controls.waitForTimeout(350);
  assert.equal(await controls.evaluate(() => window.__audioSources), blurredSources, 'A visible but unfocused page stays silent across engine rerenders');
  await controls.evaluate(() => window.dispatchEvent(new Event('focus')));
  await controls.getByRole('button', { name: 'Start fixture run', exact: true }).click();
  await controls.waitForFunction(count => window.__audioSources > count, blurredSources);
  await controls.evaluate(() => { window.__qaHidden = true; document.dispatchEvent(new Event('visibilitychange')); });
  const hiddenSources = await controls.evaluate(() => window.__audioSources);
  await controls.waitForTimeout(300);
  assert.equal(await controls.evaluate(() => window.__audioSources), hiddenSources, 'Hidden pages stay silent across engine rerenders');
  await controls.evaluate(() => { window.__qaHidden = false; document.dispatchEvent(new Event('visibilitychange')); });
  await controls.reload();
  await controls.getByRole('button', { name: 'Mute sound', exact: true }).waitFor();
  assert.equal(await controls.evaluate(() => window.__audioContexts.length), 0, 'Remembered ON preferences never autoplay on load');
  await controls.getByRole('button', { name: 'Start fixture run', exact: true }).click();
  await controls.waitForFunction(() => window.__audioContexts.length === 1 && window.__audioSources > 0);
  await controls.evaluate(() => window.unmountRushAudio());
  await controls.waitForFunction(() => window.__audioContexts[0].state === 'closed');
  const disposedSources = await controls.evaluate(() => window.__audioSources);
  await controls.waitForTimeout(200);
  assert.equal(await controls.evaluate(() => window.__audioSources), disposedSources, 'Unmount disposes the browser context and scheduler');

  for (const [saved, music, effects] of [
    ['not valid JSON', true, true],
    ['null', true, true],
    ['{"music":"false","effects":0}', true, true],
    ['{"music":false}', false, true],
    ['{"effects":false}', true, false],
  ]) {
    await controls.evaluate(saved => localStorage.setItem('rare-rush-audio-v1', saved), saved);
    await controls.reload();
    const musicButton = controls.getByRole('button', { name: music ? 'Mute sound' : 'Turn sound on', exact: true });
    await musicButton.waitFor();
    assert.equal(await musicButton.getAttribute('aria-pressed'), String(music), `Music preference fallback for ${saved}`);
    assert.equal(await controls.getByRole('button', { name: effects ? 'Mute effects' : 'Turn effects on', exact: true }).getAttribute('aria-pressed'), String(effects), `Effects preference fallback for ${saved}`);
    assert.equal(await controls.evaluate(() => window.__audioContexts.length), 0, 'Reading saved preferences never creates an AudioContext');
  }
  // Leave both channels ON for the shared-preview isolation checks below.
  await controls.evaluate(() => localStorage.setItem('rare-rush-audio-v1', JSON.stringify({ music: true, effects: true })));
  await controls.close();

  // A shared rendering component must not turn every scrolling thumbnail into
  // an audio engine, even when the visitor previously enabled music elsewhere.
  const seed = '0x' + '51'.repeat(32);
  const replay = exportAgentReplay(runSessionToEnd(createAgentSession(seed, 'degen')));
  const record = { id: '1'.repeat(64), source: 'testnet', collection: 1, tokenId: '1', runId: '1', difficulty: 'degen', seed, replay,
    player: '0x' + '1'.repeat(40), actor: 'human', createdAt: '2026-09-28T12:00:00Z', metrics: checkAgentReplay(seed, 'degen', replay),
    agent: 'Human player', verification: 'testnet-start-and-replay' };
  const feed = await context.newPage();
  await feed.addInitScript(() => {
    window.__audioContexts = 0;
    const Native = window.AudioContext;
    window.AudioContext = class extends Native { constructor(...args) { super(...args); window.__audioContexts++; } };
  });
  await feed.route('**/api/runs**', route => route.fulfill({ json: route.request().url().includes('/api/runs/') ? record : { runs: [record], nextCursor: null } }));
  await feed.goto(origin + '/runs-feed/');
  await feed.locator('.runs-feed-card').waitFor();
  await feed.locator('[data-preview-state="ready"]').waitFor();
  assert.equal(await feed.evaluate(() => window.__audioContexts), 0, 'Animated thumbnails never create an AudioContext');
  await feed.locator('.runs-feed-like').first().click();
  await feed.waitForTimeout(200);
  assert.equal(await feed.evaluate(() => window.__audioContexts), 0, 'Liking a card never unlocks music in its animated thumbnail');
  await feed.goto(origin + '/leaderboard/');
  await feed.locator('.leaderboard-row').waitFor();
  await feed.getByRole('heading', { level: 1 }).click();
  await feed.waitForTimeout(200);
  assert.equal(await feed.evaluate(() => window.__audioContexts), 0, 'Leaderboard page gestures also leave thumbnail audio disabled');
  await feed.close();
  assert.deepEqual(errors, []);
  assert.deepEqual(external, []);
  console.log('Offline PCM, soundtrack variation, effect cues, real audio controls, lifecycle and silent feed previews passed.');
} finally {
  await context.close();
  await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  site.closeAllConnections();
}

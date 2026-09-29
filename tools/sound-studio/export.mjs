import { build } from 'esbuild';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
const here = path.dirname(fileURLToPath(import.meta.url));
const destination = path.resolve(process.argv[2] ?? path.join(here, '../../output/audio/rare-rush-8bit'));
const modes = (process.env.RUSH_AUDIO_TRACKS || 'easy,normal,degen').split(',');
if (!modes.every(mode => ['easy','normal','degen'].includes(mode))) throw new Error('Unknown soundtrack mode');
await mkdir(path.join(destination, 'effects'), { recursive: true });
const bundle = await build({ entryPoints: [path.join(here, 'render.ts')], bundle: true, write: false, platform: 'browser', format: 'iife' });
const browser = await chromium.launch({ headless: true, channel: process.env.RUSH_BROWSER_CHANNEL || 'chrome' });
try {
  const page = await browser.newPage();
  await page.setContent('<title>Rare Rush offline audio export</title>');
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  for (const mode of modes) {
    const data = await page.evaluate(mode => window.renderTrack(mode), mode);
    await writeFile(path.join(destination, `${mode}.wav`), Buffer.from(data, 'base64'));
    console.log(`Exported ${mode}.wav`);
  }
  for (const effect of process.env.RUSH_AUDIO_KEEP_EFFECTS === '1' ? [] : ['start','jump','double-jump','slide','coin','rare-coin','hit','shield','magnet','up','down','reverse','world','countdown','win','lose']) {
    const data = await page.evaluate(effect => window.renderEffect(effect), effect);
    await writeFile(path.join(destination, 'effects', `${effect}.wav`), Buffer.from(data, 'base64'));
  }
  await writeFile(path.join(destination, 'README.txt'), 'RARE RUSH / ORIGINAL 8-BIT SOUND PACK\n\nEASY / Garden Bounce / 132 BPM / 120-second listening mix\nNORMAL / Circuit Chase / 156 BPM / 90-second listening mix\nDEGEN / Rift Riot / 184 BPM / 60-second listening mix\n\n44.1 kHz, stereo, 16-bit WAV. Mixes visit all three worlds and directional arrangements, with a short fade-out. The game synthesizes these scores live and reacts to actual gameplay. The files are listening/export mixes, not recordings of player runs.\n\n16 separate effects in effects/. In-game effects are pitched to the selected mode.\nOriginal scores and synthesized sounds made for Rare Rush. No external music recordings or samples. Project licensing applies.\n');
  execFileSync('zip', ['-q', '-r', 'rare-rush-8bit-pack.zip', 'easy.wav', 'normal.wav', 'degen.wav', 'effects', 'README.txt'], { cwd: destination });
  console.log(`Saved 3 soundtracks, 16 effects, and the ZIP pack to ${destination}`);
} finally { await browser.close(); }

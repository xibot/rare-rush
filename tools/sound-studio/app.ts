import { ChipSynth } from '../../games/rare-rush/audio/synth.ts';
import { effectNotes, musicStep, sixteenthSeconds, TRACKS, type SoundEffect, type AudioMode, type AudioDirection } from '../../games/rare-rush/audio/score.ts';

const players = [...document.querySelectorAll<HTMLAudioElement>('audio')];
let context: AudioContext | undefined, synth: ChipSynth | undefined;
let playing = false, world = 0, mode: AudioMode = 'normal', direction: AudioDirection = 'right';
let step = 0, nextTime = 0;
const status = document.querySelector('#mix-status')!;
const playButton = document.querySelector<HTMLButtonElement>('#mix-play')!;
async function unlock() {
  context ??= new AudioContext(); synth ??= new ChipSynth(context); await context.resume();
}
function stopMix() {
  playing = false; synth?.stop('music'); playButton.textContent = 'START LIVE MIX ↗'; status.textContent = 'READY TO RUSH';
}
function stopTracks() { players.forEach(player => player.pause()); }
players.forEach(player => player.addEventListener('play', () => {
  stopMix(); synth?.stop(); players.forEach(other => { if (other !== player) other.pause(); });
}));
playButton.addEventListener('click', async () => {
  if (playing) return stopMix();
  stopTracks(); await unlock(); playing = true; nextTime = context!.currentTime + .02;
  playButton.textContent = 'PAUSE LIVE MIX Ⅱ'; status.textContent = TRACKS[mode].title.toUpperCase();
});
document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach(button => button.addEventListener('click', () => {
  mode = button.dataset.mode as AudioMode; step = 0; synth?.stop('music');
  if (context) nextTime = context.currentTime + .02;
  document.querySelectorAll('[data-mode]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  status.textContent = TRACKS[mode].title.toUpperCase();
}));
document.querySelectorAll<HTMLButtonElement>('[data-world]').forEach(button => button.addEventListener('click', () => {
  world = Number(button.dataset.world);
  document.querySelectorAll('[data-world]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
const playEffect = async (effect: SoundEffect) => {
  await unlock(); synth!.stop('effects'); synth!.schedule(effectNotes(effect, mode), context!.currentTime + .005, 'effects');
};
document.querySelectorAll<HTMLButtonElement>('[data-direction]').forEach(button => button.addEventListener('click', () => {
  direction = button.dataset.direction as AudioDirection;
  if (playing && direction !== 'right') void playEffect(direction === 'left' ? 'reverse' : direction);
  document.querySelectorAll('[data-direction]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
}));
const labels: Record<SoundEffect, string> = {
  start: 'LET’S RUSH', jump: 'JUMP', 'double-jump': 'DOUBLE JUMP', slide: 'SLIDE', coin: 'COIN', 'rare-coin': 'RARE COIN', hit: 'OUCH!', shield: 'SHIELD', magnet: 'MAGNET', up: 'SUCKED UP', down: 'FREE FALL', reverse: 'RARE REVERSE', world: 'NEW WORLD', countdown: 'FINAL SECONDS', win: 'KEEP IT RARE', lose: 'ONE MORE RUN',
};
for (const [effect, label] of Object.entries(labels)) {
  const card = document.createElement('div'); card.className = 'effect';
  const button = document.createElement('button'); button.textContent = `▶ ${label}`;
  button.addEventListener('click', () => { stopTracks(); void playEffect(effect as SoundEffect); });
  const link = document.createElement('a'); link.href = `/audio/effects/${effect}.wav`; link.download = `${effect}.wav`; link.textContent = 'WAV ↓'; link.setAttribute('aria-label', `Download ${label}`);
  card.append(button, link); document.querySelector('#effects')!.append(card);
}
const interval = window.setInterval(() => {
  if (!playing || !context || !synth) return;
  if (nextTime < context.currentTime - .1) nextTime = context.currentTime + .02;
  while (nextTime < context.currentTime + .12) {
    synth.schedule(musicStep(mode, step++, { world, direction, urgent: false }), nextTime, 'music');
    nextTime += sixteenthSeconds(mode);
  }
}, 25);
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopMix(); stopTracks(); synth?.stop(); } });
window.addEventListener('pagehide', () => { clearInterval(interval); synth?.dispose(); void context?.close(); });

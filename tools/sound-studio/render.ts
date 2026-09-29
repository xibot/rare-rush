import { ChipSynth } from '../../games/rare-rush/audio/synth.ts';
import { effectNotes, musicStep, sixteenthSeconds, type AudioMode, type SoundEffect, type AudioDirection } from '../../games/rare-rush/audio/score.ts';

function wav(buffer: AudioBuffer) {
  const size = buffer.length * 4, bytes = new Uint8Array(44 + size), view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => [...value].forEach((letter, index) => view.setUint8(offset + index, letter.charCodeAt(0)));
  text(0, 'RIFF'); view.setUint32(4, size + 36, true); text(8, 'WAVE'); text(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 2, true);
  view.setUint32(24, buffer.sampleRate, true); view.setUint32(28, buffer.sampleRate * 4, true);
  view.setUint16(32, 4, true); view.setUint16(34, 16, true); text(36, 'data'); view.setUint32(40, size, true);
  const left = buffer.getChannelData(0), right = buffer.getChannelData(1);
  for (let index = 0; index < buffer.length; index++) {
    const fade = Math.min(1, index / (buffer.sampleRate * .01), (buffer.length - index) / (buffer.sampleRate * .6));
    view.setInt16(44 + index * 4, Math.round(Math.max(-1, Math.min(1, left[index] * fade)) * 32767), true);
    view.setInt16(46 + index * 4, Math.round(Math.max(-1, Math.min(1, right[index] * fade)) * 32767), true);
  }
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return btoa(binary);
}

export async function renderTrack(mode: AudioMode) {
  const seconds = { easy: 120, normal: 90, degen: 60 }[mode];
  const context = new OfflineAudioContext(2, Math.ceil((seconds + 1) * 44100), 44100);
  const synth = new ChipSynth(context), step = sixteenthSeconds(mode);
  for (let index = 0; index * step < seconds; index++) {
    const time = index * step, progress = time / seconds;
    const direction: AudioDirection = progress >= .22 && progress < .42 ? 'up' : progress >= .56 && progress < .76 ? 'down' : progress >= .8 && progress < .9 ? 'left' : 'right';
    synth.schedule(musicStep(mode, index, { world: Math.min(2, Math.floor(progress * 3)), direction, urgent: seconds - time <= 12 }), time, 'music');
  }
  const buffer = await context.startRendering(); synth.dispose(); return wav(buffer);
}
export async function renderEffect(effect: SoundEffect) {
  const notes = effectNotes(effect, 'normal');
  const seconds = Math.max(...notes.map(note => note.at + note.duration)) + .65;
  const context = new OfflineAudioContext(2, Math.ceil(seconds * 44100), 44100);
  const synth = new ChipSynth(context); synth.schedule(notes, .02, 'effects');
  const buffer = await context.startRendering(); synth.dispose(); return wav(buffer);
}
Object.assign(window, { renderTrack, renderEffect });

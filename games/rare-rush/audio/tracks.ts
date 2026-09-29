import type { ChipNote, ChipVoice, MusicScene } from './score.ts';

type Phrase = readonly (readonly [tick: number, semitones: number, length: number])[];
const n = (voice: ChipVoice, midi: number, duration: number, volume: number, pan = 0, at = 0): ChipNote =>
  ({ voice, midi, duration, volume, pan, at });
const has = (ticks: readonly number[], tick: number) => ticks.includes(tick);

// CIRCUIT CHASE: a half-time electro groove. Long, syncopated calls leave room
// for a walking bass and short bell responses. These are absolute intervals
// above D, composed against each chord rather than transposing one stock riff.
const CIRCUIT_CALLS: readonly Phrase[] = [
  [[1,7,2.4],[4,3,1.4],[7,0,3.6],[12,10,1.2],[14,7,1.7]],
  [[0,5,2.4],[3,3,1.5],[6,2,4.6],[12,0,3.4]],
  [[1,8,3.5],[6,7,1.5],[9,3,2.5],[13,0,2.5]],
  [[0,3,2.5],[4,7,2.5],[9,10,3.5],[14,8,1.5]],
  [[2,7,4.5],[8,10,2.5],[12,12,3.5]],
  [[1,10,1.5],[4,7,2.5],[8,5,2.5],[13,3,2.5]],
  [[0,5,2.5],[4,2,1.5],[7,10,4.5],[13,7,2.5]],
  [[1,5,1.5],[4,3,2.5],[8,2,4.5],[14,-1,1.5]],
];
const CIRCUIT_BRIDGE: readonly Phrase[] = [
  [[0,5,5.5],[8,8,5.5]],
  [[2,12,3.5],[8,10,2.5],[12,8,3.5]],
  [[1,7,4.5],[8,3,3.5],[13,0,2.5]],
  [[0,3,2.5],[4,7,2.5],[10,8,5]],
];
const CIRCUIT_BASS = [0,0,-4,-4,3,3,-2,-2,5,5,-4,-4,0,0,-5,-5];
const CIRCUIT_CHORDS = [[0,3,7,10],[-4,0,3,7],[3,7,10,12],[-2,2,5,10],[5,8,12,15],[-4,0,3,7],[0,3,7,10],[-5,-1,2,7]];

export function circuitMusicStep(index: number, scene: MusicScene, tonic: number, step: number): ChipNote[] {
  const tick = Math.floor(index) % 16, bar = Math.floor(index / 16) % 16;
  const bridge = bar >= 8 && bar < 12, world = Math.max(0, Math.min(2, scene.world));
  const heading = scene.direction, vertical = heading === 'up' || heading === 'down';
  const notes: ChipNote[] = [], bass = CIRCUIT_BASS[bar], chord = CIRCUIT_CHORDS[Math.floor(bar / 2)];
  const phrase = bridge ? CIRCUIT_BRIDGE[bar - 8] : CIRCUIT_CALLS[bar % 8];
  // Reverse mirrors phrase onsets; lifted/falling sections leave the main hook
  // recognizable and change the answering line instead.
  for (const [onset, pitch, length] of phrase) {
    if (tick !== (heading === 'left' ? 15 - onset : onset)) continue;
    const lead = tonic + 12 + pitch;
    notes.push(n(bridge ? 'bell' : 'pulse', lead, step * length, bridge ? .17 : .19, -.20));
    if (!bridge && (bar % 2 === 1 || world === 2))
      notes.push(n('bell', lead + 12, step * 1.6, .038, .42, step * 1.5));
  }

  const bassTicks = bridge ? [0,6,10,14] : bar % 2 ? [0,3,7,10,14] : [0,3,6,8,11,14];
  if (has(bassTicks, tick)) {
    const interval = tick === 6 || tick === 7 ? 7 : tick === 10 || tick === 11 ? 12 : tick === 14 ? (bar % 2 ? -1 : 7) : 0;
    notes.push(n('triangle', tonic - 24 + bass + interval, step * (tick === 0 ? 2.7 : 1.7), .38));
  }
  // A broad snare on beat three, not EASY's backbeat. Ghost notes and a
  // syncopated kick give NORMAL its own gait even at identical playback tempo.
  if (has(bridge ? [0,10] : bar % 2 ? [0,7,11] : [0,6,11], tick)) notes.push(n('kick',43,.15,.5));
  if (tick === 8) notes.push(n('snare',48,.17,.25,.08));
  if ((bar % 2 === 1 && tick === 14) || (scene.urgent && tick === 7)) notes.push(n('snare',48,.05,.065,-.16));
  if (has([2,6,10,14], tick)) notes.push(n('hat',92,tick === 14 ? .11 : .037,tick === 14 ? .09 : .067,.32));
  if (bar % 4 === 3 && has([13,15],tick)) notes.push(n('hat',92,.026,.07,-.30));

  if (tick === 0 || tick === 10) {
    for (const pitch of chord.slice(0,3)) notes.push(n('triangle',tonic+pitch,step*(tick===0?5.8:2.8),.038,.20));
  }
  const replyTicks = world === 0 && !vertical ? [5,15] : [3,7,11,15];
  if (has(replyTicks,tick)) {
    const slot = Math.floor(tick / 4), descending = heading === 'down' || heading === 'left';
    const pitch = chord[descending ? 3-slot : slot] + (heading === 'up' ? 12 : 0);
    notes.push(n('bell',tonic+12+pitch,step*1.2,bridge?.11:.062,.40));
  }
  if (scene.urgent && has([4,12],tick)) notes.push(n('hat',92,.03,.06,-.34));
  return notes;
}

// RIFT RIOT: a low, chopped boss riff with flat-second/tritone tension. The
// high voice answers only at phrase ends; it is not a faster version of a lead
// used in another mode. Sixteen bars alternate attacks, breaks, and a finale.
const RIFT_RIFFS: readonly Phrase[] = [
  [[0,0,1.1],[3,0,.8],[6,1,.9],[8,0,1.6],[12,7,.8],[14,6,.8]],
  [[0,0,.9],[2,12,.9],[5,10,1.5],[8,7,1.3],[11,1,.8],[14,0,1.4]],
  [[0,0,1.5],[4,3,.9],[7,2,.8],[10,0,1.3],[13,7,.8],[15,6,.65]],
  [[0,7,1.2],[3,3,1.3],[6,0,2],[11,1,.8],[13,0,.8]],
];
const RIFT_ROOTS = [0,0,-2,-2,-4,-4,1,-5,0,0,-2,-4,0,-4,1,-5];
const RIFT_ANSWERS: readonly Phrase[] = [
  [[10,19,.7],[11,15,.7],[14,13,.7],[15,12,.7]],
  [[9,12,1.4],[12,19,.7],[13,18,.7],[15,13,.7]],
  [[8,22,.8],[10,19,.8],[12,15,.8],[14,13,.8]],
  [[8,13,.6],[9,12,.6],[10,10,.6],[12,7,.8],[15,12,.7]],
];

export function riftMusicStep(index: number, scene: MusicScene, tonic: number, step: number): ChipNote[] {
  const tick = Math.floor(index) % 16, bar = Math.floor(index / 16) % 16;
  const root = RIFT_ROOTS[bar], breakdown = bar === 8 || bar === 9;
  const world = Math.max(0,Math.min(2,scene.world)), heading = scene.direction;
  const vertical = heading === 'up' || heading === 'down', notes: ChipNote[] = [];
  const phrase = RIFT_RIFFS[bar % 4];
  for (const [onset,pitch,length] of phrase) {
    if (tick !== (heading === 'left' ? 15-onset : onset) || (breakdown && onset !== 0 && onset !== 8)) continue;
    const midi = tonic-12+root+pitch;
    notes.push(n('pulse',midi,step*(breakdown?3.4:length),.25,-.13));
    // Quiet fifths make the low pulse riff heavier without crowding the lead.
    if (onset === 0 || onset === 8) notes.push(n('pulse',midi+7,step*length,.056,.23));
  }
  if (has(breakdown?[0,8]:[0,3,6,8,10,14],tick)) {
    const octave = tick === 6 || tick === 14 ? 12 : 0;
    notes.push(n('triangle',tonic-24+root+octave,step*(breakdown?4:1.25),.39));
  }
  if (has(breakdown?[0,8]:bar%2?[0,2,7,8,11,14]:[0,3,6,8,10,14],tick)) notes.push(n('kick',43,.125,.52));
  if (has(breakdown?[12]:[4,12],tick)) notes.push(n('snare',48,.12,.23,.05));
  if (has(breakdown?[2,10]:[0,2,5,6,8,10,13,14],tick)) notes.push(n('hat',92,tick===6?.08:.024,tick===6?.10:.062,tick%2?-.34:.34));
  if (bar%4===3 && has([11,14,15],tick)) notes.push(n('snare',48,.042,.10,tick%2?.22:-.22));

  // High, angular responses use a different rhythm and register from the riff.
  // Circuit adds extra responses; Crystal and shafts introduce a burst line.
  if (bar%2===1 || world>0 || breakdown) {
    for (const [onset,pitch,length] of RIFT_ANSWERS[bar%4]) {
      if (tick!==onset) continue;
      const interval = heading==='down' ? 31-pitch : pitch;
      notes.push(n('pulse',tonic+root+interval,step*length,.115,.25));
    }
  }
  if ((vertical || world===2 || scene.urgent) && has([1,5,9,13],tick)) {
    const slot=Math.floor(tick/4), line=heading==='down'||heading==='left'?[24,19,13,12]:[12,13,19,24];
    notes.push(n('bell',tonic+root+line[slot],step*.85,.10,-.35));
  }
  if (scene.urgent && has([7,15],tick)) notes.push(n('hat',92,.025,.10,.30));
  return notes;
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { FREE_PLAY_BESTS_KEY, readFreePlayBests, recordFreePlayBest } from '../games/rare-rush/free-play/bests.ts';

const zero = () => ({ easy: 0, normal: 0, degen: 0 });
function memory() {
  const values = new Map<string, string>();
  return { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
}

test('personal bests survive reload and only improve within their own difficulty', () => {
  const storage = memory();
  const first = recordFreePlayBest('easy', 1234, zero(), storage);
  recordFreePlayBest('normal', 567, first.scores, storage);
  recordFreePlayBest('easy', 2, zero(), storage);
  assert.deepEqual(readFreePlayBests(storage), { scores: { easy: 1234, normal: 567, degen: 0 }, persistent: true });
});

test('saving merges a newer result from another tab without overwriting it', () => {
  const storage = memory();
  const earlier = recordFreePlayBest('easy', 100, zero(), storage);
  recordFreePlayBest('easy', 200, zero(), storage);
  const saved = recordFreePlayBest('degen', 50, earlier.scores, storage);
  assert.deepEqual(saved.scores, { easy: 200, normal: 0, degen: 50 });
});

test('blocked storage keeps a session best without breaking play', () => {
  const storage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  const first = recordFreePlayBest('normal', 900, zero(), storage);
  const second = recordFreePlayBest('normal', 50, first.scores, storage);
  assert.deepEqual(second, { scores: { easy: 0, normal: 900, degen: 0 }, persistent: false });
});

test('quota errors keep the new best available for the current session', () => {
  const storage = { getItem: () => null, setItem() { throw new Error('quota'); } };
  assert.deepEqual(recordFreePlayBest('degen', 777, zero(), storage), { scores: { easy: 0, normal: 0, degen: 777 }, persistent: false });
});

test('malformed or unsupported local data cannot inject invalid scores', () => {
  const storage = memory();
  for (const value of ['broken', 'null', '[]', '{"version":2,"scores":{"easy":123}}']) {
    storage.setItem(FREE_PLAY_BESTS_KEY, value);
    assert.deepEqual(readFreePlayBests(storage).scores, zero());
  }
  storage.setItem(FREE_PLAY_BESTS_KEY, '{"version":1,"scores":{"easy":-3,"normal":12.5,"degen":"999"}}');
  assert.deepEqual(readFreePlayBests(storage).scores, zero());
  assert.deepEqual(recordFreePlayBest('easy', Infinity, zero(), storage).scores, zero());
  assert.deepEqual(recordFreePlayBest('normal', 99, zero(), storage).scores, { easy: 0, normal: 99, degen: 0 });
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { planReplayPreviews } from './preview-plan.ts';
import type { PreviewCandidate, PreviewKind } from './replay-preview.ts';

const kinds: readonly PreviewKind[] = ['side', 'jump', 'up', 'left', 'down', 'coins'];
const candidate = (kind: PreviewKind, startTick = 0, endTick = startTick + 720): PreviewCandidate => Object.freeze({
  key: `${kind}:${startTick}:${endTick}`, kind, startTick, endTick,
  stableTicks: endTick - startTick, jumpingTicks: kind === 'jump' ? 240 : 0,
  coinsCollected: kind === 'coins' ? 8 : 0, quality: 1,
});
const records = (length: number) => Object.freeze(Array.from({ length }, (_, index) => Object.freeze({ id: `run-${index}` })));
function selectedKinds(plan: ReadonlyMap<string, string>, catalogues: ReadonlyMap<string, readonly PreviewCandidate[]>) {
  return [...plan].map(([id, key]) => {
    const found = catalogues.get(id)?.find(entry => entry.key === key);
    assert.ok(found, `Selected key ${key} must belong to ${id}'s actual catalogue`);
    return found.kind;
  });
}
const repeats = (values: readonly PreviewKind[]) => values.reduce((total, kind, index) => total + Number(index > 0 && kind === values[index - 1]), 0);

test('identical complete catalogues use all six kinds in a repeating display rhythm', () => {
  const rows = records(18);
  const entries = Object.freeze(kinds.flatMap((kind, index) => [candidate(kind, index * 800), candidate(kind, 8000 + index * 800)]));
  const catalogues = new Map(rows.map(row => [row.id, entries] as const));
  const plan = planReplayPreviews(rows, catalogues);
  assert.equal(plan.size, rows.length);
  assert.deepEqual(selectedKinds(plan, catalogues), rows.map((_, index) => kinds[index % kinds.length]));
});

test('a flexible first card avoids the only kind available to its next neighbor', () => {
  const rows = records(6);
  const allowed: PreviewKind[][] = [['side', 'up'], ['side'], ['jump', 'up'], ['up'], ['left', 'down'], ['left']];
  const catalogues = new Map(rows.map((row, index) => [row.id, allowed[index].map(kind => candidate(kind))] as const));
  assert.deepEqual(selectedKinds(planReplayPreviews(rows, catalogues), catalogues), ['up', 'side', 'jump', 'up', 'down', 'left']);
});

test('neighbor repeat count is globally minimal for heterogeneous constrained catalogues', () => {
  const subsets: PreviewKind[][] = [['side'], ['jump'], ['up'], ['side', 'jump'], ['side', 'up'], ['jump', 'up'], ['side', 'jump', 'up']];
  const rows = records(4);
  for (let example = 0; example < 343; example++) {
    const allowed = [subsets[example % 7], subsets[Math.floor(example / 7) % 7], subsets[Math.floor(example / 49) % 7], subsets[(example * 3 + 2) % 7]];
    let minimum = Infinity;
    for (const a of allowed[0]) for (const b of allowed[1]) for (const c of allowed[2]) for (const d of allowed[3]) {
      minimum = Math.min(minimum, repeats([a, b, c, d]));
    }
    const catalogues = new Map(rows.map((row, index) => [row.id, allowed[index].map(kind => candidate(kind))] as const));
    assert.equal(repeats(selectedKinds(planReplayPreviews(rows, catalogues), catalogues)), minimum, `Constraint case ${example}`);
  }
});

test('missing and empty catalogues are skipped while their display positions preserve the rhythm', () => {
  const rows = records(5);
  const all = kinds.map(kind => candidate(kind));
  const catalogues = new Map<string, readonly PreviewCandidate[]>([[rows[1].id, all], [rows[2].id, []], [rows[3].id, all]]);
  const plan = planReplayPreviews(rows, catalogues);
  assert.deepEqual([...plan.keys()], [rows[1].id, rows[3].id]);
  assert.deepEqual(selectedKinds(plan, catalogues), ['jump', 'left']);
  assert.equal(planReplayPreviews([], catalogues).size, 0);
  assert.equal(planReplayPreviews(rows, new Map()).size, 0);
});

test('short single-candidate recordings remain real even when repetition cannot be avoided', () => {
  const rows = records(3);
  const short = Object.freeze([candidate('side', 0, 19)]);
  const catalogues = new Map(rows.map(row => [row.id, short] as const));
  const plan = planReplayPreviews(rows, catalogues);
  assert.deepEqual([...plan.values()], Array(3).fill('side:0:19'));
  assert.deepEqual([...planReplayPreviews([rows[0]], catalogues)], [[rows[0].id, 'side:0:19']]);
});

test('forced same-kind cards vary actual timestamps when alternatives exist', () => {
  const rows = records(12);
  const entries = Object.freeze([0, 1000, 2000, 3000].map(start => candidate('side', start)));
  const catalogues = new Map(rows.map(row => [row.id, entries] as const));
  const keys = [...planReplayPreviews(rows, catalogues).values()];
  assert.ok(keys.every((key, index) => !index || key !== keys[index - 1]));
  assert.ok(new Set(keys).size > 1);
  assert.deepEqual(selectedKinds(planReplayPreviews(rows, catalogues), catalogues), Array(12).fill('side'));
});

test('plans are deterministic, independent of catalogue ordering, and never mutate inputs', () => {
  const rows = records(10);
  const entries = Object.freeze(kinds.flatMap((kind, index) => [candidate(kind, index * 800), candidate(kind, index * 800 + 8000)]));
  const catalogues = new Map(rows.map(row => [row.id, entries] as const));
  const before = JSON.stringify([...catalogues]);
  const expected = [...planReplayPreviews(rows, catalogues)];
  const reordered = new Map([...catalogues].reverse().map(([id, values]) => [id, [...values].reverse()] as const));
  for (let index = 0; index < 5; index++) assert.deepEqual([...planReplayPreviews(rows, reordered)], expected);
  assert.equal(JSON.stringify([...catalogues]), before);
  assert.deepEqual([...planReplayPreviews([rows[0], rows[0], rows[1]], catalogues).keys()], [rows[0].id, rows[1].id]);
  const reverseRows = [...rows].reverse();
  assert.deepEqual([...planReplayPreviews(reverseRows, catalogues).keys()], reverseRows.map(row => row.id));
});

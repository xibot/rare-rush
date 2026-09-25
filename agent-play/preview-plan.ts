import type { PreviewCandidate, PreviewKind } from './replay-preview.ts';

const RHYTHM: readonly PreviewKind[] = ['side', 'jump', 'up', 'left', 'down', 'coins'];

type Row = {
  id: string;
  position: number;
  candidates: readonly PreviewCandidate[];
  kinds: readonly number[];
};
type Choice = { repeats: number; rhythm: number; previous: number };

function better(a: Choice, b: Choice | undefined) {
  return !b || a.repeats < b.repeats || (a.repeats === b.repeats && a.rhythm < b.rhythm);
}

function seed(value: string) {
  let result = 2166136261;
  for (const character of value) result = Math.imul(result ^ character.charCodeAt(0), 16777619);
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  return (result ^ (result >>> 16)) >>> 0;
}

function compareKeys(a: string, b: string) {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Pick only real catalogue entries. The six-state path minimizes adjacent
 * repeated kinds across the loaded cards before considering the display rhythm.
 * Keeping the original positions gives unloaded cards their place in that
 * rhythm. No replay, catalogue, or supplied record is changed by this planner.
 */
export function planReplayPreviews(
  records: readonly { id: string }[],
  catalogues: ReadonlyMap<string, readonly PreviewCandidate[]>,
): ReadonlyMap<string, string> {
  const seen = new Set<string>();
  const rows: Row[] = [];
  records.forEach((record, position) => {
    if (seen.has(record.id)) return;
    seen.add(record.id);
    const candidates = catalogues.get(record.id);
    if (!candidates?.length) return;
    const kinds = RHYTHM.flatMap((kind, index) => candidates.some(candidate => candidate.kind === kind) ? [index] : []);
    if (kinds.length) rows.push({ id: record.id, position, candidates, kinds });
  });
  if (!rows.length) return new Map();

  // One path per ending kind is enough: future repeat cost depends only on
  // that kind. Thus flexible cards can yield to a later singleton catalogue.
  const paths: (Choice | undefined)[][] = [];
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const path: (Choice | undefined)[] = Array(RHYTHM.length);
    for (const kind of row.kinds) {
      const rhythm = (kind - row.position % RHYTHM.length + RHYTHM.length) % RHYTHM.length;
      if (!rowIndex) {
        path[kind] = { repeats: 0, rhythm, previous: -1 };
        continue;
      }
      for (let previous = 0; previous < RHYTHM.length; previous++) {
        // Put unavoidable repeats on constrained cards. A flexible card can
        // change kind without adding more than the one repeat it removes.
        if (previous === kind && row.kinds.length > 1) continue;
        const prefix = paths[rowIndex - 1][previous];
        if (!prefix) continue;
        const next = { repeats: prefix.repeats + Number(previous === kind), rhythm: prefix.rhythm + rhythm, previous };
        if (better(next, path[kind])) path[kind] = next;
      }
    }
    paths.push(path);
  }

  const kinds = Array<number>(rows.length);
  let best: Choice | undefined;
  let lastKind = 0;
  paths[paths.length - 1].forEach((choice, kind) => {
    if (choice && better(choice, best)) { best = choice; lastKind = kind; }
  });
  for (let index = rows.length - 1; index >= 0; index--) {
    kinds[index] = lastKind;
    lastKind = paths[index][lastKind]!.previous;
  }

  const plan = new Map<string, string>();
  let previousWindow: Pick<PreviewCandidate, 'startTick' | 'endTick'> | undefined;
  rows.forEach((row, index) => {
    const kind = RHYTHM[kinds[index]];
    const candidates = row.candidates.filter(candidate => candidate.kind === kind);
    const differentWindows = candidates.filter(candidate => !previousWindow
      || candidate.startTick !== previousWindow.startTick || candidate.endTick !== previousWindow.endTick);
    const available = differentWindows.length ? differentWindows : candidates;
    // Stable rendezvous ranking does not depend on catalogue order. Different
    // run IDs can choose different moments of the same kind, without a clock.
    const selected = available.reduce((best, candidate) => {
      const rank = seed(`${row.id}\0${candidate.key}`), bestRank = seed(`${row.id}\0${best.key}`);
      return rank > bestRank || (rank === bestRank && compareKeys(candidate.key, best.key) < 0) ? candidate : best;
    });
    plan.set(row.id, selected.key);
    previousWindow = selected;
  });
  return plan;
}

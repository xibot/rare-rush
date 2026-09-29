import { DIFFICULTY_ORDER, type Difficulty } from '../difficulty.ts';

type BestScores = Record<Difficulty, number>;
type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
export const FREE_PLAY_BESTS_KEY = 'rare-rush-free-play-bests-v1';
const empty = (): BestScores => ({ easy: 0, normal: 0, degen: 0 });
const validScore = (score: unknown): score is number => typeof score === 'number' && Number.isSafeInteger(score) && score >= 0;

function browserStorage(): StorageLike | undefined {
  try { return globalThis.localStorage; } catch { return undefined; }
}

/** Personal browser scores never enter the public feed or wallet reward system. */
export function readFreePlayBests(storage: StorageLike | undefined = browserStorage()) {
  const scores = empty();
  if (!storage) return { scores, persistent: false };
  try {
    const raw = storage.getItem(FREE_PLAY_BESTS_KEY);
    let saved: unknown;
    try { saved = JSON.parse(raw ?? 'null'); } catch { return { scores, persistent: true }; }
    if (saved && typeof saved === 'object' && 'version' in saved && saved.version === 1 && 'scores' in saved
      && saved.scores && typeof saved.scores === 'object') {
      for (const key of DIFFICULTY_ORDER) {
        const value = (saved.scores as Record<string, unknown>)[key];
        if (validScore(value)) scores[key] = value;
      }
    }
    return { scores, persistent: true };
  } catch { return { scores, persistent: false }; }
}

export function recordFreePlayBest(difficulty: Difficulty, score: number, current: BestScores,
  storage: StorageLike | undefined = browserStorage()) {
  const stored = readFreePlayBests(storage);
  const scores = empty();
  for (const key of DIFFICULTY_ORDER) scores[key] = Math.max(stored.scores[key], validScore(current[key]) ? current[key] : 0);
  if (DIFFICULTY_ORDER.includes(difficulty) && validScore(score)) scores[difficulty] = Math.max(scores[difficulty], score);
  if (!storage || !stored.persistent) return { scores, persistent: false };
  try {
    storage.setItem(FREE_PLAY_BESTS_KEY, JSON.stringify({ version: 1, scores }));
    return { scores, persistent: true };
  } catch { return { scores, persistent: false }; }
}

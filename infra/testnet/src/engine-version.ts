import { readFile } from 'node:fs/promises';
import { engineVersionFromSources } from './protocol.ts';

export async function currentEngineVersion() {
  const root = new URL('../../../games/rare-rush/', import.meta.url);
  const [engine, difficulty] = await Promise.all([
    readFile(new URL('engine.ts', root), 'utf8'), readFile(new URL('difficulty.ts', root), 'utf8'),
  ]);
  return engineVersionFromSources(engine, difficulty);
}

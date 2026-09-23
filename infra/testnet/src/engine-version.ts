import { readFile } from 'node:fs/promises';
import { ENGINE_SOURCE_PATHS, engineVersionFromSources, type EngineSourcePath } from './protocol.ts';

export async function currentEngineVersion() {
  const root = new URL('../../../games/rare-rush/', import.meta.url);
  const entries = await Promise.all(ENGINE_SOURCE_PATHS.map(async path =>
    [path, await readFile(new URL(path, root), 'utf8')] as const));
  return engineVersionFromSources(Object.fromEntries(entries) as Record<EngineSourcePath, string>);
}

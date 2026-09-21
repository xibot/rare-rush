import { readFile } from 'node:fs/promises';

export async function artifact(name) {
  if (!['RareRushGame', 'RareRushToken', 'TestRF', 'TestFriends'].includes(name)) throw new Error('Unknown artifact.');
  return JSON.parse(await readFile(new URL(`../artifacts/${name}.json`, import.meta.url), 'utf8'));
}

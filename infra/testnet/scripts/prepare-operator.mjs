import { readFile, writeFile } from 'node:fs/promises';
import { getAddress } from 'viem';
import { currentEngineVersion } from '../src/engine-version.ts';
import { AUTHORIZED_OWNER, LAUNCH_ALLOCATION, DEPLOYMENT_VERSION, CONFIG_FILE, REUSED_ASSETS, publicConfig } from '../src/deployment-config.mjs';

// V2 keeps the existing verifier identity. This script reads only the public V1
// config; it never opens, generates, rotates, or writes signing material.
const prior = JSON.parse(await readFile(new URL('../operator-config.json', import.meta.url), 'utf8'));
const owner = getAddress(process.argv[2] ?? AUTHORIZED_OWNER);
const treasury = getAddress(process.argv[3] ?? prior.treasury);
if (owner !== getAddress(AUTHORIZED_OWNER) || getAddress(prior.owner) !== owner) throw new Error('This deployment is authorized only for the configured XIBOT wallet.');
if (treasury !== getAddress(AUTHORIZED_OWNER)) throw new Error('V2 preserves the approved owner treasury.');
const engineVersion = await currentEngineVersion();
if (engineVersion === prior.engineVersion) throw new Error('V2 must bind the new approved gameplay engine hash.');
const config = publicConfig({ deploymentVersion: DEPLOYMENT_VERSION, chainId: 46630, owner, treasury,
  verifier: prior.verifier, engineVersion, launchRecipient: owner, launchAllocation: LAUNCH_ALLOCATION.toString(),
  reusedAssets: Object.fromEntries(Object.entries(REUSED_ASSETS).map(([id, asset]) => [id, asset.address])) });
await writeFile(new URL(`../${CONFIG_FILE}`, import.meta.url), JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify(config, null, 2));
console.log('V2 public config prepared. Existing public V1 config and verifier signing material were preserved.');

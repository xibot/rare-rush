import { readFile, writeFile, chmod } from 'node:fs/promises';
import { getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { currentEngineVersion } from '../src/engine-version.ts';

const owner = getAddress(process.argv[2] ?? '');
if (/^0x0{40}$/i.test(owner)) throw new Error('A nonzero owner address is required.');
const treasury = getAddress(process.argv[3] ?? owner);
if (/^0x0{40}$/i.test(treasury)) throw new Error('A nonzero treasury address is required.');
const envFile = new URL('../.env.testnet', import.meta.url);
let key;
try {
  const existing = await readFile(envFile, 'utf8');
  key = /^RUSH_VERIFIER_PRIVATE_KEY=(0x[a-fA-F0-9]{64})$/m.exec(existing)?.[1];
  if (!key) throw new Error('Existing operator environment has no valid verifier key; refusing to overwrite.');
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  key = generatePrivateKey();
  await writeFile(envFile, `# Local testnet verifier secret. Never share or commit this file.\nRUSH_CHAIN_ID=46630\nRUSH_RPC_URL=https://rpc.testnet.chain.robinhood.com\nRUSH_VERIFIER_PRIVATE_KEY=${key}\n`, { flag: 'wx', mode: 0o600 });
}
await chmod(envFile, 0o600);
const config = { chainId: 46630, owner, treasury, verifier: privateKeyToAccount(key).address, engineVersion: await currentEngineVersion() };
await writeFile(new URL('../operator-config.json', import.meta.url), JSON.stringify(config, null, 2) + '\n');
console.log(JSON.stringify(config, null, 2));
console.log('Verifier secret saved in the ignored, permission-restricted .env.testnet file. The wallet console receives only the public config above.');

import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
const unit = process.argv.includes('--unit');
const upstream = process.env.RUSH_DOPPLER_ARCHIVE_RPC ?? 'https://rpc.mainnet.chain.robinhood.com/';
let forkBlock = process.env.RUSH_DOPPLER_FORK_BLOCK;
if (!unit) {
  const response = await fetch(upstream, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify([
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] },
    ...(!forkBlock ? [{ jsonrpc: '2.0', id: 2, method: 'eth_blockNumber', params: [] }] : []),
  ]), signal: AbortSignal.timeout(30_000) });
  const replies = await response.json();
  if (!Array.isArray(replies) || replies.find(item => item.id === 1)?.result !== '0x1237') {
    throw new Error('Fork upstream must be Robinhood mainnet chain 4663');
  }
  if (!forkBlock) {
    const block = replies.find(item => item.id === 2)?.result;
    if (!block) throw new Error('Unable to select one upstream fork block');
    forkBlock = String(BigInt(block));
  }
}
if (!unit && !/^\d+$/.test(forkBlock)) throw new Error('Invalid fork block');
const root = fileURLToPath(new URL('../', import.meta.url));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject).listen(0, '127.0.0.1', () => {
    const port = server.address().port; server.close(() => resolve(port));
  });
});
const rpc = `http://127.0.0.1:${port}`;
const node = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--chain-id', '31337', ...(unit ? [] : ['--fork', upstream, '--fork-block-number', forkBlock]), '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DO_NOT_TRACK: '1' },
});
// Never emit Hardhat's public development key list.
let log = '';
node.stdout.on('data', data => { log = (log + data).slice(-16000); });
node.stderr.on('data', data => { log = (log + data).slice(-16000); });
let child;
const cleanup = () => { child?.kill(); node.kill(); };
process.once('SIGTERM', cleanup); process.once('SIGINT', cleanup);
try {
  let ready = false;
  for (let attempt = 0; attempt < 300; attempt++) {
    if (node.exitCode !== null) throw new Error(`Local fork exited: ${log.split('\n').filter(line => !/private key|0x[a-f0-9]{64}/i.test(line)).slice(-8).join('\n')}`);
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      const body = await response.json();
      if (body.result === '0x7a69') { ready = true; break; }
    } catch {}
    await delay(100);
  }
  if (!ready) throw new Error('Isolated local fork did not start');
  child = spawn(process.execPath, [unit ? 'scripts/validate-unit.mjs' : 'scripts/validate-fork.mjs'], { cwd: root, stdio: 'inherit', env: { ...process.env, RUSH_DOPPLER_LOCAL_RPC: rpc, RUSH_DOPPLER_FORK_BLOCK: forkBlock } });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { cleanup(); }

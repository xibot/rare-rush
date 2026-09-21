import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject).listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => resolve(port));
  });
});
const rpc = `http://127.0.0.1:${port}`;
const node = spawn(process.execPath, ['node_modules/hardhat/dist/src/cli.js', 'node', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, DO_NOT_TRACK: '1' },
});
// Hardhat prints publicly known dev keys; keep its startup log out of user output.
let log = '';
node.stdout.on('data', data => { log = (log + data).slice(-16000); });
node.stderr.on('data', data => { log = (log + data).slice(-16000); });
let child;
const cleanup = () => { child?.kill(); node.kill(); };
process.once('SIGTERM', cleanup);
process.once('SIGINT', cleanup);
try {
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (node.exitCode !== null) throw new Error(`Local chain exited: ${log.split('\n').filter(line => !/private key|0x[a-f0-9]{64}/i.test(line)).slice(-8).join('\n')}`);
    try {
      const response = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
      const body = await response.json();
      if (body.result === '0x7a69') { ready = true; break; }
    } catch {}
    await delay(100);
  }
  if (!ready) throw new Error('Isolated local chain did not start.');
  const demo = process.argv.includes('--demo');
  child = spawn(process.execPath, demo ? ['scripts/demo.ts'] : ['--test', '--test-concurrency=1', 'test/contracts.test.mjs', 'test/replay.test.ts'], {
    cwd: root, stdio: 'inherit', env: { ...process.env, RUSH_TEST_RPC: rpc },
  });
  process.exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', code => resolve(code ?? 1)); });
} finally { cleanup(); }

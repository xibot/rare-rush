import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
const here = dirname(fileURLToPath(import.meta.url));
const address = 'http://127.0.0.1:4217';

/** Probe only the public local HTML marker. No stats or credentials are read. */
export async function inspectDashboard(request = fetch) {
  try {
    const response = await request(address, { signal: AbortSignal.timeout(800), redirect: 'error', cache: 'no-store' });
    await response.body?.cancel();
    return response.ok && response.headers.get('x-rare-rush-dashboard') === 'arcade-stats-local-v1' ? 'ready' : 'occupied';
  } catch (error) {
    return error.cause?.code === 'ECONNREFUSED' || error.code === 'ECONNREFUSED' ? 'closed' : 'unavailable';
  }
}

export async function openDashboard() {
  let state = await inspectDashboard();
  if (state === 'occupied' || state === 'unavailable') throw new Error('Port 4217 is occupied by an unrecognized or unresponsive service. Close it before opening Arcade Stats.');
  if (state === 'closed') {
    // Remains local and running after this launcher exits. No credentials are
    // placed in arguments or copied into this process by the launcher.
    const child = spawn(process.execPath, [resolve(here, 'server.mjs')], { cwd: resolve(here, '../..'), detached: true, stdio: 'ignore' });
    child.unref();
    for (let tries = 0; tries < 12; tries++) {
      await new Promise(resolve => setTimeout(resolve, 150));
      state = await inspectDashboard();
      if (state === 'ready') break;
      if (state === 'occupied') throw new Error('Another service opened port 4217. The dashboard was not opened.');
    }
    if (state !== 'ready') throw new Error('Arcade Stats could not start. Run node tools/arcade-stats/server.mjs from the repository to inspect startup.');
  }
  await promisify(execFile)('open', [address]);
  console.log(`Private Arcade Stats opened at ${address}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  openDashboard().catch(() => {
    console.error('Arcade Stats could not open. Check that port 4217 is free and Node.js is installed, or run node tools/arcade-stats/server.mjs.');
    process.exitCode = 1;
  });
}

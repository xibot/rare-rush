import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { publicConfig, CONFIG_FILE } from '../src/deployment-config.mjs';
import { currentEngineVersion } from '../src/engine-version.ts';

const root = new URL('../', import.meta.url);
const port = Number(process.env.RUSH_CONSOLE_PORT ?? 4174);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid RUSH_CONSOLE_PORT');

// Explicitly select public fields. Never serve the config file itself, any
// arbitrary path, environment variables, keystores, or signing material.
const raw = JSON.parse(await readFile(new URL(CONFIG_FILE, root), 'utf8'));
const config = publicConfig(raw);
if (config.engineVersion !== await currentEngineVersion()) throw new Error('Engine changed. Prepare the operator config again.');
const bundle = await build({ entryPoints: [fileURLToPath(new URL('console/app.js', root))], bundle: true,
  write: false, platform: 'browser', target: 'es2022', format: 'esm', minify: true });
const files = new Map([
  ['/', { type: 'text/html; charset=utf-8', body: await readFile(new URL('console/index.html', root)) }],
  ['/app.js', { type: 'text/javascript; charset=utf-8', body: bundle.outputFiles[0].contents }],
  ['/style.css', { type: 'text/css; charset=utf-8', body: await readFile(new URL('console/style.css', root)) }],
  ['/config.json', { type: 'application/json', body: JSON.stringify(config) }],
]);
for (const name of ['TestRF', 'TestFriends', 'RareRushGame', 'RareRushToken', 'standard-input']) {
  const body = await readFile(new URL(`artifacts/${name}.json`, root));
  files.set(`/artifacts/${name}.json`, { type: 'application/json', body });
}
const csp = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self' https://rpc.testnet.chain.robinhood.com; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; object-src 'none'";
const server = createServer((req, res) => {
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  const headers = { 'Content-Security-Policy': csp, 'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer', 'Cache-Control': 'no-store', 'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' };
  if (!allowedHosts.has(req.headers.host) || (req.headers.origin &&
      ![`http://127.0.0.1:${port}`, `http://localhost:${port}`].includes(req.headers.origin))) {
    res.writeHead(403, headers); res.end('Local console only'); return;
  }
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, headers); res.end(); return; }
  const file = files.get(req.url);
  if (!file) { res.writeHead(404, headers); res.end('Not found'); return; }
  res.writeHead(200, { ...headers, 'Content-Type': file.type });
  res.end(req.method === 'HEAD' ? undefined : file.body);
});
server.listen(port, '127.0.0.1', () => {
  console.log(`Rare Rush V2 local deployment console: http://127.0.0.1:${port}`);
  console.log('Robinhood Chain testnet only. Connect and approve each deployment in your browser wallet.');
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close(() => process.exit(0)));

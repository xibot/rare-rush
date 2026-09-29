import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const here = path.dirname(fileURLToPath(import.meta.url));
const audio = path.resolve(process.argv[2] ?? path.join(here, '../../output/audio/rare-rush-8bit'));
const port = Number(process.env.PORT || 4238);
const bundle = await build({ entryPoints: [path.join(here, 'app.ts')], bundle: true, write: false, platform: 'browser', format: 'esm' });
const files = new Map([
  ['/', [path.join(here, 'index.html'), 'text/html; charset=utf-8']],
  ['/style.css', [path.join(here, 'style.css'), 'text/css']],
  ['/pixel.woff2', [path.join(here, '../../games/rare-rush/assets/fonts/silkscreen-regular.woff2'), 'font/woff2']],
  ['/mono.woff2', [path.join(here, '../../games/rare-rush/assets/fonts/sometype-mono-variable.woff2'), 'font/woff2']],
]);
const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') return response.writeHead(405).end();
  const url = new URL(request.url, 'http://localhost');
  if (url.pathname === '/app.js') return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bundle.outputFiles[0].contents);
  let file = files.get(url.pathname);
  if (/^\/audio\/(easy|normal|degen)\.wav$/.test(url.pathname) || /^\/audio\/effects\/[a-z-]+\.wav$/.test(url.pathname) || url.pathname === '/audio/rare-rush-8bit-pack.zip')
    file = [path.join(audio, url.pathname.slice(7)), url.pathname.endsWith('.zip') ? 'application/zip' : 'audio/wav'];
  if (!file) return response.writeHead(404).end('Not found');
  try {
    const data = await readFile(file[0]);
    const headers = { 'Content-Type': file[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Accept-Ranges': 'bytes' };
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range ?? '');
    if (range) {
      const start = Number(range[1]), end = Math.min(data.length - 1, range[2] ? Number(range[2]) : data.length - 1);
      if (start > end) return response.writeHead(416, { 'Content-Range': `bytes */${data.length}` }).end();
      return response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Content-Length': end - start + 1 }).end(request.method === 'HEAD' ? undefined : data.subarray(start, end + 1));
    }
    response.writeHead(200, { ...headers, 'Content-Length': data.length }).end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404).end('Export is not ready yet.'); }
});
await stat(path.join(audio, 'normal.wav'));
server.listen(port, '127.0.0.1', () => console.log(`Rare Rush Sound Studio: http://127.0.0.1:${port}/`));

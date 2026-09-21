import { context } from 'esbuild';
import { buildGame } from '@rarefriends/friendsdk/build';
import { createGameServer } from '@rarefriends/friendsdk/serve';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile, realpath, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const landing = path.join(project, 'games/rare-rush/landing');

export async function buildRushSite({ outdir = path.join(project, 'dist'), watch = false } = {}) {
  outdir = path.resolve(outdir);
  if (outdir === project || project.startsWith(outdir + path.sep)) throw new Error('Choose a dedicated build output directory.');
  await mkdir(outdir, { recursive: true });
  const game = await buildGame(path.join(project, 'games/rare-rush'), { outdir: path.join(outdir, 'play'), watch });
  let page;
  try {
    page = await context({
      absWorkingDir: project, entryPoints: { landing: path.join(landing, 'index.tsx'), 'docs/index': path.join(landing, '../docs/index.tsx') }, outdir,
      bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', minify: true,
      loader: { '.woff2': 'file' }, assetNames: 'assets/[name]-[hash]', metafile: true,
      define: { 'process.env.NODE_ENV': '"production"' }, logLevel: 'warning',
      plugins: [{ name: 'landing-html', setup(build) {
        build.onEnd(async result => {
          if (result.errors.length) return;
          await writeFile(path.join(outdir, 'index.html'), await readFile(path.join(landing, 'index.html')));
          await mkdir(path.join(outdir, 'docs'), { recursive: true });
          await writeFile(path.join(outdir, 'docs/index.html'), await readFile(path.join(landing, '../docs/index.html')));
          const fonts = Object.keys(result.metafile.outputs).map(file => path.relative(outdir, path.resolve(project, file)).split(path.sep).join('/')).filter(file => /^assets\/[\w-]+-[A-Z0-9]{8}\.woff2$/.test(file));
          await writeFile(path.join(outdir, '.rush-site-fonts.json'), JSON.stringify(fonts));
          const licenses = await Promise.all(['SILKSCREEN-OFL.txt', 'ARCHIVO-OFL.txt', 'SOMETYPE-MONO-OFL.txt'].map(file => readFile(path.join(landing, '../assets/fonts', file), 'utf8')));
          await writeFile(path.join(outdir, 'font-licenses.txt'), licenses.join('\n\n----------------------------------------\n\n'));
        });
      } }],
    });
    await page.rebuild();
    // Remove only the known legacy SDK root outputs. Gameplay now lives in play/.
    // Unrelated files are preserved, and each current SDK output has its own manifest.
    for (const name of ['.friendsdk-output.json', 'game.html', 'runtime.js', 'game.js', 'runtime.css', 'game.css', 'layout.css', 'game-layout.css']) {
      await unlink(path.join(outdir, name)).catch(error => { if (error.code !== 'ENOENT') throw error; });
    }
    if (watch) await page.watch(); else await page.dispose();
    return { outdir, close: async () => { await Promise.all([page.dispose(), game.close()]); } };
  } catch (error) { await page?.dispose(); await game.close(); throw error; }
}

/** Only public site outputs and the SDK's own allowlisted game outputs are served. */
export function createRushSiteServer(outdir) {
  const directory = path.resolve(outdir);
  const gameServer = createGameServer(path.join(directory, 'play'));
  const publicFiles = new Map([
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/landing.js', ['landing.js', 'text/javascript; charset=utf-8']],
    ['/landing.css', ['landing.css', 'text/css; charset=utf-8']],
    ['/docs/', ['docs/index.html', 'text/html; charset=utf-8']],
    ['/docs/index.html', ['docs/index.html', 'text/html; charset=utf-8']],
    ['/docs/index.js', ['docs/index.js', 'text/javascript; charset=utf-8']],
    ['/docs/index.css', ['docs/index.css', 'text/css; charset=utf-8']],
    ['/font-licenses.txt', ['font-licenses.txt', 'text/plain; charset=utf-8']],
  ]);
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/play') { response.writeHead(308, { Location: '/play/' }).end(); return; }
      if (url.pathname === '/docs') { response.writeHead(308, { Location: '/docs/' }).end(); return; }
      if (url.pathname.startsWith('/play/')) {
        request.url = url.pathname.slice('/play'.length) + url.search;
        gameServer.emit('request', request, response);
        return;
      }
      let output = publicFiles.get(url.pathname);
      if (!output && /^\/assets\/[\w-]+-[A-Z0-9]{8}\.woff2$/.test(url.pathname)) {
        const fonts = JSON.parse(await readFile(path.join(directory, '.rush-site-fonts.json'), 'utf8'));
        if (Array.isArray(fonts) && fonts.includes(url.pathname.slice(1))) output = [url.pathname.slice(1), 'font/woff2'];
      }
      if (!output) { response.writeHead(404).end('Not found'); return; }
      const base = await realpath(directory), file = await realpath(path.join(directory, output[0]));
      if (file !== path.join(base, output[0]) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': output[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch { response.writeHead(404).end('Not found'); }
  });
}

async function main() {
  const command = process.argv[2] ?? 'dev';
  if (!['dev', 'build'].includes(command)) throw new Error('Usage: node scripts/rush-site.mjs dev|build');
  const built = await buildRushSite({ watch: command === 'dev' });
  if (command === 'build') { console.log(`Built landing page, docs, and SDK game in ${built.outdir}`); return; }
  const server = createRushSiteServer(built.outdir);
  server.listen(4173, '0.0.0.0', () => console.log('Rare Rush: http://localhost:4173/ · game: http://localhost:4173/play/'));
  const stop = () => { server.close(); void built.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  server.on('error', error => { console.error(error); void built.close().finally(() => process.exit(1)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

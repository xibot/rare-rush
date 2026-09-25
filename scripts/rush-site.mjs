import { build, context } from 'esbuild';
import { publicTestnetSources } from './public-testnet-sources.mjs';
import { ENGINE_SOURCE_PATHS, engineVersionFromSources } from '../infra/testnet/src/protocol.ts';
import { buildGame } from '@rarefriends/friendsdk/build';
import { createGameServer } from '@rarefriends/friendsdk/serve';
import { createServer } from 'node:http';
import { copyFile, mkdir, readFile, writeFile, realpath, stat, unlink, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const landing = path.join(project, 'games/rare-rush/landing');

export async function buildRushSite({ outdir = path.join(project, 'dist'), watch = false } = {}) {
  outdir = path.resolve(outdir);
  if (outdir === project || project.startsWith(outdir + path.sep)) throw new Error('Choose a dedicated build output directory.');
  await mkdir(outdir, { recursive: true });
  const deployment = JSON.parse(await readFile(path.join(project,'testnet-app/src/shared/deployment.json'),'utf8'));
  const physics = Object.fromEntries(await Promise.all(ENGINE_SOURCE_PATHS.map(async name=>[name,await readFile(path.join(project,'games/rare-rush',name),'utf8')])));
  if(engineVersionFromSources(physics)!==deployment.engineVersion)throw new Error('Public replays require the approved Testnet engine.');
  // Keep the function's mixed TS/MJS dependency graph in one JS module. Vercel's
  // file tracer otherwise transpiles TS files without rewriting MJS imports.
  await build({
    absWorkingDir: project, entryPoints: {
      'replay-feed-runtime': 'server/replay-feed-runtime.mjs',
      'agent-testnet-proxy': 'server/agent-testnet-proxy.ts',
    },
    outdir: 'server/generated', outExtension: { '.js': '.mjs' }, bundle: true,
    platform: 'node', format: 'esm', target: 'node22', packages: 'external',
    logLevel: 'warning',
  });
  // Retired public showcase: also remove output left by a previous build/cache.
  await rm(path.join(outdir, 'genesis-lab'), { recursive: true, force: true });
  const game = await buildGame(path.join(project, 'games/rare-rush'), { outdir: path.join(outdir, 'play'), watch });
  let page;
  try {
    // Give SDK-generated pages the same browser-title format as the rest of the site.
    for (const filename of ['index.html', 'game.html']) {
      const filenamePath = path.join(outdir, 'play', filename);
      const html = await readFile(filenamePath, 'utf8');
      await writeFile(filenamePath, html.replace(/<title>[^<]*<\/title>/, '<title>Rare Rush | Generations Arcade</title>'));
    }
    // Add site chrome to the SDK host without changing its runtime or sandbox document.
    const gameHostPath = path.join(outdir, 'play/index.html');
    const gameHostHTML = await readFile(gameHostPath, 'utf8');
    if (!gameHostHTML.includes('</head>')) throw new Error('The SDK host HTML has no head for site chrome.');
    await writeFile(gameHostPath, gameHostHTML.replace('</head>', '<link rel="icon" type="image/svg+xml" sizes="any" href="/favicon.svg"><script type="module" src="/host-navigation.js"></script></head>'));
    page = await context({
      absWorkingDir: project, entryPoints: { landing: path.join(landing, 'index.tsx'), 'host-navigation': path.join(landing, '../host-navigation.ts'), 'docs/index': path.join(landing, '../docs/index.tsx'), 'pitch/index': path.join(landing, '../pitch/index.tsx'), 'genesis/index': path.join(landing, '../genesis/index.tsx'), 'genesis/child': path.join(landing, '../genesis/child.tsx'), 'community/index': path.join(landing, '../community/index.tsx') }, outdir,
      bundle: true, platform: 'browser', format: 'esm', target: 'es2022', jsx: 'automatic', minify: true,
      loader: { '.woff2': 'file' }, assetNames: 'assets/[name]-[hash]', metafile: true,
      define: { 'process.env.NODE_ENV': '"production"', '__RUSH_PUBLIC_SITE__': 'true' }, logLevel: 'warning',
      plugins: [publicTestnetSources(project),{ name: 'landing-html', setup(build) {
        build.onEnd(async result => {
          if (result.errors.length) return;
          await writeFile(path.join(outdir, 'favicon.svg'), await readFile(path.join(landing, '../assets/favicon.svg')));
          await writeFile(path.join(outdir, 'index.html'), await readFile(path.join(landing, 'index.html')));
          for(const [route,title] of [['agent-play','Agent Play'],['runs-feed','Runs Feed'],['leaderboard','Leaderboard']]){
            await mkdir(path.join(outdir,route),{recursive:true});
            await writeFile(path.join(outdir,route,'index.html'),`<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#000000"><title>Rare Rush | ${title}</title><link rel="icon" href="/favicon.svg"><link rel="stylesheet" href="/community/index.css"></head><body><div id="app"></div><script type="module" src="/community/index.js"></script></body></html>`);
          }
          await mkdir(path.join(outdir,'agent-skill/references'),{recursive:true});
          for(const name of ['SKILL.md','references/jobs.md'])await copyFile(path.join(project,'agent-play/skills/rarerush',name),path.join(outdir,'agent-skill',name));
          await mkdir(path.join(outdir, 'docs'), { recursive: true });
          await writeFile(path.join(outdir, 'docs/index.html'), await readFile(path.join(landing, '../docs/index.html')));
          await mkdir(path.join(outdir, 'pitch'), { recursive: true });
          await writeFile(path.join(outdir, 'pitch/index.html'), await readFile(path.join(landing, '../pitch/index.html')));
          await mkdir(path.join(outdir, 'media'), { recursive: true });
          for (const filename of ['rare-rush-directions.mp4', 'rare-rush-directions.jpg']) {
            await copyFile(path.join(landing, '../pitch/media', filename), path.join(outdir, 'media', filename));
          }
          await mkdir(path.join(outdir, 'genesis'), { recursive: true });
          await mkdir(path.join(outdir, 'arcade'), { recursive: true });
          const genesisHTML = await readFile(path.join(landing, '../genesis/index.html'));
          await writeFile(path.join(outdir, 'genesis/index.html'), genesisHTML);
          await writeFile(path.join(outdir, 'arcade/index.html'), genesisHTML);
          await writeFile(path.join(outdir, 'genesis/game.html'), await readFile(path.join(landing, '../genesis/game.html')));
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
    ['/agent-play/', ['agent-play/index.html','text/html; charset=utf-8']],
    ['/runs-feed/', ['runs-feed/index.html','text/html; charset=utf-8']],
    ['/leaderboard/', ['leaderboard/index.html','text/html; charset=utf-8']],
    ['/community/index.js', ['community/index.js','text/javascript; charset=utf-8']],
    ['/community/index.css', ['community/index.css','text/css; charset=utf-8']],
    ['/agent-skill/SKILL.md', ['agent-skill/SKILL.md','text/plain; charset=utf-8']],
    ['/agent-skill/references/jobs.md', ['agent-skill/references/jobs.md','text/plain; charset=utf-8']],
    ['/', ['index.html', 'text/html; charset=utf-8']],
    ['/index.html', ['index.html', 'text/html; charset=utf-8']],
    ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
    ['/host-navigation.js', ['host-navigation.js', 'text/javascript; charset=utf-8']],
    ['/landing.js', ['landing.js', 'text/javascript; charset=utf-8']],
    ['/landing.css', ['landing.css', 'text/css; charset=utf-8']],
    ['/docs/', ['docs/index.html', 'text/html; charset=utf-8']],
    ['/docs/index.html', ['docs/index.html', 'text/html; charset=utf-8']],
    ['/docs/index.js', ['docs/index.js', 'text/javascript; charset=utf-8']],
    ['/docs/index.css', ['docs/index.css', 'text/css; charset=utf-8']],
    ['/pitch/', ['pitch/index.html', 'text/html; charset=utf-8']],
    ['/pitch/index.html', ['pitch/index.html', 'text/html; charset=utf-8']],
    ['/pitch/index.js', ['pitch/index.js', 'text/javascript; charset=utf-8']],
    ['/pitch/index.css', ['pitch/index.css', 'text/css; charset=utf-8']],
    ['/media/rare-rush-directions.mp4', ['media/rare-rush-directions.mp4', 'video/mp4']],
    ['/media/rare-rush-directions.jpg', ['media/rare-rush-directions.jpg', 'image/jpeg']],
    ['/arcade/', ['arcade/index.html', 'text/html; charset=utf-8']],
    ['/genesis/', ['genesis/index.html', 'text/html; charset=utf-8']],
    ['/genesis/index.js', ['genesis/index.js', 'text/javascript; charset=utf-8']],
    ['/genesis/index.css', ['genesis/index.css', 'text/css; charset=utf-8']],
    ['/genesis/game.html', ['genesis/game.html', 'text/html; charset=utf-8']],
    ['/genesis/child.js', ['genesis/child.js', 'text/javascript; charset=utf-8']],
    ['/genesis/child.css', ['genesis/child.css', 'text/css; charset=utf-8']],
    ['/font-licenses.txt', ['font-licenses.txt', 'text/plain; charset=utf-8']],
  ]);
  return createServer(async (request, response) => {
    if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
    try {
      const url = new URL(request.url, 'http://localhost');
      if (url.pathname === '/agent-play' || url.pathname === '/runs-feed' || url.pathname === '/leaderboard') { response.writeHead(308,{Location:url.pathname+'/'}).end(); return; }
      if (url.pathname === '/play') { response.writeHead(308, { Location: '/play/' }).end(); return; }
      if (url.pathname === '/docs') { response.writeHead(308, { Location: '/docs/' }).end(); return; }
      if (url.pathname === '/pitch') { response.writeHead(308, { Location: '/pitch/' }).end(); return; }
      if (url.pathname === '/arcade' || url.pathname === '/genesis') { response.writeHead(308, { Location: `${url.pathname}/` }).end(); return; }
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
      const cors = url.pathname === '/genesis/child.js' || output[1] === 'font/woff2' ? { 'Access-Control-Allow-Origin': '*' } : {};
      const framing = url.pathname === '/genesis/game.html' ? { 'Content-Security-Policy': "frame-ancestors 'self'" } : {};
      const headers = { 'Content-Type': output[1], 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...cors, ...framing };
      if (output[1] === 'video/mp4') {
        const content = await readFile(file);
        headers['Accept-Ranges'] = 'bytes';
        headers['Content-Length'] = content.length;
        // Let the local preview seek like the deployed static video.
        if (request.method === 'GET' && request.headers.range) {
          const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range);
          let start = 0, end = content.length - 1;
          if (range?.[1]) {
            start = Number(range[1]);
            if (range[2]) end = Math.min(Number(range[2]), end);
          } else if (range?.[2]) {
            start = Math.max(0, content.length - Number(range[2]));
          }
          if (!range || (!range[1] && !range[2]) || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= content.length) {
            response.writeHead(416, { ...headers, 'Content-Range': `bytes */${content.length}`, 'Content-Length': 0 }).end();
            return;
          }
          response.writeHead(206, { ...headers, 'Content-Range': `bytes ${start}-${end}/${content.length}`, 'Content-Length': end - start + 1 });
          response.end(content.subarray(start, end + 1));
          return;
        }
        response.writeHead(200, headers).end(request.method === 'HEAD' ? undefined : content);
        return;
      }
      response.writeHead(200, headers);
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch { response.writeHead(404).end('Not found'); }
  });
}

async function main() {
  const command = process.argv[2] ?? 'dev';
  if (!['dev', 'build'].includes(command)) throw new Error('Usage: node scripts/rush-site.mjs dev|build');
  const built = await buildRushSite({ watch: command === 'dev' });
  if (command === 'build') { console.log(`Built main site, community pages, and Arcade games in ${built.outdir}`); return; }
  const server = createRushSiteServer(built.outdir);
  server.listen(4173, '0.0.0.0', () => console.log('Rare Rush: http://localhost:4173/ · arcade: http://localhost:4173/arcade/'));
  const stop = () => { server.close(); void built.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  server.on('error', error => { console.error(error); void built.close().finally(() => process.exit(1)); });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();

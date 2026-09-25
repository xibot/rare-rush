import { build } from 'esbuild';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir, readdir, rename, stat } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, extname, sep } from 'node:path';
import { createHash } from 'node:crypto';

const here = fileURLToPath(new URL('.', import.meta.url));
const repo = resolve(here, '..');
const out = resolve(process.env.AGENT_PLAY_OUT_DIR || resolve(here, '.preview'));
const data = resolve(process.env.AGENT_PLAY_DATA_DIR || resolve(here, 'data'));
const port = Number(process.env.AGENT_PLAY_PORT || 4220);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid local port.');
const origin = `http://127.0.0.1:${port}`;
const upstream = 'https://testnet.rarerush.app';
const rpc = 'https://rpc.testnet.chain.robinhood.com';
const rpcMethods = new Set(['eth_chainId','eth_blockNumber','eth_getCode','eth_call','eth_getBalance','eth_getLogs','eth_getBlockByNumber','eth_getTransactionCount','eth_getTransactionByHash','eth_getTransactionReceipt']);
const nodePaths = [resolve(repo, 'testnet-app/node_modules')];
await mkdir(out, { recursive: true });
await mkdir(data, { recursive: true });
await build({entryPoints:[resolve(here,'index.tsx')],outdir:out,bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',nodePaths,loader:{'.woff2':'file'},assetNames:'assets/[name]-[hash]',define:{'process.env.NODE_ENV':'"production"'},logLevel:'info'});
await build({entryPoints:[resolve(here,'runner.ts')],outfile:resolve(out,'checker.mjs'),bundle:true,format:'esm',platform:'node',target:'node22',nodePaths,logLevel:'silent'});
await writeFile(resolve(out,'index.html'),await readFile(resolve(here,'index.html')));
if (process.argv.includes('--build-only')) process.exit(0);
const { checkAgentReplay } = await import(pathToFileURL(resolve(out,'checker.mjs')).href);
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.woff2':'font/woff2'};
const headers = {'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','X-Frame-Options':'DENY','X-Robots-Tag':'noindex,nofollow','Referrer-Policy':'no-referrer'};
const json = (res, status, body) => { res.writeHead(status, {...headers,'Content-Type':'application/json'}); res.end(JSON.stringify(body)); };
const clean = record => { const { replay, ...summary } = record; return summary; };
async function body(req, limit = 1_800_000) {
  if (Number(req.headers['content-length'] || 0) > limit) throw new Error('Request too large.');
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new Error('Request too large.'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function records() {
  const files = (await readdir(data)).filter(file => /^[a-f0-9]{64}\.json$/.test(file));
  const values = await Promise.all(files.map(async file => { try { return JSON.parse(await readFile(resolve(data,file),'utf8')); } catch { return null; } }));
  return values.filter(Boolean).sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}
let saving = Promise.resolve();
async function saveRecord(input, agentJobId) {
  if (!input || typeof input !== 'object' || !/^0x[0-9a-f]{64}$/i.test(input.seed)
    || !['easy','normal','degen'].includes(input.difficulty) || ![0,1].includes(input.collection)
    || typeof input.tokenId !== 'string' || !/^[1-9][0-9]{0,76}$/.test(input.tokenId)
    || !['local','arcade','testnet'].includes(input.source)) throw new Error('Invalid run identity.');
  if (input.source === 'testnet' && (typeof input.runId !== 'string' || !/^[1-9][0-9]{0,76}$/.test(input.runId)
    || typeof input.player !== 'string' || !/^0x[0-9a-f]{40}$/i.test(input.player))) throw new Error('Invalid Testnet run reference.');
  const metrics = checkAgentReplay(input.seed, input.difficulty, input.replay);
  if(input.source==='arcade' && (typeof input.player!=='string' || !/^0x[0-9a-f]{40}$/i.test(input.player))) throw new Error('Invalid Arcade player.');
  const identity = {seed:input.seed.toLowerCase(),difficulty:input.difficulty,collection:input.collection,tokenId:input.tokenId,source:input.source,
    ...(input.source !== 'local' ? {player:input.player.toLowerCase()} : {}), ...(input.source === 'testnet' ? {runId:input.runId} : {})};
  let art;
  if(input.source==='arcade') {
    const candidate=input.art;
    if(!candidate || candidate.collection!==input.collection || candidate.tokenId!==input.tokenId || candidate.owner?.toLowerCase()!==identity.player || candidate.chainId!==4663 || typeof candidate.label!=='string' || candidate.label.length>150) throw new Error('Missing Arcade artwork identity.');
    if(input.collection===1) {
      if(typeof candidate.portraitUrl!=='string' || !/^data:image\/(png|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(candidate.portraitUrl) || candidate.portraitUrl.length>500_000 || typeof candidate.bodyId!=='string' || candidate.bodyId.length>50) throw new Error('Invalid Genesis replay artwork.');
      art={collection:1,tokenId:input.tokenId,owner:identity.player,chainId:4663,label:candidate.label,portraitUrl:candidate.portraitUrl,bodyId:candidate.bodyId};
    } else {
      const sprites=candidate.sprites;
      if(!sprites || !Number.isInteger(sprites.familyId) || sprites.familyId<0 || sprites.familyId>8 || !Number.isInteger(sprites.seed) || sprites.seed<0 || sprites.seed>0xffffffff || !Array.isArray(sprites.frames) || sprites.frames.length!==64 || !sprites.frames.every(f=>typeof f==='string' && /^(0|[1-9][0-9]{0,77})$/.test(f) && BigInt(f)<2n**256n)) throw new Error('Invalid Generations replay artwork.');
      art={collection:0,tokenId:input.tokenId,owner:identity.player,chainId:4663,label:candidate.label,sprites:{familyId:sprites.familyId,seed:sprites.seed,frames:sprites.frames}};
    }
  }
  const id = createHash('sha256').update(JSON.stringify({...identity,replay:input.replay})).digest('hex');
  const file = resolve(data,`${id}.json`);
  try { return JSON.parse(await readFile(file,'utf8')); } catch { /* First recording of this run. */ }
  if ((await readdir(data)).filter(f => f.endsWith('.json')).length >= 250) throw new Error('Local replay library is full. Export or archive its data folder first.');
  const record = {id,...identity,createdAt:new Date().toISOString(),agent:'Rare Rush autopilot',verification:'local-replay',metrics,replay:input.replay,...(art?{art}: {}),...(agentJobId?{agentJobId}: {})};
  await writeFile(`${file}.tmp`,JSON.stringify(record));
  await rename(`${file}.tmp`,file);
  return record;
}
// Scheduled jobs run without this server. Import only their completed replay,
// never their wallet configuration, checkpoint store, or signer responses.
const importedJobs = new Set();
let importsLoaded = false;
async function importAgentRuns() {
  if (!importsLoaded) {
    for (const record of await records()) if (record.agentJobId) importedJobs.add(record.agentJobId);
    importsLoaded = true;
  }
  const jobs = resolve(data, 'jobs');
  let files;
  try { files = await readdir(jobs); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const file of files.filter(name => /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,95}\.json$/.test(name))) {
    const id = file.slice(0, -5);
    if (importedJobs.has(id)) continue;
    try {
      const path = resolve(jobs, file);
      if ((await stat(path)).size > 12_000_000) continue;
      const job = JSON.parse(await readFile(path, 'utf8'));
      if (job.version !== 1 || job.job?.id !== id || !job.record) continue;
      const task = saving.then(() => saveRecord(job.record, id));
      saving = task.catch(() => {});
      await task;
      importedJobs.add(id);
    } catch { /* An incomplete or invalid job cannot break the local library. */ }
  }
}
const server = createServer(async (req,res) => {
  try {
    if (req.headers.host !== `127.0.0.1:${port}`) return json(res,403,{error:'Open the local 127.0.0.1 address.'});
    const url = new URL(req.url,origin);
    const pathname = decodeURIComponent(url.pathname);
    if (req.headers.origin && req.headers.origin !== origin) return json(res,403,{error:'This preview only accepts its own local page.'});
    if (req.headers['sec-fetch-site'] === 'cross-site') return json(res,403,{error:'Cross-site requests are not allowed.'});
    if (req.method === 'POST' && (req.headers.origin !== origin || req.headers['content-type']?.split(';')[0] !== 'application/json')) return json(res,403,{error:'Use the local Agent Play page.'});
    if (['/api/status','/api/rpc','/api/verify-run'].includes(pathname)) {
      const method = pathname === '/api/status' ? 'GET' : 'POST';
      if (req.method !== method) return json(res,405,{error:'Method not allowed.'});
      const payload = method === 'POST' ? await body(req) : undefined;
      if(pathname==='/api/rpc') {
        const calls=Array.isArray(payload)?payload:[payload];
        if(!calls.length||calls.length>30||calls.some(c=>!c||c.jsonrpc!=='2.0'||!rpcMethods.has(c.method)||!Array.isArray(c.params??[]))) return json(res,403,{error:'Only supported Testnet reads are allowed.'});
      }
      const reply = await fetch(pathname==='/api/rpc'?rpc:upstream+pathname,{method,headers:{'Content-Type':'application/json','Origin':upstream,'Sec-Fetch-Site':'same-origin'},
        ...(payload === undefined ? {} : {body:JSON.stringify(payload)}),signal:AbortSignal.timeout(45_000),redirect:'error'});
      const content = await reply.json();
      return json(res,reply.status,content);
    }
    if (pathname === '/api/runs' && req.method === 'GET') {
      await importAgentRuns();
      return json(res,200,{runs:(await records()).map(clean)});
    }
    if (pathname === '/api/runs' && req.method === 'POST') {
      const input = await body(req);
      const next = saving.then(() => saveRecord(input)); saving = next.catch(()=>{});
      return json(res,200,clean(await next));
    }
    if (/^\/api\/runs\/[a-f0-9]{64}$/.test(pathname) && req.method === 'GET') {
      const id = pathname.split('/').at(-1);
      try { return json(res,200,JSON.parse(await readFile(resolve(data,`${id}.json`),'utf8'))); }
      catch { return json(res,404,{error:'Replay not found.'}); }
    }
    if (pathname.startsWith('/api/')) return json(res,404,{error:'Unknown local route.'});
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res,405,{error:'Method not allowed.'});
    if (/^\/agent-skill\/(SKILL\.md|references\/[a-z0-9-]+\.md)$/.test(pathname)) {
      const file = resolve(here, 'skills/rarerushgame', pathname.slice('/agent-skill/'.length));
      try {
        const bytes = await readFile(file);
        res.writeHead(200,{...headers,'Content-Type':'text/plain; charset=utf-8'});
        return res.end(req.method === 'HEAD' ? undefined : bytes);
      } catch { return json(res,404,{error:'Skill file not found.'}); }
    }
    const file = resolve(out,'.'+(pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(out+sep) || !types[extname(file)]) return json(res,404,{error:'Not found.'});
    const bytes = await readFile(file);
    res.writeHead(200,{...headers,'Content-Type':types[extname(file)]}); res.end(req.method === 'HEAD' ? undefined : bytes);
  } catch (error) {
    const localInput = req.url?.startsWith('/api/runs');
    json(res,localInput ? 400 : 502,{error:localInput ? String(error.message).slice(0,180) : 'The Testnet connection did not respond. Try again.'});
  }
});
server.requestTimeout=15_000;
server.listen(port,'127.0.0.1',()=>console.log(`AGENT PLAY (local only): ${origin}/`));

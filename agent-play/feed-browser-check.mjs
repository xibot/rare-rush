/** Isolated local feed QA. No live chain calls, wallet actions or user-library writes. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { createAgentSession, runSessionToEnd, exportAgentReplay, AGENT_REPLAY_VERSION, PROTOCOL_VERSION } from './runner.ts';
import { createRun, stepRun, FIXED_STEP } from '../games/rare-rush/twist/engine.ts';

const here=dirname(fileURLToPath(import.meta.url)), repo=resolve(here,'..');
const temporary=await mkdtemp(resolve(tmpdir(),'rare-rush-feed-qa-'));
const artifacts=resolve(here,'artifacts/feed-check');
const port=4223, origin=`http://127.0.0.1:${port}`;
const failures=[],checks=[],requests=[];
let server,browser,page,serverOutput='';
const check=message=>{checks.push(message);console.log(`✓ ${message}`);};
const seed=number=>'0x'+number.toString(16).padStart(64,'0');
const account='0x1111111111111111111111111111111111111111';
function fixture(number,overrides={}){
 const value=seed(number),session=runSessionToEnd(createAgentSession(value,'degen'));
 return {source:'local',collection:1,tokenId:'42',difficulty:'degen',seed:value,replay:exportAgentReplay(session),...overrides};
}
function lossFixture(){
 for(let number=200;number<210;number++){
  const value=seed(number),run=createRun(value,'degen'),frames=[];
  while(run.status==='running'){
   frames.push({tick:run._tick,jump:false,slide:false,pace:0});stepRun(run,FIXED_STEP);
  }
  if(run.finishReason==='hearts')return {source:'local',collection:0,tokenId:'9',difficulty:'degen',seed:value,replay:{version:AGENT_REPLAY_VERSION,finalTick:run._tick,inputs:{version:PROTOCOL_VERSION,frames}}};
 }
 throw Error('Could not produce a legal losing fixture');
}
async function save(input){
 const response=await fetch(origin+'/api/runs',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(input)});
 const body=await response.json();assert.equal(response.status,200,body.error);return body;
}
async function noOverflow(label){
 const size=await page.evaluate(()=>({width:innerWidth,content:document.documentElement.scrollWidth}));
 assert.ok(size.content<=size.width+1,`${label}: ${JSON.stringify(size)}`);
}
async function selectMode(name){await page.getByRole('group',{name:'Game environment'}).getByRole('button',{name:new RegExp('^'+name+' ')}).click();}

try{
 await mkdir(artifacts,{recursive:true});
 server=spawn(process.execPath,[resolve(here,'serve.mjs')],{cwd:repo,env:{...process.env,AGENT_PLAY_PORT:String(port),AGENT_PLAY_DATA_DIR:resolve(temporary,'data'),AGENT_PLAY_OUT_DIR:resolve(temporary,'out')},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',chunk=>serverOutput+=chunk);server.stderr.on('data',chunk=>serverOutput+=chunk);
 for(let i=0;i<100&&!serverOutput.includes(`AGENT PLAY (local only): ${origin}/`);i++){
  if(server.exitCode!==null)throw Error(serverOutput);await new Promise(resolve=>setTimeout(resolve,100));
 }
 assert.ok(serverOutput.includes(`AGENT PLAY (local only): ${origin}/`),serverOutput);
 browser=await chromium.launch({channel:'chrome',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},reducedMotion:'reduce'});
 page=await context.newPage();
 page.on('pageerror',error=>failures.push(error.message));
 await context.route('**/*',route=>{
  const url=new URL(route.request().url());requests.push({method:route.request().method(),path:url.pathname});
  if(url.origin!==origin){failures.push('Unexpected external request');return route.abort();}
  if(['/api/rpc','/api/status','/api/verify-run'].includes(url.pathname))return route.fulfill({status:503,contentType:'application/json',body:'{"error":"Network disabled in feed QA"}'});
  return route.continue();
 });
 await page.goto(origin+'/#runs-feed',{waitUntil:'networkidle'});
 await page.getByRole('heading',{name:'RUNS FEED.',exact:true}).waitFor();
 assert.equal(await page.locator('.runs-feed-card').count(),0);
 check('Dedicated Runs Feed URL opens an empty library');

 const saved=[];
 saved.push(await save(fixture(31)));
 saved.push(await save(fixture(32)));
 saved.push(await save(lossFixture()));
 saved.push(await save(fixture(33,{source:'testnet',collection:0,tokenId:'8',player:account,runId:'3'})));
 const portrait='data:image/svg+xml;base64,'+Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><rect width="8" height="8" fill="white"/><path d="M1 1h6v6H1zM2 2h1v1H2zM5 2h1v1H5zM3 5h2v1H3z" fill-rule="evenodd"/></svg>').toString('base64');
 saved.push(await save(fixture(34,{source:'arcade',tokenId:'77',player:account,art:{collection:1,tokenId:'77',owner:account,chainId:4663,label:'Genesis #77',portraitUrl:portrait,bodyId:'asymmetry'}})));
 await page.reload({waitUntil:'networkidle'});
 await page.locator('.runs-feed-card').nth(4).waitFor();
 assert.equal(await page.locator('.runs-feed-card').count(),5,'Every saved run is shown, including repeat Friend runs and a loss');
 for(const width of [1440,768,390,320]){
  await page.setViewportSize({width,height:1000});await noOverflow(`${width}px feed`);
  await page.screenshot({path:resolve(artifacts,`feed-${width}.png`),fullPage:true});
 }
 check('All five saved runs, including a loss and repeated Friend, appear without desktop/mobile overflow');

 await page.setViewportSize({width:1440,height:1000});
 const cards=page.locator('.runs-feed-card'),filters=page.getByRole('group',{name:'Filter runs by environment'});
 for(const [name,total] of [['PREVIEW',3],['ARCADE',1],['TESTNET',1],['ALL RUNS',5]]){
  await filters.getByRole('button',{name,exact:true}).click();
  await page.waitForFunction(total=>document.querySelectorAll('.runs-feed-card').length===total,total);
 }
 await page.getByLabel('FIND A FRIEND').fill('Genesis #42');
 await page.waitForFunction(()=>document.querySelectorAll('.runs-feed-card').length===2);
 await page.getByLabel('FIND A FRIEND').fill('');
 await page.getByLabel('SORT BY').selectOption('score');
 const best=[...saved].sort((a,b)=>b.metrics.score-a.metrics.score)[0];
 assert.equal(await cards.first().getAttribute('data-run-id'),best.id);
 check('Environment filters, Friend search and score sorting work');

 const target=page.locator(`.runs-feed-card[data-run-id="${saved[0].id}"]`);
 const heart=target.getByRole('button',{name:'Like run Genesis #42',exact:true});
 await heart.click();assert.equal(await heart.getAttribute('aria-pressed'),'true');
 assert.equal(await page.getByRole('dialog').count(),0,'Card like does not open playback');
 await page.reload({waitUntil:'networkidle'});await target.waitFor();
 assert.equal(await heart.getAttribute('aria-pressed'),'true','Like survives reload');
 await page.getByRole('button',{name:'LIKED',exact:true}).click();
 await page.waitForFunction(()=>document.querySelectorAll('.runs-feed-card').length===1);
 await page.getByRole('button',{name:'LIKED',exact:true}).click();
 check('Card hearts persist across reloads and the Liked filter works');

 // Clock-driven replay exercises saved input playback without waiting a full minute.
 await page.clock.install();
 const watch=target.getByRole('button',{name:'Watch Genesis #42, Preview run',exact:true});
 await watch.click();
 const dialog=page.getByRole('dialog',{name:'Watch saved run'});
 await dialog.locator('.agent-stage').waitFor();
 assert.equal(await dialog.getByRole('button',{name:'Unlike run',exact:true}).getAttribute('aria-pressed'),'true');
 await dialog.getByRole('button',{name:'Unlike run',exact:true}).click();
 assert.equal(await dialog.getByRole('button',{name:'Like run',exact:true}).getAttribute('aria-pressed'),'false');
 assert.equal(await heart.getAttribute('aria-pressed'),'false','Popup and card share like state');
 assert.equal(await dialog.locator('.agent-stage').getAttribute('data-running'),'false','Reduced motion starts paused');
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000});await noOverflow(`${width}px replay`);
  const fits=await dialog.evaluate(element=>element.scrollWidth<=element.clientWidth+1);
  assert.ok(fits,`${width}px replay does not overflow horizontally`);
  await page.screenshot({path:resolve(artifacts,`replay-${width}.png`),fullPage:true});
 }
 await page.setViewportSize({width:1440,height:1000});
 await dialog.getByRole('button',{name:'Play replay',exact:true}).click();
 await page.clock.runFor(1100);
 const played=Number(await dialog.locator('.agent-stage').getAttribute('data-tick'));assert.ok(played>60);
 await dialog.getByRole('button',{name:'Pause replay',exact:true}).click();
 const paused=await dialog.locator('.agent-stage').getAttribute('data-tick');
 await page.clock.runFor(500);assert.equal(await dialog.locator('.agent-stage').getAttribute('data-tick'),paused);
 await dialog.getByRole('button',{name:'Restart replay',exact:true}).click();
 await page.clock.runFor(100);assert.ok(Number(await dialog.locator('.agent-stage').getAttribute('data-tick'))<played);
 await dialog.getByLabel('Playback speed').selectOption('2');
 await page.clock.runFor(31_000);
 await dialog.locator('.replay-modal-ended').waitFor();
 await dialog.getByRole('button',{name:'REPLAY AGAIN ↻',exact:true}).click();
 await page.clock.runFor(100);
 assert.equal(await dialog.locator('.replay-modal-ended').count(),0);
 await page.keyboard.press('Escape');await dialog.waitFor({state:'detached'});
 assert.equal(await watch.evaluate(element=>document.activeElement===element),true,'Focus returns to opened card');
 check('Popup likes sync; playback, pause, restart, speed, end and Escape/focus work');

 const replayPath=origin+`/api/runs/${saved[0].id}`;
 await page.route(replayPath,route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"QA unavailable"}'}));
 await watch.click();await dialog.getByRole('alert').waitFor();
 await page.unroute(replayPath);
 await dialog.getByRole('button',{name:'RETRY REPLAY',exact:true}).click();
 await dialog.locator('.agent-stage').waitFor();
 await dialog.getByRole('button',{name:'Close replay'}).click();
 assert.equal(requests.filter(request=>request.method!=='GET').length,0,'Browsing, likes and replay never write or call a wallet/chain');
 check('Replay load failures recover with Retry; feed activity performs GET requests only');

 // Preserve a live Autopilot session while visiting the feed.
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'AGENT PLAY',exact:true}).click();
 await selectMode('PREVIEW');
 await page.getByRole('button',{name:/^WATCH AGENT PLAY/}).click();
 await page.clock.runFor(1000);
 const liveStage=page.locator('#autopilot-panel .agent-stage');
 assert.equal(await liveStage.getAttribute('data-running'),'true');
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'RUNS FEED',exact:true}).click();
 await page.getByRole('heading',{name:'RUNS FEED.',exact:true}).waitFor();
 const pausedLive=await liveStage.getAttribute('data-tick');
 await page.clock.runFor(1500);assert.equal(await liveStage.getAttribute('data-tick'),pausedLive);
 await page.getByRole('navigation',{name:'Main navigation'}).getByRole('link',{name:'AGENT PLAY',exact:true}).click();
 assert.equal(await liveStage.getAttribute('data-running'),'false');
 await page.getByRole('button',{name:'RESUME ▶',exact:true}).click();await page.clock.runFor(500);
 assert.ok(Number(await liveStage.getAttribute('data-tick'))>Number(pausedLive));
 check('Opening the feed pauses Autopilot, preserves its run, and requires explicit Resume');

 // A slow local import should not be overtaken by five-second polling.
 const pendingLists=[];
 await page.route(origin+'/api/runs',route=>{pendingLists.push(route);});
 await page.goto(origin+'/?feed-qa=slow#runs-feed',{waitUntil:'domcontentloaded'});
 await page.getByText('Loading saved runs…',{exact:true}).waitFor();
 await page.clock.runFor(6000);
 assert.equal(pendingLists.length,1,'Slow list requests are coalesced, not overtaken by polling');
 await pendingLists[0].fulfill({status:503,contentType:'application/json',body:'{"error":"Saved runs temporarily unavailable"}'});
 await page.getByRole('alert').waitFor();
 await page.unroute(origin+'/api/runs');
 await page.getByRole('button',{name:'RETRY RUNS',exact:true}).click();
 await cards.nth(4).waitFor();
 check('Slow library reads stay in flight once; feed errors recover with Retry');

 assert.deepEqual(failures,[]);
 await writeFile(resolve(artifacts,'report.json'),JSON.stringify({status:'passed',checks,failures},null,2));
 console.log(`Feed QA passed. Artifacts: ${artifacts}`);
}catch(error){
 if(page&&!page.isClosed())await page.screenshot({path:resolve(artifacts,'failure.png'),fullPage:true}).catch(()=>{});
 await writeFile(resolve(artifacts,'report.json'),JSON.stringify({status:'failed',checks,failures,error:error.stack,serverOutput},null,2));
 throw error;
}finally{
 await browser?.close();
 if(server&&server.exitCode===null&&server.signalCode===null){server.kill('SIGTERM');await new Promise(resolve=>server.once('exit',resolve));}
 await rm(temporary,{recursive:true,force:true});
}

import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {chromium} from 'playwright';
import {buildRushSite,createRushSiteServer} from './rush-site.mjs';
const outdir=await mkdtemp(path.join(tmpdir(),'rare-rush-genesis-lab-'));
let built,server,browser;
try{
 built=await buildRushSite({outdir});server=createRushSiteServer(outdir);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const origin=`http://127.0.0.1:${server.address().port}`;
 browser=await chromium.launch({headless:true});await mkdir('artifacts',{recursive:true});
 for(const width of [1120,390,360]){
  const page=await browser.newPage({viewport:{width,height:width===1120?1000:844},reducedMotion:width<500?'reduce':'no-preference'});
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>{const url=new URL(route.request().url());if(url.origin===origin||['data:','blob:'].includes(url.protocol))return route.continue();external.push(url.href);return route.abort();});
  await page.goto(`${origin}/genesis-lab/`);await page.getByRole('heading',{name:'GENESIS IN MOTION.'}).waitFor();await page.evaluate(()=>document.fonts.ready);
  const root=page.locator('.genesis-lab'),body=page.locator('.lab-stage [data-genesis-body]');
  assert.equal(await page.locator('.lab-film figure').count(),8);
  assert.equal(await root.evaluate(el=>el.scrollWidth>innerWidth),false,'Showcase fits the viewport');
  assert.match(await page.locator('.lab-body-caption').innerText(),/36 body options/);
  if(width<500){assert.equal(await root.getAttribute('data-paused'),'true');assert.equal(await root.getAttribute('data-pose'),'idle');}
  const first=await root.getAttribute('data-body-id');
  for(const pose of ['IDLE','RUN','JUMP','SLIDE']){
   await page.getByRole('button',{name:pose,exact:true}).click();await page.waitForTimeout(120);
   assert.equal(await root.getAttribute('data-body-id'),first,'Moves must retain the selected body');
   assert.equal(await body.getAttribute('data-genesis-body'),first);
  }
  await page.getByRole('button',{name:'PAUSE',exact:true}).click();await page.waitForTimeout(60);
  const frozen=await body.innerHTML();await page.waitForTimeout(150);assert.equal(await body.innerHTML(),frozen,'Pause freezes the animation');
  const squeezed=page.locator('.lab-stage [data-slide-squeeze]');
  const half=await squeezed.evaluate(el=>el.getBoundingClientRect().height);
  const full=await squeezed.evaluate(el=>{const transform=el.getAttribute('transform');el.removeAttribute('transform');const height=el.getBoundingClientRect().height;el.setAttribute('transform',transform);return height;});
  assert(Math.abs(half/full-.5)<.001,'The whole shared sprite squeezes exactly once in the showcase');
  let previous=first;
  for(let roll=0;roll<8;roll++){
   await page.getByRole('button',{name:'NEW BODY ↻',exact:true}).click();
   const next=await root.getAttribute('data-body-id');assert.notEqual(next,previous);previous=next;
   assert.equal(await root.getAttribute('data-paused'),'true','A new body respects pause');
   assert.deepEqual(await page.locator('.lab-film [data-genesis-body]').evaluateAll(els=>[...new Set(els.map(el=>el.getAttribute('data-genesis-body')))]),[next]);
  }
  const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'DOWNLOAD SPRITES ↗',exact:true}).click();const download=await downloaded;
  assert.equal(download.suggestedFilename(),`genesis-1-body-${previous}-run-sprites.svg`);
  const xml=await readFile(await download.path(),'utf8');
  const sheet=await page.evaluate(xml=>{const doc=new DOMParser().parseFromString(xml,'image/svg+xml');return{errors:doc.querySelectorAll('parsererror').length,portraits:doc.querySelectorAll('[data-genesis-art]').length,ids:[...new Set([...doc.querySelectorAll('[data-genesis-body]')].map(el=>el.getAttribute('data-genesis-body')))]};},xml);
  assert.equal(sheet.errors,0,'Export is valid SVG');assert.equal(sheet.portraits,8);assert.deepEqual(sheet.ids,[previous]);
  await page.getByRole('button',{name:'RUN',exact:true}).click();await page.waitForTimeout(180);await page.screenshot({path:`artifacts/genesis-lab-${width}.png`,fullPage:true});
  assert.equal(await page.locator('iframe').count(),0,'Public showcase contains no game or wallet iframe');
  assert.equal(await page.evaluate(()=>typeof window.ethereum),'undefined');
  assert.deepEqual(errors,[]);assert.deepEqual(external,[],'The showcase requires no RPC or external request');
  await page.getByRole('link',{name:'PLAY YOUR GENESIS ↗',exact:true}).click();await page.waitForURL(`${origin}/genesis/`);
  await page.close();console.log(`${width}px: showcase body selection, squeeze, pause, SVG export, local assets and navigation passed`);
 }
}finally{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await built?.close();await rm(outdir,{recursive:true,force:true});}

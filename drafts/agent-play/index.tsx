import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { formatUnits } from 'viem';
import { SiteHeader } from '../../games/rare-rush/SiteHeader.tsx';
import { PUBLIC_SITE, AGENT_PATH, FEED_PATH, isFeedPage } from './site-mode.ts';
import { publishRun, readRunServiceResponse } from '../../games/rare-rush/public-runs.ts';
import type { ReplayPublication } from '../../shared/replay-publication.ts';
import { BrandMark } from '../../games/rare-rush/BrandMark.tsx';
import { FIXED_STEP } from '../../games/rare-rush/twist/engine.ts';
import { DIFFICULTIES } from '../../games/rare-rush/difficulty.ts';
import { createAgentSession, advanceAgent, createReplaySession, advanceReplay, resumeAgentSession, exportAgentReplay, PROTOCOL_VERSION,
  type Difficulty, type RunSession } from './runner.ts';
import { AgentStage } from './Stage.tsx';
import { AgenticPanel } from './AgenticPanel.tsx';
import { RunsFeed } from './RunsFeed.tsx';
import { ReplayModal } from './ReplayModal.tsx';
import { useFeedLikes } from './feed-likes.ts';
import type { RunRecord } from './feed-types.ts';
import { createTestnetAdapter, isRetryableTestnetReadError, testnetFriendReadMessage } from './testnet.ts';
import { connectArcade, loadArcadeFriend, getArcadeSession, type ArcadeFriend } from './arcade.ts';
import { decodeGenerationSprites } from '@rarefriends/friendsdk/sprites';
import '../../games/rare-rush/fonts.css';
import './style.css';

type Source = 'local'|'arcade'|'testnet';
type Identity = {source:Source;collection:0|1;tokenId:string;difficulty:Difficulty;seed:string;runId?:string;player?:string};
type SavedRecord = RunRecord;
type Adapter = ReturnType<typeof createTestnetAdapter>;
type TestnetState = ReturnType<Adapter['snapshot']>;
const MODES:Difficulty[] = ['easy','normal','degen'];
const seed = () => '0x'+Array.from(crypto.getRandomValues(new Uint8Array(32)),n=>n.toString(16).padStart(2,'0')).join('');
const short = (value:string) => `${value.slice(0,6)}…${value.slice(-4)}`;
const validId = (value:string) => /^[1-9][0-9]{0,76}$/.test(value);
const fmt = (value:bigint|undefined,decimals=18) => value == null ? '—' : Number(formatUnits(value,decimals)).toLocaleString('en-US',{maximumFractionDigits:3});
const err = (error:unknown) => (error as any)?.shortMessage || (error as Error)?.message || 'Something did not connect. Try again.';
async function request(path:string, body?:unknown) {
  const response = await fetch(path,{...(body === undefined ? {} : {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body,(_,v)=>typeof v==='bigint'?v.toString():v)}),signal:AbortSignal.timeout(20_000)});
  return readRunServiceResponse<any>(response);
}

function App() {
  const [view,setView] = useState<'autopilot'|'agentic'>('autopilot');
  const [page,setPage] = useState<'play'|'feed'>(()=>isFeedPage()?'feed':'play');
  const [feedRun,setFeedRun] = useState<RunRecord|null>(null);
  const {likes,toggleLike,likesError}=useFeedLikes();
  const [recordsLoading,setRecordsLoading]=useState(true), [recordsError,setRecordsError]=useState('');
  const recordsRequest=useRef<Promise<void>|null>(null);
  const paginationStarted=useRef(false);
  const [nextCursor,setNextCursor]=useState<string|null>(null);
  const [loadingMore,setLoadingMore]=useState(false), pagingRef=useRef(false);
  const [source,setSource] = useState<Source>('local');
  const [collection,setCollection] = useState<0|1>(1), [tokenId,setTokenId] = useState('1');
  const [difficulty,setDifficulty] = useState<Difficulty>('degen');
  const [session,setSession] = useState<RunSession>(()=>createAgentSession(seed(),'degen'));
  const live = useRef(session); live.current=session;
  const identity = useRef<Identity|null>(null);
  const [current,setCurrent] = useState<Identity|null>(null);
  const [running,setRunning] = useState(false), runningRef=useRef(false);
  const [screen,setScreen] = useState<'ready'|'watch'|'result'>('ready');
  const [tick,setTick] = useState(0), [reduced,setReduced] = useState(()=>matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [speed,setSpeed] = useState(1), speedRef=useRef(1);speedRef.current=speed;
  const [busy,setBusy] = useState(''), actionLock=useRef(false);
  const [error,setError] = useState(''), [notice,setNotice] = useState('');
  const [record,setRecord] = useState<SavedRecord|null>(null), [records,setRecords] = useState<SavedRecord[]>([]);
  const recordsRef=useRef(records);recordsRef.current=records;
  const [filter,setFilter] = useState<'all'|Difficulty>('all');
  const [tn,setTn] = useState<TestnetState|null>(null), adapter=useRef<Adapter|null>(null);
  const [arcade,setArcade] = useState<any>(null), [arcadeArt,setArcadeArt] = useState<any>(null);
  const artRef=useRef<ArcadeFriend|null>(null);
  const [pendingHash,setPendingHash] = useState(''), [recoverId,setRecoverId] = useState('');
  const [checkingFriend,setCheckingFriend]=useState(false);
  const friendCheckAttempt=useRef(''), friendReadError=useRef<string|null>(null);
  const [now,setNow]=useState(Date.now());
  const stageAnchor=useRef<HTMLDivElement>(null);
  const setupAnchor=useRef<HTMLElement>(null);
  const resultHeading=useRef<HTMLHeadingElement>(null);
  const callback=useRef<(s:RunSession)=>void>(()=>{});
  const checkpointTick=useRef(0);
  const completed=useRef(false);
  const playing = screen==='watch';
  const frozen = playing || !!busy || !!tn?.busy;
  const selectionMatches = tn?.selected?.collection===collection && tn.selected.tokenId===tokenId;
  const pending = tn?.playState?.pending || tn?.assetPending;
  const stateRun = tn?.playState?.savedRun;
  const needApproval = source==='testnet' && collection===0 && (tn?.balances?.allowance??0n)<110n*10n**18n;
  const tnReady = !!tn?.account && tn.chainId===46630 && tn.verified && !!tn.balances && !tn.paused && tn.verifier==='ready' && selectionMatches && (tn.selected?.remainingStarts??0)>0 && !pending;
  const activeSaved = !!stateRun && !['claimed','abandoned'].includes(stateRun.status) && Number(stateRun.run.claimUntil)*1000>now;
  const freshClaim=!!stateRun?.claim && Number(stateRun.claim.deadline)*1000>now+5000;
  const claimWindowOpen=!!stateRun && Number(stateRun.run.claimUntil)*1000>now;

  const stop = () => {runningRef.current=false;setRunning(false);};
  const play = () => {runningRef.current=true;setRunning(true);};
  function chooseView(next:'autopilot'|'agentic') {
    if(actionLock.current||tn?.busy)return;
    if(next==='agentic'&&runningRef.current){
      stop();
      try{checkpoint();}catch(e){setError(err(e));}
      setNotice('Autopilot is paused. Return to Autopilot and choose Resume to continue.');
    }
    setView(next);
  }
  useEffect(()=>{
    if(screen==='result'&&view==='autopilot')resultHeading.current?.focus({preventScroll:true});
  },[screen,view]);
  async function act(label:string, work:()=>Promise<void>) {
    if(actionLock.current)return;
    actionLock.current=true;setBusy(label);setError('');setNotice('');
    try {await work();} catch(e) {setError(err(e));}
    finally {actionLock.current=false;setBusy('');}
  }
  function clearFriendReadError() {
    const previous=friendReadError.current;friendReadError.current=null;
    if(previous)setError(current=>current===previous?'':current);
  }
  async function testnetRead<T,>(work:()=>Promise<T>):Promise<T> {
    try {const result=await work();clearFriendReadError();return result;}
    catch(error) {const message=testnetFriendReadMessage(error);friendReadError.current=message;throw new Error(message);}
  }
  const checkSelectedFriend=()=>testnetRead(()=>adapter.current!.prepareFriend(collection,tokenId));
  useEffect(()=>{
    if(source!=='testnet'||!tn?.account||tn.chainId!==46630||!validId(tokenId)) {friendCheckAttempt.current='';return;}
    if(playing||busy||tn.busy)return;
    const key=`${tn.account.toLowerCase()}:${tn.chainId}:${collection}:${tokenId}`;
    const current=adapter.current?.snapshot();
    if(current?.verified&&current.balances&&current.verifier==='ready'&&current.selected?.collection===collection&&current.selected.tokenId===tokenId)return;
    if(friendCheckAttempt.current===key)return;
    let cancelled=false;
    const timer=setTimeout(()=>{
      if(cancelled)return;
      friendCheckAttempt.current=key;setCheckingFriend(true);
      void (async()=>{
        try {
          for(let attempt=0;attempt<2;attempt++) {
            try {await adapter.current!.prepareFriend(collection,tokenId);if(!cancelled)clearFriendReadError();return;}
            catch(error) {
              if(cancelled)return;
              if(attempt===0&&isRetryableTestnetReadError(error)) {await new Promise(resolve=>setTimeout(resolve,800));if(cancelled)return;continue;}
              const message=testnetFriendReadMessage(error);friendReadError.current=message;setError(message);return;
            }
          }
        } finally {if(!cancelled)setCheckingFriend(false);}
      })();
    },300);
    return ()=>{cancelled=true;clearTimeout(timer);setCheckingFriend(false);};
    // Readiness emissions deliberately do not restart this bounded attempt.
  },[source,tn?.account,tn?.chainId,collection,tokenId,playing,busy,tn?.busy]);
  function loadRecords():Promise<void> {
    if(recordsRequest.current)return recordsRequest.current;
    if(pagingRef.current)return Promise.resolve();
    recordsRequest.current=(async()=>{
      try {const result=await request('/api/runs'),fresh=result.runs as RunRecord[];
        const gap=PUBLIC_SITE&&recordsRef.current.length>0&&fresh.length>0&&!fresh.some(r=>recordsRef.current.some(old=>old.id===r.id));
        setRecords(previous=>PUBLIC_SITE?[...fresh,...previous.filter(r=>!fresh.some(n=>n.id===r.id))]:fresh);
        // If a full page of new runs arrived, traverse from its cursor to fill
        // the gap instead of leaving those runs unreachable until a reload.
        if(!paginationStarted.current||gap)setNextCursor(result.nextCursor??result.cursor??null);setRecordsError('');}
      catch(e){setRecordsError(err(e));throw e;}
      finally {recordsRequest.current=null;setRecordsLoading(false);}
    })();
    return recordsRequest.current;
  }
  async function moreRecords() {
    if(pagingRef.current||!nextCursor)return;
    if(recordsRequest.current){await recordsRequest.current.catch(()=>{});return;}
    pagingRef.current=true;setLoadingMore(true);
    try{const result=await request('/api/runs?cursor='+encodeURIComponent(nextCursor));setRecords(previous=>[...previous,...(result.runs as RunRecord[]).filter(r=>!previous.some(p=>p.id===r.id))]);paginationStarted.current=true;setNextCursor(result.nextCursor??result.cursor??null);setRecordsError('');}
    catch(e){setRecordsError(err(e));}finally{pagingRef.current=false;setLoadingMore(false);}
  }
  function navigateCommunity(feed:boolean) {
    if(PUBLIC_SITE){history.pushState(null,'',feed?FEED_PATH:AGENT_PATH);window.dispatchEvent(new PopStateEvent('popstate'));}
    else location.hash=feed?'runs-feed':'agent-play';
  }
  function openFeed(){if(actionLock.current||tn?.busy)return;navigateCommunity(true);}
  function backToPlay(){navigateCommunity(false);}
  useEffect(()=>{
    const route=()=>{
      const next=isFeedPage()?'feed':'play';
      if(next==='feed'&&runningRef.current){stop();try{checkpoint();}catch(e){setError(err(e));}setNotice('Your Autopilot run is paused. Choose Resume when you return.');}
      setPage(next);if(PUBLIC_SITE)document.title=`Rare Rush | ${next==='feed'?'Runs Feed':'Agent Play'}`;if(next==='play')setFeedRun(null);
    };
    window.addEventListener('hashchange',route);window.addEventListener('popstate',route);
    return()=>{window.removeEventListener('hashchange',route);window.removeEventListener('popstate',route);};
  },[]);
  useEffect(()=>{
    if(!PUBLIC_SITE||page!=='feed')return;
    const id=new URLSearchParams(location.search).get('run');if(!id||!/^[a-f0-9]{64}$/.test(id))return;
    let alive=true;void request('/api/runs/'+id).then(value=>{if(alive)setFeedRun(value);}).catch(e=>{if(alive)setRecordsError(err(e));});
    return()=>{alive=false;};
  },[page]);
  useEffect(()=>{
    document.title=page==='feed'?'Rare Rush | Runs Feed':'Rare Rush | Agent Play';
    requestAnimationFrame(()=>window.scrollTo({top:0,behavior:'instant'}));
  },[page]);
  useEffect(()=>{
    const client=createTestnetAdapter({onState:next=>{
      if(identity.current?.source==='testnet' && live.current.kind==='agent' && (next.account?.toLowerCase()!==identity.current.player?.toLowerCase()||next.chainId!==46630)) {stop();setNotice('Testnet wallet changed. Reconnect the original wallet to resume.');}
      setTn(next);
    },onError:e=>setError(err(e))});adapter.current=client;setTn(client.snapshot());
    let revision=getArcadeSession().getSnapshot().revision;
    const unsubscribe=getArcadeSession().subscribe(()=>{const next=getArcadeSession().getSnapshot();if(next.revision!==revision){revision=next.revision;if(identity.current?.source==='arcade'){stop();setArcade(null);setNotice('Arcade wallet changed. Reconnect before resuming.');}}});
    void loadRecords().catch(e=>setError(err(e)));
    const timer=setInterval(()=>setNow(Date.now()),1000);
    const libraryTimer=setInterval(()=>{if(!document.hidden)void loadRecords().catch(()=>{});},PUBLIC_SITE?30_000:5000);
    const refreshLibrary=()=>{if(!document.hidden)void loadRecords().catch(()=>{});};
    document.addEventListener('visibilitychange',refreshLibrary);
    return ()=>{client.dispose();adapter.current=null;unsubscribe();clearInterval(timer);clearInterval(libraryTimer);document.removeEventListener('visibilitychange',refreshLibrary);};
  },[]);
  useEffect(()=>{if(screen==='ready'){const next=createAgentSession(seed(),difficulty);live.current=next;setSession(next);setTick(0);}},[screen,difficulty,collection,tokenId]);
  function checkpoint(s=live.current) {
    if(identity.current?.source==='testnet' && s.kind==='agent' && s.run._tick>checkpointTick.current) {
      adapter.current?.saveReplay(identity.current.runId!,{version:PROTOCOL_VERSION,frames:s.frames},s.run._tick);
      checkpointTick.current=s.run._tick;
    }
  }
  async function savePublicRun() {
    const runIdentity=identity.current,s=live.current;
    if(!runIdentity||runIdentity.source==='local'||s.kind==='replay'||s.run.status!=='finished')throw new Error('Complete an Arcade or Testnet run first.');
    const provider=runIdentity.source==='arcade'?arcade?.provider:(window as any).ethereum;
    if(!provider)throw new Error('Reconnect the wallet used for this run.');
    const originalArt=artRef.current;
    const art=originalArt?{collection:originalArt.collection,tokenId:originalArt.tokenId,owner:originalArt.owner,
      chainId:originalArt.chainId,blockNumber:String(originalArt.blockNumber),label:originalArt.label,
      ...(originalArt.portraitUrl?{portraitUrl:originalArt.portraitUrl,bodyId:originalArt.bodyId}:{}),
      ...(originalArt.sprites?{sprites:{familyId:originalArt.sprites.familyId,seed:originalArt.sprites.seed,
        frames:originalArt.sprites.frames.map(String)}}:{})}:undefined;
    const payload={...runIdentity,source:runIdentity.source,player:runIdentity.player!,actor:'autopilot',replay:exportAgentReplay(s),...(runIdentity.source==='arcade'?{art}:{})} as ReplayPublication;
    const saved=await publishRun(payload,provider);
    if(live.current===s)setRecord(saved);
    await loadRecords();setNotice('Your run is saved in the public Runs Feed.');
  }
  async function finish(s:RunSession) {
    const runIdentity=identity.current,runArt=artRef.current;
    stop();setScreen('result');
    if(s.kind==='replay')return;
    try {checkpoint(s);}catch(e){setError(err(e));}
    if(PUBLIC_SITE)return;
    try {
      const saved=await request('/api/runs',{...runIdentity,replay:exportAgentReplay(s),...(runIdentity?.source==='arcade'?{art:runArt}:{})});
      if(live.current===s&&identity.current===runIdentity)setRecord(saved);await loadRecords();
    }catch(e){if(live.current===s&&identity.current===runIdentity)setError(`Run finished. ${err(e)} You can still download its replay.`);}
  }
  callback.current=s=>{if(!completed.current){completed.current=true;void finish(s);}};
  useEffect(()=>{
    let raf=0,previous=performance.now(),accumulator=0;
    const frame=(now:number)=>{
      const delta=(now-previous)/1000;previous=now;
      if(runningRef.current){
        if(delta>.5 || document.hidden){stop();try{checkpoint();}catch(e){setError(err(e));}setNotice('Paused while the page was away. Resume when ready.');}
        else {
          accumulator+=Math.max(0,delta)*speedRef.current;
          const s=live.current;
          while(accumulator+1e-10>=FIXED_STEP && s.run.status==='running'){
            accumulator=Math.max(0,accumulator-FIXED_STEP);
            if(s.kind==='agent')advanceAgent(s);else advanceReplay(s);
          }
          if(identity.current?.source==='testnet' && s.kind==='agent' && s.run._tick-checkpointTick.current>=240){
            try{checkpoint(s);}catch(e){stop();setError(`Could not save the current run: ${err(e)}`);}
          }
          setTick(s.run._tick);
          if(s.run.status==='finished')callback.current(s);
        }
      }else accumulator=0;
      raf=requestAnimationFrame(frame);
    };
    raf=requestAnimationFrame(frame);
    const hidden=()=>{if(document.hidden && runningRef.current){stop();try{checkpoint();}catch(e){setError(err(e));}}};
    const unload=()=>{try{checkpoint();}catch{}};
    const changed=()=>{setArcade(null);if(identity.current?.source==='testnet'){stop();setNotice('Wallet changed. Reconnect before continuing this run.');}};
    document.addEventListener('visibilitychange',hidden);window.addEventListener('pagehide',unload);
    const wallet=(window as any).ethereum;wallet?.on?.('accountsChanged',changed);wallet?.on?.('chainChanged',changed);wallet?.on?.('disconnect',changed);
    return()=>{cancelAnimationFrame(raf);document.removeEventListener('visibilitychange',hidden);window.removeEventListener('pagehide',unload);wallet?.removeListener?.('accountsChanged',changed);wallet?.removeListener?.('chainChanged',changed);wallet?.removeListener?.('disconnect',changed);};
  },[]);
  function chooseSource(next:Source) {
    if(frozen)return;adapter.current?.cancelFriendCheck();friendCheckAttempt.current='';setSource(next);setError('');setNotice('');setScreen('ready');setRecord(null);setCurrent(null);identity.current=null;setArcadeArt(null);
    if(next==='testnet')void act('Checking wallet…',async()=>{await testnetRead(()=>adapter.current!.restore());});
  }
  function launch(s:RunSession,id:Identity,art?:any) {
    setView('autopilot');
    live.current=s;setSession(s);identity.current=id;setCurrent(id);setRecord(null);setTick(s.run._tick);completed.current=false;checkpointTick.current=s.run._tick;
    setScreen('watch');setSpeed(1);speedRef.current=1;artRef.current=art??null;setArcadeArt(art??null);
    if(isFeedPage()){stop();setNotice('Your Autopilot run is paused. Choose Resume when you return.');}
    else {play();requestAnimationFrame(()=>stageAnchor.current?.scrollIntoView({behavior:'smooth',block:'start'}));}
  }
  async function begin() {
    if(!validId(tokenId))throw new Error('Enter a positive Friend ID.');
    let runSeed=seed(), runId:string|undefined, player:string|undefined, art:any;
    if(source==='arcade'){
      if(!arcade?.account)throw new Error('Connect the wallet that owns your Rare Friend.');
      art=await loadArcadeFriend(arcade.provider,arcade.account,collection,tokenId);player=arcade.account;
    }
    if(source==='testnet'){
      if(needApproval){await adapter.current!.approve();await adapter.current!.inspectFriend(collection,tokenId);setNotice('Approval confirmed. You can now start the agent run.');return;}
      const run=await adapter.current!.start({collection,tokenId,difficulty:MODES.indexOf(difficulty) as 0|1|2});
      runSeed=run.seed;runId=run.runId;player=run.player;
    }
    launch(createAgentSession(runSeed,difficulty),{source,collection,tokenId,difficulty,seed:runSeed,...(runId?{runId}:{}),...(player?{player}:{})},art);
  }
  function resumeSaved() {
    const snap=adapter.current!.snapshot(),saved=snap.playState?.savedRun;if(!saved)throw new Error('No saved Testnet run.');
    if(saved.run.player.toLowerCase()!==snap.account?.toLowerCase()||snap.chainId!==46630||!snap.verified)throw new Error('Reconnect the run wallet on Robinhood Testnet.');
    if(snap.playState?.pending||snap.assetPending)throw new Error('Recover the pending wallet transaction first.');
    if(['claimed','abandoned'].includes(saved.status)){setNotice(`Run #${saved.run.runId} is already ${saved.status}. Choose another run.`);return;}
    if(Number(saved.run.claimUntil)*1000<=Date.now()){setNotice('This run’s claim window has expired. You can start a new run with an available Friend.');return;}
    const mode=MODES[saved.run.difficulty];setDifficulty(mode);setCollection(saved.run.collection);setTokenId(saved.run.tokenId);
    const s=resumeAgentSession(saved.run.seed,mode,saved.replay,saved.completedTicks);
    launch(s,{source:'testnet',collection:saved.run.collection,tokenId:saved.run.tokenId,difficulty:mode,seed:saved.run.seed,runId:saved.run.runId,player:saved.run.player});
    if(s.run.status==='finished')callback.current(s);
  }
  async function replayRecord(item:SavedRecord){
    const full=await request(`/api/runs/${item.id}`);const s=createReplaySession(full.seed,full.difficulty,full.replay);
    let art=full.art;
    if(art?.sprites)art={...art,sprites:decodeGenerationSprites(BigInt(art.tokenId),art.sprites.familyId,art.sprites.seed,art.sprites.frames.map(BigInt))};
    launch(s,full,art);setRecord(full);
  }
  async function resume(){
    if(session.kind==='agent'&&current?.source==='arcade'){
      if(!arcade || arcade.account.toLowerCase()!==current.player?.toLowerCase())throw new Error('Reconnect the original Arcade wallet to resume.');
      const art=await loadArcadeFriend(arcade.provider,arcade.account,current.collection,current.tokenId);setArcadeArt(art);artRef.current=art;
    }
    if(session.kind==='agent'&&current?.source==='testnet'){
      const snap=adapter.current!.snapshot();
      if(snap.account?.toLowerCase()!==current.player?.toLowerCase()||snap.chainId!==46630)throw new Error('Reconnect the original Testnet wallet to resume.');
      if(!snap.verified||snap.playState?.pending||snap.assetPending)throw new Error('Refresh the wallet and recover any pending transaction before resuming.');
      if(!snap.playState?.savedRun||Number(snap.playState.savedRun.run.claimUntil)*1000<=Date.now())throw new Error('This run’s claim window expired. Save and exit, then pick your next run.');
      await adapter.current!.inspectFriend(current.collection,current.tokenId);
    }
    setNotice('');play();
  }
  function download(){
    const payload={...identity.current,agent:'Rare Rush prototype autopilot',replay:exportAgentReplay(live.current),...(artRef.current?{art:artRef.current}:{})};
    const url=URL.createObjectURL(new Blob([JSON.stringify(payload,(_,v)=>typeof v==='bigint'?v.toString():v,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`rare-rush-agent-${current?.runId??'local'}-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function reset(){stop();setScreen('ready');setCurrent(null);identity.current=null;setRecord(null);setNotice('');requestAnimationFrame(()=>setupAnchor.current?.scrollIntoView({behavior:reduced?'instant':'smooth',block:'start'}));if(source==='testnet'&&tn?.account)await adapter.current!.inspectFriend(collection,tokenId);}
  const best = [...records].filter(r=>filter==='all'||r.difficulty===filter).sort((a,b)=>b.metrics.score-a.metrics.score).filter((r,i,list)=>list.findIndex(q=>`${q.source}:${q.collection}:${q.tokenId}`===`${r.source}:${r.collection}:${r.tokenId}`)===i);
  const displayCollection=current?.collection??collection, displayToken=current?.tokenId??tokenId;
  const isTestnetRun=current?.source==='testnet' && session.kind==='agent';
  const matchesSaved=isTestnetRun && stateRun?.run.runId===current?.runId;
  return <div className={`agent-app ${PUBLIC_SITE?'public-community':''}`}>
    {PUBLIC_SITE?<SiteHeader page={page==='feed'?'runs-feed':'agent-play'}/>:<header className="site-header"><a className="brand" href="/" aria-label="Rare Rush Agent Play"><BrandMark/></a><nav aria-label="Main navigation">{page==='feed'?<a href="#agent-play">AGENT PLAY</a>:<a href="#runs-feed" aria-disabled={!!busy||!!tn?.busy} onClick={event=>{event.preventDefault();openFeed();}}>RUNS FEED</a>}<a href="https://rarerush.app" target="_blank" rel="noreferrer">ARCADE ↗</a><span className="local-label">LOCAL PROTOTYPE</span></nav></header>}
    <main>
      <div id="agent-play" hidden={page!=='play'}>
      <section className="hero"><div><p className="eyebrow">YOUR FRIEND. A NEW PLAYER.</p><h1>AGENT <span>PLAY.</span></h1></div><p>Your Friend. Your agent.<br/>Choose how you want to rush.</p></section>
      <div className="play-modes" role="tablist" aria-label="Agent Play mode">{(['autopilot','agentic'] as const).map(mode=><button key={mode} id={`${mode}-tab`} role="tab" aria-label={mode.toUpperCase()} aria-selected={view===mode} aria-controls={`${mode}-panel`} tabIndex={view===mode?0:-1} disabled={!!busy||!!tn?.busy} onClick={()=>chooseView(mode)} onKeyDown={event=>{
        if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
        event.preventDefault();
        const next=event.key==='Home'?'autopilot':event.key==='End'?'agentic':mode==='autopilot'?'agentic':'autopilot';
        chooseView(next);document.getElementById(`${next}-tab`)?.focus();
      }}><b>{mode.toUpperCase()}</b><span>{mode==='autopilot'?'Watch in your browser':'Run with your own agent'}</span></button>)}</div>
      <div className="prototype-note"><span><i/> {view==='autopilot'?'BROWSER AUTOPILOT':'AUTONOMOUS AGENT'}</span><p>{view==='autopilot'?'Choose a Friend below. The controller takes the turns.':'Give your agent the skill. Configure its wallet and schedule.'}</p></div>
      {error&&<div className="message error" role="alert">{error}</div>}{notice&&<div className="message" role="status">{notice}</div>}
      <div id="autopilot-panel" role="tabpanel" aria-labelledby="autopilot-tab" hidden={view!=='autopilot'}>
      <div ref={stageAnchor} className="watch-section" data-screen={screen} data-tick={tick}>
        <div className="section-top"><span className="eyebrow">01 / {session.kind==='replay'?'WATCH THE REPLAY':'WATCH THE RUSH'}</span><span>{screen==='ready'?'READY WHEN YOU ARE':screen==='result'?'RUN COMPLETE':running?'AGENT AT THE CONTROLS':'PAUSED'}</span></div>
        <AgentStage run={session.run} collection={displayCollection} tokenId={validId(displayToken)?displayToken:'1'} running={running} reducedMotion={reduced} label={(current?.source??source)==='testnet'?'TESTNET':(current?.source??source)==='arcade'?'ARCADE':'LOCAL PREVIEW'} art={arcadeArt} fieldOverlay={screen==='result'&&<div className="agent-result-overlay" role="dialog" aria-label="Agent run result"><section className="result-card"><p className="eyebrow">{session.run.finishReason==='time'?'TIMER SURVIVED.':'OUT OF HEARTS.'}</p><h2 ref={resultHeading} tabIndex={-1}>{session.run.finishReason==='time'?'KEEP IT RARE.':'ANOTHER RUSH AWAITS.'}</h2><div className="result-score">{session.run.score.toLocaleString()}<span>POINTS</span></div><div className="result-stats"><span><b>{Math.floor(session.run.distance).toLocaleString()}m</b>DISTANCE</span><span><b>{session.run.coins}</b>COINS</span><span><b>{session.run.hearts}</b>HEARTS</span></div><p>{record?(PUBLIC_SITE?'✓ Replay verified and saved to the public feed.':'✓ Replay checked locally and saved to this computer.'):'Replay ready to save.'}</p><div className="inline-actions"><button onClick={download}>SAVE REPLAY ↓</button>{record&&<button disabled={!!busy} onClick={openFeed}>VIEW IN RUNS FEED ↗</button>}{record&&<button disabled={!!busy} onClick={()=>void act('Loading replay…',async()=>{await replayRecord(record);})}>WATCH REPLAY ▶</button>}{!record&&(PUBLIC_SITE?current?.source!=='local':true)&&<button disabled={!!busy} onClick={()=>void act(PUBLIC_SITE?'Sign to publish your replay…':'Saving replay…',async()=>{if(PUBLIC_SITE)await savePublicRun();else await finish(session);})}>{PUBLIC_SITE?'SAVE RUN':'RETRY SAVE'}</button>}</div>{PUBLIC_SITE&&current?.source!=='local'&&!record&&<p className="community-publish-note">Sign to publish your wallet address, Friend and replay. No transaction or gas fee.</p>}
          {isTestnetRun&&matchesSaved&&stateRun&&<div className="claim-actions">{stateRun.status==='claimed'?<p className="lime">MINT CONFIRMED · {stateRun.reward?`${fmt(BigInt(stateRun.reward),6)} tRARERUSH`:''}</p>:!claimWindowOpen?<p>This run’s claim window expired. Pick your next run; its replay remains saved locally.</p>:session.run.finishReason==='time'?<><p>Survived runs can request a verifier signature, then claim through your wallet.</p><button disabled={!!busy||!!pending} onClick={()=>void act(freshClaim?'Confirm claim in your wallet…':'Sign replay authorization…',async()=>{if(freshClaim){await adapter.current!.claim();setNotice('Your Testnet mint is confirmed.');}else{await adapter.current!.verify();setNotice('Replay verified. Claim in your wallet when ready.');}})}>{freshClaim?'CLAIM TESTNET REWARD ↗':'VERIFY TESTNET RUN ↗'}</button></>:stateRun.status!=='abandoned'&&<><p>This run earned no claim. Close it onchain to free this NFT for its next attempt.</p><button disabled={!!busy||!!pending} onClick={()=>void act('Close run in your wallet…',async()=>{await adapter.current!.abandon();setNotice('Run closed. Remaining daily attempts are available.');})}>CLOSE TESTNET RUN</button></>}</div>}
          <button className="primary next-run" disabled={!!busy} onClick={()=>void act('Preparing next run…',reset)}>PICK NEXT RUN ↗</button>
          {busy&&<p className="result-progress" role="status">{busy}</p>}
          {error&&<p className="result-error">{error}</p>}
        </section></div>}/>
        <div className="watch-controls"><div className="inline-actions">{playing&&<button className="light-button" disabled={!!busy} onClick={()=>void act(running?'Saving pause…':'Resuming…',async()=>{if(running){stop();checkpoint();}else await resume();})}>{running?'PAUSE Ⅱ':'RESUME ▶'}</button>}<button aria-pressed={reduced} onClick={()=>setReduced(v=>!v)}>FX {reduced?'OFF':'ON'}</button>{playing&&<button disabled={!!busy} onClick={()=>void act('Saving run…',async()=>{try{checkpoint();}catch(e){setNotice(`Kept the last saved checkpoint. ${err(e)}`);}finally{await reset();}})}>{current?.source==='testnet'?'SAVE & EXIT':'EXIT RUN'}</button>}{playing&&!isTestnetRun&&<button onClick={()=>setSpeed(v=>v===1?2:v===2?4:1)}>{speed}× PLAYBACK</button>}</div><span className="muted">{session.kind==='replay'?'RECORDED INPUTS':session.lastControl?.jump?'↑ JUMP':session.lastControl?.slide?'↓ SLIDE':session.lastControl?.pace===-1?'← STEER':session.lastControl?.pace===1?'→ STEER':'AUTO RUN'} · {Math.floor(session.run.score).toLocaleString()} POINTS</span></div>

      </div>
      <section ref={setupAnchor} className="setup" aria-label="Agent run setup">
        <div className="section-top"><span className="eyebrow">02 / SET UP YOUR RUN</span><span className="muted">→ ↑ ↓ ←</span></div>
        <div className="sources" role="group" aria-label="Game environment">{([{id:'local',label:'PREVIEW',copy:'No wallet · sample Friend'},{id:'arcade',label:'ARCADE',copy:'Your real Rare Friend · simulated rewards'},{id:'testnet',label:'TESTNET',copy:'Test Friend · play to mint'}] as const).map(m=><button key={m.id} disabled={frozen} aria-pressed={source===m.id} onClick={()=>chooseSource(m.id)}><b>{m.label}</b><small>{m.copy}</small></button>)}</div>
        <div className="setup-grid"><div>
          <label className="field-title">CHOOSE YOUR COLLECTION</label><div className="choices collections">{([1,0] as const).map(c=><button key={c} aria-pressed={collection===c} disabled={frozen} onClick={()=>{if(c===collection)return;adapter.current?.cancelFriendCheck();setCollection(c);setArcadeArt(null);}}><b>{c===1?'GENESIS':'GENERATIONS'}</b><small>{c===1?'THE ORIGINAL FRIENDS':'THE NEXT GENERATION'}</small></button>)}</div>
          <label className="id-label" htmlFor="friend-id">{source==='local'?'PREVIEW FRIEND ID':'YOUR NFT ID'}<input id="friend-id" value={tokenId} onChange={e=>{adapter.current?.cancelFriendCheck();setTokenId(e.target.value);setArcadeArt(null);}} inputMode="numeric" autoComplete="off" disabled={frozen} maxLength={77}/></label>
          {source==='local'&&<p className="muted small">Cosmetic preview artwork. No NFT ownership or token rewards are claimed.</p>}

        </div><div><label className="field-title">PICK YOUR PACE</label><div className="choices difficulties">{MODES.map(mode=><button key={mode} disabled={frozen} aria-pressed={difficulty===mode} onClick={()=>setDifficulty(mode)}><b>{mode.toUpperCase()}</b><small>{DIFFICULTIES[mode].seconds}s · {DIFFICULTIES[mode].rewardLabel}</small></button>)}</div><p className="mode-description">{DIFFICULTIES[difficulty].description}<br/>Sideways. Upwards. Free fall. A rare reverse.</p>
          <div className="pilot-card"><span className="pilot-icon" aria-hidden="true">⌘</span><div><b>RARE RUSH AUTOPILOT</b><p>You choose the Friend and pace. Autopilot handles the moves; you confirm any Testnet wallet actions.</p></div></div>
          <button className="primary start" disabled={frozen||!validId(tokenId)||(source==='arcade'&&!arcade?.account)||(source==='testnet'&&(!tnReady||activeSaved))} onClick={()=>void act(source==='testnet'?(needApproval?'Approve entry in your wallet…':'Confirm the run in your wallet…'):'Preparing the agent…',begin)}>{busy|| (source==='testnet' ? needApproval?'APPROVE 110 tRF':'START AGENT RUN':'WATCH AGENT PLAY')}<span>↗</span></button>
          <p className="entry-note">{source==='testnet'?collection===1?'FREE ENTRY · 100× GENESIS REWARDS':'110 tRF ENTRY · 100 PRIZES + 10 TREASURY':source==='arcade'?'REAL NFT · SIMULATED REWARDS':'LOCAL PREVIEW · NO WALLET NEEDED'}</p>
        </div></div>
        {source==='arcade'&&<div className="wallet-box arcade-wallet-panel" aria-label="Arcade wallet"><div className="wallet-heading"><div><span className="eyebrow">ROBINHOOD MAINNET · 4663</span><p>Play with the Genesis or Generations NFT held by your wallet.<br/>Ownership and artwork are read from Robinhood mainnet.</p></div><div className="inline-actions"><button className={!arcade?.account?'wallet-connect':undefined} disabled={running||!!busy} onClick={()=>void act('Connecting Arcade wallet…',async()=>{setArcade(await connectArcade());})}>{arcade?.account?short(arcade.account):'CONNECT WALLET'}</button>{arcade?.account&&<button disabled={frozen||!validId(tokenId)} onClick={()=>void act('Checking your Friend…',async()=>{setArcadeArt(await loadArcadeFriend(arcade.provider,arcade.account,collection,tokenId));setNotice('Ownership confirmed. Ready for Arcade.');})}>CHECK FRIEND ↗</button>}</div></div>{arcadeArt&&<p className="lime small">✓ {arcadeArt.label} · OWNERSHIP CHECKED</p>}<p className="muted small">Arcade play requests no spending approval or game transaction.</p></div>}
        {source==='testnet'&&<div className="testnet-panel"><div className="wallet-heading"><div><span className="eyebrow">ROBINHOOD TESTNET · 46630</span><p>{tn?.account?short(tn.account):'Connect the wallet that owns your test Friend.'}</p></div><div className="inline-actions">{!tn?.account?<button className="wallet-connect" disabled={running||!!busy} onClick={()=>void act('Connecting Testnet wallet…',async()=>{await testnetRead(()=>adapter.current!.connect());})}>CONNECT WALLET</button>:<><button disabled={running||!!busy} onClick={()=>void act('Refreshing…',async()=>{await testnetRead(()=>adapter.current!.refresh());await checkSelectedFriend();})}>REFRESH ↻</button><button disabled={frozen} onClick={()=>{adapter.current!.disconnect();}}>DISCONNECT</button></>}</div></div>
          {tn?.account&&tn.chainId!==46630&&<button disabled={running||!!busy} onClick={()=>void act('Switching network…',async()=>{await testnetRead(()=>adapter.current!.switchChain());})}>SWITCH TO ROBINHOOD TESTNET</button>}
          {tn?.balances&&<div className="balances"><span>TEST ETH <b>{fmt(tn.balances.eth)}</b></span><span>tRF <b>{fmt(tn.balances.rf)}</b></span><span>tRARERUSH <b>{fmt(tn.balances.rush,6)}</b></span><span className={tn.verifier==='ready'?'lime':'muted'}>VERIFIER {tn.verifier.toUpperCase()}</span></div>}
          {tn?.account&&<div className="inline-actions"><button disabled={frozen||checkingFriend||tn.chainId!==46630||!validId(tokenId)} onClick={()=>void act('Checking Friend…',async()=>{await checkSelectedFriend();})}>{checkingFriend?'CHECKING FRIEND…':'CHECK SELECTED FRIEND'}</button><span>{checkingFriend?'Checking ownership and remaining starts…':selectionMatches?`${tn?.selected?.remainingStarts} / 3 starts left today`:'Check this NFT to enable its run.'}</span>{tn?.verifier==='unavailable'&&<button disabled={frozen} onClick={()=>void act('Checking verifier…',async()=>{await testnetRead(()=>adapter.current!.refresh());await checkSelectedFriend();})}>CHECK AGAIN</button>}</div>}
          {activeSaved&&<div className="saved-notice"><span>Saved Testnet run #{stateRun?.run.runId} · {stateRun?.status}</span><button disabled={frozen||tn?.chainId!==46630||!tn?.verified||!!pending} onClick={()=>void act('Restoring run…',async()=>{resumeSaved();})}>OPEN SAVED RUN ↗</button></div>}
          {pending&&<div className="saved-notice"><p>A wallet operation needs confirmation before another transaction.</p>{pending.hash?<a href={`https://explorer.testnet.chain.robinhood.com/tx/${pending.hash}`} target="_blank" rel="noreferrer">VIEW TRANSACTION ↗</a>:<input aria-label="Pending transaction hash" placeholder="Paste transaction hash if broadcast" value={pendingHash} onChange={e=>setPendingHash(e.target.value)}/>}<button disabled={frozen} onClick={()=>void act('Recovering transaction…',async()=>{await adapter.current!.recover((pendingHash||undefined) as `0x${string}`|undefined);})}>CHECK TRANSACTION</button>{tn?.playState?.pending&&!tn.playState.pending.hash&&<><button disabled={frozen} onClick={()=>void act('Retry the reserved nonce in your wallet…',async()=>{await adapter.current!.retryPending();})}>RETRY SAME NONCE</button><button disabled={frozen} onClick={()=>void act('Cancel the reserved nonce in your wallet…',async()=>{await adapter.current!.cancelPending();})}>CANCEL PENDING</button></>}</div>}
          <details><summary>Test kit & run recovery</summary><p className="small muted">Uses the existing unrestricted test NFT faucets. Each mint, faucet or recovery transaction needs your wallet approval.</p><div className="inline-actions"><button disabled={frozen||!tn?.verified||!!pending} onClick={()=>void act('Mint Genesis in your wallet…',async()=>{const minted=await adapter.current!.mint(1);if(minted?.tokenIds[0]){setCollection(1);setTokenId(String(minted.tokenIds[0]));}})}>MINT TEST GENESIS</button><button disabled={frozen||!tn?.verified||!!pending} onClick={()=>void act('Mint Generations in your wallet…',async()=>{const minted=await adapter.current!.mint(0);if(minted?.tokenIds[0]){setCollection(0);setTokenId(String(minted.tokenIds[0]));}})}>MINT TEST GENERATIONS</button><button disabled={frozen||!tn?.verified||!!pending} onClick={()=>void act('Claim tRF in your wallet…',async()=>{await adapter.current!.faucet();})}>GET TEST tRF</button><a href="https://faucet.testnet.chain.robinhood.com" target="_blank" rel="noreferrer">TEST ETH FAUCET ↗</a></div><div className="inline-actions"><input aria-label="Recover onchain run ID" placeholder="Onchain run ID" value={recoverId} onChange={e=>setRecoverId(e.target.value)}/><button disabled={frozen||!tn?.verified||!validId(recoverId)} onClick={()=>void act('Recovering run…',async()=>{await adapter.current!.recoverRun(recoverId);resumeSaved();})}>RECOVER RUN</button></div></details>
        </div>}
      </section>
      </div>
      <div id="agentic-panel" role="tabpanel" aria-labelledby="agentic-tab" hidden={view!=='agentic'}><AgenticPanel/></div>
      <section id="leaderboard" className="library"><div className="section-top"><div><p className="eyebrow">{PUBLIC_SITE?'03 / COMMUNITY RUN LIBRARY':'03 / YOUR LOCAL RUN LIBRARY'}</p><h2>BEST OF THE <span>RUSH.</span></h2></div><span className="count">{records.length} SAVED {records.length===1?'RUN':'RUNS'}</span></div><p className="muted">{PUBLIC_SITE?'Published runs from people and agents. Best per Friend and environment among the loaded runs.':'Best run per Friend and environment. Scheduled agent runs appear automatically. Filter by difficulty to explore more. Community voting comes later.'}</p><a className="feed-library-link" href={FEED_PATH} onClick={event=>{event.preventDefault();openFeed();}}>VIEW ALL SAVED RUNS ↗</a><div className="inline-actions filters" role="group" aria-label="Leaderboard difficulty">{(['all',...MODES] as const).map(m=><button key={m} aria-pressed={filter===m} onClick={()=>setFilter(m)}>{m.toUpperCase()}</button>)}</div>
        {best.length?<div className="run-list">{best.map((r,i)=><article key={r.id} className="run-row"><span className="rank">{String(i+1).padStart(2,'0')}</span><div><b>{r.collection===1?'GENESIS':'GENERATIONS'} #{r.tokenId}</b><small>{r.source==='local'?'PREVIEW':r.source.toUpperCase()} · {r.difficulty.toUpperCase()} · {r.metrics.outcome.toUpperCase()}{r.agentJobId?' · AGENT JOB':''}</small></div><div className="list-score"><b>{r.metrics.score.toLocaleString()}</b><small>POINTS</small></div><button disabled={playing||!!busy} onClick={()=>void act('Loading replay…',async()=>{await replayRecord(r);})}>WATCH ↗</button></article>)}</div>:<div className="empty"><span>→ ↑ ↓ ←</span><p>Your agent’s first rush belongs here.</p><small>Complete a run to save its score and watchable replay.</small></div>}
      </section>
      </div>
      {page==='feed'&&<div id="runs-feed"><RunsFeed records={records} likes={likes} onToggleLike={toggleLike} onOpen={setFeedRun} onBack={backToPlay} previewsPaused={!!feedRun} publicFeed={PUBLIC_SITE} loading={recordsLoading} error={recordsError} onRetry={()=>{setRecordsLoading(true);void loadRecords().catch(()=>{});}}/>{PUBLIC_SITE&&nextCursor&&<div className="feed-load-page"><button disabled={loadingMore} onClick={()=>void moreRecords()}>{loadingMore?'LOADING RUNS…':'LOAD OLDER RUNS ↓'}</button></div>}{likesError&&<p className="message" role="status">{likesError}</p>}</div>}
    </main>
    {page==='feed'&&feedRun&&<ReplayModal record={feedRun} liked={likes.has(feedRun.id)} onToggleLike={()=>toggleLike(feedRun.id)} onClose={()=>setFeedRun(null)}/>}
    <footer><BrandMark/><p>SMALL FRIEND. NEW PLAYER. SAME BIG RUSH.</p><span>{PUBLIC_SITE?'AGENT PLAY · RUNS FEED':'AGENT PLAY · LOCAL PROTOTYPE'}</span></footer>
  </div>;
}
createRoot(document.getElementById('app')!).render(<App/>);

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPublicClient, createWalletClient, custom, formatUnits, http, isHash, parseAbi, type Address, type EIP1193Provider, type Hash } from 'viem';
import { RunCanvas, TestFriendAvatar } from './RunCanvas.tsx';
import { ArcadeCabinet } from './ArcadeCabinet.tsx';
import { CollectionChoice, CollectionFriends } from './CollectionEntry.tsx';
import { createRecorder, type Replay, type RunSnapshot as EngineSnapshot } from './recorder.ts';
import { TESTNET_CHAIN, PLAY_GAME_ABI, verifyPlayContracts, readRun, readOwnedFriend, discoverFriends, approveEntry, startRun, claimRun, abandonRun, recoverPending, retryHashlessPending, cancelHashlessPending } from './chain.ts';
import { PLAY_CONTRACTS, type Collection, type Difficulty, type PlayState, type FriendSelection } from './types.ts';
import { loadPlayState, savePlayState, validateVerifiedClaim } from './storage.ts';
import { createAuthorization, authorizationTypedData } from '../shared/authorization.ts';
import { EXPLORER_URL, RPC_URL, assertWalletContext } from '../safety.ts';
import { createWalletSession } from '../wallet-session.ts';

const client = createPublicClient({ chain: TESTNET_CHAIN, transport: http(RPC_URL, { timeout: 12000, retryCount: 1 }), cacheTime: 0 });
const tokenAbi = parseAbi(['function balanceOf(address) view returns(uint256)', 'function allowance(address,address) view returns(uint256)']);
const MODES = ['easy', 'normal', 'degen'] as const;
const durations = [120, 90, 60];
const multipliers = ['0.75×', '1×', '2×'];
const ENTRY = 110n * 10n ** 18n;
const short = (v: string) => `${v.slice(0,6)}…${v.slice(-4)}`;
const amount = (v: bigint | string, decimals: number) => Number(formatUnits(BigInt(v), decimals)).toLocaleString('en-US', { maximumFractionDigits: 3 });
type WalletProvider = EIP1193Provider & {on?: (name:string,listener:(...args:unknown[])=>void)=>void; removeListener?: (name:string,listener:(...args:unknown[])=>void)=>void};
function wallet(): WalletProvider {
  const provider = (window as Window & {ethereum?: WalletProvider}).ethereum;
  if (!provider) throw new Error('Open this page in your wallet browser, or install a browser wallet to play.');
  return provider;
}
function message(error: unknown) {
  const e = error as { shortMessage?: string; message?: string; code?: number };
  if (e.code === 4001 || /rejected|denied/i.test(e.message ?? '')) return 'Request declined. Your saved run is still here.';
  return e.shortMessage ?? e.message ?? 'Something did not connect. Try again when ready.';
}

type PlayRoute = { collection: Collection|null; friendId: string|null; runId: string|null };
function readPlayRoute(): PlayRoute {
  const params = new URLSearchParams(location.search);
  const id = (value: string|null) => value && /^[1-9][0-9]*$/.test(value) ? value : null;
  return { collection: params.get('collection') === 'genesis' ? 1 : params.get('collection') === 'generations' ? 0 : null, friendId: id(params.get('friend')), runId: id(params.get('run')) };
}

export function App() {
  const dashboard = location.pathname.startsWith('/dashboard');
  const [route, setRoute] = useState(readPlayRoute);
  const [account, setAccount] = useState<Address|null>(null);
  const [chainId, setChainId] = useState<number|null>(null);
  const [state, setState] = useState<PlayState|null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [server, setServer] = useState<'checking'|'ready'|'unavailable'>('checking');
  const [verified, setVerified] = useState(false);
  const [balances, setBalances] = useState({ rf: 0n, rush: 0n, allowance: 0n });
  const [selected, setSelected] = useState<FriendSelection|null>(null);
  const [collection, setCollection] = useState<Collection>(0);
  const [manualId, setManualId] = useState('');
  const [recoverId, setRecoverId] = useState('');
  const [pendingHash, setPendingHash] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>(1);
  const [active, setActive] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [stats, setStats] = useState<EngineSnapshot|null>(null);
  const [refreshCount,setRefreshCount]=useState(0);
  const [playbackSession,setPlaybackSession]=useState(0);
  const playbackPermit=useRef(0);
  const walletSession=useRef<ReturnType<typeof createWalletSession>|null>(null);
  const [quote, setQuote] = useState<bigint|null>(null);
  const [nftInfo, setNftInfo] = useState<{left:number;activeRun:string}|null>(null);
  const currentAccount = useRef<Address|null>(null);
  const actionBusy = useRef(false);
  const epoch = useRef(0);
  const run = state?.savedRun;
  const pending = state?.pending;
  const expired = run ? Number(run.run.claimUntil) * 1000 <= now : false;
  const liveSaved = run && !['claimed','abandoned'].includes(run.status) && !expired;
  const needsRunClose = !!liveSaved && run?.status === 'lost';
  const canWrite = !!account && chainId === 46630 && verified && !busy && !pending;

  function navigatePlay(next: Partial<PlayRoute> = {}) {
    const params = new URLSearchParams();
    if (next.collection != null) params.set('collection', next.collection === 1 ? 'genesis' : 'generations');
    if (next.friendId) params.set('friend', next.friendId);
    if (next.runId) params.set('run', next.runId);
    history.pushState(null, '', `/play/${params.size ? `?${params}` : ''}`);
    setActive(false);
    setRoute(readPlayRoute());
    window.scrollTo(0, 0);
  }
  useEffect(() => {
    const changed = () => { setActive(false); setRoute(readPlayRoute()); };
    window.addEventListener('popstate', changed);
    return () => window.removeEventListener('popstate', changed);
  }, []);
  useEffect(() => {
    const next = !dashboard && verified && chainId === 46630 && route.collection != null && route.friendId
      ? state?.friends.find(f => f.collection === route.collection && f.tokenId === route.friendId) ?? null : null;
    setSelected(previous => previous?.collection === next?.collection && previous?.tokenId === next?.tokenId ? previous : next);
    if (route.collection != null) setCollection(route.collection);
  }, [dashboard, verified, chainId, route.collection, route.friendId, state?.friends]);

  const onState = useCallback((next: PlayState) => {
    if (next.account.toLowerCase() === currentAccount.current?.toLowerCase()) setState(next);
  }, []);
  function context(who = account) {
    if (!who) throw new Error('Connect your wallet first.');
    return { client, provider: wallet(), account: who, store: localStorage, onState };
  }
  const action = async (label: string, work: () => Promise<void>) => {
    if (actionBusy.current) return;
    actionBusy.current = true; setBusy(label); setError(''); setInfo('');
    try { await work(); } catch (e) { setError(message(e)); }
    finally { actionBusy.current = false; setBusy(''); }
  };
  async function checkServer() {
    try { const r = await fetch('/api/status', {cache:'no-store'}); const data = await r.json(); setServer(r.ok && data.ready === true && data.chainId === 46630 && data.game?.toLowerCase() === PLAY_CONTRACTS.game ? 'ready' : 'unavailable'); }
    catch { setServer('unavailable'); }
  }
  async function refresh(who: Address) {
    const requestEpoch = epoch.current;
    await verifyPlayContracts(client);
    let saved = loadPlayState(localStorage, who);
    const [rf, rush, allowance, discovered] = await Promise.all([
      client.readContract({address:PLAY_CONTRACTS.rf, abi:tokenAbi, functionName:'balanceOf',args:[who]}),
      client.readContract({address:PLAY_CONTRACTS.rewardToken, abi:tokenAbi, functionName:'balanceOf',args:[who]}),
      client.readContract({address:PLAY_CONTRACTS.rf, abi:tokenAbi, functionName:'allowance',args:[who,PLAY_CONTRACTS.game]}),
      discoverFriends(client, who, saved.friends),
    ]);
    const friends = discovered.friends;
    const refreshedRunId = saved.savedRun?.run.runId;
    const freshRun = refreshedRunId ? await readRun(client, refreshedRunId) : null;
    // Do not overwrite a checkpoint made in another tab while RPC reads were pending.
    saved = loadPlayState(localStorage, who);
    saved.friends = [...new Map([...saved.friends, ...friends].map(f => [`${f.collection}:${f.tokenId}`, f])).values()].slice(-100);
    if (saved.savedRun && saved.savedRun.run.runId === refreshedRunId && freshRun) {
      saved.savedRun.run = freshRun;
      if (freshRun.claimed) saved.savedRun.status = 'claimed';
      else if (freshRun.abandoned) saved.savedRun.status = 'abandoned';
    }
    savePlayState(localStorage, saved);
    if (requestEpoch !== epoch.current || who.toLowerCase() !== currentAccount.current?.toLowerCase()) return;
    setRefreshCount(n=>n+1); setVerified(true); setBalances({rf,rush,allowance}); setState(saved);
    setSelected(previous => previous && friends.some(f=>f.collection===previous.collection&&f.tokenId===previous.tokenId) ? previous : null);
    if (saved.savedRun) {
      const s = saved.savedRun;
      const recording = createRecorder(s.run.seed, MODES[s.run.difficulty], s.replay, s.completedTicks);
      setStats({...recording.run,completedTicks:recording.run._tick});
    }
    await checkServer();
  }
  async function syncWallet(prompt = false) {
    if (prompt) await walletSession.current?.connect();
    else await walletSession.current?.sync(true);
  }
  useEffect(() => { void checkServer(); const timer=setInterval(()=>setNow(Date.now()),1000); return()=>clearInterval(timer); }, []);
  useEffect(() => {
    const session=createWalletSession({
      invalidated() {
        playbackPermit.current++;
        // Invalidate the active renderer immediately, even while a wallet request is open.
        epoch.current++; currentAccount.current=null; setActive(false); setVerified(false);
        setAccount(null); setChainId(null); setState(null); setSelected(null); setStats(null);
        setBalances({rf:0n,rush:0n,allowance:0n}); setError(''); setInfo('');
      },
      async changed({account:who,chainId:network}) {
        currentAccount.current=who; setAccount(who); setChainId(network);
        if(who) {
          setState(loadPlayState(localStorage,who));
          if(network===46630) await refresh(who);
        }
      },
      error(e) {setError(message(e));},
    });
    walletSession.current=session;
    session.start();
    const storageChanged=(e:StorageEvent)=>{
      const who=currentAccount.current;
      if(who && e.key?.includes(who.toLowerCase())) {
        playbackPermit.current++;
        setActive(false);
        try {setState(loadPlayState(localStorage,who));} catch(e){setError(message(e));}
      }
    };
    window.addEventListener('storage',storageChanged);
    return()=>{session.stop();walletSession.current=null;window.removeEventListener('storage',storageChanged);};
  }, []);
  useEffect(() => {
    let cancelled=false;
    setNftInfo(null);
    if (selected && account && verified) {
      void (async()=>{
        await readOwnedFriend(client,account,selected.collection,selected.tokenId);
        const block=await client.getBlock();
        const key=await client.readContract({address:PLAY_CONTRACTS.game,abi:PLAY_GAME_ABI,functionName:'nftKey',args:[selected.collection,BigInt(selected.tokenId)]});
        const [starts,activeRun]=await Promise.all([
          client.readContract({address:PLAY_CONTRACTS.game,abi:PLAY_GAME_ABI,functionName:'dailyStarts',args:[key,block.timestamp/86400n]}),
          client.readContract({address:PLAY_CONTRACTS.game,abi:PLAY_GAME_ABI,functionName:'activeRunByNft',args:[key]}),
        ]);
        if (!cancelled) setNftInfo({left:Math.max(0,3-Number(starts)),activeRun:String(activeRun)});
      })().catch(e=>{if(!cancelled)setError(message(e));});
    }
    return()=>{cancelled=true;};
  }, [selected,account,verified,state?.history.at(-1)?.hash,refreshCount,Math.floor(now/86400000)]);
  const progress = useCallback((replay: Replay, snapshot: EngineSnapshot) => {
    const who=account;
    const expectedRunId=run?.run.runId;
    if (playbackSession!==playbackPermit.current) throw new Error('Another session updated this run. Play paused.');
    if (!who || who.toLowerCase()!==currentAccount.current?.toLowerCase() || !expectedRunId) throw new Error('Wallet changed. This run was paused.');
    try {
      const saved=loadPlayState(localStorage,who);
      if (!saved.savedRun || saved.savedRun.run.runId!==expectedRunId || saved.pending || ['claimed','abandoned'].includes(saved.savedRun.status)) throw new Error('Saved run changed. Play paused.');
      if(snapshot.completedTicks<saved.savedRun.completedTicks) throw new Error('Newer progress is already saved. Play paused.');
      saved.savedRun.replay=replay;saved.savedRun.completedTicks=snapshot.completedTicks;
      saved.savedRun.status=snapshot.status==='finished' ? (snapshot.finishReason==='time'&&snapshot.hearts>0?'survived':'lost') : 'playing';
      savePlayState(localStorage,saved);setState(saved);setStats(snapshot);
    } catch(e){setError(message(e));throw e;}
  }, [account,run?.run.runId,playbackSession]);
  const finish = useCallback((replay:Replay,snapshot:EngineSnapshot)=>{progress(replay,snapshot);setActive(false);}, [progress]);
  useEffect(()=>{
    let cancelled=false;setQuote(null);
    if(run?.status==='survived'&&run.claim) void client.readContract({address:PLAY_CONTRACTS.game,abi:PLAY_GAME_ABI,functionName:'quoteReward',args:[run.claim.pickupKinds,run.run.collection,run.run.difficulty]}).then(v=>{if(!cancelled)setQuote(v as bigint);}).catch(()=>{});
    return()=>{cancelled=true;};
  },[run?.claim,run?.status]);

  async function verifyRun() {
    if (!account) return;
    const saved=loadPlayState(localStorage,account);
    if (!saved.savedRun || saved.savedRun.status!=='survived') throw new Error('Survive the timer before claiming.');
    const original=saved.savedRun;
    const p=wallet();
    assertWalletContext(account,await p.request({method:'eth_accounts'}),Number(await p.request({method:'eth_chainId'})));
    const auth=createAuthorization({player:account,runId:original.run.runId,replay:original.replay,expiresAt:Math.floor(Date.now()/1000)+240});
    const signature=await createWalletClient({chain:TESTNET_CHAIN,transport:custom(p),account}).signTypedData(authorizationTypedData(auth));
    assertWalletContext(account,await p.request({method:'eth_accounts'}),Number(await p.request({method:'eth_chainId'})));
    const response=await fetch('/api/verify-run',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({authorization:auth,signature,replay:original.replay})});
    const body=await response.json();
    if (!response.ok) throw new Error(body.error ?? 'Verification unavailable. Your replay is saved; try again.');
    const claim=validateVerifiedClaim(body,original.run,original.replay);
    const fresh=loadPlayState(localStorage,account);
    if(fresh.savedRun?.run.runId!==original.run.runId || fresh.savedRun.status!=='survived') throw new Error('Your saved run changed. Refresh before claiming.');
    fresh.savedRun.claim=claim;savePlayState(localStorage,fresh);onState(fresh);setInfo('Run verified. Claim the reward with your wallet.');
  }
  async function recoverRunById() {
    if(!account || !/^[1-9][0-9]*$/.test(recoverId)) throw new Error('Enter your onchain run ID.');
    const next=await readRun(client,recoverId);
    if(next.player.toLowerCase()!==account.toLowerCase())throw new Error('That run belongs to another wallet.');
    const saved=loadPlayState(localStorage,account);
    if(saved.pending)throw new Error('Recover the pending transaction first.');
    if(saved.savedRun && !['claimed','abandoned'].includes(saved.savedRun.status) && saved.savedRun.run.runId!==next.runId && Number(saved.savedRun.run.claimUntil)*1000>Date.now())throw new Error('Finish or abandon your saved run before recovering another.');
    if(saved.savedRun?.run.runId!==next.runId) saved.savedRun={run:next,replay:{version:'rare-rush-input-v1',frames:[]},completedTicks:0,status:next.claimed?'claimed':next.abandoned?'abandoned':'ready'};
    if(saved.savedRun){saved.savedRun.run=next;if(next.claimed)saved.savedRun.status='claimed';else if(next.abandoned)saved.savedRun.status='abandoned';}
    savePlayState(localStorage,saved);onState(saved);setStats(null);setRecoverId('');
  }
  function exportReplay() {
    if(!run)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(run,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`rare-rush-run-${run.run.runId}.json`;a.click();URL.revokeObjectURL(url);
  }
  const claimFresh=run?.claim && Number(run.claim.deadline)*1000>now+15000;
  const showStoredRun = !!run && (route.runId === run.run.runId || (!!selected && !!liveSaved));
  const arcade = !dashboard && verified && chainId === 46630 && (showStoredRun || !!selected);
  function chooseFriend(friend: FriendSelection) { navigatePlay({collection:friend.collection,friendId:friend.tokenId}); }
  function resumeRun() {
    if (!run) return;
    try {
      createRecorder(run.run.seed,MODES[run.run.difficulty],run.replay,run.completedTicks);
      setError(''); setPlaybackSession(++playbackPermit.current); setActive(true);
    } catch(e) {setError(message(e));}
  }
  async function closeRun() {
    if (!run) return;
    const friend = {collection:run.run.collection,tokenId:run.run.tokenId};
    await abandonRun(context(),run.run.runId);
    if(account && currentAccount.current===account) {
      await refresh(account);
      if (currentAccount.current !== account) return;
      setInfo('Run closed. Your remaining daily attempts are unchanged. Choose your Friend and start when ready.');
      if (!dashboard) chooseFriend(friend);
    }
  }
  const walletControls = <>{!account ? <button className="primary-button" disabled={!!busy} onClick={()=>void action('Connecting wallet…',()=>syncWallet(true))}>CONNECT WALLET ↗</button> : <>
    {chainId!==46630 ? <button className="primary-button" disabled={!!busy} onClick={()=>void action('Switching to testnet…',async()=>{
      const p=wallet();
      try {await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xb626'}]});}
      catch(e) {
        if((e as {code?:number}).code!==4902)throw e;
        await p.request({method:'wallet_addEthereumChain',params:[{chainId:'0xb626',chainName:'Robinhood Testnet',nativeCurrency:{name:'Test Ether',symbol:'ETH',decimals:18},rpcUrls:[RPC_URL],blockExplorerUrls:[EXPLORER_URL]}]});
        await p.request({method:'wallet_switchEthereumChain',params:[{chainId:'0xb626'}]});
      }
      await syncWallet();
    })}>SWITCH TO TESTNET</button> : <button className="outline-button" disabled={!!busy||active} onClick={()=>void action('Refreshing…',()=>refresh(account))}>REFRESH ↻</button>}
    <button className="text-button" disabled={!!busy||active} onClick={()=>walletSession.current?.disconnect()}>DISCONNECT</button>
  </>}</>;
  const feedback = <>
    {(busy||error||info)&&<div className={`feedback ${error?'error':''}`} role="status">{error||busy||info}</div>}
    {server==='unavailable'&&<div className="feedback">Run verification is temporarily unavailable. Starts are paused on this page; your existing replay stays saved. <button className="text-button" onClick={()=>void checkServer()}>CHECK AGAIN</button></div>}
  </>;
  const pendingPanel = pending && <section className="play-panel pending-panel">
    <span className="eyebrow">TRANSACTION RECOVERY</span><h2>{pending.kind.toUpperCase()} PENDING</h2><p>Your transaction is saved. Check confirmation before starting another action.</p>
    {pending.hash ? <a href={`${EXPLORER_URL}/tx/${pending.hash}`} target="_blank" rel="noreferrer">View transaction ↗</a> : <label>Paste the transaction hash from your wallet<input value={pendingHash} onChange={e=>setPendingHash(e.target.value)} placeholder="0x…"/></label>}
    <button className="primary-button" disabled={!!busy||chainId!==46630} onClick={()=>void action('Checking transaction…',async()=>{
      if(pendingHash&&!isHash(pendingHash))throw new Error('Enter a valid transaction hash.');
      await recoverPending(context(),pendingHash?pendingHash as Hash:undefined); if(account)await refresh(account);
    })}>CHECK CONFIRMATION ↗</button>
    {!pending.hash&&<details className="recovery"><summary>My wallet did not return a transaction hash</summary><p>Retry sends the same action with its original nonce. It cannot execute twice. If you no longer want it, cancel that nonce with a zero-value transaction using test gas.</p><div className="play-actions">
      <button className="outline-button" disabled={!!busy||chainId!==46630} onClick={()=>void action('Retry the same transaction in your wallet…',async()=>{await retryHashlessPending(context());if(account)await refresh(account);})}>RETRY SAME TRANSACTION</button>
      <button className="outline-button" disabled={!!busy||chainId!==46630} onClick={()=>void action('Confirm cancellation in your wallet…',async()=>{await cancelHashlessPending(context());if(account)await refresh(account);})}>CANCEL RESERVED NONCE</button>
    </div></details>}
  </section>;
  const manualFriend = <details className="recovery"><summary>Missing a Friend? Add its test NFT ID</summary><div className="manual-friend">
    <label>Collection<select value={collection} onChange={e=>setCollection(Number(e.target.value) as Collection)}><option value="0">Generations</option><option value="1">Genesis</option></select></label>
    <label>Test NFT ID<input inputMode="numeric" value={manualId} onChange={e=>setManualId(e.target.value)} placeholder="1"/></label>
    <button className="outline-button" disabled={!canWrite} onClick={()=>void action('Checking ownership…',async()=>{
      if(!account||!/^[1-9][0-9]*$/.test(manualId))throw new Error('Enter a valid test NFT ID.');
      await readOwnedFriend(client,account,collection,manualId);
      const saved=loadPlayState(localStorage,account), friend={collection,tokenId:manualId};
      if(!saved.friends.some(f=>f.collection===collection&&f.tokenId===manualId))saved.friends.push(friend);
      savePlayState(localStorage,saved);onState(saved);
      if (currentAccount.current !== account) return;
      setManualId('');
      if(!dashboard)chooseFriend(friend);
    })}>ADD FRIEND</button>
  </div></details>;
  const runSummary = run && <>
    <span className="eyebrow">{run.status==='claimed'?'MINT CONFIRMED':run.status==='abandoned'?'RUN CLOSED':expired?'CLAIM WINDOW CLOSED':run.status==='survived'?'TIMER BEATEN. RUSH EARNED.':run.status==='lost'?'DOWN, BUT STILL RARE.':'YOUR RUN IS SAVED'}</span>
    <h2>{run.status==='claimed'?'KEEP IT RARE.':run.status==='survived'?'CLAIM YOUR RUSH.':run.status==='lost'?'NEXT RUN. BIGGER RUSH.':run.status==='abandoned'||expired?'READY FOR THE NEXT?':'READY TO RUSH?'}</h2>
    {!dashboard&&stats?.status==='finished'&&<div className="result-score">{stats.score.toLocaleString()}<span>POINTS</span></div>}
    {stats&&<div className="result-stats"><span><b>{Math.floor(stats.distance)}m</b>DISTANCE</span><span><b>{stats.coins}</b>COINS</span><span><b>{stats.hearts}</b>HEARTS</span></div>}
    {run.reward&&<p className="reward-total">+{amount(run.reward,6)} tRARERUSH minted</p>}
    {quote!==null&&run.status==='survived'&&<p className="reward-total">Estimated reward: {amount(quote,6)} tRARERUSH</p>}
    {liveSaved&&run.status==='survived'&&<div className="play-actions">
      <button className={claimFresh?'outline-button':'primary-button'} disabled={!canWrite||server!=='ready'} onClick={()=>void action('Authorize verification in your wallet…',verifyRun)}>{claimFresh?'VERIFY AGAIN':'VERIFY RUN ↗'}</button>
      {claimFresh&&<button className="primary-button" disabled={!canWrite} onClick={()=>void action('Confirm your reward claim…',async()=>{await claimRun(context(),run.claim!);if(account)await refresh(account);})}>CLAIM tRARERUSH ↗</button>}
    </div>}
    {run.status==='lost'&&<p>Only runs that survive the timer can mint rewards. This attempt and any entry fee have been used.{needsRunClose?' Close this finished run below to play again.':''}</p>}
    {needsRunClose&&<>
      <p id="run-close-note">Closing uses no extra daily attempt or tRF entry fee — only test ETH gas.</p>
      <button className={dashboard?'primary-button':'primary'} aria-describedby="run-close-note" disabled={!canWrite} onClick={()=>void action('Close the finished run in your wallet…',closeRun)}>CLOSE FINISHED RUN ↗</button>
    </>}
    {!dashboard&&liveSaved&&run.status!=='lost'&&run.status!=='survived'&&<button className="primary" disabled={!canWrite} onClick={resumeRun}>{run.completedTicks?'RESUME RUN':'PLAY RUN'} ↗</button>}
    {!dashboard&&!liveSaved&&<button className="primary" onClick={()=>chooseFriend({collection:run.run.collection,tokenId:run.run.tokenId})}>PICK YOUR NEXT RUN <span>↗</span></button>}
    {liveSaved&&run.status!=='lost'&&<p className="tiny">Claim window: {Math.max(0,Math.ceil((Number(run.run.claimUntil)*1000-now)/60000))} min remaining. Pausing does not extend it.</p>}
    {!['claimed','abandoned','lost'].includes(run.status)&&<details className="recovery"><summary>Abandon this run</summary><p>This uses no additional entry fee, but ends this run permanently and keeps its daily attempt used.</p><button className="outline-button" disabled={!canWrite} onClick={()=>void action('Abandoning run…',closeRun)}>CONFIRM ABANDON</button></details>}
    {dashboard ? <a className="outline-link view-run-link" href={`/play/?run=${run.run.runId}`}>VIEW RUN ↗</a> : <button className="text-button" onClick={()=>navigatePlay()}>Back to collections</button>}
  </>;
  const runHeading = run && <div className="play-section-heading"><span className="eyebrow">RUN #{run.run.runId} / {MODES[run.run.difficulty].toUpperCase()} / TEST {run.run.collection===1?'GENESIS':'GENERATIONS'} #{run.run.tokenId}</span><button className="text-button" onClick={exportReplay}>SAVE REPLAY ↓</button></div>;
  const footer = <footer><span>RARE RUSH <b>BY XIBOT</b></span><span>TEST IDEAS. KEEP IT RARE.</span><a href="/#test-kit">BACK TO TEST KIT ↗</a></footer>;
  return <div className={`lab-shell play-shell ${dashboard?'dashboard-shell':arcade?'arcade-page':'entry-shell'}`}>
    {!arcade&&<header className="site-header"><a className="brand" href="/" aria-label="Rare Rush testnet home"><img src="/assets/rare-friend.svg" width="60" height="60" alt=""/><span><strong>RARE<span>RUSH</span></strong><small>BY XIBOT</small></span></a><nav aria-label="Main navigation"><a href="/#test-kit">TEST KIT</a>{!dashboard&&<a href="/dashboard/" className="outline-link">DASHBOARD</a>}<a href="https://rarerush.app" className="arcade-link">TRY ARCADE</a>{dashboard&&<a href="/play/" className="outline-link play-link">PLAY TESTNET <span aria-hidden="true">↗</span></a>}</nav></header>}
    {dashboard ? <main>
      <div className="play-heading"><div><span className="eyebrow">ROBINHOOD TESTNET / YOUR DASHBOARD</span><h1>MAKE YOUR<br/><span>RUN COUNT.</span></h1></div><p>Your Friends. Your rewards.<br/>Every rush, in one place.</p></div>
      <div className="test-banner"><strong>TESTNET ONLY · 46630</strong><span>Test NFTs use cosmetic Rare Friends artwork. These are separate from your real NFTs.</span></div>
      <div className="play-wallet"><span>{account?short(account):'YOUR TESTNET WALLET'}</span><div className="play-actions">{walletControls}</div></div>
      <div className="play-meta"><span>tRF <b>{account?amount(balances.rf,18):'—'}</b></span><span>tRARERUSH <b>{account?amount(balances.rush,6):'—'}</b></span><span className={server==='ready'?'ready':''}>VERIFIER {server==='ready'?'READY':server==='checking'?'CHECKING':'UNAVAILABLE'}</span></div>
      {feedback}{pendingPanel}
      {run&&<section className="saved-run">{runHeading}<div className="play-panel run-result">{runSummary}</div></section>}
      <section className="play-panel"><div className="play-section-heading"><div><span className="eyebrow">YOUR TEST NFT HOLDINGS</span><h2>YOUR CREW.</h2></div><a href="/#test-kit">MINT TEST FRIENDS ↗</a></div><p className="tiny">{account?'Your test Friends are ready in Play Testnet.':'Connect your wallet to find your test Friends.'}</p>
        <div className="friend-grid">{state?.friends.map(friend=><article key={`${friend.collection}:${friend.tokenId}`} className="friend-card"><TestFriendAvatar collection={friend.collection} tokenId={friend.tokenId}/><strong>{friend.collection===1?'GENESIS':'GENERATIONS'} #{friend.tokenId}</strong><small>{friend.collection===1?'FREE ENTRY · 100× REWARDS':'110 tRF ENTRY'}</small></article>)}</div>
        {account&&manualFriend}
      </section>
      {account&&<details className="play-panel recovery"><summary>Recover a run from its onchain ID</summary><p>Recover a confirmed start from another session. A saved replay on this device is kept when the ID matches.</p><label>Run ID<input value={recoverId} onChange={e=>setRecoverId(e.target.value)} inputMode="numeric"/></label><button className="outline-button" disabled={!canWrite} onClick={()=>void action('Recovering run…',recoverRunById)}>RECOVER RUN</button></details>}
      {!!state?.history.length&&<div className="recent-txs"><span className="tiny">RECENT TRANSACTIONS</span>{state.history.slice(-4).reverse().map(tx=><a key={tx.hash} href={`${EXPLORER_URL}/tx/${tx.hash}`} target="_blank" rel="noreferrer">{tx.kind.toUpperCase()} · {tx.status.toUpperCase()} ↗</a>)}</div>}
    </main> : arcade ? <main className="arcade-route">
      {(busy||error||info||server==='unavailable')&&<div className="arcade-feedback">{feedback}</div>}
      {pendingPanel}
      {showStoredRun&&run ? <>
        {active ? <RunCanvas key={run.run.runId} seed={run.run.seed} difficulty={MODES[run.run.difficulty]} collection={run.run.collection} tokenId={run.run.tokenId} runId={run.run.runId} initialReplay={run.replay} completedTicks={run.completedTicks} onProgress={progress} onFinish={finish}/> :
          <ArcadeCabinet difficulty={MODES[run.run.difficulty]} collection={run.run.collection} tokenId={run.run.tokenId} runId={run.run.runId} snapshot={stats??undefined}><div className="game-overlay result-screen"><div className="result-card testnet-result">{runSummary}</div></div></ArcadeCabinet>}
        <div className="arcade-run-heading">{runHeading}</div>
      </> : selected && <ArcadeCabinet difficulty={MODES[difficulty]} collection={selected.collection} tokenId={selected.tokenId}>
        <div className="start-screen"><div className="start-title"><span className="eyebrow">ENDLESS WORLD. {durations[difficulty]} SECONDS.</span><h1>RARE<sup>✦</sup><br/><span>RUSH</span></h1><span className="mobile-friend"><TestFriendAvatar collection={selected.collection} tokenId={selected.tokenId}/></span><div className="selected-friend">{selected.collection===1?'GENESIS':'FRIEND'} #{selected.tokenId}<span>TESTNET</span></div></div>
          <div className="start-card"><div className="start-card-heading"><span className="card-kicker">YOUR NEXT HIGH SCORE STARTS HERE</span><button className="start-back" onClick={()=>navigatePlay({collection:selected.collection})}>BACK</button></div><h2>Run. Collect.<br/>{' '}Stay rare.</h2>
            <div className="difficulty-picker" aria-label="Difficulty">{MODES.map((mode,i)=><button key={mode} aria-pressed={difficulty===i} disabled={!!busy||!!pending} onClick={()=>setDifficulty(i as Difficulty)}><strong>{mode.toUpperCase()}</strong><span>{durations[i]}s · {multipliers[i]}</span></button>)}</div>
            <p className="mode-description">{['Room to learn · coin trails','Mixed obstacles · scattered coins','Faster obstacles · wild coin routes'][difficulty]}<br/>{multipliers[difficulty]} rewards · 3 hearts</p>
            {selected.collection===0&&balances.allowance<ENTRY ? <button className="primary" disabled={!canWrite||server!=='ready'||!!liveSaved||!nftInfo?.left||balances.rf<ENTRY} onClick={()=>void action('Approve exactly 110 tRF in your wallet…',async()=>{await approveEntry(context());if(account)await refresh(account);})}>APPROVE 110 tRF <span>↗</span></button> : <button className="primary" aria-label={`START ${selected.collection===1?'FREE RUN':'RUN · 110 tRF'}`} disabled={!canWrite||server!=='ready'||!!liveSaved||!nftInfo?.left||(selected.collection===0&&balances.rf<ENTRY)} onClick={()=>void action('Confirm your testnet run…',async()=>{
              const who=account;
              const next=await startRun(context(),{...selected,difficulty});
              if(who!==currentAccount.current)return;
              setStats(null);setQuote(null); if(who)await refresh(who);
              if(who===currentAccount.current&&next.savedRun) { navigatePlay({runId:next.savedRun.run.runId}); setPlaybackSession(++playbackPermit.current); setActive(true); }
            })}>LET’S RUSH <span>↗</span></button>}
            <small className="entry-note">{selected.collection===1?'FREE ENTRY · 100× GENESIS REWARDS':'110 tRF · 100 prizes + 10 treasury'}<br/>{nftInfo?`${nftInfo.left} / 3 starts left today for this NFT.`:'Checking daily attempts…'}</small>
            {selected.collection===0&&balances.rf<ENTRY&&<small className="entry-note">Need test RF? <a href="/#test-kit">Open the Test Kit ↗</a></small>}
            <small className="entry-note">Each start uses an attempt. Entry fees are not refunded.</small>
          </div>
        </div>
      </ArcadeCabinet>}
    </main> : <>
      {route.collection==null ? <CollectionChoice onChoose={collection=>navigatePlay({collection})}/> : <CollectionFriends collection={route.collection} account={account} busy={!!busy||!!pending||(!verified&&!!account)} friends={verified?state?.friends??[]:[]} walletControls={walletControls} feedback={feedback} onBack={()=>navigatePlay()} onChoose={chooseFriend}>{manualFriend}</CollectionFriends>}
      {route.collection==null&&<div className="entry-notices">{route.runId&&!arcade&&<div className="play-wallet"><span>LOAD YOUR SAVED RUN</span><div className="play-actions">{walletControls}</div></div>}{feedback}</div>}
      {pendingPanel}
      {run&&<div className="entry-run-link"><span>{liveSaved?'You have a saved run.':'Your last run is saved.'}</span><a href={`/play/?run=${run.run.runId}`}>VIEW RUN #{run.run.runId} ↗</a></div>}
      {route.runId&&(!run||route.runId!==run.run.runId)&&<p className="entry-notices">{account?'This run is not saved in this browser. Recover it from your Dashboard.':'Connect your wallet to load your saved run.'} <a href="/dashboard/">DASHBOARD ↗</a></p>}
    </>}
    {!arcade&&footer}
  </div>;
}

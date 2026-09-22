import { parseArcadeNavigation } from '../navigation';
import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createFriendPublicClient, createFriendWalletSession } from '@rarefriends/friendsdk/wallet';
import { BrandMark } from '../BrandMark';
import { TokenCoin } from '../CanonicalArt';
import { readGenesisEligibility, readGenesisIdentity, readOwnedGenesis } from './identity';
import { parseGenesisIdentity, type GenesisIdentity } from './protocol';
import { GenesisPortrait, useGenesisPortraits } from './GenesisPortrait';
import './host.css';

async function withDeadline<T>(read: (signal: AbortSignal) => Promise<T>, outer?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  let timeout: number | undefined;
  let cancel: () => void = () => {};
  const deadline = new Promise<never>((_, reject) => {
    cancel = () => { controller.abort(); reject(new Error('Genesis verification cancelled.')); };
    timeout = window.setTimeout(cancel, 25_000);
    outer?.addEventListener('abort', cancel, { once: true });
    if (outer?.aborted) cancel();
  });
  try { return await Promise.race([read(controller.signal), deadline]); }
  finally { window.clearTimeout(timeout); outer?.removeEventListener('abort', cancel); }
}

function Header() {
  return <header className="genesis-header"><a className="genesis-logo" href="/" aria-label="Rare Rush by Xibot home"><BrandMark/></a><nav aria-label="Main navigation"><a href="/pitch/">PITCH</a><a href="https://testnet.rarerush.app">PLAY TESTNET</a><a href="/docs/">DOCS ↗</a></nav></header>;
}
function ArcadeChoice() {
  return <div className="genesis-entry"><Header/><main className="collection-choice"><span className="genesis-kicker">ONE WORLD. TWO WAYS TO RUSH.</span><h1>Bring your<br/><span>Rare Friend.</span></h1><p>Choose the collection you want to play with. Both use your real NFT and simulated rewards.</p><div className="collection-cards"><a href="/genesis/"><svg viewBox="0 0 60 60" width="76" height="76" aria-hidden="true"><TokenCoin size={60}/></svg><span className="genesis-kicker">THE ORIGINAL FRIENDS</span><h2>Genesis</h2><p>Free entry.<br/><strong>100× demo token rewards.</strong></p><b>PLAY GENESIS ↗</b></a><a href="/play/"><svg viewBox="0 0 60 60" width="76" height="76" aria-hidden="true"><TokenCoin size={60}/></svg><span className="genesis-kicker">GENERATION 1 AND BEYOND</span><h2>Generations</h2><p>1 demo RF per run.<br/><strong>Standard rewards + mode bonuses.</strong></p><b>PLAY GENERATIONS ↗</b></a></div><p className="genesis-caption">Connect a browser wallet on Robinhood Chain. Genesis needs an owned Genesis NFT; Generations needs an owned hardwired NFT. No funds are spent and no tokens are minted.</p></main></div>;
}

function GenesisHost() {
  const [walletSession] = useState(() => createFriendWalletSession());
  const [publicClient] = useState(() => createFriendPublicClient());
  const [wallet, setWallet] = useState(walletSession.getSnapshot);
  const portraits = useGenesisPortraits(wallet.status === 'connected' && wallet.account
    ? `${wallet.chainId}:${wallet.account.toLowerCase()}:${wallet.revision}` : null);
  const [friends, setFriends] = useState<Awaited<ReturnType<typeof readOwnedGenesis>>['friends']>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'verifying' | 'playing'>('idle');
  const [error, setError] = useState(''), [refresh, setRefresh] = useState(0), [manualId, setManualId] = useState('');
  const [active, setActive] = useState<{ identity: GenesisIdentity; key: number; revision: number } | null>(null);
  const [checking, setChecking] = useState(false);
  const iframe = useRef<HTMLIFrameElement>(null);
  const operation = useRef(0), revision = useRef(wallet.revision), sessionKey = useRef(0);
  const activeRef = useRef(active), requestAbort = useRef<AbortController | null>(null);
  const verifyAbort = useRef<AbortController | null>(null);
  const bridge = useRef<{ port: MessagePort; nonce: string; key: number } | null>(null);
  const checkingRef = useRef(false), verifyTask = useRef<Promise<boolean> | null>(null), readyNonce = useRef('');
  activeRef.current = active;

  function pauseChild() {
    bridge.current?.port.postMessage({ type: 'pause', paused: checkingRef.current || document.hidden });
  }
  function closeBridge() {
    if (bridge.current) {
      bridge.current.port.postMessage({ type: 'close' });
      bridge.current.port.onmessage = null;
      bridge.current.port.close();
      bridge.current = null;
    }
    readyNonce.current = '';
  }
  function leave(message = '') {
    operation.current++;
    requestAbort.current?.abort();
    verifyAbort.current?.abort();
    closeBridge();
    activeRef.current = null; setActive(null);
    checkingRef.current = false; setChecking(false);
    verifyTask.current = null;
    setStatus('ready'); setError(message);
  }
  function sameWallet(expected: { account: string; revision: number }) {
    const current = walletSession.getSnapshot();
    return current.status === 'connected' && current.chainId === 4663 && current.revision === expected.revision && current.account?.toLowerCase() === expected.account.toLowerCase();
  }
  useEffect(() => {
    // A back/forward-cache restore does not rerun the child handshake effect.
    // Discard that closed bridge and restore the wallet before selecting again.
    const restored = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      leave(); setFriends([]); setStatus('idle');
      void walletSession.refresh();
    };
    window.addEventListener('pageshow', restored);
    const unsubscribe = walletSession.subscribe(() => {
      const next = walletSession.getSnapshot();
      if (next.revision !== revision.current) {
        revision.current = next.revision;
        leave(); setFriends([]); setStatus('idle');
      }
      setWallet(next);
    });
    setWallet(walletSession.getSnapshot());
    return () => { window.removeEventListener('pageshow', restored); unsubscribe(); requestAbort.current?.abort(); verifyAbort.current?.abort(); closeBridge(); walletSession.dispose(); };
  }, [walletSession]);

  useEffect(() => {
    const controller = new AbortController();
    if (wallet.status !== 'connected' || !wallet.account) return;
    const expected = { account: wallet.account, revision: wallet.revision };
    setFriends([]); setError(''); setStatus('loading');
    withDeadline(signal => readOwnedGenesis(publicClient, expected.account, { signal }), controller.signal).then(result => {
      if (!controller.signal.aborted && sameWallet(expected)) { setFriends(result.friends); setStatus('ready'); }
    }).catch(() => {
      if (!controller.signal.aborted && sameWallet(expected)) { setStatus('ready'); setError('Could not load your Genesis collection. Retry, or verify a Genesis number below.'); }
    });
    return () => controller.abort();
  }, [wallet.status, wallet.account, wallet.revision, refresh, publicClient]);

  async function choose(id: bigint) {
    const current = walletSession.getSnapshot();
    if (current.status !== 'connected' || !current.account || status === 'verifying') return;
    leave();
    const ticket = ++operation.current;
    const controller = new AbortController(); requestAbort.current = controller;
    const expected = { account: current.account, revision: current.revision };
    setStatus('verifying'); setError('');
    try {
      const data = await withDeadline(signal => readGenesisIdentity(publicClient, id, expected.account, { signal }), controller.signal);
      if (controller.signal.aborted || ticket !== operation.current || !sameWallet(expected)) return;
      const identity = parseGenesisIdentity(data);
      if (!identity) throw new Error('Invalid Genesis identity.');
      const next = { identity, revision: current.revision, key: ++sessionKey.current };
      activeRef.current = next; setActive(next); setStatus('playing');
    } catch {
      if (!controller.signal.aborted && ticket === operation.current) { setStatus('ready'); setError('Could not verify this Genesis. Make sure this wallet owns it on Robinhood Chain, then try again.'); }
    }
  }

  function verifyCurrent(): Promise<boolean> {
    if (verifyTask.current) return verifyTask.current;
    const selected = activeRef.current;
    if (!selected) return Promise.resolve(false);
    const expected = { account: selected.identity.owner, revision: selected.revision };
    if (!sameWallet(expected)) { leave('Your wallet changed. Choose your Genesis again.'); return Promise.resolve(false); }
    checkingRef.current = true; setChecking(true); pauseChild();
    const controller = new AbortController(); verifyAbort.current = controller;
    const task = (async () => {
      try {
        await withDeadline(signal => readGenesisEligibility(publicClient, BigInt(selected.identity.tokenId), expected.account as `0x${string}`, { signal }), controller.signal);
        return activeRef.current?.key === selected.key && sameWallet(expected);
      } catch {
        if (activeRef.current?.key === selected.key) leave('Genesis ownership could not be confirmed. Your run is stopped; reconnect and try again.');
        return false;
      } finally {
        if (activeRef.current?.key === selected.key) { checkingRef.current = false; setChecking(false); pauseChild(); }
      }
    })();
    verifyTask.current = task;
    void task.then(() => { if (verifyTask.current === task) verifyTask.current = null; });
    return task;
  }

  useEffect(() => {
    if (!active) return;
    const receive = async (event: MessageEvent) => {
      const child = iframe.current?.contentWindow;
      const data = event.data;
      if (!child || event.source !== child || event.origin !== 'null' || data?.type !== 'rarerush:genesis-ready' || typeof data.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(data.nonce)) return;
      if (bridge.current?.nonce === data.nonce || readyNonce.current === data.nonce) return;
      readyNonce.current = data.nonce;
      const nonce = data.nonce;
      if (!await verifyCurrent() || activeRef.current?.key !== active.key || readyNonce.current !== nonce || iframe.current?.contentWindow !== child) return;
      closeBridge();
      const channel = new MessageChannel();
      bridge.current = { port: channel.port1, nonce, key: active.key };
      let lastStart = 0, startPending = false;
      channel.port1.onmessage = async ({ data: request }) => {
        if (activeRef.current?.key !== active.key || bridge.current?.port !== channel.port1) return;
        const destination = parseArcadeNavigation(request);
        if (destination) {
          leave();
          if (destination === 'home') window.location.assign('/');
          return;
        }
        if (request?.type !== 'start' || !Number.isSafeInteger(request.id) || request.id <= lastStart) return;
        lastStart = request.id;
        if (startPending) { channel.port1.postMessage({ type: 'start-result', id: request.id, allowed: false }); return; }
        startPending = true;
        const allowed = await verifyCurrent();
        startPending = false;
        if (bridge.current?.port === channel.port1) channel.port1.postMessage({ type: 'start-result', id: request.id, allowed });
      };
      channel.port1.start();
      child.postMessage({ type: 'rarerush:genesis-init', nonce, identity: active.identity }, '*', [channel.port2]);
      pauseChild();
    };
    const visibility = () => { pauseChild(); if (!document.hidden) void verifyCurrent(); };
    const timer = window.setInterval(() => { if (!document.hidden) void verifyCurrent(); }, 30_000);
    window.addEventListener('message', receive);
    document.addEventListener('visibilitychange', visibility);
    return () => { window.removeEventListener('message', receive); document.removeEventListener('visibilitychange', visibility); clearInterval(timer); closeBridge(); };
  }, [active?.key]);

  if (active) return <main className="genesis-game-shell" aria-label="Genesis arcade"><iframe ref={iframe} key={active.key} className="genesis-game-frame" src="./game.html" title={`Rare Rush — Genesis #${active.identity.tokenId}`} sandbox="allow-scripts"/><div className="genesis-game-toolbar"><span>GENESIS #{active.identity.tokenId}</span><b>100× · DEMO</b><button type="button" onClick={() => leave()}>CHANGE FRIEND</button><a href="/arcade/">EXIT ↗</a></div>{checking && <div className="genesis-checking" role="status">VERIFYING YOUR GENESIS…</div>}</main>;

  return <div className="genesis-entry"><Header/><main className="genesis-picker"><a className="collection-back" href="/arcade/">← CHOOSE COLLECTION</a><span className="genesis-kicker">THE ORIGINAL FRIENDS. THE BIG RUSH.</span><h1>Genesis<br/><span>unlocked.</span></h1><p>Bring your Genesis. Get free entry and 100× demo token rewards.</p><div className="genesis-wallet">
    {wallet.wallets.length > 1 && <label>WALLET<select aria-label="Choose wallet" value={wallet.selectedWalletId ?? ''} onChange={event => void walletSession.connect(event.target.value)}>{wallet.wallets.map(choice => <option key={choice.id} value={choice.id}>{choice.name}</option>)}</select></label>}
    {wallet.status !== 'connected' && wallet.status !== 'wrong-network' && <button className="genesis-primary" disabled={wallet.status === 'connecting' || wallet.status === 'switching-network'} onClick={() => void walletSession.connect()}>{wallet.status === 'connecting' ? 'CONNECTING…' : 'CONNECT WALLET ↗'}</button>}
    {wallet.status === 'wrong-network' && <><p>Switch to Robinhood Chain to verify your Genesis.</p><button className="genesis-primary" onClick={() => void walletSession.switchNetwork()}>SWITCH TO ROBINHOOD ↗</button></>}
    {wallet.status === 'unavailable' && <p>Open this page in your wallet’s browser, or use a browser with a wallet extension.</p>}
    {wallet.account && <div className="genesis-account"><span>{wallet.account.slice(0, 6)}…{wallet.account.slice(-4)}</span><button onClick={() => walletSession.disconnect()}>DISCONNECT</button></div>}
    {wallet.error && <p role="alert">{wallet.error}</p>}
  </div>
  {wallet.status === 'connected' && <section className="owned-genesis" aria-label="Choose your Genesis"><div className="genesis-picker-heading"><h2>Your Genesis</h2><button disabled={status === 'loading' || status === 'verifying'} onClick={() => setRefresh(value => value + 1)}>REFRESH ↻</button></div>{status === 'loading' && <p role="status">Finding your original Friends…</p>}{status === 'verifying' && <p role="status">Checking ownership and loading original artwork…</p>}{status === 'ready' && !error && !friends.length && <p>No Genesis NFTs found in this wallet. Choose another wallet, or <a href="/play/">play with a hardwired Generations Friend</a>.</p>}{error && <p className="genesis-error" role="alert">{error}</p>}<div className="genesis-friends">{friends.map(friend => <button key={friend.id.toString()} disabled={status === 'verifying'} onClick={() => void choose(friend.id)}><GenesisPortrait id={friend.id} loader={portraits}/><span className="genesis-friend-name">{friend.label}</span><small>FREE ENTRY · 100×</small><b aria-hidden="true">↗</b></button>)}</div><form className="genesis-manual" onSubmit={event => { event.preventDefault(); if (/^(0|[1-9][0-9]{0,77})$/.test(manualId) && BigInt(manualId) < 1n << 256n) void choose(BigInt(manualId)); }}><label htmlFor="genesis-id">KNOW YOUR GENESIS NUMBER?</label><div><input id="genesis-id" inputMode="numeric" pattern="(0|[1-9][0-9]{0,77})" required maxLength={78} value={manualId} onChange={event => setManualId(event.target.value)} placeholder="e.g. 42"/><button disabled={status === 'verifying'} type="submit">VERIFY & PLAY ↗</button></div><small>We always verify that the connected wallet owns it.</small></form></section>}
  <p className="genesis-caption">Genesis ownership is verified on Robinhood Chain before entry and before each run. Your original Genesis portrait gets a random Generations body for each run. All rewards are simulated; no activation payment, transaction, or signature is required.</p></main></div>;
}

createRoot(document.getElementById('root')!).render(location.pathname.startsWith('/genesis') ? <GenesisHost/> : <ArcadeChoice/>);

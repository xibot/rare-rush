import { useEffect, useRef, useState } from 'react';
import { createPublicClient, http, type Address } from 'viem';
import { TESTNET_CHAIN } from './testnet.ts';
import { discoverTestnetInventory, readTestnetLibraryPage, type TestnetLibrary } from './testnet-library.ts';
import { testRunArt } from '../testnet-app/src/play/art.ts';
import { FriendSprite } from '../games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../games/rare-rush/genesis/GenesisRunnerSprite.tsx';

type Props = { account: Address | null; chainId: number | null; collection: 0 | 1; selectedId: string;
  disabled: boolean; balance?: bigint; onSelect: (id: string) => void; onConnect: () => void; onSwitch: () => void };
function readClient(signal: AbortSignal) {
  const transport = http('/api/rpc', { timeout: 12_000, retryCount: 1, batch: { wait: 10, batchSize: 20 } });
  return createPublicClient({ chain: TESTNET_CHAIN, cacheTime: 0, transport: config => {
    const rpc = transport(config);
    // Keep this page's cancellation separate from the next wallet/collection batch.
    const request = ((args: Parameters<typeof rpc.request>[0], options?: Parameters<typeof rpc.request>[1]) =>
      rpc.request(args, { ...options, signal })) as typeof rpc.request;
    return { ...rpc, request };
  } });
}
function TestPortrait({ collection, tokenId }: { collection: 0 | 1; tokenId: string }) {
  const art = testRunArt(collection, tokenId, 'agent-play');
  return <svg viewBox="-3 -3 22 22" width="80" height="80" aria-hidden="true">
    {collection === 1 ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId}/>
      : <FriendSprite sprites={art.sprites} frame={0} direction="down"/>}
  </svg>;
}
export function TestnetFriendPicker({ account, chainId, collection, selectedId, disabled, balance, onSelect, onConnect, onSwitch }: Props) {
  const [library, setLibrary] = useState<TestnetLibrary | null>(null), [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [loadingMore, setLoadingMore] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const name = collection === 1 ? 'Genesis' : 'Generations';
  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort(); setLibrary(null); setError(''); setLoadingMore(false);
    if (account && chainId === 46630) {
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]), client = readClient(signal);
      setLoadingMore(true);
      let progress: TestnetLibrary | undefined;
      const started = Date.now();
      void (async () => {
        const inventory = await discoverTestnetInventory(client, account, collection, signal);
        do {
          progress = await readTestnetLibraryPage(client, inventory, signal, progress);
          if (!controller.signal.aborted) setLibrary(progress);
        } while (!progress.tokenIds.length && progress.nextCursor !== null && Date.now() - started < 18_000);
      })().catch(() => {
        if (!controller.signal.aborted) setError(progress
          ? 'Your loaded Friends are still available. Continue searching, or enter a test NFT ID below.'
          : 'Could not load your test Friends. Retry, or enter a test NFT ID below.');
      }).finally(() => { if (!controller.signal.aborted) setLoadingMore(false); });
    }
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [account, chainId, collection, balance, refresh]);
  async function more() {
    if (!library || library.nextCursor === null || loadingMore) return;
    const controller = new AbortController(); moreRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]);
    setLoadingMore(true); setError('');
    try {
      let progress = library;
      const initialCount = library.tokenIds.length, started = Date.now();
      do {
        progress = await readTestnetLibraryPage(readClient(signal), progress.inventory, signal, progress);
        if (!controller.signal.aborted) setLibrary(progress);
      } while (progress.tokenIds.length === initialCount && progress.nextCursor !== null && Date.now() - started < 18_000);
    } catch {
      if (!controller.signal.aborted) setError('Could not load the next test Friends. Your loaded Friends are still available.');
    } finally { if (!controller.signal.aborted) setLoadingMore(false); }
  }
  return <section className="arcade-friend-picker" aria-label={`Your Test ${name} Friends`}>
    <div className="arcade-picker-heading"><span>YOUR TEST {name.toUpperCase()} {library ? `· ${String(library.inventory.balance)}` : ''}</span>
      {account && chainId === 46630 && <button disabled={disabled || (!library && !error)} onClick={() => { onSelect(''); setRefresh(v => v + 1); }}>REFRESH FRIENDS ↻</button>}</div>
    {!account ? <><p className="muted small">Connect your wallet to choose from your test Friends.</p><button className="wallet-connect" disabled={disabled} onClick={onConnect}>CONNECT WALLET</button></>
      : chainId !== 46630 ? <><p className="muted small">Switch to Robinhood Testnet to see your test Friends.</p><button disabled={disabled} onClick={onSwitch}>SWITCH TO TESTNET</button></>
      : <>
        {!library && !error && <p className="muted small" role="status">Finding your test Friends…</p>}
        {error && <p className="arcade-picker-error small" role="alert">{error}</p>}
        {library && !library.tokenIds.length && library.nextCursor === null && <p className="muted small">No playable test {name} NFTs found in this wallet. Try the other collection, or mint a test Friend in Test kit &amp; run recovery below.</p>}
        {!!library?.tokenIds.length && <div className="arcade-friend-grid">{library.tokenIds.map(id => <button className="arcade-friend-card" key={id} disabled={disabled} aria-pressed={selectedId === id} onClick={() => onSelect(id)}>
          <span className="arcade-friend-art"><TestPortrait collection={collection} tokenId={id}/></span><b>TEST {name.toUpperCase()} #{id}</b><small>{selectedId === id ? '✓ SELECTED' : 'SELECT FRIEND'}</small>
        </button>)}</div>}
        {!!library?.hiddenCount && <p className="muted small">{library.hiddenCount} test {library.hiddenCount === 1 ? 'Friend is' : 'Friends are'} not hardwired yet.</p>}
        {library && !library.tokenIds.length && library.nextCursor !== null && <p className="muted small" role="status">{loadingMore?'Searching your wallet’s test NFT history…':'More wallet history remains to search.'} Your wallet holds {String(library.inventory.balance)} test {name}.</p>}
        {library && library.nextCursor !== null && <button className="arcade-more-friends" disabled={disabled || loadingMore} onClick={() => void more()}>{loadingMore ? 'LOADING FRIENDS…' : library.tokenIds.length ? 'MORE FRIENDS ↓' : 'CONTINUE SEARCHING ↓'}</button>}
        {!!library?.tokenIds.length && <p className="muted small">Cosmetic test artwork. Ownership and remaining starts are checked when you select a Friend.</p>}
      </>}
  </section>;
}

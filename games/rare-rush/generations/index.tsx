import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createRoot } from 'react-dom/client';
import { ConnectedGameHost, type ConnectedGameHostProps } from '@rarefriends/friendsdk/runtime';
import type { GameFrameProps } from '@rarefriends/friendsdk/frame';
import { createFriendWalletSession } from '@rarefriends/friendsdk/wallet';
import { parseChanceGame } from '@rarefriends/friendsdk/game';
import { createArcadePublicClient } from '../arcade-client';
import { discoverArcadeInventory, readArcadeInventoryPage, type ArcadeInventory, type InventoryFriend } from '../arcade-inventory';
import gameJson from '../game.json';
import '@rarefriends/friendsdk/frame.css';
import '@rarefriends/friendsdk/runtime.css';
import '../host.css';

const definition = parseChanceGame(gameJson);
// The pinned SDK forwards this picker to its existing frame and eligibility gate.
// Keep its menus, pause handling and preview ledger while paging discovery here.
type Picker = Pick<GameFrameProps, 'friends' | 'onSelectFriend' | 'connection' | 'friendsLoading' | 'friendsError' | 'friendsEmptyMessage' | 'friendsHiddenCount'>;
const PagedGameHost = ConnectedGameHost as (props: ConnectedGameHostProps & { picker: Picker }) => ReturnType<typeof ConnectedGameHost>;
type Discovery = { revision: number; attempt: number; inventory?: ArcadeInventory; friends: readonly InventoryFriend[];
  hiddenCount: number; nextCursor: number | null; error?: string };

/** Page the picker locally; FriendSDK still verifies the selected NFT and owns
 * the isolated game bridge. The wallet never supplies chain-read transport.
 */
function GenerationsHost() {
  const [session] = useState(() => createFriendWalletSession());
  const [publicClient] = useState(() => createArcadePublicClient());
  const wallet = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  const [attempt, setAttempt] = useState(0), [selected, setSelected] = useState<bigint | null>(null);
  const [discovery, setDiscovery] = useState<Discovery | null>(null), [loadingMore, setLoadingMore] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const valid = wallet.status === 'connected' && discovery?.revision === wallet.revision && discovery.attempt === attempt ? discovery : null;
  const friend = valid?.friends.find(value => value.id === selected) ?? null;
  useEffect(() => () => { moreRequest.current?.abort(); session.dispose(); }, [session]);
  const assertActive = useCallback(() => {
    const current = session.getSnapshot();
    if (current.revision !== wallet.revision || current.status !== 'connected') throw new Error('Wallet session changed. Reconnect before continuing.');
  }, [session, wallet.revision]);

  useEffect(() => {
    setSelected(null); setLoadingMore(false); moreRequest.current?.abort();
    if (wallet.status !== 'connected' || !wallet.account) return;
    const controller = new AbortController(), signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    const client = createArcadePublicClient({ signal });
    void (async () => {
      const inventory = await discoverArcadeInventory(client, wallet.account!, 0, { signal });
      const page = await readArcadeInventoryPage(client, inventory, { signal });
      assertActive();
      if (!signal.aborted) setDiscovery({ revision: wallet.revision, attempt, inventory, ...page });
    })().catch(() => {
      if (!controller.signal.aborted && session.getSnapshot().revision === wallet.revision)
        setDiscovery({ revision: wallet.revision, attempt, friends: [], hiddenCount: 0, nextCursor: null,
          error: 'Could not load your Friends. Please retry.' });
    });
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [session, wallet.status, wallet.account, wallet.revision, attempt, assertActive]);

  async function more() {
    if (!valid?.inventory || valid.nextCursor === null || loadingMore || moreRequest.current && !moreRequest.current.signal.aborted) return;
    const controller = new AbortController(); moreRequest.current = controller;
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(25_000)]);
    setLoadingMore(true);
    try {
      const page = await readArcadeInventoryPage(createArcadePublicClient({ signal }), valid.inventory, { signal, cursor: valid.nextCursor });
      assertActive();
      if (!signal.aborted) setDiscovery({ ...valid, friends: [...valid.friends, ...page.friends],
        hiddenCount: valid.hiddenCount + page.hiddenCount, nextCursor: page.nextCursor, error: undefined });
    } catch {
      if (!controller.signal.aborted && session.getSnapshot().revision === wallet.revision)
        setDiscovery({ ...valid, error: 'Could not load the next Friends. Retry below; your loaded Friends remain available.' });
    } finally { controller.abort(); if (moreRequest.current === controller) { moreRequest.current = null; setLoadingMore(false); } }
  }

  const connection = <div className="rf-runtime-connection">
    {wallet.status === 'unavailable' && <><p>No browser wallet found. Enable your wallet extension or open this game in your wallet’s browser.</p><button onClick={() => void session.connect()}>Check for wallet</button></>}
    {wallet.status === 'disconnected' && <p>Connect your wallet to find your Friends on Robinhood.</p>}
    {wallet.status === 'connecting' && <p role="status">Connecting wallet…</p>}
    {wallet.status === 'switching-network' && <button disabled>Switching network… Check your wallet</button>}
    {wallet.status === 'wrong-network' && <p role="alert">Switch to Robinhood mainnet (4663) to load your Friends.</p>}
    {wallet.error && <p role="alert">{wallet.error}</p>}
    {wallet.account && <p>Connected: {wallet.account}</p>}
    {(wallet.status === 'disconnected' || wallet.status === 'error') && wallet.wallets.map(value =>
      <button key={value.id} onClick={() => void session.connect(value.id)}>{wallet.wallets.length === 1 ? 'Connect wallet' : `Connect ${value.name}`}</button>)}
    {wallet.account && <button onClick={() => session.disconnect()}>Disconnect</button>}
    {wallet.status === 'connected' && <button onClick={() => setAttempt(value => value + 1)}>{valid?.error ? 'Retry loading Friends' : 'Refresh Friends'}</button>}
    {wallet.status === 'wrong-network' && <><button className="rf-frame-primary" onClick={() => void session.switchNetwork()}>Switch to Robinhood</button><button onClick={() => void session.refresh()}>Check network</button></>}
    {valid?.nextCursor !== null && valid?.inventory && <button disabled={loadingMore} onClick={() => void more()}>{loadingMore ? 'Loading Friends…' : 'More Friends ↓'}</button>}
    {valid?.inventory && valid.nextCursor !== null && <p>{valid.nextCursor} of {valid.inventory.ids.length} Friends checked. More load when you need them.</p>}
  </div>;
  return <PagedGameHost definition={definition} frameUrl="./game.html" selectedFriend={friend}
    account={wallet.account} chainId={wallet.chainId} revision={wallet.revision} publicClient={publicClient} assertActive={assertActive}
    picker={{ friends: valid?.friends ?? [], onSelectFriend: setSelected, connection,
      friendsLoading: wallet.status === 'connected' && !valid, friendsError: valid?.error,
      friendsHiddenCount: valid?.hiddenCount,
      friendsEmptyMessage: valid && !valid.error && valid.nextCursor === null ? 'No playable Generations Friends found in this wallet.' : null }}/>;
}

createRoot(document.getElementById('root')!).render(<GenerationsHost/>);

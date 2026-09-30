import { useEffect, useRef, useState } from 'react';
import type { Address } from 'viem';
import type { ArcadeProvider } from './arcade.ts';
import { loadArcadeLibrary, loadMoreArcadeFriends, loadArcadePortrait, type ArcadeLibrary } from './arcade-library.ts';

type Props = { provider: ArcadeProvider; account: Address; collection: 0 | 1;
  selectedId: string; disabled: boolean; onSelect: (tokenId: string) => void };

export function ArcadeFriendPicker({ provider, account, collection, selectedId, disabled, onSelect }: Props) {
  const [library, setLibrary] = useState<ArcadeLibrary | null>(null);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0), [loadingMore, setLoadingMore] = useState(false);
  const moreRequest = useRef<AbortController | null>(null);
  const [portraits, setPortraits] = useState<Record<string, string | null>>({});
  const name = collection === 1 ? 'Genesis' : 'Generations';
  useEffect(() => {
    const controller = new AbortController();
    moreRequest.current?.abort(); setLoadingMore(false);
    setLibrary(null); setError(''); setPortraits({});
    void loadArcadeLibrary(provider, account, collection, controller.signal).then(result => {
      if (!controller.signal.aborted) setLibrary(result);
    }).catch(() => {
      if (!controller.signal.aborted) setError('Could not load your Friends. Check that your wallet is on Robinhood mainnet, then retry. You can also enter a Friend ID below.');
    });
    return () => { controller.abort(); moreRequest.current?.abort(); };
  }, [provider, account, collection, refresh]);

  useEffect(() => {
    if (!library) return;
    const controller = new AbortController();
    // Bound thumbnail RPC work. An unavailable image never hides an owned NFT.
    const queue = library.friends.filter(friend => !(friend.tokenId in portraits));
    void (async () => {
      for (let offset = 0; offset < queue.length && !controller.signal.aborted; offset += 3) {
        await Promise.all(queue.slice(offset, offset + 3).map(async friend => {
          let image: string | null = null;
          try { image = await loadArcadePortrait(provider, account, collection, friend.tokenId, controller.signal); } catch {}
          if (!controller.signal.aborted) setPortraits(previous => ({ ...previous, [friend.tokenId]: image }));
        }));
      }
    })();
    return () => controller.abort();
  }, [library, provider, account, collection]);

  async function more() {
    if (!library || library.nextCursor === null || loadingMore) return;
    const controller = new AbortController(); moreRequest.current = controller;
    setLoadingMore(true); setError('');
    try {
      const result = await loadMoreArcadeFriends(provider, account, collection, library, controller.signal);
      if (!controller.signal.aborted) setLibrary(result);
    } catch {
      if (!controller.signal.aborted) setError('Could not load the next Friends. Try again; your loaded Friends are still available.');
    } finally {
      if (!controller.signal.aborted) setLoadingMore(false);
    }
  }

  return <section className="arcade-friend-picker" aria-label={`Your ${name} Friends`}>
    <div className="arcade-picker-heading"><span>YOUR {name.toUpperCase()} {library ? `· ${library.inventory.ids.length}` : ''}</span>
      <button disabled={disabled || (!library && !error)} onClick={() => { onSelect(''); setRefresh(value => value + 1); }}>REFRESH ↻</button></div>
    {!library && !error && <p className="muted small" role="status">Finding your Friends…</p>}
    {error && <p className="arcade-picker-error small" role="alert">{error}</p>}
    {library && !library.friends.length && library.nextCursor === null && <p className="muted small">No playable {name} NFTs found in this wallet. Try the other collection or connect another wallet.</p>}
    {!!library?.hiddenCount && <p className="muted small">{library.hiddenCount} generation 0 {library.hiddenCount === 1 ? 'Friend is' : 'Friends are'} not playable yet. Generations Arcade uses generation 1 and beyond.</p>}
    {!!library?.friends.length && <><div className="arcade-friend-grid">{library.friends.map(friend =>
      <button className="arcade-friend-card" key={friend.tokenId} disabled={disabled} aria-pressed={selectedId === friend.tokenId}
        onClick={() => onSelect(friend.tokenId)}>
        <span className="arcade-friend-art">{portraits[friend.tokenId]
          ? <img src={portraits[friend.tokenId]!} alt="" width="80" height="80"/>
          : <span className="arcade-art-placeholder" aria-hidden="true">{portraits[friend.tokenId] === null ? '◇' : '…'}</span>}</span>
        <b>{friend.label}</b><small>{selectedId === friend.tokenId ? '✓ SELECTED' : 'SELECT FRIEND'}</small>
      </button>)}</div>
      <p className="muted small">Choose a Friend to run. Ownership is checked again when you start.</p></>}
    {library && library.nextCursor !== null && <button className="arcade-more-friends" disabled={disabled || loadingMore} onClick={() => void more()}>{loadingMore ? 'LOADING FRIENDS…' : 'MORE FRIENDS ↓'}</button>}
  </section>;
}

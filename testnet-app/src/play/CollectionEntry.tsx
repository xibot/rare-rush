import type { ReactNode } from 'react';
import { TestFriendAvatar } from './RunCanvas.tsx';
import type { Collection, FriendSelection } from './types.ts';
import './entry.css';

type CollectionChoiceProps = {
  onChoose: (collection: Collection) => void;
};

/** The main arcade's collection entrance, using the testnet's real entry terms. */
export function CollectionChoice({ onChoose }: CollectionChoiceProps) {
  return <main className="testnet-entry">
    <div className="testnet-entry-content">
      <span className="testnet-entry-kicker">ONE WORLD. TWO WAYS TO RUSH.</span>
      <h1>Bring your<br/><span>Rare Friend.</span></h1>
      <p>Choose the collection you want to play with. Both use your test NFT and real testnet rewards.</p>
      <div className="testnet-collection-cards">
        <button type="button" className="testnet-collection-card" onClick={() => onChoose(1)}>
          <img src="/assets/rare-friend.svg" width="76" height="76" alt=""/>
          <span className="testnet-entry-kicker">THE ORIGINAL FRIENDS</span>
          <span className="testnet-collection-title" role="heading" aria-level={2}>Genesis</span>
          <span className="testnet-collection-description">Free entry.<br/><strong>100× test token rewards.</strong></span>
          <span className="testnet-collection-action">PLAY GENESIS ↗</span>
        </button>
        <button type="button" className="testnet-collection-card" onClick={() => onChoose(0)}>
          <img src="/assets/rare-friend.svg" width="76" height="76" alt=""/>
          <span className="testnet-entry-kicker">GENERATION 1 AND BEYOND</span>
          <span className="testnet-collection-title" role="heading" aria-level={2}>Generations</span>
          <span className="testnet-collection-description">110 tRF per run.<br/><strong>Standard rewards + mode bonuses.</strong></span>
          <span className="testnet-collection-action">PLAY GENERATIONS ↗</span>
        </button>
      </div>
      <p className="testnet-entry-caption">Connect a browser wallet on Robinhood testnet. Genesis entry is free; each Generations entry sends 100 tRF to the prize pool and 10 tRF to the treasury. These are real testnet transactions with valueless test assets.</p>
    </div>
  </main>;
}

type CollectionFriendsProps = {
  collection: Collection;
  account: string | null;
  busy: boolean;
  friends: FriendSelection[];
  walletControls: ReactNode;
  feedback?: ReactNode;
  onBack: () => void;
  onChoose: (friend: FriendSelection) => void;
  children?: ReactNode;
};

export function CollectionFriends({ collection, account, busy, friends, walletControls, feedback, onBack, onChoose, children }: CollectionFriendsProps) {
  const genesis = collection === 1;
  const name = genesis ? 'Genesis' : 'Generations';
  const owned = friends.filter(friend => friend.collection === collection);
  return <main className="testnet-entry">
    <div className="testnet-entry-content">
      <button type="button" className="testnet-entry-back" onClick={onBack}>← CHOOSE COLLECTION</button>
      <span className="testnet-entry-kicker">{genesis ? 'THE ORIGINAL FRIENDS. THE BIG RUSH.' : 'THE NEXT GENERATION. THE SAME RUSH.'}</span>
      <h1>{name}<br/><span>unlocked.</span></h1>
      <p>{genesis ? 'Bring your test Genesis. Get free entry and 100× test token rewards.' : 'Bring your test Generations Friend. Pick your mode. Make the run yours.'}</p>
      <section className="testnet-entry-wallet" aria-label={`Choose your test ${name} Friend`}>
        {account && <p className="testnet-entry-account">Connected: {account}</p>}
        <div className="testnet-entry-wallet-controls">{walletControls}</div>
        {feedback && <div className="testnet-entry-feedback">{feedback}</div>}
        {account && <>
          {!!owned.length && <div className="testnet-entry-friends">
            {owned.map(friend => <button type="button" className="testnet-entry-friend" key={`${friend.collection}:${friend.tokenId}`} disabled={busy} onClick={() => onChoose(friend)} aria-label={`Play with test ${name} #${friend.tokenId}`}>
              <TestFriendAvatar collection={friend.collection} tokenId={friend.tokenId}/>
              <strong>{genesis ? 'Genesis' : 'Friend'} #{friend.tokenId}</strong>
              <small>{genesis ? 'Test Genesis · Free entry · 100×' : 'Test Generations · 110 tRF entry'}</small>
            </button>)}
          </div>}
          {!busy && owned.length === 0 && <p>No test {name} NFTs found in this wallet. <a href="/#test-kit">Mint a test Friend ↗</a> or add its ID below.</p>}
          {children}
        </>}
      </section>
      <p className="testnet-entry-caption">Your test {name} ownership is verified on Robinhood testnet before entry. {genesis ? 'Genesis gets free entry and 100× token rewards.' : 'Each entry sends 100 tRF to the prize pool and 10 tRF to the treasury.'} Survive the timer to verify your run and mint tRARERUSH. Test NFTs and tokens are separate from your mainnet assets and have no real value.</p>
    </div>
  </main>;
}

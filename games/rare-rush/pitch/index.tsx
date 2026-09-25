import { createRoot } from 'react-dom/client';
import { useEffect, useRef } from 'react';
import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import { SiteHeader } from '../SiteHeader';
import { CanonicalProp, TokenCoin } from '../CanonicalArt';
import { FriendSprite } from '../RunnerArt';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../difficulty';
import { formatToken, HALVING_INTERVAL, TOKEN_CAP } from '../economy';
import cachedArt from '../landing/preview-art.json';
import { WorldExpansion } from './WorldExpansion';
import '../landing/landing.css';
import './pitch.css';

const source = cachedArt.friends[0];
const friend = decodeGenerationSprites(BigInt(source.tokenId), source.familyId, source.seed, source.frames.map(BigInt), cachedArt.provenance.manifest as GenerationSpriteManifest);

function Coin({ size = 56 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 60 60" aria-hidden="true"><TokenCoin size={60}/></svg>;
}

function GrowthArt() {
  return <svg className="pitch-mechanic-art" viewBox="0 0 300 166" role="img" aria-label="A small Rare Friend grows after collecting coins, then shrinks after a hit.">
    <path d="M18 136h264" stroke="currentColor"/>
    <g transform="translate(30 96) scale(2.5)"><FriendSprite sprites={friend} frame={0}/></g>
    <g transform="translate(120 64) scale(4.5)"><FriendSprite sprites={friend} frame={2} walking/></g>
    <g transform="translate(246 96) scale(2.5)"><FriendSprite sprites={friend} frame={0}/></g>
    <TokenCoin x={84} y={26} size={30}/><TokenCoin x={111} y={10} size={30}/>
    <path d="M74 94h29m-7-7 7 7-7 7M204 94h25m-7-7 7 7-7 7" stroke="currentColor" strokeWidth="2" fill="none"/>
    <CanonicalProp type="crystal" x={198} y={38} width={31} height={35}/>
  </svg>;
}

function BonusArt() {
  return <svg className="pitch-mechanic-art" viewBox="0 0 300 166" role="img" aria-label="A flying surprise coin is twice the size of an ordinary coin and gives ten times the demo token reward.">
    <TokenCoin x={35} y={82} size={40}/><TokenCoin x={151} y={40} size={80}/>
    <path d="M240 61h24m-16 16h32m-38 16h21" stroke="currentColor" strokeWidth="2"/>
    <rect x={154} y={9} width={75} height={23} fill="#000"/>
    <text x={191.5} y={27} textAnchor="middle" fill="#ccff00" fontFamily="var(--rush-font-mono)" fontSize="19">10×</text>
    <path d="M18 136h264" stroke="currentColor"/>
  </svg>;
}

function PaceArt() {
  return <svg className="pitch-mechanic-art" viewBox="0 0 300 166" role="img" aria-label="Left and right arrow controls let you slow down or speed up your Friend.">
    <rect x={25} y={51} width={57} height={53} fill="none" stroke="currentColor" strokeWidth="2"/>
    <rect x={218} y={51} width={57} height={53} fill="none" stroke="currentColor" strokeWidth="2"/>
    <path d="M25 110h57m136 0h57M65 77H43m9-9-9 9 9 9M235 77h22m-9-9 9 9-9 9" stroke="currentColor" strokeWidth="3" fill="none"/>
    <g transform="translate(118 40) scale(4)"><FriendSprite sprites={friend} frame={2} walking/></g>
    <path d="M18 136h264" stroke="currentColor"/>
  </svg>;
}

function GameplayClip() {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const element = video.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) element.pause();
    });
    const pauseWhenHidden = () => { if (document.hidden) element.pause(); };
    observer.observe(element);
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => {
      observer.disconnect();
      document.removeEventListener('visibilitychange', pauseWhenHidden);
    };
  }, []);
  return <figure className="pitch-hero-preview">
    <div className="pitch-preview-label"><span><i/> THE RARE TWIST.</span><span>RIGHT · UP · DOWN · LEFT</span></div>
    <video ref={video} className="pitch-gameplay-video" controls playsInline preload="none" poster="/media/rare-rush-directions.jpg" aria-label="Watch the Rare Rush four-direction gameplay update" aria-describedby="pitch-video-caption">
      <source src="/media/rare-rush-directions.mp4" type="video/mp4"/>
      Your browser cannot play this clip. <a href="/media/rare-rush-directions.mp4">Download the gameplay video.</a>
    </video>
    <figcaption id="pitch-video-caption" className="pitch-preview-note">Recorded Testnet demo gameplay · normal speed.<br/>Silent, edited highlights: run right, spin through upward lifts and free falls, then catch a leftward surprise. Coins and obstacles follow the twist.</figcaption>
  </figure>;
}

function Pitch() {
  return <>
    <a className="pitch-skip" href="#pitch-title">Skip to the pitch</a>
    <SiteHeader page="pitch"/>
    <div className="rush-pitch">

    <main>
      <section className="pitch-hero" aria-labelledby="pitch-title">
        <div className="pitch-hero-copy"><span className="pitch-kicker"><i/> THE RARE FRIENDS VIBEATHON PITCH</span><h1 id="pitch-title">YOUR FRIEND.<br/><em>YOUR RUN.</em></h1><p>A runner with a rare twist. Start sideways, get pulled upward, spin into a free fall—and sometimes come out running backwards. Bring your Friend. Find your rhythm in the chaos.</p><a className="pitch-button" href="/arcade/">PLAY ARCADE <span aria-hidden="true">↗</span></a><div className="pitch-hero-note"><span className="pitch-status">PLAYABLE NOW</span><span>PHONE + DESKTOP<br/>ARCADE + TESTNET</span></div></div>
        <GameplayClip/>
      </section>

      <section className="pitch-playable" aria-labelledby="playable-title">
        <div className="pitch-section-heading"><div><span className="pitch-kicker">TWO BUILDS. ONE RARE TWIST.</span><h2 id="playable-title">Pick your way<br/>to play.</h2></div><p>The full directional update is playable in both. Choose the Arcade experience or try the onchain loop with test assets.</p></div>
        <div className="pitch-playable-grid">
          <article><span className="pitch-status">LIVE / ARCADE</span><h3>Your real Friend.<br/>Simulated rewards.</h3><p>Connect a wallet holding a supported Rare Friend on Robinhood Chain mainnet. Play the MVP with your NFT as your character; entry fees and rewards are simulated.</p><a className="pitch-text-link" href="/arcade/">PLAY ARCADE ↗</a></article>
          <article><span className="pitch-status">LIVE / TESTNET</span><h3>Play. Verify.<br/>Mint your rush.</h3><p>Use faucet NFTs and tokens on Robinhood testnet, chain 46630. Survive the timer, verify your run, then claim tRARERUSH with a real testnet transaction. Test assets have no real value.</p><a className="pitch-text-link" href="https://testnet.rarerush.app">TRY TESTNET ↗</a></article>
        </div>
      </section>

      <section className="pitch-fun pitch-paper" aria-labelledby="fun-title">
        <div className="pitch-section-heading"><div><span className="pitch-kicker">01 / THE ONE-MORE-RUN FEELING</span><h2 id="fun-title">Easy to start.<br/>Hard to put down.</h2></div><p>Automatic running. Double jumps. Three hearts. Upward lifts and free falls keep you spinning; surprise reversals keep you guessing.</p></div>
        <div className="pitch-hook-grid"><article><GrowthArt/><span className="pitch-card-index">COLLECT → GROW → RECOVER</span><h3>Little coins. Big Friend.</h3><p>Coins make your Friend grow. Hits shrink you again. Every run has its own little comeback.</p></article><article><BonusArt/><span className="pitch-card-index">2× SIZE / 10× DEMO REWARD</span><h3>Chase the surprise.</h3><p>Giant coins fly across the sky. Take the safe route, or time a double jump to catch the rush.</p></article><article><PaceArt/><span className="pitch-card-index">SLOW DOWN ← → SPEED UP</span><h3>Make the run yours.</h3><p>Control your pace, duck under bridges, and find your line. Keyboard or thumbs. Same game.</p></article></div>
      </section>

      <section className="pitch-modes" aria-labelledby="modes-title"><div><span className="pitch-kicker">02 / PICK YOUR CHAOS</span><h2 id="modes-title">Three ways<br/>to rush.</h2></div><div className="pitch-mode-grid">{DIFFICULTY_ORDER.map((key) => <article key={key}><span>{DIFFICULTIES[key].label}</span><strong>{DIFFICULTIES[key].seconds}<small>SEC</small></strong><p>{DIFFICULTIES[key].description}</p><b>{DIFFICULTIES[key].rewardLabel} TOKEN MULTIPLIER</b></article>)}</div><p className="pitch-mode-note">Continuous spins in every mode. Leftward exits arrive as occasional surprises after vertical sections. Arcade rewards are simulated; Testnet rewards are valueless test tokens.</p></section>

      <section className="pitch-identity" aria-labelledby="identity-title"><div className="pitch-section-heading"><div><span className="pitch-kicker">03 / ARCADE · YOUR NFT GETS A PLAY BUTTON</span><h2 id="identity-title">Same rare world.<br/>Your actual Friend.</h2></div><p>Arcade checks ownership of your real NFT on Robinhood Chain mainnet. Original art and floating lands make identity part of the game.</p></div>
        <div className="pitch-holder-grid"><article><div className="pitch-holder-top"><Coin size={66}/><span className="pitch-status">GENESIS</span></div><h3>The originals rush free.</h3><p>Your original Genesis face gets a random body from 36 compatible Generations bodies each run. Same identity, fresh moves. Entry verifies your ownership.</p><div className="pitch-holder-reward"><strong>100×</strong><span>DEMO TOKEN REWARDS<br/>FREE ENTRY</span></div></article><article><div className="pitch-holder-top"><Coin size={66}/><span className="pitch-status">GENERATIONS</span></div><h3>Born to keep moving.</h3><p>FriendSDK powers the Generations entry and animated sprites. Bring an owned, hardwired Friend from generation 1 or beyond.</p><div className="pitch-holder-reward"><strong>1 RF</strong><span>DEMO ENTRY PER RUN<br/>100% TO THE DEMO POOL</span></div></article></div>
        <p className="pitch-small-note">These are Arcade settings. Genesis’s 100× boost stacks with difficulty and bonus coins, within the demo cap. It boosts tokens, not your score. Arcade charges no real wallet funds. Testnet uses separate faucet NFTs.</p>
      </section>

      <section className="pitch-economy pitch-paper" aria-labelledby="economy-title"><div className="pitch-section-heading"><div><span className="pitch-kicker">04 / FROM ARCADE TO PLAY-TO-MINT</span><h2 id="economy-title">A coin worth<br/>chasing.</h2></div><p>Come for your Friend. Return for a better run.<br/>Testnet now connects the run to an onchain claim.</p></div>
        <div className="pitch-economy-now"><div><span className="pitch-status">ARCADE / SESSION SIMULATION</span><h3>Start generous.<br/>Keep a limit.</h3><p>Arcade base rewards halve every {HALVING_INTERVAL.toLocaleString('en-US')} pickups. Both collections follow the same {formatToken(TOKEN_CAP)} demo-token cap.</p></div><div className="pitch-curve" role="img" aria-label="Arcade only: example base demo rewards per ordinary Normal coin are ten, five, and two point five. The base reward halves every ten thousand pickups.">{[10, 5, 2.5].map((value, index) => <div key={value}><strong>{value}</strong><div style={{ height: `${value * 8}px` }}/><span>{index === 0 ? 'START' : `${index * 10}K`}<br/>PICKUPS</span></div>)}</div></div>
        <p className="pitch-small-note">This curve is the Arcade session simulation. It does not describe Testnet issuance or final mainnet tokenomics. Demo rewards have no redemption value.</p>
        <div className="pitch-future-heading"><span className="pitch-status">LIVE ON ROBINHOOD TESTNET</span><h3>Play to mint tRARERUSH.</h3><p>The verifier checks your saved run before issuing a signed claim. Survive until the timer ends to earn test rewards, then confirm the claim in your wallet.</p></div>
        <ol className="pitch-token-flow"><li><span>01</span><h4>PLAY</h4><p>Choose a test Friend.</p></li><li><span>02</span><h4>COLLECT</h4><p>Gather coins. Survive.</p></li><li><span>03</span><h4>VERIFY</h4><p>Check the saved run.</p></li><li><span>04</span><h4>MINT</h4><p>Claim tRARERUSH.</p></li></ol>
        <p className="pitch-small-note">Testnet: three starts per NFT per UTC day. Genesis enters free with 100× token rewards. Generations entry is 110 tRF: 100 to the prize pool and 10 to treasury. Losing or abandoning uses the attempt and does not refund the entry fee. Test ETH covers gas.</p>
        <a className="pitch-testnet-action" href="https://testnet.rarerush.app">BUILD YOUR TEST KIT & TRY PLAY-TO-MINT ↗</a>
        <div className="pitch-next-grid"><article><span className="pitch-card-index">FUTURE / MAINNET ECONOMY</span><h3>RARERUSH ↔ RAREFRIENDS</h3><p>A mainnet reward token, funded liquidity, and final emission and fee settings remain future work. Current Testnet allocations are test settings.</p></article><article><span className="pitch-card-index">FUTURE / PRIZE PAYOUTS</span><h3>Runs that give back.</h3><p>Testnet entries already fund its prize pool. Automatic prize distribution and the final mainnet reward system are still to come.</p></article></div>
        <p className="pitch-small-note">Testnet minting is working today with valueless assets. Mainnet RARERUSH, liquidity, and automatic prize payouts are not live.</p>
      </section>

      <WorldExpansion/>

      <section className="pitch-endcap" aria-labelledby="endcap-title"><span className="pitch-kicker">06 / LESS PITCH. MORE PLAY.</span><Coin size={90}/><h2 id="endcap-title">ONE FRIEND.<br/><em>ONE MORE RUN.</em></h2><p>Give your Rare Friend a minute in the spotlight.<br/>See how far the twist takes you.</p><div className="pitch-final-actions"><a className="pitch-button" href="/arcade/">PLAY ARCADE <span aria-hidden="true">↗</span></a><a className="pitch-text-link" href="https://testnet.rarerush.app">TRY TESTNET ↗</a><a className="pitch-text-link" href="/docs/">EXPLORE THE DOCS ↗</a></div><small>Choose Genesis or Generations. Real NFT holders can play Arcade; faucet NFTs get you started on Testnet. On mobile, use your wallet’s browser.</small></section>
    </main>

    <footer className="pitch-footer"><div><b>RARE RUSH / BY XIBOT</b><span>A PLAYABLE VIBEATHON BUILD</span></div><div><a href="https://github.com/xibot/rare-rush">EXPLORE THE SOURCE ↗</a><a href="https://github.com/spokesz/friendsdk">BUILT WITH FRIENDSDK ↗</a><a href="https://rarefriends.com/">ART & WORLD BY RARE FRIENDS ↗</a><a href="#top">BACK TO TOP ↑</a></div></footer>
  </div></>;
}

createRoot(document.getElementById('root')!).render(<Pitch/>);

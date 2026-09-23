import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import { BrandMark } from '../BrandMark';
import { CanonicalProp, TokenCoin } from '../CanonicalArt';
import { FriendSprite } from '../RunnerArt';
import { WorldArt } from '../WorldArt';
import { DIFFICULTIES, DIFFICULTY_ORDER, type Difficulty } from '../difficulty';
import { createEconomy, formatToken, HALVING_INTERVAL, nextCoinReward, TOKEN_CAP } from '../economy';
import cachedArt from '../landing/preview-art.json';
import { ClaimConcept } from './ClaimConcept';
import './docs.css';

const source = cachedArt.friends[0];
const friend = decodeGenerationSprites(BigInt(source.tokenId), source.familyId, source.seed, source.frames.map(BigInt), cachedArt.provenance.manifest as GenerationSpriteManifest);
const chapters = [['start', '01', 'Your first rush'], ['play', '02', 'Move, collect, grow'], ['modes', '03', 'Pick your chaos'], ['rewards', '04', 'Arcade coin lab'], ['next', '05', 'Play to mint'], ['faq', '06', 'Good to know']] as const;

function Coin({ size = 56 }: { size?: number }) {
  return <svg viewBox="0 0 60 60" width={size} height={size} aria-hidden="true"><TokenCoin size={60}/></svg>;
}

function Cover() {
  return <svg className="docs-cover" viewBox="0 0 640 440" role="img" aria-label="A Rare Friend in a floating pixel world, chasing bear coins and a giant ten-times bonus coin.">
    <WorldArt distance={180} elapsed={0} reducedMotion biome={2}/>
    <g className="cover-friend" transform="translate(145 304) scale(6)"><FriendSprite sprites={friend} frame={2} walking/></g>
    <TokenCoin x={288} y={283} size={38}/><TokenCoin x={343} y={235} size={38}/><TokenCoin x={399} y={208} size={38}/>
    <g className="cover-coin"><TokenCoin x={478} y={128} size={76}/><path d="M557 148h27m-21 13h34m-38 13h22" stroke="#ccff00" strokeWidth="3"/><rect x={486} y={101} width={60} height={25} fill="#ccff00"/><text x={516} y={119} textAnchor="middle" fill="#000" fontSize="18" fontFamily="var(--rush-font-mono)">10×</text></g>
    <CanonicalProp type="crystal" x={357} y={350} width={46} height={53}/>
    <text x={24} y={36} fill="#ccff00" fontSize="12" fontFamily="var(--rush-font-mono)">FIELD GUIDE / 001</text>
    <text x={24} y={426} fill="#fff" fontSize="11" fontFamily="var(--rush-font-mono)">SMALL FRIEND. BIG POSSIBILITIES.</text>
  </svg>;
}

function GrowthLab() {
  const [growth, setGrowth] = useState(1);
  return <div className="growth-lab">
    <div className="growth-stage">
      <svg viewBox="0 0 340 250" role="img" aria-label={`Your example Friend is ${growth.toFixed(2)} times its starting size.`}>
        <path d="M24 210h292M40 221h50m166 0h44" stroke="#000" strokeWidth="2"/>
        <g transform="translate(45 146) scale(4)" opacity=".3"><FriendSprite sprites={friend} frame={0}/></g>
        <g data-growth={growth.toFixed(3)} transform={`translate(${228 - 32 * growth} ${210 - 64 * growth}) scale(${4 * growth})`}><FriendSprite sprites={friend} frame={2} walking/></g>
        <TokenCoin x={201} y={22} size={42}/><text x={164} y={122} fontSize="24" fill="#000">→</text>
        <text x={77} y={241} textAnchor="middle" fontSize="11" fontFamily="var(--rush-font-mono)">START</text><text x={228} y={241} textAnchor="middle" fontSize="11" fontFamily="var(--rush-font-mono)">YOUR FRIEND</text>
      </svg>
    </div>
    <div className="growth-copy"><span className="section-kicker">TRY IT RIGHT HERE</span><h3>Little coins. Big Friend.</h3><p>Each coin makes you a little bigger, up to 1.75×. A hit shrinks you again. Coins build your run’s reward. Arcade keeps simulated rewards in the session; Testnet requires a surviving, verified run before you can claim.</p>
      <div className="growth-actions"><button type="button" onClick={() => setGrowth(size => Math.min(1.75, size + .035 * 5))}>COLLECT 5 COINS +</button><button type="button" onClick={() => setGrowth(size => Math.max(1, size - .35))}>TAKE A HIT −</button><button type="button" onClick={() => setGrowth(1)}>RESET</button></div>
      <div className="growth-readout" role="status">{growth.toFixed(2)}× SIZE <span>Interactive example · no rewards earned</span></div>
    </div>
  </div>;
}

function RewardLab({ difficulty, onDifficulty }: { difficulty: Difficulty; onDifficulty: (mode: Difficulty) => void }) {
  const [epoch, setEpoch] = useState(0);
  const [genesis, setGenesis] = useState(false);
  const pickups = epoch * HALVING_INTERVAL;
  const scenario = createEconomy(pickups);
  const reward = (bonus: 1 | 10) => formatToken(nextCoinReward(scenario, difficulty, bonus, genesis ? 'genesis' : 'generations'));
  return <div className="reward-lab">
    <div className="lab-header"><div><span className="section-kicker">ARCADE ONLY / SIMULATED REWARD EXAMPLE</span><h3>Your next coin, decoded.</h3></div><div className="lab-mode"><label htmlFor="reward-mode">DIFFICULTY</label><select id="reward-mode" value={difficulty} onChange={event => onDifficulty(event.target.value as Difficulty)}>{DIFFICULTY_ORDER.map(mode => <option value={mode} key={mode}>{DIFFICULTIES[mode].label}</option>)}</select></div></div>
    <div className="holder-preview"><label htmlFor="reward-holder">CHOOSE YOUR FRIEND</label><select id="reward-holder" value={genesis ? 'genesis' : 'generations'} onChange={event => setGenesis(event.target.value === 'genesis')}><option value="generations">Generations · 1× (demo)</option><option value="genesis">Genesis · 100× (demo)</option></select><p role="status">{genesis ? 'GENESIS DEMO: free entry and 100× tokens per coin in the Genesis arcade.' : 'GENERATIONS DEMO: standard rewards and 1 demo RF per run.'}</p></div>
    <div className="activity-control"><label htmlFor="activity">Example pickups before your next coin <output htmlFor="activity">{pickups.toLocaleString('en-US')}</output></label><input id="activity" type="range" min="0" max="4" step="1" value={epoch} aria-valuetext={`${pickups.toLocaleString('en-US')} example pickups`} onChange={event => setEpoch(Number(event.target.value))}/><div><span>LAUNCH</span><span>40,000 PICKUPS</span></div></div>
    <div className="emission-chart" aria-label="Normal base rewards halve every ten thousand pickups: ten, five, two point five, one point two five, zero point six two five.">{[10, 5, 2.5, 1.25, .625].map((rate, index) => <div className={epoch === index ? 'selected' : ''} key={rate}><b>{rate}</b><div className="emission-bar" style={{ height: `${Math.max(10, rate * 8)}px` }}/><span>{index === 0 ? 'START' : `${index * 10}K`}</span></div>)}</div>
    <div className="reward-results" aria-live="polite"><div className="reward-result"><Coin/><div><span>ORDINARY COIN</span><strong data-reward="ordinary">{reward(1)}</strong><span>demo tokens / coin</span></div></div><div className="reward-result"><Coin size={82}/><div><span>FLYING BONUS · 10×</span><strong data-reward="bonus">{reward(10)}</strong><span>demo tokens / coin</span></div></div></div>
    <p className="lab-caption">This calculator uses Arcade’s local demo rules, including the Genesis 100× boost. It does not calculate Testnet mint amounts. These examples imagine earlier ordinary coins collected on Normal by Generations. This is not a live player counter, wallet balance, or token-price chart.</p>
  </div>;
}

function Docs() {
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  return <div className="rush-docs" id="top">
    <a className="docs-skip" href="#start">Skip to the guide</a>
    <header className="docs-header"><a className="docs-logo" href="/" aria-label="Rare Rush by Xibot home"><BrandMark/></a><nav aria-label="Main navigation"><a href="/">HOME</a><a href="/pitch/">PITCH</a><a className="nav-testnet" href="https://testnet.rarerush.app">TRY TESTNET</a><a className="docs-cta nav-arcade" href="/arcade/">PLAY ARCADE ↗</a></nav></header>
    <main>
      <section className="docs-hero" aria-labelledby="docs-title"><div><div className="docs-eyebrow">THE PLAYER’S FIELD GUIDE</div><h1 id="docs-title">RARE RUSH<span>101.</span></h1><p>Start sideways. Get pulled skyward. Drop into free fall. Find your next rush in Arcade, or play to mint on Testnet.</p><span className="docs-badge">ARCADE LIVE · TESTNET PLAY-TO-MINT LIVE</span></div><Cover/></section>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Guide chapters"><span>CHOOSE A CHAPTER</span>{chapters.map(([id, number, title]) => <a key={id} href={`#${id}`}><b>{number}</b>{title}<span aria-hidden="true">↗</span></a>)}</nav>
        <div className="docs-content">
          <section className="docs-section" id="start" aria-labelledby="start-title"><div className="section-kicker">01 / YOUR FIRST RUSH</div><div className="section-heading"><h2 id="start-title">Ready. Set. Rare.</h2><p>An endless world. A very finite timer. Grab coins, dodge trouble, and see how far your Friend can go.</p></div>
            <div className="experience-grid" aria-label="Choose your Rare Rush experience">
              <article className="experience-card"><span className="status-tag">ARCADE / SIMULATED REWARDS</span><h3>The rush. No gas.</h3><p>Play with an owned Genesis or eligible hardwired Generations Friend on Robinhood mainnet. Entry credits, rewards, and the prize pool are simulated in your session. No gameplay transactions or real token payouts.</p><a href="/arcade/">PLAY ARCADE ↗</a></article>
              <article className="experience-card"><span className="status-tag">TESTNET / PLAY → VERIFY → MINT</span><h3>Make your run count.</h3><p>Use faucet NFTs and tokens on Robinhood testnet. Start onchain, survive the timer, verify your replay, then claim tRARERUSH with a wallet transaction. All assets are test-only and have no real value.</p><a href="https://testnet.rarerush.app/">BUILD YOUR TEST KIT ↗</a></article>
            </div>
            <div className="quickstart-grid"><article className="quickstart-card"><b>01</b><h3>Bring your Friend.</h3><p>Choose Arcade or Testnet, connect your wallet on its network, then select Genesis or Generations. Just watching? The home-page preview needs no wallet.</p></article><article className="quickstart-card"><b>02</b><h3>Pick your rush.</h3><p>Easy, Normal, or Degen. More time to explore, or more chaos to conquer. Every run begins on the classic sideways track.</p></article><article className="quickstart-card"><b>03</b><h3>Make it count.</h3><p>Collect coins and chase distance. Survive until the timer reaches zero with at least one heart. Testnet rewards need verification and a claim afterward.</p></article></div>
            <p className="docs-note">Arcade checks ownership of your real Rare Friend. Testnet checks a separate faucet NFT, so you can try it without a mainnet Friend. On a phone, use your wallet’s browser to connect.</p>
            <p className="docs-note">In Arcade, Genesis keeps your original face and picks a random body from 36 compatible Generations bodies for each run, avoiding the previous body. Testnet uses sample artwork. Bodies change the animation, not the collision area, movement rules, or rewards.</p>
          </section>

          <section className="docs-section" id="play" aria-labelledby="play-title"><div className="section-kicker">02 / MOVE, COLLECT, GROW</div><div className="section-heading"><h2 id="play-title">Your thumbs got this.</h2><p>You run automatically. The map can pull you up, drop you down, or send you back the other way. Keep chasing those coins.</p></div>
            <div className="controls-grid"><article className="control-card"><div className="control-visual"><kbd>SPACE</kbd><span>↑ ↑</span></div><h3>Jump. Then jump again.</h3><p>Space, ↑ or W. Press again in the air to double jump. On phone, tap JUMP or the world.</p></article><article className="control-card"><div className="control-visual"><kbd>↓</kbd><span>↓ ▰</span></div><h3>Duck the bridge.</h3><p>Hold ↓ or S to slide. On phone, hold SLIDE. Release to stand up and keep moving.</p></article><article className="control-card"><div className="control-visual"><kbd>←</kbd><kbd>→</kbd></div><h3>Find your pace.</h3><p>Hold the arrow in your running direction to speed up, or the opposite arrow to slow down. In vertical shafts, ← / → steer sideways. Phone controls switch from SLOW / FAST to LEFT / RIGHT.</p></article><article className="control-card"><div className="control-visual"><kbd>P</kbd><span>Ⅱ</span></div><h3>Catch your breath.</h3><p>Press P, Escape, or pause. Switching tabs pauses gameplay too. Arcade’s timer waits. On Testnet, the local timer pauses but the onchain claim deadline keeps counting down.</p></article></div>
            <div className="direction-route" aria-label="The four-direction rare twist"><span className="section-kicker">THE RARE TWIST / ONE CONTINUOUS WORLD</span><h3>Expect the unexpected.</h3><div className="direction-grid"><article><b>→</b><h4>Find your stride.</h4><p>Every run starts moving right on the classic track.</p></article><article><b>↑</b><h4>Get swept up.</h4><p>A ceiling intake pulls you into a fast upward shaft, spinning through coins and obstacles.</p></article><article><b>↓</b><h4>Take the plunge.</h4><p>A break in the floor drops you into free fall. Steer through the chaos.</p></article><article><b>←</b><h4>A rare reversal.</h4><p>Some shaft exits send you running left. It’s an occasional surprise, not a fixed sequence.</p></article></div><p className="docs-note">Routes vary from run to run. Jump and slide return on the sideways track; hold the arrow in the new running direction to go faster.</p></div>
            <GrowthLab/>
            <div className="loot-grid"><article className="loot-card"><svg viewBox="0 0 80 70" width="68" height="60" aria-hidden="true"><CanonicalProp type="crystal" x={16} y={3} width={46} height={60}/></svg><h3>Mind the obstacles.</h3><p>Crystals, crates, and bridges cost a heart on impact. A hit shrinks your Friend and breaks your coin chain.</p></article><article className="loot-card"><span className="loot-letter">S</span><h3>A little protection.</h3><p>Collect an S pickup for a shield. It blocks one hit, protecting your heart, your size, and your chain.</p></article><article className="loot-card"><span className="loot-letter">M</span><h3>Come here, coins.</h3><p>Collect an M pickup for a temporary magnet. Nearby coins come to you. Giant bonus coins included.</p></article></div>
            <div className="bonus-card"><svg viewBox="0 0 180 140" width="180" height="140" role="img" aria-label="Ordinary coin beside a flying bonus coin at twice the size"><TokenCoin x={8} y={70} size={40}/><TokenCoin x={79} y={36} size={80}/><text x={119} y={23} textAnchor="middle" fill="#ccff00" fontFamily="var(--rush-font-display)" fontSize="22">10×</text><path d="M155 51h19m-13 13h19m-18 13h13" stroke="#ccff00" strokeWidth="2"/></svg><div><span className="section-kicker">SPOT IT. CHASE IT. CATCH IT.</span><h3>Bigger coin. Bigger rush.</h3><p>Surprise bonus coins join the rush, sometimes in pairs. They’re <strong>2× the size and carry a 10× coin reward multiplier</strong>. One double jump could change your whole run.</p><small>Each bonus counts as one pickup for growth and chains. Arcade rewards are simulated; Testnet rewards depend on a verified surviving run and remaining gameplay supply.</small></div></div>
          </section>

          <section className="docs-section" id="modes" aria-labelledby="modes-title"><div className="section-kicker">03 / PICK YOUR CHAOS</div><div className="section-heading"><h2 id="modes-title">How hard will you rush?</h2><p>The same time limits and difficulty multipliers apply in Arcade and Testnet. Choose a mode here to explore the Arcade calculator; choose again before your run.</p></div>
            <div className="mode-grid" aria-label="Explore difficulty modes">{DIFFICULTY_ORDER.map(key => <button type="button" key={key} className="mode-card" aria-pressed={difficulty === key} onClick={() => setDifficulty(key)}><span className="mode-label">{DIFFICULTIES[key].label}<span aria-hidden="true">{difficulty === key ? '●' : '○'}</span></span><strong className="mode-time">{DIFFICULTIES[key].seconds}<small>SEC</small></strong><span className="mode-rate">{DIFFICULTIES[key].rewardLabel} COIN REWARDS</span><p>{DIFFICULTIES[key].description}</p></button>)}</div>
            <div className="score-strip"><div><strong>3 ♥</strong><span>HEARTS IN EVERY MODE</span></div><div><strong>×5</strong><span>MAX COIN-CHAIN SCORE</span></div><div><strong>∞</strong><span>REASONS TO TRY AGAIN</span></div></div>
            <p className="docs-note">Distance and coin chains build your score. Chains boost points, not token rewards. A hit or a long gap between coins breaks the chain. Difficulty stays locked during a run.</p>
          </section>

          <section className="docs-section" id="rewards" aria-labelledby="rewards-title"><div className="section-kicker">04 / ARCADE COIN LAB <span className="status-tag">SIMULATED</span></div><div className="section-heading"><h2 id="rewards-title">Early coins. Bigger rewards.</h2><p>Explore Arcade’s simulated economy: rewards start generous, then reduce as more coins are collected. Try either collection, including a Genesis Friend’s 100× boost. Testnet uses its own deployed reward rules.</p></div>
            <RewardLab difficulty={difficulty} onDifficulty={setDifficulty}/>
            <div className="quickstart-grid"><article className="quickstart-card"><b>÷2</b><h3>A smaller slice.</h3><p>The base reward halves every {HALVING_INTERVAL.toLocaleString('en-US')} pickups: 10, then 5, then 2.5… Activity means collected coins, not new wallets or empty runs.</p></article><article className="quickstart-card"><b>×</b><h3>Your mode matters.</h3><p>Apply your difficulty multiplier, 10× for a flying bonus, and 100× for Genesis. Both collections use the same demo reward curve and cap.</p></article><article className="quickstart-card"><b>MAX</b><h3>One shared limit.</h3><p>The demo caps total issuance at {formatToken(TOKEN_CAP)} tokens. When the cap is reached, coin rewards become zero. The score chase continues.</p></article></div>
            <p className="docs-note">This is an Arcade session ledger, not an onchain balance or a mainnet token plan. The simulated counter and balances reset with your session. Higher difficulties, bonus coins, and Genesis rewards can use up its demo supply faster.</p>
          </section>

          <section className="docs-section" id="next" aria-labelledby="next-title"><div className="section-kicker">05 / PLAY TO MINT <span className="status-tag">LIVE ON TESTNET</span></div><div className="section-heading"><h2 id="next-title">Play to mint. Keep it rare.</h2><p>The full loop is live on Robinhood testnet: play, verify, and mint <strong>tRARERUSH</strong>. The current V2 game includes the full directional twist. These are real testnet transactions with valueless test assets.</p></div>
            <div className="token-journey"><article className="journey-step"><span className="step-number">01 / PREPARE</span><h3>Build your test kit.</h3><p>Get test ETH for gas, a test Genesis or Generations NFT, and tRF for paid entries from the <a href="https://testnet.rarerush.app/">Test Kit</a>.</p></article><article className="journey-step"><span className="step-number">02 / PLAY</span><h3>Start onchain.</h3><p>Choose your test Friend and difficulty. Generations approves 110 tRF, then starts the run. Genesis starts free; both use test ETH for gas.</p></article><article className="journey-step"><span className="step-number">03 / VERIFY</span><h3>Survive. Prove it.</h3><p>Finish the timer with a heart left, sign the wallet authorization, and submit your saved replay for verification.</p></article><article className="journey-step"><span className="step-number">04 / MINT</span><h3>Claim your rush.</h3><p>Confirm the claim transaction before its deadline. The contract calculates and mints tRARERUSH from verified pickups, using the reward rules, global activity, and available supply at claim time.</p></article></div>
            <ClaimConcept/>
            <div className="holder-grid"><article className="holder-card"><span className="status-tag">TEST GENESIS / 100×</span><h3>A big rush for the originals.</h3><p>Free entry and <strong>100× gameplay rewards</strong>, with difficulty and flying-coin bonuses. Testnet uses faucet Genesis NFTs with sample artwork; your real Genesis is separate.</p></article><article className="holder-card"><span className="status-tag">TEST GENERATIONS / 1×</span><h3>Every entry contributes.</h3><p>A run costs <strong>110 tRF</strong>: 100 stays in the prize pool and 10 goes to the treasury. Standard rewards stack with difficulty and flying-coin bonuses. Use a faucet Generations NFT.</p></article></div>
            <p className="docs-note">The Genesis boost changes token rewards, not the number of coins, Friend growth, or score. Reward amounts depend on verified gameplay and available supply; the Arcade calculator above is not a Testnet payout estimate.</p>
            <div className="testnet-rules"><h3>Three starts. Make them count.</h3><ul><li><strong>Three starts per NFT per UTC day</strong>, shared across difficulties. Attempts reset at 00:00 UTC. Every confirmed start counts, including a loss or an abandoned run.</li><li><strong>Finish or close your saved run.</strong> Each NFT can have one active onchain run. The app keeps one saved run per browser and account, and asks you to resolve it before starting another. A lost or abandoned run earns no claimable reward. Close it with the onchain transaction, or wait for its claim window to expire. Fees and attempts are not refunded.</li><li><strong>Claim before the deadline.</strong> The window ends one run duration plus 15 minutes after the onchain start. Pausing gameplay does not extend it. Signed claims expire sooner—currently within five minutes of verification. Verify again before the run’s overall deadline if needed.</li><li><strong>Keep your replay.</strong> Testnet saves replay progress in this browser and offers a download. Refreshing can recover saved progress, but cannot restore a missing replay or extend an expired claim window.</li></ul></div>
            <p className="docs-note">If verification is temporarily unavailable, keep your replay and use CHECK AGAIN. Your onchain deadline still applies. The <a href="https://testnet.rarerush.app/dashboard/">Testnet Dashboard</a> shows holdings and your saved run; the Test Kit links to the deployed contracts.</p>
            <div className="pair-card"><div className="pair-art"><div><Coin size={72}/><span>RARERUSH</span></div><b aria-hidden="true">↔</b><div><Coin size={72}/><span>RAREFRIENDS</span></div></div><div><span className="status-tag">FUTURE / MAINNET LIQUIDITY</span><h3>Two tokens. One rare world.</h3><p>A RARERUSH / RAREFRIENDS liquidity pool remains a future goal. It needs separate funding and launch work; there is no live game liquidity pool.</p><small>Testnet fees, multipliers, supply, and launch reserve are provisional settings. They do not commit the mainnet economics or establish a token value.</small></div></div>
            <div className="pool-flow" aria-label="Current Testnet entry split: 110 test RF, 100 to prizes and 10 to treasury"><span>110 tRF ENTRY</span><b aria-hidden="true">→</b><span>100 tRF PRIZES</span><b aria-hidden="true">+</b><span>10 tRF TREASURY</span></div>
            <p className="docs-note">The fee split is live on Testnet. Automatic prize distribution is not. In Arcade, Generations still uses 1 demo RF from 100 starting credits, with 100% sent to a simulated pool; Genesis is free.</p>
            <div className="roadmap-strip"><b>STILL AHEAD</b><p>Final mainnet token rules · funded liquidity · automatic prize distribution · new branching routes and bosses. These remain future work, with no launch date set.</p></div>
          </section>

          <section className="docs-section" id="faq" aria-labelledby="faq-title"><div className="section-kicker">06 / GOOD TO KNOW</div><div className="section-heading"><h2 id="faq-title">A few rare answers.</h2></div><div className="faq-list">
            <details><summary>Am I earning real tokens right now?</summary><p>Arcade rewards are simulated and have no redemption value. Testnet can mint tRARERUSH on Robinhood testnet after you survive, verify, and claim. Those test tokens have no real value. Mainnet RARERUSH and liquidity are still future work.</p></details>
            <details><summary>Do I lose my coins when I hit something?</summary><p>Your Friend shrinks, you lose a heart, and your chain resets. A shield absorbs one hit. Arcade keeps collected demo rewards for the session, even after a loss. Testnet requires you to survive the timer; losing all hearts forfeits that run’s reward.</p></details>
            <details><summary>Does my progress stay when I leave?</summary><p>Arcade keeps its economy in the current session. Reloading or changing Friends resets it; changing difficulty keeps the demo balance and pool. Testnet saves replay progress in the same browser and records confirmed starts and claims onchain. Leaving or pausing never stops the onchain claim deadline.</p></details>
            <details><summary>Can I change difficulty after a run?</summary><p>Yes, between runs. Arcade offers CHANGE DIFFICULTY or RUN IT BACK after a finish. Testnet returns to the run selector after claiming or closing your run. A Testnet start uses a daily attempt regardless of difficulty.</p></details>
            <details><summary>Can I play with only a Genesis?</summary><p>Yes. In Arcade, choose Genesis and connect on Robinhood mainnet with your real NFT. Ownership is checked before entry and each run. On Testnet, mint a separate faucet Genesis from the Test Kit. Both have free entry and a 100× reward multiplier; Testnet transactions still need test ETH for gas.</p></details>
            <details><summary>Can I play on my phone?</summary><p>Yes. Open Arcade or Testnet in your wallet’s browser and connect on the correct network. Use JUMP and SLIDE on sideways tracks, SLOW / FAST for pace, and LEFT / RIGHT to steer in vertical shafts. Anyone can watch the home-page preview without connecting.</p></details>
            <details><summary>Does watching the preview earn anything?</summary><p>No. The random Friend on the landing page is there to show you the world. Watching the preview and using the examples in this guide never earn rewards or spend credits.</p></details>
          </div></section>
        </div>
      </div>
      <section className="docs-endcap"><span className="section-kicker">YOU KNOW THE WORLD. NOW GO RUN IT.</span><h2>Less reading.<br/>More rushing.</h2><p>Your next best run is one jump away.</p><a className="docs-cta" href="/arcade/">LET’S RUSH ↗</a></section>
    </main>
    <footer className="docs-footer"><span>RARE RUSH 101 / BY XIBOT</span><span>ART & WORLD BY <a href="https://rarefriends.com/">RARE FRIENDS ↗</a> · <a href="https://github.com/spokesz/friendsdk">FRIENDSDK ↗</a></span><a href="#top">BACK TO TOP ↑</a></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<Docs/>);

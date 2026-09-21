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
import './docs.css';

const source = cachedArt.friends[0];
const friend = decodeGenerationSprites(BigInt(source.tokenId), source.familyId, source.seed, source.frames.map(BigInt), cachedArt.provenance.manifest as GenerationSpriteManifest);
const chapters = [['start', '01', 'Your first rush'], ['play', '02', 'Move, collect, grow'], ['modes', '03', 'Pick your chaos'], ['rewards', '04', 'Inside the coins'], ['next', '05', 'The next level'], ['faq', '06', 'Good to know']] as const;

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
    <div className="growth-copy"><span className="section-kicker">TRY IT RIGHT HERE</span><h3>Little coins. Big Friend.</h3><p>Each coin makes you a little bigger, up to 1.75×. A hit shrinks you again. Your collected rewards stay yours for the session.</p>
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
    <div className="lab-header"><div><span className="section-kicker">MOVE THE SLIDER. FOLLOW THE REWARD.</span><h3>Your next coin, decoded.</h3></div><div className="lab-mode"><label htmlFor="reward-mode">DIFFICULTY</label><select id="reward-mode" value={difficulty} onChange={event => onDifficulty(event.target.value as Difficulty)}>{DIFFICULTY_ORDER.map(mode => <option value={mode} key={mode}>{DIFFICULTIES[mode].label}</option>)}</select></div></div>
    <div className="holder-preview"><label htmlFor="reward-holder">CHOOSE YOUR FRIEND</label><select id="reward-holder" value={genesis ? 'genesis' : 'generations'} onChange={event => setGenesis(event.target.value === 'genesis')}><option value="generations">Generations · 1× (demo)</option><option value="genesis">Genesis · 100× (demo)</option></select><p role="status">{genesis ? 'GENESIS DEMO: free entry and 100× tokens per coin in the Genesis arcade.' : 'GENERATIONS DEMO: standard rewards and 1 demo RF per run.'}</p></div>
    <div className="activity-control"><label htmlFor="activity">Example pickups before your next coin <output htmlFor="activity">{pickups.toLocaleString('en-US')}</output></label><input id="activity" type="range" min="0" max="4" step="1" value={epoch} aria-valuetext={`${pickups.toLocaleString('en-US')} example pickups`} onChange={event => setEpoch(Number(event.target.value))}/><div><span>LAUNCH</span><span>40,000 PICKUPS</span></div></div>
    <div className="emission-chart" aria-label="Normal base rewards halve every ten thousand pickups: ten, five, two point five, one point two five, zero point six two five.">{[10, 5, 2.5, 1.25, .625].map((rate, index) => <div className={epoch === index ? 'selected' : ''} key={rate}><b>{rate}</b><div className="emission-bar" style={{ height: `${Math.max(10, rate * 8)}px` }}/><span>{index === 0 ? 'START' : `${index * 10}K`}</span></div>)}</div>
    <div className="reward-results" aria-live="polite"><div className="reward-result"><Coin/><div><span>ORDINARY COIN</span><strong data-reward="ordinary">{reward(1)}</strong><span>demo tokens / coin</span></div></div><div className="reward-result"><Coin size={82}/><div><span>FLYING BONUS · 10×</span><strong data-reward="bonus">{reward(10)}</strong><span>demo tokens / coin</span></div></div></div>
    <p className="lab-caption">Both collections use the current demo rules, including the Genesis 100× boost. These examples imagine earlier ordinary coins collected on Normal by Generations. This is not a live player counter, wallet balance, or token-price chart.</p>
  </div>;
}

function Docs() {
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  return <div className="rush-docs" id="top">
    <a className="docs-skip" href="#start">Skip to the guide</a>
    <header className="docs-header"><a className="docs-logo" href="/" aria-label="Rare Rush by Xibot home"><BrandMark/></a><nav aria-label="Main navigation"><a href="/">HOME</a><a href="/pitch/">PITCH</a><a className="docs-cta" href="/arcade/">ENTER ARCADE ↗</a></nav></header>
    <main>
      <section className="docs-hero" aria-labelledby="docs-title"><div><div className="docs-eyebrow">THE PLAYER’S FIELD GUIDE</div><h1 id="docs-title">RARE RUSH<span>101.</span></h1><p>Small Friend. Big adventure. Everything you need to jump in, get bigger, and make your next run a little rarer.</p><span className="docs-badge">PLAYABLE NOW · TOKEN ECONOMY IN DEMO</span></div><Cover/></section>
      <div className="docs-layout">
        <nav className="docs-nav" aria-label="Guide chapters"><span>CHOOSE A CHAPTER</span>{chapters.map(([id, number, title]) => <a key={id} href={`#${id}`}><b>{number}</b>{title}<span aria-hidden="true">↗</span></a>)}</nav>
        <div className="docs-content">
          <section className="docs-section" id="start" aria-labelledby="start-title"><div className="section-kicker">01 / YOUR FIRST RUSH</div><div className="section-heading"><h2 id="start-title">Ready. Set. Rare.</h2><p>An endless world. A very finite timer. Grab coins, dodge trouble, and see how far your Friend can go.</p></div>
            <div className="quickstart-grid"><article className="quickstart-card"><b>01</b><h3>Bring your Friend.</h3><p>Choose Genesis or Generations, connect your wallet, and pick your Rare Friend. Just watching? The home-page preview needs no wallet.</p></article><article className="quickstart-card"><b>02</b><h3>Pick your rush.</h3><p>Easy, Normal, or Degen. More time to explore, or more chaos to conquer. Each mode keeps its own best score.</p></article><article className="quickstart-card"><b>03</b><h3>Make it count.</h3><p>Collect coins and chase distance until time runs out or you lose three hearts. Then run it back or change difficulty.</p></article></div>
            <p className="docs-note">Bring an owned Genesis NFT, or a hardwired Generations Friend (generation 1+), on Robinhood mainnet. Genesis uses a separate verified tester entry; the FriendSDK vibeathon route remains Generations. On a phone, use your wallet’s browser to connect.</p>
            <p className="docs-note">Genesis keeps your original face and picks a random body from 36 compatible Generations bodies at the start of each run, avoiding the previous body. Your look stays fixed until the next run. Bodies change the animation, not the collision area, movement rules, or rewards.</p>
          </section>

          <section className="docs-section" id="play" aria-labelledby="play-title"><div className="section-kicker">02 / MOVE, COLLECT, GROW</div><div className="section-heading"><h2 id="play-title">Your thumbs got this.</h2><p>You run automatically. You decide when to jump, duck, and chase that one impossible-looking coin.</p></div>
            <div className="controls-grid"><article className="control-card"><div className="control-visual"><kbd>SPACE</kbd><span>↑ ↑</span></div><h3>Jump. Then jump again.</h3><p>Space, ↑ or W. Press again in the air to double jump. On phone, tap JUMP or the world.</p></article><article className="control-card"><div className="control-visual"><kbd>↓</kbd><span>↓ ▰</span></div><h3>Duck the bridge.</h3><p>Hold ↓ or S to slide. On phone, hold SLIDE. Release to stand up and keep moving.</p></article><article className="control-card"><div className="control-visual"><kbd>←</kbd><kbd>→</kbd></div><h3>Find your pace.</h3><p>Hold → to speed up, or ← to slow down. Phone: FAST / SLOW. Release to cruise again.</p></article><article className="control-card"><div className="control-visual"><kbd>P</kbd><span>Ⅱ</span></div><h3>Catch your breath.</h3><p>Press P, Escape, or the pause button. Switching tabs pauses the run too. The timer waits for you.</p></article></div>
            <GrowthLab/>
            <div className="loot-grid"><article className="loot-card"><svg viewBox="0 0 80 70" width="68" height="60" aria-hidden="true"><CanonicalProp type="crystal" x={16} y={3} width={46} height={60}/></svg><h3>Mind the obstacles.</h3><p>Crystals, crates, and bridges cost a heart on impact. A hit shrinks your Friend and breaks your coin chain.</p></article><article className="loot-card"><span className="loot-letter">S</span><h3>A little protection.</h3><p>Collect an S pickup for a shield. It blocks one hit, protecting your heart, your size, and your chain.</p></article><article className="loot-card"><span className="loot-letter">M</span><h3>Come here, coins.</h3><p>Collect an M pickup for a temporary magnet. Nearby coins come to you. Giant bonus coins included.</p></article></div>
            <div className="bonus-card"><svg viewBox="0 0 180 140" width="180" height="140" role="img" aria-label="Ordinary coin beside a flying bonus coin at twice the size"><TokenCoin x={8} y={70} size={40}/><TokenCoin x={79} y={36} size={80}/><text x={119} y={23} textAnchor="middle" fill="#ccff00" fontFamily="var(--rush-font-display)" fontSize="22">10×</text><path d="M155 51h19m-13 13h19m-18 13h13" stroke="#ccff00" strokeWidth="2"/></svg><div><span className="section-kicker">SPOT IT. CHASE IT. CATCH IT.</span><h3>Bigger coin. Bigger rush.</h3><p>Surprise coins fly in from the right, sometimes in pairs. They’re <strong>2× the size and worth 10× the current token reward</strong>. One double jump could change your whole run.</p><small>Each bonus counts as one pickup for growth and chains. Rewards stay within the remaining demo supply.</small></div></div>
          </section>

          <section className="docs-section" id="modes" aria-labelledby="modes-title"><div className="section-kicker">03 / PICK YOUR CHAOS</div><div className="section-heading"><h2 id="modes-title">How hard will you rush?</h2><p>Choose a mode to explore its rewards below. Your choice here is a preview; you pick again when entering the arcade.</p></div>
            <div className="mode-grid" aria-label="Explore difficulty modes">{DIFFICULTY_ORDER.map(key => <button type="button" key={key} className="mode-card" aria-pressed={difficulty === key} onClick={() => setDifficulty(key)}><span className="mode-label">{DIFFICULTIES[key].label}<span aria-hidden="true">{difficulty === key ? '●' : '○'}</span></span><strong className="mode-time">{DIFFICULTIES[key].seconds}<small>SEC</small></strong><span className="mode-rate">{DIFFICULTIES[key].rewardLabel} COIN REWARDS</span><p>{DIFFICULTIES[key].description}</p></button>)}</div>
            <div className="score-strip"><div><strong>3 ♥</strong><span>HEARTS IN EVERY MODE</span></div><div><strong>×5</strong><span>MAX COIN-CHAIN SCORE</span></div><div><strong>∞</strong><span>REASONS TO TRY AGAIN</span></div></div>
            <p className="docs-note">Distance and coin chains build your arcade score. Chains boost points, not token rewards. A hit or a long gap between coins breaks the chain. Difficulty stays locked during a run.</p>
          </section>

          <section className="docs-section" id="rewards" aria-labelledby="rewards-title"><div className="section-kicker">04 / INSIDE THE COINS <span className="status-tag">PLAYABLE DEMO</span></div><div className="section-heading"><h2 id="rewards-title">Early coins. Bigger rewards.</h2><p>The idea is simple: start generous, then reduce rewards as more coins are collected. Try the demo curve for either collection, including a Genesis Friend’s 100× boost.</p></div>
            <RewardLab difficulty={difficulty} onDifficulty={setDifficulty}/>
            <div className="quickstart-grid"><article className="quickstart-card"><b>÷2</b><h3>A smaller slice.</h3><p>The base reward halves every {HALVING_INTERVAL.toLocaleString('en-US')} pickups: 10, then 5, then 2.5… Activity means collected coins, not new wallets or empty runs.</p></article><article className="quickstart-card"><b>×</b><h3>Your mode matters.</h3><p>Apply your difficulty multiplier, 10× for a flying bonus, and 100× for Genesis. Both collections use the same demo reward curve and cap.</p></article><article className="quickstart-card"><b>MAX</b><h3>One shared limit.</h3><p>The demo caps total issuance at {formatToken(TOKEN_CAP)} tokens. When the cap is reached, coin rewards become zero. The score chase continues.</p></article></div>
            <p className="docs-note">These are adjustable playtest values. Today’s counter and balances live only in your session. Higher difficulties, bonus coins, and Genesis rewards can use up the supply faster; a reward curve alone does not guarantee economic balance.</p>
          </section>

          <section className="docs-section" id="next" aria-labelledby="next-title"><div className="section-kicker">05 / THE NEXT LEVEL <span className="status-tag">PLANNED</span></div><div className="section-heading"><h2 id="next-title">Play to mint. Keep it rare.</h2><p>The vision: your verified coin collections earn newly minted <strong>RARERUSH</strong>. Think of it as mining through gameplay: your skill does the collecting, with no mining hardware needed.</p></div>
            <div className="token-journey"><article className="journey-step"><span className="step-number">01 / PLAY</span><h3>Go on a run.</h3><p>Bring your Friend, choose a difficulty, and enter the world.</p></article><article className="journey-step"><span className="step-number">02 / COLLECT</span><h3>Catch the coins.</h3><p>Every accepted pickup contributes to your run’s reward.</p></article><article className="journey-step"><span className="step-number">03 / VERIFY</span><h3>Make it fair.</h3><p>The run is checked before any real reward is authorized.</p></article><article className="journey-step"><span className="step-number">04 / MINT</span><h3>Claim your rush.</h3><p>Verified rewards become RARERUSH in your wallet.</p></article></div>
            <p className="docs-note">This is the planned flow. The current arcade shows <strong>DEMO $RUSH</strong>: a simulated version of the proposed RARERUSH reward. It does not mint or transfer real tokens.</p>
            <div className="pair-card"><div className="pair-art"><div><Coin size={72}/><span>RARERUSH</span></div><b aria-hidden="true">↔</b><div><Coin size={72}/><span>RAREFRIENDS</span></div></div><div><span className="status-tag">PLANNED PAIR</span><h3>Two tokens. One rare world.</h3><p>We want a RARERUSH / RAREFRIENDS liquidity pool so the reward token can be exchanged with RAREFRIENDS. The pool would need to be funded and launched separately.</p><small>No token contract or pair is live for this game. A pair would not mean a fixed exchange rate or guaranteed value.</small></div></div>
            <div className="holder-grid"><article className="holder-card"><span className="status-tag">PLAYABLE DEMO · 100×</span><h3>Genesis brings the big rush.</h3><p>Free entry and <strong>100× demo tokens per coin</strong> for the original Friends. The boost stacks with your difficulty and flying bonus coins, within the shared supply cap.</p><p>At the launch rate on Normal: 1,000 demo tokens per ordinary coin, or 10,000 per flying bonus. Play with your original Genesis artwork after a fresh wallet ownership check. No Generations NFT is needed.</p></article><article className="holder-card"><span className="status-tag">PLAYABLE DEMO · 1×</span><h3>Generations fuels the pool.</h3><p>Standard demo rewards, plus your difficulty and bonus multipliers. Each run moves 1 demo RF into the demo prize pool. A real RAREFRIENDS entry fee and later prize payouts are planned; the final rules are still to be decided.</p></article></div>
            <p className="docs-note">The Genesis boost multiplies token rewards, not the number of coins on screen, Friend growth, or arcade score. At 100×, the supply can be used up much faster, so the final cap and reward schedule need playtesting together.</p>
            <div className="pool-flow" aria-label="Proposed flow: entry fees fund a prize pool, then later rewards"><span>ENTRY FEES</span><b aria-hidden="true">→</b><span>PRIZE POOL</span><b aria-hidden="true">→</b><span>LATER REWARDS</span></div>
            <p className="docs-note">Try the idea today: Generations runs use 1 demo RF from 100 starting credits, and 100% goes to the demo pool. Genesis runs are free. No wallet funds are charged. Prize payouts are not implemented.</p>
            <div className="roadmap-strip"><b>NEXT UP</b><p>Verified run rewards · final token rules · funded liquidity · prize distribution. These are design goals, with no launch date set.</p></div>
          </section>

          <section className="docs-section" id="faq" aria-labelledby="faq-title"><div className="section-kicker">06 / GOOD TO KNOW</div><div className="section-heading"><h2 id="faq-title">A few rare answers.</h2></div><div className="faq-list">
            <details><summary>Am I earning real tokens right now?</summary><p>No. All token rewards, RF entry fees, and prize-pool amounts are simulated. Demo rewards have no redemption value. RARERUSH minting and its RAREFRIENDS pair are planned.</p></details>
            <details><summary>Do I lose my coins when I hit something?</summary><p>Your Friend shrinks, you lose a heart, and your chain resets. Rewards you already collected stay in the demo session, even if the run ends. A shield absorbs one hit.</p></details>
            <details><summary>Does my progress stay when I leave?</summary><p>This build keeps progress for the current session. Reloading or changing Friends resets it. Changing difficulty keeps your demo balance and pool; choosing a new Token Lab scenario resets the demo ledger.</p></details>
            <details><summary>Can I change difficulty after a run?</summary><p>Yes. Choose CHANGE DIFFICULTY on the results screen to go back to the selector. RUN IT BACK starts again in the same mode. Generations pays a demo entry fee only when a run starts. Genesis enters free.</p></details>
            <details><summary>Can I play with only a Genesis?</summary><p>Yes. Choose Genesis from the arcade menu, connect on Robinhood Chain, and select your NFT. Your ownership is checked before entry and before each run. Genesis uses its original portrait, free entry, and 100× demo token rewards. The separate FriendSDK vibeathon route remains for Generations.</p></details>
            <details><summary>Can I play on my phone?</summary><p>Yes. Use your wallet’s in-app browser with an owned Genesis or eligible hardwired Generations NFT on Robinhood Chain. Once in the arcade, use JUMP, SLIDE, SLOW, and FAST. Anyone can watch the home-page preview without connecting.</p></details>
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

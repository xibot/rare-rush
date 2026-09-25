import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { WorldArt } from '../../generated/games/rare-rush/WorldArt.tsx';
import { EntityArt, FriendSprite } from '../../generated/games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../../generated/games/rare-rush/genesis/GenesisRunnerSprite.tsx';
import { TokenCoin } from '../../generated/games/rare-rush/CanonicalArt.tsx';
import { difficultySettings } from '../../generated/games/rare-rush/difficulty.ts';
import { createRecorder, snapshotRun, type DifficultyId, type RunSnapshot } from './recorder.ts';
import { testRunArt } from './art.ts';
import './arcade.css';

export type ArcadeCabinetProps = {
  difficulty: DifficultyId;
  collection: 0 | 1;
  tokenId: string | bigint;
  runId?: string | bigint;
  snapshot?: RunSnapshot;
  world?: ReactNode;
  fieldOverlays?: ReactNode;
  children?: ReactNode;
  topActions?: ReactNode;
  touchControls?: ReactNode;
  onHome?: () => void;
};

/** The same visual cabinet as the public arcade, with testnet state supplied by its host. */
export function ArcadeCabinet(props: ArcadeCabinetProps) {
  const cabinet = useRef<HTMLElement>(null);
  const [viewWidth, setViewWidth] = useState(960);
  const [showHelp, setShowHelp] = useState(false);
  const initial = useMemo(() => snapshotRun(createRecorder(`0x${'0'.repeat(64)}`, props.difficulty)), [props.difficulty]);
  const run = props.snapshot ?? initial;
  const mode = difficultySettings(props.difficulty);
  const art = useMemo(() => testRunArt(props.collection, props.tokenId, props.runId ?? 'chooser'), [props.collection, props.tokenId, props.runId]);
  const remaining = Math.max(0, Math.ceil(run.duration - run.elapsed));
  const vertical = run.phase !== 'side';
  const biome = Math.min(2, Math.floor(run.elapsed / run.duration * 3));
  const friend = props.collection === 1
    ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId}/>
    : <FriendSprite sprites={art.sprites} frame={0}/>;

  useEffect(() => {
    const element = cabinet.current;
    if (!element) return;
    const resize = () => setViewWidth(element.clientWidth <= 600 ? 520 : 960);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <div className="testnet-arcade-shell">
    <section ref={cabinet} className="testnet-arcade" data-screen={props.snapshot ? props.snapshot.status === 'finished' ? 'result' : 'running' : 'ready'} data-difficulty={props.difficulty} data-phase={run.phase} aria-label="Rare Rush testnet arcade">
      <div className="arcade-top">
        <a className="arcade-logo" href="/" aria-label="Rare Rush home" onClick={event => { if (props.onHome) { event.preventDefault(); props.onHome(); } }}>
          <svg className="brand-icon" viewBox="0 0 30 30" aria-hidden="true"><TokenCoin size={30}/></svg>
          <span className="brand-name">RARE<span>RUSH</span></span>
        </a>
        <div className="top-actions"><span className="preview-tag">TESTNET</span>{props.topActions ?? <button type="button" aria-label="How to play" onClick={() => setShowHelp(true)}>?</button>}</div>
      </div>
      <div className="hud rush-run-hud">
        <div><span>{mode.label.toUpperCase()} · TIME</span><strong className={remaining < 15 ? 'urgent' : ''}>{String(Math.floor(remaining / 60)).padStart(2, '0')}<em>:</em>{String(remaining % 60).padStart(2, '0')}</strong></div>
        <div><span>DISTANCE</span><strong>{Math.floor(run.distance).toString().padStart(4, '0')}<small>m</small></strong></div>
        <div className="token-hud"><span>COINS COLLECTED</span><strong>{run.coins}<small>✦</small></strong></div>
        <div className="life-hud"><span>KEEP IT RARE</span><strong aria-label={`${run.hearts} hearts remaining`}>{[0, 1, 2].map(index => <b key={index} className={index >= run.hearts ? 'lost' : ''}>♥</b>)}</strong></div>
      </div>
      <div className="playfield">
        {props.world ?? <svg className="world-svg" viewBox={`0 0 ${viewWidth} 500`} preserveAspectRatio="xMidYMid meet" role="img" aria-label={`${art.label} in the Rare Friends world`}>
          <WorldArt distance={run.distance} elapsed={run.elapsed * 1000} reducedMotion biome={biome}/>
          {!props.snapshot && <g>{[0, 1, 2, 3, 4].map(index => <TokenCoin key={index} x={370 + index * 52} y={295 - Math.sin(index / 4 * Math.PI) * 65} size={30}/>)}<EntityArt entity={{id:999,kind:'crystal',x:730,y:339,w:44,h:61} as RunSnapshot['entities'][number]} elapsed={0} reduced/></g>}
          {run.entities.map(entity => <EntityArt key={entity.id} entity={entity} elapsed={run.elapsed} reduced/>)}
          <g transform={`translate(${props.snapshot ? 0 : viewWidth === 960 ? 265 : 200} 0)`}>
            <ellipse cx={run.player.x + run.player.w / 2} cy="403" rx={32} ry="3" fill="#000"/>
            <g transform={`translate(${run.player.x + run.player.w / 2 - 32} ${run.player.y - 60}) scale(4)`}>{friend}</g>
          </g>
        </svg>}
        <div className="zone-label"><span>{vertical ? run.phase === 'up' ? '↑' : '↓' : `0${biome + 1}`}</span>{vertical ? run.phase === 'up' ? 'SUCTION SHAFT' : 'FREE FALL' : ['GARDEN COMMONS', 'CIRCUIT COURTYARD', 'CRYSTAL MESA'][biome]}<span className="zone-line"/></div>
        {props.fieldOverlays}
      </div>
      {props.children}
      <div className="arcade-bottom">
        <div className="keyboard-controls">{vertical ? <><span><kbd>{run.phase === 'up' ? '↑' : '↓'}</kbd> AUTO {run.phase === 'up' ? 'LIFT' : 'FALL'}</span><span><kbd>←</kbd><kbd>→</kbd> HOLD TO STEER</span></> : <><span><kbd>SPACE</kbd> JUMP <small>×2 DOUBLE</small></span><span><kbd>↓</kbd> SLIDE</span><span><kbd>←</kbd><kbd>→</kbd> HOLD FOR PACE</span></>}</div>
        <div className="touch-controls rush-run-touch" aria-label="Touch controls">{props.touchControls ?? <><button type="button" className="touch-pace" disabled>←<span>SLOW</span></button><button type="button" disabled>↓<span>SLIDE</span></button><button type="button" className="touch-jump" disabled>↑<span>JUMP ×2</span></button><button type="button" className="touch-pace" disabled>→<span>FAST</span></button></>}</div>
        <div className="economy-bar"><span><b>{props.collection === 1 ? '100×' : '1×'}</b> {props.collection === 1 ? 'GENESIS' : 'GENERATIONS'} · {mode.rewardLabel} MODE</span><a href="/dashboard/">DASHBOARD <span>↗</span></a></div>
      </div>
      <div className="arcade-toolbar"><span>Robinhood testnet</span><span>{props.collection === 1 ? 'Genesis' : 'Friend'} #{props.tokenId.toString()}</span>{props.runId != null && <span>Run #{props.runId.toString()}</span>}<a href="/dashboard/">Friend wallet</a></div>
      {showHelp && <div className="game-overlay arcade-help" role="dialog" aria-label="How to rush"><div className="pause-card"><span className="eyebrow">HOW TO RUSH</span><h2>KEEP IT RARE.</h2><p>Space or ↑ jumps. Tap again to double jump. Hold ↓ to slide. Hold the arrow in your running direction to speed up, or the opposite arrow to slow down.</p><p>Ceiling intakes lift you automatically; floor gaps drop you into free fall. Hold ← / → (LEFT / RIGHT on phone) to steer through shafts while your Friend spins. Some exits send you running left. Jump and slide return on the sideways track.</p><p>Coins make your Friend grow. Hits cost a heart and shrink it. Catch the giant coins for 10× coin rewards.</p><p>Survive the timer to verify your run and mint test tokens. Three starts per NFT daily.</p><button type="button" className="primary" onClick={() => setShowHelp(false)}>GOT IT <span>↗</span></button></div></div>}
    </section>
  </div>;
}

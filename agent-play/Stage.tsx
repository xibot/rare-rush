import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { TokenCoin } from '../games/rare-rush/CanonicalArt.tsx';
import { FriendSprite } from '../games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../games/rare-rush/genesis/GenesisRunnerSprite.tsx';
import { DirectionScene } from '../games/rare-rush/twist/DirectionScene.tsx';
import { headingFor } from '../games/rare-rush/twist/presentation.ts';
import type { RunState } from '../games/rare-rush/twist/engine.ts';
import { testRunArt } from '../testnet-app/src/play/art.ts';
import type { ArcadeFriend } from './arcade.ts';
import type { PublicRunActor } from '../shared/replay-publication.ts';
import { runningLabel } from './run-actor.ts';
import './stage.css';

export type AgentStageProps = {
  run: RunState;
  collection: 0 | 1;
  tokenId: string;
  running: boolean;
  actor?: PublicRunActor;
  reducedMotion: boolean;
  label?: string;
  /** Saved Arcade artwork or the cosmetic art for this Testnet run. */
  art?: Pick<ArcadeFriend, 'sprites' | 'bodyId' | 'portraitUrl' | 'label'>;
  fieldOverlay?: ReactNode;
};

const ZONES = ['GARDEN COMMONS', 'CIRCUIT COURTYARD', 'CRYSTAL MESA'];

/** Watch-only presentation. The host owns time, inputs, replay, and run controls. */
export function AgentStage({ run, collection, tokenId, running, actor, reducedMotion, label = 'LOCAL', art: realArt, fieldOverlay }: AgentStageProps) {
  const shell = useRef<HTMLElement>(null);
  const [viewportWidth, setViewportWidth] = useState(960);
  const testArt = useMemo(() => testRunArt(collection, tokenId, 'agent-play'), [collection, tokenId]);
  const art = realArt ?? testArt;
  const remaining = Math.max(0, Math.ceil(run.duration - run.elapsed));
  const biome = Math.min(2, Math.floor(run.elapsed / run.duration * 3));
  const vertical = run.phase !== 'side';
  const heading = headingFor(run);
  const leftward = !vertical && heading === -1;
  const direction = vertical ? run.phase === 'up' ? '↑' : '↓' : leftward ? '←' : '→';
  const headingLabel = vertical ? run.phase === 'up' ? 'AUTO LIFT' : 'FREE FALL' : leftward ? 'RUNNING LEFT' : 'RUNNING RIGHT';
  const screenAxis = run.phase === 'side' ? run.pace * heading : run.pace;
  const active = running && run.status === 'running';
  const jumping = !vertical && !run.player.grounded && !run.transition;
  const status = run.status === 'finished'
    ? run.finishReason === 'time' ? 'TIMER SURVIVED' : 'OUT OF HEARTS'
    : active ? runningLabel(actor) : run.elapsed > 0 ? 'PAUSED' : 'READY TO RUN';
  const friendLabel = realArt?.label ?? `${collection === 1 ? 'GENESIS' : 'GENERATIONS'} #${tokenId}`;

  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const resize = () => setViewportWidth(element.clientWidth <= 600 ? 520 : 960);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return <section
    ref={shell}
    className="agent-stage"
    aria-label="Watch the Rare Rush run"
    data-phase={run.phase}
    data-heading={vertical ? run.phase : leftward ? 'left' : 'right'}
    data-running={active}
    data-status={run.status}
    data-tick={run._tick}
  >
    <header className="agent-stage-top">
      <div className="agent-stage-brand" aria-label="Rare Rush">
        <svg viewBox="0 0 30 30" aria-hidden="true"><TokenCoin size={30}/></svg>
        <span>RARE<span>RUSH</span></span>
      </div>
      <div className="agent-stage-tags"><span>AGENT PLAY</span><b>{label}</b></div>
    </header>

    <div className="agent-stage-hud" aria-label="Run statistics">
      <div>
        <span>{run.difficulty.toUpperCase()} · TIME</span>
        <strong data-urgent={remaining < 15}>{String(Math.floor(remaining / 60)).padStart(2, '0')}<em>:</em>{String(remaining % 60).padStart(2, '0')}</strong>
      </div>
      <div><span>DISTANCE</span><strong>{Math.floor(run.distance).toString().padStart(4, '0')}<small>m</small></strong></div>
      <div className="agent-stage-coins"><span>COINS</span><strong>{run.coins}<small>✦</small></strong></div>
      <div className="agent-stage-hearts"><span>HEARTS</span><strong aria-label={`${run.hearts} of 3 hearts remaining`}>{[0, 1, 2].map(index => <b key={index} data-lost={index >= run.hearts} aria-hidden="true">♥</b>)}</strong></div>
    </div>

    <div className="agent-stage-field" style={{ '--agent-world-ratio': `${viewportWidth} / 500` } as CSSProperties}>
      <svg className="agent-stage-world" viewBox={`0 0 ${viewportWidth} 500`} role="img" aria-label={`${friendLabel}${realArt ? '' : ', cosmetic test artwork'}. ${headingLabel.toLowerCase()}.`}>
        <DirectionScene
          run={run}
          running={active}
          reducedMotion={reducedMotion}
          biome={biome}
          growth={run.growth}
          viewportWidth={viewportWidth}
          renderCharacter={(frame, walking) => collection === 1
            ? art.portraitUrl && <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId} frame={frame} walking={walking && !reducedMotion}/>
            : art.sprites && <FriendSprite sprites={art.sprites} frame={frame} walking={walking && !reducedMotion}/>}
        />
      </svg>
      <div className="agent-stage-zone"><b>{vertical ? direction : `0${biome + 1}`}</b><span>{vertical ? run.phase === 'up' ? 'SUCTION SHAFT' : 'FREE FALL' : ZONES[biome]}</span></div>
      <div className="agent-stage-score"><span>SCORE</span><strong>{run.score.toLocaleString()}</strong><small>CHAIN <b>×{run.combo}</b></small></div>
      <div className="agent-stage-modifiers"><span>SIZE <b>{run.growth.toFixed(2)}×</b></span><span>{vertical ? 'STEER' : 'PACE'} <b>{vertical ? screenAxis < 0 ? '←' : screenAxis > 0 ? '→' : '—' : `${run.speedMultiplier.toFixed(2)}×`}</b></span></div>
      <div className="agent-stage-state" data-active={active}><i aria-hidden="true"/>{status}</div>
      <div className="agent-stage-progress" role="progressbar" aria-label="Run elapsed" aria-valuemin={0} aria-valuemax={run.duration} aria-valuenow={Math.min(run.duration, Math.floor(run.elapsed))}><i style={{ width: `${Math.min(100, Math.max(0, run.elapsed / run.duration * 100))}%` }}/></div>
      {fieldOverlay}
    </div>

    <div className="agent-stage-direction">
      <div className="agent-stage-heading"><b aria-hidden="true">{direction}</b><span>{run.transition ? 'CHANGING DIRECTION' : headingLabel}</span></div>
      <div className="agent-stage-inputs" aria-label="Player movement">
        <span className="agent-stage-input-label">INPUT</span>
        {vertical ? <>
          <span data-pressed={active && screenAxis < 0}><kbd>←</kbd>LEFT</span>
          <span data-pressed={active && screenAxis > 0}><kbd>→</kbd>RIGHT</span>
        </> : <>
          <span data-pressed={active && jumping}><kbd>↑</kbd>JUMP{run.player.jumps > 1 ? ' ×2' : ''}</span>
          <span data-pressed={active && run.player.slide}><kbd>↓</kbd>SLIDE</span>
          <span data-pressed={active && run.pace !== 0}><kbd>{screenAxis < 0 ? '←' : screenAxis > 0 ? '→' : '↔'}</kbd>{run.pace < 0 ? 'SLOW' : run.pace > 0 ? 'FAST' : 'PACE'}</span>
        </>}
      </div>
    </div>
    <footer className="agent-stage-caption"><span>{friendLabel}</span><span>{realArt ? 'ONCHAIN ART' : 'COSMETIC TEST ART'}</span></footer>
  </section>;
}

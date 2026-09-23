import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Hex } from 'viem';
import { WorldArt } from '../../generated/games/rare-rush/WorldArt.tsx';
import { EntityArt, FriendSprite } from '../../generated/games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../../generated/games/rare-rush/genesis/GenesisRunnerSprite.tsx';
import { difficultySettings } from '../../generated/games/rare-rush/difficulty.ts';
import { FIXED_STEP, type Pace } from '../../generated/games/rare-rush/twist/engine.ts';
import { DirectionScene } from '../../generated/games/rare-rush/twist/DirectionScene.tsx';
import { advanceRecorder, createRecorder, exportReplay, queueControls, releaseControls, snapshotRun,
  type DifficultyId, type Replay, type RunSnapshot } from './recorder.ts';
import { testRunArt } from './art.ts';
import { ArcadeCabinet } from './ArcadeCabinet.tsx';

export type RunCanvasProps = {
  seed: Hex;
  difficulty: DifficultyId;
  collection: 0 | 1;
  tokenId: string | bigint;
  runId: string | bigint;
  initialReplay?: Replay;
  completedTicks?: number;
  onHome?: () => void;
  onProgress: (replay: Replay, snapshot: RunSnapshot) => void;
  onFinish: (replay: Replay, snapshot: RunSnapshot) => void;
};

/** A new confirmed run creates a new session; callback rerenders never reset an active recording. */
export function RunCanvas(props: RunCanvasProps) {
  return <RunSession key={`${props.runId}:${props.seed}:${props.difficulty}`} {...props}/>;
}

export function TestFriendAvatar({ collection, tokenId }: { collection: 0 | 1; tokenId: string | bigint }) {
  const art = testRunArt(collection, tokenId, 'chooser');
  return <svg viewBox="-3 -3 22 22" width="128" height="128" role="img" aria-label={`${art.label}, cosmetic test artwork`}>
    {collection === 1 ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId}/> : <FriendSprite sprites={art.sprites} frame={0}/>}
  </svg>;
}

function RunSession(props: RunCanvasProps) {
  const [recording] = useState(() => createRecorder(props.seed, props.difficulty, props.initialReplay, props.completedTicks));
  const [art] = useState(() => testRunArt(props.collection, props.tokenId, props.runId));
  const [run, setRun] = useState(() => snapshotRun(recording));
  const [paused, setPaused] = useState(true);
  const [hasStarted, setHasStarted] = useState(recording.run._tick > 0);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [viewWidth, setViewWidth] = useState(960);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');
  const stage = useRef<SVGSVGElement>(null);
  const shell = useRef<HTMLElement>(null);
  const pausedRef = useRef(true);
  const callbacks = useRef(props);
  callbacks.current = props;
  const finished = useRef(false);
  const lastCheckpoint = useRef(recording.run._tick);
  const pressed = useRef(new Set<string>());
  const noticeExpires = useRef(0);
  const mode = difficultySettings(props.difficulty);
  const isFinished = run.status === 'finished';

  function checkpoint(final = false) {
    const replay = exportReplay(recording);
    const snapshot = snapshotRun(recording);
    callbacks.current.onProgress(replay, snapshot);
    lastCheckpoint.current = snapshot.completedTicks;
    if (final && !finished.current) {
      callbacks.current.onFinish(replay, snapshot);
      finished.current = true;
    }
  }
  function persistSafely(final = false) {
    try { checkpoint(final); setSaveError(''); return true; }
    catch {
      pausedRef.current = true;
      setPaused(true);
      setSaveError(recording.run.status === 'finished'
        ? 'This browser could not save your completed run. Free some storage, then retry below. Keep this tab open.'
        : 'This browser could not save your run. Free some storage, then resume. Keep this tab open.');
      return false;
    }
  }
  function clearInput() {
    pressed.current.clear();
    releaseControls(recording);
  }
  function pause() {
    if (recording.run.status !== 'running') return;
    pausedRef.current = true;
    clearInput();
    setPaused(true);
    persistSafely();
  }
  function resume() {
    if (recording.run.status !== 'running' || document.hidden) return;
    clearInput();
    setSaveError('');
    if (!persistSafely()) return;
    pausedRef.current = false;
    setHasStarted(true);
    setPaused(false);
    stage.current?.focus({ preventScroll: true });
  }
  function pressJump() {
    if (pausedRef.current || recording.run.status !== 'running' || recording.run.phase !== 'side' || recording.run.transition) return;
    queueControls(recording, { jump: true });
  }
  function heldInput(key: string, down: boolean) {
    if (pausedRef.current || recording.run.status !== 'running') return;
    if (down) pressed.current.add(key); else pressed.current.delete(key);
    const keys = pressed.current;
    const slow = keys.has('ArrowLeft') || keys.has('KeyA') || keys.has('touch-left');
    const fast = keys.has('ArrowRight') || keys.has('KeyD') || keys.has('touch-right');
    const pace: Pace = slow === fast ? 0 : slow ? -1 : 1;
    queueControls(recording, { slide: keys.has('ArrowDown') || keys.has('KeyS') || keys.has('touch-slide'), pace });
  }
  function touchDown(event: PointerEvent<HTMLButtonElement>, key: string) {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    heldInput(key, true);
  }

  useEffect(() => {
    const element = shell.current;
    if (!element) return;
    const resize = () => setViewWidth(element.clientWidth <= 600 ? 520 : 960);
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const onBlur = () => pause();
    const onVisibility = () => { if (document.hidden) pause(); };
    const onPageHide = () => pause();
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (['Escape', 'KeyP'].includes(event.code) && !pausedRef.current) { event.preventDefault(); pause(); return; }
      if (pausedRef.current || recording.run.status !== 'running') return;
      if (['Space', 'ArrowUp', 'KeyW'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) pressJump();
      } else if (['ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(event.code)) {
        event.preventDefault();
        if (!event.repeat) heldInput(event.code, true);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (['ArrowDown', 'KeyS', 'ArrowLeft', 'KeyA', 'ArrowRight', 'KeyD'].includes(event.code)) {
        if (!pausedRef.current) event.preventDefault();
        heldInput(event.code, false);
      }
    };
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onPageHide);
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    if (recording.run.status === 'finished') persistSafely(true);
    return () => {
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      clearInput();
      // Persist the last completed tick on navigation. The parent owns the durable store.
      try { checkpoint(recording.run.status === 'finished'); } catch { /* Previous checkpoints remain available. */ }
    };
  }, [recording]);

  useEffect(() => {
    if (paused || recording.run.status !== 'running') return;
    let animation = 0;
    let previous = performance.now();
    let accumulator = 0;
    const frame = (now: number) => {
      if (pausedRef.current) return;
      const elapsed = Math.max(0, (now - previous) / 1000);
      previous = now;
      // Never fast-forward a hidden/throttled tab through hazards.
      if (elapsed > 0.25) { pause(); return; }
      accumulator += elapsed;
      let inputChanged = false;
      while (accumulator + 1e-10 >= FIXED_STEP && recording.run.status === 'running') {
        accumulator = Math.max(0, accumulator - FIXED_STEP);
        const result = advanceRecorder(recording);
        inputChanged ||= result.inputChanged;
        for (const event of result.events) {
          let message = '';
          if (event.type === 'coin' && event.rewardMultiplier === 10) message = 'RARE CATCH! 10× COIN';
          if (event.type === 'hit') message = 'OUCH. STAY RARE.';
          if (event.type === 'shield') message = event.amount === 0 ? 'SHIELD SAVED YOU' : 'SHIELD ON';
          if (event.type === 'magnet') message = 'COIN MAGNET';
          if (event.type === 'bonus-spawn') message = 'BONUS INCOMING ↙';
          if (message) { setNotice(message); noticeExpires.current = recording.run._tick + 180; }
        }
      }
      if (noticeExpires.current && recording.run._tick >= noticeExpires.current) { setNotice(''); noticeExpires.current = 0; }
      setRun(snapshotRun(recording));
      if (recording.run.status === 'finished') { persistSafely(true); return; }
      if ((inputChanged || recording.run._tick - lastCheckpoint.current >= 120) && !persistSafely()) return;
      animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animation);
  }, [paused, recording]);

  const biome = Math.min(2, Math.floor(run.elapsed / run.duration * 3));
  const growth = run.growth;
  const vertical = run.phase !== 'side';
  const live = !paused && !isFinished;
  const label = isFinished ? (run.finishReason === 'time' ? 'TIMER SURVIVED' : 'OUT OF HEARTS') : hasStarted ? 'RUN PAUSED' : 'YOUR RUN IS READY';
  const returnHome = () => { pause(); if (props.onHome) props.onHome(); else window.location.assign('/'); };
  const touchControls = <>
    <button type="button" className="touch-pace" disabled={!live} onPointerDown={event => touchDown(event, 'touch-left')} onPointerUp={() => heldInput('touch-left', false)} onPointerCancel={() => heldInput('touch-left', false)} onLostPointerCapture={() => heldInput('touch-left', false)} aria-label={vertical ? 'Steer left' : 'Hold to slow down'}>←<span>{vertical ? 'LEFT' : 'SLOW'}</span></button>
    {vertical ? <span className="vertical-touch">{run.phase === 'up' ? '↑ AUTO LIFT' : '↓ FREE FALL'}<small>← STEER →</small></span> : <>
      <button type="button" disabled={!live} onPointerDown={event => touchDown(event, 'touch-slide')} onPointerUp={() => heldInput('touch-slide', false)} onPointerCancel={() => heldInput('touch-slide', false)} onLostPointerCapture={() => heldInput('touch-slide', false)} aria-label="Hold to slide">↓<span>SLIDE</span></button>
      <button type="button" className="touch-jump" disabled={!live} onPointerDown={event => { event.preventDefault(); pressJump(); }} aria-label="Jump; tap twice to double jump">↑<span>JUMP ×2</span></button>
    </>}
    <button type="button" className="touch-pace" disabled={!live} onPointerDown={event => touchDown(event, 'touch-right')} onPointerUp={() => heldInput('touch-right', false)} onPointerCancel={() => heldInput('touch-right', false)} onLostPointerCapture={() => heldInput('touch-right', false)} aria-label={vertical ? 'Steer right' : 'Hold to speed up'}>→<span>{vertical ? 'RIGHT' : 'FAST'}</span></button>
  </>;
  const world = <svg ref={stage} className="world-svg rush-run-world" viewBox={`0 0 ${viewWidth} 500`} preserveAspectRatio="none" tabIndex={0} role="img" aria-label={vertical ? `Runner world. ${run.phase === 'up' ? 'Pulled upward' : 'Free falling'} automatically. Hold left or right to steer around obstacles.` : 'Runner world. Space or up to jump. Down to slide. Left slows down, right speeds up.'} onPointerDown={event => { if (live) { event.preventDefault(); stage.current?.focus({ preventScroll: true }); pressJump(); } }}>
    {hasStarted ? <DirectionScene run={run} reducedMotion={reduced || !hasStarted} running={live} biome={biome} growth={growth} viewportWidth={viewWidth}
        renderCharacter={(frame, walking) => props.collection === 1
          ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId} frame={frame} walking={walking && !reduced}/>
          : <FriendSprite sprites={art.sprites} frame={frame} walking={walking && !reduced}/>}/> : <>
      <WorldArt distance={run.distance} elapsed={0} reducedMotion biome={biome}/>
      {run.entities.map(entity => <EntityArt key={entity.id} entity={entity} elapsed={0} reduced/>)}
      <g transform={`translate(${viewWidth === 960 ? 265 : 200} 0)`}>
        <ellipse cx={run.player.x + run.player.w / 2} cy="403" rx={32} ry="3" fill="#000"/>
        <g transform={`translate(${run.player.x + run.player.w / 2 - 32} ${run.player.y - 60}) scale(4)`}>
          {props.collection === 1 ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId}/> : <FriendSprite sprites={art.sprites} frame={0}/>}
        </g>
      </g>
    </>}
  </svg>;
  const overlays = hasStarted ? <>
    <div className="run-score"><span>SCORE</span><strong>{run.score.toLocaleString()}</strong><small>{run.coins} COINS <b>×{run.combo} CHAIN</b></small></div>
    <div className="run-modifiers"><span>{vertical ? 'STEER' : 'PACE'} <b data-pace={run.pace}>{vertical ? run.pace < 0 ? '←' : run.pace > 0 ? '→' : '← →' : `${run.speedMultiplier.toFixed(2)}×`}</b></span><span>SIZE <b>{growth.toFixed(2)}×</b></span><div className="growth-meter" role="meter" aria-label="Friend size" aria-valuemin={1} aria-valuemax={1.75} aria-valuenow={growth}><i style={{width:`${(growth - 1) / .75 * 100}%`}}/></div></div>
    {notice && live && <div className="pickup-notice" role="status">{notice}</div>}
    <div className="run-progress"><i style={{ width: `${run.elapsed / run.duration * 100}%` }}/></div>
  </> : undefined;

  return <section ref={shell} className="rush-run" aria-label="Rare Rush testnet run" data-run-id={props.runId.toString()} data-status={run.status} data-paused={paused} data-phase={run.phase} data-tick={run.completedTicks} data-difficulty={props.difficulty}>
    <ArcadeCabinet difficulty={props.difficulty} collection={props.collection} tokenId={props.tokenId} runId={props.runId} snapshot={run} world={world} fieldOverlays={overlays} onHome={returnHome} touchControls={touchControls}
      topActions={<><button type="button" onClick={() => setReduced(value => !value)} aria-pressed={reduced} title="Reduce background motion">FX {reduced ? 'OFF' : 'ON'}</button><button type="button" onClick={paused ? resume : pause} disabled={isFinished} aria-label={paused ? '▶ RESUME' : 'Ⅱ PAUSE'}>{paused ? '▶' : 'Ⅱ'}</button></>}>
      {paused && !hasStarted && !isFinished && <div className="start-screen">
        <div className="start-title"><span className="eyebrow">ENDLESS WORLD. {mode.seconds} SECONDS.</span><h1>RARE<br/><span>RUSH</span><sup>✦</sup></h1><span className="mobile-friend"><TestFriendAvatar collection={props.collection} tokenId={props.tokenId}/></span><div className="selected-friend">{props.collection === 1 ? 'GENESIS' : 'FRIEND'} #{props.tokenId.toString()}<span>{props.collection === 1 ? '100× REWARDS' : art.sprites.familyName}</span></div></div>
        <div className="start-card confirmed-start-card"><span className="card-kicker">{label}</span><h2>Run. Collect.<br/>{' '}Stay rare.</h2><div className="quick-stats"><span>MODE<b>{mode.label}</b></span><span>TIME<b>{mode.seconds}s</b></span><span>HEARTS<b>3</b></span></div><button type="button" className="primary" onClick={resume}>LET’S RUSH <span>↗</span></button><small className="entry-note">Your testnet entry is confirmed. Ready when you are.</small><small className="run-window-note">The onchain claim window continues while paused.</small>{saveError && <p className="run-save-error" role="alert">{saveError}</p>}</div>
      </div>}
      {paused && hasStarted && !isFinished && <div className="game-overlay rush-run-overlay"><div className="pause-card"><span className="eyebrow">{label}</span><h2>PAUSED</h2><p>Your local timer is paused.<br/>The onchain claim window keeps counting down.</p><button type="button" className="primary" onClick={resume}>KEEP RUNNING <span>▶</span></button>{saveError && <p className="run-save-error" role="alert">{saveError}</p>}</div></div>}
      {isFinished && <div className="game-overlay result-screen"><div className="result-card"><span className="eyebrow">{mode.label.toUpperCase()} · {label}</span><h2>{run.finishReason === 'time' ? 'KEEP IT RARE.' : 'DOWN, BUT STILL RARE.'}</h2><div className="result-score">{run.score.toLocaleString()}<span>POINTS</span></div><div className="results-grid"><div><b>{Math.floor(run.distance)}m</b><span>DISTANCE</span></div><div><b>{run.coins}</b><span>COINS · {run.bonusCoins} BONUS</span></div><div><b>{run.hearts}</b><span>HEARTS</span></div></div><p>{run.finishReason === 'time' ? 'Your inputs are saved. Verify this run to claim the test rewards you earned.' : 'This run ended before the timer. No reward claim is available. Your next high score is waiting.'}</p>{saveError && <p className="run-save-error" role="alert">{saveError}</p>}{saveError && <button type="button" className="primary" onClick={() => persistSafely(true)}>RETRY SAVING RUN <span>↗</span></button>}</div></div>}
    </ArcadeCabinet>
  </section>;
}

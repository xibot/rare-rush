import { useEffect, useRef, useState, type PointerEvent } from 'react';
import type { Hex } from 'viem';
import { WorldArt } from '../../generated/games/rare-rush/WorldArt.tsx';
import { EntityArt, FriendSprite } from '../../generated/games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../../generated/games/rare-rush/genesis/GenesisRunnerSprite.tsx';
import { difficultySettings } from '../../generated/games/rare-rush/difficulty.ts';
import { FIXED_STEP, type Pace } from '../../generated/games/rare-rush/engine.ts';
import { advanceRecorder, createRecorder, exportReplay, queueControls, releaseControls, snapshotRun,
  type DifficultyId, type Replay, type RunSnapshot } from './recorder.ts';
import { testRunArt } from './art.ts';
import './play.css';

export type RunCanvasProps = {
  seed: Hex;
  difficulty: DifficultyId;
  collection: 0 | 1;
  tokenId: string | bigint;
  runId: string | bigint;
  initialReplay?: Replay;
  completedTicks?: number;
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
    if (pausedRef.current || recording.run.status !== 'running') return;
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
    const resize = () => setViewWidth(element.clientWidth < 760 ? 520 : 960);
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
      if (event.code === 'Escape' && !pausedRef.current) { event.preventDefault(); pause(); return; }
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

  const remaining = Math.max(0, Math.ceil(run.duration - run.elapsed));
  const timer = `${Math.floor(remaining / 60).toString().padStart(2, '0')}:${(remaining % 60).toString().padStart(2, '0')}`;
  const biome = Math.min(2, Math.floor(run.elapsed / run.duration * 3));
  const growth = run.growth;
  const spriteFrame = reduced || paused ? 0 : Math.floor(run.elapsed * 12) % 8;
  const center = run.player.x + run.player.w / 2;
  const height = run.player.slide ? 30 : 60 * growth;
  const live = !paused && !isFinished;
  const label = isFinished ? (run.finishReason === 'time' ? 'TIMER SURVIVED' : 'OUT OF HEARTS') : hasStarted ? 'RUN PAUSED' : 'YOUR RUN IS READY';

  return <section ref={shell} className="rush-run" aria-label="Rare Rush testnet run" data-run-id={props.runId.toString()} data-status={run.status} data-paused={paused}>
    <div className="rush-run-top"><div><span className="rush-run-tag">ONCHAIN TEST RUN #{props.runId.toString()}</span><strong>{art.label}</strong></div><div className="rush-run-options"><button type="button" onClick={() => setReduced(value => !value)} aria-pressed={reduced}>FX {reduced ? 'OFF' : 'ON'}</button><button type="button" onClick={paused ? resume : pause} disabled={isFinished}>{paused ? '▶ RESUME' : 'Ⅱ PAUSE'}</button></div></div>
    <div className="rush-run-hud"><div><span>{mode.label.toUpperCase()} · TIME</span><strong className={remaining < 15 ? 'urgent' : ''}>{timer}</strong></div><div><span>DISTANCE</span><strong>{Math.floor(run.distance).toString().padStart(4, '0')}<small>m</small></strong></div><div><span>COINS COLLECTED</span><strong className="rush-run-coins">{run.coins}<small>✦</small></strong></div><div><span>KEEP IT RARE</span><strong className="rush-run-hearts" aria-label={`${run.hearts} hearts remaining`}>{[0, 1, 2].map(index => <b key={index} className={index >= run.hearts ? 'lost' : ''}>♥</b>)}</strong></div></div>
    <div className="rush-run-field">
      <svg ref={stage} className="rush-run-world" viewBox={`0 0 ${viewWidth} 500`} preserveAspectRatio="none" tabIndex={0} role="img" aria-label="Runner world. Space or up to jump. Down to slide. Left slows down, right speeds up." onPointerDown={event => { if (live) { event.preventDefault(); stage.current?.focus({ preventScroll: true }); pressJump(); } }}>
        <WorldArt distance={run.distance} elapsed={run.elapsed * 1000} reducedMotion={reduced} biome={biome}/>
        {run.entities.map(entity => <EntityArt key={entity.id} entity={entity} elapsed={run.elapsed} reduced={reduced}/>)}
        <g opacity={run.invulnerable > 0 ? reduced ? .6 : Math.floor(run.elapsed * 12) % 2 ? .35 : 1 : 1}>
          <ellipse cx={center} cy="403" rx={32 * growth} ry="3" fill="#000"/>
          {run.magnet > 0 && <circle cx={center} cy={run.player.y - height / 2} r={58 * growth} fill="none" stroke="#ccff00" strokeDasharray="3 10"/>}
          {run.shield > 0 && <rect x={center - 38 * growth} y={run.player.y - height - 10} width={76 * growth} height={height + 16} fill="none" stroke="#ccff00" strokeWidth="2"/>}
          <g data-character="friend" data-slide={run.player.slide} data-growth={growth.toFixed(3)} transform={`translate(${center - 32 * growth} ${run.player.y - height}) scale(${4 * growth} ${run.player.slide ? 2 : 4 * growth})`}>
            {props.collection === 1 ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId} frame={spriteFrame} walking={live && !reduced}/> : <FriendSprite sprites={art.sprites} frame={spriteFrame} walking={live && !reduced}/>}
          </g>
        </g>
      </svg>
      <div className="rush-run-zone"><span>0{biome + 1}</span>{['GARDEN COMMONS', 'CIRCUIT COURTYARD', 'CRYSTAL MESA'][biome]}</div>
      <div className="rush-run-score"><span>SCORE</span><strong>{run.score.toLocaleString()}</strong><small>{run.bonusCoins} BONUS · ×{run.combo} CHAIN</small></div>
      <div className="rush-run-modifiers"><span>PACE <b>{run.speedMultiplier.toFixed(2)}×</b></span><span>SIZE <b>{growth.toFixed(2)}×</b></span></div>
      {notice && live && <div className="rush-run-notice" role="status">{notice}</div>}
      <div className="rush-run-progress"><i style={{ width: `${run.elapsed / run.duration * 100}%` }}/></div>
      {(paused || isFinished) && <div className="rush-run-overlay"><div className="rush-run-card"><span>{label}</span><h2>{isFinished ? run.finishReason === 'time' ? <>RUN COMPLETE.<br/><em>KEEP IT RARE.</em></> : <>DOWN, BUT<br/><em>STILL RARE.</em></> : hasStarted ? <>TAKE A BREATHER.<br/><em>THEN RUSH.</em></> : <>RUN. COLLECT.<br/><em>STAY RARE.</em></>}</h2>
        {isFinished ? <p>{run.finishReason === 'time' ? 'Your inputs are saved. Verify this run below to claim the test rewards you earned.' : 'This run ended before the timer. No reward claim is available. Your next high score is waiting.'}</p> : <><p>{hasStarted ? 'Your local run is paused. The onchain claim window keeps counting down.' : `${mode.seconds} seconds. Three hearts. Double-jump, dodge, and collect as many coins as you can.`}</p><button type="button" className="rush-run-primary" onClick={resume}>{hasStarted ? 'KEEP RUNNING' : 'LET’S RUSH'} <span>↗</span></button><small>The onchain claim window continues while paused.</small></>}
        {saveError && <p className="rush-run-error" role="alert">{saveError}</p>}
        {saveError && isFinished && <button type="button" className="rush-run-primary" onClick={() => persistSafely(true)}>RETRY SAVING RUN <span>↗</span></button>}
      </div></div>}
    </div>
    <div className="rush-run-bottom"><div className="rush-run-keys"><span><kbd>SPACE</kbd> JUMP ×2</span><span><kbd>↓</kbd> SLIDE</span><span><kbd>←</kbd><kbd>→</kbd> PACE</span></div><span className="rush-run-reward-note">{props.collection === 1 ? 'GENESIS 100×' : 'GENERATIONS'} · {mode.rewardLabel} MODE</span></div>
    <div className="rush-run-touch" aria-label="Touch controls"><button type="button" disabled={!live} onPointerDown={event => touchDown(event, 'touch-left')} onPointerUp={() => heldInput('touch-left', false)} onPointerCancel={() => heldInput('touch-left', false)} onLostPointerCapture={() => heldInput('touch-left', false)} aria-label="Hold to slow down">←<span>SLOW</span></button><button type="button" disabled={!live} onPointerDown={event => touchDown(event, 'touch-slide')} onPointerUp={() => heldInput('touch-slide', false)} onPointerCancel={() => heldInput('touch-slide', false)} onLostPointerCapture={() => heldInput('touch-slide', false)} aria-label="Hold to slide">↓<span>SLIDE</span></button><button type="button" className="rush-run-jump" disabled={!live} onPointerDown={event => { event.preventDefault(); pressJump(); }} aria-label="Jump; tap twice to double jump">↑<span>JUMP ×2</span></button><button type="button" disabled={!live} onPointerDown={event => touchDown(event, 'touch-right')} onPointerUp={() => heldInput('touch-right', false)} onPointerCancel={() => heldInput('touch-right', false)} onLostPointerCapture={() => heldInput('touch-right', false)} aria-label="Hold to speed up">→<span>FAST</span></button></div>
    <p className="rush-run-disclaimer">Canonical artwork is cosmetic. Test NFT IDs are separate from mainnet Rare Friends. Rewards require a surviving, verified run.</p>
  </section>;
}

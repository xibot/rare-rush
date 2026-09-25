import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { testRunArt } from '../testnet-app/src/play/art.ts';
import { AgentStage } from './Stage.tsx';
import { decodeRunArt, type RunRecord } from './feed-types.ts';
import { advanceReplay, checkAgentReplay, createReplaySession, FIXED_STEP, type RunSession } from './runner.ts';
import type { ArcadeFriend } from './arcade.ts';
import './replay-modal.css';

export type ReplayModalProps = {
  record: RunRecord;
  liked: boolean;
  onToggleLike: () => void;
  onClose: () => void;
};

type LoadedReplay = { record: RunRecord; session: RunSession; art?: ArcadeFriend };
const MAX_RESPONSE_BYTES = 2_500_000;
const seconds = (value: number) => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
const environment = (record: RunRecord) => record.source === 'local' ? 'PREVIEW' : record.source.toUpperCase();
const identity = (record: RunRecord) => JSON.stringify([record.id, record.source, record.collection,
  record.tokenId, record.difficulty, record.seed, record.player, record.runId]);

async function readReplayResponse(response: Response): Promise<unknown> {
  if (!response.ok || Number(response.headers.get('content-length')) > MAX_RESPONSE_BYTES || !response.body) {
    throw new Error('Replay response unavailable.');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new Error('Replay response exceeds its limit.');
      text += decoder.decode(value, { stream: true });
    }
    return JSON.parse(text + decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** The viewer only consumes saved frames. It never connects a wallet or saves a run. */
export function ReplayModal({ record, liked, onToggleLike, onClose }: ReplayModalProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const [loaded, setLoaded] = useState<LoadedReplay | null>(null);
  const [retry, setRetry] = useState(0);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState<1 | 2>(1);
  const [tick, setTick] = useState(0);
  const [visible, setVisible] = useState(() => !document.hidden);
  const [reduced, setReduced] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);
  const reducedRef = useRef(reduced); reducedRef.current = reduced;
  const selectedIdentity = identity(record);
  const current = loaded && identity(loaded.record) === selectedIdentity ? loaded : null;
  const finished = current?.session.run.status === 'finished';

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    element.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      element.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const motionChanged = () => {
      setReduced(media.matches);
      if (media.matches) { setRunning(false); setNotice('Replay paused. Choose Play when ready.'); }
    };
    const hidden = () => {
      setVisible(!document.hidden);
      if (document.hidden) { setRunning(false); setNotice('Replay paused while the page was away.'); }
    };
    const pageHidden = () => { setVisible(false); setRunning(false); setNotice('Replay paused while the page was away.'); };
    const pageShown = () => setVisible(!document.hidden);
    media.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', hidden);
    window.addEventListener('pagehide', pageHidden);
    window.addEventListener('pageshow', pageShown);
    return () => {
      media.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', hidden);
      window.removeEventListener('pagehide', pageHidden);
      window.removeEventListener('pageshow', pageShown);
    };
  }, []);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    setLoaded(null); setRunning(false); setTick(0); setSpeed(1); setError(''); setNotice('');
    void (async () => {
      try {
        if (!/^[a-f0-9]{64}$/.test(record.id)) throw new Error('Invalid saved run ID.');
        const response = await fetch(`/api/runs/${encodeURIComponent(record.id)}`, { signal: controller.signal });
        const value = await readReplayResponse(response);
        if (!active) return;
        if (controller.signal.aborted) throw new Error('Replay request expired.');
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid saved replay.');
        const full = value as RunRecord;
        if (identity(full) !== selectedIdentity || !['easy', 'normal', 'degen'].includes(full.difficulty)) {
          throw new Error('Saved replay identity does not match this run.');
        }
        const metrics = checkAgentReplay(full.seed, full.difficulty, full.replay);
        const session = createReplaySession(full.seed, full.difficulty, full.replay);
        const art = decodeRunArt(full);
        if (full.source === 'arcade' && !art) throw new Error('Saved Arcade artwork is missing.');
        if (!active) return;
        if (controller.signal.aborted) throw new Error('Replay request expired.');
        setLoaded({ record: { ...full, metrics }, session, art });
        setRunning(!document.hidden && !reducedRef.current);
        if (reducedRef.current) setNotice('Choose Play to watch this saved run.');
      } catch {
        if (active) setError(controller.signal.aborted
          ? 'The saved replay took too long to load. Try again.'
          : 'This saved replay could not be loaded or checked. Try again.');
      } finally { window.clearTimeout(timer); }
    })();
    return () => { active = false; controller.abort(); window.clearTimeout(timer); };
  }, [selectedIdentity, retry]);

  useEffect(() => {
    if (!running || !current || !visible || document.hidden) return;
    const session = current.session;
    let raf = 0, previous = performance.now(), accumulator = 0;
    const frame = (now: number) => {
      const delta = (now - previous) / 1000; previous = now;
      if (document.hidden || delta > .5) {
        setRunning(false); setNotice('Replay paused while the page was away.'); return;
      }
      try {
        accumulator += Math.max(0, delta) * speed;
        while (accumulator + 1e-10 >= FIXED_STEP && session.run.status === 'running') {
          accumulator = Math.max(0, accumulator - FIXED_STEP);
          advanceReplay(session);
        }
        setTick(session.run._tick);
        if (session.run.status === 'finished') { setRunning(false); setNotice(''); return; }
        raf = requestAnimationFrame(frame);
      } catch {
        setRunning(false); setError('Playback stopped because this replay could not be checked. Try loading it again.');
      }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [running, current, speed, visible]);

  function restart() {
    if (!current || document.hidden) return;
    try {
      const session = createReplaySession(current.record.seed, current.record.difficulty, current.record.replay);
      setLoaded({ ...current, session }); setTick(0); setNotice(''); setRunning(true);
    } catch { setRunning(false); setError('This replay could not be restarted. Try loading it again.'); }
  }
  function togglePlayback() {
    if (!current || finished || document.hidden) return;
    setNotice(''); setRunning(value => !value);
  }

  const metrics = current?.record.metrics;
  const duration = metrics ? metrics.ticks * FIXED_STEP : 0;
  const elapsed = Math.min(duration, tick * FIXED_STEP);
  const recordedAt = new Date(record.createdAt);

  return createPortal(<dialog ref={dialog} className="replay-modal" aria-label="Watch saved run"
    onCancel={event => { event.preventDefault(); onClose(); }}>
    <header className="replay-modal-header">
      <div><p>RUNS FEED <span> / SAVED REPLAY</span></p>
        <h2>{record.collection === 1 ? 'GENESIS' : 'GENERATIONS'} #{record.tokenId}</h2></div>
      <button ref={closeButton} type="button" className="replay-modal-close" aria-label="Close replay" onClick={onClose}>×</button>
    </header>
    <div className="replay-modal-content" aria-busy={!current && !error}>
      {error ? <div className="replay-modal-message"><p role="alert">{error}</p>
        <button type="button" onClick={() => setRetry(value => value + 1)}>RETRY REPLAY</button></div>
        : !current ? <div className="replay-modal-message"><span aria-hidden="true">→ ↑ ↓ ←</span><p role="status">Loading and checking saved replay…</p></div>
        : <>
          <div className="replay-modal-stage">
            {visible ? <AgentStage run={current.session.run} collection={current.record.collection} tokenId={current.record.tokenId}
              running={running && visible} reducedMotion={reduced} label="REPLAY" art={current.art ?? (record.actor === 'human' && record.source === 'testnet' ? testRunArt(record.collection, record.tokenId, record.runId!) : undefined)}
              fieldOverlay={finished && <div className="replay-modal-ended" role="status">
                <span>REPLAY ENDED</span><strong>{metrics!.score.toLocaleString()}<small>POINTS</small></strong>
                <p>{metrics!.outcome === 'survived' ? 'TIMER SURVIVED' : 'OUT OF HEARTS'}</p>
                <button type="button" onClick={restart}>REPLAY AGAIN ↻</button>
              </div>}/> : <div className="replay-modal-message"><p>Replay paused while the page is away.</p></div>}
          </div>
          <div className="replay-modal-controls" aria-label="Replay playback controls">
            <div className="replay-modal-transport">
              <button type="button" className="replay-modal-play" disabled={finished} onClick={togglePlayback}
                aria-label={running ? 'Pause replay' : 'Play replay'}>{running ? 'Ⅱ PAUSE' : '▶ PLAY'}</button>
              <button type="button" aria-label="Restart replay" onClick={restart}>↻ <span>RESTART</span></button>
              <label> SPEED <select value={speed} aria-label="Playback speed" onChange={event => setSpeed(event.target.value === '2' ? 2 : 1)}>
                <option value="1">1×</option><option value="2">2×</option>
              </select></label>
            </div>
            <div className="replay-modal-timeline"><progress max={Math.max(1, metrics!.ticks)} value={tick} aria-label="Replay progress"/>
              <span>{seconds(elapsed)} / {seconds(duration)}</span></div>
          </div>
          <div className="replay-modal-stats" aria-label="Saved run result">
            <span><b>{metrics!.score.toLocaleString()}</b>POINTS</span>
            <span><b>{metrics!.coins}</b>COINS</span>
            <span><b>{metrics!.distance.toLocaleString()}m</b>DISTANCE</span>
            <span><b>{metrics!.outcome === 'survived' ? 'SURVIVED' : 'LOST'}</b>OUTCOME</span>
          </div>
        </>}
      <div className="replay-modal-meta">
        <div><p>{environment(record)} · {record.difficulty.toUpperCase()}
          {Number.isFinite(recordedAt.getTime()) && <> · <time dateTime={record.createdAt}>{recordedAt.toLocaleDateString()}</time></>}</p>
          <span>Recorded gameplay{current ? ' · replay checked locally' : ''}</span></div>
        <button type="button" className="replay-modal-like" aria-label={liked ? 'Unlike run' : 'Like run'} aria-pressed={liked} onClick={onToggleLike}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/></svg>
          <span>{liked ? 'LIKED' : 'LIKE'}</span>
        </button>
      </div>
      {notice && <p className="replay-modal-notice" role="status">{notice}</p>}
    </div>
  </dialog>, document.body);
}

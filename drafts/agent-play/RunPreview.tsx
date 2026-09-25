import { useEffect, useRef, useState } from 'react';
import { DirectionScene } from '../../games/rare-rush/twist/DirectionScene.tsx';
import { FriendSprite } from '../../games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../../games/rare-rush/genesis/GenesisRunnerSprite.tsx';
import { testRunArt } from '../../testnet-app/src/play/art.ts';
import { advanceReplay, FIXED_STEP } from './runner.ts';
import { decodeRunArt, type RunRecord } from './feed-types.ts';
import { createReplayPreview, resetReplayPreview, type ReplayPreviewClip } from './replay-preview.ts';

type Preview = { clip: ReplayPreviewClip; art: ReturnType<typeof testRunArt> | NonNullable<ReturnType<typeof decodeRunArt>> };
const cache = new Map<string, Promise<Preview>>();
const identity = (record: RunRecord) => JSON.stringify([record.id, record.source, record.collection,
  record.tokenId, record.difficulty, record.seed, record.player, record.runId]);
const MAX_BYTES = 2_500_000;
let preparation: Promise<unknown> = Promise.resolve();
function preparePreview(record: RunRecord) {
  // Separate validation tasks with a paint opportunity when several covers arrive.
  const next = preparation.catch(() => {}).then(() => new Promise<void>(resolve => window.setTimeout(resolve, 16)))
    .then(() => createReplayPreview(record, record.replay));
  preparation = next;
  return next;
}

/** Only visible covers request a recording. A small LRU keeps filtering cheap. */
function loadPreview(record: RunRecord): Promise<Preview> {
  const key = identity(record), existing = cache.get(key);
  if (existing) { cache.delete(key); cache.set(key, existing); return existing; }
  const promise = (async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    try {
      if (!/^[a-f0-9]{64}$/.test(record.id)) throw new Error('Invalid saved run.');
      const response = await fetch(`/api/runs/${record.id}`, { signal: controller.signal });
      if (!response.ok || !response.body || Number(response.headers.get('content-length')) > MAX_BYTES) throw new Error('Preview unavailable.');
      const reader = response.body.getReader(), decoder = new TextDecoder();
      let bytes = 0, text = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bytes += value.byteLength;
          if (bytes > MAX_BYTES) throw new Error('Preview is too large.');
          text += decoder.decode(value, { stream: true });
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      const full = JSON.parse(text) as RunRecord;
      if (!full || identity(full) !== key) throw new Error('Saved run does not match.');
      const clip = await preparePreview(full);
      if (controller.signal.aborted) throw new Error('Preview request expired.');
      const savedArt = decodeRunArt(full);
      if (full.source === 'arcade' && !savedArt) throw new Error('Saved Friend artwork is missing.');
      return { clip, art: savedArt ?? testRunArt(full.collection, full.tokenId, 'agent-play') };
    } finally { window.clearTimeout(timeout); }
  })();
  cache.set(key, promise);
  while (cache.size > 8) cache.delete(cache.keys().next().value!);
  void promise.catch(() => { if (cache.get(key) === promise) cache.delete(key); });
  return promise;
}

/** A real six-second excerpt, driven by saved inputs and the original renderer. */
export function RunPreview({ record, animate }: { record: RunRecord; animate: boolean }) {
  const element = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);
  const [foreground, setForeground] = useState(() => !document.hidden);
  const [playback, setPlayback] = useState<{ key: string; preview: Preview; session: ReturnType<typeof resetReplayPreview>; loop: number } | null>(null);
  const [, paint] = useState(0);
  const [failed, setFailed] = useState(false);
  const key = identity(record);
  const current = playback?.key === key ? playback : null;
  const active = !!current && animate && inView && foreground;

  useEffect(() => {
    const observer = new IntersectionObserver(entries => setInView(entries.some(entry => entry.isIntersecting)), { threshold: 0 });
    if (element.current) observer.observe(element.current);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const changed = () => setForeground(!document.hidden);
    const hidden = () => setForeground(false);
    document.addEventListener('visibilitychange', changed);
    window.addEventListener('pagehide', hidden); window.addEventListener('pageshow', changed);
    return () => {
      document.removeEventListener('visibilitychange', changed);
      window.removeEventListener('pagehide', hidden); window.removeEventListener('pageshow', changed);
    };
  }, []);
  useEffect(() => {
    if (!inView || !foreground || current) return;
    let alive = true;
    setFailed(false);
    void loadPreview(record).then(preview => {
      if (alive) setPlayback({ key, preview, session: resetReplayPreview(preview.clip), loop: 0 });
    }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, [key, inView, foreground, !!current]);

  useEffect(() => {
    if (!active || !current) return;
    let raf = 0, previous = performance.now(), lastPaint = previous, accumulator = 0;
    const frame = (now: number) => {
      const delta = (now - previous) / 1000; previous = now;
      if (document.hidden) return;
      // Discard time spent blocked or away instead of catching up in a burst.
      if (delta < .5) accumulator += Math.max(0, delta);
      try {
        while (accumulator + 1e-10 >= FIXED_STEP && current.session.run._tick < current.preview.clip.endTick) {
          accumulator = Math.max(0, accumulator - FIXED_STEP);
          advanceReplay(current.session);
        }
        if (current.session.run._tick >= current.preview.clip.endTick) {
          setPlayback({ ...current, session: resetReplayPreview(current.preview.clip), loop: current.loop + 1 });
          return;
        }
        if (now - lastPaint >= 1000 / 12) { lastPaint = now; paint(value => value + 1); }
        raf = requestAnimationFrame(frame);
      } catch { setFailed(true); }
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [active, current]);

  const run = current?.session.run, art = current?.preview.art;
  return <span ref={element} className="runs-feed-preview" aria-hidden="true"
    data-preview-state={failed ? 'unavailable' : current ? 'ready' : 'loading'}
    data-preview-animating={active && !failed} data-preview-tick={run?._tick} data-preview-loop={current?.loop}>
    {run && art && !failed ? <svg className="runs-feed-preview-scene" viewBox="0 0 640 500" focusable="false">
      <DirectionScene key={`${key}:${current!.loop}`} run={run} running={active}
        biome={Math.min(2, Math.floor(run.elapsed / run.duration * 3))} growth={run.growth} viewportWidth={640}
        renderCharacter={(frame, walking) => record.collection === 1
          ? art.portraitUrl && <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId} frame={frame} walking={walking}/>
          : art.sprites && <FriendSprite sprites={art.sprites} frame={frame} walking={walking}/>}/>
    </svg> : <span className="runs-feed-preview-placeholder"><span>→ ↑ ↓ ←</span>{failed ? 'OPEN SAVED REPLAY' : 'LOADING PREVIEW'}</span>}
  </span>;
}

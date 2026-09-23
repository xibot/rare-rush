import { useEffect, useRef, useState } from 'react';
import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import { FriendSprite } from '../RunnerArt';
import { DirectionScene } from '../twist/DirectionScene';
import { advancePreviewRun, createPreviewRun, PREVIEW_SECONDS } from './preview-course';
import cachedArt from './preview-art.json';

// These are public canonical registry reads, never a wallet or ownership fixture.
// Decoding locally keeps this noninteractive preview independent of live RPC.
const FRIENDS = cachedArt.friends.map((friend) => decodeGenerationSprites(
  BigInt(friend.tokenId), friend.familyId, friend.seed, friend.frames.map(BigInt),
  cachedArt.provenance.manifest as GenerationSpriteManifest,
));

function randomIndex(previous = -1): number {
  if (previous < 0 || FRIENDS.length < 2) return Math.floor(Math.random() * FRIENDS.length);
  const candidate = Math.floor(Math.random() * (FRIENDS.length - 1));
  return candidate >= previous ? candidate + 1 : candidate;
}

function previewCourse(friendIndex: number) {
  return createPreviewRun(`preview:${FRIENDS[friendIndex].tokenId}:${Math.floor(Math.random() * 1_000_000_000)}`);
}

/** Watch-only attract mode. This component has no wallet or economy client. */
export default function PreviewRun() {
  const [initial] = useState(() => {
    const index = randomIndex();
    return { index, run: previewCourse(index) };
  });
  const [friendIndex, setFriendIndex] = useState(initial.index);
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [paused, setPaused] = useState(reduced);
  const [viewWidth, setViewWidth] = useState(960);
  const [, draw] = useState(0);
  const wrapper = useRef<HTMLDivElement>(null);
  const runRef = useRef(initial.run);
  const indexRef = useRef(initial.index);
  const pausedRef = useRef(paused);
  const visibleRef = useRef(!document.hidden);
  const onScreenRef = useRef(false);
  const previousTime = useRef(0);
  const displayedGrowth = useRef(1);

  function newFriend() {
    const index = randomIndex(indexRef.current);
    indexRef.current = index;
    runRef.current = previewCourse(index);
    displayedGrowth.current = 1;
    previousTime.current = 0;
    setFriendIndex(index);
    draw((value) => value + 1);
  }

  function togglePaused() {
    const next = !pausedRef.current;
    pausedRef.current = next;
    previousTime.current = 0;
    setPaused(next);
  }

  useEffect(() => {
    const element = wrapper.current;
    if (!element) return;
    const resize = new ResizeObserver(([entry]) => setViewWidth(entry.contentRect.width < 600 ? 640 : 960));
    resize.observe(element);
    const intersection = new IntersectionObserver(([entry]) => {
      onScreenRef.current = entry.isIntersecting;
      previousTime.current = 0;
    }, { threshold: 0.05 });
    intersection.observe(element);
    const visibility = () => {
      visibleRef.current = !document.hidden;
      previousTime.current = 0;
    };
    document.addEventListener('visibilitychange', visibility);
    return () => {
      resize.disconnect();
      intersection.disconnect();
      document.removeEventListener('visibilitychange', visibility);
    };
  }, []);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    const changed = () => {
      setReduced(preference.matches);
      if (preference.matches) {
        pausedRef.current = true;
        previousTime.current = 0;
        setPaused(true);
      }
    };
    preference.addEventListener('change', changed);
    return () => preference.removeEventListener('change', changed);
  }, []);

  useEffect(() => {
    let animation = 0;
    const frame = (time: number) => {
      const dt = previousTime.current ? Math.min((time - previousTime.current) / 1000, 0.1) : 0;
      previousTime.current = time;
      if (!pausedRef.current && visibleRef.current && onScreenRef.current) {
        const run = runRef.current;
        advancePreviewRun(run, dt);
        displayedGrowth.current += (run.growth - displayedGrowth.current) * (1 - Math.exp(-14 * dt));
        if (run.elapsed >= PREVIEW_SECONDS || run.status === 'finished') newFriend();
        else draw((value) => value + 1);
      }
      animation = requestAnimationFrame(frame);
    };
    animation = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animation);
  }, []);

  const run = runRef.current;
  const sprites = FRIENDS[friendIndex];
  const growth = reduced ? run.growth : displayedGrowth.current;

  return <div ref={wrapper} className="preview-run" data-preview-friend={sprites.tokenId.toString()}
    data-preview-distance={Math.floor(run.distance)} data-preview-coins={run.coins}
    data-preview-bonus-coins={run.bonusCoins}
    data-preview-phase={run.phase} data-preview-time={run.elapsed.toFixed(3)} data-preview-section={run._phaseIndex}
    data-preview-growth={run.growth.toFixed(3)} data-preview-paused={paused}>
    <div className="preview-toolbar">
      <span className="preview-friend">FRIEND #{sprites.tokenId.toString()} <b>{sprites.familyName}</b></span>
      <div className="preview-actions">
        <button type="button" onClick={togglePaused} aria-label={paused ? 'Resume preview' : 'Pause preview'}>{paused ? 'RESUME' : 'PAUSE'}</button>
        <button type="button" onClick={newFriend}>NEW FRIEND ↗</button>
      </div>
    </div>
    <svg className="preview-world" viewBox={`0 0 ${viewWidth} 500`} width="100%" style={{ aspectRatio: `${viewWidth} / 500` }} role="img"
      aria-label={`Autoplay demonstration: sideways running, upward lifts, and free falls with ${sprites.familyName} Friend #${sprites.tokenId}. Watching does not earn rewards.`}>
      <DirectionScene key={run.seed} run={run} reducedMotion={reduced} running={!paused}
        biome={Math.floor(run.elapsed / 8)} growth={growth} viewportWidth={viewWidth} reverseExits={false}
        renderCharacter={(frame, walking) => <g data-character="preview-friend"><FriendSprite sprites={sprites} frame={paused ? 0 : frame} walking={walking}/></g>}/>
    </svg>
    <div className="preview-stats" aria-live="off">
      <span><b>{Math.floor(run.distance)}m</b> DISTANCE</span>
      <span><b>{run.coins}</b> COINS</span>
      <span><b>{run.growth.toFixed(2)}×</b> SIZE</span>
      <small>Autoplay · no rewards</small>
    </div>
  </div>;
}

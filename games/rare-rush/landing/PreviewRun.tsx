import { useEffect, useRef, useState } from 'react';
import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import { createRun, jump, setPace, setSliding, stepRun, type RunState } from '../engine';
import { WorldArt } from '../WorldArt';
import { EntityArt, FriendSprite } from '../RunnerArt';
import cachedArt from './preview-art.json';

// These are public canonical registry reads, never a wallet or ownership fixture.
// Decoding locally keeps this noninteractive preview independent of live RPC.
const FRIENDS = cachedArt.friends.map((friend) => decodeGenerationSprites(
  BigInt(friend.tokenId), friend.familyId, friend.seed, friend.frames.map(BigInt),
  cachedArt.provenance.manifest as GenerationSpriteManifest,
));
const ROTATE_AFTER_SECONDS = 24;

function randomIndex(previous = -1): number {
  if (previous < 0 || FRIENDS.length < 2) return Math.floor(Math.random() * FRIENDS.length);
  const candidate = Math.floor(Math.random() * (FRIENDS.length - 1));
  return candidate >= previous ? candidate + 1 : candidate;
}

function previewCourse(friendIndex: number): RunState {
  return createRun(`preview:${FRIENDS[friendIndex].tokenId}:${Math.floor(Math.random() * 1_000_000_000)}`);
}

/** Legal game inputs only. No heart, reward, course, or collision overrides. */
function autopilot(run: RunState): void {
  const phase = Math.floor(run.elapsed / 8) % 3;
  setPace(run, phase === 0 ? 0 : phase === 1 ? -1 : 1);
  const next = run.entities
    .filter((entity) => !entity.hit && entity.x + entity.w > run.player.x &&
      (entity.kind === 'crystal' || entity.kind === 'block' || entity.kind === 'drone'))
    .sort((first, second) => first.x - second.x)[0];
  const until = next ? (next.x - run.player.x - run.player.w) / run.speed : Infinity;
  setSliding(run, Boolean(next?.kind === 'drone' && until < 0.6));
  if (next && next.kind !== 'drone') {
    if (until < 0.22 && run.player.grounded) jump(run);
    else if (until < 0.3 && run.player.jumps === 1 && run.player.vy >= -80) jump(run);
  }
  // A bonus crosses the screen faster than the scenery. Aim for its center,
  // rather than using the ordinary obstacle's time-to-contact calculation.
  // Leave enough landing room before every bridge, including a second bridge
  // behind the nearest ground obstacle, so chasing never overrides a slide.
  const bridgeNearby = run.entities.some((entity) => entity.kind === 'drone' &&
    !entity.hit && entity.x + entity.w > run.player.x &&
    (entity.x - run.player.x - run.player.w) / run.speed < 1.3);
  if (!bridgeNearby && until > 1.1) {
    const bonus = run.entities
      .filter((entity) => entity.kind === 'bonus' && !entity.collected &&
        entity.x + entity.w > run.player.x)
      .map((entity) => ({
        entity,
        arrival: (entity.x + entity.w / 2 - run.player.x - run.player.w / 2) /
          (run.speed * (entity.fly?.speedMultiplier ?? 1) + (entity.fly?.extraSpeed ?? 0)),
      }))
      .filter(({ arrival }) => arrival > 0)
      .sort((first, second) => first.arrival - second.arrival)[0];
    if (bonus) {
      if (run.player.grounded && bonus.arrival < 0.48) jump(run);
      else if (run.player.jumps === 1 && bonus.arrival < 0.36 && run.player.vy > -100) {
        const predictedFeet = run.player.y + run.player.vy * bonus.arrival +
          800 * bonus.arrival * bonus.arrival;
        if (predictedFeet - run.player.height > bonus.entity.y + bonus.entity.h - 12) jump(run);
      }
    }
  }
  if (run.player.grounded && until > 1.5) {
    const pickup = run.entities.find((entity) =>
      (entity.kind === 'shield' || entity.kind === 'magnet') &&
      entity.x > run.player.x && entity.x - run.player.x < run.speed * 0.4,
    );
    if (pickup) jump(run);
  }
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
        autopilot(run);
        stepRun(run, dt);
        displayedGrowth.current += (run.growth - displayedGrowth.current) * (1 - Math.exp(-14 * dt));
        if (run.elapsed >= ROTATE_AFTER_SECONDS || run.status === 'finished') newFriend();
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
  const friendCenter = run.player.x + run.player.w / 2;
  const friendHeight = run.player.slide ? 30 : 60 * growth;
  const spriteFrame = reduced || paused ? 0 : Math.floor(run.elapsed * 12) % 8;

  return <div ref={wrapper} className="preview-run" data-preview-friend={sprites.tokenId.toString()}
    data-preview-distance={Math.floor(run.distance)} data-preview-coins={run.coins}
    data-preview-bonus-coins={run.bonusCoins}
    data-preview-growth={run.growth.toFixed(3)} data-preview-paused={paused}>
    <div className="preview-toolbar">
      <span className="preview-friend">FRIEND #{sprites.tokenId.toString()} <b>{sprites.familyName}</b></span>
      <div className="preview-actions">
        <button type="button" onClick={togglePaused} aria-label={paused ? 'Resume preview' : 'Pause preview'}>{paused ? 'RESUME' : 'PAUSE'}</button>
        <button type="button" onClick={newFriend}>NEW FRIEND ↗</button>
      </div>
    </div>
    <svg className="preview-world" viewBox={`0 0 ${viewWidth} 500`} width="100%" style={{ aspectRatio: `${viewWidth} / 500` }} role="img"
      aria-label={`Autoplay demonstration featuring ${sprites.familyName} Friend #${sprites.tokenId}. Watching does not earn rewards.`}>
      <WorldArt distance={run.distance} elapsed={run.elapsed * 1000} reducedMotion={reduced} biome={Math.floor(run.elapsed / 8)}/>
      {run.entities.map((entity) => <EntityArt key={entity.id} entity={entity} elapsed={run.elapsed} reduced={reduced}/>) }
      <g opacity={run.invulnerable > 0 ? reduced ? 0.65 : Math.floor(run.elapsed * 12) % 2 ? 0.4 : 1 : 1}>
        <ellipse cx={friendCenter} cy="403" rx={32 * growth} ry="3" fill="#000000"/>
        {run.magnet > 0 && <circle cx={friendCenter} cy={run.player.y - friendHeight / 2} r={58 * growth} fill="none" stroke="#CCFF00" strokeDasharray="3 10"/>}
        {run.shield > 0 && <rect x={friendCenter - 38 * growth} y={run.player.y - friendHeight - 10} width={76 * growth} height={friendHeight + 16} fill="none" stroke="#CCFF00" strokeWidth="2"/>}
        <g data-character="preview-friend" data-slide={run.player.slide} data-growth={run.growth.toFixed(3)}
          transform={`translate(${friendCenter - 32 * growth} ${run.player.y - friendHeight}) scale(${4 * growth} ${run.player.slide ? 2 : 4 * growth})`}>
          <FriendSprite sprites={sprites} frame={spriteFrame} walking={!paused}/>
        </g>
      </g>
    </svg>
    <div className="preview-stats" aria-live="off">
      <span><b>{Math.floor(run.distance)}m</b> DISTANCE</span>
      <span><b>{run.coins}</b> COINS</span>
      <span><b>{run.growth.toFixed(2)}×</b> SIZE</span>
      <small>Autoplay · no rewards</small>
    </div>
  </div>;
}

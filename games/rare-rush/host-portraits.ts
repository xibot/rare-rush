import { createPublicClient, http } from 'viem';
import {
  createGenerationSpriteReader, GENERATION_SPRITE_MANIFEST, spriteFrame,
  type GenerationSprites,
} from '@rarefriends/friendsdk/sprites';

// Decorative art only. The SDK owns wallet discovery, eligibility and selection.
const MAX_PORTRAITS = 64;
const MAX_CONCURRENT = 2;
const TIMEOUT_MS = 12_000;
const MAX_TOKEN_ID = (1n << 256n) - 1n;
type Target = {
  menu: HTMLElement;
  button: HTMLButtonElement;
  image: HTMLImageElement;
  tokenId: string;
  state: 'idle' | 'loading' | 'ready' | 'unavailable';
};
type Job = { tokenId: string; targets: Set<Target>; controller?: AbortController };
const cards = new WeakMap<HTMLButtonElement, Target>();
const cache = new Map<string, string>();
const jobs = new Map<string, Job>();
const queue = new Set<Job>();
let active = 0;

function ownedCardId(button: HTMLButtonElement): string | null {
  if (button.querySelector(':scope > small')?.textContent?.trim() !== 'Hardwired Generations') return null;
  const match = /^Friend #([1-9]\d{0,77})$/.exec(button.querySelector(':scope > strong')?.textContent?.trim() ?? '');
  return match && BigInt(match[1]) <= MAX_TOKEN_ID ? match[1] : null;
}

function current(target: Target): boolean {
  return target.menu.isConnected && target.button.isConnected
    && target.menu.contains(target.button) && cards.get(target.button) === target
    && target.image.parentElement === target.button && ownedCardId(target.button) === target.tokenId;
}

function portrait(sprites: GenerationSprites): string {
  // The canonical static front frame, including the SDK's Colossus side fallback.
  // Every coordinate below is generated from validated 16×16 bitmap rows, never RPC HTML.
  const rows = spriteFrame(sprites, 'down', false, 0).frame.rows;
  const pixels: string[] = [], halo: string[] = [];
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const square = `M${x} ${y}h1v1h-1z`;
    if (rows[y][x] === '#') pixels.push(square);
    let near = false;
    for (let yy = Math.max(0, y - 1); yy <= Math.min(15, y + 1); yy++) {
      for (let xx = Math.max(0, x - 1); xx <= Math.min(15, x + 1); xx++) {
        if (rows[yy][xx] === '#') near = true;
      }
    }
    if (near) halo.push(square);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" shape-rendering="crispEdges"><path fill="#fff" d="${halo.join('')}"/><path fill="#000" d="${pixels.join('')}"/></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

async function readPortrait(tokenId: string, signal: AbortSignal): Promise<string> {
  // A per-job reader lets cancellation abort only this public-art request. No wallet transport.
  const client = createPublicClient({ transport: http(GENERATION_SPRITE_MANIFEST.rpcUrl, {
    retryCount: 0, timeout: 8_000, fetchOptions: { signal },
  }) });
  const reader = createGenerationSpriteReader(client);
  let abort = () => {};
  const cancelled = new Promise<never>((_, reject) => {
    abort = () => reject(new DOMException('Portrait request cancelled.', 'AbortError'));
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return portrait(await Promise.race([reader.read(BigInt(tokenId)), cancelled]));
  } finally {
    signal.removeEventListener('abort', abort);
    reader.clear();
  }
}

function show(target: Target, source: string): void {
  if (!current(target)) return;
  target.image.src = source;
  target.image.hidden = false;
  target.image.dataset.portraitStatus = 'ready';
  target.state = 'ready';
}

function prune(): void {
  for (const job of jobs.values()) {
    for (const target of job.targets) if (!current(target)) {
      target.state = 'idle';
      job.targets.delete(target);
    }
    if (job.targets.size) continue;
    jobs.delete(job.tokenId);
    queue.delete(job);
    job.controller?.abort();
  }
}

function pump(): void {
  prune();
  while (active < MAX_CONCURRENT && queue.size) {
    const job = queue.values().next().value;
    if (!job) return;
    queue.delete(job);
    active++;
    const controller = new AbortController();
    job.controller = controller;
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    void readPortrait(job.tokenId, controller.signal).then(source => {
      if (controller.signal.aborted || ![...job.targets].some(current)) return;
      cache.delete(job.tokenId);
      cache.set(job.tokenId, source);
      while (cache.size > MAX_PORTRAITS) cache.delete(cache.keys().next().value!);
      for (const target of job.targets) show(target, source);
    }).catch(() => {
      // Labels and selection always remain available when the public art RPC is slow/down.
      for (const target of job.targets) if (current(target)) {
        target.state = 'unavailable';
        target.image.dataset.portraitStatus = 'unavailable';
      }
    }).finally(() => {
      clearTimeout(timeout);
      if (jobs.get(job.tokenId) === job) jobs.delete(job.tokenId);
      active--;
      pump();
    });
  }
}

/** Call after SDK chooser DOM updates. Repeated calls never refetch or rewrite unchanged cards. */
export function syncFriendPortraits(menu: HTMLElement): void {
  prune();
  if (!menu.isConnected) return;
  for (const button of menu.querySelectorAll<HTMLButtonElement>('.rf-frame-friends > button')) {
    const tokenId = ownedCardId(button);
    if (!tokenId) continue;
    let target = cards.get(button);
    if (!target || target.tokenId !== tokenId) {
      target?.image.remove();
      const image = document.createElement('img');
      image.className = 'rush-friend-portrait';
      image.alt = '';
      image.setAttribute('aria-hidden', 'true');
      image.width = 64;
      image.height = 64;
      image.decoding = 'async';
      image.hidden = true;
      image.dataset.friendId = tokenId;
      target = { menu, button, image, tokenId, state: 'idle' };
      cards.set(button, target);
      button.prepend(image);
    } else if (target.image.parentElement !== button) {
      button.prepend(target.image);
    }
    target.menu = menu;
    if (target.state !== 'idle') continue;
    const cached = cache.get(tokenId);
    if (cached) {
      cache.delete(tokenId);
      cache.set(tokenId, cached);
      show(target, cached);
      continue;
    }
    target.state = 'loading';
    target.image.dataset.portraitStatus = 'loading';
    let job = jobs.get(tokenId);
    if (!job) {
      job = { tokenId, targets: new Set() };
      jobs.set(tokenId, job);
      queue.add(job);
    }
    job.targets.add(target);
  }
  pump();
}

/** Optional on chooser close, disconnect or pagehide. Cached public artwork stays bounded. */
export function cleanupFriendPortraits(): void {
  for (const job of jobs.values()) {
    for (const target of job.targets) target.state = 'idle';
    job.targets.clear();
    job.controller?.abort();
  }
  jobs.clear();
  queue.clear();
}

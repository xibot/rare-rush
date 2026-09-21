import { useEffect, useMemo, useRef, useState } from 'react';
import { createPublicClient, http } from 'viem';
import { GENESIS_DEPLOYMENT, readGenesisPortrait } from './identity';

type PortraitJob = {
  id: bigint; controller: AbortController; started: boolean;
  resolve: (image: string) => void; reject: (error: Error) => void;
};
type PortraitLoader = ReturnType<typeof createPortraitLoader>;
const MAX_ACTIVE = 3, MAX_QUEUED = 128, MAX_CACHED = 64, MAX_CACHE_CHARS = 2_000_000;
const cancelled = () => new Error('Portrait preview cancelled.');

/** Public artwork only. This cache is deliberately separate from game-entry identity checks. */
function createPortraitLoader() {
  // A separate read-only transport bounds preview requests without changing game verification.
  const client = createPublicClient({ cacheTime: 0,
    transport: http(GENESIS_DEPLOYMENT.rpcUrl, { timeout: 6_000, retryCount: 0 }) });
  const cache = new Map<string, string>();
  const active = new Set<PortraitJob>();
  const queue: PortraitJob[] = [];
  let disposed = false, cacheChars = 0;

  function remember(id: bigint, image: string) {
    const key = String(id), previous = cache.get(key);
    if (previous) { cache.delete(key); cacheChars -= previous.length; }
    cache.set(key, image); cacheChars += image.length;
    while (cache.size > MAX_CACHED || cacheChars > MAX_CACHE_CHARS) {
      const first = cache.entries().next().value;
      if (!first) break;
      cache.delete(first[0]); cacheChars -= first[1].length;
    }
  }

  function pump() {
    while (!disposed && active.size < MAX_ACTIVE && queue.length) {
      const job = queue.shift()!;
      if (job.controller.signal.aborted) continue;
      job.started = true; active.add(job);
      const timer = window.setTimeout(() => {
        job.controller.abort(); job.reject(new Error('Portrait preview timed out.'));
      }, 15_000);
      void readGenesisPortrait(client, job.id, { signal: job.controller.signal }).then(image => {
        if (disposed || job.controller.signal.aborted) { job.reject(cancelled()); return; }
        remember(job.id, image); job.resolve(image);
      }, () => job.reject(new Error('Portrait preview is unavailable.'))).finally(() => {
        window.clearTimeout(timer); active.delete(job); pump();
      });
      // Keep the worker occupied until the underlying read ends, even after a timeout,
      // so slow requests cannot accumulate beyond the concurrency limit.
    }
  }

  return {
    load(id: bigint, signal: AbortSignal): Promise<string> {
      if (disposed || signal.aborted) return Promise.reject(cancelled());
      const key = String(id), cached = cache.get(key);
      if (cached) { cache.delete(key); cache.set(key, cached); return Promise.resolve(cached); }
      if (queue.length >= MAX_QUEUED) return Promise.reject(new Error('Portrait preview queue is full.'));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let settled = false;
        const finish = (image?: string, error?: Error) => {
          if (settled) return;
          settled = true; signal.removeEventListener('abort', abort);
          if (error) reject(error); else resolve(image!);
        };
        const job: PortraitJob = { id, controller, started: false,
          resolve: image => finish(image), reject: error => finish(undefined, error) };
        const abort = () => {
          controller.abort(); job.reject(cancelled());
          if (!job.started) { const index = queue.indexOf(job); if (index >= 0) queue.splice(index, 1); }
        };
        signal.addEventListener('abort', abort, { once: true });
        queue.push(job); pump();
      });
    },
    dispose() {
      disposed = true;
      for (const job of [...active, ...queue]) { job.controller.abort(); job.reject(cancelled()); }
      queue.length = 0; cache.clear(); cacheChars = 0;
    },
  };
}

/** New wallet/revision, new cache. No result from a previous session is displayed. */
export function useGenesisPortraits(sessionKey: string | null): PortraitLoader | null {
  const loader = useMemo(() => sessionKey ? createPortraitLoader() : null, [sessionKey]);
  useEffect(() => () => loader?.dispose(), [loader]);
  return loader;
}

export function GenesisPortrait({ id, loader }: { id: bigint; loader: PortraitLoader | null }) {
  const target = useRef<HTMLSpanElement>(null);
  const [result, setResult] = useState<{ loader: PortraitLoader; id: bigint; image: string | null } | null>(null);
  const current = result?.loader === loader && result?.id === id ? result : null;
  useEffect(() => {
    const node = target.current;
    if (!loader || !node) return;
    const controller = new AbortController();
    let started = false;
    const load = () => {
      if (started) return;
      started = true;
      void loader.load(id, controller.signal).then(image => {
        if (!controller.signal.aborted) setResult({ loader, id, image });
      }, () => {
        if (!controller.signal.aborted) setResult({ loader, id, image: null });
      });
    };
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); load(); }
    }, { rootMargin: '100px' });
    observer.observe(node);
    return () => { observer.disconnect(); controller.abort(); };
  }, [id, loader]);

  return <span ref={target} className="genesis-portrait" data-genesis-portrait={String(id)} aria-hidden="true">
    {current?.image ? <img src={current.image} alt="" width="128" height="128" decoding="async" onError={() => loader && setResult({ loader, id, image: null })}/> : <span className="genesis-portrait-placeholder"><span>▧</span>{current ? 'ART UNAVAILABLE' : 'LOADING ART…'}</span>}
  </span>;
}

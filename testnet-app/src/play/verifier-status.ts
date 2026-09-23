export type VerifierAvailability = 'checking' | 'ready' | 'unavailable';
type Fetch = typeof fetch;

/** Bound both the response and its body, including transports that ignore abort. */
export async function fetchVerifierJson(url: string, init: RequestInit = {}, timeoutMs = 20_000, request: Fetch = fetch) {
  const controller = new AbortController();
  const parent = init.signal;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let rejectAbort: (error: Error) => void = () => undefined;
  const abort = () => {
    controller.abort();
    rejectAbort(new Error('Verification connection timed out. Your replay is saved; try again.'));
  };
  const interrupted = new Promise<never>((_, reject) => { rejectAbort = reject; });
  parent?.addEventListener('abort', abort, { once: true });
  try {
    if (parent?.aborted) abort();
    timer = setTimeout(abort, timeoutMs);
    return await Promise.race([
      (async () => {
        const response = await request(url, { ...init, signal: controller.signal });
        return { response, body: await response.json() as unknown };
      })(),
      interrupted,
    ]);
  } finally {
    clearTimeout(timer);
    parent?.removeEventListener('abort', abort);
  }
}

function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}

export function createVerifierStatusMonitor(options: {
  chainId: number; game: string; engineVersion: string;
  onChange: (availability: VerifierAvailability) => void;
  request?: Fetch; timeoutMs?: number; retryDelayMs?: number;
}) {
  let current: { controller: AbortController; promise: Promise<void> } | null = null;
  let disposed = false;
  const same = (actual: unknown, expected: string) => typeof actual === 'string' && actual.toLowerCase() === expected.toLowerCase();

  function check(force = false): Promise<void> {
    if (disposed) return Promise.resolve();
    if (current && !force) return current.promise;
    // A deliberate retry supersedes an older slow request. Its eventual result cannot
    // turn a freshly recovered service back to unavailable.
    current?.controller.abort();
    const controller = new AbortController();
    options.onChange('checking');
    const promise = (async () => {
      for (let attempt = 0; attempt < 2; attempt++) {
        let ready = false;
        let retryable = true;
        try {
          const { response, body } = await fetchVerifierJson('/api/status', { cache: 'no-store', signal: controller.signal }, options.timeoutMs, options.request);
          const data = body && typeof body === 'object' ? body as Record<string, unknown> : {};
          ready = response.ok && data.ready === true && data.chainId === options.chainId
            && same(data.game, options.game) && same(data.engineVersion, options.engineVersion);
          retryable = response.status >= 500 || (response.ok && data.reason === 'rpc-unavailable');
        } catch { /* A timed-out or interrupted connection can be retried once. */ }
        if (disposed || controller.signal.aborted) return;
        if (ready || !retryable || attempt === 1) {
          options.onChange(ready ? 'ready' : 'unavailable');
          return;
        }
        await pause(options.retryDelayMs ?? 800, controller.signal);
        if (disposed || controller.signal.aborted) return;
      }
    })().finally(() => { if (current?.controller === controller) current = null; });
    current = { controller, promise };
    return promise;
  }

  return {
    check,
    dispose() { disposed = true; current?.controller.abort(); current = null; },
  };
}

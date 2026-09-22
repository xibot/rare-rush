import { getAddress, type Address, type EIP1193Provider } from 'viem';

// Remember intent only. The current account and permissions always come from the wallet.
export const WALLET_SESSION_KEY = 'rare-rush-testnet-wallet-session-v1';
export type BrowserWallet = EIP1193Provider & {
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};
type Snapshot = { account: Address | null; chainId: number };
type Callbacks = {
  changed: (snapshot: Snapshot) => void | Promise<void>;
  invalidated: () => void;
  error: (error: unknown) => void;
};

export function createWalletSession(callbacks: Callbacks) {
  let allowed = true, stopped = false, version = 0, intentVersion = 0;
  let observed: BrowserWallet | undefined;
  let snapshot: Snapshot | null = null;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const readIntent = () => {
    try { allowed = localStorage.getItem(WALLET_SESSION_KEY) !== 'disconnected'; }
    catch { /* Keep the current page usable when browser storage is unavailable. */ }
    return allowed;
  };
  const remember = (value: boolean) => {
    allowed = value;
    try { localStorage.setItem(WALLET_SESSION_KEY, value ? 'connected' : 'disconnected'); }
    catch { /* Wallet permissions still determine which accounts are exposed. */ }
  };
  const invalidate = () => { version++; snapshot = null; callbacks.invalidated(); };
  const report = (error: unknown) => { if (!stopped && readIntent()) callbacks.error(error); };
  const changed = () => { if (stopped || !readIntent()) return; invalidate(); void sync().catch(report); };
  // EIP-1193 disconnect means the provider lost its transport, not that the user revoked access.
  const unavailable = () => { if (!stopped) invalidate(); };
  function detach() {
    observed?.removeListener?.('accountsChanged', changed);
    observed?.removeListener?.('chainChanged', changed);
    observed?.removeListener?.('disconnect', unavailable);
    observed = undefined;
  }
  function provider(required = false) {
    const next = (window as Window & { ethereum?: BrowserWallet }).ethereum;
    if (next !== observed) {
      if (observed) { detach(); invalidate(); }
      observed = next;
      observed?.on?.('accountsChanged', changed);
      observed?.on?.('chainChanged', changed);
      observed?.on?.('disconnect', unavailable);
    }
    if (!next && required) throw new Error('Open this page in a wallet browser, or install a browser wallet, then connect.');
    return next;
  }
  async function sync(force = false) {
    const wallet = provider();
    if (stopped || !readIntent() || !wallet) return;
    const requestVersion = ++version;
    let next: Snapshot;
    try {
      const [accounts, chain] = await Promise.all([
        wallet.request({ method: 'eth_accounts' }), wallet.request({ method: 'eth_chainId' }),
      ]);
      if (stopped || requestVersion !== version || !readIntent()) return;
      next = { account: accounts[0] ? getAddress(accounts[0]) : null, chainId: Number(chain) };
    } catch (error) {
      if (stopped || requestVersion !== version || !readIntent()) return;
      invalidate();
      // Locked/revoked wallets must never leave a stale connected account on screen.
      const code = (error as { code?: number }).code;
      if (![4100, 4900, 4901].includes(code ?? 0)) throw error;
      return;
    }
    if (force || !snapshot || next.account !== snapshot.account || next.chainId !== snapshot.chainId) {
      invalidate();
      snapshot = next;
      try { await callbacks.changed(next); }
      catch (error) { if (!stopped && snapshot === next && readIntent()) throw error; }
    }
  }
  const restore = () => { void sync().catch(report); };
  const visible = () => { if (document.visibilityState === 'visible') restore(); };
  const storageChanged = (event: StorageEvent) => {
    if (event.key !== WALLET_SESSION_KEY && event.key !== null) return;
    if (event.storageArea && event.storageArea !== localStorage) return;
    intentVersion++;
    if (readIntent()) restore(); else invalidate();
  };
  return {
    start() {
      readIntent();
      window.addEventListener('storage', storageChanged);
      window.addEventListener('focus', restore);
      window.addEventListener('pageshow', restore);
      window.addEventListener('ethereum#initialized', restore);
      document.addEventListener('visibilitychange', visible);
      restore();
      // Some injected wallets arrive after the document without announcing themselves.
      for (const delay of [1000, 3000]) timers.push(setTimeout(restore, delay));
    },
    async connect() {
      const wallet = provider(true)!;
      const intent = ++intentVersion;
      remember(true);
      await wallet.request({ method: 'eth_requestAccounts' });
      if (!stopped && intent === intentVersion && readIntent()) await sync(true);
    },
    sync,
    disconnect() { intentVersion++; remember(false); invalidate(); },
    stop() {
      stopped = true; version++; intentVersion++;
      detach(); timers.forEach(clearTimeout);
      window.removeEventListener('storage', storageChanged);
      window.removeEventListener('focus', restore);
      window.removeEventListener('pageshow', restore);
      window.removeEventListener('ethereum#initialized', restore);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}

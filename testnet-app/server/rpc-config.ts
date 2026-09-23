const PUBLIC_TESTNET_RPC = 'https://rpc.testnet.chain.robinhood.com';

// Server-only deployment setting. Never accept an endpoint from the browser or
// include it in an error: a provider URL can contain API credentials.
export function verifierRpcUrl(configured: string | undefined): string | null {
  if (configured === undefined) return PUBLIC_TESTNET_RPC;
  const value = configured.trim();
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

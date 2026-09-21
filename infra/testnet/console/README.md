# Local browser-wallet deployment console

This operator tool only binds `127.0.0.1`, only targets Robinhood Chain testnet (`46630`), and is not part of the public game build. It never loads a signer private key. The required deployment owner is `0x6fD155b9D52F80E8A73a8A2537268602978486e2`.

From `infra/testnet`, compile with `npm run compile`, prepare the ignored `operator-config.json` with **public fields only**, then run `node scripts/console.mjs`:

```json
{
  "owner": "0x6fD155b9D52F80E8A73a8A2537268602978486e2",
  "verifier": "YOUR_PUBLIC_VERIFIER_ADDRESS",
  "engineVersion": "YOUR_0x_ENGINE_VERSION_HASH",
  "chainId": 46630
}
```

Open `http://127.0.0.1:4174` in a browser with your wallet extension. The wallet must hold test ETH from the official faucet. Connect explicitly, switch to testnet when needed, and approve the four deployment transactions individually. The fourth transaction deploys both the game and its reward token. Every confirmed deployment is checked against its sender, constructor arguments, receipt and deployed bytecode presence before the next step is enabled. The console estimates gas; review the final fee in the wallet.

Progress is saved in this browser, scoped to owner, verifier and engine version. Keep the tab open while approving. A pending transaction is resumed by receipt verification, never automatically re-sent. If the wallet approval completed before the tab closed but the hash was not saved, paste its transaction hash from wallet activity. If an ambiguous wallet error shows no hash and wallet activity confirms nothing was sent, stop and ask the operator to reconcile that attempt; do not delete storage and blindly redeploy. Explicit wallet rejection is safe to retry.

Download the final manifest and compiler input after all four deployments are verified. Both contain public deployment information only. Changing compiled artifacts blocks reuse of existing progress until matching artifacts are restored. The tool deliberately offers no automatic progress-reset button.

`RUSH_CONSOLE_PORT` optionally changes the local port. The server rejects unknown hosts, cross-origin requests, writes and all unlisted paths. A current browser supporting Web Locks is required to avoid duplicate sends across tabs. The console uses this infrastructure package's pinned esbuild and viem dependencies.

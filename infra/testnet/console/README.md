# Local browser-wallet deployment console

This operator tool binds only `127.0.0.1`, targets only Robinhood Chain testnet (`46630`), and is excluded from the public game build. The required owner and initial launch-reserve recipient are `0x6fD155b9D52F80E8A73a8A2537268602978486e2`. The console never receives a private key.

## Exact first deployment steps

1. In your browser wallet, select the owner address above. Get free **test ETH** from <https://faucet.testnet.chain.robinhood.com>. These contracts use test assets only.
2. From `infra/testnet`, run `npm ci`, `npm run compile`, then `npm run prepare:operator -- 0x6fD155b9D52F80E8A73a8A2537268602978486e2`. Preparation preserves the existing verifier secret in the ignored, permission-restricted `.env.testnet`; do not share it. The ignored `operator-config.json` contains public values only.
3. Run `npm run deploy` for a **read-only preflight**. It checks the RPC chain, owner balance, current engine, compiled constructor shapes and public configuration. It never signs or sends transactions; CLI `--broadcast` is disabled.
4. Run `npm run console`. Open <http://127.0.0.1:4174> in Chrome/Edge/Firefox with your wallet extension, click **CONNECT WALLET**, and **SWITCH TO TESTNET** if prompted. Review the owner, treasury and launch-reserve recipient displayed on the page.
5. Approve each operation individually, in this order. Wait for **VERIFIED** before continuing:
   - **DEPLOY TEST RF** — free faucet tokens for entry fees.
   - **DEPLOY TEST GENESIS** — freely minted test Genesis NFTs.
   - **DEPLOY TEST GENERATIONS** — freely minted test Generations NFTs.
   - **DEPLOY RARE RUSH GAME** — game and verified-claim rules; still inactive without its token.
   - **DEPLOY REWARD TOKEN** — 1.024B capped token, with 102.4M minted to the owner as a provisional launch reserve and 921.6M reserved for gameplay minting.
   - **BIND REWARD TOKEN** — one-time binding of this token to this game. Only the game may mint gameplay rewards.
6. Download **MANIFEST** and **COMPILER INPUT** once all six operations are verified. Send the public manifest to the project operator so they can configure faucets, verifier and game. Keep both files; neither contains a private key.

Deployment alone does not publish a playable testnet game or a Doppler market. The owner holds the 10% reserve; no liquidity pool is created or funded by this flow. The split is an approved **test setting**, not final mainnet economics.

The game uses three starts per NFT per UTC day, free Genesis entry with 100× rewards, and 110 tRF Generations entry split into 100 for the prize pool and 10 to the immutable treasury. Test rewards begin at 10 tRARERUSH per ordinary coin, halve every 10,000 claimed pickups, and stop decreasing at 1 base token per coin before multipliers; difficulty, Genesis and bonus multipliers apply. Gameplay minting stops at the 921.6M gameplay allocation. The initial treasury defaults to the owner; `prepare:operator OWNER TREASURY` can explicitly set another reviewed address.

## Confirmation and recovery

Each operation is checked against the fixed testnet RPC and requires **two block confirmations**. Verification checks the actual sender, destination, zero ETH value, exact compiled creation/constructor data or binding calldata, receipt status, code presence and game/token getters. The final manifest includes all six transaction hashes, separate token and game addresses, artifact fingerprint, constructor arguments and provisional economics. Network fees are estimated before opening the wallet; your wallet shows the final fee.

Progress is checkpointed in this browser before a wallet request and immediately after a transaction hash returns. Keep the tab open while approving. A pending operation only resumes verification; it is never automatically re-sent. If a wallet approval completed but the hash was not saved, paste the transaction hash from wallet activity. Ambiguous errors without a hash stay blocked: reconcile wallet activity before changing anything. An explicit wallet rejection is safe to retry. A matching, confirmed reverted transaction may also retry; an unrelated or modified receipt cannot unlock a retry.

Changing compiled artifacts or public configuration blocks reuse of any existing progress until it is reconciled. Older engine/verifier-scoped records are detected and preserved. An untouched page with no operations can refresh to the current package. Do not clear browser storage or switch browsers to bypass pending-operation checks. There is deliberately no automatic reset button.

`RUSH_CONSOLE_PORT` optionally changes the local port. The server rejects unknown hosts, cross-origin requests, writes and unlisted paths. Web Locks prevent concurrent deployment sends across tabs. The console only serves fixed public assets; it cannot serve `.env.testnet` or arbitrary files.

## Browser verification

With the console running, execute `node console/test-console.mjs` using the root project's Playwright installation. Wallet and chain responses are mocked; no actual transactions are sent. The suite covers all six operations and manifest export, wrong account/network/RPC, wrong token/cap/allocation/binding calldata, rejected and ambiguous wallet requests, manual recovery, confirmation depth and preserved history. Set `PLAYWRIGHT_BROWSERS_PATH` for a shared browser installation and `RUSH_CONSOLE_URL` for another loopback port.

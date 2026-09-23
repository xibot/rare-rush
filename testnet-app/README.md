# Rare Rush testnet game

This workspace contains the Testnet V2 app for the separate `testnet.rarerush.app` / `rarerush-testnet` target. Its new game and reward token are deployed, independently verified and activated in the app profile. Vercel deployed source commit `33a0cba` successfully to [testnet.rarerush.app](https://testnet.rarerush.app) on September 22, 2026. The main vibeathon arcade at `rarerush.app` is unchanged.

`/` provides test faucets; `/dashboard/` shows holdings, saved results, recovery and transactions; `/play/` provides the collection → Friend → difficulty → run flow. V2 ports the approved directional gameplay while preserving the test economy. Its replay protocol is `rare-rush-input-v2`, and its exact source hash is `0x907ff2967abdd97cc172f53c0c69fbcd17f22fcf4ece263e5846bf2973a3accb`.

The app’s central public deployment profile is `src/shared/deployment.json`. A pending or local-rehearsal profile is not proof of deployed contracts. Hosting builds under `VERCEL=1` reject every profile whose status is not `verified`. The [V2 runbook](../docs/TESTNET-V2.md) covers preparation, rehearsal, wallet deployment, verification and activation.

## V2 play flow after verified activation

1. Connect a browser wallet and switch to Robinhood testnet.
2. Use your existing test Genesis or Generations NFT, or mint one in the test kit if needed. Get free test ETH from the linked official faucet for gas. Generations also needs test RF.
3. Open **Play Testnet**, choose Genesis or Generations, then choose your pictured test Friend and difficulty in the arcade cabinet. Generations approves exactly 110 tRF, then pays 110 tRF to start (100 to prizes / 10 to treasury). Genesis starts free.
4. Wait for the confirmed start, then tap **Let’s Rush** to play. The local game timer stays paused while you return from your wallet. The contract seed initializes the approved V2 120 Hz engine. Side sections use jump/slide and pace controls; automatic ascent/freefall sections use left/right steering. Each NFT gets three starts per UTC day; losing or abandoning consumes the attempt and entry fee.
5. Survive the timer with at least one heart. Authorize verification with a gas-free wallet signature, then submit the reward claim transaction. Confirmed claims mint valueless test RARERUSH.

After a loss, choose **Close finished run** and confirm the wallet transaction to release the run's onchain slot. Closing uses test ETH gas but no additional daily attempt or tRF entry fee; it does not refund the used attempt or entry. The next run is a separate explicit start. Closing also works while the verifier is unavailable. If the claim window has already expired, a new run can be started without closing the old one.

V2 reuses the existing tRF, test Genesis and test Generations contracts, so their balances and NFT ownership carry forward without new minting. The V2 reward token is a separate contract: V1 tRARERUSH balances are not converted or moved. All test assets are separate from mainnet Rare Friends. Test characters use cosmetic canonical artwork and do not assert ownership of the corresponding mainnet NFT. They do not become mainnet assets. No public liquidity pool is live.

The Dashboard is a holdings and run-record screen: it has no difficulty picker, entry approval or new-run button. **View Run** opens the saved run in the arcade. Query links such as `/play/?collection=genesis&friend=1` select only verified owned test NFTs; `/play/?run=5` opens only a matching durable saved run. Use Dashboard recovery to retrieve another owned onchain run.

## Local setup and rehearsal

Use Node 22.18 or later and the full repository. Prepare the public V2 config and compile contracts from the repository root:

```sh
npm ci
npm --prefix infra/testnet ci --ignore-scripts
npm --prefix infra/testnet run compile
npm --prefix infra/testnet run prepare:operator
npm --prefix infra/testnet run deploy
```

The last command is a read-only public RPC preflight. Use the **current** predicted game/token nonces from its output for a local rehearsal. For example, if it reports game nonce 148 and token nonce 149:

```sh
cd testnet-app
node scripts/prepare-shared.mjs
npm ci --ignore-scripts
node scripts/rehearse-v2.mjs 148 149
npm test
npm run test:integration
npm run build
npm run dev
```

`rehearse-v2` launches a disposable loopback Hardhat chain, impersonates the public owner there, recreates the reused asset addresses and predicted V2 game/token, binds the token, and records the resulting runtime bytecode. It uses no wallet secret or public RPC and sends no public transactions. It writes a `local-rehearsal` deployment profile, public test config and browser runtime fixture for meaningful local checks. These files are **not a verified release**; the hosting guard still blocks publication. Nonce predictions can change if the owner sends another transaction.

`prepare-shared` stages an allowlist of public engine/artwork/verifier files into ignored `generated/`, checks the approved V2 source hash and protocol, and records SHA-256 digests. It never copies environment files or operator config. Standalone uploads verify this staged package before building. Only the draft Genesis portrait JSON is reused; the draft page stays unpublished.

`npm run dev` serves the UI; Vite alone does not serve the hosted verifier API. The verifier’s canonical origin remains `https://testnet.rarerush.app`. Browser tests mock wallet/RPC/API responses and send no real transactions:

```sh
npx playwright install chromium
npm run test:browser
npm run test:play-browser
```

Set `TESTNET_APP_URL` to a **local** dev server if its port differs. Browser test artifacts are ignored. The opt-in integration test uses a fresh loopback EVM and the selected deployment profile to exercise actual approval → start → recorder/resume → authenticated verification → claim for both collections, with runtime guards enabled. It does not connect to the public RPC or use real wallet secrets.

## Wallet deployment and local activation

The owner `0x6fD155b9D52F80E8A73a8A2537268602978486e2` uses the local console in `infra/testnet/` for three explicit transactions: **deploy V2 game → deploy V2 reward token → bind token**. The existing tRF and NFT contracts are verified read-only and reused. Download `rare-rush-robinhood-testnet-v2.json` and `rare-rush-v2-standard-input.json` when all three operations verify.

Before new gameplay or launch-reserve transfers, run from the repository root:

```sh
npm --prefix infra/testnet run verify:deployment -- /path/to/rare-rush-robinhood-testnet-v2.json /path/to/rare-rush-v2-standard-input.json
node testnet-app/scripts/activate-v2.mjs /path/to/rare-rush-robinhood-testnet-v2.json /path/to/rare-rush-v2-standard-input.json
```

The optional compiler-input argument checks the exact downloaded input. Verification writes `infra/testnet/artifacts/public-deployment-v2-verification.json`; activation uses independent public-chain verification to update the app’s game/token addresses, runtime pins and public config together. It does not deploy the website. Only a verified profile may pass the hosting build guard. Rerun the app checks and build after activation, then deploy only to the separately authorized testnet project.

## Server and deployment

`api/status.ts` and `api/verify-run.ts` run as Vercel Node 22 functions. Configure `RUSH_VERIFIER_PRIVATE_KEY` only as an encrypted, server-only environment variable in the **testnet project**, for its deployment target. The dedicated signer must match the deployed game's verifier. Never use a `VITE_` prefix or a user wallet key.

The browser signs an EIP-712 authorization binding the wallet, run ID, canonical replay hash, fixed game/chain, canonical site and short expiry. The server checks that authorization, confirmed run ownership/eligibility, NFT ownership and engine version, then replays legal inputs and signs only the resulting ordered pickups. Client scores and reward totals are never trusted. The claim contract independently enforces signatures, deadlines, NFT limits, economics and supply cap. This verifies deterministic simulation; it does **not** prove a human played or prevent automated pilots. Production anti-bot/economic controls remain separate work.

Requests are capped at 1.5 MB with strict schemas, expiry checks and bounded local concurrency. The testnet deployment must preserve the configured Vercel firewall limits: `/api/verify-run` at 12 requests/minute/IP and `/api/status` at 60 requests/minute/IP. Keep these distributed limits when deploying V2. Verification accepts only `https://testnet.rarerush.app`; unaliased preview hosts cannot request signed claims.

The dedicated verifier key is not in the source or browser bundle. The app pins five runtime hashes, contract addresses and the engine version through its central deployment profile. The committed `../infra/testnet/deployments/robinhood-testnet-verification.json` is **V1 evidence**. It does not establish that V2 is deployed; use the new verified V2 report after the owner transactions.

## Recovery and test limitations

V2 records use a separate versioned storage key scoped to chain, game and wallet. V1 browser data is preserved and is not loaded as a V2 run. V1 pending runs remain on the old game and retain their original deadlines; use a matching V1 client/verifier to handle them. V2 does not resume, convert or sign V1 recordings.

Run inputs and completed tick count are saved locally; resuming reconstructs the engine from its contract seed. A storage error pauses play and preserves the in-memory recording for retry. Keep the same browser/device; the contract claim window continues while paused and closes 15 minutes after the mode's duration. Claim receipts expire within five minutes; verification can be repeated within the run window.

Pending writes are saved before opening the wallet and block duplicate actions. Receipt recovery checks exact sender, nonce, contract, calldata, events and two canonical confirmations. A hashless wallet response can retry the same transaction at the same nonce or cancel that nonce with a zero-value self-transfer. Never delete a pending checkpoint to resend with a new nonce.

NFT discovery is bounded. Confirmed IDs from the test kit are remembered; missing IDs can be entered manually and ownership is checked. Wallet connections restore silently between the test kit, dashboard and arcade, on reload, and when returning to the page. Only connection intent is saved; the wallet supplies its currently permitted accounts and network. Disconnect is remembered across testnet pages and tabs until an explicit reconnect. Revoked permissions or a locked/unavailable wallet clear the connected UI; restoration never opens a permission prompt, switches networks, signs, or sends a transaction.

Test economics: 1.024B cap, 102.4M launch allocation, 921.6M gameplay allocation. Rewards begin at 10 base tokens per coin, halve each 10,000 claimed pickups, and floor at 1 base token before mode/Genesis bonuses. Easy 120 s/0.75×; Normal 90 s/1×; Degen 60 s/2×; Genesis 100×. These are provisional test settings, not final mainnet economics.

## Assets

The canonical Rare Friends icon, brand fonts and game artwork are reused from the existing arcade. Font licenses are under `public/assets/fonts/`. FriendSDK remains the source of the canonical sprite types/rendering utilities. V2 uses the approved directional engine and scene assets; its immutable hash requires the fresh V2 game deployment. The main arcade is unchanged.

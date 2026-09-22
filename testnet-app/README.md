# Rare Rush testnet game

The independent app at `https://testnet.rarerush.app`, deployed only to XIBOT’s `rarerush-testnet` Vercel project. `/` provides test faucets; `/play/` connects the existing runner to the deployed Robinhood testnet contracts (chain 46630). The main vibeathon arcade at `rarerush.app` is unchanged.

## Play

1. Connect a browser wallet and switch to Robinhood testnet.
2. Get free test ETH from the linked official faucet; mint a test Genesis or Generations NFT in the test kit. Generations also needs test RF.
3. Open `/play/`, choose the test NFT and difficulty. Generations approves exactly 110 tRF, then pays 110 tRF to start (100 to prizes / 10 to treasury). Genesis starts free.
4. Wait for the confirmed start, then play. The contract seed initializes the unchanged 120 Hz game engine. Each NFT gets three starts per UTC day; losing or abandoning consumes the attempt and entry fee.
5. Survive the timer with at least one heart. Authorize verification with a gas-free wallet signature, then submit the reward claim transaction. Confirmed claims mint valueless test RARERUSH.

All test assets are separate from mainnet Rare Friends. Test characters use cosmetic canonical artwork and do not assert ownership of the corresponding mainnet NFT. They do not become mainnet assets. No public liquidity pool is live.

## Local setup

Run these from this directory after checking out the entire repository:

```sh
npm --prefix ../infra/testnet ci --ignore-scripts
npm --prefix ../infra/testnet run compile
node scripts/prepare-shared.mjs
npm ci --ignore-scripts
npm test
npm run test:integration
npm run build
npm run dev
```

`prepare-shared` stages an explicit list of public engine/artwork/verifier files into ignored `generated/`, checks the engine hash against the deployed contract, and records SHA-256 digests. It never copies environment files or operator config. Standalone Vercel uploads include this staged package and verify its integrity before building. Only the draft Genesis portrait JSON is reused; the draft page stays unpublished.

`npm run dev` serves the UI. The verifier requires the canonical testnet origin; Vite alone does not serve the hosted API. Browser tests mock wallet/RPC/API responses and send no real transactions:

```sh
npx playwright install chromium
npm run test:browser
npm run test:play-browser
```

Set `TESTNET_APP_URL` to a **local** dev server if its port differs. Browser test artifacts are ignored. The opt-in integration test starts a fresh loopback EVM, reproduces the five public contract addresses using disposable fixture identities, and exercises actual approval→start→recorder/resume→authenticated verification→claim for both collections. It never connects to public RPC or uses real wallet secrets.

## Server and deployment

`api/status.ts` and `api/verify-run.ts` run as Vercel Node 22 functions. Configure `RUSH_VERIFIER_PRIVATE_KEY` only as an encrypted, server-only environment variable in the **testnet project**, for its deployment target. The dedicated signer must match the deployed game's verifier. Never use a `VITE_` prefix or a user wallet key.

The browser signs an EIP-712 authorization binding the wallet, run ID, canonical replay hash, fixed game/chain, canonical site and short expiry. The server checks that authorization, confirmed run ownership/eligibility, NFT ownership and engine version, then replays legal inputs and signs only the resulting ordered pickups. Client scores and reward totals are never trusted. The claim contract independently enforces signatures, deadlines, NFT limits, economics and supply cap. This verifies deterministic simulation; it does **not** prove a human played or prevent automated pilots. Production anti-bot/economic controls remain separate work.

Requests are capped at 1.5 MB with strict schemas, expiry checks and bounded local concurrency. The testnet project's active Vercel firewall additionally limits `/api/verify-run` to 12 requests/minute/IP and `/api/status` to 60 requests/minute/IP. Preserve these distributed limits when redeploying. Verification accepts only `https://testnet.rarerush.app`; unaliased preview hosts cannot request signed claims.

The dedicated verifier key is not in the source or browser bundle. The app pins the five verified deployment runtimes, contract addresses and engine version. See `../infra/testnet/deployments/robinhood-testnet-verification.json` for public deployment evidence.

## Recovery and test limitations

Run inputs and completed tick count are saved locally; resuming reconstructs the engine from its contract seed. A storage error pauses play and preserves the in-memory recording for retry. Keep the same browser/device; the contract claim window continues while paused and closes 15 minutes after the mode's duration. Claim receipts expire within five minutes; verification can be repeated within the run window.

Pending writes are saved before opening the wallet and block duplicate actions. Receipt recovery checks exact sender, nonce, contract, calldata, events and two canonical confirmations. A hashless wallet response can retry the same transaction at the same nonce or cancel that nonce with a zero-value self-transfer. Never delete a pending checkpoint to resend with a new nonce.

NFT discovery is bounded. Confirmed IDs from the test kit are remembered; missing IDs can be entered manually and ownership is checked. Browser disconnect resets this page's session; the wallet controls its own site permissions.

Test economics: 1.024B cap, 102.4M launch allocation, 921.6M gameplay allocation. Rewards begin at 10 base tokens per coin, halve each 10,000 claimed pickups, and floor at 1 base token before mode/Genesis bonuses. Easy 120 s/0.75×; Normal 90 s/1×; Degen 60 s/2×; Genesis 100×. These are provisional test settings, not final mainnet economics.

## Assets

The canonical Rare Friends icon, brand fonts and game artwork are reused from the existing arcade. Font licenses are under `public/assets/fonts/`. FriendSDK remains the source of the canonical sprite types/rendering utilities. No changes were made to the deployed engine or the main arcade.

# Rare Rush · Robinhood testnet infrastructure

An isolated contract and verifier prototype for **test assets only**. The public vibeathon game still simulates its economy. This directory is excluded from the Vercel upload and is not a new public game route.

## What works

- `RareRushToken`: six-decimal `tRARERUSH`, fixed lifetime cap of **1,024,000,000**, a one-time 10% launch reserve and 90% reserved for verified gameplay minting; no burn or adjustable cap. It inherits the same token implementation validated by `infra/doppler`.
- `RareRushGame`: owner-only, one-time binding to the external reward token; starts remain disabled until binding is complete. NFT-gated starts, three starts per NFT per UTC day, one active run per NFT, signed single-use claims, emergency pause, two-step ownership, verifier rotation, and owner-administered prize awards.
- `TestRF`: a valueless `tRF` faucet, 1,100 per wallet per UTC day (ten paid test entries).
- `TestFriends`: separate, freely mintable test Genesis and test Generations collections. These do **not** represent real Rare Friends ownership.
- A verifier that replays the existing 120 Hz game engine, reconstructs pickups, and signs only runs that survive the timer with at least one heart. Client scores, coins, seeds, and state overrides are never accepted.
- A local browser-wallet deployment console, CLI deployment/preflight, compiler verification input, and an end-to-end local mint demo.

No public verifier endpoint, production wallet-game integration, real-holder bridge, DEX pair, liquidity, or automated leaderboard payout is included in this first infrastructure milestone.

## Run locally

Use Node **22.18 or later**. From the repository root:

```sh
npm ci
npm --prefix infra/testnet ci
npm --prefix infra/testnet test
npm --prefix infra/testnet run demo
```

The tests compile pinned Solidity 0.8.30 with OpenZeppelin 5.6.1 for Cancun, launch a fresh loopback-only Hardhat chain, exercise transactions, and stop the chain. The demo records legal game controls, replays them, signs a result, then mints for both test collections. It saves evidence in `infra/testnet/artifacts/demo-result.json`. These transactions are **local**, not on the public testnet. The fixture pilot demonstrates that a legal-input bot can pass verification; this is not proof of human play.

## Network

| Setting | Value |
| --- | --- |
| Robinhood testnet chain ID | `46630` (`0xb626`) |
| Gas currency | Faucet ETH |
| RPC | `https://rpc.testnet.chain.robinhood.com` |
| Explorer | <https://explorer.testnet.chain.robinhood.com> |
| Faucet | <https://faucet.testnet.chain.robinhood.com> |

Sources: [Robinhood network settings](https://docs.robinhood.com/chain/add-network-to-wallet/), [deployment guide](https://docs.robinhood.com/chain/deploy-smart-contracts/), and [EVM differences](https://docs.robinhood.com/chain/differences-from-ethereum/). Time limits use timestamps: the chain's `block.number` semantics differ from Ethereum. Seeds are public deterministic course identifiers, never secure randomness. Cancun/MCOPY compatibility was checked against the official [ArbOS documentation](https://docs.robinhood.com/chain/run-a-full-node/) and a read-only testnet call.

Every contract constructor rejects chains other than `46630` and local `31337`. Deployment and signing tools independently check the actual RPC chain. The canonical mainnet NFT/RF addresses have no code at those addresses on this testnet; changing an RPC URL cannot migrate them.

The [official asset/faucet check](docs/ASSET_DISCOVERY.md) found no documented Rare Friends NFT/RF faucet deployment for chain 46630 in the vibeathon, FriendSDK, or Rare Friends web repositories. SDK mock contracts are automated-test fixtures. Our faucets are explicitly Rare Rush test assets, not official Rare Friends NFTs or a mainnet ownership bridge.

## Deploy with your browser wallet

From `infra/testnet/`:

```sh
npm run compile
npm run prepare:operator -- 0x6fD155b9D52F80E8A73a8A2537268602978486e2
npm run console
```

Open `http://127.0.0.1:4174` in your wallet-enabled desktop browser. The console is pinned to XIBOT's chosen owner wallet above and asks you to approve six transactions: deploy test RF, test Genesis, test Generations, the game, and the external reward token; then bind that token to the game. The token reserves 102.4 million tokens in the configured owner wallet, with 921.6 million left unminted for gameplay. This reserve is not yet a liquidity pool. Fund that owner with **test ETH** from the official faucet first. Save the downloaded deployment manifest after all receipts succeed. Pending transaction hashes are saved in the browser so a refresh can resume confirmation rather than duplicate deployment.

`prepare:operator` creates a dedicated verifier key in ignored `.env.testnet` with owner-only filesystem permissions and emits an ignored `operator-config.json` containing public addresses only. It reuses an existing local key and never prints it. Back up the secret securely before operating the verifier; never commit it, put it in a browser bundle, or use this test signer for assets with value. The console cannot serve the secret file. This is a local operator setup, not a hosted secrets-management system.

The optional second address argument to `prepare:operator` selects the treasury; it defaults to the owner wallet for this testnet setup. The deployment page displays it before signing. The constructor fixes that address permanently, and every paid start forwards 10 tRF to it atomically. Changing game ownership does not redirect the treasury or the reward token's immutable game minter. The one-time token binding checks the cap, decimals, launch allocation and untouched initial supply before enabling runs. A different treasury or revised immutable economics requires a new game deployment. Refresh the console after recompiling; if any earlier package has a pending or confirmed deployment, it preserves and blocks that progress for reconciliation instead of silently deploying again.

The optional CLI `npm run deploy` performs read-only preflight and reports the artifact fingerprint, configured allocation and test ETH balance. CLI broadcasting is disabled; use the six-operation browser console, which checkpoints each pending transaction and verifies it before enabling the next step. No deployer key is exported or loaded. Never clear existing pending progress to retry an ambiguous transaction. Explorer verification uses `artifacts/standard-input.json`, Solidity `v0.8.30+commit.73712a01`, optimization 200, Cancun, and constructor arguments from the manifest.

## Entry and reward rules

| Rule | Testnet prototype |
| --- | --- |
| Generations entry | **110 tRF** per run |
| Prize-pool share | **100 tRF** retained in the game per paid start |
| Treasury share | **10 tRF** transferred directly to the immutable treasury per paid start |
| Genesis entry | Free |
| Daily allowance | Three **starts**, per collection + token ID, UTC reset |
| Easy / Normal / Degen | 120 / 90 / 60 seconds; 0.75× / 1× / 2× rewards |
| Genesis reward | 100×, stacked with difficulty and bonus coins |
| Flying bonus coin | One pickup, 10× reward |
| Initial ordinary Normal reward | 10 tRARERUSH |
| Global reduction | Halve the base once per 10,000 successful claimed pickups, with a 1-token base floor |
| Launch reserve | **102,400,000 tRARERUSH (10%)**, minted once to the configured owner |
| Gameplay allocation | **921,600,000 tRARERUSH (90%)**, minted only after verified claims |
| Shared cap | **1,024,000,000 tRARERUSH**; final reward clips to remaining supply |
| Claim window | Run duration + 15 minutes from start |
| Verifier receipt validity | Up to five minutes, never beyond the run's claim window |

The cap matches RF's **initial** supply amount from the [official RF docs](https://rarefriends.com/docs/rarefriends). RF itself is issued initially with no later minting; tRARERUSH initially mints only its launch reserve, then mints verified rewards from its remaining gameplay allocation, so the issuance models differ. These remain **test parameters**, not finalized launch economics.

The agreed first-test allocation is 10% launch / 90% gameplay. The initial 10-token base and 10,000-pickup reduction interval remain, but the provisional test curve now has a **1-token base floor** before multipliers. This avoids the old zero-emission dead end and lets continued successful play exhaust the gameplay allocation. It does not establish a calendar date for full emission. The final claim clips to the unminted gameplay budget; Genesis, difficulty and bonus multipliers share this same budget. Mainnet allocations, reward rates, liquidity funding and emission duration still require separate decisions.

The daily counter belongs to the NFT, so transferring it does not reset its allowance. A lost or abandoned run consumes its start and entry fee. Call `abandonRun` to clear that NFT's active slot immediately; otherwise the slot clears when its claim window expires. Only the original player, still owning the NFT, can claim. Transferring the NFT while a run is pending can therefore prevent a claim.

Halving is computed atomically in **successful onchain claim order**, using each run's actual ordered pickup bytes. Failed/unclaimed runs do not advance the counter. Quotes are estimates: other claims may change the rate or exhaust the cap before yours. This is intentionally distinct from the browser's session-only simulation. No tokens are minted on every animation frame or coin pickup.

## Verify a run

The future testnet game adapter must read the confirmed `RunStarted`/`runs(id)` seed and difficulty and record this input format before each engine tick:

```json
{
  "version": "rare-rush-input-v1",
  "frames": [
    { "tick": 0, "jump": false, "slide": false, "pace": 0 },
    { "tick": 70, "jump": true, "slide": false, "pace": 0 }
  ]
}
```

`tick` starts at zero. Frames must be strictly increasing, at most one per tick. Apply slide, pace, then the jump press; advance exactly one `FIXED_STEP`. Omitted ticks apply no new controls (held slide/pace persist). A recorded jump is a press event, not a held key. The input log may not contain claimed totals or custom engine state. Persist the log to allow recovery during the claim window.

Set `RUSH_GAME_ADDRESS` in the operator environment after deployment. The CLI is an operator tool; it does not expose a public service:

```sh
node --env-file=.env.testnet src/sign-run.ts RUN_ID replay.json > receipt.json
```

It checks the fixed chain, confirmed contract state, current NFT owner, verifier epoch, and the deployed engine source hash. It replays the full run and returns signed `claimArgs`. The player wallet then calls `claim(runId, pickupKinds, replayHash, deadline, signature)`. The chain enforces timing, identity, signature, supply cap, and single use. Original pickup order is important at a halving boundary. Any changes to the engine or difficulty source require a new compatible deployment/version.

## Trust and next integration

The verifier and owner are trusted operators. EIP-712 binds a receipt to chain, contract, run, player, seed/configuration, engine, ordered pickups, replay hash, deadline, and verifier epoch. The contract does **not** replay game physics. A compromised verifier, or an owner assigning a malicious verifier, can approve invented results up to the remaining cap and per-NFT entry limits. Public mock NFTs/faucets are intentionally easy to obtain and offer no Sybil resistance. Two RPC confirmations are a basic consistency delay, not finality or reorg protection by themselves.

The owner can pause starts/claims/payouts and rotate the verifier; rotation invalidates all pending runs from old epochs. `abandonRun` remains available while paused. Prize awards are explicit owner transactions bounded by the **100 tRF prize share** and unique award IDs. Treasury funds have already left the game and cannot be spent by `awardPrize`. Incoming payments and the outgoing treasury transfer are checked exactly; any failure rolls back both transfers, the run and its daily attempt. Genesis starts pay neither share. Direct token donations are outside pool accounting. There is no discretionary token-mint function on the game, but verifier authority remains a minting trust assumption.

Before inviting public gameplay: connect a separate testnet host to these contracts, implement wallet-authenticated/rate-limited verifier requests with durable run/replay storage, maintain a server-owned RPC and signer, and rehearse outage/rotation recovery. Real Genesis/Generations holder access requires freshly checked mainnet ownership and a carefully scoped cross-chain attestation system (or another explicit eligibility design). Do not treat the freely minted test NFTs as real-holder verification. A future token pair requires separately chosen exchange contracts and funded liquidity; deploying the reward token creates neither.

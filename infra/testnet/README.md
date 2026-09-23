# Rare Rush · Robinhood testnet infrastructure

Contract and verifier infrastructure for **test assets only**. The owner deployed and bound the Testnet V2 game/token on September 22, 2026. Independent verification passed 66 state checks and two guards, and the app addresses are activated. Hosting checks are in progress. The public vibeathon arcade retains its simulated economy.

## What works

- `RareRushToken`: six-decimal `tRARERUSH`, fixed lifetime cap of **1,024,000,000**, a one-time 10% launch reserve and 90% reserved for verified gameplay minting; no burn or adjustable cap. It inherits the same token implementation validated by `infra/doppler`.
- `RareRushGame`: owner-only, one-time binding to the external reward token; starts remain disabled until binding is complete. NFT-gated starts, three starts per NFT per UTC day, one active run per NFT, signed single-use claims, emergency pause, two-step ownership, verifier rotation, and owner-administered prize awards.
- `TestRF`: a valueless `tRF` faucet, 1,100 per wallet per UTC day (ten paid test entries).
- `TestFriends`: separate, freely mintable test Genesis and test Generations collections. These do **not** represent real Rare Friends ownership.
- A verifier that replays the approved V2 120 Hz directional game engine, reconstructs pickups, and signs only runs that survive the timer with at least one heart. Client scores, coins, seeds, and state overrides are never accepted.
- A local browser-wallet deployment console, CLI deployment/preflight, compiler verification input, and an end-to-end local mint demo.

The separate `testnet-app/` contains the wallet game and hosted verifier adapter. V2 uses a fresh game and reward token, with the existing tRF and test NFT collections. No real-holder bridge, DEX pair, liquidity, or automated leaderboard payout is part of this deployment.

## V1 and V2 deployment evidence

The [V1 public manifest](deployments/robinhood-testnet.json) and [V1 independent verification snapshot](deployments/robinhood-testnet-verification.json) are historical records and remain unchanged. They identify the existing test assets and the earlier game/token. The [V2 manifest](deployments/robinhood-testnet-v2.json) and [V2 verification snapshot](deployments/robinhood-testnet-v2-verification.json) document the new game/token and reused assets. Our verification reports are read-only evidence, not explorer source verification or a security audit.

V2 reuses these contracts after checking their pinned deployed code and ABI:

| Asset | Existing testnet address |
| --- | --- |
| tRF | `0xED668133bab94DD83e537F12B68365c4bC0eC2a3` |
| Test Genesis | `0x7404d2b0461228C6478fdB8850d27d8e65EFD2c3` |
| Test Generations | `0x606dCbFA17b76E4194865a09D6cfb92BE7EE26c3` |

Existing tRF balances, NFT ownership and faucet usage persist. The game’s engine version and the reward token’s authorized minter are immutable, so V2 needs a **new game and a new reward token**, followed by one binding transaction. V1 tRARERUSH remains a separate token; balances and rewards do not migrate into the V2 token. V1 pending runs remain on the V1 game, with their original deadlines. V2 does not resume or verify those recordings; preserve their browser data and use the matching V1 workflow to handle them.

The approved V2 engine hash is `0x907ff2967abdd97cc172f53c0c69fbcd17f22fcf4ece263e5846bf2973a3accb`, with replay protocol `rare-rush-input-v2`. See the [V2 deployment and activation runbook](../../docs/TESTNET-V2.md).

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

## Prepare and deploy V2 with the owner’s browser wallet

From `infra/testnet/`:

```sh
npm run compile
npm run prepare:operator -- 0x6fD155b9D52F80E8A73a8A2537268602978486e2
npm run deploy
npm run console
```

`prepare:operator` reads the existing **public** V1 `operator-config.json`, preserves the verifier identity, and writes ignored `operator-config-v2.json`. It never reads or changes `.env.testnet`, generates a key, or overwrites the V1 config. Owner, treasury and launch-reserve recipient remain `0x6fD155b9D52F80E8A73a8A2537268602978486e2`. The existing public verifier is `0xd3166A769cF352F103A60a385892b599ecCc2B36`.

`npm run deploy` is a **read-only preflight**. It checks chain 46630, reused asset code/ABI, the engine hash and artifact shape, and reports the owner’s test ETH balance, artifact fingerprint, next nonces and predicted CREATE addresses. Predictions are valid only if these are the next owner transactions. They are not deployment evidence. CLI broadcasting is disabled.

Open `http://127.0.0.1:4174` in a wallet-enabled desktop browser. To choose another local port, use `RUSH_CONSOLE_PORT=4184 npm run console`, then open `http://127.0.0.1:4184`. Fund the owner with **test ETH** from the linked official faucet if needed. Connect the owner wallet on Robinhood testnet and approve these actions in order:

1. **Deploy Rare Rush V2 Game** with the V2 engine hash and existing test assets.
2. **Deploy V2 Reward Token** with the new game as its immutable minter and a 102.4M launch reserve to the owner.
3. **Bind Reward Token** to enable the new game, leaving 921.6M tokens reserved for verified gameplay.

Each action records its nonce before opening the wallet. A pending or ambiguous action must be verified before the next one; the console never automatically resends it. Refresh restores V2 progress under a separate storage key and leaves V1 progress untouched. An interrupted wallet response can be recovered by entering the transaction hash. Do not clear checkpoints to bypass recovery. A changed package with V2 transactions already saved remains blocked for reconciliation.

After all three receipts verify, download **`rare-rush-robinhood-testnet-v2.json`** and **`rare-rush-v2-standard-input.json`**. Keep both, without replacing the V1 files. No download contains signing material. Compiler settings remain Solidity `v0.8.30+commit.73712a01`, optimizer 200, Cancun.

Before gameplay or transfers from the V2 launch reserve, verify the downloads from `infra/testnet/`:

```sh
npm run verify:deployment -- /path/to/rare-rush-robinhood-testnet-v2.json /path/to/rare-rush-v2-standard-input.json
```

The compiler-input path is optional. This read-only check writes `artifacts/public-deployment-v2-verification.json` and requires the exact V2 configuration, transaction inputs and nonces, canonical receipts, deployed runtime, binding, economics and access guards at one pinned block. Reused asset balances and mint counters may already be populated. The **new game/token** must still have zero gameplay starts/mints and an untouched launch reserve. V1 manifests are rejected; V1 verification evidence is never overwritten.

Then, from the repository root, prepare the app’s verified V2 address/runtime pins and public config together:

```sh
node testnet-app/scripts/activate-v2.mjs /path/to/rare-rush-robinhood-testnet-v2.json /path/to/rare-rush-v2-standard-input.json
```

Activation is a local configuration step, not a website deployment. Complete the app checks and the separately authorized testnet-site deployment before describing V2 as available. See the [full runbook](../../docs/TESTNET-V2.md) for local rehearsal and pending-production guards.

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

The separately selected future pool policy is a **1% trading fee**, with 5% of collected fees for Doppler and 95% for game revenue. Testnet game revenue uses the owner/treasury wallet above. Mainnet will use a game-admin trading-fee recipient and a separate entry-fee treasury destination, both still to be supplied. This does not change the existing 110 tRF entry split or deploy a market; see the [Doppler fee configuration and local fork proof](../doppler/README.md#selected-trading-fees-and-provisional-launch-settings).

The daily counter belongs to the NFT, so transferring it does not reset its allowance. A lost or abandoned run consumes its start and entry fee. Call `abandonRun` to clear that NFT's active slot immediately; otherwise the slot clears when its claim window expires. Only the original player, still owning the NFT, can claim. Transferring the NFT while a run is pending can therefore prevent a claim.

Halving is computed atomically in **successful onchain claim order**, using each run's actual ordered pickup bytes. Failed/unclaimed runs do not advance the counter. Quotes are estimates: other claims may change the rate or exhaust the cap before yours. This is intentionally distinct from the browser's session-only simulation. No tokens are minted on every animation frame or coin pickup.

## Verify a run

The V2 testnet game adapter reads the confirmed `RunStarted`/`runs(id)` seed and difficulty and records this input format before each engine tick:

```json
{
  "version": "rare-rush-input-v2",
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

It checks the fixed chain, confirmed contract state, current NFT owner, verifier epoch, and the deployed engine source hash. It replays the full run and returns signed `claimArgs`. The player wallet then calls `claim(runId, pickupKinds, replayHash, deadline, signature)`. The chain enforces timing, identity, signature, supply cap, and single use. Original pickup order is important at a halving boundary. V2 hashes the exact approved `difficulty.ts`, classic `engine.ts`, and `twist/engine.ts` sources in canonical path order. Changes to those physics dependencies require a new compatible deployment/version. V1 recordings are rejected by V2.

## Trust and next integration

The verifier and owner are trusted operators. EIP-712 binds a receipt to chain, contract, run, player, seed/configuration, engine, ordered pickups, replay hash, deadline, and verifier epoch. The contract does **not** replay game physics. A compromised verifier, or an owner assigning a malicious verifier, can approve invented results up to the remaining cap and per-NFT entry limits. Public mock NFTs/faucets are intentionally easy to obtain and offer no Sybil resistance. Two RPC confirmations are a basic consistency delay, not finality or reorg protection by themselves.

The owner can pause starts/claims/payouts and rotate the verifier; rotation invalidates all pending runs from old epochs. `abandonRun` remains available while paused. Prize awards are explicit owner transactions bounded by the **100 tRF prize share** and unique award IDs. Treasury funds have already left the game and cannot be spent by `awardPrize`. Incoming payments and the outgoing treasury transfer are checked exactly; any failure rolls back both transfers, the run and its daily attempt. Genesis starts pay neither share. Direct token donations are outside pool accounting. There is no discretionary token-mint function on the game, but verifier authority remains a minting trust assumption.

Before enabling public V2 gameplay: finish the three owner transactions, verify and activate their exact contract/runtime pins, run the app checks, and deploy the separate testnet host with its existing server-only signer and authentication/rate limits. Rehearse outage/rotation recovery. Local rehearsal is not proof of a public deployment. Real Genesis/Generations holder access requires freshly checked mainnet ownership and a carefully scoped cross-chain attestation system (or another explicit eligibility design). Do not treat the freely minted test NFTs as real-holder verification. A future token pair requires separately chosen exchange contracts and funded liquidity; deploying the reward token creates neither.

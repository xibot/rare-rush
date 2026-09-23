# Testnet V2 release and activation

The owner deployed and bound V2 on Robinhood testnet on September 22, 2026. Independent verification passed 66 state checks and two contract guards; the app profile is activated. Vercel marked deployment `dpl_3UjjtdzutC7uQA55kxTegeiV27tq` READY and assigned `https://testnet.rarerush.app` on September 22, 2026. The deployed source commit is `33a0cba`. No site deployment is performed by the commands below.

- Game: `0x415b897FfF5a336A8C3a527bEEF12440eaDc6422`
- Reward token: `0x1c3D191561a7077f944b9967553C21Dd8c26dB71`
- [Public manifest](../infra/testnet/deployments/robinhood-testnet-v2.json) · [Independent verification snapshot](../infra/testnet/deployments/robinhood-testnet-v2-verification.json)

## What changes and what persists

V2 uses the approved directional gameplay, with replay protocol `rare-rush-input-v2` and engine hash:

```text
0x907ff2967abdd97cc172f53c0c69fbcd17f22fcf4ece263e5846bf2973a3accb
```

The hash covers the canonical ordered sources `difficulty.ts`, `engine.ts`, and `twist/engine.ts`. Game contracts keep an immutable engine version; reward tokens keep an immutable authorized game minter. Therefore V2 requires a **fresh game, fresh reward token, and one-time binding**. Contract economics and timing remain unchanged: 1.024B cap, 10% launch / 90% gameplay, 110 tRF paid entry split 100/10, free Genesis entry with 100× rewards, three starts per NFT per UTC day, 120/90/60-second modes, 15-minute claim grace, and 512 maximum pickup bytes per claim.

| Reused contract | Address |
| --- | --- |
| tRF | `0xED668133bab94DD83e537F12B68365c4bC0eC2a3` |
| Test Genesis | `0x7404d2b0461228C6478fdB8850d27d8e65EFD2c3` |
| Test Generations | `0x606dCbFA17b76E4194865a09D6cfb92BE7EE26c3` |

These addresses are checked against pinned V1 runtime hashes and expected interfaces. Their existing tRF balances, NFT ownership and faucet usage persist; they do not need to be newly minted. Approval to spend tRF is game-specific, so a Generations player must approve the new game before its paid entry.

The V1 and V2 reward tokens are separate contracts, even though both use the test symbol `tRARERUSH`. V1 rewards are not converted, transferred or counted against V2’s new supply. The V1 manifest and verification report remain historical evidence. V1 pending runs and their original deadlines remain on the old game; V2 does not resume or verify their recordings. Keep the old browser data and use a matching V1 client/verifier for those runs. V2 starts with its own run IDs, active slots and daily counters.

## 1. Prepare the public package

From the repository root, with Node 22.18 or later and dependencies installed:

```sh
npm --prefix infra/testnet run compile
npm --prefix infra/testnet run prepare:operator -- 0x6fD155b9D52F80E8A73a8A2537268602978486e2
npm --prefix infra/testnet run deploy
```

Owner, treasury and launch-reserve recipient are `0x6fD155b9D52F80E8A73a8A2537268602978486e2`. The public verifier remains `0xd3166A769cF352F103A60a385892b599ecCc2B36`. Preparation reads the old public operator config and writes ignored `infra/testnet/operator-config-v2.json`; it does not read, generate or rotate signing material, or overwrite the V1 config.

The deploy command is read-only. It checks Robinhood testnet chain `46630`, the three reused assets, engine hash and compiled artifacts, then reports test ETH balance, fingerprint, predicted nonces and CREATE addresses. It refuses a pending owner transaction. CLI broadcast is disabled. Predictions are valid only if these are the next owner transactions; use confirmed receipts for activation.

## 2. Rehearse locally

Use the current game and token nonce predictions from preflight. For example, with predictions `148` and `149`, run from `testnet-app/`:

```sh
node scripts/prepare-shared.mjs
node scripts/rehearse-v2.mjs 148 149
npm test
npm run test:integration
npm run build
```

The rehearsal creates a disposable loopback Hardhat EVM with chain ID 46630, impersonates the public owner only there, and recreates the reused addresses and predicted V2 game/token. It requires no wallet secret and makes no public RPC call or public transaction. It records exact local runtime bytecode in the test fixture and sets `src/shared/deployment.json` to `status: "local-rehearsal"`.

That local profile supports end-to-end checks with actual runtime guards. It is not a verified release. `prepare-shared.mjs` blocks hosting builds under `VERCEL=1` unless the deployment profile is `verified`; a pending or rehearsal profile must not be published. Independent verification after the real owner transactions is required to activate the app.

## 3. Approve the three owner transactions

From the repository root:

```sh
RUSH_CONSOLE_PORT=4184 npm --prefix infra/testnet run console
```

Open `http://127.0.0.1:4184` in the owner’s wallet-enabled desktop browser. Connect the owner above on Robinhood testnet. Use the linked official faucet if the owner needs test ETH for gas.

1. **Deploy Rare Rush V2 Game.** The constructor includes the V2 engine hash, existing tRF/NFT addresses, verifier, treasury and launch allocation.
2. **Deploy V2 Reward Token.** Its immutable minter is the new game; 102.4M tokens are reserved in the owner wallet and 921.6M remain for gameplay.
3. **Bind Reward Token.** The game checks the token configuration and untouched initial supply before enabling starts.

Each click is explicit. The console checkpoints a fixed nonce before asking the wallet, verifies the exact transaction and waits for two confirmations before enabling the next operation. It never automatically resends a pending or ambiguous transaction. Use **Resume verification**, or recover a missing hash from wallet activity with **Verify hash**. Keep saved progress if the page or wallet is interrupted; do not clear it to retry. V2 progress has a separate local-storage scope, preserving V1 records.

After all three actions verify, download:

- `rare-rush-robinhood-testnet-v2.json`
- `rare-rush-v2-standard-input.json`

Save them separately from V1. The downloads contain public deployment evidence and compiler input, never private keys. No liquidity pool is deployed.

## 4. Independently verify and activate

Before V2 gameplay or transfers from its launch reserve, run from the repository root:

```sh
npm --prefix infra/testnet run verify:deployment -- /path/to/rare-rush-robinhood-testnet-v2.json /path/to/rare-rush-v2-standard-input.json
node testnet-app/scripts/activate-v2.mjs /path/to/rare-rush-robinhood-testnet-v2.json /path/to/rare-rush-v2-standard-input.json
```

The second path is optional in both commands. Verification uses the fixed public RPC, exact local compiler input and V2 operator config. It checks receipt/canonical block identity, fixed nonces, transaction inputs, deployed bytecode, reused asset identity, game/token binding, economics and access guards. New game/token state must still be untouched; existing reused asset balances and NFT mints are permitted.

The public report is `infra/testnet/artifacts/public-deployment-v2-verification.json`. Its `contracts` and `runtimes` identify the five V2 app dependencies. The activation script performs independent public-chain verification before updating the central deployment profile, runtime pins and public config together. A prediction or local fixture cannot substitute for this step. V1 evidence remains unchanged.

Run the app tests and build again after activation. A `verified` local profile is a prerequisite for a later testnet-project deployment; activation itself does not publish the site or prove the hosted verifier is healthy. Preserve the existing server-only verifier identity, canonical origin and rate limits when performing that separately authorized deployment.

## Release validation

- 100 root gameplay tests; 41 infrastructure contract/replay tests.
- 77 app unit/security tests, plus both emitted/Vercel-built server-runtime tests.
- Six full local-EVM approval/start → recorded run → authenticated verification → reward claim paths: Genesis and Generations in Easy, Normal and Degen.
- 31 deployment-console browser scenarios; full play browser suite including six mobile up/down transition cases, continuous spin, steering and pause/reload.
- Read-only public deployment verification: 66 state checks and two guard checks. Actual production verifier environment reported ready locally against the deployed V2 contracts.
- No unfinished V1 run had an open claim window at the pre-release check (block 123021040).

The public V2 game/token deployment and hosting release are confirmed. Full gameplay/claims were exercised on a disposable local EVM; a player’s first public V2 run is a separate wallet test. Main Arcade source/deployment was not changed by this release.

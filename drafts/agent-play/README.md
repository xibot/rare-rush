# Rare Rush | Agent Play

A local, watchable prototype of an automated Rare Rush player. It uses the existing game engine, legal controls and replay format, including up, down and occasional reverse sections.

## Open the prototype

From the Rare Rush repository, with its existing dependencies installed:

```sh
node drafts/agent-play/serve.mjs
```

Then open **http://127.0.0.1:4220/**. On this Mac, you can also double-click `Launch Agent Play.command` in this folder. Keep that terminal running while using the page; reopen the launcher after restarting your computer. The server binds only to this computer.

`AGENT_PLAY_PORT` can override the port. `AGENT_PLAY_DATA_DIR` can override the replay folder. Build files are generated at startup; restart the server after editing source files.

## Three ways to test

- **Preview:** no wallet. Choose a sample Genesis or Generations Friend and a difficulty, then watch the autopilot. Pause, resume or accelerate playback. This does not represent NFT ownership or mint rewards.
- **Arcade:** connect the wallet holding a real Rare Friends Genesis or Generations NFT on Robinhood mainnet (4663), enter its ID and check the Friend. Ownership is checked again before starting or resuming. The renderer uses that NFT’s actual portrait or sprite data. This path reads the wallet and chain; it requests no token approvals or game transactions. Rewards are simulated.
- **Testnet:** connect a wallet on Robinhood Testnet (46630) and check an owned test NFT. The existing test NFT mints and tRF faucet are available under **Test kit & run recovery**. Genesis has free entry and 100× rewards; Generations requires 110 tRF. The current contracts retain three starts per NFT per UTC day. Each transaction requires an explicit button click and wallet confirmation. After surviving, request verification and then claim separately.

## Autonomous agents and scheduled runs

The browser is optional. Agents can run the same controller from Node, then leave a replay for the page to display. Start with the included no-wallet example:

```sh
node drafts/agent-play/cli.mjs run --job drafts/agent-play/examples/preview-job.json
```

The local skill is [rarerushgame/SKILL.md](skills/rarerushgame/SKILL.md); its linked reference describes Arcade and Testnet job configuration. Install/use the whole skill folder in your agent's skill loader and keep this repository available as its runtime. The page also links to the skill.

A scheduler invokes one job per authorized slot and assigns a stable ID for that slot. Retrying the same ID returns or resumes that run, rather than starting another. Wallet locks prevent overlapping or uncertain Testnet jobs from allocating another entry. Jobs and transaction recovery are saved atomically to `data/jobs/`; completed gameplay remains available even when a later claim needs attention. Do not remove locks to bypass an unresolved transaction.

Arcade supports an agent's real Genesis or Generations NFT. Address-only mode observes its onchain owner; it is not cryptographic proof that the caller controls that wallet. Testnet requires an explicitly configured external signer provider and transaction policy. A compatible agent signer can apply existing authorization without human browser prompts. The provider keeps wallet custody and spending limits in the agent's own environment. No real signer has been configured for this draft, and native Bankr compatibility is not established. The current verifier accepts ECDSA player signatures; smart-contract wallets need additional support.

The scheduler and the computer running jobs must remain available; the webpage need not be open. When the local page opens, it imports and checks finished job replays and refreshes the library automatically. Its default data directory must be the parent of the CLI job directory (`data/jobs`). If jobs run on another machine, their records stay there until you explicitly arrange synchronization. Creating the skill does not install or activate a schedule.

The Testnet path uses the existing deployed contracts and hosted verifier. It does not deploy contracts, enforce a new daily mint cap, or change the live game. The prototype server forwards read-only RPC requests to the public Robinhood Testnet endpoint and signed verification requests to the existing verifier. It needs no private key, Alchemy secret or environment file.

## Replays and recovery

Completed runs are independently replayed by the local server before their score is saved. The library shows one best run per NFT and environment across difficulties; the difficulty filter narrows that comparison. **Locally checked** means the replay reproduces its result; it does not mean an onchain claim or public leaderboard submission was verified.

Replays live in `drafts/agent-play/data/`. This ignored folder survives server restarts and is not uploaded. The local library holds up to 250 runs; archive the folder to keep a backup or begin a new library. Downloads include recorded inputs and, for Arcade, the artwork used in that run.

Testnet checkpoints and pending transaction references additionally live in this browser’s local storage, under a prototype-specific prefix. Use the same browser and local URL to resume. **Save & exit** retains the most recent Testnet checkpoint; incomplete Preview and Arcade runs are not saved. Do not clear browser storage while a Testnet run or transaction is pending. The recovery controls can check a transaction hash or reopen a known onchain run. A Testnet loss uses the existing explicit close-run transaction; consumed daily attempts and entry fees are not refunded.

## Current scope

This is a deterministic autopilot prototype with a local skill and headless job interface. Public skill hosting, native Bankr integration, a public leaderboard, signed community hearts and daily NFT mint caps are later work.

No production files, deployments or contracts are changed by launching this draft. Browser Testnet transactions use visible wallet actions; unattended Testnet jobs require their explicit policy and an already authorized external signer. Automated jobs do not mint NFTs or call faucets.

## Validation

```sh
node --test drafts/agent-play/runner.test.ts drafts/agent-play/arcade.test.ts drafts/agent-play/testnet.test.ts
node --test drafts/agent-play/jobs.test.ts drafts/agent-play/cli.test.ts drafts/agent-play/headless-testnet.test.ts drafts/agent-play/wallet-provider.test.ts
node --test drafts/agent-play/server.test.mjs
node node_modules/typescript/bin/tsc -p drafts/agent-play/tsconfig.json
node node_modules/typescript/bin/tsc -p drafts/agent-play/tsconfig.headless.json
node drafts/agent-play/serve.mjs --build-only
node drafts/agent-play/browser-check.mjs
```

The browser check uses installed Chrome, an isolated local port and temporary data. Tests cover deterministic replay, invalid inputs, ownership gates, actual artwork decoding and persistence, wallet changes, responsive layouts and mocked Testnet approval/start/verification/claim recovery. Headless checks cover duplicate and overlapping jobs, durable crash recovery and replay retention before claiming. An isolated end-to-end check ran two CLI jobs for one Friend, retried one without a duplicate, and confirmed automatic library refresh, best-run selection and watchable replay. Live read-only checks confirmed current Testnet contract configuration and verifier readiness during development. A complete transaction sequence using a real wallet has not been broadcast as part of these prototype checks.

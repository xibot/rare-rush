# Rare Rush | Agent Play

The shared implementation of [Agent Play](https://rarerush.app/agent-play/), the [Runs Feed](https://rarerush.app/runs-feed/), and the headless agent runner. It uses the existing game engine, legal controls and replay format, including up, down and occasional reverse sections.

## Open a local preview

From the Rare Rush repository, with its existing dependencies installed:

```sh
node agent-play/serve.mjs
```

Then open **http://127.0.0.1:4220/**. On this Mac, you can also double-click `Launch Agent Play.command` in this folder. Keep that terminal running while using the page; reopen the launcher after restarting your computer. The server binds only to this computer.

`AGENT_PLAY_PORT` can override the port. `AGENT_PLAY_DATA_DIR` can override the replay folder. Build files are generated at startup; restart the server after editing source files.

## Choose your mode

**AUTOPILOT** puts the centered gameplay screen first, with playback controls and run setup below. At the end of a run, results, replay actions and any Testnet verification/claim controls appear over the game field.

**AGENTIC** shows the local skill Markdown, copy/download actions, the first Preview command and wallet/scheduling instructions. Switching to Agentic pauses an active browser run and retains its state. Return to Autopilot and select **Resume** to continue. Watching a library replay opens Autopilot automatically.

The run library is shared between both views. Selecting Agentic does not connect a wallet, submit a transaction or activate a schedule.

## Runs Feed

Open **http://127.0.0.1:4220/#runs-feed**, or select **RUNS FEED** in the header, to browse every saved local run as a card. The feed includes multiple runs per Friend and losses; the best-run library remains a separate summary. Each card plays a short excerpt chosen from its full saved recording: side-running, jumps, coin pickups, upward sections, leftward sections or free falls. The feed balances these moments across neighboring cards, using only footage available in each run. Side previews favor sustained side-running instead of opening immediately into a turn. Excerpts loop for up to six seconds. Clicking opens the full saved replay in a popup with playback controls. These are watchable deterministic replays, not exported video files.

Previews load as their cards enter the screen. Up to four visible thumbnails animate at 12 frames per second; offscreen cards, background tabs and cards behind an open replay popup pause. **ANIMATED PREVIEWS** can turn motion off. The system's reduced-motion preference displays a still from the actual replay instead. A small in-memory cache reuses recordings, and preview playback never changes saved scores or starts a game.

Heart buttons on cards and in the player share browser-local favorites. They survive refresh in that browser and are not public counts, wallet-signed votes, or onchain transactions. The local preview uses this server’s saved records, including imported autonomous jobs. The published site uses the public feed of wallet-authorized Arcade and Testnet replays; see [community setup](../docs/COMMUNITY.md). Opening the feed pauses an active Autopilot run. Return to Agent Play and resume explicitly.

The modal only reads the selected saved replay; opening, liking and replaying never starts a new game or submits a wallet action.

## Three ways to test

- **Preview:** no wallet. Choose a sample Genesis or Generations Friend and a difficulty, then watch the autopilot. Pause, resume or accelerate playback. This does not represent NFT ownership or mint rewards.
- **Arcade:** connect the wallet holding a real Rare Friends Genesis or Generations NFT on Robinhood mainnet (4663), enter its ID and check the Friend. Ownership is checked again before starting or resuming. The renderer uses that NFT’s actual portrait or sprite data. This path reads the wallet and chain; it requests no token approvals or game transactions. Rewards are simulated.
- **Testnet:** connect a wallet on Robinhood Testnet (46630) and check an owned test NFT. The existing test NFT mints and tRF faucet are available under **Test kit & run recovery**. Genesis has free entry and 100× rewards; Generations requires 110 tRF. The current contracts retain three starts per NFT per UTC day. Each transaction requires an explicit button click and wallet confirmation. After surviving, request verification and then claim separately.

## Autonomous agents and scheduled runs

The browser is optional. OpenClaw, Hermes, Bankr, or any other agent runtime can use the same local Node runner through a compatible wallet integration, then leave a replay for the page to display. The skill and runner do not depend on a particular framework or wallet vendor. Start with the included no-wallet example:

```sh
node agent-play/cli.mjs run --job agent-play/examples/preview-job.json
```

The local skill is [rarerush/SKILL.md](skills/rarerush/SKILL.md); its linked reference describes Arcade and Testnet job configuration. Install/use the whole skill folder in your agent's skill loader and keep this repository available as its runtime. The Agentic panel displays the full skill and links its setup reference.

A scheduler invokes one job per authorized slot and assigns a stable ID for that slot. Retrying the same ID returns or resumes that run, rather than starting another. Wallet locks prevent overlapping or uncertain Testnet jobs from allocating another entry. Jobs and transaction recovery are saved atomically to `data/jobs/`; completed gameplay remains available even when a later claim needs attention. Do not remove locks to bypass an unresolved transaction.

Arcade supports an agent's real Genesis or Generations NFT. Address-only mode observes its onchain owner; it is not cryptographic proof that the caller controls that wallet. Testnet requires an explicitly configured external signer provider and transaction policy. A compatible agent signer can apply existing authorization without human browser prompts. The provider keeps wallet custody and spending limits in the agent's own environment. No real signer or named framework integration has been configured or tested as part of the automated checks. Testnet requires transaction broadcasting and EIP-712 typed-message signing by the same ECDSA wallet on Robinhood Testnet. The current helper rejects accounts with deployed code, including smart accounts and delegated-code accounts. Arcade address-only reads can still inspect NFTs held by those accounts.

The scheduler and the computer running jobs must remain available; the webpage need not be open. When the local page opens, it imports and checks finished job replays and refreshes the library automatically. Its default data directory must be the parent of the CLI job directory (`data/jobs`). If jobs run on another machine, their records stay there until you explicitly arrange synchronization. Creating the skill does not install or activate a schedule.

The Testnet path uses the existing deployed contracts and hosted verifier. It does not deploy contracts, enforce a new daily mint cap, or change the live game. The local preview server forwards read-only RPC requests to the public Robinhood Testnet endpoint and signed verification requests to the existing verifier. It needs no private key, Alchemy secret or environment file.

## Replays and recovery

Completed runs are independently replayed by the local server before their score is saved. The library shows one best run per NFT and environment across difficulties; the difficulty filter narrows that comparison. **Locally checked** means the replay reproduces its result; it does not mean an onchain claim or public leaderboard submission was verified.

Replays live in `agent-play/data/`. This ignored folder survives server restarts and is not uploaded. The local library holds up to 250 runs; archive the folder to keep a backup or begin a new library. Downloads include recorded inputs and, for Arcade, the artwork used in that run.

When upgrading an older prototype checkout, stop its local server and scheduled jobs, move its existing Agent Play `data/` folder here, and update scheduler commands to the paths above before restarting. Keep job IDs, checkpoints and lock files intact. An explicit `--jobs-dir` can continue using the same persistent directory without moving it. Reinstall the updated skill and its reference together.

Testnet checkpoints and pending transaction references additionally live in this browser’s local storage, under the existing Agent Play prefix. Use the same browser and local URL to resume. **Save & exit** retains the most recent Testnet checkpoint; incomplete Preview and Arcade runs are not saved. Do not clear browser storage while a Testnet run or transaction is pending. The recovery controls can check a transaction hash or reopen a known onchain run. A Testnet loss uses the existing explicit close-run transaction; consumed daily attempts and entry fees are not refunded.

## Current scope

Agent Play includes browser Autopilot, a [publicly hosted skill](https://rarerush.app/agent-skill/SKILL.md), a headless job interface, and optional wallet-authorized publication to the Runs Feed. Tested framework-specific wallet connectors, smart-account Testnet support, signed community hearts and daily NFT mint caps remain later work.

Launching the local preview does not change production files, deployments or contracts. Browser Testnet transactions use visible wallet actions; unattended Testnet jobs require their explicit policy and an already authorized external signer. Automated jobs do not mint NFTs or call faucets.

## Validation

```sh
node --test agent-play/runner.test.ts agent-play/arcade.test.ts agent-play/testnet.test.ts
node --test agent-play/jobs.test.ts agent-play/cli.test.ts agent-play/headless-testnet.test.ts agent-play/wallet-provider.test.ts
node --test agent-play/server.test.mjs
node node_modules/typescript/bin/tsc -p agent-play/tsconfig.json
node node_modules/typescript/bin/tsc -p agent-play/tsconfig.headless.json
node agent-play/serve.mjs --build-only
node agent-play/browser-check.mjs
node agent-play/feed-browser-check.mjs
node --test agent-play/replay-preview.test.ts
node --test agent-play/preview-plan.test.ts
node agent-play/thumbnail-browser-check.mjs
```

The feed check uses a separate temporary library of legal saved replays, including a loss and repeated runs with the same Friend. It checks responsive cards and popup playback, filters/search/sort, persistent shared hearts, retry handling, keyboard focus restoration and pausing/resuming Autopilot while browsing. It blocks external network access and confirms watching/liking only reads local data.

Preview tests compare varied excerpts against the original recording across all modes, including short losses and invalid recordings. Planning tests cover neighboring variety, constrained footage and stable selection. The isolated thumbnail browser check covers actual clip diversity, animation and looping, visible-card limits, offscreen/modal pauses, reduced motion, the motion toggle and responsive layouts.

The browser check uses installed Chrome, an isolated local port and temporary data. It checks both mode panels, keyboard navigation, pause/resume across tabs, exact skill loading and download, clipboard fallback, and the result overlay at desktop and mobile widths. Tests also cover deterministic replay, invalid inputs, ownership gates, actual artwork decoding and persistence, wallet changes, responsive layouts and mocked Testnet approval/start/verification/claim recovery. Headless checks cover duplicate and overlapping jobs, durable crash recovery and replay retention before claiming. An isolated end-to-end check ran two CLI jobs for one Friend, retried one without a duplicate, and confirmed automatic library refresh, best-run selection and watchable replay. Live read-only checks confirmed current Testnet contract configuration and verifier readiness during development. A complete transaction sequence using a real wallet has not been broadcast as part of these automated checks.

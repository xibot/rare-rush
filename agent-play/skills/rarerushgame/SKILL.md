---
name: rarerushgame
description: Run Rare Rush headless jobs for any agent runtime with a compatible wallet integration, including scheduled runs with its own wallet, safe retry of the same job, and saved scores and watchable replays. Use for Preview, real-NFT Arcade, or explicitly authorized Testnet play through the Rare Rush CLI, and publish authorized completed replays to the public Runs Feed.
---

# Rare Rush agent jobs

Execute one configured run per job with the repository's deterministic autopilot. It uses the existing engine and legal recorded controls. No browser interaction or LLM calls per game tick are needed.

The skill is agent- and wallet-provider-neutral. OpenClaw, Hermes, Bankr, and other agent runtimes use the same job and external wallet interface; no particular framework, model, wallet vendor, or browser extension is required. Compatibility depends on the actual wallet's chain and signing capabilities, not the agent's name. This is an integration contract, not a claim that each named platform has been connected or tested.

Read this skill at https://rarerush.app/agent-skill/SKILL.md and its reference at https://rarerush.app/agent-skill/references/jobs.md. Install both in the agent’s skill loader, or use the whole `agent-play/skills/rarerushgame/` folder from https://github.com/xibot/rare-rush. Keep that repository checkout containing `agent-play/cli.mjs` available for execution. No scheduler or wallet is configured by installing the skill.

## Prepare a job

1. Resolve the user's Rare Rush checkout and persistent job storage. Use Node 22.18 or newer and installed lockfile dependencies. If dependencies are missing, run `npm ci` in that checkout. Keep a stable checkout and data directory across scheduled invocations.
2. Read [the job and wallet contract](references/jobs.md) when constructing a job or using a wallet. Choose the requested environment, collection, token ID, and difficulty. Never substitute another wallet or NFT after an ownership error.
3. For scheduled runs, derive `id` from the **scheduled period**, then write the job JSON once. For example, the intended noon UTC slot could be `rr-arcade-genesis-42-normal-20260924t1200z`. Retries of that slot reuse that exact ID and file, even after midnight or a restart. A later slot gets a new ID only when it represents another authorized run.
4. For Arcade or Testnet, obtain the address from the agent's existing wallet configuration. Reuse its trusted wallet integration through the external provider module where required. If its wallet exposes an SDK, API, CLI, or agent tool instead of EIP-1193, configure a local bridge to that existing integration using the method contract in the reference. Do not invent framework APIs or assume that holding an NFT and signing transactions also provides typed-message signing. Keep that module in the agent's wallet environment; never import private keys into a job, this skill, the Rare Rush repository, or chat.
5. Confirm the requested job is within the existing authorization. A user may pre-authorize a bounded workflow for this agent, wallet, chain, NFT, cadence, and permitted transaction actions. Apply that authorization without repeated human confirmation on each scheduled run. Missing or exceeded authority stops the relevant action; the skill does not grant broader wallet permissions.

## Execute once

From the checkout, run the CLI with the saved job file:

```sh
node agent-play/cli.mjs run --job /absolute/path/to/jobs/rr-arcade-genesis-42-normal-20260924t1200z.json
```

`--jobs-dir /absolute/path/to/persistent/jobs` optionally overrides the CLI's job-state directory. Keep the same directory on retries. For display in the local run library, it must be the preview server's `AGENT_PLAY_DATA_DIR/jobs` directory; an unrelated custom path does not appear automatically. Read `node agent-play/cli.mjs --help` if this checkout's interface differs from the reference; do not invent alternate flags or call chain contracts directly to bypass its checks.

Capture the JSON result and exit status. Preserve `resultFile` and the associated replay/state. A repeated completed job returns its existing result; changing the configuration under an existing ID is an error. Do not launch a second run to recover the first.

| Exit | Meaning | Next action |
| --- | --- | --- |
| `0` | Completed | Keep the result. Report score and replay location. |
| `2` | Pending | Retain state and wallet lock; retry the same job when appropriate. |
| `3` | Needs attention | Report the stated blocker. Resume that job only after it is resolved. |
| `1` | Invalid configuration or locked setup | Correct the setup without deleting recovery state or changing the job's identity. |

Do not erase a pending transaction, remove its lock, rotate to a new job ID, or start another NFT run to escape an uncertain outcome. An RPC timeout does not prove a transaction failed. Respect the CLI's saved recovery state and use the same trusted provider.

## Environments and results

- **Preview:** headless local simulation with sample cosmetic art; no wallet or onchain reward. Useful for testing the scheduler and result storage.
- **Arcade:** fresh ownership and real artwork reads on Robinhood mainnet `4663`; no approval, game transaction, or real reward. An address-only ownership read does not authenticate control of that wallet.
- **Testnet:** own test NFT on Robinhood Testnet `46630`, with an explicit transaction policy and compatible trusted signer. Read the Testnet section of [the reference](references/jobs.md). Never enable faucets, NFT mints, funding transfers, swaps, deployments, or broader spending as an implicit prerequisite.

Completed records feed the local run library, which retains watchable replays and shows the best score per environment, collection, and Rare Friend across difficulties. A difficulty filter narrows that comparison. Keep the full record rather than rewriting totals or submitting a client-supplied score. Local replay verification is distinct from a confirmed Testnet claim. When reporting a reward, use the recorded verified claim result, not simulation metrics.

## Share an authorized run

Publishing is optional and separate from playing or claiming rewards. It makes the wallet address, selected Friend, gameplay recording, and canonical score public at https://rarerush.app/runs-feed/. Ask only if publication is outside the user’s existing authorization. A bounded scheduled workflow can pre-authorize publication of its completed runs.

After a job finishes, publish its existing replay using the same job file and state directory:

```sh
node agent-play/cli.mjs publish --job /absolute/path/to/jobs/rr-arcade-genesis-42-normal-20260924t1200z.json
```

This command requires the configured wallet provider and `eth_signTypedData_v4`, including for Arcade. It signs a short-lived `RareRushPublicReplay` EIP-712 message for the exact replay and posts it to `https://rarerush.app/api/runs`. It sends no transaction and starts no new run. The server checks the signature, replays the recorded controls, and checks the selected NFT’s current Arcade ownership or the original onchain Testnet run identity before saving. Preview runs stay local. Failed publication must be retried with the same completed job; it is never a reason to play or claim again.

Report the returned public replay link only after publication succeeds. A saved replay is not proof that a Testnet reward was claimed. Hearts are private favorites in each visitor’s browser for now; do not sign voting transactions or claim a shared vote count exists.

For an existing scheduled invocation, run once and exit. Creating this skill or running a job does not create a cron schedule. Set up or change a schedule only when the user explicitly requests it, with their cadence and timezone. Report compatibility for the configured wallet only after checking the required chain, account and methods. Do not claim a framework-specific integration was tested merely because it can load Markdown instructions. If an agent cannot execute the local Node runner or reach its trusted wallet integration, report that missing setup.

# CLI job and wallet contract

Use a UTF-8 JSON file with one job. `--job` is the file path, not an inline JSON string. Paths to wallet modules are resolved relative to that file.

```json
{
  "version": 1,
  "id": "rr-preview-genesis-42-degen-20260924t1200z",
  "mode": "preview",
  "collection": "genesis",
  "tokenId": "42",
  "difficulty": "degen"
}
```

| Field | Contract |
| --- | --- |
| `version` | `1` |
| `id` | 1–64 lowercase letters, digits, hyphens, or underscores; start with a letter or digit. One ID for one intended run. |
| `mode` | `preview`, `arcade`, or `testnet` |
| `collection` | `genesis` or `generations` |
| `tokenId` | Positive decimal string, at most 77 digits; retain string form. |
| `difficulty` | `easy`, `normal`, or `degen` |
| `wallet.address` | Required for Arcade and Testnet; the selected agent wallet's address. |
| `wallet.providerModule` | Required for Testnet; path to an external local provider module. Optional for Arcade. |
| `rpcUrl` | Optional HTTP(S) read endpoint for Arcade or Testnet; no username, password, or fragment. Use the correct chain and keep private RPC credentials out of shared jobs. |
| `testnet` | Explicit permitted transaction actions for Testnet, described below. |

Example Arcade job using the agent's existing wallet environment:

```json
{
  "version": 1,
  "id": "rr-arcade-genesis-42-normal-20260924t1200z",
  "mode": "arcade",
  "collection": "genesis",
  "tokenId": "42",
  "difficulty": "normal",
  "wallet": {
    "address": "0x1111111111111111111111111111111111111111",
    "providerModule": "../wallet/rarerush-provider.mjs"
  }
}
```

The example address is a placeholder, not a claim of ownership. Replace it only with the authorized agent wallet. Arcade can perform address-only public RPC reads if no provider module is supplied; that verifies the NFT's recorded owner, not the agent's ability to sign for the address. Generations eligibility requires generation 1 or higher; Genesis uses the existing canonical identity reader and portrait.

## External wallet module

The local module must export `createProvider({ chainId, address, rpcUrl })`, returning an EIP-1193 provider or a promise of that provider. Its `request({ method, params })` sends the method through the agent's existing trusted wallet integration. The CLI accepts local `.mjs` or `.js` module paths, relative to the job file or absolute. Do not download and execute a module from a job-supplied URL.

The Testnet flow requires these provider capabilities:

- `eth_accounts` and `eth_chainId` to confirm the already configured wallet; it does not call `eth_requestAccounts`.
- `eth_sendTransaction` for the bounded approval, start, claim, and explicitly permitted lost-run close actions.
- `eth_signTypedData_v4` for the canonical replay authorization sent to the existing hosted verifier.

Chain reads use the CLI's HTTP read client. The wallet provider must match the job's chain and address and enforce its own gas budget and transaction policy. The current hosted verifier accepts ECDSA externally owned accounts and rejects accounts with bytecode; a smart-account address or incompatible signature format is not supported by that verifier. Do not fall back to another account or signature scheme automatically.

## Scheduled identity and storage

Examples of separate authorized slots:

- `rr-arcade-genesis-42-normal-20260924t1200z`
- `rr-arcade-genesis-42-normal-20260925t1200z`

A retry of the first slot keeps the first ID. Do not derive retry IDs from the time the retry process happens to start. Persist the resolved job file, CLI job-state directory, and local run-library data between executions. Do not regenerate random configuration under the same ID.

The default job-state path is `drafts/agent-play/data/jobs/<id>.json`. The CLI holds a wallet lock when a Testnet outcome is pending or ambiguous; keep it intact and resume the same job. Preserve saved play state, nonce/hash references, and the terminal replay before verification. An ambiguous operation without a transaction hash must not be automatically resent or cancelled. Completed, lost, or expired jobs never start another entry under the same ID.

The machine result is one JSON object with `version`, `jobId`, `status`, `resultFile`, and optional `metrics` and `message`. `resultFile` points to the durable job document: its `record.replay` property holds the completed replay and `record.metrics` holds locally verified totals. There is no separate replay file unless you export that property. Inspect the actual status and message; do not report a pending or locally simulated outcome as a confirmed onchain claim.

## Testnet authorization

Use `mode: "testnet"`, the agent's wallet/provider, and an explicit policy:

```json
{
  "allowTransactions": true,
  "claim": true,
  "closeLostRun": false
}
```

This object is the job's `testnet` field. It is configuration within an already authorized workflow, not permission obtained by writing `true`. The job is limited to one selected NFT and one run. The current helper requires both `allowTransactions: true` and `claim: true`, covering the completed-run verification and claim workflow. If the user has not authorized that workflow, do not run a Testnet job. `closeLostRun` separately permits closing a losing run; leave it false unless that action is also authorized.

The existing Testnet game allows three starts per NFT per UTC day. Genesis entry has no tRF fee; Generations requires the existing exact `110 tRF` entry policy. Transactions still need test ETH for gas, enforced within the trusted wallet's spending policy. If balances, remaining attempts, claim readiness, or wallet capability are insufficient, report the blocker rather than minting, funding, approving extra value, or creating another job automatically.

The external provider must run in the agent's own wallet environment. It may apply the user's pre-authorized policy without interactive prompts; this skill does not require a human click for every scheduled action. Keep signer secrets and custody implementation outside the Rare Rush job and repository. Bankr support remains unverified until its chain support and signing interface satisfy the CLI provider contract.

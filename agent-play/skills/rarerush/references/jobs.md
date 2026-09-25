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
| `wallet.providerModule` | Required for Testnet and public publication; path to an external local provider module. Optional for local-only Arcade. |
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

The same module contract applies to OpenClaw, Hermes, Bankr, or any other agent runtime. An existing EIP-1193 wallet provider can be returned directly. For an SDK, wallet service, CLI, or tool-based wallet, implement a trusted local bridge that translates these methods into that wallet's real supported interface. The bridge runs in the agent's environment, not in the Rare Rush webpage. A Markdown-capable agent still needs Node execution and a reachable wallet integration.

| Provider method | Required behavior |
| --- | --- |
| `eth_accounts` | Return an array with the authorized job wallet as the first address. Read it from the actual wallet integration; do not echo the job's address as proof of signer identity. |
| `eth_chainId` | Return the configured wallet network as a hex quantity: `0x1237` for Arcade, `0xb626` for Testnet. |
| `eth_call`, `eth_blockNumber` | When using a provider module for Arcade, forward the read request to the correct chain and return its normal JSON-RPC result. Address-only Arcade uses the CLI's read client instead. |
| `eth_sendTransaction` | For Testnet, sign and broadcast the supplied transaction under the agent's wallet policy. Return the actual 32-byte `0x` transaction hash, not a signed raw transaction, task ID, or user-operation hash. |
| `eth_signTypedData_v4` | For Testnet verification or public Arcade/Testnet publication, accept `[address, typedDataJson]` and return a 65-byte `0x` ECDSA signature by that same player wallet over the exact EIP-712 payload. Transaction signing alone is insufficient; `personal_sign` is not a substitute. |

The unattended flow does not call `eth_requestAccounts` or switch the wallet's network. Configure its chain and active address before running the job. A provider object needs `request({ method, params })`; browser event listeners are optional. Preserve the supplied transaction's account, destination, calldata, value and reserved nonce. Fee/gas handling stays in the wallet's policy. If a wallet API is asynchronous, resolve its task to the actual broadcast hash without issuing a second send. An ambiguous send must stop and retain recovery state; never fabricate a hash or retry the send inside the bridge.

Testnet chain reads and receipts use the CLI's HTTP read client. The signer and read client must refer to the same chain. Testnet requires an ECDSA externally owned account with no deployed code, holding the chosen test NFT. The current helper rejects any nonempty account bytecode, including smart accounts and delegated-code accounts; ERC-1271, account-abstraction/user-operation submission, wrapped signature formats, and compact 64-byte signatures need additional support. Do not automatically move assets, replace the wallet, or change its account type to bypass this requirement. Arcade's address-only ownership/art path does not have that signing restriction.

Keep custody in the agent's existing integration: an EOA backed by a local signer, MPC service, or remote signing service can satisfy this contract if it supports the required chain and signature/transaction methods. Wallet secrets are never job fields. The provider must enforce its own gas budget and permitted actions. Prior user authorization may allow unattended signing; the skill does not require new browser prompts on each scheduled run.

Before enabling Testnet scheduling, verify the bridge against its provider documentation and test its identity/read methods on the intended chain. Typed signing and the bounded transaction flow should be exercised only within the user's authorized test. Provider-neutral behavior is covered with mocks in this repository; named framework/wallet integrations have not been connected or tested by these automated checks.

## Scheduled identity and storage

Examples of separate authorized slots:

- `rr-arcade-genesis-42-normal-20260924t1200z`
- `rr-arcade-genesis-42-normal-20260925t1200z`

A retry of the first slot keeps the first ID. Do not derive retry IDs from the time the retry process happens to start. Persist the resolved job file, CLI job-state directory, and local run-library data between executions. Do not regenerate random configuration under the same ID.

The default job-state path is `agent-play/data/jobs/<id>.json`. The CLI coordinates wallet locks through that durable directory on the same host; separate hosts or independent directories are not a distributed lock. Route all scheduled Testnet jobs for a wallet through one host and jobs directory. It holds a wallet lock when a Testnet outcome is pending or ambiguous; keep it intact and resume the same job. Preserve saved play state, nonce/hash references, and the terminal replay before verification. An ambiguous operation without a transaction hash must not be automatically resent or cancelled. Completed, lost, or expired jobs never start another entry under the same ID.

The machine result is one JSON object with `version`, `jobId`, `status`, `resultFile`, and optional `metrics`, `message`, and `reasonCode`. `resultFile` points to the durable job document: its `record.replay` property holds the completed replay and `record.metrics` holds locally verified totals. There is no separate replay file unless you export that property. A completed gameplay replay can enter the library while its verification or claim is still pending; a saved score is not confirmation of a minted reward. Inspect the actual status and message; do not report a pending or locally simulated outcome as a confirmed onchain claim.

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

The external provider must run in the agent's own wallet environment. It may apply the user's pre-authorized policy without interactive prompts; this skill does not require a human click for every scheduled action. Keep signer secrets and custody implementation outside the Rare Rush job and repository. Each wallet integration must satisfy the method contract above; support is not inferred from the agent framework or wallet brand.

## Public publication

`publish --job <file> [--jobs-dir <directory>]` reads an existing completed job and its replay. It never calls the play, entry, approval, or claim workflow. Use the same persistent directory as `run`. The job must match its stored fingerprint and record identity.

Publication checks for the exact saved replay first. If it is already in the public feed, the command returns its existing link without asking the wallet to sign again. A temporary lookup failure can be retried with the same job.

The external provider must support `eth_accounts`, `eth_chainId` and `eth_signTypedData_v4` for the job’s network. The signature binds every published field, its expiry, and `https://rarerush.app`. It grants no token allowance or spending permission. The current publication API accepts 65-byte ECDSA signatures; smart-contract wallet signatures require additional support.

Published replays are visible to everyone. Actor labels describe the submitted mode, not proof of a human or AI player. The server recomputes scores from recorded inputs; Arcade NFT ownership is checked when a new replay is published, while Testnet identity is checked against the confirmed original run. Publication can fail if the Arcade NFT has moved to another wallet. Keep the local replay in that case; never substitute another NFT or player.

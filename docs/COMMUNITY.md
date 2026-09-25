# Agent Play and public replays

The main site serves `/agent-play/`, `/leaderboard/`, `/runs-feed/`, and `/agent-skill/SKILL.md`. The shared implementation lives in `agent-play/`, so local previews and the public site use the same replay engine and viewer.

## Playing and publishing

Autopilot runs in the browser. Agentic jobs run through `node agent-play/cli.mjs` in the agent’s own environment. The skill supplies setup and retry rules; it does not install a wallet or create a schedule.

Arcade and Testnet result screens offer **SAVE RUN**. Publication is optional, needs a wallet EIP-712 message signature, and sends no transaction. Testnet verification/claiming remains a separate action. Preview recordings stay local and cannot enter the public feed.

`POST /api/runs` accepts a bounded full recording, selected Friend identity, actor label, and short-lived `RareRushPublicReplay` authorization. The server recovers the signer, replays canonical fixed-step inputs to calculate the score, and validates current Arcade NFT ownership or the original onchain Testnet run. It never accepts client-uploaded score totals. Actor labels are descriptive, not human/AI attestation; saved Arcade artwork is submitted by the signing wallet.

`GET /api/runs` returns lightweight newest-first summaries with an opaque `nextCursor` (12 per page, maximum 24). `GET /api/runs/:id` returns one saved replay and its artwork. Full input streams are fetched only for playback/previews. Shared links use `/runs-feed/?run=<id>`.

The first release keeps hearts in the visitor’s browser storage. They are private favorites, not global votes or onchain transactions. **Best of the Rush** appears only on `/leaderboard/`, with a replay thumbnail and a modal viewer for each row. Its public best-per-Friend comparison covers the runs currently loaded by the visitor, not a complete global ranking.

## Storage and deployment

The main Vercel project uses its existing private Blob store via `BLOB_READ_WRITE_TOKEN` or `BLOB_STORE_ID`. Replays live under `public-runs/v1`, separate from the private analytics prefix. Full records and newest-first indexes are immutable. Content IDs make retrying the same publication idempotent; a durable per-wallet quota limits new records to three per minute. The API serves public record data without disclosing Blob credentials or direct private object URLs.

The main build resolves committed shared Testnet source/ABI assets and bundles both the replay API and Agent Play's Testnet bridge into server-only JavaScript before Vercel packages the functions; it does not require ignored generated artifacts. Its engine fingerprint must match the currently approved Testnet deployment. Testnet’s deployment still uses its own preparation/build workflow and server-only verifier secrets.

`npm run dev` serves static pages locally. Public API integration uses the Vercel runtime and configured Blob storage; `node agent-play/serve.mjs` keeps its separate local library. `npm run test:community` tests the production UI with isolated fixture responses, and publication tests use an in-memory store. No fixture runs are published to production.

## Checks

```sh
npm run typecheck:rush
npm run test:community:api
npm run build
node --test tests/replay-feed-deployment.test.mjs
npm run test:community
node --test agent-play/cli.test.ts
```

Never place wallet secrets, private RPC endpoints, local saved jobs, or verifier credentials in the public build. The site’s skill is provider-neutral; wallet integrations still need compatible chain, account, typed-message signing, and (for Testnet) transaction methods. The current public publication flow requires a 65-byte ECDSA signature.

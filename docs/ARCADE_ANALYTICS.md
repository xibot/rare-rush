# Private Arcade analytics

Arcade records starts and completed runs from the production game. This is **client-reported usage**, not verified scores, proof of NFT ownership, onchain activity, or a count of individual people. There is no historical backfill: runs before analytics was enabled cannot be recovered.

The builder wallet `0x6fD155b9D52F80E8A73a8A2537268602978486e2` is always excluded on the server before persistence. Other wallets are transformed into keyed HMAC identifiers. Raw wallet addresses and IP addresses are not written by the analytics handlers. Reports contain aggregate counts only.

## Production configuration

Use a **private** Vercel Blob store connected to the main Arcade project in **Production only**. Preview and development should remain unconfigured unless intentionally running isolated tests with a separate store. The Testnet app does not use these events.

Server environment variables:

| Variable | Purpose |
| --- | --- |
| `BLOB_READ_WRITE_TOKEN` | Blob access token, stored as a Vercel Secret. The Blob SDK resolves this automatically. |
| `BLOB_STORE_ID` | Alternative store identifier when using the Blob SDK's automatic Vercel OIDC authentication. A token is not required when OIDC is configured correctly. |
| `RUSH_ANALYTICS_HASH_KEY` | Secret with at least 32 characters. Creates wallet pseudonyms and authenticates run receipts and event indexes. |
| `RUSH_ANALYTICS_ADMIN_KEY` | Separate secret with at least 32 characters. Authenticates the private stats endpoint. |

Keep all credentials server-side. Do not use a `VITE_` prefix, commit environment files, send keys to browser JavaScript, or place them in URLs. The handlers fail closed with HTTP 503 if storage or either analytics secret is absent. Updating production environment values requires deploying the application again.

## Endpoints

`POST /api/arcade-events` accepts JSON from the exact production origins `https://rarerush.app` and `https://rarerush.vercel.app`. Localhost, previews, Testnet, missing/null origins, compressed bodies, unknown fields, and bodies larger than 2 KB are rejected. No permissive CORS response is sent.

The start event includes a UUID, connected wallet, collection, and difficulty. Its response contains a signed run receipt. A finish event uses that receipt with its elapsed time and `time` or `hearts` finish reason. Receipts expire after six hours; elapsed-time checks include a 15-second allowance because gameplay does not wait for telemetry delivery. These checks reduce malformed reports but do not verify gameplay or authenticate wallets. Scripted callers can imitate a browser origin and invent events.

`GET /api/arcade-stats?days=7`, `days=30`, or `days=all` requires `Authorization: Bearer <RUSH_ANALYTICS_ADMIN_KEY>`. Missing/incorrect authentication receives HTTP 401. Responses are `Cache-Control: no-store`, and contain no wallet identifiers or Blob URLs. Use the local stats reader to keep the administrator key outside the browser.

Reports group runs by **UTC start date**. Seven/thirty-day windows include today and the previous six/twenty-nine UTC days. A run finishing after midnight remains in its start-date cohort. `all` includes all recorded start dates. `earliestObservedStart` is the earliest recorded start within the selected window.

All totals, collection groups, difficulty groups, and daily rows contain:

- `uniquePlayers`: distinct reported wallet pseudonyms with an accepted start.
- `startedRuns`: accepted, distinct run IDs.
- `completedRuns`: starts with an accepted finish.
- `survivedRuns`: finishes reported as reaching the timer.
- `lostRuns`: finishes reported as running out of hearts.
- `unfinishedRuns`: starts with no accepted finish. This can include interrupted sessions or missing telemetry; it does not prove abandonment.

The response includes `scope.source = client-reported-arcade-events`, `historicalBackfill = false`, `ownerExcluded = true`, and `complete = true`. A report that exceeds resource limits returns an error instead of partial counts.

## Storage and operating limits

Each event uses an immutable canonical object plus a signed, date-indexed object under `arcade-analytics/v1/`. All writes use private access, deterministic paths, no random suffixes, and no overwrites. Retries reuse the same run ID and receipt. Atomic create-if-absent writes prevent duplicate counting or conflicting outcomes across server instances; there are no shared read/modify/write aggregate counters. A retry can repair an interrupted index write.

Reports list signed index paths rather than downloading every event body. Seven/thirty-day scans use overlapping month prefixes with exact timestamp filtering. Limits are 20,000 index objects, 60 listing pages, and seven seconds per scan. Larger ranges return HTTP 503 with `scan-limit`; stalled storage returns HTTP 503 with `storage-timeout`. No partial totals are returned. A bounded 15-second in-process cache reduces repeated listing costs, so reports can lag briefly behind another instance's writes or Blob propagation.

Ingestion has best-effort **per-instance**, minute-based limits: 20 starts per pseudowallet, 90 events per keyed request-origin label, and 600 events total. The origin label derives from the Vercel forwarding header and is HMACed with the current minute; the raw IP is not retained. Report scans are limited to 12 per minute per instance, after administrator authentication. Repeated immutable writes are coalesced in bounded warm caches. Requests limited by these checks receive HTTP 429 and `Retry-After: 60`.

These are not distributed quotas: multiple instances and invented wallets can bypass their overall totals. Origin checks are not bot protection. For a larger launch or abuse incident, configure Vercel WAF/rate limits and storage spend monitoring. Analytics must never block gameplay; request failures may cause undercounting.

## Secret rotation

**Administrator key:** generate a new independent secret, update Production, redeploy, and update the local reader's `.env.analytics.local` file before refreshing. Historical event data is unaffected. Retire any older accessible deployment that should no longer accept the old credential.

**Blob credential:** rotate through Vercel, keep access restricted to the private store, and redeploy. This does not change event identities.

**Hash key:** do not casually replace it. It signs existing index paths and receipts as well as defining wallet pseudonyms. Replacing it without migration makes existing indexes invisible to current reports and invalidates outstanding receipts; totals would appear to reset. A planned rotation needs a versioned migration and explicit handling of old data/active runs, or a deliberately documented new measurement period. Preserve this secret securely outside source control.

## Validation

Run `node --test tests/arcade-analytics.test.mjs`. Tests cover secret/configuration failures, authorization and origins, owner exclusion, schema/body limits, pseudonym privacy, cross-instance idempotence, interrupted-write recovery, receipt validation, finish deduplication, UTC cohorts, aggregation, scan deadlines/caps, rate limits, and private Blob options. Live smoke tests should use a separate QA prefix or the excluded owner; do not invent production player events to test reporting.

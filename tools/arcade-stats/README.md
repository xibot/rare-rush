# Private local Arcade and Testnet stats

On macOS, double-click **Open Rare Rush Stats.command** in this folder. The older **Open Arcade Stats.command** also works. The launcher opens the local dashboard and reuses an existing recognized instance. Otherwise, it starts the local server in the background. No credentials are passed through the launcher.

Or run from the repository root:

```sh
node tools/arcade-stats/server.mjs
```

Open <http://127.0.0.1:4217>. The server binds only to `127.0.0.1`; it does not publish a dashboard or create a public route. It serves bundled Rare Rush fonts and artwork without browser requests to external sites.

Switch between **Arcade** and **Testnet** at the top. Both show unique playing wallets, starts, collection/difficulty breakdowns, daily activity, and CSV exports. Your owner wallet is excluded from both. Testnet also offers **all versions**, **current V2**, and **legacy V1** filters. Open <http://127.0.0.1:4217/#testnet> to go directly to Testnet.

Save these settings in the repository root's ignored `.env.analytics.local` file:

```dotenv
RUSH_ANALYTICS_URL=https://rarerush.app/api/arcade-stats
RUSH_ANALYTICS_ADMIN_KEY=your-existing-admin-key
# Optional: your Alchemy Robinhood Testnet HTTPS endpoint
RUSH_TESTNET_RPC_URL=
```

The local Node server reads the settings on each stats request and sends the Arcade key only in the upstream HTTPS Authorization header. The key and private RPC URL never appear in HTML, browser JavaScript, browser storage, CSV files, or logs. If you edit this file while the dashboard is open, use Refresh. Do not commit it. The existing `.env*` ignore rules apply; `tools/` is excluded from deployment uploads too.

The seven-day and thirty-day windows include today's UTC date and the preceding six or twenty-nine dates. Runs belong to their start date, including settlements or finishes reported later. Unique playing wallets are not unique people. Wallet counts across modes, collections, and contract versions may overlap.

**Arcade** uses client-reported events collected from the live game. It cannot reconstruct activity from before tracking started, and blocked requests or closed tabs may leave runs unfinished or unrecorded. Collection continues when the local dashboard is closed.

**Testnet** reads onchain history on demand; it does not need a new collector or contract deployment. Chain 46630 and the V1/V2 game addresses are fixed in `testnet.mjs`. A private Alchemy endpoint is already configured on the owner's computer; if this setting is omitted or empty, the reader uses the official public Robinhood Testnet RPC. Testnet works independently of the Arcade admin key. Existing chain records remain public even though this dashboard is local.

Testnet runs are classified as claimed, explicitly abandoned, or unresolved. Unresolved runs are split into open and expired claim windows. They are **not confirmed losses**, and a claim does not necessarily mean a positive token reward. Status is read at one pinned block; the dashboard displays that snapshot's block and time. All-history includes both contract deployments by default. Run rows and addresses are processed only in short-lived local memory; only aggregate counts reach the browser.

The Testnet reader has a 15-second deadline, batches of 25 calls, a 15-second memory cache, and a 5,000-run scan limit across the selected contracts. Exceeding the limit shows an error instead of partial totals. At that scale, replace the full-history scan with an incremental indexer. Selecting a shorter date window does not bypass the scan limit.

A failed request displays an error, not zero counts. A prior successful view remains explicitly marked stale. CSV exports are available only after a real aggregate response is loaded. The dashboard performs no automatic polling.

## Checks

```sh
node --test tools/arcade-stats/server.test.mjs tools/arcade-stats/testnet.test.mjs
node tools/arcade-stats/visual-check.mjs
```

The visual check launches an isolated browser and serves fixed, clearly labeled test data without reading real credentials or contacting the live analytics service/RPC. It covers both modes, switching, filters, error/empty states, exports, and desktop/mobile layouts. Screenshots and its report stay in the ignored `tools/arcade-stats/artifacts/` folder. It needs permission to open a local loopback server and launch headless Chrome. The dashboard never falls back to test data.

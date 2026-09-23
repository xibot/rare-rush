# Private local Arcade stats

On macOS, double-click **Open Arcade Stats.command** in this folder. It opens the local dashboard and reuses an existing recognized instance. Otherwise, it starts the local server in the background. No credentials are passed through the launcher.

Or run from the repository root:

```sh
node tools/arcade-stats/server.mjs
```

Open <http://127.0.0.1:4217>. The server binds only to `127.0.0.1`; it does not publish a dashboard or create a public route. It serves bundled Rare Rush fonts and artwork without browser requests to external sites.

Save these two settings in the repository root's ignored `.env.analytics.local` file:

```dotenv
RUSH_ANALYTICS_URL=https://rarerush.app/api/arcade-stats
RUSH_ANALYTICS_ADMIN_KEY=your-existing-admin-key
```

The local Node server reads the settings on each stats request and sends the key only in the upstream HTTPS Authorization header. The key never appears in HTML, browser JavaScript, browser storage, query strings, CSV files, or logs. If you edit this file while the dashboard is open, use Refresh. Do not commit it. The existing `.env*` ignore rules apply; exclude `tools/` from deployment uploads too.

The seven-day and thirty-day windows include today's UTC date and the preceding six or twenty-nine dates. Runs belong to their start date, including finishes reported later. Unique playing wallets are not unique people. Wallet counts across modes and collections may overlap. The configured owner wallet is excluded. Events are client-reported; this dashboard does not establish independently verified player counts or reconstruct activity from before tracking started.

A failed request displays an error, not zero counts. A prior successful view remains explicitly marked stale. CSV exports are available only after a real aggregate response is loaded. The dashboard performs no automatic polling.

## Checks

```sh
node --test tools/arcade-stats/server.test.mjs
node tools/arcade-stats/visual-check.mjs
```

The visual check launches an isolated browser and serves fixed, clearly labeled test data without reading the real admin key or contacting the live analytics service. Screenshots and its report stay in the ignored `tools/arcade-stats/artifacts/` folder. It needs permission to open a local loopback server and launch headless Chrome. Production mode never falls back to test data.

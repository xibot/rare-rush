# Rare Rush

By XIBOT · [Public source repository](https://github.com/xibot/rare-rush)

A retro SVG arcade runner **by XIBOT**, using canonical Rare Friends artwork. A public landing page shows a random Friend jumping, sliding and growing through an autoplay run. Choose Easy (120s), Normal (90s) or Degen (60s), with tougher obstacles, more scattered coins and higher demo rewards in harder modes. Surprise bear coins fly in at double size for 10× the current mode's demo coin reward, within the shared emission cap.

The playable Arcade now follows connected horizontal, upward and free-fall tracks. Every run opens on the classic lane; surprise ceiling intakes and floor breaks lead into fast shafts with coins, obstacles and continuous character rotation. Shaft exits occasionally send the runner left: Easy saves rare reversals for late in the run, Normal adds occasional reversals, and DEGEN gets more surprises. The seed fixes the same route on replay. Left/right controls steer in vertical sections; on horizontal tracks, hold the running direction to accelerate. The site, wallet gates, original run durations and simulated reward rules remain the same. The landing preview remains unchanged. The same presentation is available in the separate Testnet app, preserving its V2 physics and replay protocol.

```sh
npm ci
npm run dev
```

Open http://localhost:4173 for the landing page and wallet-free autoplay preview. The play button opens http://localhost:4173/arcade/ to choose a collection. Genesis holders use `/genesis/` with fresh ownership checks and their original portrait on a random animated Generations body; eligible hardwired Generations holders (generation ≥1) use the unchanged FriendSDK route at `/play/`. Both need a browser wallet on Robinhood mainnet (4663). Their matching entry pages show original artwork on Friend selection cards, with a top Choose Collection link to return to the collection selector. Phone controls are built in; open https://rarerush.app in your wallet’s browser for HTTPS wallet play.

The visual [Rare Rush pitch](https://rarerush.app/pitch/) introduces the playable character experience, its game loop, the current demo economy and the planned token integrations. It includes a wallet-free autoplay run and links directly to the arcade.

The public [Rare Rush 101 guide](https://rarerush.app/docs/) explains controls, difficulty, growth, surprise coins, and token plans using canonical SVG art and interactive examples. Its reward calculator uses the same reward code as the game to compare standard Generations rewards with the playable 100× Genesis demo boost.

Genesis selects one body per run from 36 compatible Generations bodies, without back-to-back repeats; slide squeezes the whole character to fit under obstacles. Bodies remain cosmetic, with unchanged collision and reward rules.

The Genesis animation showcase is preserved as an unpublished draft in [drafts/genesis-prototype/](drafts/genesis-prototype/). It is excluded from the public build.

**This is a simulated economy prototype.** Entry fees, the reward token and prize pool have no monetary value and do not make transactions. The game implements a working local preview of the intended diminishing reward model. Verified Genesis testers enter free and earn 100× demo tokens per coin, stacked with difficulty and flying bonuses before the shared issuance cap. Real RARERUSH minting, the RARERUSH / RAREFRIENDS pair, and prize payouts remain future integrations.

See [game instructions and exact rules](games/rare-rush/README.md), [economy design](docs/ECONOMY.md), and [submission details](docs/SUBMISSION.md).

Run `npm run typecheck:rush`, `npm run test:rush`, `npm run check`, `npm run build`, `npm run test:browser`, `npm run test:landing`, `npm run test:docs`, `npm run test:pitch`, `npm run test:entry`, `npm run test:genesis`, `npm run test:bonus`, and `npm run test:twist` to validate Rare Rush. The unmodified FriendSDK v0.1.2 package is included for reproducibility. `dist/` is the static hosting output, with the landing page at its root, the public guide in `docs/`, the judge-facing pitch in `pitch/`, collection choice in `arcade/`, the Genesis tester host in `genesis/`, and the SDK game inside `play/`.

The Rare Rush entry was submitted to the Rare Friends Vibeathon on September 20, 2026: [submission PR #22](https://github.com/spokesz/rarefriends-vibeathon/pull/22). It is open for organizer review.

## Deployment

The `rarerush` Vercel project belongs to XIBOT and serves [rarerush.app](https://rarerush.app) and [rarerush.vercel.app](https://rarerush.vercel.app). The committed configuration installs locked dependencies with `npm ci`, runs `npm run build`, and publishes `dist/` plus the two analytics API functions; the package selects Node.js 22. It preserves `/pitch/`, `/docs/`, `/arcade/`, `/genesis/`, `/play/`, and the sandbox documents without a catch-all rewrite. Gameplay requires no server secrets. Optional private analytics uses server-only credentials described below. Deployment remains separate from vibeathon submission.

## Private Arcade statistics

Arcade hosts send a small event when a connected player starts a run and when that run ends naturally. The owner wallet is excluded. The collector stores a keyed wallet identifier in private Vercel Blob storage, never the raw wallet address or IP address. Read access requires a separate server-side key. Collection is best effort, does not gate gameplay, and is disabled on local/preview origins. These are client-reported playing-wallet counts, not a count of distinct people; closed tabs, blocked requests, or connection failures can leave runs unfinished or unrecorded. Earlier runs cannot be backfilled.

The private dashboard runs on your computer:

```sh
npm run analytics:local
```

Open http://127.0.0.1:4217. Its ignored `.env.analytics.local` file contains the API URL and read key; the key stays in the local server. Closing the dashboard does not stop production collection. See [dashboard setup and operations](tools/arcade-stats/README.md). Dashboard source is included in the repository, but its pages are excluded from deployment. Local secrets and stored statistics are not published to GitHub.

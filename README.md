# Rare Rush

By XIBOT · [Public source repository](https://github.com/xibot/rare-rush)

A retro SVG arcade runner **by XIBOT**, using canonical Rare Friends artwork. A public landing page shows a random Friend jumping, sliding and growing through an autoplay run. Choose Easy (120s), Normal (90s) or Degen (60s), with tougher obstacles, more scattered coins and higher demo rewards in harder modes. Surprise bear coins fly in at double size for 10× the current mode's demo coin reward, within the shared emission cap.

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

Run `npm run typecheck:rush`, `npm run test:rush`, `npm run check`, `npm run build`, `npm run test:browser`, `npm run test:landing`, `npm run test:docs`, `npm run test:pitch`, `npm run test:entry`, `npm run test:genesis`, and `npm run test:bonus` to validate Rare Rush. The unmodified FriendSDK v0.1.2 package is included for reproducibility. `dist/` is the static hosting output, with the landing page at its root, the public guide in `docs/`, the judge-facing pitch in `pitch/`, collection choice in `arcade/`, the Genesis tester host in `genesis/`, and the SDK game inside `play/`.

The Rare Rush entry was submitted to the Rare Friends Vibeathon on September 20, 2026: [submission PR #22](https://github.com/spokesz/rarefriends-vibeathon/pull/22). It is open for organizer review.

## Testnet contract development

An isolated [Robinhood testnet infrastructure workspace](infra/testnet/README.md) adds capped test-token minting, NFT run limits, entry/prize accounting, and a verifier that replays game inputs before authorizing claims. Its test assets and local wallet deployment console are separate from the submitted simulated game and excluded from the Vercel upload. See that workspace for contract tests, the local end-to-end demo, deployment instructions, and remaining integration work.

The separate [testnet website](testnet-app/README.md) targets `testnet.rarerush.app`. It is built and deployed as its own Vercel project; it is excluded from the main site's upload. Contract actions remain disabled until a verified Robinhood testnet deployment is configured. The [Doppler compatibility prototype](infra/doppler/README.md) evaluates a capped token with a launch allocation and separately authorized gameplay minting on a local Robinhood mainnet fork. Fork results do not constitute public deployment or approval of our custom factory by Doppler.

## Website deployment

The `rarerush` Vercel project belongs to XIBOT and serves [rarerush.app](https://rarerush.app) and [rarerush.vercel.app](https://rarerush.vercel.app). The committed configuration installs locked dependencies with `npm ci`, runs `npm run build`, and publishes only `dist/`; the package selects Node.js 22. It preserves `/pitch/`, `/docs/`, `/arcade/`, `/genesis/`, `/play/`, and the sandbox documents without a catch-all rewrite. No application environment variables or wallet secrets are required. Deployment remains separate from vibeathon submission.

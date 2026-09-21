# Rare Rush

By XIBOT · [Private source repository](https://github.com/xibot/rare-rush)

A retro SVG arcade runner **by XIBOT**, using canonical Rare Friends artwork. A public landing page shows a random Friend jumping, sliding and growing through an autoplay run. Choose Easy (120s), Normal (90s) or Degen (60s), with tougher obstacles, more scattered coins and higher demo rewards in harder modes. Surprise bear coins fly in at double size for 10× the current mode's demo coin reward, within the shared emission cap.

```sh
npm ci
npm run dev
```

Open http://localhost:4173 for the landing page and wallet-free autoplay preview. The play button opens http://localhost:4173/play/, where an owned hardwired Generations NFT (generation ≥1) and a browser wallet on Robinhood mainnet are required. Phone controls are built in; use a wallet browser on the same Wi-Fi and the computer's LAN address.

The public [Rare Rush 101 guide](https://rarerush.vercel.app/docs/) explains controls, difficulty, growth, surprise coins, and token plans using canonical SVG art and interactive examples. Its reward calculator compares the Generations demo with a clearly marked proposed 100× Genesis reward boost.

**This is a simulated economy prototype.** Entry fees, the reward token and prize pool have no monetary value and do not make transactions. The game implements a working local preview of the intended diminishing reward model. Genesis free access and its 100× reward boost, real RARERUSH minting, and the RARERUSH / RAREFRIENDS pair are future integrations.

See [game instructions and exact rules](games/rare-rush/README.md), [economy design](docs/ECONOMY.md), and [submission draft](docs/SUBMISSION.md).

Run `npm run typecheck:rush`, `npm run test:rush`, `npm run check`, `npm run build`, `npm run test:browser`, `npm run test:landing`, `npm run test:docs`, and `npm run test:bonus` to validate Rare Rush. The unmodified FriendSDK v0.1.2 package is included for reproducibility. `dist/` is the static hosting output, with the landing page at its root, the public guide in `docs/`, and the SDK game inside `play/`.

The vibeathon submission remains a draft until the builder is happy with the playtest.

## Deployment

The `rarerush` Vercel project belongs to XIBOT and serves [rarerush.vercel.app](https://rarerush.vercel.app). The committed configuration installs locked dependencies with `npm ci`, runs `npm run build`, and publishes only `dist/`; the package selects Node.js 22. It preserves `/docs/`, `/play/`, and the SDK sandbox documents without a catch-all rewrite. No application environment variables or wallet secrets are required. Deployment remains separate from vibeathon submission.

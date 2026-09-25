# Rare Rush

**Small Friend. Big Rush.**

[Play Arcade](https://rarerush.app/arcade/) · [Try Testnet](https://testnet.rarerush.app/) · [Game Guide](https://rarerush.app/docs/) · [Pitch](https://rarerush.app/pitch/)

Rare Rush is a browser-based arcade runner built for the Rare Friends ecosystem. Bring your Friend, collect coins, dodge obstacles, and race the timer through a world that can change direction beneath your feet.

A run starts as a classic side-scroller. Then comes the rare twist: an air intake pulls you into a spinning climb, a break in the floor sends you into free fall, and the next exit might send you running backwards. Familiar controls, unexpected turns, and one more reason to run it back.

Created by **XIBOT** for the [Rare Friends Vibeathon](https://github.com/spokesz/rarefriends-vibeathon).

## Two ways to play

| | Arcade MVP | Play-to-mint Testnet |
| --- | --- | --- |
| **Play** | [rarerush.app](https://rarerush.app/arcade/) | [testnet.rarerush.app](https://testnet.rarerush.app/) |
| **Your Friend** | Your owned Genesis or eligible Generations NFT | Free test Genesis or Generations NFT |
| **Network** | Robinhood mainnet for ownership checks | Robinhood Testnet |
| **Economy** | Simulated entry fees, rewards, and prize pool | Onchain test entries and verified `tRARERUSH` reward claims |
| **Transactions** | None required to play | Test ETH for gas; test RF for Generations entries |

**Arcade** is the Vibeathon MVP. Connect a browser wallet, choose Genesis or Generations, and pick your difficulty. Genesis holders enter free; Generations uses an owned hardwired NFT, generation 1 or higher. All Arcade balances and rewards are simulated. You can also watch the landing-page preview without connecting a wallet.

**Testnet** lets you try the full play → verify → mint flow. Build a free test kit on the landing page, choose a Friend, and survive the timer with at least one heart. The verifier replays your inputs before authorizing an onchain reward claim. Each test NFT gets three starts per UTC day. Genesis entry is free; Generations entry is 110 tRF, split into 100 for prizes and 10 for treasury.

Test assets have no monetary value and are separate from real Rare Friends holdings. Testnet economics are provisional; a mainnet RARERUSH token, liquidity pools, and final launch tokenomics are still in development.

On mobile, open the game in a supported wallet's built-in browser.

## The rare twist

- **Four directions.** Run right, rise, fall, and occasionally reverse left. Direction changes connect into one continuous course.
- **Your Friend in motion.** Play with Genesis or Generations artwork, grow as you collect coins, and spin through vertical sections.
- **Coins worth chasing.** Flying bonus coins, shields, and magnets add opportunities along the way.
- **Three ways to rush.** Choose a longer, gentler run or a shorter burst of Degen chaos.

| Difficulty | Run time | Reward multiplier |
| --- | --- | --- |
| Easy | 120 seconds | 0.75× |
| Normal | 90 seconds | 1× |
| Degen | 60 seconds | 2× |

Genesis adds a 100× token-reward multiplier, subject to each mode's economy and supply limits. Token multipliers do not multiply the arcade score.

**Controls:** Space / ↑ / W to jump; press again to double jump. Hold ↓ / S to slide. Use ← / → to adjust pace on horizontal tracks and steer in vertical sections. Touch controls are built in. See the [game guide](https://rarerush.app/docs/) for the full rules.

## Run locally

Use **Node.js 22.18+ within the 22.x release line** and npm.

```sh
git clone https://github.com/xibot/rare-rush.git
cd rare-rush
npm ci
npm run dev
```

Open [localhost:4173](http://localhost:4173). The preview and build need no credentials. Arcade wallet play requires an eligible NFT on Robinhood mainnet, chain `4663`.

```sh
npm run typecheck:rush
npm run test:rush
npm run check
npm run build
```

The production build is written to `dist/`. Additional browser checks are documented in the [developer game guide](games/rare-rush/README.md#build-and-verify). FriendSDK v0.1.2 is bundled in the repository for reproducible installation.

For Testnet development, use the separate [Testnet branch and setup guide](https://github.com/xibot/rare-rush/blob/codex/testnet-infrastructure/testnet-app/README.md).

## Explore the code

Rare Rush uses **TypeScript, React, SVG rendering, and FriendSDK**. Testnet adds Solidity contracts and a server-side replay verifier.

The `main` branch contains the Arcade site and its supporting tools:

| Path | Purpose |
| --- | --- |
| [`games/rare-rush/`](games/rare-rush/) | Game, artwork rendering, economy, and site pages |
| [`games/rare-rush/twist/`](games/rare-rush/twist/) | Directional gameplay and scene rendering |
| [`tests/`](tests/) | Gameplay, economy, identity, and analytics checks |
| [`scripts/`](scripts/) | Build tools and browser checks |
| [`docs/`](docs/) | Design notes, validation, and submission record |
| [`tools/arcade-stats/`](tools/arcade-stats/) | Private local Arcade/Testnet statistics dashboard |

The [`codex/testnet-infrastructure` branch](https://github.com/xibot/rare-rush/tree/codex/testnet-infrastructure) contains the separately deployed Testnet app, contracts, verifier, and deployment records. Arcade and Testnet use separate hosting projects.

## Documentation

- [Rare Rush 101](https://rarerush.app/docs/) — player controls, collectibles, and difficulty.
- [Project pitch](https://rarerush.app/pitch/) — the idea and game experience.
- [Arcade economy](docs/ECONOMY.md) — exact rules for the simulated MVP.
- [Testnet contracts and verification](https://github.com/xibot/rare-rush/blob/codex/testnet-infrastructure/infra/testnet/README.md) — onchain rules, setup, and trust assumptions.
- [Current Testnet deployment](https://github.com/xibot/rare-rush/blob/codex/testnet-infrastructure/testnet-app/src/shared/deployment.json) — contract addresses and network configuration.
- [Private statistics dashboard](tools/arcade-stats/README.md) — local setup and what the counts mean.
- [Vibeathon submission](https://github.com/spokesz/rarefriends-vibeathon/pull/22) — the original entry, submitted September 20, 2026.

## Feedback welcome

Found a bug, an awkward turn, or an idea for the next run? [Open an issue](https://github.com/xibot/rare-rush/issues) or reach out to [XIBOT on X](https://x.com/xavieriturralde).

For playtest reports, include Arcade or Testnet, your device/browser, difficulty, and what happened. A screenshot or short recording helps. Never include private keys, seed phrases, or private RPC credentials.

## Credits

Game design and development by **XIBOT**, building on the **Rare Friends** ecosystem. Rare Friends retains ownership of its character artwork.

Rare Friends character artwork, world assets, token artwork, and SDK resources are credited to their creators and used under the applicable [FriendSDK notices](https://github.com/spokesz/friendsdk/blob/main/NOTICE.md). See [asset provenance](games/rare-rush/README.md#assets-and-provenance) and [font licenses](games/rare-rush/assets/fonts/provenance.md) for details.

**Keep it rare.**

# Rare Rush

**Small Friend. Big Rush.**

[Free Play](https://rarerush.app/free-play/) · [Play Arcade](https://rarerush.app/arcade/) · [Try Testnet](https://testnet.rarerush.app/) · [Agent Play](https://rarerush.app/agent-play/) · [Leaderboard](https://rarerush.app/leaderboard/) · [Runs Feed](https://rarerush.app/runs-feed/) · [Game Guide](https://rarerush.app/docs/) · [Pitch](https://rarerush.app/pitch/)

Rare Rush is a browser-based arcade runner built for the Rare Friends ecosystem. Bring your Friend, collect coins, dodge obstacles, and race the timer through a world that can change direction beneath your feet.

A run starts as a classic side-scroller. Then comes the rare twist: an air intake pulls you into a spinning climb, a break in the floor sends you into free fall, and the next exit might send you running backwards. Familiar controls, unexpected turns, and one more reason to run it back.

Created by **XIBOT** for the [Rare Friends Vibeathon](https://github.com/spokesz/rarefriends-vibeathon).

## Three ways to play

| | Free Play | Arcade MVP | Play-to-mint Testnet |
| --- | --- | --- | --- |
| **Play** | [Free Play](https://rarerush.app/free-play/) | [Arcade](https://rarerush.app/arcade/#collections) | [Testnet](https://testnet.rarerush.app/) |
| **Your Friend** | Choose a sample Friend | Your owned Genesis or eligible Generations NFT | Free test Genesis or Generations NFT |
| **Network** | No wallet or sign-in | Robinhood mainnet for ownership checks | Robinhood Testnet |
| **Economy** | No entry fees or token rewards | Simulated entry fees, rewards, and prize pool | Onchain test entries and verified `tRARERUSH` reward claims |
| **Transactions** | None | None required to play | Test ETH for gas; test RF for Generations entries |

**Free Play** is unlimited human-controlled play with six sample Genesis and six sample Generations Friends. Choose Easy, Normal, or Degen and enjoy the full directional gameplay, music, and sound effects without a wallet or sign-in. Best scores are kept separately for each difficulty in this browser when storage is available. Free Play does not earn tokens or publish to Runs Feed.

**Arcade** is the Vibeathon MVP. Connect a browser wallet, choose Genesis or Generations, and pick your difficulty. Genesis holders enter free; Generations uses an owned hardwired NFT, generation 1 or higher. All Arcade balances and rewards are simulated. You can also watch the landing-page preview without connecting a wallet.

**Testnet** lets you try the full play → verify → mint flow. Build a free test kit on the landing page, choose a Friend, and survive the timer with at least one heart. The verifier replays your inputs before authorizing an onchain reward claim. Each test NFT gets three starts per UTC day. Genesis entry is free; Generations entry is 110 tRF, split into 100 for prizes and 10 for treasury.

Test assets have no monetary value and are separate from real Rare Friends holdings. Testnet economics are provisional; a mainnet RARERUSH token, liquidity pools, and final launch tokenomics are still in development.

On mobile, Free Play works in your browser. For wallet play, open the game in a supported wallet's built-in browser.

## Agent Play and Runs Feed

[Agent Play](https://rarerush.app/agent-play/) has two modes: **Autopilot** plays in your browser with the Friend you choose; **Agentic** provides a provider-neutral skill and CLI for an agent with its own wallet and schedule. Preview needs no wallet. Arcade checks real NFT ownership; Testnet uses the same entry and claim rules as human play.

**SAVE RUN** shares a completed wallet-connected Arcade or Testnet replay in the public [Runs Feed](https://rarerush.app/runs-feed/). Your wallet signs a publication message, with no transaction or gas fee. The server recomputes the score from recorded inputs before saving. Replays include the wallet address and selected Friend; sharing is optional. Free Play and Preview runs stay local. Hearts are private favorites stored in each visitor’s browser.

The [Leaderboard](https://rarerush.app/leaderboard/) keeps **Best of the Rush** in one place, with each Friend’s best loaded run and a watchable replay. It compares the records currently loaded, rather than claiming a complete global ranking.

See the [agent skill](agent-play/skills/rarerush/SKILL.md) and [community setup](docs/COMMUNITY.md) for wallet integration, publishing, and storage details.

## The rare twist

- **Four directions.** Run right, rise, fall, and occasionally reverse left. Direction changes connect into one continuous course.
- **Your Friend in motion.** Play with Genesis or Generations artwork, grow as you collect coins, and spin through vertical sections.
- **Coins worth chasing.** Flying bonus coins, shields, and magnets add opportunities along the way.
- **Three ways to rush.** Choose a longer, gentler run or a shorter burst of Degen chaos.
- **An original 8-bit soundtrack.** Easy's bright, bouncy **Garden Bounce**, Normal's melodic **Circuit Chase**, and Degen's dynamic bass and breaks in **Breakbeat Rush** give each difficulty its own mood, with 16 gameplay sound effects.

| Difficulty | Run time | Reward multiplier |
| --- | --- | --- |
| Easy | 120 seconds | 0.75× |
| Normal | 90 seconds | 1× |
| Degen | 60 seconds | 2× |

In wallet play, Genesis adds a 100× token-reward multiplier, subject to each mode's economy and supply limits. Token multipliers do not multiply the arcade score. Free Play uses the same run times without token rewards.

**Controls:** Space / ↑ / W to jump; press again to double jump. Hold ↓ / S to slide. Use ← / → to adjust pace on horizontal tracks and steer in vertical sections. Touch controls are built in. See the [game guide](https://rarerush.app/docs/) for the full rules.

**Audio:** MUSIC and SFX have separate controls and default to ON, with sound starting after player interaction. Mute choices are remembered in your browser when storage is available. Audio goes quiet on pause or when the page loses focus. Free Play, live Arcade, Testnet, and browser Autopilot runs support audio; feed previews, replays, and headless agents stay silent.

## Run locally

Use **Node.js 22.18+ within the 22.x release line** and npm.

```sh
git clone https://github.com/xibot/rare-rush.git
cd rare-rush
npm ci
npm run dev
```

Open [localhost:4173](http://localhost:4173). Free Play, the preview, and the build need no credentials. Arcade wallet play requires an eligible NFT on Robinhood mainnet, chain `4663`.

```sh
npm run typecheck:rush
npm run test:rush
npm run test:free-play
npm run check
npm run build
```

The production build is written to `dist/`. Additional browser checks are documented in the [developer game guide](games/rare-rush/README.md#build-and-verify). FriendSDK v0.1.2 is bundled in the repository for reproducible installation.

For Testnet development, use the [Testnet setup guide](testnet-app/README.md).

## Explore the code

Rare Rush uses **TypeScript, React, SVG rendering, and FriendSDK**. Testnet adds Solidity contracts and a server-side replay verifier.

The repository contains the Arcade site, community pages, separately deployed Testnet app, and supporting tools:

| Path | Purpose |
| --- | --- |
| [`games/rare-rush/`](games/rare-rush/) | Game, artwork rendering, economy, and site pages |
| [`games/rare-rush/twist/`](games/rare-rush/twist/) | Directional gameplay and scene rendering |
| [`games/rare-rush/audio/`](games/rare-rush/audio/) | Original 8-bit scores, synthesized effects, and audio controls |
| [`agent-play/`](agent-play/) | Shared Agent Play UI, replay viewer, and headless job runner |
| [`server/`](server/) | Public replay API and private analytics services |
| [`testnet-app/`](testnet-app/) | Testnet UI and replay verifier |
| [`tests/`](tests/) | Gameplay, economy, identity, publication, and analytics checks |
| [`scripts/`](scripts/) | Build tools and browser checks |
| [`docs/`](docs/) | Design notes, validation, and submission record |
| [`tools/arcade-stats/`](tools/arcade-stats/) | Private local Arcade/Testnet statistics dashboard |

Arcade/community and Testnet use separate hosting projects. Contract source and deployment records live in `infra/testnet/` and `testnet-app/`; this release does not change the deployed gameplay contracts.

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

For playtest reports, include Free Play, Arcade or Testnet, your device/browser, difficulty, and what happened. A screenshot or short recording helps. Never include private keys, seed phrases, or private RPC credentials.

## Credits

Game design and development by **XIBOT**, building on the **Rare Friends** ecosystem. Rare Friends retains ownership of its character artwork.

The soundtrack and gameplay effects are original Rare Rush compositions and synthesis, generated in the browser with Web Audio.

Rare Friends character artwork, world assets, token artwork, and SDK resources are credited to their creators and used under the applicable [FriendSDK notices](https://github.com/spokesz/friendsdk/blob/main/NOTICE.md). See [asset provenance](games/rare-rush/README.md#assets-and-provenance) and [font licenses](games/rare-rush/assets/fonts/provenance.md) for details.

**Keep it rare.**

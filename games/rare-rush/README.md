# Rare Rush

An endless runner with connected side, upward and free-fall tracks by **XIBOT**, with Easy, Normal and Degen modes. Play without a wallet using sample Rare Friends in **Free Play**, or connect with your verified Genesis or Generations NFT in **Arcade**. The Generations wallet route is built with **FriendSDK v0.1.2** for the Rare Friends Vibeathon. The landing and game share a pixel-bear coin + **RARERUSH** header; Rare Friends retains the artwork credit below.

## Play

From the repository root, use Node.js 22.18+ within the 22.x release line and run:

```sh
npm ci
npm run dev
```

Open http://localhost:4173 on your computer. Select **Free Play** to take the controls without a wallet or sign-in; the landing page also shows a watch-only autoplay preview. Free Play works in a phone browser. For wallet play on a phone, open https://rarerush.app in your wallet’s browser over HTTPS.

Select **Play Arcade** to open `/arcade/` and choose your collection. Both use a browser wallet on **Robinhood mainnet, chain 4663**. **Generations** opens `/play/`, where FriendSDK handles connection, discovery, selection and fresh ownership verification for an owned hardwired NFT (generation 1+). **Genesis** opens `/genesis/`, a separate tester host that verifies Genesis ownership, reads the original token artwork, and checks ownership again before each run. Genesis-only wallets can play; no Generations NFT or activation payment is required. No transaction, RF funding or private key is needed for this simulation. Mobile browsers without an injected wallet cannot connect; use your wallet's built-in browser if supported. WalletConnect is not supplied by this SDK.

## Free Play

`/free-play/` provides unlimited manual runs with six Genesis and six Generations sample appearances. The picker shows front-facing artwork; the choice is cosmetic and does not assert ownership. Genesis samples keep their selected face and use the same random selection of 36 compatible Generations bodies as wallet-connected Genesis runs. Artwork is bundled locally, so choosing a sample and starting a run makes no wallet or RPC request.

Free Play shares Arcade's directional gameplay, Easy/Normal/Degen difficulties, keyboard and touch controls, music, and sound effects. It charges no entry fees and awards no tokens. Personal bests are stored separately for each difficulty in this browser when storage is available; otherwise they last only in the current session. Clearing browser data clears stored bests. Runs in progress are not restored after leaving the page.

There is no public **SAVE RUN** in Free Play. Connecting later starts a separate wallet run; sample runs cannot become wallet-signed Arcade or Testnet publications.

## Landing preview

The landing uses the directional runner engine, connected-map renderer, shared sprite/obstacle art and canonical floating worlds. Its 32-second showcase spends most of the time running sideways, with short upward and free-fall sections before returning to the classic track. Preview timing is curated separately from playable routes, and backwards exits remain an in-game surprise. An autopilot sends ordinary jump, slide and steering inputs at 120Hz; it never changes collision results or awards rewards. The preview randomly selects one of nine cached canonical Friends, then changes Friend after each loop. **New Friend** selects another immediately; **Pause / Resume** controls the animation. Leaving the page or scrolling the preview offscreen suspends it. Reduced-motion preferences start with a still image that visitors can explicitly resume.

The preview's public artwork reads are cached in `landing/preview-art.json`, with source token IDs, frames and SDK registry provenance. These are artwork references, not assertions of NFT ownership or mint status. No wallet, network request, balance or game session is created by watching. Refresh the public cache deliberately with `node scripts/cache-rush-preview-art.mjs` when needed. The playable Generations SDK gate and separate Genesis ownership gate remain independent of the preview.

## Controls and rules

- Free Play and Arcade share the same challenges. Choose difficulty before each run. Easy: 120 seconds, smaller hazards and more space. Normal: 90 seconds, mixed obstacles and gently scattered coins. Degen: 60 seconds, tougher pairs and wider coin scatter. Arcade adds 0.75× / 1× / 2× demo coin rewards respectively; Free Play has no token rewards. Difficulty is locked during a run; **Run it back** keeps the same mode, and **← Change difficulty** on the results screen returns to the selector. Mode bests stay intact when changing difficulty, as do Arcade's accumulated demo tokens and prize pool; returning to the selector does not charge an entry fee.
- Space / ↑ / W: jump; press again in the air for a double jump. On touchscreens use JUMP or tap the world.
- Hold ↓ / S / SLIDE: duck under floating bridges; sliding in the air fast-falls.
- Hold the arrow matching your running direction / FAST to speed up to 1.3× pace; hold the opposite arrow / SLOW to ease down to 0.7×. Shaft exits can occasionally send you left. In vertical shafts, arrows steer toward their screen side. Releasing returns smoothly to cruising speed. Opposite inputs cancel, and pausing clears held controls.
- Every run opens on the classic lane. Seeded ceiling intakes pull the Friend upward and floor breaks lead into free fall, with classic track between shafts. Hold ← / → (LEFT / RIGHT on phones) to steer in shafts; jump and slide resume on the horizontal track. Rotation runs continuously at 180°/second from the first suction frame through the shaft, counterclockwise going up and clockwise going down; the exit eases upright. FX OFF disables this cosmetic rotation. Mobile cameras open out to show the full shaft.
- P / Escape / pause button: pause. Leaving the tab pauses automatically.
- The selected timer counts active play only; all modes start with three hearts. The third hit or timeout ends a run. Arcade banks the collected demo tokens and keeps a session best for each difficulty; Free Play keeps per-difficulty bests in browser storage when available.
- Crystals, crates and floating bridges cost one heart. A hit grants 1.65 seconds of protection; a broken shield grants 1.35 seconds.
- Each coin grows the Friend by 0.035×, up to 1.75× size. A damaging hit shrinks it by 0.35×, down to 1×. Shields protect size. Growth changes the sprite and its shadow; collision boxes stay forgiving, and sliding compresses its height to fit beneath bridges.
- Each coin awards 10 × current combo points. Every five consecutive coins increases the multiplier, up to ×5. A gap of 4.5 seconds without a pickup, or a hit, breaks the chain. Distance adds one point per metre.
- Flying surprise coins use the same pixel-bear artwork at 60 logical pixels, twice the ordinary coin's 30-pixel display size. In Arcade they award 10× the selected Friend’s current ordinary token rate, subject to remaining supply; Free Play awards no tokens. Each is still one pickup: one growth increment, one combo increment and the ordinary coin's score award. On classic tracks the first wave spawns after 4–6 active seconds, then every 10–15 seconds while enough flight time remains; a wave occasionally contains a staggered pair. They fly at 1.15× current world-scroll speed + 25 logical pixels/second, with a gentle vertical bob. Shafts add gently swaying bonus coins along the barrier openings with the same accounting.
- S: one-hit shield lasting up to 9 seconds. M: coin magnet lasting 8 seconds, attracting coins within 155 logical pixels.
- Garden Commons, Circuit Courtyard and Crystal Steps arrive at each third of the selected run duration. The world generates indefinitely until the run ends. Seeded coin routes become more scattered in harder modes, stay within double-jump height, and are kept out of obstacle collision boxes.
- MUSIC and SFX have separate controls and default to ON. Sound begins after player interaction, and mute choices are remembered in the browser when storage is available. Pausing, switching away from the tab, or leaving the page silences audio.
- FX OFF disables background parallax, sprite animation and decorative animation. Obstacles still move so the runner remains playable.

Each difficulty has an original 8-bit track: Easy's **Garden Bounce** is bright and bouncy, Normal's **Circuit Chase** is melodic, and Degen's **Breakbeat Rush** brings dynamic bass and breakbeats. Sixteen synthesized gameplay effects cover movement, pickups, damage, direction changes, the countdown, and results. Audio supports Free Play, live Arcade, Testnet, and browser Autopilot runs; feed previews, replays, and headless agents stay silent. The scores, Web Audio synth, and shared controls live in [`audio/`](audio/).

## Exact Arcade simulated economy

**Arcade balances, fees, rewards and global activity are local simulations. Nothing is minted, transferred, redeemable or tradable in Arcade. Free Play has no token economy.**

The separate demo ledger starts with 100 demo RF. For Generations, every difficulty costs 1 demo RF per run; 100% enters the demo RF prize pool, which has no distribution yet. Genesis enters free, including with zero demo RF credit, and contributes no entry fee to the pool. No wallet or SDK RF balance is debited. A Generations ordinary launch coin earns 7.5 demo $RUSH in Easy, 10 in Normal, or 20 in Degen; a flying bonus earns 75, 100 or 200 respectively before cap clipping. Genesis multiplies those demo token rewards by 100: launch ordinary rewards are 750 / 1,000 / 2,000 and flying bonuses are 7,500 / 10,000 / 20,000. The base reward halves after every 10,000 actual simulated pickups, with a bonus counting once; all modes, coin types, and collection reward calculations use the same counter and 200,000-token lifetime cap within a session. Six-decimal integer arithmetic first floors the difficulty-scaled reward to microtokens, then applies the 1× or 10× coin multiplier and the collection multiplier (Generations 1×, Genesis 100×), then clips the award to remaining supply. Higher difficulty, bonus pickups, and Genesis rewards can exhaust the shared cap earlier. The Genesis boost does not multiply physical coin counts, growth, or score. Combo multipliers affect arcade score only. Token Lab offers launch / 10,000 / 30,000 / 100,000 Normal-rate historical scenarios containing only ordinary coins; selecting one resets the local ledger, earned balance and pool. The session is also reset on reload or identity change.

The SDK requires `game.json` to describe a positive-priced consumable and weighted reward table even when those actions are unused. This file's 1 RF item and 100%-probability 1 RF reward are **unused compatibility terms**, not runner mechanics. Rare Rush initializes `client.read()` but never calls buy/play/settle/redeem. Skill-based rewards use the clearly labeled game-local simulation.

The separately deployed [Testnet build](https://github.com/xibot/rare-rush/tree/codex/testnet-infrastructure) now supports replay verification, onchain entries, and persistent test-token balances. This Arcade ledger remains simulated. Mainnet RARERUSH, funded RARERUSH/RAREFRIENDS liquidity, and automatic prize distribution remain future work. See [the Arcade economy design](../../docs/ECONOMY.md) and the [live player guide](https://rarerush.app/docs/).

## Public replays and Leaderboard

Wallet-connected Arcade and Testnet runs can optionally use **SAVE RUN** to publish a replay to [Runs Feed](https://rarerush.app/runs-feed/). A wallet message signature authorizes publication without a transaction or gas fee. The public service checks the wallet authorization and eligible Friend or Testnet run, then recomputes the score from recorded inputs. Publishing exposes the wallet address, selected Friend, gameplay recording, and score. Testnet verification and reward claiming remain separate actions. Free Play and Agent Play's Preview do not publish to the feed.

The [Leaderboard](https://rarerush.app/leaderboard/) compares each Friend's best run among the records loaded by the visitor; it is not a complete global ranking. Hearts are private favorites stored in the browser. Public replays use the deployed Vercel API and configured Blob storage. `npm run dev` serves the static pages and does not supply that production API or storage. See [community setup](../../docs/COMMUNITY.md) for deployment and local test details.

## Build and verify

```sh
npm run typecheck:rush
npm run test:rush
npm run test:free-play
npm run test:audio
npm run check
npm run build
npx playwright install chromium
npm run test:audio:browser
npm run test:browser
npm run test:landing
npm run test:docs
npm run test:free-play:browser
npm run test:pitch
npm run test:entry
npm run test:genesis
npm run test:bonus
npm run test:twist
```

`dist/` contains the static site: landing HTML/JS/CSS at the root, no-wallet play under `free-play/`, the public guide under `docs/`, the visual project pitch under `pitch/`, collection choice under `arcade/`, the verified Genesis tester host and its sandbox under `genesis/`, the SDK's unchanged runtime and sandbox documents under `play/`, and the Agent Play, Runs Feed, and Leaderboard pages. Host the whole folder over HTTPS, preserving relative paths and the generated sandbox CSP. `scripts/rush-site.mjs` builds and watches the site using the public SDK build API. The local server exposes only generated site files; public replay APIs require their separate runtime and storage configuration.

Game tests use the SDK's automated-only fixture through the actual ownership gate. These fixtures are never included in public builds. Landing tests run without a wallet or RPC and check autoplay, coin growth, manual/automatic Friend rotation, pause, reduced motion, mobile fit and navigation through collection choice to the real wallet gates. The builder confirmed a completed real-wallet Generations run and successful play in every difficulty with all their Generations Friends on September 20, 2026. This is a builder report; a human Genesis-wallet playthrough and physical-phone check remain unconfirmed.

The unit suite covers the classic and Arcade direction engines, economy, Genesis identity and body selection, including flying bonus accounting, collection multipliers, owner-filtered discovery, fresh ownership and safe artwork reads. The Genesis browser suite tests the actual isolated host and child at desktop and phone sizes, including transfer/account-change races, network switching, RPC failure, slow verification, and browser Back recovery using test-only wallet and RPC fixtures. The browser suites also pass five playable viewport/mode cases and three landing sizes plus reduced motion, covering the shared header, visible wordmark, flying bonus rendering and pause. The focused bonus browser suite also passes desktop Normal and phone Easy/Degen, verifying actual 10× payouts, single-pickup growth, flight and pause through legal controls.

The direction engine and scene live in `twist/`, shared by Free Play, the playable main Arcade, and the watch-only landing preview. Only the preview uses the short showcase schedule in `landing/preview-course.ts`; Testnet has its own deployment and replay verification workflow. Direction tests cover deterministic physics, reachable routes, handoff continuity and existing reward accounting. Landing tests also check both vertical directions, loop completion, and refresh-rate independence using legal inputs. The focused game browser suite exercises both collection hosts in all modes; its state instrumentation is injected into a temporary copy and never shipped. Free Play tests cover sample selection, manual keyboard/touch inputs, local bests, storage failure, and the absence of wallet, RPC, fee, or public-save requirements.

## Assets and provenance

- Canonical animated Rare Friends Generations sprites: SDK registry reader; the selected Friend's original 16×16 bitmap frames are rendered as black pixel masks with a light halo, without recoloring or substitution. Source: [FriendSDK](https://github.com/spokesz/friendsdk), pinned commit `762d6f58a73ace723f7f82dc1a61bfa036c21edc`, package v0.1.2. Artwork usage follows its [NOTICE](https://github.com/spokesz/friendsdk/blob/main/NOTICE.md).
- Genesis portrait artwork: read directly from the verified canonical Genesis token’s `tokenURI` on Robinhood Chain. The original SVG is rendered as an image inside the Genesis sandbox, without inserting metadata as DOM markup. Ownership checks use the canonical contract `0x116EaA62241751E0c98dA43d458600c6C17cD361`.
- Free Play artwork: six public Genesis front portraits bundled in [`free-play/genesis-samples.json`](free-play/genesis-samples.json), plus six cached Generations appearances selected in [`free-play/samples.ts`](free-play/samples.ts). These samples do not assert ownership or eligibility and need no runtime RPC reads.
- Music and sound effects: original Rare Rush scores and synthesis in [`audio/`](audio/), generated with Web Audio without recordings or samples. Rare Friends artwork and the bundled SDK retain their separate notices and credits.
- World: canonical monochrome FriendSDK `renderWorld` output for all six island families: Garden Commons, Orbital Array, Tidal Islands, Circuit Courtyard, Rooftop Hangout and Crystal Steps. Complete and loading variants scroll in a stable sequence with varied heights and sizes. Trees, planters, flowers, benches, reeds, terminals, pipes, tanks, antennas, vents, circuits, rocks and crystals use original SDK `renderProp` artwork. Scenery is reused under the SDK artwork notice.
- Obstacles: original SDK crystal, crate and bridge paths, cropped and sized for the runner's collision geometry. Ordinary coins, larger flying bonus coins and the shared **RARERUSH** header reuse the exact paths and colors of the [official $RAREFRIENDS pixel-bear token SVG](https://rarefriends.com/art/token.svg). Collectibles animate with horizontal rotation; bonus coins retain the same artwork at twice the display size. Character masks use the exact one-pixel white halo and black bitmap treatment from the SDK renderer.
- UI and horizontal running lane: adapted for Rare Rush using the SDK's black/white/`#CCFF00` palette, native dither/grid/hatch patterns and square controls. Typography uses Silkscreen for pixel headings and Sometype Mono Variable for body text, using the exact font files from the official Rare Friends site, bundled locally with their SIL Open Font Licenses. See [brand sources](../../docs/RARE_RUSH_BRAND.md) and [font provenance](assets/fonts/provenance.md).
- React, React DOM, viem, esbuild and dependencies retain their own licenses. The unmodified SDK package archive is checked in for reproducible installation.

## Known limitations

Free Play needs no wallet and is limited to sample artwork, local bests, and manual play. Arcade requires an owned Genesis NFT or an eligible hardwired Generations NFT on Robinhood Chain. Genesis uses a separate verified tester host because the unchanged FriendSDK identity gate supports Generations. The official SDK vibeathon submission path remains `/play/`.

There is no mainnet RARERUSH minting or cash payout. Free Play scores are local and do not qualify for public replay publication or rewards. Arcade demo balances reset with the session; saved public replays do not restore playable sessions. Testnet uses valueless test assets and an onchain claim deadline that keeps counting while gameplay is paused. The phone frame adapts vertically to keep touch controls usable; the generated SVG world uses a smaller camera view on phones while retaining the same physics.

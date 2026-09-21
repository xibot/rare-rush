# Rare Rush

An endless sidescroller by **XIBOT**, with Easy, Normal and Degen modes, starring the player's verified Rare Friends Genesis or Generations NFT. The Generations route is built with **FriendSDK v0.1.2** for the Rare Friends Vibeathon. The landing and game share a pixel-bear coin + **RARERUSH** header with **BY XIBOT**; Rare Friends retains the artwork credit below.

## Play

From the repository root, use Node.js 22.6+ and run:

```sh
npm ci
npm run dev
```

Open http://localhost:4173 on your computer. The landing page immediately shows a watch-only autoplay run without connecting a wallet. For wallet play on a phone, open https://rarerush.app in your wallet’s browser over HTTPS.

Select **Play with your Friend** to open `/arcade/` and choose your collection. Both use a browser wallet on **Robinhood mainnet, chain 4663**. **Generations** opens `/play/`, where FriendSDK handles connection, discovery, selection and fresh ownership verification for an owned hardwired NFT (generation 1+). **Genesis** opens `/genesis/`, a separate tester host that verifies Genesis ownership, reads the original token artwork, and checks ownership again before each run. Genesis-only wallets can play; no Generations NFT or activation payment is required. No transaction, RF funding or private key is needed for this simulation. Mobile browsers without an injected wallet cannot connect; use your wallet's built-in browser if supported. WalletConnect is not supplied by this SDK.

## Landing preview

The landing uses the actual runner engine, shared sprite/obstacle art and canonical floating worlds. An autopilot sends ordinary jump, slide and pace inputs; it never changes collision results or awards rewards. It randomly selects one of nine cached canonical Friends, then changes Friend after 24 active seconds. **New Friend** selects another immediately; **Pause / Resume** controls the animation. Leaving the page or scrolling the preview offscreen suspends it. Reduced-motion preferences start with a still image that visitors can explicitly resume.

The preview's public artwork reads are cached in `landing/preview-art.json`, with source token IDs, frames and SDK registry provenance. These are artwork references, not assertions of NFT ownership or mint status. No wallet, network request, balance or game session is created by watching. Refresh the public cache deliberately with `node scripts/cache-rush-preview-art.mjs` when needed. The playable Generations SDK gate and separate Genesis ownership gate remain independent of the preview.

## Controls and rules

- Choose difficulty before each run. Easy: 120 seconds, smaller hazards, more space and 0.75× demo coin rewards. Normal: 90 seconds, mixed obstacles, gently scattered coins and 1× rewards. Degen: 60 seconds, tougher pairs, wider coin scatter and 2× rewards. Difficulty is locked during a run; **Run it back** keeps the same mode, and **← Change difficulty** on the results screen returns to the selector. Your accumulated demo tokens, prize pool and mode bests stay intact; returning or changing mode does not charge an entry fee.
- Space / ↑ / W: jump; press again in the air for a double jump. On touchscreens use JUMP or tap the world.
- Hold ↓ / S / SLIDE: duck under floating bridges; sliding in the air fast-falls.
- Hold → / FAST to speed up to 1.3× pace; hold ← / SLOW to ease down to 0.7×. Releasing returns smoothly to cruising speed. Opposite inputs cancel, and pausing clears held controls.
- P / Escape / pause button: pause. Leaving the tab pauses automatically.
- The selected timer counts active play only; all modes start with three hearts. The third hit or timeout ends a run and banks the collected demo tokens. Each mode has its own session best.
- Crystals, crates and floating bridges cost one heart. A hit grants 1.65 seconds of protection; a broken shield grants 1.35 seconds.
- Each coin grows the Friend by 0.035×, up to 1.75× size. A damaging hit shrinks it by 0.35×, down to 1×. Shields protect size. Growth changes the sprite and its shadow; collision boxes stay forgiving, and sliding compresses its height to fit beneath bridges.
- Each coin awards 10 × current combo points. Every five consecutive coins increases the multiplier, up to ×5. A gap of 4.5 seconds without a pickup, or a hit, breaks the chain. Distance adds one point per metre.
- Flying surprise coins use the same pixel-bear artwork at 60 logical pixels, twice the ordinary coin's 30-pixel display size. They award 10× the selected Friend’s current ordinary token rate, subject to remaining supply. Each is still one pickup: one growth increment, one combo increment and the ordinary coin's score award. The first wave spawns after 4–6 active seconds, then every 10–15 seconds while enough flight time remains; a wave occasionally contains a staggered pair. They fly at 1.15× current world-scroll speed + 25 logical pixels/second, with a gentle vertical bob.
- S: one-hit shield lasting up to 9 seconds. M: coin magnet lasting 8 seconds, attracting coins within 155 logical pixels.
- Garden Commons, Circuit Courtyard and Crystal Steps arrive at each third of the selected run duration. The world generates indefinitely until the run ends. Seeded coin routes become more scattered in harder modes, stay within double-jump height, and are kept out of obstacle collision boxes.
- Sound starts muted; FX OFF disables background parallax, sprite animation and decorative animation. Obstacles still move so the runner remains playable.

## Exact simulated economy

**All balances, fees, rewards and global activity are local simulations. Nothing is minted, transferred, redeemable or tradable.**

The separate demo ledger starts with 100 demo RF. For Generations, every difficulty costs 1 demo RF per run; 100% enters the demo RF prize pool, which has no distribution yet. Genesis enters free, including with zero demo RF credit, and contributes no entry fee to the pool. No wallet or SDK RF balance is debited. A Generations ordinary launch coin earns 7.5 demo $RUSH in Easy, 10 in Normal, or 20 in Degen; a flying bonus earns 75, 100 or 200 respectively before cap clipping. Genesis multiplies those demo token rewards by 100: launch ordinary rewards are 750 / 1,000 / 2,000 and flying bonuses are 7,500 / 10,000 / 20,000. The base reward halves after every 10,000 actual simulated pickups, with a bonus counting once; all modes, coin types, and collection reward calculations use the same counter and 200,000-token lifetime cap within a session. Six-decimal integer arithmetic first floors the difficulty-scaled reward to microtokens, then applies the 1× or 10× coin multiplier and the collection multiplier (Generations 1×, Genesis 100×), then clips the award to remaining supply. Higher difficulty, bonus pickups, and Genesis rewards can exhaust the shared cap earlier. The Genesis boost does not multiply physical coin counts, growth, or score. Combo multipliers affect arcade score only. Token Lab offers launch / 10,000 / 30,000 / 100,000 Normal-rate historical scenarios containing only ordinary coins; selecting one resets the local ledger, earned balance and pool. The session is also reset on reload or identity change.

The SDK requires `game.json` to describe a positive-priced consumable and weighted reward table even when those actions are unused. This file's 1 RF item and 100%-probability 1 RF reward are **unused compatibility terms**, not runner mechanics. Rare Rush initializes `client.read()` but never calls buy/play/settle/redeem. Skill-based rewards use the clearly labeled game-local simulation.

A real RARERUSH token, $RUSH/RAREFRIENDS liquidity, secure score verification, global counters, persistent balances and prize distribution require future integration. See [the full economy design](../../docs/ECONOMY.md).

## Build and verify

```sh
npm run typecheck:rush
npm run test:rush
npm run check
npm run build
npx playwright install chromium
npm run test:browser
npm run test:landing
npm run test:docs
npm run test:pitch
npm run test:entry
npm run test:genesis
npm run test:bonus
```

`dist/` contains the complete static site: landing HTML/JS/CSS at the root, the public guide under `docs/`, the visual project pitch under `pitch/`, collection choice under `arcade/`, the verified Genesis tester host and its sandbox under `genesis/`, and the SDK's unchanged runtime and sandbox documents under `play/`. Host the whole folder over HTTPS, preserving relative paths and the generated sandbox CSP. `scripts/rush-site.mjs` builds and watches the site using the public SDK build API. The local server exposes only generated site files.

Game tests use the SDK's automated-only fixture through the actual ownership gate. These fixtures are never included in public builds. Landing tests run without a wallet or RPC and check autoplay, coin growth, manual/automatic Friend rotation, pause, reduced motion, mobile fit and navigation through collection choice to the real wallet gates. The builder confirmed a completed real-wallet Generations run and successful play in every difficulty with all their Generations Friends on September 20, 2026. This is a builder report; a human Genesis-wallet playthrough and physical-phone check remain unconfirmed.

The unit suite includes **83 tests: 38 engine, 30 economy, and 15 Genesis identity tests**, including flying bonus accounting, collection multipliers, owner-filtered discovery, fresh ownership and safe artwork reads. The Genesis browser suite tests the actual isolated host and child at desktop and phone sizes, including transfer/account-change races, network switching, RPC failure, slow verification, and browser Back recovery using test-only wallet and RPC fixtures. The browser suites also pass five playable viewport/mode cases and three landing sizes plus reduced motion, covering the shared header, visible BY XIBOT, flying bonus rendering and pause. The focused bonus browser suite also passes desktop Normal and phone Easy/Degen, verifying actual 10× payouts, single-pickup growth, flight and pause through legal controls.

## Assets and provenance

- Canonical animated Rare Friends Generations sprites: SDK registry reader; the selected Friend's original 16×16 bitmap frames are rendered as black pixel masks with a light halo, without recoloring or substitution. Source: [FriendSDK](https://github.com/spokesz/friendsdk), pinned commit `762d6f58a73ace723f7f82dc1a61bfa036c21edc`, package v0.1.2. Artwork usage follows its [NOTICE](https://github.com/spokesz/friendsdk/blob/main/NOTICE.md).
- Genesis portrait artwork: read directly from the verified canonical Genesis token’s `tokenURI` on Robinhood Chain. The original SVG is rendered as an image inside the Genesis sandbox, without inserting metadata as DOM markup. Ownership checks use the canonical contract `0x116EaA62241751E0c98dA43d458600c6C17cD361`.
- Sounds: FriendSDK's synthesized sound kit, with its bundled provenance and licenses.
- World: canonical monochrome FriendSDK `renderWorld` output for all six island families: Garden Commons, Orbital Array, Tidal Islands, Circuit Courtyard, Rooftop Hangout and Crystal Steps. Complete and loading variants scroll in a stable sequence with varied heights and sizes. Trees, planters, flowers, benches, reeds, terminals, pipes, tanks, antennas, vents, circuits, rocks and crystals use original SDK `renderProp` artwork. Scenery is reused under the SDK artwork notice.
- Obstacles: original SDK crystal, crate and bridge paths, cropped and sized for the runner's collision geometry. Ordinary coins, larger flying bonus coins and the shared **RARERUSH / BY XIBOT** header reuse the exact paths and colors of the [official $RAREFRIENDS pixel-bear token SVG](https://rarefriends.com/art/token.svg). Collectibles animate with horizontal rotation; bonus coins retain the same artwork at twice the display size. Character masks use the exact one-pixel white halo and black bitmap treatment from the SDK renderer.
- UI and horizontal running lane: adapted for Rare Rush using the SDK's black/white/`#CCFF00` palette, native dither/grid/hatch patterns and square controls. Typography uses the exact Silkscreen, Archivo Variable and Sometype Mono Variable files from the official Rare Friends site, bundled locally with their SIL Open Font Licenses. See [brand sources](../../docs/RARE_RUSH_BRAND.md) and [font provenance](assets/fonts/provenance.md).
- React, React DOM, viem, esbuild and dependencies retain their own licenses. The unmodified SDK package archive is checked in for reproducible installation.

## Known limitations

The prototype requires an owned Genesis NFT or an eligible hardwired Generations NFT on Robinhood Chain. Genesis uses a separate verified tester host because the unchanged FriendSDK identity gate supports Generations. The official SDK vibeathon submission path remains `/play/`. There is no production minting, RPC-free guest mode, leaderboard service, persistent storage or cash payout. Browser scores are not trustworthy for real rewards. Pauses exclude elapsed wall time and all demo state can be reset. The phone frame adapts vertically to keep touch controls usable; the desktop canvas remains 960 × 640. The generated world is SVG, using a smaller camera view on phones while retaining the same physics.

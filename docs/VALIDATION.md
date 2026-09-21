# Validation — September 20, 2026

- `npm run typecheck:rush`: passed. This scoped check keeps Rare Rush separate from other games being developed in this shared workspace.
- `npm run test:rush`: 83 tests passed (38 engine, 30 economy, 15 Genesis identity).
- `npm run check`: FriendSDK game boundary and definition validation passed. Reported chance-game rewards are unused compatibility values, not runner emissions.
- `npm run build`: passed; complete static output is in `dist/`.
- `npm run test:browser`: Normal passed at 1100×820, 390×844 and 360×640; Easy passed at 390×844 and Degen at 360×640. Every case checks all selector options before starting its chosen mode.
- Browser tests cover the SDK's fresh ownership checks using automated-only read fixtures, sandbox isolation, selected canonical artwork, keyboard/touch inputs, opening coin rewards, fee accounting, user/menu pauses, token scenarios, results, and layout fit. New checks verify varied island presets, the pixel-bear token, left/right keyboard and phone pace controls, visible growth, shrinkage after damage, and size/pace reset on replay.
- Visual inspection: desktop and both phone sizes, start/play/results screens; local PNGs are in ignored `artifacts/`.
- Canonical brand revision: original SDK world SVGs/props and the official pixel-bear token paths load inside the sandbox; matching black/white/#CCFF00 interface passed the same desktop and phone interaction checks. Screenshots were refreshed after this revision. The background now cycles six island families; the running lane remains a horizontal adaptation of the official terrain style.
- Pure-engine playability review: 400 legal-action automated runs across 100 seeds and 20/30/60/120 fps reached 90 seconds with three hearts; no invincibility or course modifications.
- Pace/growth revision: 75 additional legal-action engine runs across slow, normal and fast pace reached 90 seconds with all three hearts. New unit tests cover acceleration/release, frame-rate invariance, growth limits, damage shrinkage, shield protection and sliding at maximum size. Growth keeps the collision geometry stable.
- Real local browser: the SDK entry screen correctly reports no injected wallet in Codex's in-app browser and does not allow play.
- Landing page: `npm run test:landing` passed at 1440×1000, 390×844 and 360×640. Autoplay advances and collects coins without a wallet or external requests; manual and automatic Friend changes, visible growth, pause, offscreen suspension, reduced-motion opt-in and links to the real `/play/` wallet gate passed. Server checks verify project source files are unavailable and the SDK child CSP remains present.
- The landing caches nine real public registry sprite reads with their original frames and provenance. It shares only the renderer and pure engine with gameplay, with no wallet, ownership fixture or economy client.
- Official typography revision: Silkscreen, Archivo Variable and Sometype Mono Variable are bundled from the official site with OFL licenses. Both browser suites passed after the font change, including explicit checks that Silkscreen actually loads in the landing and the sandboxed game. Desktop and phone screenshots were inspected for title fit, legibility and control layout. `font-licenses.txt` is included and served with the static output.
- Difficulty revision: exact 120/90/60-second timers, per-mode frame-rate determinism, generated coin bounds and obstacle separation, increasing hazard density, fractional rewards, shared cap and halving boundaries pass unit tests. Legal-input AI completed 240 runs (40 seeds × three modes × normal/boost pace) with all three hearts. Browser checks verify actual per-coin payouts, mode lock during play, correct result headings and replay retaining difficulty. The landing identifies its Normal preview and shows all three mode settings.


- XIBOT and surprise-coin revision: landing and arcade share `BrandMark`, with the canonical bear-token icon and visible **BY XIBOT** at every tested size. The complete game and landing browser suites passed after the change, and the live server serves the updated bundle.
- Flying bonus tests cover independent seeded timing, occasional staggered pairs, twice-size artwork and collision geometry, faster leftward flight, gentle bobbing, reachable heights, magnet collection, once-only rewards, reset and late-run spawning. The 10× token multiplier is applied after difficulty rounding and before emission-cap clipping, while the pickup, growth and combo counters each advance once.
- `npm run test:bonus`: passed for desktop Normal (1100×820), phone Easy (390×844) and phone Degen (390×844). Real keyboard/pointer controls catch bonuses through the SDK test harness. Checks observe DOM transitions for exact 100/75/200-token launch awards, one pickup, a 0.035× growth step, correct aggregate HUD balances, canonical 60px versus 30px art, visible flight/bob and pause. Six flying/collected screenshots were saved; desktop and phone views were visually inspected.
- Landing bonus pursuit: a temporary legal-input simulation of the actual preview autopilot across 100 seeded 24-second runs collected 205 bonuses in 98 runs, with no hits or early endings. The preview prioritizes clearing bridges and uses ordinary jump inputs; it grants no tokens.

- Results navigation revision: the full-width **← Change difficulty** button returns to the previous selector and focuses the selected mode. TypeScript and static build passed. The five-case game browser suite passed, including desktop replay and phone result→selector→different mode→new run transitions. Ledger snapshots confirm returning/selecting preserves RF, earned tokens, pool and pickup count, while starting charges exactly one additional demo entry. The 44px button stays inside the results panel at every viewport, including 360×640; desktop and small-phone screenshots were visually inspected.

The builder confirmed a real Generations-wallet connection and completed run on rarerush.app on September 20, 2026, then reported that all three difficulties work with all their Generations Friends. Device details were not supplied; physical-phone and Genesis-wallet checks remain unconfirmed. This builder report is distinct from the automated fixture tests and does not establish compatibility with every wallet. No signing, real transactions, token deployment, liquidity creation or vibeathon submission was performed.

The local game server listens at port 4173. The test browser was installed under `/private/tmp/rare-rush-browsers`; in this environment run `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/rare-rush-browsers npm run test:browser`. On a new machine use `npx playwright install chromium` once, then `npm run test:browser` normally.

## Genesis tester documentation and economy

- `npm run test:rush`: 68 engine/economy tests passed after adding Genesis accounting (38 engine, 30 economy). Seven new tests cover free entry with zero credit, all difficulty and bonus combinations, one-pickup halving transitions, integer rounding and reward exhaustion, shared-cap clipping, invalid collections without mutation, and unchanged Generations defaults.
- `npm run test:docs`: passed at 1440×1000, 390×844 and 360×640. The guide describes active Genesis tester access and uses the same collection-aware `nextCoinReward` function as gameplay. Navigation now reaches `/arcade/`, offers Genesis, and preserves the real Generations SDK gate at `/play/`. Genesis ordinary/bonus calculator values, growth controls, font loading, layout, FAQs, local assets and route boundaries passed. Small-phone reward and holder-card screenshots were visually inspected with no clipping.
- `npm run test:landing`: passed at 1440×1000, 390×844 and 360×640 plus reduced motion. The unchanged autoplay, coin growth, Friend rotation, flight and pause checks passed; primary play links now lead through the Genesis/Generations collection choice and then to the Generations SDK gate.
- Both collection modes remain simulated. These checks do not replace a holder’s real-wallet Genesis discovery and playtest on Robinhood Chain.

## Genesis host and release checks

- `npm run test:genesis`: passed at 1100×820, 390×844 and 360×640 through the actual opaque-origin iframe. Checks cover collection selection without wallet requests, canonical portrait transfer, CORS/font loading, every difficulty’s 100× reward, actual opening-coin payouts, free entry without RF/pool mutation, and changing Friends. Desktop and phone screenshots were visually inspected.
- Separate cases verify fresh ownership before every start, transfer rejection, wallet changes during a pending read, wrong-network gating and switching, disconnect, a slow 11-second handshake, RPC failure, back/forward-cache recovery, standalone child denial, and no-wallet denial. Browser fixtures are confined to test code; no signer or provider is sent into the child.
- Typecheck, all 81 unit tests, SDK validation, and all five existing Generations browser cases passed after the shared runner refactor. Landing and docs suites also passed all three sizes.
- A read-only live RPC smoke check found the real holdings and original portrait for public Genesis #1 using the canonical contract on Robinhood. Genesis IDs are 1–1024: ownerOf(0) reverts with ERC721NonexistentToken and has no Transfer history. No holder’s private credentials were used.
- A human Genesis holder’s wallet connection and physical-phone playtest remain unconfirmed. No real rewards, signing, or transactions were tested or enabled.

- Builder confirmation (September 20, 2026): connected a real wallet holding Generations and completed a run on rarerush.app; subsequently confirmed Easy, Normal and Degen work with all their Generations Friends. No address was needed or collected. This is a user-reported check, not an independently observed wallet session.


## Visual pitch page

- `npm run typecheck` and `npm run build`: passed after adding the public `/pitch/` entry.
- `npm run test:pitch`: passed at 1440×1000, 768×1024, 390×844 and 360×640. Checks cover visible navigation from home, docs and arcade; bundled Silkscreen; no horizontal overflow; BY XIBOT; real autoplay pickups; manual Friend changes; pause/resume; offscreen suspension; and play links through the collection selector to the real SDK ownership gate. No browser errors, failed assets or external requests occurred in these cases.
- Reduced motion starts the preview paused and allows explicit opt-in. `/pitch` redirects to `/pitch/`; generated pitch assets are served while source, environment and package files remain unavailable.
- Desktop and small-phone screenshots were visually inspected. The pitch reuses canonical Rare Friends artwork and the existing game preview. Current local demo accounting is distinguished from planned minting, run validation, liquidity and prize payouts.

## Public source review

- Before making the GitHub repository public, reviewed all five commits, 101 unique history blobs and the 230-file SDK archive for credentials or unintended private data. No real credentials, private keys, auth files or personal wallet data were found. High-entropy matches were dependency integrity hashes and public development fixtures.
- SDK and font licenses/notices remain bundled. Canonical artwork sources and Rare Friends ownership credits remain distinct from XIBOT’s original game code.
- The Git author contact was already visible on the builder’s public GitHub profile. There were no workflow runs, wiki, issues or forks exposed by the visibility change.

## Collection entry and artwork cards

- The shared canonical bear-token favicon is served at `/favicon.svg` and linked from landing, docs, pitch, collection choice, Genesis and the SDK host.
- `npm run test:entry`: passed at 1440×1000, 390×844 and 360×640. The Generations entry matches the Genesis branding, with the top Choose Collection link as its single return control (the redundant wallet-row Back button was removed). Keyboard return to collection choice, no-wallet entry, refused connection, disconnect/reconnect, real canonical sprite previews, fresh SDK ownership verification, sandbox flags and opening/closing both selector and wallet menus passed. Decorative page chrome is removed when gameplay resumes.
- `npm run test:genesis`: passed all three viewport cases and existing ownership-transfer, wallet-race, network, disconnect, delayed-read, failure and direct-entry cases. Picker cards display the original canonical portrait before selection; artwork reads do not grant entry or replace the fresh ownership check.
- Thumbnail queues, deadlines and caches are bounded; a slow or unavailable preview leaves the Friend selectable. Genesis caches are scoped to the wallet revision, and Generations only decorates the SDK’s currently listed owned Friends. Unit tests explicitly reject active SVG metadata and establish that a public portrait cannot authorize entry.
- TypeScript, all 83 unit tests and FriendSDK validation passed. Desktop Generations and small-phone Generations/Genesis picker screenshots were visually inspected.
- Landing, docs and pitch browser suites passed again after updating their wallet-gate checks to the new visible connection controls.

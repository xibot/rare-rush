# Rare Rush — canonical artwork sources

Rare Rush now uses the actual graphics from FriendSDK's approved **Rare Friends Isometric World Assets**. The source is the pinned v0.1.2 archive in this repository; `games/rare-rush/WorldArt.tsx` and `CanonicalArt.tsx` record the reused presets, renderers and artwork transforms; font files have source and checksum provenance under `games/rare-rush/assets/fonts/`.

The game is built by **XIBOT**. The landing page and arcade share the same header: the official pixel-bear coin beside **RARERUSH**, with **BY XIBOT** underneath. This builder attribution is separate from the Rare Friends artwork and FriendSDK credits retained below and in the landing footer.

## Reused directly

- `renderWorld(getWorldPreset(...))`: all six canonical families, using complete and loading variants. The background visits Garden Commons (`01-garden-oval`), Orbital Array (`06-orbital-hex`), Tidal Islands (`05-tidal-islands`), Circuit Courtyard (`02-circuit-courtyard`), Rooftop Hangout (`04-rooftop-terrace`) and Crystal Steps (`03-crystal-mesa`). Each exported SVG is embedded intact as a cached image, including its isometric geometry, dither, black water and green signals. Islands are indexed by absolute world position so scrolling and biome transitions cannot replace an island still on screen.
- `renderProp(...)`: original vector scenery. Obstacles reuse crystal, crate and bridge art; only viewBox cropping and display sizing adapt it to the collision boxes.
- Pickups and the shared header use the exact edge, rim, pixel-bear face and green accent paths from the [official token.svg](https://rarefriends.com/art/token.svg), retrieved September 20, 2026 from the Rare Friends website. Ordinary coins display at 30 logical pixels; flying bonus coins display at 60, preserving the same artwork at twice the size. Horizontal rotation animates both, with a gentle vertical bob on flying bonuses.
- On-chain 16×16 sprite frames: black pixels, a one-pixel white halo, and the row-15 foot anchor follow `actorArtwork` in the SDK. Sliding retains the runner's compact pose animation.
- The landing autoplay preview reuses the same sprite component. Its nine cached public registry reads in `games/rare-rush/landing/preview-art.json` retain the full 64-frame animations and manifest/source provenance. The landing footer attributes Rare Friends artwork and FriendSDK. Watching art makes no ownership or eligibility claim.

## Shared visual rules

- Paper: `#FFFFFF`; ink/void: `#000000`; signal: `#CCFF00`.
- Native 4×4 dither, 4×4 checker texture, 32px cross grid and 7px diagonal hatch.
- Square corners, narrow rules and hard shadows. Typography now matches the official Rare Friends site's stylesheet: **Silkscreen** (400/700) for pixel display text, **Archivo Variable** for body copy, and **Sometype Mono Variable** for labels and numeric data. The exact Latin WOFF2 files are bundled under `games/rare-rush/assets/fonts/`, with their SIL Open Font Licenses and source/checksum provenance. The build includes `font-licenses.txt` alongside the site. Fonts load locally in both the landing page and the SDK sandbox.

The scrolling horizontal lane and game controls are game-specific compositions built with these rules. The game remains a sidescroller; it does not copy the isometric world's movement model. Decorative upright props are behind the lane and are not obstacles. Arrow controls smoothly adjust world speed; coin collection grows the sprite and damage shrinks it. Easy, Normal and Degen vary hazard sizes, spacing, coin routes and timers while retaining the same player collision box and jump physics. All modes share one simulated economy.

Flying bonus waves spawn first after 4–6 active seconds and then every 10–15 seconds while enough flight time remains, occasionally as a staggered pair. Their airspeed is 1.15× current world-scroll speed + 25 logical pixels/second. A bonus awards 10× the difficulty-scaled token rate before the shared cap clips it, but remains one pickup for growth, combo and halving. Its larger appearance communicates the token bonus rather than a new character or asset style.

Source and permissions: [FriendSDK renderer](https://github.com/spokesz/friendsdk/blob/main/src/friend-world.ts), [world rules](https://github.com/spokesz/friendsdk/blob/main/WORLD_RULES.md), [artwork notice](https://github.com/spokesz/friendsdk/blob/main/NOTICE.md).

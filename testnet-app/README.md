# Rare Rush testnet lab

An independent Vite app intended for `testnet.rarerush.app`, deployed as the separate XIBOT Vercel project `rarerush-testnet`. It does not change the live vibeathon arcade. Uses Robinhood testnet only (46630); no mainnet writes and no real RF are required. The custom hostname has its own DNS and HTTPS setup, separate from the live arcade.

```sh
npm ci
npm test
npm run build
npm run dev
```

With the dev server running, `npm run test:browser` checks desktop/mobile layout, unavailable contracts, wallet/network states, disconnect behavior, and invalid configuration. Install a Playwright Chromium browser first with `npx playwright install chromium` if needed. `TESTNET_APP_URL` can point these checks at a preview deployment.

## Public configuration

`public/testnet-config.json` is an allowlisted public manifest, **never a secret store**. The committed default has `contracts: null`, which keeps all contract writes disabled. The official test ETH faucet and wallet connection remain available. No blockchain addresses have been fabricated.

After the intended contracts have actually been deployed and confirmed, populate all five distinct addresses:

```json
{
  "version": 1,
  "chainId": 46630,
  "contracts": {
    "game": "<deployed game address>",
    "rf": "<deployed TestRF address>",
    "genesis": "<deployed TestFriends(true) address>",
    "generations": "<deployed TestFriends(false) address>",
    "rewardToken": "<game.token() address>"
  },
  "deploymentConsoleUrl": null
}
```

Leave `deploymentConsoleUrl` null unless an actual operator console has been independently provided at the same-origin `/deploy/` route. This project does not ship a deployer, verifier private key, or any environment credentials.

The UI checks the RPC chain ID, deployed bytecode, game contract bindings, the external reward token's minter/cap/decimals, 10% launch / 90% gameplay accounting, the test reward floor, faucet amount, fee split, daily limit, and NFT collection types at one block before enabling faucets. Contract interactions recheck these and query the active wallet account/network immediately before sending. Only `TestRF.faucet()` and `TestFriends.mint()` are exposed. No token approval, transfer, game start, or liquidity transaction is offered.

Wallet balances are read from the testnet RPC. Newly minted test NFT IDs are extracted from successful receipt `Transfer` events and shown for the current session. Existing ownership counts come from `balanceOf`; the page does not pretend to have indexed all NFT IDs. Two confirmations are awaited, and all receipts link to the testnet explorer. Pending transaction hashes are retained in session storage, so a wait timeout or page reload does not unlock a second mint; Refresh rechecks the receipt. The page's disconnect action clears local wallet state, while the wallet extension controls its own site permissions.

## Scope and honest status

Public deployment is pending unless actual addresses are configured and pass checks. Browser gameplay, hosted run verification, and reward claims are **not connected in this app yet**. A separate local Robinhood fork has validated the custom Doppler launch, RF swaps and signed reward minting; public custom factory approval and public liquidity deployment remain pending. The full game contract now binds an external token using the same validated token implementation; hosted browser gameplay remains a separate step. This lab has no live Doppler pool or exchange. Test contracts use a 1.024B cap, a 102.4M launch reserve, and 921.6M for gameplay. The provisional test curve begins at 10 tokens, halves every 10,000 claimed pickups, and has a 1-token base floor before multipliers. These are test settings, not finalized mainnet economics. Test tokens and test NFTs have no redemption value and do not become mainnet assets.

## Assets

The Rare Friends token icon is copied from the existing arcade (`games/rare-rush/assets/favicon.svg`), whose provenance identifies canonical `https://rarefriends.com/art/token.svg` artwork. The existing brand fonts and their OFL licenses are included under `public/assets/fonts/`.

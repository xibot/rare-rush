# Rare Rush × Doppler compatibility prototype

**Status: locally validated; not deployed or approved on a public network.**
This isolated experiment asks whether a custom six-decimal, capped, play-to-mint token can launch an RF-denominated market through Robinhood's deployed Doppler contracts. It does not change the live game. The isolated `infra/testnet` reward token now inherits this token implementation and its game binds the reward token once before runs can start.

## What passed

- Three fee-configuration checks for sorted shares, invalid recipients and unset mainnet destinations, plus fourteen local unit checks for allocation bounds, contract-only immutable reward minter, signed receipt authorization, player/amount binding, chain/contract replay separation, expiry, one-time claims, pool locks, ownership transfer and the exact cap boundary.
- Nineteen compatibility checks against unchanged **deployed Robinhood mainnet contract code** on a disposable local fork. These exercised factory rejection before approval; locally simulated approval; real Airlock/V3 initialization with RF; buying and selling; a signed reward mint; selling newly minted rewards; cap enforcement; token migration interface calls; and actual 1% fee collection to the 5% Doppler / 95% designated game recipients in both currencies.
- The detailed block/hash, module code hashes, local contract addresses and measured trade amounts are in [`evidence/robinhood-fork.json`](./evidence/robinhood-fork.json). Those transaction hashes and newly created addresses exist **only on the local fork**.

The fork uses source chain 4663, but all transactions run on a loopback Hardhat chain with ID 31337. No public wallet is connected. No public transaction is broadcast. The contracts deliberately reject deployment on mainnet; these are unaudited prototypes.

## Run

Node 22.18 or newer:

```sh
cd infra/doppler
npm ci --ignore-scripts
npm run test:unit
npm run test:fork
```

`test:unit` requires no upstream RPC. `test:fork` needs internet access to the public Robinhood RPC and permission to start a loopback server. It verifies upstream chain ID 4663, chooses one recent upstream block, pins all upstream reads to it and records the block number and hash. It never mixes latest state into an active fork.

The public RPC prunes historical state. To reproduce a recorded block later, use an archive-capable endpoint and the recorded block:

```sh
RUSH_DOPPLER_ARCHIVE_RPC=https://your-archive-endpoint.example \
RUSH_DOPPLER_FORK_BLOCK=BLOCK_FROM_EVIDENCE npm run test:fork
```

Replace `BLOCK_FROM_EVIDENCE` with the `forkBlock` number in the saved report. An unavailable historical state causes a failed test, not a skip or fallback to synthetic RF contracts. Hardhat's public development keys are kept out of tool output. Never fund its development accounts on a public network.

## Contract design

`RareRushDopplerPrototype` has:

- A hard cap of **1,024,000,000 tokens**, six decimals, no burn/re-mint path, no cap setter and no administrator mint function.
- A launch allocation minted once in the constructor. The rest remains unminted and reserved for gameplay.
- An immutable, deployed **contract** address as the only reward minter. Ownership changes cannot grant minting permissions or change that minter.
- The ERC20, `lockPool`, `unlockPool` and immediate `transferOwnership` interfaces required by the deployed Airlock. The migration pool cannot receive tokens while locked.

`RareRushDopplerFactoryPrototype` implements the exact deployed `ITokenFactory.create` interface. Its launcher, Airlock, launch allocation and reward minter are immutable. It permits only one launch. The launcher envelope calls Airlock and accepts the factory callback only during that transaction; an outsider cannot front-run an Airlock call to consume the configured one-time token factory.

`VerifiedClaimFixture` proves the custom token can mint after a valid EIP-712 receipt, with player binding and replay prevention. **It is not the Rare Rush gameplay contract or production verifier.** It deliberately omits physics replay, NFT ownership, difficulty calculation and daily quotas, which are separately covered by `infra/testnet`.

`V3SwapFixture` is a local-only swap callback. The RF and V3 pool code used for swaps are the actual forked/deployed contracts.

## Selected trading fees and provisional launch settings

The selected pool policy is a **1% trading fee**, split **5% of collected fees to Doppler / 95% to the designated game revenue recipient**. The split applies to fees collected from the launch initializer’s liquidity positions. When those positions own all fee-earning liquidity and V3’s separate protocol fee is off, this is approximately 0.05% and 0.95% of swap volume respectively, subject to integer rounding. For example, 100 RF collected from those positions distributes 5 RF to Doppler and 95 RF to the game recipient. Other LPs earn fees on their own positions; a separate V3 protocol cut would reduce the LP fees available to split. This policy is recorded in [`config/trading-fees.mjs`](config/trading-fees.mjs); no public trading pool is deployed yet.

For testnet, the chosen game fee recipient is the existing treasury wallet, `0x6fD155b9D52F80E8A73a8A2537268602978486e2`. For mainnet, trading fees will go to a **game admin address**, while game-entry treasury fees will go to a **separate treasury address/contract**; both mainnet destinations are still unset. The existing Generations entry accounting remains 110 RF: 100 reserved for prizes and 10 for the entry treasury. Pool trading fees do not automatically fund that prize accounting. The current gameplay contract has no general trading-fee withdrawal mechanism, so it is not used as the trading-fee beneficiary.

The local fork uses disposable wallets, including a designated fee recipient different from the launcher; it never pays the real testnet treasury wallet. The 1% V3 tier uses fee value `10000` and tick spacing `200`. Doppler's protocol beneficiary is read from the pinned Airlock owner. Fees accrue in the pool's two currencies and are distributed by `collectFees(pool)`; they are not automatically converted into RF. Recipient shares are set when the locked pool is initialized.

Other fixture choices remain provisional: **10% launch / 90% gameplay**, a roughly 0.001 RF starting price per RARERUSH, ten liquidity positions and an 80% bonding-curve share. The user selected 10% launch / 90% gameplay for the first standalone testnet deployment. The price, positions, liquidity funding and final mainnet emissions remain undecided; the fork is not a forecast.

The pool is funded initially with the launch RARERUSH allocation. Buyers supply RF when they buy. **“Instant market” does not mean free RF liquidity.** Reward tokens can only sell against RF that has actually entered the pool. The test buys first, then sells and then sells a newly minted reward.

For testing only, the harness locally impersonates the RF contract to transfer 1,000 existing fork RF to a disposable player. It does not mint RF, change RF code, take real funds or demonstrate a public RF faucet.

The chosen deployed route is `LockableUniswapV3Initializer` with a locked permanent V3 pool and `NoOpMigrator`. No separate pool graduation/migration is tested. Unlock and ownership compatibility are tested independently by locally impersonating Airlock; that is not evidence of a successful production migration.

`Airlock.getAssetData(asset).totalSupply` records the **initial launch allocation**, not the token's eventual cap. After a gameplay claim, ERC20 `totalSupply()` changes; the Airlock snapshot does not. Indexers, valuation displays and SDK/front-end assumptions about future emissions require a separate compatibility review. This prototype calls the pinned contract ABI directly; it does not claim Doppler's hosted UI or SDK supports our custom factory without integration work.

## Exact approval dependency

Airlock rejects a factory unless `getModuleState(factory) == 1` (`TokenFactory`). Only the current Airlock owner can invoke `setModuleState`.

The test first confirms rejection, then **impersonates that owner on the local fork only** to allowlist our prototype. This is neither permission from Doppler nor a public approval. Deploying a custom token contract alone does not bypass this gate. A canonical public launch requires Doppler to approve the actual production factory address/code (and the chosen modules to remain approved).

Robinhood mainnet is in the official deployment list; Robinhood testnet is not currently listed. A `testnet.rarerush.app` interface can host our testnet work, but it does not make canonical Doppler modules exist on chain 46630. Public testnet options need an agreed deployment of test modules or a separate supported-chain experiment.

## Still required before integration

1. Supply the separate mainnet game-admin and entry-treasury destinations, and decide final mainnet launch/gameplay allocation, RF funding assumptions and emissions. The selected pool fee is 1% with a 5/95 Doppler/game split. The standalone game testnet uses the agreed 10% reserve / 90% gameplay split and a provisional 1-token base floor.
2. The standalone `RareRushGame` now binds an external token using this same token implementation, preserving verified replay, ownership checks, multipliers, daily starts, fees and cap accounting. Its integrated local game tests and replay demo are in `infra/testnet`. A complete game → canonical factory launch → claim → swap fork rehearsal remains separate from this prototype's receipt-fixture proof.
3. Obtain public factory approval, verify the final factory/token bytecode and choose the actual launch route. This prototype deliberately cannot deploy to mainnet.
4. Connect the deployed testnet game and reward token to a hosted verifier service and wallet-connected play/claim interface. The five verified standalone testnet contracts do not include a Doppler pool. No public deployment is performed by these fork scripts.
5. Review economic effects of ongoing issuance and Genesis ×100. Contract compatibility does not establish sustainable liquidity, an emission timeline or resistance to gameplay bots.

## Pinned references

The ABI and token-lock interface were checked against Doppler commit **`bda077cf05c834f3bb5eb311f5b86376910d7912`**, linked by the official Robinhood deployment table. Dependencies are exact-version pinned in `package-lock.json`: Solidity 0.8.30 (Cancun target), OpenZeppelin 5.6.1, Hardhat 3.17.0 and viem 2.56.3.

- [Official deployment addresses](https://docs.doppler.lol/reference/contract-addresses)
- [Pinned Airlock and its module approval / initial supply behavior](https://github.com/whetstoneresearch/doppler/blob/bda077cf05c834f3bb5eb311f5b86376910d7912/src/Airlock.sol)
- [Pinned token factory interface](https://github.com/whetstoneresearch/doppler/blob/bda077cf05c834f3bb5eb311f5b86376910d7912/src/interfaces/ITokenFactory.sol)
- [Pinned token lock behavior](https://github.com/whetstoneresearch/doppler/blob/bda077cf05c834f3bb5eb311f5b86376910d7912/src/tokens/DopplerERC20V1.sol)
- [Pinned V3 initializer](https://github.com/whetstoneresearch/doppler/blob/bda077cf05c834f3bb5eb311f5b86376910d7912/src/initializers/LockableUniswapV3Initializer.sol)
- [Official Rare Friends contracts](https://rarefriends.com/docs/contracts)

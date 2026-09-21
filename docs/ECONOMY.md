# Rare Rush economy

**All costs, token rewards, balances, historical participation, and prize-pool amounts are simulated.** No real token exists for this prototype. It does not mint, transfer, approve, swap, or spend onchain funds. Demo balances have no redemption value.

The [Vibeathon rules](https://github.com/spokesz/rarefriends-vibeathon/) require simulated purchases and rewards. FriendSDK v0.1.2 supplies wallet connection and verified Generations Friend selection; it does not supply a skill-score reward, additional-currency, or persistence API. The runner therefore maintains its own session-local demo accounting. Its RF credit is separate from the wallet balance shown by the SDK. The SDK's required chance-game configuration is reference scaffolding, not this game's reward mechanism.

## Playtest parameters

| Parameter | Value |
| --- | --- |
| Run duration | Easy 120s / Normal 90s / Degen 60s |
| Starting demo RF credit | 100 RF |
| Generations run entry | 1 simulated RF |
| Entry fee destination | 100% to the simulated prize pool |
| First ordinary coin reward | Easy 7.5 / Normal 10 / Degen 20 demo tokens |
| First flying bonus reward | Easy 75 / Normal 100 / Degen 200 demo tokens, before cap clipping |
| Bonus token multiplier | 10× the difficulty-scaled ordinary reward |
| Halving interval | 10,000 total accepted pickups |
| Token accounting precision | 6 decimals; integer microtokens |
| RF accounting precision | 18 decimals; integer base units |
| Maximum lifetime token issuance | 200,000 demo tokens |

Collected tokens are credited immediately during a run and remain earned when the run ends. Arcade scores and combos do not multiply token issuance. Distance and pickups can still improve arcade scores after token emissions reach zero. Run-entry fees are consumed at entry; an unsuccessful or abandoned run does not refund its simulated fee. Prize-pool distribution is a future design, not a payout implemented by this prototype.

Flying bonus coins are twice the ordinary artwork size (60 versus 30 logical pixels). Their first wave spawns after 4–6 active seconds, followed by waves every 10–15 seconds while enough flight time remains, occasionally as a staggered pair. They move at 1.15× current world-scroll speed + 25 logical pixels/second. The 10× reward changes tokens only: each bonus still counts as one accepted pickup, one growth increment and one ordinary combo/score increment.

Difficulty is chosen before entry and locked for the run. Easy applies a 3/4 reward multiplier, Normal 1, and Degen 2. All three use the same session ledger, pickup count and issuance cap. Changing difficulty does not reset emissions or the pool. Score bests are tracked separately for each mode.

## Exact diminishing reward

Let `N` be accepted pickups before the next coin, `K = 10,000`, `Q = 1,000,000` microtokens per token, and `R0 = 10 × Q`. Let `B = 1` for an ordinary coin or `B = 10` for a flying bonus.

```text
epoch(N)              = floor(N / K)
baseMicro(N)          = floor(R0 / 2^epoch(N))
difficultyMicro(N, D) = floor(baseMicro(N) × difficultyNumerator(D) / difficultyDenominator(D))
rewardMicro(N, D, B)  = difficultyMicro(N, D) × B
capMicro              = 2 × K × R0
award                 = min(rewardMicro(N, D, B), max(0, capMicro − issuedMicro))
```

Award the pickup, add it to both lifetime issuance and current player earnings, then increment `N` once, regardless of difficulty or bonus status. An ordinary Normal coin at pickup positions 1–10,000 has a 10-token rate; 10,001–20,000 has 5; 20,001–30,000 has 2.5; 30,001–40,000 has 1.25, before cap clipping. Easy and Degen scale these rates by 0.75 and 2, using integer microtokens. The bonus multiplier is applied **after difficulty rounding and before cap clipping**: when the base rate is 9 microtokens, Easy rounds to 6 and its bonus is 60, not 67. A run crossing a boundary receives the correct rate for each coin. The UI shows the actual next award after clipping to remaining supply.

For an all-Normal history containing **only ordinary coins**, the sum is bounded by `K × R0 × (1 + 1/2 + 1/4 + …) = 2 × K × R0`; integer rounding reduces terminal issuance to **199,999.92 tokens**. Mixed histories depend on the selected modes and bonus pickups, and the independent **200,000-token lifetime cap** is authoritative. An entirely Degen launch with **only ordinary coins** exhausts it after 10,000 pickups; bonus coins can reach the cap sooner. Once exhausted, every mode and coin type awards zero. At pickup counter 240,000 the base reward is zero in all modes regardless of unused capacity; multiplying zero by 10 does not revive it. There is no positive minimum reward. Spending balances does not reopen emission capacity.

This limits supply; it does not by itself stabilize a market price or prevent automated farming. Historical global **verified pickups**, rather than wallet count or started runs, would determine the production rate. A new wallet or an abandoned empty run should not change emissions.

## Preview scenarios and resets

`createEconomy(startCoins)` creates a fresh simulation at a chosen hypothetical **Normal-rate history of ordinary coins, with no bonuses**. It calculates prior issuance but gives the current player none of those historical tokens. Starting scenarios such as 0, 10,000, 30,000, and 100,000 pickups demonstrate different rates. Difficulty and bonus multipliers change only subsequent coins; scenarios do not infer a historical mix of modes or bonus pickups.

Changing a scenario resets the player's earned token balance, restores the 100 simulated RF credit, and resets the pool and run counter. Reloading also resets the runtime session. These counters are not shared between players, persisted, or backed by a global service. Browser values are not trustworthy mint authorization.

The initial entry proposal for **Genesis holders is free play**, but the present SDK ownership gate requires a hardwired Generations NFT, generation 1 or higher, on Robinhood mainnet (chain 4663), including previews. Genesis-only access and fee exemptions require a separate verified entitlement integration. This prototype implements the Generations demo entry fee only. See the [SDK identity and economy API](https://github.com/spokesz/friendsdk/blob/main/API.md).

The proposed Genesis reward boost is **100× tokens per collected coin**, stacked with difficulty and the 10× flying bonus, then limited to the remaining shared issuance cap. It does not multiply physical pickups, growth, or arcade score. At the launch rate on Normal, that would mean 1,000 tokens for an ordinary coin or 10,000 for a flying bonus. This boost and Genesis gameplay access are not active in the arcade. The public `/docs/` calculator illustrates the proposal separately from the existing Generations demo. A 100× boost materially accelerates cap exhaustion, so the final supply and emission schedule need to be evaluated together before production.

## Future real token integration

The intended token would pair with RAREFRIENDS through separately funded liquidity. A pairing is not automatic backing, guaranteed redemption, or a guaranteed exchange rate. No pair, liquidity deposit, token contract, or trading feature is implemented here.

A future production system needs a trusted run service and custom contracts:

1. Issue unpredictable seeded run IDs bound to a verified wallet, Friend, difficulty, rules version, start time, and confirmed entry entitlement or fee receipt.
2. Validate timed inputs against a deterministic simulation; do not trust client-reported score, pickups, duration, or reward totals. Reject duplicate sessions and apply rewarded-run limits. Replay validation alone does not distinguish a skilled human from a bot.
3. Accept results against a serialized global emission counter. Reserve each resulting reward once in durable storage, handle retries idempotently, and define expiry/recovery rules. Already reserved rewards must count toward the lifetime cap.
4. Mint after validation using an expiring typed claim bound to recipient, Friend, run ID, amount, chain ID, and contract. Consume its nonce onchain. [EIP-712](https://eips.ethereum.org/EIPS/eip-712) supplies typed signing and domain separation, but does not supply replay protection.
5. Enforce an immutable lifetime issuance ceiling in addition to any supply cap; burns must not reopen emission capacity. Restrict mint authority and secure its keys. Keep deposited RF prize escrow distinct from token emissions. Standard [ERC20 extensions](https://docs.openzeppelin.com/contracts/5.x/api/token/erc20) and [role controls](https://docs.openzeppelin.com/contracts/5.x/access-control) can support a reviewed implementation.

Server simulation still trusts its operator and signing infrastructure. Production also requires defenses against automated farming, concurrent runs, wallet/NFT transfer races, interrupted settlements, replayed requests, key compromise, and insolvency of any promised payout. The existing SDK chance-game contracts do not implement this runner economy.

## Decisions before production

The demo values above are adjustable playtest parameters. Final token name, symbol, decimals, supply and halving schedule, actual entry fee, Genesis eligibility, rewarded-run quotas, liquidity funding/ownership, prize distribution, claim expiry, treasury administration, and deployment remain future decisions. No live contract deployment, liquidity action, or real transaction is part of this implementation.

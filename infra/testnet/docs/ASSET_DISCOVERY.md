# Official test-asset discovery · 2026-09-21

No published official Rare Friends **Robinhood testnet (46630)** Genesis, Generations or RF faucet was found in the sources below. This is a finding about the checked public documentation and repositories, not proof that no private or unannounced deployment exists.

| Primary source | Finding |
| --- | --- |
| [Vibeathon README](https://github.com/spokesz/rarefriends-vibeathon#readme) | Uses mainnet NFT ownership with simulated purchases/rewards for the MVP; does not list a test NFT faucet. |
| [FriendSDK contracts guide](https://github.com/spokesz/friendsdk/blob/762d6f5/contracts/README.md) | RF and Generations are existing mainnet dependencies; test doubles are confined to tests. |
| [FriendSDK test mocks](https://github.com/spokesz/friendsdk/blob/762d6f5/contracts/test/ChanceGame.t.sol) | `MockRF` and `MockGenerations` expose minting for automated unit tests; no public faucet deployment is documented there. |
| [Rare Friends web networks](https://github.com/spokesz/rarefriends-web-public/blob/64a120e/src/config/networks.ts) | Supports Robinhood mainnet 4663 and local Anvil 31337. |
| [Web network configuration tests](https://github.com/spokesz/rarefriends-web-public/blob/64a120e/tests/runtime-config.test.ts) | Explicitly rejects testnet chain ID 46630. |

Read-only JSON-RPC verification at `https://rpc.testnet.chain.robinhood.com` returned chain ID `0xb626` (46630). `eth_getCode` at the three [documented mainnet addresses](https://rarefriends.com/docs/contracts) returned empty bytecode (`0x`) at testnet block `0x74d9ff7`:

| Mainnet contract | Address | Code at the same testnet address |
| --- | --- | --- |
| Genesis | `0x116EaA62241751E0c98dA43d458600c6C17cD361` | None |
| Generations | `0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D` | None |
| RF | `0x0779369854d3EcdEA927206718FFD7730C67B71f` | None |

Therefore this workspace retains its own clearly named test-only `TestRF` and `TestFriends` faucets. They do not establish real Rare Friends ownership. The [Robinhood faucet](https://faucet.testnet.chain.robinhood.com) provides testnet assets/gas; it is not evidence of a Rare Friends NFT faucet.

The [official RF token docs](https://rarefriends.com/docs/rarefriends) confirm **1,024,000,000 initial RF**, with no later minting and supply reduced by burns. The Rare Rush cap now matches that amount; its gradual verified-claim minting remains a different issuance model.

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

/// @dev Negative-test fixture only: deliberately configurable metadata, never an actual token.
contract BindingCandidate {
    uint256 public immutable CAP;
    uint8 public immutable decimals;
    address public immutable rewardMinter;
    uint256 public immutable launchAllocation;
    uint256 public immutable rewardAllocation;
    uint256 public immutable rewardsMinted;
    uint256 public immutable totalSupply;

    constructor(uint256 cap, uint8 precision, address minter, uint256 launch, uint256 rewards, uint256 minted, uint256 supply) {
        CAP = cap;
        decimals = precision;
        rewardMinter = minter;
        launchAllocation = launch;
        rewardAllocation = rewards;
        rewardsMinted = minted;
        totalSupply = supply;
    }
}

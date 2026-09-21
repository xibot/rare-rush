// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {RareRushDopplerPrototype} from "doppler/contracts/RareRushDopplerPrototype.sol";

/// @notice Testnet token using the exact implementation exercised by the Doppler fork proof.
/// @dev Only the display name changes. The separately deployed game is the immutable minter;
///      the launch reserve is minted once, and gameplay consumes the remaining fixed budget.
contract RareRushToken is RareRushDopplerPrototype {
    constructor(address recipient, address initialOwner, address game, uint256 launchAmount)
        RareRushDopplerPrototype(recipient, initialOwner, game, launchAmount)
    {}

    function name() public pure override returns (string memory) { return "Rare Rush Testnet"; }
    function symbol() public pure override returns (string memory) { return "tRARERUSH"; }
}

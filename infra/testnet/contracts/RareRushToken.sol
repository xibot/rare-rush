// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TestnetOnly} from "./TestnetOnly.sol";

/// @notice Testnet reward token. Only its deploying game can mint, up to the fixed cap.
/// @dev No owner minting, supply-cap changes, burns, or production-chain deployment.
contract RareRushToken is ERC20, TestnetOnly {
    uint256 public constant CAP = 1_024_000_000 * 1e6;
    address public immutable game;

    error OnlyGame();
    error SupplyCapExceeded();

    constructor() ERC20("Rare Rush Testnet", "tRARERUSH") {
        game = msg.sender;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address recipient, uint256 amount) external {
        if (msg.sender != game) revert OnlyGame();
        if (amount > CAP - totalSupply()) revert SupplyCapExceeded();
        _mint(recipient, amount);
    }
}

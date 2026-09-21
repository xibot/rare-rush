// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {TestnetOnly} from "./TestnetOnly.sol";

/// @notice Valueless testnet stand-in for RAREFRIENDS, not the real token.
/// @dev The per-address faucet is deliberately not Sybil-resistant.
contract TestRF is ERC20, TestnetOnly {
    uint256 public constant FAUCET_AMOUNT = 100 ether;
    mapping(address => uint256) public lastFaucetDayPlusOne;

    error FaucetAlreadyUsed();
    event FaucetClaimed(address indexed recipient, uint256 indexed utcDay, uint256 amount);

    constructor() ERC20("Rare Friends Testnet Faucet", "tRF") {}

    function faucet() external {
        uint256 dayPlusOne = block.timestamp / 1 days + 1;
        if (lastFaucetDayPlusOne[msg.sender] == dayPlusOne) revert FaucetAlreadyUsed();
        lastFaucetDayPlusOne[msg.sender] = dayPlusOne;
        _mint(msg.sender, FAUCET_AMOUNT);
        emit FaucetClaimed(msg.sender, dayPlusOne - 1, FAUCET_AMOUNT);
    }
}

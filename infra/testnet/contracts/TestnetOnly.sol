// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @dev These experimental contracts cannot be deployed on a production chain.
abstract contract TestnetOnly {
    error UnsupportedChain(uint256 chainId);

    constructor() {
        if (block.chainid != 46630 && block.chainid != 31337) {
            revert UnsupportedChain(block.chainid);
        }
    }
}

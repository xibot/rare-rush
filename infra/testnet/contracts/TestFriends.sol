// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {TestnetOnly} from "./TestnetOnly.sol";

/// @notice Free test NFTs; these do not establish ownership of real Rare Friends.
/// @dev Open self-minting is for exercising the test economy, not an eligibility bridge.
contract TestFriends is ERC721, TestnetOnly {
    bool public immutable isGenesis;
    uint256 public nextTokenId = 1;

    constructor(bool genesisCollection)
        ERC721(
            genesisCollection ? "Rare Rush Test Genesis" : "Rare Rush Test Generations",
            genesisCollection ? "tGENESIS" : "tGENERATIONS"
        )
    {
        isGenesis = genesisCollection;
    }

    function mint() external returns (uint256 tokenId) {
        tokenId = nextTokenId++;
        _safeMint(msg.sender, tokenId);
    }

    function generation(uint256 tokenId) external view returns (uint256) {
        _requireOwned(tokenId);
        return isGenesis ? 0 : 1;
    }
}

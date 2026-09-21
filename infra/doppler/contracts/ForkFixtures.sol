// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IRewardToken { function mintReward(address recipient, uint256 amount) external; }

/// @notice Local-only receipt fixture, not the production gameplay verifier.
/// @dev Tests signed receipt authorization, replay prevention and immutable token minter wiring.
/// It does NOT replay physics or enforce daily NFT quotas; infra/testnet tests those separately.
contract VerifiedClaimFixture is EIP712 {
    address public immutable verifier;
    address public immutable controller;
    IRewardToken public token;
    mapping(bytes32 => bool) public claimed;
    bytes32 constant CLAIM_TYPEHASH = keccak256("Claim(bytes32 runId,address player,uint256 amount,uint256 deadline)");
    error Unauthorized();
    error InvalidClaim();
    constructor(address receiptVerifier) EIP712("Rare Rush Doppler Fork Fixture", "1") {
        require(block.chainid == 31337, "LOCAL_FIXTURE_ONLY");
        verifier = receiptVerifier;
        controller = msg.sender;
    }
    function bindToken(address rewardToken) external {
        if (msg.sender != controller || address(token) != address(0) || rewardToken.code.length == 0) revert Unauthorized();
        token = IRewardToken(rewardToken);
    }
    function claim(bytes32 runId, uint256 amount, uint256 deadline, bytes calldata signature) external {
        if (address(token) == address(0) || claimed[runId] || block.timestamp > deadline) revert InvalidClaim();
        bytes32 digest = _hashTypedDataV4(keccak256(abi.encode(CLAIM_TYPEHASH, runId, msg.sender, amount, deadline)));
        if (ECDSA.recover(digest, signature) != verifier) revert Unauthorized();
        claimed[runId] = true;
        token.mintReward(msg.sender, amount);
    }
}

interface IV3Pool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function swap(address recipient, bool zeroForOne, int256 amountSpecified, uint160 sqrtPriceLimitX96, bytes calldata data)
        external returns (int256, int256);
}

/// @notice Local-only exact-input swap fixture; actual V3 pool and RF code are forked unchanged.
contract V3SwapFixture {
    using SafeERC20 for IERC20;
    address private activePool;
    address private payer;
    constructor() { require(block.chainid == 31337, "LOCAL_FIXTURE_ONLY"); }
    function swap(address pool, bool zeroForOne, uint256 amountIn, uint160 priceLimit) external {
        require(activePool == address(0) && amountIn <= uint256(type(int256).max), "INVALID_SWAP");
        activePool = pool;
        payer = msg.sender;
        IV3Pool(pool).swap(msg.sender, zeroForOne, int256(amountIn), priceLimit, "");
        activePool = address(0);
        payer = address(0);
    }
    function uniswapV3SwapCallback(int256 amount0Delta, int256 amount1Delta, bytes calldata) external {
        require(msg.sender == activePool && payer != address(0), "ONLY_ACTIVE_POOL");
        if (amount0Delta > 0) IERC20(IV3Pool(msg.sender).token0()).safeTransferFrom(payer, msg.sender, uint256(amount0Delta));
        if (amount1Delta > 0) IERC20(IV3Pool(msg.sender).token1()).safeTransferFrom(payer, msg.sender, uint256(amount1Delta));
    }
}

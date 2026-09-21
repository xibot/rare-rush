// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Compatibility prototype only. Mainnet deployment is deliberately disabled.
/// @dev Ownership manages Doppler's migration lock only; it never confers minting authority.
contract RareRushDopplerPrototype is ERC20, Ownable {
    uint256 public constant CAP = 1_024_000_000 * 1e6;
    address public immutable rewardMinter;
    uint256 public immutable launchAllocation;
    uint256 public immutable rewardAllocation;
    uint256 public rewardsMinted;
    address public pool;
    bool public isPoolLocked;

    error PrototypeNetworkOnly();
    error InvalidAllocation();
    error InvalidMinter();
    error OnlyRewardMinter();
    error RewardAllocationExceeded();
    error PoolLocked();
    error PoolAlreadyLocked();
    error PoolAlreadyUnlocked();

    constructor(address recipient, address initialOwner, address game, uint256 launchAmount)
        ERC20("Rare Rush Doppler Prototype", "pRARERUSH") Ownable(initialOwner)
    {
        if (block.chainid != 31337 && block.chainid != 46630) revert PrototypeNetworkOnly();
        if (launchAmount == 0 || launchAmount >= CAP) revert InvalidAllocation();
        if (game.code.length == 0) revert InvalidMinter();
        rewardMinter = game;
        launchAllocation = launchAmount;
        rewardAllocation = CAP - launchAmount;
        _mint(recipient, launchAmount);
    }

    function decimals() public pure override returns (uint8) { return 6; }

    function mintReward(address recipient, uint256 amount) external {
        if (msg.sender != rewardMinter) revert OnlyRewardMinter();
        if (amount > rewardAllocation - rewardsMinted) revert RewardAllocationExceeded();
        rewardsMinted += amount;
        _mint(recipient, amount);
    }

    function lockPool(address target) external onlyOwner {
        if (isPoolLocked) revert PoolAlreadyLocked();
        pool = target;
        isPoolLocked = true;
    }

    function unlockPool() external onlyOwner {
        if (!isPoolLocked) revert PoolAlreadyUnlocked();
        isPoolLocked = false;
    }

    function _update(address from, address to, uint256 amount) internal override {
        if (isPoolLocked && to == pool) revert PoolLocked();
        super._update(from, to, amount);
    }
}

interface IPrototypeAirlock {
    struct CreateParams {
        uint256 initialSupply;
        uint256 numTokensToSell;
        address numeraire;
        address tokenFactory;
        bytes tokenFactoryData;
        address governanceFactory;
        bytes governanceFactoryData;
        address poolInitializer;
        bytes poolInitializerData;
        address liquidityMigrator;
        bytes liquidityMigratorData;
        address integrator;
        bytes32 salt;
    }
    function create(CreateParams calldata params) external returns (address, address, address, address, address);
}

/// @notice Single-launch factory and launcher. Airlock module approval remains mandatory.
/// @dev The launcher envelope stops a third party consuming this factory through Airlock first.
contract RareRushDopplerFactoryPrototype {
    address public immutable airlock;
    address public immutable launcher;
    address public immutable rewardMinter;
    uint256 public immutable launchAllocation;
    address public token;
    bool private creating;
    error Unauthorized();
    error InvalidLaunch();

    constructor(address dopplerAirlock, address game, uint256 launchAmount) {
        require(block.chainid == 31337 || block.chainid == 46630, "PROTOTYPE_NETWORK_ONLY");
        require(dopplerAirlock.code.length > 0 && game.code.length > 0, "CONTRACTS_REQUIRED");
        require(launchAmount > 0 && launchAmount < 1_024_000_000 * 1e6, "INVALID_ALLOCATION");
        airlock = dopplerAirlock;
        rewardMinter = game;
        launchAllocation = launchAmount;
        launcher = msg.sender;
    }

    function launch(IPrototypeAirlock.CreateParams calldata params)
        external returns (address asset, address launchPool, address governance, address timelock, address migrationPool)
    {
        if (msg.sender != launcher) revert Unauthorized();
        if (token != address(0) || creating || params.tokenFactory != address(this)
            || params.initialSupply != launchAllocation || params.numTokensToSell != launchAllocation
            || params.tokenFactoryData.length != 0) revert InvalidLaunch();
        creating = true;
        (asset, launchPool, governance, timelock, migrationPool) = IPrototypeAirlock(airlock).create(params);
        require(asset == token && !creating, "FACTORY_NOT_USED");
    }

    // Exact ITokenFactory ABI at Doppler commit bda077cf05c834f3bb5eb311f5b86376910d7912.
    function create(uint256 initialSupply, address recipient, address initialOwner, bytes32 salt, bytes calldata data)
        external returns (address)
    {
        if (msg.sender != airlock || !creating) revert Unauthorized();
        if (token != address(0) || initialSupply != launchAllocation || recipient != airlock
            || initialOwner != airlock || data.length != 0) revert InvalidLaunch();
        creating = false;
        token = address(new RareRushDopplerPrototype{salt: salt}(recipient, initialOwner, rewardMinter, initialSupply));
        return token;
    }
}

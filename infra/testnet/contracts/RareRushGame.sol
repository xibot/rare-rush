// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {RareRushToken} from "./RareRushToken.sol";
import {TestnetOnly} from "./TestnetOnly.sol";

interface IGenerations is IERC721 {
    function generation(uint256 tokenId) external view returns (uint256);
}

/// @notice Experimental start -> survive -> verify -> claim economy for testnet only.
/// @dev The verifier is trusted to replay inputs and reject failed or invalid runs.
///      The verifier is an ECDSA signer; ERC-1271 contract signatures are not supported.
///      EIP-712 binds receipts to this chain, game, player, run and engine version.
///      Public seeds provide reproducible courses, not unpredictable randomness or bot protection.
///      The owner can pause, invalidate pending runs by rotating the verifier, and award
///      the tRF prize pool. There is no liquidity pool or real-NFT ownership bridge.
contract RareRushGame is Ownable2Step, Pausable, ReentrancyGuard, EIP712, TestnetOnly {
    using SafeERC20 for IERC20;

    uint256 public constant ENTRY_FEE = 1 ether;
    uint256 public constant INITIAL_COIN_REWARD = 10 * 1e6;
    uint256 public constant HALVING_INTERVAL = 10_000;
    uint256 public constant MAX_DAILY_RUNS = 3;
    uint256 public constant MAX_PICKUPS = 512;
    uint256 public constant CLAIM_GRACE = 15 minutes;
    bytes32 public constant RUN_RESULT_TYPEHASH = keccak256(
        "RunResult(uint256 runId,address player,bytes32 runSeed,bytes32 pickupKindsHash,bytes32 replayHash,bytes32 engineVersion,uint256 deadline,uint256 verifierEpoch)"
    );

    struct Run {
        address player;
        uint256 tokenId;
        bytes32 seed;
        uint64 startedAt;
        uint64 claimUntil;
        uint8 collection;
        uint8 difficulty;
        bool claimed;
        uint256 verifierEpoch;
        bool abandoned;
    }

    RareRushToken public immutable token;
    IERC20 public immutable rf;
    IERC721 public immutable genesis;
    IGenerations public immutable generations;
    bytes32 public immutable engineVersion;
    address public verifier;
    uint256 public verifierEpoch = 1;
    uint256 public runCount;
    uint256 public claimedPickups;
    uint256 public prizePoolBalance;

    mapping(uint256 => Run) public runs;
    mapping(bytes32 => uint256) public activeRunByNft;
    mapping(bytes32 => mapping(uint256 => uint256)) public dailyStarts;
    mapping(bytes32 => bool) public prizeAwards;

    error InvalidAddress();
    error ContractRequired(address account);
    error InvalidEngineVersion();
    error InvalidCollection();
    error InvalidDifficulty();
    error NotNftOwner();
    error NotHardwiredGenerations();
    error DailyRunLimitReached();
    error NftRunActive(uint256 runId);
    error IncorrectEntryFeeReceived();
    error UnknownRun();
    error NotRunPlayer();
    error RunFinalized();
    error RunNotFinished();
    error ClaimExpired();
    error InvalidDeadline();
    error InvalidVerifierEpoch();
    error InvalidVerifierSignature();
    error InvalidReplayHash();
    error TooManyPickups();
    error InvalidPickupKind();
    error InvalidAward();
    error PrizePoolInsufficient();

    event RunStarted(
        uint256 indexed runId,
        address indexed player,
        bytes32 indexed nft,
        uint8 collection,
        uint256 tokenId,
        uint8 difficulty,
        bytes32 seed,
        uint64 startedAt,
        uint64 claimUntil,
        uint256 verifierEpoch
    );
    event RunClaimed(
        uint256 indexed runId,
        address indexed player,
        uint256 pickups,
        uint256 reward,
        bytes32 replayHash
    );
    event RunAbandoned(uint256 indexed runId, address indexed player);
    event VerifierChanged(address indexed oldVerifier, address indexed newVerifier, uint256 epoch);
    event PrizeAwarded(bytes32 indexed awardId, address indexed recipient, uint256 amount);

    constructor(
        address initialOwner,
        address initialVerifier,
        address rfAddress,
        address genesisAddress,
        address generationsAddress,
        bytes32 version
    ) Ownable(initialOwner) EIP712("RareRushTestnet", "1") {
        if (initialVerifier == address(0)) revert InvalidAddress();
        if (version == bytes32(0)) revert InvalidEngineVersion();
        _requireContract(rfAddress);
        _requireContract(genesisAddress);
        _requireContract(generationsAddress);
        verifier = initialVerifier;
        rf = IERC20(rfAddress);
        genesis = IERC721(genesisAddress);
        generations = IGenerations(generationsAddress);
        engineVersion = version;
        token = new RareRushToken();
    }

    /// @param collection 0 = test Generations; 1 = test Genesis.
    /// @param difficulty 0 = Easy; 1 = Normal; 2 = Degen.
    /// @dev A paid or free start consumes one daily attempt even if abandoned or lost.
    function startRun(uint8 collection, uint256 tokenId, uint8 difficulty)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 runId)
    {
        _validateOptions(collection, difficulty);
        _checkOwnership(collection, tokenId, msg.sender);
        bytes32 nft = nftKey(collection, tokenId);
        uint256 previousId = activeRunByNft[nft];
        if (previousId != 0 && block.timestamp <= runs[previousId].claimUntil) {
            revert NftRunActive(previousId);
        }
        uint256 utcDay = block.timestamp / 1 days;
        if (dailyStarts[nft][utcDay] >= MAX_DAILY_RUNS) revert DailyRunLimitReached();
        dailyStarts[nft][utcDay]++;

        runId = ++runCount;
        uint64 startedAt = uint64(block.timestamp);
        uint64 claimUntil = startedAt + durationFor(difficulty) + uint64(CLAIM_GRACE);
        bytes32 seed = keccak256(abi.encode(
            block.chainid, address(this), runId, msg.sender, block.timestamp,
            collection, tokenId, difficulty
        ));
        runs[runId] = Run({
            player: msg.sender,
            tokenId: tokenId,
            seed: seed,
            startedAt: startedAt,
            claimUntil: claimUntil,
            collection: collection,
            difficulty: difficulty,
            claimed: false,
            verifierEpoch: verifierEpoch,
            abandoned: false
        });
        activeRunByNft[nft] = runId;

        if (collection == 0) {
            uint256 balanceBefore = rf.balanceOf(address(this));
            rf.safeTransferFrom(msg.sender, address(this), ENTRY_FEE);
            if (rf.balanceOf(address(this)) - balanceBefore != ENTRY_FEE) {
                revert IncorrectEntryFeeReceived();
            }
            prizePoolBalance += ENTRY_FEE;
        }

        emit RunStarted(
            runId, msg.sender, nft, collection, tokenId, difficulty,
            seed, startedAt, claimUntil, verifierEpoch
        );
    }

    /// @notice Mint a successful run after the offchain verifier checks its full replay.
    /// @param pickupKinds Ordered pickups: byte 0 = ordinary coin; byte 1 = 10x bonus coin.
    /// @dev Reward rates use global successful-claim order, not pickup wall-clock time.
    ///      The original player must still own the NFT when claiming.
    function claim(
        uint256 runId,
        bytes calldata pickupKinds,
        bytes32 replayHash,
        uint256 deadline,
        bytes calldata signature
    ) external nonReentrant whenNotPaused returns (uint256 reward) {
        Run storage run = runs[runId];
        _checkRunPlayer(run);
        if (run.claimed || run.abandoned) revert RunFinalized();
        if (run.verifierEpoch != verifierEpoch) revert InvalidVerifierEpoch();
        if (block.timestamp < uint256(run.startedAt) + durationFor(run.difficulty)) revert RunNotFinished();
        if (deadline > run.claimUntil || deadline == 0) revert InvalidDeadline();
        if (block.timestamp > deadline) revert ClaimExpired();
        if (replayHash == bytes32(0)) revert InvalidReplayHash();
        _checkOwnership(run.collection, run.tokenId, msg.sender);

        bytes32 structHash = keccak256(abi.encode(
            RUN_RESULT_TYPEHASH, runId, run.player, run.seed, keccak256(pickupKinds),
            replayHash, engineVersion, deadline, run.verifierEpoch
        ));
        if (ECDSA.recover(_hashTypedDataV4(structHash), signature) != verifier) {
            revert InvalidVerifierSignature();
        }
        reward = quoteReward(pickupKinds, run.collection, run.difficulty);
        run.claimed = true;
        claimedPickups += pickupKinds.length;
        _clearActiveRun(runId, run);
        if (reward != 0) token.mint(msg.sender, reward);
        emit RunClaimed(runId, msg.sender, pickupKinds.length, reward, replayHash);
    }

    /// @notice Forfeit an unfinished/failed run so the NFT can start another attempt.
    /// @dev Available while paused. It never refunds an entry or restores a daily attempt.
    function abandonRun(uint256 runId) external nonReentrant {
        Run storage run = runs[runId];
        _checkRunPlayer(run);
        if (run.claimed || run.abandoned) revert RunFinalized();
        run.abandoned = true;
        _clearActiveRun(runId, run);
        emit RunAbandoned(runId, msg.sender);
    }

    /// @notice Current estimate only; intervening claims can change the final reward.
    function quoteReward(bytes calldata pickupKinds, uint8 collection, uint8 difficulty)
        public
        view
        returns (uint256 reward)
    {
        _validateOptions(collection, difficulty);
        if (pickupKinds.length > MAX_PICKUPS) revert TooManyPickups();
        uint256 remaining = token.CAP() - token.totalSupply();
        for (uint256 i; i < pickupKinds.length; ++i) {
            uint8 kind = uint8(pickupKinds[i]);
            if (kind > 1) revert InvalidPickupKind();
            uint256 coinReward = INITIAL_COIN_REWARD >> ((claimedPickups + i) / HALVING_INTERVAL);
            if (difficulty == 0) coinReward = coinReward * 3 / 4;
            else if (difficulty == 2) coinReward *= 2;
            if (kind == 1) coinReward *= 10;
            if (collection == 1) coinReward *= 100;
            if (coinReward > remaining) coinReward = remaining;
            reward += coinReward;
            remaining -= coinReward;
        }
    }

    function nftKey(uint8 collection, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(collection, tokenId));
    }

    function durationFor(uint8 difficulty) public pure returns (uint64) {
        if (difficulty == 0) return 120;
        if (difficulty == 1) return 90;
        if (difficulty == 2) return 60;
        revert InvalidDifficulty();
    }

    /// @notice Emergency rotation invalidates every unclaimed run from older epochs.
    /// @dev Rotating to the same verifier is allowed to revoke previously signed receipts.
    function setVerifier(address newVerifier) external onlyOwner {
        if (newVerifier == address(0)) revert InvalidAddress();
        address oldVerifier = verifier;
        verifier = newVerifier;
        verifierEpoch++;
        emit VerifierChanged(oldVerifier, newVerifier, verifierEpoch);
    }

    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    /// @notice Owner-administered test prize distribution; not automatic leaderboard settlement.
    function awardPrize(bytes32 awardId, address recipient, uint256 amount)
        external
        onlyOwner
        nonReentrant
        whenNotPaused
    {
        if (
            awardId == bytes32(0) || prizeAwards[awardId] || recipient == address(0)
                || recipient == address(this) || amount == 0
        ) {
            revert InvalidAward();
        }
        if (amount > prizePoolBalance) revert PrizePoolInsufficient();
        prizeAwards[awardId] = true;
        prizePoolBalance -= amount;
        rf.safeTransfer(recipient, amount);
        emit PrizeAwarded(awardId, recipient, amount);
    }

    function _requireContract(address account) private view {
        if (account == address(0)) revert InvalidAddress();
        if (account.code.length == 0) revert ContractRequired(account);
    }

    function _validateOptions(uint8 collection, uint8 difficulty) private pure {
        if (collection > 1) revert InvalidCollection();
        if (difficulty > 2) revert InvalidDifficulty();
    }

    function _checkOwnership(uint8 collection, uint256 tokenId, address player) private view {
        if (collection == 0) {
            if (generations.ownerOf(tokenId) != player) revert NotNftOwner();
            if (generations.generation(tokenId) < 1) revert NotHardwiredGenerations();
        } else if (genesis.ownerOf(tokenId) != player) {
            revert NotNftOwner();
        }
    }

    function _checkRunPlayer(Run storage run) private view {
        if (run.player == address(0)) revert UnknownRun();
        if (run.player != msg.sender) revert NotRunPlayer();
    }

    function _clearActiveRun(uint256 runId, Run storage run) private {
        bytes32 nft = nftKey(run.collection, run.tokenId);
        if (activeRunByNft[nft] == runId) delete activeRunByNft[nft];
    }
}

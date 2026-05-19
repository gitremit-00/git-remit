// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title RemittancePledge — OFW Payment Pledge System on Morph L2
contract RemittancePledge is ReentrancyGuard {
    using ECDSA for bytes32;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant GRACE_PERIOD = 3 days;
    uint256 public constant MAX_PLEDGE_DAYS = 90 days;
    uint256 public constant MAX_EXTENSION = 30 days;

    // Weights in basis points (out of 10000)
    uint256 public constant WEIGHT_ON_TIME = 10000; // 100%
    uint256 public constant WEIGHT_LATE    = 7000;  // 70%
    // defaults contribute 0 to weightedScore — only totalWeight is incremented

    // Minimum deposit tiers based on trust score (in basis points)
    // Score >= 8000 (80%) → 20% deposit
    // Score >= 5000 (50%) → 30% deposit
    // Score >= 2000 (20%) → 40% deposit
    // Score <  2000 (20%) → 50% deposit
    // New sender (no history) → 20% deposit
    uint256 public constant TIER_HIGH   = 8000; // 80%+
    uint256 public constant TIER_MID    = 5000; // 50%+
    uint256 public constant TIER_LOW    = 2000; // 20%+

    uint256 public constant DEPOSIT_TIER_HIGH = 20; // 20% upfront
    uint256 public constant DEPOSIT_TIER_MID  = 30; // 30% upfront
    uint256 public constant DEPOSIT_TIER_LOW  = 40; // 40% upfront
    uint256 public constant DEPOSIT_TIER_RISK = 50; // 50% upfront

    // ── Types ──────────────────────────────────────────────────────────────────
    enum PledgeStatus { PENDING, COMPLETED, DEFAULTED, CANCELLED }

    struct Pledge {
        uint256 id;
        address sender;
        address merchant;
        uint256 totalAmount;
        uint256 initialDeposit;
        uint256 depositedAmount;
        uint256 commitmentDate;
        PledgeStatus status;
        bool paidDuringGrace;
    }

    struct Reputation {
        uint256 onTimeCount;
        uint256 lateCount;
        uint256 defaultCount;
        uint256 totalCount;
        uint256 weightedScore; // sum of (pledgeAmount * weight) across resolved pledges
        uint256 totalWeight;   // sum of pledgeAmount across resolved pledges
    }

    // Max concurrent active pledges per trust tier
    uint256 public constant MAX_ACTIVE_NO_HISTORY = 2;
    uint256 public constant MAX_ACTIVE_MID        = 3;
    uint256 public constant MAX_ACTIVE_HIGH       = 5;

    // Protocol fee: 1% of completed pledge amount (in basis points, out of 10000)
    uint256 public constant FEE_BPS = 100; // 1%

    // If merchant never claims after a default, sender can reclaim after this period
    uint256 public constant UNCLAIMED_TIMEOUT = 180 days;

    // ── State ──────────────────────────────────────────────────────────────────
    IERC20 public immutable usdc;
    address public immutable feeRecipient;
    uint256 public pledgeCounter;

    mapping(uint256 => Pledge) public pledges;
    mapping(address => Reputation) public reputations;
    mapping(address => uint256) public activePledgeCount;
    mapping(address => uint256[]) private senderPledgeIds;
    mapping(address => uint256[]) private merchantPledgeIds;

    // ── Events ─────────────────────────────────────────────────────────────────
    event PledgeCreated(
        uint256 indexed pledgeId,
        address indexed sender,
        address indexed merchant,
        uint256 totalAmount,
        uint256 initialDeposit,
        uint256 commitmentDate
    );
    event PledgeCompleted(uint256 indexed pledgeId, address indexed merchant, uint256 amount);
    event PledgeDefaulted(uint256 indexed pledgeId, address indexed merchant, uint256 amount);
    event FeeCollected(uint256 indexed pledgeId, address indexed feeRecipient, uint256 fee);
    event DepositReclaimed(uint256 indexed pledgeId, address indexed sender, uint256 amount);
    event PledgeCancelled(uint256 indexed pledgeId, address indexed sender, address indexed merchant, uint256 refund);
    event DeadlineExtended(uint256 indexed pledgeId, uint256 oldDate, uint256 newDate);
    event DepositMade(uint256 indexed pledgeId, address indexed sender, uint256 amount, uint256 totalDeposited);

    // ── Constructor ────────────────────────────────────────────────────────────
    /// @param _usdcToken Address of the USDC token contract (MockUSDC on testnet)
    /// @param _feeRecipient Address that receives the 1% protocol fee on completed pledges
    constructor(address _usdcToken, address _feeRecipient) {
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        usdc = IERC20(_usdcToken);
        feeRecipient = _feeRecipient;
    }

    // ── Write Functions ────────────────────────────────────────────────────────

    /// @notice Create a new payment pledge with an initial USDC deposit
    /// @param merchant Address of the merchant who will receive payment
    /// @param totalAmount Total USDC amount promised (6 decimals)
    /// @param initialDeposit Initial deposit amount — minimum depends on sender trust score
    /// @param commitmentDate Unix timestamp of the payment deadline (max 90 days out)
    function createPledge(
        address merchant,
        uint256 totalAmount,
        uint256 initialDeposit,
        uint256 commitmentDate
    ) external nonReentrant {
        require(merchant != address(0), "Invalid merchant address");
        require(merchant != msg.sender, "Sender cannot be merchant");
        require(totalAmount > 0, "Total amount must be > 0");

        uint256 maxActive = getMaxActivePledges(msg.sender);
        require(activePledgeCount[msg.sender] < maxActive, "Active pledge limit reached for your trust tier");

        uint256 requiredPct = getRequiredDepositPct(msg.sender);
        require(
            initialDeposit >= (totalAmount * requiredPct) / 100,
            string(abi.encodePacked(
                "Your trust score requires at least ",
                _toString(requiredPct),
                "% upfront"
            ))
        );
        require(initialDeposit <= totalAmount, "Deposit cannot exceed total");
        require(
            commitmentDate <= block.timestamp + MAX_PLEDGE_DAYS,
            "Max 90 days commitment"
        );
        require(commitmentDate > block.timestamp, "Commitment date must be in future");

        uint256 pledgeId = ++pledgeCounter;

        pledges[pledgeId] = Pledge({
            id: pledgeId,
            sender: msg.sender,
            merchant: merchant,
            totalAmount: totalAmount,
            initialDeposit: initialDeposit,
            depositedAmount: initialDeposit,
            commitmentDate: commitmentDate,
            status: PledgeStatus.PENDING,
            paidDuringGrace: false
        });

        senderPledgeIds[msg.sender].push(pledgeId);
        merchantPledgeIds[merchant].push(pledgeId);
        reputations[msg.sender].totalCount++;
        activePledgeCount[msg.sender]++;

        require(
            usdc.transferFrom(msg.sender, address(this), initialDeposit),
            "USDC transfer failed"
        );

        emit PledgeCreated(pledgeId, msg.sender, merchant, totalAmount, initialDeposit, commitmentDate);
    }

    /// @notice Deposit remaining balance toward a pledge
    /// @param pledgeId ID of the pledge to top up
    /// @param amount Amount of USDC to deposit
    function depositRemaining(uint256 pledgeId, uint256 amount) external nonReentrant {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can deposit");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp <= pledge.commitmentDate + GRACE_PERIOD,
            "Grace period has ended"
        );
        require(amount > 0, "Amount must be > 0");
        require(
            pledge.depositedAmount + amount <= pledge.totalAmount,
            "Would exceed total amount"
        );

        bool paidLate = block.timestamp > pledge.commitmentDate;
        if (paidLate) {
            pledge.paidDuringGrace = true;
        }

        pledge.depositedAmount += amount;

        require(
            usdc.transferFrom(msg.sender, address(this), amount),
            "USDC transfer failed"
        );

        emit DepositMade(pledgeId, msg.sender, amount, pledge.depositedAmount);

        if (pledge.depositedAmount >= pledge.totalAmount) {
            _releaseFunds(pledgeId);
        }
    }

    /// @notice Merchant claims the initial deposit after grace period (pledge default)
    /// @param pledgeId ID of the defaulted pledge
    function claimPartial(uint256 pledgeId) external nonReentrant {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.merchant, "Only merchant can claim");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp > pledge.commitmentDate + GRACE_PERIOD,
            "Grace period not over yet"
        );
        uint256 claimAmount = pledge.depositedAmount;

        // State change before transfer — prevents reentrancy double-claim
        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;

        Reputation storage rep = reputations[pledge.sender];
        rep.defaultCount++;
        rep.totalWeight += pledge.totalAmount;
        activePledgeCount[pledge.sender]--;

        require(
            usdc.transfer(pledge.merchant, claimAmount),
            "USDC transfer failed"
        );

        emit PledgeDefaulted(pledgeId, pledge.merchant, claimAmount);
    }


    /// @notice Reclaim deposit if merchant never claimed after 180 days past the grace period
    /// @param pledgeId ID of the unclaimed defaulted pledge
    function reclaimDeposit(uint256 pledgeId) external nonReentrant {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can reclaim");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp > pledge.commitmentDate + GRACE_PERIOD + UNCLAIMED_TIMEOUT,
            "Reclaim period not reached yet"
        );

        uint256 amount = pledge.depositedAmount;
        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;

        Reputation storage rep = reputations[pledge.sender];
        rep.defaultCount++;
        rep.totalWeight += pledge.totalAmount;
        activePledgeCount[pledge.sender]--;

        require(usdc.transfer(pledge.sender, amount), "USDC transfer failed");

        emit DepositReclaimed(pledgeId, pledge.sender, amount);
    }

    /// @notice Extend a pledge deadline with merchant's off-chain signature approval
    /// @param pledgeId ID of the pledge to extend
    /// @param newDate New commitment date (max 30 days past current deadline)
    /// @param merchantSig Merchant's ECDSA signature approving the extension
    function extendDeadline(
        uint256 pledgeId,
        uint256 newDate,
        bytes calldata merchantSig
    ) external nonReentrant {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can extend");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(block.timestamp < pledge.commitmentDate, "Cannot extend after deadline");
        require(newDate > pledge.commitmentDate, "New date must be later");
        require(
            newDate <= pledge.commitmentDate + MAX_EXTENSION,
            "Max 30-day extension"
        );

        // Verify merchant signed the extension approval
        bytes32 msgHash = keccak256(
            abi.encodePacked(pledgeId, newDate, pledge.commitmentDate, address(this))
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        address recovered = ECDSA.recover(ethHash, merchantSig);
        require(recovered == pledge.merchant, "Invalid merchant signature");

        uint256 oldDate = pledge.commitmentDate;
        pledge.commitmentDate = newDate;

        emit DeadlineExtended(pledgeId, oldDate, newDate);
    }

    /// @notice Cancel a pledge by mutual agreement — sender calls with merchant's signature
    /// @param pledgeId ID of the pledge to cancel
    /// @param merchantSig Merchant's ECDSA signature approving the cancellation
    function cancelPledge(uint256 pledgeId, bytes calldata merchantSig) external nonReentrant {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can cancel");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(block.timestamp < pledge.commitmentDate, "Cannot cancel after deadline");

        bytes32 msgHash = keccak256(
            abi.encodePacked(pledgeId, "cancel", address(this))
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        address recovered = ECDSA.recover(ethHash, merchantSig);
        require(recovered == pledge.merchant, "Invalid merchant signature");

        uint256 refund = pledge.depositedAmount;
        pledge.status = PledgeStatus.CANCELLED;
        pledge.depositedAmount = 0;
        activePledgeCount[pledge.sender]--;

        require(usdc.transfer(pledge.sender, refund), "USDC transfer failed");

        emit PledgeCancelled(pledgeId, pledge.sender, pledge.merchant, refund);
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    function _releaseFunds(uint256 pledgeId) internal {
        Pledge storage pledge = pledges[pledgeId];
        uint256 amount = pledge.totalAmount;

        pledge.status = PledgeStatus.COMPLETED;
        pledge.depositedAmount = 0;

        Reputation storage rep = reputations[pledge.sender];
        if (pledge.paidDuringGrace) {
            rep.lateCount++;
            rep.weightedScore += pledge.totalAmount * WEIGHT_LATE;
        } else {
            rep.onTimeCount++;
            rep.weightedScore += pledge.totalAmount * WEIGHT_ON_TIME;
        }
        rep.totalWeight += pledge.totalAmount;
        activePledgeCount[pledge.sender]--;

        uint256 fee = (amount * FEE_BPS) / 10000;
        uint256 merchantAmount = amount - fee;

        require(usdc.transfer(feeRecipient, fee), "Fee transfer failed");
        require(usdc.transfer(pledge.merchant, merchantAmount), "USDC transfer failed");

        emit FeeCollected(pledgeId, feeRecipient, fee);
        emit PledgeCompleted(pledgeId, pledge.merchant, merchantAmount);
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    /// @notice Get reputation data for a wallet
    /// @return basisPoints Score 0–10000 (divide by 100 for percentage)
    /// @return onTimeCount Pledges paid on time
    /// @return lateCount Pledges paid during grace period
    /// @return defaultCount Pledges defaulted
    /// @return totalCount Total pledges created
    function getReputation(address wallet)
        external
        view
        returns (
            uint256 basisPoints,
            uint256 onTimeCount,
            uint256 lateCount,
            uint256 defaultCount,
            uint256 totalCount
        )
    {
        Reputation storage rep = reputations[wallet];
        uint256 score = 0;
        if (rep.totalWeight > 0) {
            score = rep.weightedScore / rep.totalWeight;
        }
        return (score, rep.onTimeCount, rep.lateCount, rep.defaultCount, rep.totalCount);
    }

    /// @notice Get full pledge details
    function getPledge(uint256 pledgeId) external view returns (Pledge memory) {
        require(pledges[pledgeId].id != 0, "Pledge does not exist");
        return pledges[pledgeId];
    }

    /// @notice Get all pledge IDs created by a sender
    function getSenderPledges(address sender) external view returns (uint256[] memory) {
        return senderPledgeIds[sender];
    }

    /// @notice Get all pledge IDs for a merchant
    function getMerchantPledges(address merchant) external view returns (uint256[] memory) {
        return merchantPledgeIds[merchant];
    }

    /// @notice Get the maximum number of concurrent active pledges allowed for a sender
    /// @return max Allowed active pledge count (2, 3, or 5)
    function getMaxActivePledges(address sender) public view returns (uint256 max) {
        Reputation storage rep = reputations[sender];

        if (rep.totalWeight == 0) return MAX_ACTIVE_NO_HISTORY;

        uint256 score = rep.weightedScore / rep.totalWeight;

        if (score >= TIER_HIGH) return MAX_ACTIVE_HIGH;
        if (score >= TIER_MID)  return MAX_ACTIVE_MID;
        return MAX_ACTIVE_NO_HISTORY;
    }

    /// @notice Get the required upfront deposit percentage for a sender based on their trust score
    /// @return pct Required deposit percentage (20, 30, 40, or 50)
    function getRequiredDepositPct(address sender) public view returns (uint256 pct) {
        Reputation storage rep = reputations[sender];

        // No resolved history yet — standard 20%
        if (rep.totalWeight == 0) return DEPOSIT_TIER_HIGH;

        uint256 score = rep.weightedScore / rep.totalWeight;

        if (score >= TIER_HIGH) return DEPOSIT_TIER_HIGH; // 80%+ score → 20% deposit
        if (score >= TIER_MID)  return DEPOSIT_TIER_MID;  // 50%+ score → 30% deposit
        if (score >= TIER_LOW)  return DEPOSIT_TIER_LOW;  // 20%+ score → 40% deposit
        return DEPOSIT_TIER_RISK;                          // below 20%  → 50% deposit
    }

    /// @dev Converts uint256 to string for error messages
    function _toString(uint256 value) internal pure returns (string memory) {
        if (value == 0) return "0";
        uint256 temp = value;
        uint256 digits;
        while (temp != 0) { digits++; temp /= 10; }
        bytes memory buffer = new bytes(digits);
        while (value != 0) {
            digits--;
            buffer[digits] = bytes1(uint8(48 + (value % 10)));
            value /= 10;
        }
        return string(buffer);
    }
}

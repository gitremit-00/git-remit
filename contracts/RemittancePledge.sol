// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title RemittancePledge — OFW Payment Pledge System on Morph L2
/// @notice Lets a sender lock a partial stablecoin deposit and commit to a future payment date.
///         Supports any whitelisted ERC20 (USDC, USDT, etc.) with 6 decimals.
///         Reputation is unified across all tokens — a sender's history carries regardless
///         of which token they use. Pledge IDs start at 1 (pre-increment of pledgeCounter),
///         so id == 0 always means "nonexistent".
/// @dev Assumes standard, non-rebasing, non-fee-on-transfer ERC20 tokens only.
contract RemittancePledge is ReentrancyGuard, Pausable, Ownable2Step {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant GRACE_PERIOD    = 3 days;
    uint256 public constant MAX_PLEDGE_DAYS = 90 days;
    uint256 public constant MAX_EXTENSION   = 30 days;

    /// @dev Merchant must claim a defaulted deposit within this window after the grace period.
    uint256 public constant CLAIM_WINDOW = 30 days;
    /// @dev Small buffer absorbing validator timestamp drift on time-sensitive checks.
    uint256 public constant TIME_BUFFER = 15 minutes;

    // Reputation weights in basis points (out of 10000)
    uint256 public constant WEIGHT_ON_TIME = 10000; // 100%
    uint256 public constant WEIGHT_LATE    = 7000;  // 70%
    // Defaults contribute 0 to weightedScore — only totalWeight is incremented.

    // Trust score tiers (basis points, out of 10000)
    uint256 public constant TIER_HIGH = 8000; // 80%+
    uint256 public constant TIER_MID  = 5000; // 50%+
    uint256 public constant TIER_LOW  = 2000; // 20%+

    // Required upfront deposit percentage per tier
    uint256 public constant DEPOSIT_TIER_HIGH = 20; // 20% upfront
    uint256 public constant DEPOSIT_TIER_MID  = 30; // 30% upfront
    uint256 public constant DEPOSIT_TIER_LOW  = 40; // 40% upfront
    uint256 public constant DEPOSIT_TIER_RISK = 50; // 50% upfront

    // Max concurrent active pledges per trust tier
    uint256 public constant MAX_ACTIVE_NO_HISTORY = 2;
    uint256 public constant MAX_ACTIVE_MID        = 3;
    uint256 public constant MAX_ACTIVE_HIGH       = 5;

    /// @dev Serial defaulters are capped here regardless of any on-time history.
    uint256 public constant DEFAULT_LOCKOUT_THRESHOLD = 3;

    // Protocol fee tiers (basis points, out of 10000) — REWARD-ONLY model.
    // Everyone pays the standard rate; high-trust senders earn a loyalty discount.
    // No sender ever pays MORE than the standard rate — there is no penalty tier.
    uint256 public constant FEE_BPS_STANDARD = 100; // 1%    — new and mid-trust senders
    uint256 public constant FEE_BPS_LOYALTY  = 75;  // 0.75% — high-trust senders (80%+ score)

    /// @dev 1 unit (6 decimals) — prevents dust-pledge reputation washing.
    ///      Works for any whitelisted 6-decimal token (USDC, USDT, etc.).
    uint256 public constant MIN_PLEDGE_AMOUNT = 1_000_000;

    // Recurring pledge constraints
    uint256 public constant MIN_RECURRING_INTERVAL = 7 days;
    uint256 public constant MAX_RECURRING_PERIODS  = 12;

    // Reputation weight for each completed recurring installment (50% of full weight).
    // The remaining 50% is granted as a completion bonus when all periods are settled.
    uint256 public constant WEIGHT_INSTALLMENT_PARTIAL  = 5000;
    uint256 public constant WEIGHT_INSTALLMENT_BONUS    = 5000;

    // ── Types ──────────────────────────────────────────────────────────────────
    enum PledgeStatus { PENDING, COMPLETED, DEFAULTED, CANCELLED }

    enum RecurringStatus { ACTIVE, PENDING_SETTLEMENT, COMPLETED, CANCELLED }

    struct RecurringPledge {
        uint256 id;
        address sender;
        address merchant;
        address token;
        uint256 amountPerPeriod;   // net amount merchant receives per installment
        uint256 intervalSeconds;   // time between installments (min 7 days)
        uint256 totalPeriods;      // total number of installments (max 12)
        uint256 periodsCompleted;  // installments fully paid and released
        uint256 missedCount;       // installments flagged as missed by merchant
        uint256 totalMissedDebt;   // total unpaid missed installment amounts
        uint256 nextDueDate;       // due date of the next installment
        uint256 appliedFeeBps;     // fee rate locked at creation
        RecurringStatus status;
    }

    struct Pledge {
        uint256 id;
        address sender;
        address merchant;
        address token;           // whitelisted ERC20 used for this pledge
        uint256 totalAmount;     // amount the merchant ultimately receives
        uint256 initialDeposit;  // first deposit locked at creation
        uint256 depositedAmount; // running total deposited (gross, fee-inclusive)
        uint256 commitmentDate;  // payment deadline
        uint256 appliedFeeBps;   // fee rate locked in at creation — see getServiceFeeBps()
        PledgeStatus status;
        bool paidDuringGrace;    // true if completed after the deadline but within grace
    }

    struct Reputation {
        uint256 onTimeCount;
        uint256 lateCount;
        uint256 defaultCount;
        uint256 totalCount;    // resolved pledges only (completed + defaulted)
        uint256 weightedScore; // sum of (pledgeAmount * weight) across resolved pledges
        uint256 totalWeight;   // sum of pledgeAmount across resolved pledges
    }

    // ── State ──────────────────────────────────────────────────────────────────
    /// @notice Returns true if a token is accepted for new pledges.
    mapping(address => bool) public allowedTokens;

    address public feeRecipient;
    uint256 public pledgeCounter;

    mapping(uint256 => Pledge) public pledges;
    mapping(address => Reputation) public reputations;
    mapping(address => uint256) public activePledgeCount;

    // Per-pledge nonces — prevent replay of merchant signatures.
    mapping(uint256 => uint256) public extensionNonces;
    mapping(uint256 => uint256) public cancelNonces;

    // NOTE: these arrays grow unboundedly. Use the paginated getters for heavy users,
    // and off-chain indexing (e.g. The Graph) in production.
    mapping(address => uint256[]) private senderPledgeIds;
    mapping(address => uint256[]) private merchantPledgeIds;

    // ── Recurring Pledge State ─────────────────────────────────────────────────
    uint256 public recurringCounter;
    mapping(uint256 => RecurringPledge) public recurringPledges;
    mapping(uint256 => uint256) public recurringCancelNonces;
    mapping(address => uint256[]) private senderRecurringIds;
    mapping(address => uint256[]) private merchantRecurringIds;

    // ── Events ─────────────────────────────────────────────────────────────────
    event PledgeCreated(
        uint256 indexed pledgeId,
        address indexed sender,
        address indexed merchant,
        address token,
        uint256 totalAmount,
        uint256 initialDeposit,
        uint256 commitmentDate,
        uint256 appliedFeeBps
    );
    event DepositMade(uint256 indexed pledgeId, address indexed sender, uint256 amount, uint256 totalDeposited);
    event PledgeCompleted(uint256 indexed pledgeId, address indexed merchant, uint256 amount);
    event PledgeDefaulted(uint256 indexed pledgeId, address indexed merchant, uint256 amount);
    event PledgeCancelled(uint256 indexed pledgeId, address indexed sender, address indexed merchant, uint256 refund);
    event DepositReclaimed(uint256 indexed pledgeId, address indexed sender, uint256 amount);
    event DeadlineExtended(uint256 indexed pledgeId, uint256 oldDate, uint256 newDate);
    event FeeCollected(uint256 indexed pledgeId, address indexed feeRecipient, uint256 fee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TokenAllowanceSet(address indexed token, bool allowed);

    // Recurring pledge events
    event RecurringPledgeCreated(
        uint256 indexed recurringId,
        address indexed sender,
        address indexed merchant,
        address token,
        uint256 amountPerPeriod,
        uint256 intervalSeconds,
        uint256 totalPeriods,
        uint256 firstDueDate,
        uint256 appliedFeeBps
    );
    event InstallmentPaid(uint256 indexed recurringId, address indexed sender, uint256 period, uint256 amount);
    event InstallmentMissed(uint256 indexed recurringId, uint256 period, uint256 debtAdded);
    event DebtSettled(uint256 indexed recurringId, address indexed sender, uint256 amount);
    event RecurringPledgeCompleted(uint256 indexed recurringId, address indexed merchant);
    event RecurringPledgeCancelled(uint256 indexed recurringId, address indexed sender, address indexed merchant);

    // ── Constructor ────────────────────────────────────────────────────────────
    /// @param initialTokens List of token addresses to whitelist at deployment (e.g. [USDC, USDT])
    /// @param _feeRecipient  Address that receives the protocol fee on completed pledges
    constructor(address[] memory initialTokens, address _feeRecipient) Ownable(msg.sender) {
        require(initialTokens.length > 0, "At least one token required");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        for (uint256 i = 0; i < initialTokens.length; i++) {
            require(initialTokens[i] != address(0), "Invalid token address");
            allowedTokens[initialTokens[i]] = true;
            emit TokenAllowanceSet(initialTokens[i], true);
        }
        feeRecipient = _feeRecipient;
    }

    // ── Write Functions ────────────────────────────────────────────────────────

    /// @notice Create a new payment pledge with an initial stablecoin deposit.
    /// @param token          Whitelisted ERC20 token to use for this pledge (USDC, USDT, etc.)
    /// @param merchant       Address of the merchant who will receive payment
    /// @param totalAmount    Net token amount the merchant receives (6 decimals)
    /// @param initialDeposit Initial gross deposit — minimum depends on sender trust score
    /// @param commitmentDate Unix timestamp of the payment deadline (max 90 days out)
    function createPledge(
        address token,
        address merchant,
        uint256 totalAmount,
        uint256 initialDeposit,
        uint256 commitmentDate
    ) external nonReentrant whenNotPaused {
        require(allowedTokens[token], "Token not supported");
        require(merchant != address(0), "Invalid merchant address");
        require(merchant != msg.sender, "Sender cannot be merchant");
        require(totalAmount >= MIN_PLEDGE_AMOUNT, "Amount below minimum");
        require(commitmentDate > block.timestamp, "Commitment date must be in future");
        require(
            commitmentDate <= block.timestamp + MAX_PLEDGE_DAYS,
            "Max 90 days commitment"
        );

        uint256 maxActive = getMaxActivePledges(msg.sender);
        require(
            activePledgeCount[msg.sender] < maxActive,
            "Active pledge limit reached for your trust tier"
        );

        // Lock the sender's fee rate in at creation time. Even if their trust score
        // changes before completion, this pledge keeps the rate it was created with —
        // so the upfront gross deposit always matches the fee charged at release.
        uint256 feeBps = getServiceFeeBps(msg.sender);

        uint256 gross = _grossWithFee(totalAmount, feeBps);
        uint256 requiredPct = getRequiredDepositPct(msg.sender);
        require(
            initialDeposit >= (gross * requiredPct) / 100,
            string(abi.encodePacked(
                "Your trust score requires at least ",
                Strings.toString(requiredPct),
                "% upfront"
            ))
        );
        require(initialDeposit <= gross, "Deposit cannot exceed total");

        uint256 pledgeId = ++pledgeCounter; // IDs start at 1

        pledges[pledgeId] = Pledge({
            id: pledgeId,
            sender: msg.sender,
            merchant: merchant,
            token: token,
            totalAmount: totalAmount,
            initialDeposit: initialDeposit,
            depositedAmount: initialDeposit,
            commitmentDate: commitmentDate,
            appliedFeeBps: feeBps,
            status: PledgeStatus.PENDING,
            paidDuringGrace: false
        });

        senderPledgeIds[msg.sender].push(pledgeId);
        merchantPledgeIds[merchant].push(pledgeId);
        activePledgeCount[msg.sender]++;

        // Interactions last (Checks-Effects-Interactions).
        IERC20(token).safeTransferFrom(msg.sender, address(this), initialDeposit);

        emit PledgeCreated(pledgeId, msg.sender, merchant, token, totalAmount, initialDeposit, commitmentDate, feeBps);

        // If the initial deposit already covers the gross amount, release immediately.
        if (initialDeposit >= gross) {
            _releaseFunds(pledgeId);
        }
    }

    /// @notice Deposit the exact remaining balance toward a pledge (all-or-nothing).
    /// @dev Enforces depositedAmount + amount == gross — partial top-ups are rejected to
    ///      prevent stranded funds (no path where a pledge sits half-funded after grace).
    /// @param pledgeId ID of the pledge to top up
    /// @param amount   Amount of tokens to deposit — must equal the exact remaining balance
    function depositRemaining(uint256 pledgeId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can deposit");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp <= pledge.commitmentDate + GRACE_PERIOD,
            "Grace period has ended"
        );
        require(amount > 0, "Amount must be > 0");

        uint256 gross = _grossWithFee(pledge.totalAmount, pledge.appliedFeeBps);
        require(
            pledge.depositedAmount + amount == gross,
            "Must deposit the exact remaining balance"
        );

        // Effects
        if (block.timestamp > pledge.commitmentDate) {
            pledge.paidDuringGrace = true;
        }
        pledge.depositedAmount += amount;

        // Interactions
        IERC20(pledge.token).safeTransferFrom(msg.sender, address(this), amount);

        emit DepositMade(pledgeId, msg.sender, amount, pledge.depositedAmount);

        // depositedAmount now equals gross — release.
        _releaseFunds(pledgeId);
    }

    /// @notice Merchant claims the full locked deposit after a pledge default.
    /// @dev Claims the entire depositedAmount. Callable only after the grace period and
    ///      within CLAIM_WINDOW. The TIME_BUFFER absorbs validator timestamp drift.
    ///      After the claim window closes, the sender may recover the funds via reclaimDeposit().
    /// @param pledgeId ID of the defaulted pledge
    function claimDefaultedDeposit(uint256 pledgeId) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.merchant, "Only merchant can claim");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp > pledge.commitmentDate + GRACE_PERIOD + TIME_BUFFER,
            "Grace period not over yet"
        );
        require(
            block.timestamp <= pledge.commitmentDate + GRACE_PERIOD + CLAIM_WINDOW,
            "Claim window has expired"
        );

        uint256 claimAmount = pledge.depositedAmount;

        // Effects before interactions.
        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;
        _recordDefault(pledge.sender, pledge.totalAmount);
        _decrementActive(pledge.sender);

        // Interactions
        IERC20(pledge.token).safeTransfer(pledge.merchant, claimAmount);

        emit PledgeDefaulted(pledgeId, pledge.merchant, claimAmount);
    }

    /// @notice Sender reclaims the deposit once the merchant's claim window has closed.
    /// @dev Becomes available immediately after CLAIM_WINDOW expires (plus TIME_BUFFER).
    ///      The default is still recorded against the sender — reclaiming does not escape
    ///      the reputation penalty. Emits PledgeDefaulted (amount 0) and DepositReclaimed
    ///      so off-chain indexers counting defaults stay consistent.
    /// @param pledgeId ID of the unclaimed defaulted pledge
    function reclaimDeposit(uint256 pledgeId) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can reclaim");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp
                > pledge.commitmentDate + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER,
            "Merchant claim window still open"
        );

        uint256 amount = pledge.depositedAmount;

        // Effects
        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;
        _recordDefault(pledge.sender, pledge.totalAmount);
        _decrementActive(pledge.sender);

        // Interactions
        IERC20(pledge.token).safeTransfer(pledge.sender, amount);

        // PledgeDefaulted with amount 0 — the merchant claimed nothing.
        emit PledgeDefaulted(pledgeId, pledge.merchant, 0);
        emit DepositReclaimed(pledgeId, pledge.sender, amount);
    }

    /// @notice Extend a pledge deadline with the merchant's off-chain signature approval.
    /// @dev The signed hash includes chainId, contract address, a per-pledge nonce and an
    ///      expiry — preventing cross-chain replay, cross-contract replay and signature reuse.
    /// @param pledgeId   ID of the pledge to extend
    /// @param newDate    New commitment date (max 30 days past the current deadline)
    /// @param sigExpiry  Timestamp after which the merchant signature is no longer valid
    /// @param merchantSig Merchant's ECDSA signature approving the extension
    function extendDeadline(
        uint256 pledgeId,
        uint256 newDate,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can extend");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(block.timestamp < pledge.commitmentDate, "Cannot extend after deadline");
        require(block.timestamp <= sigExpiry, "Signature expired");
        require(newDate > pledge.commitmentDate, "New date must be later");
        require(
            newDate <= pledge.commitmentDate + MAX_EXTENSION,
            "Max 30-day extension"
        );

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                "extend",
                pledgeId,
                newDate,
                pledge.commitmentDate,
                sigExpiry,
                extensionNonces[pledgeId]
            )
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        require(ECDSA.recover(ethHash, merchantSig) == pledge.merchant, "Invalid merchant signature");

        extensionNonces[pledgeId]++; // consume the nonce — signature cannot be replayed

        uint256 oldDate = pledge.commitmentDate;
        pledge.commitmentDate = newDate;

        emit DeadlineExtended(pledgeId, oldDate, newDate);
    }

    /// @notice Cancel a pledge by mutual agreement — sender calls with merchant's signature.
    /// @param pledgeId    ID of the pledge to cancel
    /// @param sigExpiry   Timestamp after which the merchant signature is no longer valid
    /// @param merchantSig Merchant's ECDSA signature approving the cancellation
    function cancelPledge(
        uint256 pledgeId,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.sender, "Only sender can cancel");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(block.timestamp < pledge.commitmentDate, "Cannot cancel after deadline");
        require(block.timestamp <= sigExpiry, "Signature expired");

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                "cancel",
                pledgeId,
                sigExpiry,
                cancelNonces[pledgeId]
            )
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        require(ECDSA.recover(ethHash, merchantSig) == pledge.merchant, "Invalid merchant signature");

        cancelNonces[pledgeId]++; // consume the nonce

        uint256 refund = pledge.depositedAmount;

        // Effects — a cancelled pledge is NOT a default and does NOT touch reputation counts.
        pledge.status = PledgeStatus.CANCELLED;
        pledge.depositedAmount = 0;
        _decrementActive(pledge.sender);

        // Interactions
        IERC20(pledge.token).safeTransfer(pledge.sender, refund);

        emit PledgeCancelled(pledgeId, pledge.sender, pledge.merchant, refund);
    }

    // ── Recurring Pledge Functions ─────────────────────────────────────────────

    /// @notice Create a recurring pledge — a fixed monthly commitment to a merchant.
    /// @param token           Whitelisted ERC20 token
    /// @param merchant        Address of the merchant receiving payments
    /// @param amountPerPeriod Net token amount the merchant receives each installment
    /// @param intervalSeconds Time between installments — minimum 7 days
    /// @param totalPeriods    Number of installments — maximum 12
    /// @param firstDueDate    Due date of the first installment
    function createRecurringPledge(
        address token,
        address merchant,
        uint256 amountPerPeriod,
        uint256 intervalSeconds,
        uint256 totalPeriods,
        uint256 firstDueDate
    ) external nonReentrant whenNotPaused {
        require(allowedTokens[token], "Token not supported");
        require(merchant != address(0), "Invalid merchant address");
        require(merchant != msg.sender, "Sender cannot be merchant");
        require(amountPerPeriod >= MIN_PLEDGE_AMOUNT, "Amount below minimum");
        require(intervalSeconds >= MIN_RECURRING_INTERVAL, "Interval too short");
        require(totalPeriods >= 1 && totalPeriods <= MAX_RECURRING_PERIODS, "Invalid period count");
        require(firstDueDate > block.timestamp, "First due date must be in future");

        uint256 maxActive = getMaxActivePledges(msg.sender);
        require(
            activePledgeCount[msg.sender] < maxActive,
            "Active pledge limit reached for your trust tier"
        );

        uint256 feeBps = getServiceFeeBps(msg.sender);
        uint256 recurringId = ++recurringCounter;

        recurringPledges[recurringId] = RecurringPledge({
            id: recurringId,
            sender: msg.sender,
            merchant: merchant,
            token: token,
            amountPerPeriod: amountPerPeriod,
            intervalSeconds: intervalSeconds,
            totalPeriods: totalPeriods,
            periodsCompleted: 0,
            missedCount: 0,
            totalMissedDebt: 0,
            nextDueDate: firstDueDate,
            appliedFeeBps: feeBps,
            status: RecurringStatus.ACTIVE
        });

        senderRecurringIds[msg.sender].push(recurringId);
        merchantRecurringIds[merchant].push(recurringId);
        activePledgeCount[msg.sender]++;

        emit RecurringPledgeCreated(
            recurringId, msg.sender, merchant, token,
            amountPerPeriod, intervalSeconds, totalPeriods, firstDueDate, feeBps
        );
    }

    /// @notice Pay the current installment for a recurring pledge.
    /// @dev Sender may pay early (before nextDueDate). Payment is released to merchant
    ///      immediately. If paid after the due date but within grace, marked late.
    /// @param recurringId ID of the recurring pledge
    function payInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.sender, "Only sender can pay");
        require(rp.status == RecurringStatus.ACTIVE, "Pledge not active");
        require(
            rp.periodsCompleted + rp.missedCount < rp.totalPeriods,
            "All periods accounted for"
        );
        require(
            block.timestamp <= rp.nextDueDate + GRACE_PERIOD,
            "Grace period has ended - use markMissedInstallment"
        );

        bool isLate = block.timestamp > rp.nextDueDate;
        uint256 gross = _grossWithFee(rp.amountPerPeriod, rp.appliedFeeBps);
        uint256 currentPeriod = rp.periodsCompleted + rp.missedCount + 1;

        // Effects
        rp.periodsCompleted++;
        rp.nextDueDate += rp.intervalSeconds;

        // Reputation — each installment contributes half the amount weight.
        // The other half is granted as a completion bonus when all periods settle.
        Reputation storage rep = reputations[rp.sender];
        // slither-disable-next-line divide-before-multiply
        uint256 halfAmount = rp.amountPerPeriod / 2; // intentional 50% partial weight — max 1 wei rounding loss
        if (isLate) {
            rep.lateCount++;
            rep.weightedScore += halfAmount * WEIGHT_LATE;
        } else {
            rep.onTimeCount++;
            rep.weightedScore += halfAmount * WEIGHT_ON_TIME;
        }
        rep.totalWeight += halfAmount;

        uint256 fee = (rp.amountPerPeriod * rp.appliedFeeBps) / 10000;

        // Interactions
        IERC20(rp.token).safeTransferFrom(msg.sender, address(this), gross);
        if (fee > 0) {
            IERC20(rp.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(recurringId, feeRecipient, fee);
        }
        IERC20(rp.token).safeTransfer(rp.merchant, rp.amountPerPeriod);

        emit InstallmentPaid(recurringId, msg.sender, currentPeriod, rp.amountPerPeriod);

        // Check if all periods are now accounted for (no missed debt outstanding)
        if (rp.periodsCompleted + rp.missedCount == rp.totalPeriods) {
            _finalizeRecurring(recurringId);
        }
    }

    /// @notice Merchant flags a missed installment after the grace period ends.
    /// @dev Records the debt. No funds are transferred — merchant is compensated at settlement.
    ///      Schedule advances to the next period automatically.
    /// @param recurringId ID of the recurring pledge
    function markMissedInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.merchant, "Only merchant can mark missed");
        require(rp.status == RecurringStatus.ACTIVE, "Pledge not active");
        require(
            rp.periodsCompleted + rp.missedCount < rp.totalPeriods,
            "All periods accounted for"
        );
        require(
            block.timestamp > rp.nextDueDate + GRACE_PERIOD + TIME_BUFFER,
            "Grace period not over yet"
        );

        uint256 currentPeriod = rp.periodsCompleted + rp.missedCount + 1;

        // Effects
        rp.missedCount++;
        rp.totalMissedDebt += rp.amountPerPeriod;
        rp.nextDueDate += rp.intervalSeconds;

        // Reputation — default recorded at half amount (mirrors partial weight logic)
        _recordDefault(rp.sender, rp.amountPerPeriod / 2);

        emit InstallmentMissed(recurringId, currentPeriod, rp.amountPerPeriod);

        // If all periods are accounted for, move to settlement
        if (rp.periodsCompleted + rp.missedCount == rp.totalPeriods) {
            _finalizeRecurring(recurringId);
        }
    }

    /// @notice Sender pays all outstanding missed installment debts to complete the contract.
    /// @dev Only callable when status is PENDING_SETTLEMENT. Releases the full debt
    ///      amount to the merchant and marks the contract COMPLETED.
    /// @param recurringId ID of the recurring pledge
    function settleDebt(uint256 recurringId) external nonReentrant whenNotPaused {
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.sender, "Only sender can settle");
        require(rp.status == RecurringStatus.PENDING_SETTLEMENT, "No debt to settle");

        uint256 debt = rp.totalMissedDebt;
        require(debt > 0, "No outstanding debt");

        uint256 grossDebt = _grossWithFee(debt, rp.appliedFeeBps);
        uint256 fee = (debt * rp.appliedFeeBps) / 10000;

        // Effects
        rp.totalMissedDebt = 0;
        rp.status = RecurringStatus.COMPLETED;
        _decrementActive(rp.sender);

        // Completion bonus — apply remaining 50% reputation weight
        _applyCompletionBonus(rp.sender, rp.amountPerPeriod, rp.totalPeriods);

        // Interactions
        IERC20(rp.token).safeTransferFrom(msg.sender, address(this), grossDebt);
        if (fee > 0) {
            IERC20(rp.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(recurringId, feeRecipient, fee);
        }
        IERC20(rp.token).safeTransfer(rp.merchant, debt);

        emit DebtSettled(recurringId, msg.sender, debt);
        emit RecurringPledgeCompleted(recurringId, rp.merchant);
    }

    /// @notice Cancel a recurring pledge by mutual agreement — sender calls with merchant's signature.
    /// @dev Missed debts are forgiven on cancellation. Current period is not refundable
    ///      since no deposit is held. Reputation is unaffected by the cancellation itself.
    /// @param recurringId ID of the recurring pledge
    /// @param sigExpiry   Timestamp after which the merchant signature is no longer valid
    /// @param merchantSig Merchant's ECDSA signature approving the cancellation
    function cancelRecurring(
        uint256 recurringId,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.sender, "Only sender can cancel");
        require(
            rp.status == RecurringStatus.ACTIVE || rp.status == RecurringStatus.PENDING_SETTLEMENT,
            "Pledge not cancellable"
        );
        require(block.timestamp <= sigExpiry, "Signature expired");

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                "cancelRecurring",
                recurringId,
                sigExpiry,
                recurringCancelNonces[recurringId]
            )
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        require(ECDSA.recover(ethHash, merchantSig) == rp.merchant, "Invalid merchant signature");

        recurringCancelNonces[recurringId]++;

        // Effects — debts forgiven, both parties walk away clean
        rp.status = RecurringStatus.CANCELLED;
        rp.totalMissedDebt = 0;
        _decrementActive(rp.sender);

        emit RecurringPledgeCancelled(recurringId, rp.sender, rp.merchant);
    }

    /// @dev Called when all periods (paid + missed) are accounted for.
    ///      If no debt, complete immediately with full bonus. Otherwise enter settlement.
    function _finalizeRecurring(uint256 recurringId) internal {
        RecurringPledge storage rp = recurringPledges[recurringId];

        if (rp.totalMissedDebt == 0) {
            rp.status = RecurringStatus.COMPLETED;
            _decrementActive(rp.sender);
            _applyCompletionBonus(rp.sender, rp.amountPerPeriod, rp.totalPeriods);
            emit RecurringPledgeCompleted(recurringId, rp.merchant);
        } else {
            rp.status = RecurringStatus.PENDING_SETTLEMENT;
        }
    }

    /// @dev Applies the 50% completion bonus to the sender's reputation when a recurring
    ///      pledge is fully completed. Uses WEIGHT_ON_TIME so finishing the commitment
    ///      always scores positively regardless of any late/missed installments.
    function _applyCompletionBonus(address sender, uint256 amountPerPeriod, uint256 totalPeriods) internal {
        Reputation storage rep = reputations[sender];
        // slither-disable-next-line divide-before-multiply
        uint256 bonusAmount = (amountPerPeriod * totalPeriods) / 2; // intentional 50% completion bonus weight
        rep.weightedScore += bonusAmount * WEIGHT_ON_TIME;
        rep.totalWeight += bonusAmount;
        rep.totalCount++;
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /// @dev Finalizes a fully-funded pledge: pays the fee and the merchant, updates reputation.
    function _releaseFunds(uint256 pledgeId) internal {
        Pledge storage pledge = pledges[pledgeId];
        uint256 amount = pledge.totalAmount;

        // Effects
        pledge.status = PledgeStatus.COMPLETED;
        pledge.depositedAmount = 0;

        Reputation storage rep = reputations[pledge.sender];
        if (pledge.paidDuringGrace) {
            rep.lateCount++;
            rep.weightedScore += amount * WEIGHT_LATE;
        } else {
            rep.onTimeCount++;
            rep.weightedScore += amount * WEIGHT_ON_TIME;
        }
        rep.totalWeight += amount;
        rep.totalCount++; // counted at resolution, not creation
        _decrementActive(pledge.sender);

        uint256 fee = (amount * pledge.appliedFeeBps) / 10000;

        // Interactions last.
        if (fee > 0) {
            IERC20(pledge.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(pledgeId, feeRecipient, fee);
        }
        IERC20(pledge.token).safeTransfer(pledge.merchant, amount);

        emit PledgeCompleted(pledgeId, pledge.merchant, amount);
    }

    /// @dev Records a default against the sender's reputation.
    function _recordDefault(address sender, uint256 amount) internal {
        Reputation storage rep = reputations[sender];
        rep.defaultCount++;
        rep.totalWeight += amount; // weightedScore unchanged — defaults score 0
        rep.totalCount++;          // counted at resolution
    }

    /// @dev Safe decrement — underflow on activePledgeCount would permanently brick a user.
    function _decrementActive(address user) internal {
        if (activePledgeCount[user] > 0) {
            activePledgeCount[user]--;
        }
    }

    // ── Admin Functions ────────────────────────────────────────────────────────

    /// @notice Add or remove a token from the whitelist.
    /// @dev Only whitelisted tokens can be used in new pledges. Removing a token does not
    ///      affect existing pledges — they keep their locked-in token until resolved.
    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        require(token != address(0), "Invalid token address");
        allowedTokens[token] = allowed;
        emit TokenAllowanceSet(token, allowed);
    }

    /// @notice Emergency stop — halts all state-changing user functions.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume operations after an emergency.
    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Update the protocol fee recipient.
    function setFeeRecipient(address newRecipient) external onlyOwner {
        require(newRecipient != address(0), "Invalid fee recipient");
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    /// @notice Service fee rate (basis points) that applies to a sender right now.
    /// @dev REWARD-ONLY: high-trust senders (80%+ score) earn the loyalty rate; everyone
    ///      else pays the standard rate. No sender ever pays above the standard rate.
    ///      The rate is locked into each pledge at creation time (Pledge.appliedFeeBps).
    /// @return bps Fee in basis points — 75 (0.75%) for loyalty, 100 (1%) standard
    function getServiceFeeBps(address sender) public view returns (uint256 bps) {
        if (_trustScore(sender) >= TIER_HIGH) {
            return FEE_BPS_LOYALTY;
        }
        return FEE_BPS_STANDARD;
    }

    /// @dev Gross amount (net + fee) for a given fee rate.
    function _grossWithFee(uint256 totalAmount, uint256 feeBps)
        internal
        pure
        returns (uint256)
    {
        return totalAmount + (totalAmount * feeBps) / 10000;
    }

    /// @notice Gross amount a given sender would deposit for a pledge of `totalAmount`,
    ///         using their current trust-tier fee rate. For frontends/quotes.
    ///         Token does not affect the fee calculation — only the sender's trust score does.
    function quoteGrossAmount(address sender, uint256 totalAmount)
        external
        view
        returns (uint256)
    {
        return _grossWithFee(totalAmount, getServiceFeeBps(sender));
    }

    /// @notice Gross amount for an existing pledge, using its locked-in fee rate.
    function grossAmountForPledge(uint256 pledgeId) external view returns (uint256) {
        Pledge storage pledge = pledges[pledgeId];
        require(pledge.id != 0, "Pledge does not exist");
        return _grossWithFee(pledge.totalAmount, pledge.appliedFeeBps);
    }

    /// @dev Single source of truth for the trust score (basis points, 0–10000).
    function _trustScore(address wallet) internal view returns (uint256) {
        Reputation storage rep = reputations[wallet];
        if (rep.totalWeight == 0) return 0;
        return rep.weightedScore / rep.totalWeight;
    }

    /// @notice Trust score for a wallet, 0–10000 (divide by 100 for a percentage).
    function getTrustScore(address wallet) external view returns (uint256) {
        return _trustScore(wallet);
    }

    /// @notice Full reputation breakdown for a wallet.
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
        return (
            _trustScore(wallet),
            rep.onTimeCount,
            rep.lateCount,
            rep.defaultCount,
            rep.totalCount
        );
    }

    /// @notice Full pledge details.
    function getPledge(uint256 pledgeId) external view returns (Pledge memory) {
        require(pledges[pledgeId].id != 0, "Pledge does not exist");
        return pledges[pledgeId];
    }

    /// @notice Full recurring pledge details.
    function getRecurringPledge(uint256 recurringId) external view returns (RecurringPledge memory) {
        require(recurringPledges[recurringId].id != 0, "Recurring pledge does not exist");
        return recurringPledges[recurringId];
    }

    /// @notice All recurring pledge IDs created by a sender.
    function getSenderRecurringPledges(address sender) external view returns (uint256[] memory) {
        return senderRecurringIds[sender];
    }

    /// @notice All recurring pledge IDs for a merchant.
    function getMerchantRecurringPledges(address merchant) external view returns (uint256[] memory) {
        return merchantRecurringIds[merchant];
    }

    /// @notice Paginated view of a sender's recurring pledge IDs.
    function getSenderRecurringPledgesPaginated(address sender, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(senderRecurringIds[sender], offset, limit);
    }

    /// @notice Paginated view of a merchant's recurring pledge IDs.
    function getMerchantRecurringPledgesPaginated(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(merchantRecurringIds[merchant], offset, limit);
    }

    /// @notice All pledge IDs created by a sender (may be large — prefer the paginated getter).
    function getSenderPledges(address sender) external view returns (uint256[] memory) {
        return senderPledgeIds[sender];
    }

    /// @notice All pledge IDs for a merchant (may be large — prefer the paginated getter).
    function getMerchantPledges(address merchant) external view returns (uint256[] memory) {
        return merchantPledgeIds[merchant];
    }

    /// @notice Paginated view of a sender's pledge IDs — safe for high-volume users.
    function getSenderPledgesPaginated(address sender, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(senderPledgeIds[sender], offset, limit);
    }

    /// @notice Paginated view of a merchant's pledge IDs — safe for high-volume users.
    function getMerchantPledgesPaginated(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(merchantPledgeIds[merchant], offset, limit);
    }

    /// @dev Shared pagination helper.
    function _paginate(uint256[] storage ids, uint256 offset, uint256 limit)
        internal
        view
        returns (uint256[] memory page, uint256 total)
    {
        total = ids.length;
        if (offset >= total) {
            return (new uint256[](0), total);
        }
        uint256 end = offset + limit;
        if (end > total) {
            end = total;
        }
        page = new uint256[](end - offset);
        for (uint256 i = offset; i < end; i++) {
            page[i - offset] = ids[i];
        }
    }

    /// @notice Max concurrent active pledges allowed for a sender.
    /// @dev Serial defaulters (defaultCount >= DEFAULT_LOCKOUT_THRESHOLD) are capped at the
    ///      no-history limit regardless of any on-time history they may also have.
    function getMaxActivePledges(address sender) public view returns (uint256) {
        Reputation storage rep = reputations[sender];

        if (rep.defaultCount >= DEFAULT_LOCKOUT_THRESHOLD) {
            return MAX_ACTIVE_NO_HISTORY;
        }
        if (rep.totalWeight == 0) {
            return MAX_ACTIVE_NO_HISTORY;
        }

        uint256 score = _trustScore(sender);
        if (score >= TIER_HIGH) return MAX_ACTIVE_HIGH;
        if (score >= TIER_MID)  return MAX_ACTIVE_MID;
        return MAX_ACTIVE_NO_HISTORY;
    }

    /// @notice Required upfront deposit percentage for a sender, based on their trust score.
    /// @dev DESIGN NOTE: a brand-new wallet (no resolved history) receives the 20% tier — the
    ///      same as a proven high-trust sender. This is deliberate: GitRemit assumes wallets
    ///      are created through off-chain identity verification (face-recognition registration),
    ///      so a "new" wallet is a verified new human, not an anonymous one. The
    ///      MAX_ACTIVE_NO_HISTORY = 2 cap further limits exposure. If off-chain identity
    ///      verification is ever removed, raise the no-history tier to DEPOSIT_TIER_MID (30%).
    function getRequiredDepositPct(address sender) public view returns (uint256) {
        Reputation storage rep = reputations[sender];

        // No resolved history yet — 20% (see DESIGN NOTE above).
        if (rep.totalWeight == 0) return DEPOSIT_TIER_HIGH;

        uint256 score = _trustScore(sender);
        if (score >= TIER_HIGH) return DEPOSIT_TIER_HIGH; // 80%+ → 20%
        if (score >= TIER_MID)  return DEPOSIT_TIER_MID;  // 50%+ → 30%
        if (score >= TIER_LOW)  return DEPOSIT_TIER_LOW;  // 20%+ → 40%
        return DEPOSIT_TIER_RISK;                          // < 20% → 50%
    }
}

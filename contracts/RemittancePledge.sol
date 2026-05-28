// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

/// @title RemittancePledge — OFW Payment Pledge System on Morph L2
/// @notice Cross-border remittance system where merchants create payment requests (pledges)
///         targeting a specific payer (OFW). The payer fulfills the pledge by depositing funds
///         by the commitment deadline. Anyone can send instant P2P transfers to any address.
///         Supports any whitelisted ERC20 (USDC, USDT, etc.) with 6 decimals.
///         Reputation is tracked per payer — their payment history determines deposit
///         requirements and active pledge limits. Pledge IDs start at 1.
/// @dev Assumes standard, non-rebasing, non-fee-on-transfer ERC20 tokens only.
contract RemittancePledge is ReentrancyGuard, Pausable, Ownable2Step {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant GRACE_PERIOD    = 3 days;
    uint256 public constant MAX_PLEDGE_DAYS = 90 days;
    uint256 public constant MAX_EXTENSION   = 30 days;

    /// @dev Merchant must claim a defaulted deposit within this window after the grace period.
    uint256 public constant CLAIM_WINDOW = 45 days;
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

    // Max concurrent active pledges a payer can have per trust tier
    uint256 public constant MAX_ACTIVE_NO_HISTORY = 2;
    uint256 public constant MAX_ACTIVE_MID        = 3;
    uint256 public constant MAX_ACTIVE_HIGH       = 5;

    /// @dev Serial defaulters are capped here regardless of any on-time history.
    uint256 public constant DEFAULT_LOCKOUT_THRESHOLD = 3;

    // Protocol fee tiers (basis points, out of 10000) — REWARD-ONLY model.
    // Everyone pays the standard rate; high-trust payers earn a loyalty discount.
    uint256 public constant FEE_BPS_STANDARD = 100; // 1%    — new and mid-trust payers
    uint256 public constant FEE_BPS_LOYALTY  = 75;  // 0.75% — high-trust payers (80%+ score)

    /// @dev 1 unit (6 decimals) — prevents dust-pledge reputation washing.
    uint256 public constant MIN_PLEDGE_AMOUNT = 1_000_000;

    // Recurring pledge constraints
    uint256 public constant MIN_RECURRING_INTERVAL = 7 days;
    uint256 public constant MAX_RECURRING_PERIODS  = 12;

    // Reputation weight for each completed recurring installment (50% of full weight).
    // The remaining 50% is granted as a completion bonus when all periods are settled.
    uint256 public constant WEIGHT_INSTALLMENT_PARTIAL = 5000;
    uint256 public constant WEIGHT_INSTALLMENT_BONUS   = 5000;

    // ── Verification / KYC tiers ───────────────────────────────────────────────
    /// @dev Minimum baseline trust score required to initiate new transactions.
    ///      Below this, the payer cannot deposit, pay installments, send P2P, etc.
    ///      Set to match BASELINE_KYC — KYC approval is the gate.
    uint256 public constant MIN_TRANSACT_BASELINE = 5000;
    /// @dev Awarded baseline when admin approves KYC.
    uint256 public constant BASELINE_KYC = 5000;
    /// @dev Awarded baseline when KYC is approved AND avatar is uploaded.
    uint256 public constant BASELINE_KYC_PLUS_AVATAR = 6000;
    /// @dev Maximum admin-settable baseline. Behavioral score can still exceed this.
    uint256 public constant MAX_BASELINE = 6000;

    // ── Types ──────────────────────────────────────────────────────────────────
    enum PledgeStatus { PENDING, COMPLETED, DEFAULTED, CANCELLED }

    enum RecurringStatus { ACTIVE, PENDING_SETTLEMENT, COMPLETED, CANCELLED }

    struct Pledge {
        uint256 id;
        address merchant;        // created the pledge (the payment requester)
        address payer;           // responsible for fulfilling the pledge (the OFW)
        address token;           // whitelisted ERC20 used for this pledge
        uint256 totalAmount;     // net amount the merchant ultimately receives
        uint256 depositedAmount; // running total deposited by the payer (gross, fee-inclusive)
        uint256 commitmentDate;  // payment deadline
        uint256 appliedFeeBps;   // fee rate locked in at creation based on payer's trust score
        PledgeStatus status;
        bool paidDuringGrace;    // true if completed after the deadline but within grace
    }

    struct RecurringPledge {
        uint256 id;
        address merchant;          // created the recurring pledge
        address payer;             // responsible for paying each installment
        address token;
        uint256 amountPerPeriod;   // net amount merchant receives per installment
        uint256 intervalSeconds;   // time between installments (min 7 days)
        uint256 totalPeriods;      // total number of installments (max 12)
        uint256 periodsCompleted;  // installments fully paid and released
        uint256 missedCount;       // installments flagged as missed by merchant
        uint256 totalMissedDebt;   // total unpaid missed installment amounts
        uint256 nextDueDate;       // due date of the next installment
        uint256 appliedFeeBps;     // fee rate locked at creation based on payer's trust score
        RecurringStatus status;
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

    /// @notice Number of active pledges currently assigned to a payer.
    mapping(address => uint256) public activePledgeCount;

    // Per-pledge nonces — prevent replay of signatures.
    mapping(uint256 => uint256) public extensionNonces;
    mapping(uint256 => uint256) public cancelNonces;

    // NOTE: these arrays grow unboundedly. Use the paginated getters for heavy users.
    mapping(address => uint256[]) private payerPledgeIds;
    mapping(address => uint256[]) private merchantPledgeIds;

    // ── Verification State ─────────────────────────────────────────────────────
    /// @notice Per-OFW baseline trust score set by admin/operator based on KYC.
    ///         Behavioral score (from pledge history) can rise above this.
    mapping(address => uint256) public verificationBaseline;

    /// @notice Per-merchant binary verification flag set by admin.
    mapping(address => bool) public isMerchantVerified;

    /// @notice Backend wallet authorized to update OFW baselines automatically
    ///         (e.g. avatar upload boost). Cannot touch merchant verification.
    address public verificationOperator;

    // ── Recurring Pledge State ─────────────────────────────────────────────────
    uint256 public recurringCounter;
    mapping(uint256 => RecurringPledge) public recurringPledges;
    mapping(uint256 => uint256) public recurringCancelNonces;
    mapping(address => uint256[]) private payerRecurringIds;
    mapping(address => uint256[]) private merchantRecurringIds;

    // ── Events ─────────────────────────────────────────────────────────────────
    event PledgeCreated(
        uint256 indexed pledgeId,
        address indexed merchant,
        address indexed payer,
        address token,
        uint256 totalAmount,
        uint256 commitmentDate,
        uint256 appliedFeeBps
    );
    event DepositMade(uint256 indexed pledgeId, address indexed payer, uint256 amount, uint256 totalDeposited);
    event PledgeCompleted(uint256 indexed pledgeId, address indexed merchant, uint256 amount);
    event PledgeDefaulted(uint256 indexed pledgeId, address indexed merchant, uint256 amount);
    event PledgeCancelled(uint256 indexed pledgeId, address indexed payer, address indexed merchant, uint256 refund);
    event DepositReclaimed(uint256 indexed pledgeId, address indexed payer, uint256 amount);
    event DeadlineExtended(uint256 indexed pledgeId, uint256 oldDate, uint256 newDate);
    event FeeCollected(uint256 indexed pledgeId, address indexed feeRecipient, uint256 fee);
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TokenAllowanceSet(address indexed token, bool allowed);

    // Verification events
    event VerificationBaselineChanged(address indexed ofw, uint256 oldScore, uint256 newScore);
    event MerchantVerificationChanged(address indexed merchant, bool verified);
    event VerificationOperatorChanged(address indexed oldOp, address indexed newOp);

    // P2P instant transfer event
    event P2PSent(
        address indexed sender,
        address indexed recipient,
        address token,
        uint256 amount,
        uint256 fee
    );

    // Recurring pledge events
    event RecurringPledgeCreated(
        uint256 indexed recurringId,
        address indexed merchant,
        address indexed payer,
        address token,
        uint256 amountPerPeriod,
        uint256 intervalSeconds,
        uint256 totalPeriods,
        uint256 firstDueDate,
        uint256 appliedFeeBps
    );
    event InstallmentPaid(uint256 indexed recurringId, address indexed payer, uint256 period, uint256 amount);
    event InstallmentMissed(uint256 indexed recurringId, uint256 period, uint256 debtAdded);
    event DebtSettled(uint256 indexed recurringId, address indexed payer, uint256 amount);
    event RecurringPledgeCompleted(uint256 indexed recurringId, address indexed merchant);
    event RecurringPledgeCancelled(uint256 indexed recurringId, address indexed payer, address indexed merchant);

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

    // ── Merchant Functions ─────────────────────────────────────────────────────

    /// @notice Merchant creates a payment request targeting a specific payer.
    /// @dev No funds are transferred at creation — the payer deposits later via submitDeposit().
    ///      The fee rate is locked in now based on the payer's current trust score so both
    ///      parties know the exact gross amount required before any funds move.
    /// @param token          Whitelisted ERC20 token for this pledge
    /// @param payer          Address of the OFW who will fulfill this payment
    /// @param totalAmount    Net token amount the merchant will receive (6 decimals)
    /// @param commitmentDate Unix timestamp of the payment deadline (max 90 days out)
    function createPledge(
        address token,
        address payer,
        uint256 totalAmount,
        uint256 commitmentDate
    ) external whenNotPaused {
        require(isMerchantVerified[msg.sender], "Merchant not verified");
        require(payer != address(0), "Invalid payer address");
        require(payer != msg.sender, "Merchant cannot be the payer");
        require(
            verificationBaseline[payer] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        require(allowedTokens[token], "Token not supported");
        require(totalAmount >= MIN_PLEDGE_AMOUNT, "Amount below minimum");
        require(commitmentDate > block.timestamp, "Commitment date must be in future");
        require(
            commitmentDate <= block.timestamp + MAX_PLEDGE_DAYS,
            "Max 90 days commitment"
        );

        // Fee rate is locked at creation based on the payer's current trust score.
        uint256 feeBps = getServiceFeeBps(payer);
        uint256 pledgeId = ++pledgeCounter;

        pledges[pledgeId] = Pledge({
            id: pledgeId,
            merchant: msg.sender,
            payer: payer,
            token: token,
            totalAmount: totalAmount,
            depositedAmount: 0,
            commitmentDate: commitmentDate,
            appliedFeeBps: feeBps,
            status: PledgeStatus.PENDING,
            paidDuringGrace: false
        });

        payerPledgeIds[payer].push(pledgeId);
        merchantPledgeIds[msg.sender].push(pledgeId);

        emit PledgeCreated(pledgeId, msg.sender, payer, token, totalAmount, commitmentDate, feeBps);
    }

    /// @notice Merchant creates a recurring payment request targeting a specific payer.
    /// @dev No active slot is consumed at creation — the payer hasn't consented yet.
    ///      The slot is taken on the payer's first installment payment, mirroring one-shot pledges.
    /// @param token           Whitelisted ERC20 token
    /// @param payer           Address of the OFW who will pay each installment
    /// @param amountPerPeriod Net token amount the merchant receives each installment
    /// @param intervalSeconds Time between installments — minimum 7 days
    /// @param totalPeriods    Number of installments — maximum 12
    /// @param firstDueDate    Due date of the first installment
    function createRecurringPledge(
        address token,
        address payer,
        uint256 amountPerPeriod,
        uint256 intervalSeconds,
        uint256 totalPeriods,
        uint256 firstDueDate
    ) external whenNotPaused {
        require(isMerchantVerified[msg.sender], "Merchant not verified");
        require(payer != address(0), "Invalid payer address");
        require(payer != msg.sender, "Merchant cannot be the payer");
        require(
            verificationBaseline[payer] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        require(allowedTokens[token], "Token not supported");
        require(amountPerPeriod >= MIN_PLEDGE_AMOUNT, "Amount below minimum");
        require(intervalSeconds >= MIN_RECURRING_INTERVAL, "Interval too short");
        require(totalPeriods >= 1 && totalPeriods <= MAX_RECURRING_PERIODS, "Invalid period count");
        require(firstDueDate > block.timestamp, "First due date must be in future");

        uint256 feeBps = getServiceFeeBps(payer);
        uint256 recurringId = ++recurringCounter;

        recurringPledges[recurringId] = RecurringPledge({
            id: recurringId,
            merchant: msg.sender,
            payer: payer,
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

        payerRecurringIds[payer].push(recurringId);
        merchantRecurringIds[msg.sender].push(recurringId);

        emit RecurringPledgeCreated(
            recurringId, msg.sender, payer, token,
            amountPerPeriod, intervalSeconds, totalPeriods, firstDueDate, feeBps
        );
    }

    /// @notice Merchant claims the full locked deposit after a pledge default.
    /// @dev Callable only after the grace period and within CLAIM_WINDOW.
    /// @param pledgeId ID of the defaulted pledge
    function claimDefaultedDeposit(uint256 pledgeId) external nonReentrant whenNotPaused {
        require(isMerchantVerified[msg.sender], "Merchant not verified");
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.merchant, "Only merchant can claim");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(pledge.depositedAmount > 0, "Nothing deposited to claim");
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
        _recordDefault(pledge.payer, pledge.totalAmount);
        _decrementActive(pledge.payer);

        // Interactions
        IERC20(pledge.token).safeTransfer(pledge.merchant, claimAmount);

        emit PledgeDefaulted(pledgeId, pledge.merchant, claimAmount);
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

        // Reputation — drag the trust score only if the payer has engaged with
        // this contract (at least one installment paid). An unengaged contract is
        // a non-event for the payer's reputation; the merchant can't unilaterally
        // damage someone's score by creating a recurring they never accepted.
        // defaultCount is bumped once per failed contract in _finalizeRecurring.
        if (rp.periodsCompleted > 0) {
            // slither-disable-next-line divide-before-multiply
            reputations[rp.payer].totalWeight += rp.amountPerPeriod / 2;
        }

        emit InstallmentMissed(recurringId, currentPeriod, rp.amountPerPeriod);

        if (rp.periodsCompleted + rp.missedCount == rp.totalPeriods) {
            _finalizeRecurring(recurringId);
        }
    }

    // ── Payer Functions ────────────────────────────────────────────────────────

    /// @notice Payer deposits funds toward a pledge created by a merchant.
    /// @dev First call: must meet the minimum deposit percentage based on payer's trust score.
    ///      Subsequent call: must be the exact remaining balance (all-or-nothing top-up).
    ///      Active pledge count is incremented on the first deposit — this is when the payer
    ///      accepts the obligation. If the payer is at their limit, full payment bypasses it
    ///      since the pledge is released immediately and never sits as an ongoing obligation.
    /// @param pledgeId ID of the pledge to deposit toward
    /// @param amount   Amount of tokens to deposit
    function submitDeposit(uint256 pledgeId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        require(
            verificationBaseline[msg.sender] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.payer, "Only the assigned payer can deposit");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(
            block.timestamp <= pledge.commitmentDate + GRACE_PERIOD,
            "Grace period has ended"
        );
        require(amount > 0, "Amount must be > 0");

        uint256 gross = _grossWithFee(pledge.totalAmount, pledge.appliedFeeBps);

        if (pledge.depositedAmount == 0) {
            // First deposit — check active pledge limit and minimum deposit requirement.
            bool isFullPayment = amount >= gross;
            uint256 maxActive = getMaxActivePledges(pledge.payer);
            require(
                activePledgeCount[pledge.payer] < maxActive || isFullPayment,
                "Active pledge limit reached - full payment required to proceed"
            );

            uint256 requiredPct = getRequiredDepositPct(pledge.payer);
            require(
                amount >= (gross * requiredPct) / 100,
                string(abi.encodePacked(
                    "Your trust score requires at least ",
                    Strings.toString(requiredPct),
                    "% upfront"
                ))
            );
            require(amount <= gross, "Deposit cannot exceed total");

            activePledgeCount[pledge.payer]++;
        } else {
            // Subsequent deposit — must be the exact remaining balance.
            require(
                pledge.depositedAmount + amount == gross,
                "Must deposit the exact remaining balance"
            );
        }

        // Effects
        if (block.timestamp > pledge.commitmentDate) {
            pledge.paidDuringGrace = true;
        }
        pledge.depositedAmount += amount;

        // Interactions
        IERC20(pledge.token).safeTransferFrom(msg.sender, address(this), amount);

        emit DepositMade(pledgeId, msg.sender, amount, pledge.depositedAmount);

        if (pledge.depositedAmount >= gross) {
            _releaseFunds(pledgeId);
        }
    }

    /// @notice Payer reclaims the deposit once the merchant's claim window has closed.
    /// @dev The default is still recorded — reclaiming does not escape the reputation penalty.
    /// @param pledgeId ID of the unclaimed defaulted pledge
    function reclaimDeposit(uint256 pledgeId) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.payer, "Only the payer can reclaim");
        require(pledge.status == PledgeStatus.PENDING, "Pledge not pending");
        require(pledge.depositedAmount > 0, "Nothing to reclaim");
        require(
            block.timestamp
                > pledge.commitmentDate + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER,
            "Merchant claim window still open"
        );

        uint256 amount = pledge.depositedAmount;

        // Effects
        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;
        _recordDefault(pledge.payer, pledge.totalAmount);
        _decrementActive(pledge.payer);

        // Interactions
        IERC20(pledge.token).safeTransfer(pledge.payer, amount);

        emit DepositReclaimed(pledgeId, pledge.payer, amount);
    }

    /// @notice Payer requests a deadline extension — requires merchant's off-chain signature.
    /// @param pledgeId    ID of the pledge to extend
    /// @param newDate     New commitment date (max 30 days past the current deadline)
    /// @param sigExpiry   Timestamp after which the merchant signature is no longer valid
    /// @param merchantSig Merchant's ECDSA signature approving the extension
    function extendDeadline(
        uint256 pledgeId,
        uint256 newDate,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        require(
            verificationBaseline[msg.sender] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        Pledge storage pledge = pledges[pledgeId];

        require(pledge.id != 0, "Pledge does not exist");
        require(msg.sender == pledge.payer, "Only the payer can request an extension");
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

        extensionNonces[pledgeId]++;

        uint256 oldDate = pledge.commitmentDate;
        pledge.commitmentDate = newDate;

        emit DeadlineExtended(pledgeId, oldDate, newDate);
    }

    /// @notice Payer cancels a pledge — requires merchant's off-chain signature approval.
    /// @dev Deposited funds are fully refunded. Cancellation does not affect reputation.
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
        require(msg.sender == pledge.payer, "Only the payer can cancel");
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

        cancelNonces[pledgeId]++;

        uint256 refund = pledge.depositedAmount;

        // Effects — cancellation does NOT touch reputation.
        pledge.status = PledgeStatus.CANCELLED;
        pledge.depositedAmount = 0;
        if (refund > 0) {
            // Only decrement active count if payer had made a deposit (accepted the obligation).
            _decrementActive(pledge.payer);
        }

        // Interactions
        if (refund > 0) {
            IERC20(pledge.token).safeTransfer(pledge.payer, refund);
        }

        emit PledgeCancelled(pledgeId, pledge.payer, pledge.merchant, refund);
    }

    /// @notice Payer pays the current installment for a recurring pledge.
    /// @dev Payer may pay early (before nextDueDate). Payment is released to merchant
    ///      immediately. If paid after the due date but within grace, marked late.
    /// @param recurringId ID of the recurring pledge
    function payInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        require(
            verificationBaseline[msg.sender] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.payer, "Only the payer can pay installments");
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

        // First installment — payer is accepting the obligation now.
        // Take an active slot, subject to the payer's tier limit.
        if (rp.periodsCompleted == 0 && rp.missedCount == 0) {
            uint256 maxActive = getMaxActivePledges(rp.payer);
            require(
                activePledgeCount[rp.payer] < maxActive,
                "Payer has reached their active pledge limit"
            );
            activePledgeCount[rp.payer]++;
        }

        // Effects
        rp.periodsCompleted++;
        rp.nextDueDate += rp.intervalSeconds;

        // Reputation — each installment contributes half the amount weight.
        // The other half is granted as a completion bonus when all periods settle.
        Reputation storage rep = reputations[rp.payer];
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

        if (rp.periodsCompleted + rp.missedCount == rp.totalPeriods) {
            _finalizeRecurring(recurringId);
        }
    }

    /// @notice Payer catches up on one missed installment mid-contract.
    /// @dev Reduces missedCount by 1, transfers amountPerPeriod (plus fee) to merchant.
    ///      Counts as a late payment for reputation purposes.
    ///      For paying ALL outstanding debt at the end of the contract, use settleDebt instead.
    /// @param recurringId ID of the recurring pledge
    function payMissedInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        require(
            verificationBaseline[msg.sender] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.payer, "Only the payer can pay missed installments");
        require(rp.status == RecurringStatus.ACTIVE, "Pledge not active");
        require(rp.missedCount > 0, "No missed installments to pay");

        uint256 gross = _grossWithFee(rp.amountPerPeriod, rp.appliedFeeBps);
        uint256 fee = (rp.amountPerPeriod * rp.appliedFeeBps) / 10000;
        // slither-disable-next-line divide-before-multiply
        uint256 halfAmount = rp.amountPerPeriod / 2;

        // First engagement via a make-up payment — take an active slot.
        // Mirrors the slot logic in payInstallment for the regular first-payment path.
        bool firstEngagement = (rp.periodsCompleted == 0);
        if (firstEngagement) {
            uint256 maxActive = getMaxActivePledges(rp.payer);
            require(
                activePledgeCount[rp.payer] < maxActive,
                "Payer has reached their active pledge limit"
            );
            activePledgeCount[rp.payer]++;
        }

        // Effects — move one period from missed to completed
        rp.missedCount--;
        rp.totalMissedDebt -= rp.amountPerPeriod;
        rp.periodsCompleted++;

        // Reputation — make-up payment counts as a LATE installment.
        // If this is the first engagement, the miss was unengaged so totalWeight
        // wasn't bumped earlier — add it here. If engaged, weight was already counted.
        Reputation storage rep = reputations[rp.payer];
        rep.lateCount++;
        rep.weightedScore += halfAmount * WEIGHT_LATE;
        if (firstEngagement) {
            rep.totalWeight += halfAmount;
        }

        // Interactions
        IERC20(rp.token).safeTransferFrom(msg.sender, address(this), gross);
        if (fee > 0) {
            IERC20(rp.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(recurringId, feeRecipient, fee);
        }
        IERC20(rp.token).safeTransfer(rp.merchant, rp.amountPerPeriod);

        emit InstallmentPaid(recurringId, msg.sender, rp.periodsCompleted, rp.amountPerPeriod);
    }

    /// @notice Payer pays all outstanding missed installment debts to complete the contract.
    /// @dev Only callable when status is PENDING_SETTLEMENT.
    /// @param recurringId ID of the recurring pledge
    function settleDebt(uint256 recurringId) external nonReentrant whenNotPaused {
        require(
            verificationBaseline[msg.sender] >= MIN_TRANSACT_BASELINE,
            "Payer not verified"
        );
        RecurringPledge storage rp = recurringPledges[recurringId];

        require(rp.id != 0, "Recurring pledge does not exist");
        require(msg.sender == rp.payer, "Only the payer can settle debt");
        require(rp.status == RecurringStatus.PENDING_SETTLEMENT, "No debt to settle");

        uint256 debt = rp.totalMissedDebt;
        require(debt > 0, "No outstanding debt");

        uint256 grossDebt = _grossWithFee(debt, rp.appliedFeeBps);
        uint256 fee = (debt * rp.appliedFeeBps) / 10000;

        // Effects
        rp.totalMissedDebt = 0;
        rp.status = RecurringStatus.COMPLETED;
        // Slot was only taken if the payer made at least one installment.
        if (rp.periodsCompleted > 0) {
            _decrementActive(rp.payer);
        }

        _applyCompletionBonus(rp.payer, rp.amountPerPeriod, rp.totalPeriods);

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

    /// @notice Payer cancels a recurring pledge — requires merchant's off-chain signature.
    /// @dev Missed debts are forgiven on cancellation. Reputation is unaffected.
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
        require(msg.sender == rp.payer, "Only the payer can cancel");
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

        rp.status = RecurringStatus.CANCELLED;
        rp.totalMissedDebt = 0;
        // Slot was only taken if the payer made at least one installment.
        if (rp.periodsCompleted > 0) {
            _decrementActive(rp.payer);
        }

        emit RecurringPledgeCancelled(recurringId, rp.payer, rp.merchant);
    }

    // ── P2P Instant Transfer ───────────────────────────────────────────────────

    /// @notice Send tokens instantly to any address — no pledge, no deposit hold.
    /// @dev Pure transfer for supporting family or friends. No reputation impact.
    ///      Protocol fee is applied; recipient receives exactly `amount`.
    /// @param token     Whitelisted ERC20 token to send
    /// @param recipient Destination address (any wallet)
    /// @param amount    Net token amount the recipient receives (6 decimals)
    function sendP2P(
        address token,
        address recipient,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        require(
            verificationBaseline[msg.sender] >= MIN_TRANSACT_BASELINE
                || isMerchantVerified[msg.sender],
            "Sender not verified"
        );
        require(allowedTokens[token], "Token not supported");
        require(recipient != address(0), "Invalid recipient address");
        require(recipient != msg.sender, "Cannot send to yourself");
        require(amount >= MIN_PLEDGE_AMOUNT, "Amount below minimum");

        uint256 feeBps = getServiceFeeBps(msg.sender);
        uint256 gross = _grossWithFee(amount, feeBps);
        uint256 fee = gross - amount;

        // Interactions
        IERC20(token).safeTransferFrom(msg.sender, address(this), gross);
        if (fee > 0) {
            IERC20(token).safeTransfer(feeRecipient, fee);
        }
        IERC20(token).safeTransfer(recipient, amount);

        emit P2PSent(msg.sender, recipient, token, amount, fee);
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    /// @dev Called when all periods (paid + missed) are accounted for.
    function _finalizeRecurring(uint256 recurringId) internal {
        RecurringPledge storage rp = recurringPledges[recurringId];

        if (rp.totalMissedDebt == 0) {
            rp.status = RecurringStatus.COMPLETED;
            // Slot was only taken if the payer made at least one installment.
            if (rp.periodsCompleted > 0) {
                _decrementActive(rp.payer);
            }
            _applyCompletionBonus(rp.payer, rp.amountPerPeriod, rp.totalPeriods);
            reputations[rp.payer].totalCount++;
            emit RecurringPledgeCompleted(recurringId, rp.merchant);
        } else {
            rp.status = RecurringStatus.PENDING_SETTLEMENT;
            // Record one default for the failed contract — caps defaultCount inflation
            // regardless of how many individual installments were missed.
            // Skip if the payer never engaged (no installments paid): the contract
            // was never accepted by them and should not damage their reputation.
            if (rp.periodsCompleted > 0) {
                Reputation storage rep = reputations[rp.payer];
                rep.defaultCount++;
                rep.totalCount++;
            }
        }
    }

    /// @dev Applies the 50% completion bonus when a recurring pledge is fully completed.
    ///      Caller is responsible for incrementing totalCount.
    function _applyCompletionBonus(address payer, uint256 amountPerPeriod, uint256 totalPeriods) internal {
        Reputation storage rep = reputations[payer];
        // slither-disable-next-line divide-before-multiply
        uint256 bonusAmount = (amountPerPeriod * totalPeriods) / 2; // intentional 50% completion bonus weight
        rep.weightedScore += bonusAmount * WEIGHT_ON_TIME;
        rep.totalWeight += bonusAmount;
    }

    /// @dev Finalizes a fully-funded pledge: pays the fee and the merchant, updates payer reputation.
    function _releaseFunds(uint256 pledgeId) internal {
        Pledge storage pledge = pledges[pledgeId];
        uint256 amount = pledge.totalAmount;

        // Effects
        pledge.status = PledgeStatus.COMPLETED;
        pledge.depositedAmount = 0;

        Reputation storage rep = reputations[pledge.payer];
        if (pledge.paidDuringGrace) {
            rep.lateCount++;
            rep.weightedScore += amount * WEIGHT_LATE;
        } else {
            rep.onTimeCount++;
            rep.weightedScore += amount * WEIGHT_ON_TIME;
        }
        rep.totalWeight += amount;
        rep.totalCount++;
        _decrementActive(pledge.payer);

        uint256 fee = (amount * pledge.appliedFeeBps) / 10000;

        // Interactions last.
        if (fee > 0) {
            IERC20(pledge.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(pledgeId, feeRecipient, fee);
        }
        IERC20(pledge.token).safeTransfer(pledge.merchant, amount);

        emit PledgeCompleted(pledgeId, pledge.merchant, amount);
    }

    /// @dev Records a default against the payer's reputation.
    function _recordDefault(address payer, uint256 amount) internal {
        Reputation storage rep = reputations[payer];
        rep.defaultCount++;
        rep.totalWeight += amount;
        rep.totalCount++;
    }

    /// @dev Safe decrement — underflow on activePledgeCount would permanently brick a user.
    function _decrementActive(address user) internal {
        if (activePledgeCount[user] > 0) {
            activePledgeCount[user]--;
        }
    }

    // ── Admin Functions ────────────────────────────────────────────────────────

    /// @notice Add or remove a token from the whitelist.
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

    /// @notice Set the verification operator address (backend wallet for auto-updates).
    /// @dev Operator can only call setVerificationBaseline. Pass address(0) to disable.
    function setVerificationOperator(address newOp) external onlyOwner {
        emit VerificationOperatorChanged(verificationOperator, newOp);
        verificationOperator = newOp;
    }

    /// @notice Set or update an OFW's KYC baseline score (full admin control).
    /// @dev Owner-only — used for KYC approval (0 → 5000), revocation (any → 0),
    ///      or manual overrides. The operator wallet uses boostVerificationBaseline
    ///      instead, which is restricted to the avatar-upload +1000 boost.
    ///      Intentionally NOT gated by whenNotPaused — admin must be able to revoke
    ///      fraudulent verifications during an emergency pause.
    function setVerificationBaseline(address ofw, uint256 newScore) external onlyOwner {
        require(ofw != address(0), "Invalid OFW address");
        require(newScore <= MAX_BASELINE, "Baseline exceeds maximum");
        uint256 oldScore = verificationBaseline[ofw];
        verificationBaseline[ofw] = newScore;
        emit VerificationBaselineChanged(ofw, oldScore, newScore);
    }

    /// @notice Operator-only narrow function: boost a KYC-approved OFW from
    ///         BASELINE_KYC to BASELINE_KYC_PLUS_AVATAR after they upload an avatar.
    /// @dev Restricted to this single transition for defense-in-depth. A compromised
    ///      operator key cannot fake-verify new users or revoke existing ones — it can
    ///      only push already-KYC-approved users up by +1000.
    function boostVerificationBaseline(address ofw) external whenNotPaused {
        require(msg.sender == verificationOperator, "Only operator");
        require(ofw != address(0), "Invalid OFW address");
        require(
            verificationBaseline[ofw] == BASELINE_KYC,
            "Only boostable from BASELINE_KYC"
        );
        verificationBaseline[ofw] = BASELINE_KYC_PLUS_AVATAR;
        emit VerificationBaselineChanged(ofw, BASELINE_KYC, BASELINE_KYC_PLUS_AVATAR);
    }

    /// @notice Set merchant verification flag. Owner-only — operator cannot do this.
    function setMerchantVerified(address merchant, bool verified) external onlyOwner {
        require(merchant != address(0), "Invalid merchant address");
        isMerchantVerified[merchant] = verified;
        emit MerchantVerificationChanged(merchant, verified);
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    /// @notice Service fee rate (basis points) for a given payer based on their trust score.
    /// @return bps 75 (0.75%) for high-trust payers, 100 (1%) standard
    function getServiceFeeBps(address payer) public view returns (uint256 bps) {
        if (_trustScore(payer) >= TIER_HIGH) {
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

    /// @notice Gross amount a payer would need to deposit for a pledge of `totalAmount`.
    function quoteGrossAmount(address payer, uint256 totalAmount)
        external
        view
        returns (uint256)
    {
        return _grossWithFee(totalAmount, getServiceFeeBps(payer));
    }

    /// @notice Gross amount for an existing pledge, using its locked-in fee rate.
    function grossAmountForPledge(uint256 pledgeId) external view returns (uint256) {
        Pledge storage pledge = pledges[pledgeId];
        require(pledge.id != 0, "Pledge does not exist");
        return _grossWithFee(pledge.totalAmount, pledge.appliedFeeBps);
    }

    /// @dev Single source of truth for the trust score (basis points, 0-10000).
    ///      Returns max(verificationBaseline, behavioral) so KYC sets a floor that
    ///      behavior can only raise above — never below — until admin downgrades.
    function _trustScore(address wallet) internal view returns (uint256) {
        Reputation storage rep = reputations[wallet];
        uint256 baseline = verificationBaseline[wallet];
        if (rep.totalWeight == 0) return baseline;
        uint256 behavioral = rep.weightedScore / rep.totalWeight;
        return behavioral > baseline ? behavioral : baseline;
    }

    /// @notice Trust score for a wallet, 0-10000 (divide by 100 for a percentage).
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

    /// @notice All pledge IDs assigned to a payer.
    function getPayerPledges(address payer) external view returns (uint256[] memory) {
        return payerPledgeIds[payer];
    }

    /// @notice All pledge IDs created by a merchant.
    function getMerchantPledges(address merchant) external view returns (uint256[] memory) {
        return merchantPledgeIds[merchant];
    }

    /// @notice Paginated view of a payer's pledge IDs.
    function getPayerPledgesPaginated(address payer, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(payerPledgeIds[payer], offset, limit);
    }

    /// @notice Paginated view of a merchant's pledge IDs.
    function getMerchantPledgesPaginated(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(merchantPledgeIds[merchant], offset, limit);
    }

    /// @notice All recurring pledge IDs assigned to a payer.
    function getPayerRecurringPledges(address payer) external view returns (uint256[] memory) {
        return payerRecurringIds[payer];
    }

    /// @notice All recurring pledge IDs created by a merchant.
    function getMerchantRecurringPledges(address merchant) external view returns (uint256[] memory) {
        return merchantRecurringIds[merchant];
    }

    /// @notice Paginated view of a payer's recurring pledge IDs.
    function getPayerRecurringPledgesPaginated(address payer, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(payerRecurringIds[payer], offset, limit);
    }

    /// @notice Paginated view of a merchant's recurring pledge IDs.
    function getMerchantRecurringPledgesPaginated(address merchant, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(merchantRecurringIds[merchant], offset, limit);
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

    /// @notice Max concurrent active pledges allowed for a payer.
    /// @dev Serial defaulters (defaultCount >= DEFAULT_LOCKOUT_THRESHOLD) are capped at the
    ///      no-history limit regardless of any on-time history they may also have.
    function getMaxActivePledges(address payer) public view returns (uint256) {
        Reputation storage rep = reputations[payer];

        if (rep.defaultCount >= DEFAULT_LOCKOUT_THRESHOLD) {
            return MAX_ACTIVE_NO_HISTORY;
        }

        uint256 score = _trustScore(payer);
        if (score >= TIER_HIGH) return MAX_ACTIVE_HIGH;
        if (score >= TIER_MID)  return MAX_ACTIVE_MID;
        return MAX_ACTIVE_NO_HISTORY;
    }

    /// @notice Required upfront deposit percentage for a payer, based on their trust score.
    /// @dev Score is `max(verificationBaseline, behavioralScore)`. Unverified wallets have
    ///      baseline 0 and no history, putting them in the RISK tier (50% deposit) — but
    ///      they cannot transact at all until KYC raises their baseline to MIN_TRANSACT_BASELINE.
    function getRequiredDepositPct(address payer) public view returns (uint256) {
        uint256 score = _trustScore(payer);
        if (score >= TIER_HIGH) return DEPOSIT_TIER_HIGH; // 80%+ -> 20%
        if (score >= TIER_MID)  return DEPOSIT_TIER_MID;  // 50%+ -> 30%
        if (score >= TIER_LOW)  return DEPOSIT_TIER_LOW;  // 20%+ -> 40%
        return DEPOSIT_TIER_RISK;                          // < 20% -> 50%
    }
}

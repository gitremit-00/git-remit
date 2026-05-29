// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/access/Ownable2Step.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

// ── Custom errors (cheaper than revert strings) ────────────────────────────────
error InvalidAccountId();
error InvalidAddress();
error InvalidAmount();
error TokenNotSupported();
error WalletNotLinked();
error WalletAlreadyLinked();
error LinkingDisabled();
error LastWalletCannotUnlink();
error SignatureExpired();
error SignatureValidityTooLong();
error InvalidSignature();
error NotAuthorized();
error InsufficientBalance();
error MerchantNotVerified();
error PayerNotVerified();
error SenderNotVerified();
error RecipientNotRegistered();
error SelfTransferDisallowed();
error AmountBelowMinimum();
error CommitmentInPast();
error CommitmentTooFar();
error IntervalTooShort();
error InvalidPeriodCount();
error PledgeMissing();
error PledgeNotPending();
error PledgeNotActive();
error PledgeNotCancellable();
error PledgeNotInSettlement();
error AllPeriodsAccounted();
error GraceEnded();
error GraceNotOver();
error ClaimWindowExpired();
error ClaimWindowOpen();
error NothingToClaim();
error NothingToReclaim();
error NoMissedInstallments();
error NoOutstandingDebt();
error ExtensionTooLate();
error ExtensionDateInvalid();
error ExtensionTooLong();
error DepositLimitReached();
error DepositBelowRequiredPct();
error DepositExceedsTotal();
error DepositExactRemainder();
error WithdrawalNotActive();
error TimelockNotElapsed();
error BaselineExceedsMax();
error BaselineNotKyc();
error OnlyOperator();

/// @title RemittancePledge — Account-keyed OFW Payment Pledge System on Morph L2
/// @notice v2: identity is keyed by accountId (bytes32) derived off-chain from the user's
///         RemitSafe profile UUID. Wallets are linked to accounts via linkWallet; one
///         account may own multiple wallets. Reputation, KYC baseline, role, balances,
///         and active-pledge caps are all account-keyed.
///         Merchant payments and P2P receipts are credited to an account-held escrow;
///         users withdraw to any of their linked wallets, subject to daily caps and
///         tiered timelocks (instant within cap, 1h up to 5×, 24h beyond).
contract RemittancePledge is ReentrancyGuard, Pausable, Ownable2Step {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant GRACE_PERIOD    = 3 days;
    uint256 public constant MAX_PLEDGE_DAYS = 90 days;
    uint256 public constant MAX_EXTENSION   = 30 days;

    uint256 public constant CLAIM_WINDOW = 45 days;
    uint256 public constant TIME_BUFFER  = 15 minutes;

    uint256 public constant WEIGHT_ON_TIME = 10000;
    uint256 public constant WEIGHT_LATE    = 7000;

    uint256 public constant TIER_HIGH = 8000;
    uint256 public constant TIER_MID  = 5000;
    uint256 public constant TIER_LOW  = 2000;

    uint256 public constant DEPOSIT_TIER_HIGH = 20;
    uint256 public constant DEPOSIT_TIER_MID  = 30;
    uint256 public constant DEPOSIT_TIER_LOW  = 40;
    uint256 public constant DEPOSIT_TIER_RISK = 50;

    uint256 public constant MAX_ACTIVE_NO_HISTORY = 2;
    uint256 public constant MAX_ACTIVE_MID        = 3;
    uint256 public constant MAX_ACTIVE_HIGH       = 5;

    uint256 public constant DEFAULT_LOCKOUT_THRESHOLD = 3;

    uint256 public constant FEE_BPS_STANDARD = 100;
    uint256 public constant FEE_BPS_LOYALTY  = 75;

    uint256 public constant MIN_PLEDGE_AMOUNT = 1_000_000;

    uint256 public constant MIN_RECURRING_INTERVAL = 7 days;
    uint256 public constant MAX_RECURRING_PERIODS  = 12;

    uint256 public constant WEIGHT_INSTALLMENT_PARTIAL = 5000;
    uint256 public constant WEIGHT_INSTALLMENT_BONUS   = 5000;

    uint256 public constant MIN_TRANSACT_BASELINE    = 5000;
    uint256 public constant BASELINE_KYC             = 5000;
    uint256 public constant BASELINE_KYC_PLUS_AVATAR = 6000;
    uint256 public constant MAX_BASELINE             = 6000;

    // v2 constants
    uint256 public constant DEFAULT_DAILY_CAP     = 500 * 10**6; // 500 USDC equiv (6-decimal tokens)
    uint256 public constant CAP_TIER_HIGH_MULT    = 5;           // 5× cap → 24h timelock
    uint256 public constant TIMELOCK_1H           = 1 hours;
    uint256 public constant TIMELOCK_24H          = 24 hours;
    uint256 public constant LINK_SIG_MAX_VALIDITY = 1 hours;

    // ── Types ──────────────────────────────────────────────────────────────────
    enum PledgeStatus { PENDING, COMPLETED, DEFAULTED, CANCELLED }
    enum RecurringStatus { ACTIVE, PENDING_SETTLEMENT, COMPLETED, CANCELLED }

    struct Pledge {
        uint256 id;
        bytes32 merchantAccount;
        bytes32 payerAccount;
        address depositingWallet; // wallet that submitted the first deposit (refund target)
        address token;
        uint256 totalAmount;
        uint256 depositedAmount;
        uint256 commitmentDate;
        uint256 appliedFeeBps;
        PledgeStatus status;
        bool paidDuringGrace;
    }

    struct RecurringPledge {
        uint256 id;
        bytes32 merchantAccount;
        bytes32 payerAccount;
        address token;
        uint256 amountPerPeriod;
        uint256 intervalSeconds;
        uint256 totalPeriods;
        uint256 periodsCompleted;
        uint256 missedCount;
        uint256 totalMissedDebt;
        uint256 nextDueDate;
        uint256 appliedFeeBps;
        RecurringStatus status;
    }

    struct Reputation {
        uint256 onTimeCount;
        uint256 lateCount;
        uint256 defaultCount;
        uint256 totalCount;
        uint256 weightedScore;
        uint256 totalWeight;
    }

    struct PendingWithdrawal {
        bytes32 accountId;
        address sourceWallet;
        address token;
        uint256 amount;
        uint256 queuedAt;
        uint256 claimableAt;
        bool active;
    }

    // ── State ──────────────────────────────────────────────────────────────────
    /// @notice Whitelist of ERC20 tokens accepted by the contract.
    mapping(address => bool) public allowedTokens;

    address public feeRecipient;
    uint256 public pledgeCounter;
    uint256 public recurringCounter;

    mapping(uint256 => Pledge) public pledges;
    mapping(uint256 => RecurringPledge) public recurringPledges;

    // Identity registry
    mapping(address => bytes32) public walletToAccount;
    mapping(bytes32 => address[]) public accountWallets;
    mapping(bytes32 => uint256) public linkNonces;
    address public linkOperator;

    // Account-keyed identity state
    mapping(bytes32 => Reputation) public accountReputation;
    mapping(bytes32 => uint256) public accountVerificationBaseline;
    mapping(bytes32 => bool) public accountIsMerchantVerified;
    mapping(bytes32 => uint256) public accountActivePledgeCount;

    // Account-keyed pledge indexes (paginated externally)
    mapping(bytes32 => uint256[]) private accountPayerPledgeIds;
    mapping(bytes32 => uint256[]) private accountMerchantPledgeIds;
    mapping(bytes32 => uint256[]) private accountPayerRecurringIds;
    mapping(bytes32 => uint256[]) private accountMerchantRecurringIds;

    // Escrow & withdrawal
    mapping(bytes32 => mapping(address => uint256)) public accountBalances;
    mapping(address => mapping(address => uint256)) public walletDailyCap;
    mapping(address => mapping(address => bool)) public walletCapConfigured;
    mapping(address => mapping(address => mapping(uint256 => uint256))) public dailyWithdrawnAmount;
    mapping(uint256 => PendingWithdrawal) public pendingWithdrawals;
    uint256 public pendingWithdrawalCounter;

    // Per-pledge signature nonces
    mapping(uint256 => uint256) public extensionNonces;
    mapping(uint256 => uint256) public cancelNonces;
    mapping(uint256 => uint256) public recurringCancelNonces;

    // Avatar-boost operator (narrow role)
    address public verificationOperator;

    // ── Events ─────────────────────────────────────────────────────────────────
    // Pledge events
    event PledgeCreated(
        uint256 indexed pledgeId,
        bytes32 indexed merchantAccount,
        bytes32 indexed payerAccount,
        address token,
        uint256 totalAmount,
        uint256 commitmentDate,
        uint256 appliedFeeBps
    );
    event DepositMade(
        uint256 indexed pledgeId,
        bytes32 indexed payerAccount,
        address wallet,
        uint256 amount,
        uint256 totalDeposited
    );
    event PledgeCompleted(uint256 indexed pledgeId, bytes32 indexed merchantAccount, uint256 amount);
    event PledgeDefaulted(uint256 indexed pledgeId, bytes32 indexed merchantAccount, uint256 amount);
    event PledgeCancelled(
        uint256 indexed pledgeId,
        bytes32 indexed payerAccount,
        bytes32 indexed merchantAccount,
        uint256 refund
    );
    event DepositReclaimed(uint256 indexed pledgeId, bytes32 indexed payerAccount, uint256 amount);
    event DeadlineExtended(uint256 indexed pledgeId, uint256 oldDate, uint256 newDate);
    event FeeCollected(uint256 indexed pledgeId, address indexed feeRecipient, uint256 fee);

    // Admin / config events
    event FeeRecipientUpdated(address indexed oldRecipient, address indexed newRecipient);
    event TokenAllowanceSet(address indexed token, bool allowed);
    event AccountVerificationBaselineChanged(bytes32 indexed accountId, uint256 oldScore, uint256 newScore);
    event AccountMerchantVerificationChanged(bytes32 indexed accountId, bool verified);
    event VerificationOperatorChanged(address indexed oldOp, address indexed newOp);
    event LinkOperatorChanged(address indexed oldOp, address indexed newOp);

    // Linking events
    event WalletLinked(bytes32 indexed accountId, address indexed wallet, bool isPrimary);
    event WalletUnlinked(bytes32 indexed accountId, address indexed wallet);
    event PanicUnlinkAll(bytes32 indexed accountId, address indexed survivor);

    // Escrow / withdrawal events
    event FundsCredited(bytes32 indexed accountId, address indexed token, uint256 amount, string source);
    event WithdrawalInstant(
        bytes32 indexed accountId,
        address indexed wallet,
        address indexed token,
        uint256 amount
    );
    event WithdrawalQueued(
        uint256 indexed withdrawalId,
        bytes32 indexed accountId,
        address indexed wallet,
        address token,
        uint256 amount,
        uint256 claimableAt
    );
    event WithdrawalClaimed(
        uint256 indexed withdrawalId,
        bytes32 indexed accountId,
        address indexed wallet,
        uint256 amount
    );
    event WithdrawalCancelled(uint256 indexed withdrawalId, bytes32 indexed accountId, string reason);
    event DailyCapChanged(address indexed wallet, address indexed token, uint256 oldCap, uint256 newCap);

    // P2P event — keeps wallet-addressed fields for off-chain observability; adds account context
    event P2PSent(
        address indexed sender,
        address indexed recipient,
        bytes32 senderAccount,
        bytes32 recipientAccount,
        address token,
        uint256 amount,
        uint256 fee
    );

    // Recurring pledge events
    event RecurringPledgeCreated(
        uint256 indexed recurringId,
        bytes32 indexed merchantAccount,
        bytes32 indexed payerAccount,
        address token,
        uint256 amountPerPeriod,
        uint256 intervalSeconds,
        uint256 totalPeriods,
        uint256 firstDueDate,
        uint256 appliedFeeBps
    );
    event InstallmentPaid(uint256 indexed recurringId, bytes32 indexed payerAccount, uint256 period, uint256 amount);
    event InstallmentMissed(uint256 indexed recurringId, uint256 period, uint256 debtAdded);
    event DebtSettled(uint256 indexed recurringId, bytes32 indexed payerAccount, uint256 amount);
    event RecurringPledgeCompleted(uint256 indexed recurringId, bytes32 indexed merchantAccount);
    event RecurringPledgeCancelled(
        uint256 indexed recurringId,
        bytes32 indexed payerAccount,
        bytes32 indexed merchantAccount
    );

    // ── Constructor ────────────────────────────────────────────────────────────
    /// @param initialTokens List of token addresses to whitelist at deployment
    /// @param _feeRecipient Recipient of the protocol fee
    /// @param _linkOperator Wallet authorized to co-sign linkWallet approvals
    /// @param _verificationOperator Wallet authorized to call boostVerificationBaseline (pass address(0) to disable until later)
    constructor(
        address[] memory initialTokens,
        address _feeRecipient,
        address _linkOperator,
        address _verificationOperator
    ) Ownable(msg.sender) {
        if (initialTokens.length == 0) revert InvalidAmount();
        if (_feeRecipient == address(0)) revert InvalidAddress();
        for (uint256 i = 0; i < initialTokens.length; i++) {
            if (initialTokens[i] == address(0)) revert InvalidAddress();
            allowedTokens[initialTokens[i]] = true;
            emit TokenAllowanceSet(initialTokens[i], true);
        }
        feeRecipient = _feeRecipient;
        linkOperator = _linkOperator;
        verificationOperator = _verificationOperator;
        emit LinkOperatorChanged(address(0), _linkOperator);
        emit VerificationOperatorChanged(address(0), _verificationOperator);
    }

    // ── Identity / Wallet Linking ──────────────────────────────────────────────

    /// @notice Link the caller's wallet to a RemitSafe account.
    /// @dev Requires an off-chain signature from the linkOperator authorizing this specific
    ///      wallet/account pairing. Each link consumes the account's linkNonce to prevent replay.
    function linkWallet(
        bytes32 accountId,
        uint256 sigExpiry,
        bytes calldata operatorSig
    ) external whenNotPaused {
        if (accountId == bytes32(0)) revert InvalidAccountId();
        if (walletToAccount[msg.sender] != bytes32(0)) revert WalletAlreadyLinked();
        if (block.timestamp > sigExpiry) revert SignatureExpired();
        if (sigExpiry > block.timestamp + LINK_SIG_MAX_VALIDITY) revert SignatureValidityTooLong();
        if (linkOperator == address(0)) revert LinkingDisabled();

        bytes32 msgHash = keccak256(
            abi.encodePacked(
                block.chainid,
                address(this),
                "link",
                accountId,
                msg.sender,
                sigExpiry,
                linkNonces[accountId]
            )
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        if (ECDSA.recover(ethHash, operatorSig) != linkOperator) revert InvalidSignature();

        linkNonces[accountId]++;
        walletToAccount[msg.sender] = accountId;
        accountWallets[accountId].push(msg.sender);

        bool isPrimary = accountWallets[accountId].length == 1;
        emit WalletLinked(accountId, msg.sender, isPrimary);
    }

    /// @notice Unlink the caller's wallet from its account.
    /// @dev Cannot unlink the last wallet on an account — use the account-closure flow for that.
    ///      Pending withdrawals from this wallet are implicitly invalidated at claim time.
    function unlinkWallet() external whenNotPaused {
        bytes32 accountId = walletToAccount[msg.sender];
        if (accountId == bytes32(0)) revert WalletNotLinked();
        if (accountWallets[accountId].length <= 1) revert LastWalletCannotUnlink();

        walletToAccount[msg.sender] = bytes32(0);

        address[] storage wallets = accountWallets[accountId];
        for (uint256 i = 0; i < wallets.length; i++) {
            if (wallets[i] == msg.sender) {
                wallets[i] = wallets[wallets.length - 1];
                wallets.pop();
                break;
            }
        }

        emit WalletUnlinked(accountId, msg.sender);
    }

    /// @notice Emergency: unlink every wallet on the caller's account except the caller's.
    /// @dev Use when a wallet is suspected compromised. Other wallets' pending withdrawals
    ///      become invalid at claim time. Survivor stays linked and operational.
    function panicUnlink() external whenNotPaused {
        bytes32 accountId = walletToAccount[msg.sender];
        if (accountId == bytes32(0)) revert WalletNotLinked();

        address[] storage wallets = accountWallets[accountId];
        uint256 len = wallets.length;
        for (uint256 i = 0; i < len; i++) {
            address w = wallets[i];
            if (w != msg.sender) {
                walletToAccount[w] = bytes32(0);
                emit WalletUnlinked(accountId, w);
            }
        }

        delete accountWallets[accountId];
        accountWallets[accountId].push(msg.sender);

        emit PanicUnlinkAll(accountId, msg.sender);
    }

    // ── Withdrawal ─────────────────────────────────────────────────────────────

    /// @notice Withdraw from the caller's account-held escrow balance to the caller's own wallet.
    /// @dev Tiered timelock:
    ///        - Within remaining daily cap → instant
    ///        - amount ≤ cap × 5            → 1h timelock (queued)
    ///        - amount > cap × 5            → 24h timelock (queued)
    ///      Queued amount is debited from the account balance immediately to prevent
    ///      double-spend; cancel returns it.
    function withdraw(address token, uint256 amount)
        external
        nonReentrant
        whenNotPaused
        returns (uint256 withdrawalId)
    {
        bytes32 accountId = walletToAccount[msg.sender];
        if (accountId == bytes32(0)) revert WalletNotLinked();
        if (!allowedTokens[token]) revert TokenNotSupported();
        if (amount == 0) revert InvalidAmount();
        if (accountBalances[accountId][token] < amount) revert InsufficientBalance();

        // Resolve cap: unconfigured = DEFAULT_DAILY_CAP, 0 = disabled, max = unlimited
        uint256 cap;
        if (!walletCapConfigured[msg.sender][token]) {
            cap = DEFAULT_DAILY_CAP;
        } else {
            cap = walletDailyCap[msg.sender][token];
            if (cap == 0) revert NotAuthorized(); // withdrawals explicitly disabled
        }

        uint256 dayIndex = block.timestamp / 1 days;
        uint256 used = dailyWithdrawnAmount[msg.sender][token][dayIndex];

        // Unlimited cap → always instant
        bool unlimited = cap == type(uint256).max;

        // Tier 1: within remaining daily cap (or unlimited) → instant transfer
        if (unlimited || used + amount <= cap) {
            if (!unlimited) {
                dailyWithdrawnAmount[msg.sender][token][dayIndex] = used + amount;
            }
            accountBalances[accountId][token] -= amount;
            IERC20(token).safeTransfer(msg.sender, amount);
            emit WithdrawalInstant(accountId, msg.sender, token, amount);
            return 0;
        }

        // Tier 2/3: queue with timelock based on size vs cap
        uint256 timelock = amount <= cap * CAP_TIER_HIGH_MULT ? TIMELOCK_1H : TIMELOCK_24H;
        uint256 claimableAt = block.timestamp + timelock;
        withdrawalId = ++pendingWithdrawalCounter;

        pendingWithdrawals[withdrawalId] = PendingWithdrawal({
            accountId: accountId,
            sourceWallet: msg.sender,
            token: token,
            amount: amount,
            queuedAt: block.timestamp,
            claimableAt: claimableAt,
            active: true
        });

        // Debit immediately so the user can't queue multiple withdrawals against the same funds
        accountBalances[accountId][token] -= amount;

        emit WithdrawalQueued(withdrawalId, accountId, msg.sender, token, amount, claimableAt);
    }

    /// @notice Cancel a pending withdrawal. Any wallet linked to the same account can cancel.
    function cancelPendingWithdrawal(uint256 id) external nonReentrant whenNotPaused {
        PendingWithdrawal storage w = pendingWithdrawals[id];
        if (!w.active) revert WithdrawalNotActive();
        if (walletToAccount[msg.sender] != w.accountId) revert NotAuthorized();

        w.active = false;
        accountBalances[w.accountId][w.token] += w.amount;

        emit WithdrawalCancelled(id, w.accountId, "user_cancelled");
    }

    /// @notice Claim a pending withdrawal once its timelock has elapsed.
    /// @dev Re-checks that the source wallet is still linked to the originating account.
    ///      If the wallet has been unlinked (panic or explicit), the withdrawal is auto-
    ///      cancelled and the funds returned to the account balance.
    function claimPendingWithdrawal(uint256 id) external nonReentrant whenNotPaused {
        PendingWithdrawal storage w = pendingWithdrawals[id];
        if (!w.active) revert WithdrawalNotActive();
        if (block.timestamp < w.claimableAt) revert TimelockNotElapsed();

        w.active = false;

        if (walletToAccount[w.sourceWallet] != w.accountId) {
            accountBalances[w.accountId][w.token] += w.amount;
            emit WithdrawalCancelled(id, w.accountId, "wallet_unlinked");
            return;
        }

        IERC20(w.token).safeTransfer(w.sourceWallet, w.amount);
        emit WithdrawalClaimed(id, w.accountId, w.sourceWallet, w.amount);
    }

    /// @notice Configure the caller's per-wallet daily withdrawal cap for a given token.
    /// @dev Setting newCap = type(uint256).max effectively removes the cap.
    /// @notice Configure the caller's per-wallet daily withdrawal cap for a token.
    /// @dev Semantics:
    ///        - newCap == 0                  → withdrawals explicitly DISABLED
    ///        - newCap == type(uint256).max  → UNLIMITED (every withdrawal is instant)
    ///        - any other value              → that amount per day
    ///      Unconfigured wallets use DEFAULT_DAILY_CAP.
    function setWalletDailyCap(address token, uint256 newCap) external whenNotPaused {
        if (walletToAccount[msg.sender] == bytes32(0)) revert WalletNotLinked();
        if (!allowedTokens[token]) revert TokenNotSupported();

        uint256 oldCap = walletCapConfigured[msg.sender][token]
            ? walletDailyCap[msg.sender][token]
            : DEFAULT_DAILY_CAP;
        walletDailyCap[msg.sender][token] = newCap;
        walletCapConfigured[msg.sender][token] = true;
        emit DailyCapChanged(msg.sender, token, oldCap, newCap);
    }

    // ── Merchant Functions ─────────────────────────────────────────────────────

    /// @notice Merchant creates a payment request targeting a specific payer account.
    /// @dev Caller's wallet must be linked to a verified-merchant account. Payer account
    ///      must be KYC-approved (baseline ≥ MIN_TRANSACT_BASELINE) but does not need to
    ///      have any linked wallets at creation time — the payer can link later and deposit.
    function createPledge(
        address token,
        bytes32 payerAccount,
        uint256 totalAmount,
        uint256 commitmentDate
    ) external whenNotPaused {
        bytes32 merchantAccount = walletToAccount[msg.sender];
        if (merchantAccount == bytes32(0)) revert WalletNotLinked();
        if (!accountIsMerchantVerified[merchantAccount]) revert MerchantNotVerified();
        if (payerAccount == bytes32(0)) revert InvalidAccountId();
        if (payerAccount == merchantAccount) revert SelfTransferDisallowed();
        if (accountVerificationBaseline[payerAccount] < MIN_TRANSACT_BASELINE) revert PayerNotVerified();
        if (!allowedTokens[token]) revert TokenNotSupported();
        if (totalAmount < MIN_PLEDGE_AMOUNT) revert AmountBelowMinimum();
        if (commitmentDate <= block.timestamp) revert CommitmentInPast();
        if (commitmentDate > block.timestamp + MAX_PLEDGE_DAYS) revert CommitmentTooFar();

        uint256 feeBps = getServiceFeeBps(payerAccount);
        uint256 pledgeId = ++pledgeCounter;

        pledges[pledgeId] = Pledge({
            id: pledgeId,
            merchantAccount: merchantAccount,
            payerAccount: payerAccount,
            depositingWallet: address(0),
            token: token,
            totalAmount: totalAmount,
            depositedAmount: 0,
            commitmentDate: commitmentDate,
            appliedFeeBps: feeBps,
            status: PledgeStatus.PENDING,
            paidDuringGrace: false
        });

        accountPayerPledgeIds[payerAccount].push(pledgeId);
        accountMerchantPledgeIds[merchantAccount].push(pledgeId);

        emit PledgeCreated(
            pledgeId,
            merchantAccount,
            payerAccount,
            token,
            totalAmount,
            commitmentDate,
            feeBps
        );
    }

    /// @notice Merchant creates a recurring payment request targeting a specific payer account.
    /// @dev Active slot is consumed on the payer's first installment, not at creation.
    function createRecurringPledge(
        address token,
        bytes32 payerAccount,
        uint256 amountPerPeriod,
        uint256 intervalSeconds,
        uint256 totalPeriods,
        uint256 firstDueDate
    ) external whenNotPaused {
        bytes32 merchantAccount = walletToAccount[msg.sender];
        if (merchantAccount == bytes32(0)) revert WalletNotLinked();
        if (!accountIsMerchantVerified[merchantAccount]) revert MerchantNotVerified();
        if (payerAccount == bytes32(0)) revert InvalidAccountId();
        if (payerAccount == merchantAccount) revert SelfTransferDisallowed();
        if (accountVerificationBaseline[payerAccount] < MIN_TRANSACT_BASELINE) revert PayerNotVerified();
        if (!allowedTokens[token]) revert TokenNotSupported();
        if (amountPerPeriod < MIN_PLEDGE_AMOUNT) revert AmountBelowMinimum();
        if (intervalSeconds < MIN_RECURRING_INTERVAL) revert IntervalTooShort();
        if (totalPeriods == 0 || totalPeriods > MAX_RECURRING_PERIODS) revert InvalidPeriodCount();
        if (firstDueDate <= block.timestamp) revert CommitmentInPast();

        uint256 feeBps = getServiceFeeBps(payerAccount);
        uint256 recurringId = ++recurringCounter;

        recurringPledges[recurringId] = RecurringPledge({
            id: recurringId,
            merchantAccount: merchantAccount,
            payerAccount: payerAccount,
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

        accountPayerRecurringIds[payerAccount].push(recurringId);
        accountMerchantRecurringIds[merchantAccount].push(recurringId);

        emit RecurringPledgeCreated(
            recurringId,
            merchantAccount,
            payerAccount,
            token,
            amountPerPeriod,
            intervalSeconds,
            totalPeriods,
            firstDueDate,
            feeBps
        );
    }

    /// @notice Merchant claims a defaulted pledge's deposit. Credited to merchant's escrow balance.
    function claimDefaultedDeposit(uint256 pledgeId) external nonReentrant whenNotPaused {
        bytes32 callerAccount = walletToAccount[msg.sender];
        if (callerAccount == bytes32(0)) revert WalletNotLinked();
        if (!accountIsMerchantVerified[callerAccount]) revert MerchantNotVerified();

        Pledge storage pledge = pledges[pledgeId];
        if (pledge.id == 0) revert PledgeMissing();
        if (callerAccount != pledge.merchantAccount) revert NotAuthorized();
        if (pledge.status != PledgeStatus.PENDING) revert PledgeNotPending();
        if (pledge.depositedAmount == 0) revert NothingToClaim();
        if (block.timestamp <= pledge.commitmentDate + GRACE_PERIOD + TIME_BUFFER) revert GraceNotOver();
        if (block.timestamp > pledge.commitmentDate + GRACE_PERIOD + CLAIM_WINDOW) revert ClaimWindowExpired();

        uint256 claimAmount = pledge.depositedAmount;

        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;
        _recordDefault(pledge.payerAccount, pledge.totalAmount);
        _decrementActive(pledge.payerAccount);

        accountBalances[pledge.merchantAccount][pledge.token] += claimAmount;
        emit FundsCredited(pledge.merchantAccount, pledge.token, claimAmount, "default_claimed");

        emit PledgeDefaulted(pledgeId, pledge.merchantAccount, claimAmount);
    }

    /// @notice Merchant flags a missed installment after the grace period ends.
    function markMissedInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        RecurringPledge storage rp = recurringPledges[recurringId];
        bytes32 callerAccount = walletToAccount[msg.sender];

        if (rp.id == 0) revert PledgeMissing();
        if (callerAccount != rp.merchantAccount) revert NotAuthorized();
        if (rp.status != RecurringStatus.ACTIVE) revert PledgeNotActive();
        if (rp.periodsCompleted + rp.missedCount >= rp.totalPeriods) revert AllPeriodsAccounted();
        if (block.timestamp <= rp.nextDueDate + GRACE_PERIOD + TIME_BUFFER) revert GraceNotOver();

        uint256 currentPeriod = rp.periodsCompleted + rp.missedCount + 1;

        rp.missedCount++;
        rp.totalMissedDebt += rp.amountPerPeriod;
        rp.nextDueDate += rp.intervalSeconds;

        // Drag the payer's reputation only if they engaged (at least one installment paid)
        if (rp.periodsCompleted > 0) {
            // slither-disable-next-line divide-before-multiply
            accountReputation[rp.payerAccount].totalWeight += rp.amountPerPeriod / 2;
        }

        emit InstallmentMissed(recurringId, currentPeriod, rp.amountPerPeriod);

        if (rp.periodsCompleted + rp.missedCount == rp.totalPeriods) {
            _finalizeRecurring(recurringId);
        }
    }

    // ── Payer Functions ────────────────────────────────────────────────────────

    /// @notice Payer deposits funds toward a pledge. Any of their linked wallets can be the source.
    /// @dev First deposit also records the depositing wallet for refund routing (cancel / reclaim).
    function submitDeposit(uint256 pledgeId, uint256 amount)
        external
        nonReentrant
        whenNotPaused
    {
        bytes32 payerAccount = walletToAccount[msg.sender];
        if (payerAccount == bytes32(0)) revert WalletNotLinked();
        if (accountVerificationBaseline[payerAccount] < MIN_TRANSACT_BASELINE) revert PayerNotVerified();

        Pledge storage pledge = pledges[pledgeId];
        if (pledge.id == 0) revert PledgeMissing();
        if (payerAccount != pledge.payerAccount) revert NotAuthorized();
        if (pledge.status != PledgeStatus.PENDING) revert PledgeNotPending();
        if (block.timestamp > pledge.commitmentDate + GRACE_PERIOD) revert GraceEnded();
        if (amount == 0) revert InvalidAmount();

        uint256 gross = _grossWithFee(pledge.totalAmount, pledge.appliedFeeBps);

        if (pledge.depositedAmount == 0) {
            bool isFullPayment = amount >= gross;
            uint256 maxActive = getAccountMaxActivePledges(pledge.payerAccount);
            if (accountActivePledgeCount[pledge.payerAccount] >= maxActive && !isFullPayment) revert DepositLimitReached();

            uint256 requiredPct = getAccountRequiredDepositPct(pledge.payerAccount);
            if (amount < (gross * requiredPct) / 100) revert DepositBelowRequiredPct();
            if (amount > gross) revert DepositExceedsTotal();

            accountActivePledgeCount[pledge.payerAccount]++;
            pledge.depositingWallet = msg.sender;
        } else {
            if (pledge.depositedAmount + amount != gross) revert DepositExactRemainder();
        }

        if (block.timestamp > pledge.commitmentDate) {
            pledge.paidDuringGrace = true;
        }
        pledge.depositedAmount += amount;

        IERC20(pledge.token).safeTransferFrom(msg.sender, address(this), amount);

        emit DepositMade(pledgeId, pledge.payerAccount, msg.sender, amount, pledge.depositedAmount);

        if (pledge.depositedAmount >= gross) {
            _releaseFunds(pledgeId);
        }
    }

    /// @notice Payer reclaims their deposit when the merchant's claim window has closed.
    /// @dev Refund goes directly to the depositing wallet (refund paths bypass escrow per spec #14).
    function reclaimDeposit(uint256 pledgeId) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];
        bytes32 callerAccount = walletToAccount[msg.sender];

        if (pledge.id == 0) revert PledgeMissing();
        if (callerAccount != pledge.payerAccount) revert NotAuthorized();
        if (pledge.status != PledgeStatus.PENDING) revert PledgeNotPending();
        if (pledge.depositedAmount == 0) revert NothingToReclaim();
        if (block.timestamp <= pledge.commitmentDate + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER) revert ClaimWindowOpen();

        uint256 amount = pledge.depositedAmount;
        address refundTo = pledge.depositingWallet;
        if (refundTo == address(0)) refundTo = msg.sender;

        pledge.status = PledgeStatus.DEFAULTED;
        pledge.depositedAmount = 0;
        _recordDefault(pledge.payerAccount, pledge.totalAmount);
        _decrementActive(pledge.payerAccount);

        IERC20(pledge.token).safeTransfer(refundTo, amount);

        emit DepositReclaimed(pledgeId, pledge.payerAccount, amount);
    }

    /// @notice Payer requests a deadline extension. Requires off-chain signature from any
    ///         currently-linked merchant wallet.
    function extendDeadline(
        uint256 pledgeId,
        uint256 newDate,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        bytes32 callerAccount = walletToAccount[msg.sender];
        if (callerAccount == bytes32(0)) revert WalletNotLinked();
        // No baseline check: payer with revoked KYC can still extend (matches cancel symmetry).
        // Merchant signature is the authorization. submitDeposit still gates fund movement on KYC.

        Pledge storage pledge = pledges[pledgeId];
        if (pledge.id == 0) revert PledgeMissing();
        if (callerAccount != pledge.payerAccount) revert NotAuthorized();
        if (pledge.status != PledgeStatus.PENDING) revert PledgeNotPending();
        if (block.timestamp >= pledge.commitmentDate) revert ExtensionTooLate();
        if (block.timestamp > sigExpiry) revert SignatureExpired();
        if (newDate <= pledge.commitmentDate) revert ExtensionDateInvalid();
        if (newDate > pledge.commitmentDate + MAX_EXTENSION) revert ExtensionTooLong();

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
        address signer = ECDSA.recover(ethHash, merchantSig);
        if (walletToAccount[signer] != pledge.merchantAccount) revert InvalidSignature();

        extensionNonces[pledgeId]++;

        uint256 oldDate = pledge.commitmentDate;
        pledge.commitmentDate = newDate;

        emit DeadlineExtended(pledgeId, oldDate, newDate);
    }

    /// @notice Payer cancels a pledge with off-chain merchant signature. Refund (if any) goes
    ///         directly to the depositing wallet.
    function cancelPledge(
        uint256 pledgeId,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        Pledge storage pledge = pledges[pledgeId];
        bytes32 callerAccount = walletToAccount[msg.sender];

        if (pledge.id == 0) revert PledgeMissing();
        if (callerAccount != pledge.payerAccount) revert NotAuthorized();
        if (pledge.status != PledgeStatus.PENDING) revert PledgeNotPending();
        if (block.timestamp >= pledge.commitmentDate) revert ExtensionTooLate();
        if (block.timestamp > sigExpiry) revert SignatureExpired();

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
        address signer = ECDSA.recover(ethHash, merchantSig);
        if (walletToAccount[signer] != pledge.merchantAccount) revert InvalidSignature();

        cancelNonces[pledgeId]++;

        uint256 refund = pledge.depositedAmount;
        address refundTo = pledge.depositingWallet;
        if (refundTo == address(0)) refundTo = msg.sender;

        pledge.status = PledgeStatus.CANCELLED;
        pledge.depositedAmount = 0;
        if (refund > 0) {
            _decrementActive(pledge.payerAccount);
        }

        if (refund > 0) {
            IERC20(pledge.token).safeTransfer(refundTo, refund);
        }

        emit PledgeCancelled(pledgeId, pledge.payerAccount, pledge.merchantAccount, refund);
    }

    /// @notice Payer pays the current installment of a recurring pledge.
    /// @dev Merchant payment credits the merchant's account escrow.
    function payInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        bytes32 payerAccount = walletToAccount[msg.sender];
        if (payerAccount == bytes32(0)) revert WalletNotLinked();
        if (accountVerificationBaseline[payerAccount] < MIN_TRANSACT_BASELINE) revert PayerNotVerified();

        RecurringPledge storage rp = recurringPledges[recurringId];
        if (rp.id == 0) revert PledgeMissing();
        if (payerAccount != rp.payerAccount) revert NotAuthorized();
        if (rp.status != RecurringStatus.ACTIVE) revert PledgeNotActive();
        if (rp.periodsCompleted + rp.missedCount >= rp.totalPeriods) revert AllPeriodsAccounted();
        if (block.timestamp > rp.nextDueDate + GRACE_PERIOD) revert GraceEnded();

        bool isLate = block.timestamp > rp.nextDueDate;
        uint256 gross = _grossWithFee(rp.amountPerPeriod, rp.appliedFeeBps);
        uint256 currentPeriod = rp.periodsCompleted + rp.missedCount + 1;

        if (rp.periodsCompleted == 0 && rp.missedCount == 0) {
            uint256 maxActive = getAccountMaxActivePledges(rp.payerAccount);
            if (accountActivePledgeCount[rp.payerAccount] >= maxActive) revert DepositLimitReached();
            accountActivePledgeCount[rp.payerAccount]++;
        }

        rp.periodsCompleted++;
        rp.nextDueDate += rp.intervalSeconds;

        Reputation storage rep = accountReputation[rp.payerAccount];
        // slither-disable-next-line divide-before-multiply
        uint256 halfAmount = rp.amountPerPeriod / 2;
        if (isLate) {
            rep.lateCount++;
            rep.weightedScore += halfAmount * WEIGHT_LATE;
        } else {
            rep.onTimeCount++;
            rep.weightedScore += halfAmount * WEIGHT_ON_TIME;
        }
        rep.totalWeight += halfAmount;

        uint256 fee = (rp.amountPerPeriod * rp.appliedFeeBps) / 10000;

        IERC20(rp.token).safeTransferFrom(msg.sender, address(this), gross);
        if (fee > 0) {
            IERC20(rp.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(recurringId, feeRecipient, fee);
        }
        accountBalances[rp.merchantAccount][rp.token] += rp.amountPerPeriod;
        emit FundsCredited(rp.merchantAccount, rp.token, rp.amountPerPeriod, "installment_paid");

        emit InstallmentPaid(recurringId, payerAccount, currentPeriod, rp.amountPerPeriod);

        if (rp.periodsCompleted + rp.missedCount == rp.totalPeriods) {
            _finalizeRecurring(recurringId);
        }
    }

    /// @notice Payer catches up on one missed installment mid-contract.
    function payMissedInstallment(uint256 recurringId) external nonReentrant whenNotPaused {
        bytes32 payerAccount = walletToAccount[msg.sender];
        if (payerAccount == bytes32(0)) revert WalletNotLinked();
        if (accountVerificationBaseline[payerAccount] < MIN_TRANSACT_BASELINE) revert PayerNotVerified();

        RecurringPledge storage rp = recurringPledges[recurringId];
        if (rp.id == 0) revert PledgeMissing();
        if (payerAccount != rp.payerAccount) revert NotAuthorized();
        if (rp.status != RecurringStatus.ACTIVE) revert PledgeNotActive();
        if (rp.missedCount == 0) revert NoMissedInstallments();

        uint256 gross = _grossWithFee(rp.amountPerPeriod, rp.appliedFeeBps);
        uint256 fee = (rp.amountPerPeriod * rp.appliedFeeBps) / 10000;
        // slither-disable-next-line divide-before-multiply
        uint256 halfAmount = rp.amountPerPeriod / 2;

        bool firstEngagement = (rp.periodsCompleted == 0);
        if (firstEngagement) {
            uint256 maxActive = getAccountMaxActivePledges(rp.payerAccount);
            if (accountActivePledgeCount[rp.payerAccount] >= maxActive) revert DepositLimitReached();
            accountActivePledgeCount[rp.payerAccount]++;
        }

        rp.missedCount--;
        rp.totalMissedDebt -= rp.amountPerPeriod;
        rp.periodsCompleted++;

        Reputation storage rep = accountReputation[rp.payerAccount];
        rep.lateCount++;
        rep.weightedScore += halfAmount * WEIGHT_LATE;
        if (firstEngagement) {
            rep.totalWeight += halfAmount;
        }

        IERC20(rp.token).safeTransferFrom(msg.sender, address(this), gross);
        if (fee > 0) {
            IERC20(rp.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(recurringId, feeRecipient, fee);
        }
        accountBalances[rp.merchantAccount][rp.token] += rp.amountPerPeriod;
        emit FundsCredited(rp.merchantAccount, rp.token, rp.amountPerPeriod, "missed_installment_paid");

        emit InstallmentPaid(recurringId, payerAccount, rp.periodsCompleted, rp.amountPerPeriod);
    }

    /// @notice Payer settles all outstanding missed installment debts to complete a recurring pledge.
    function settleDebt(uint256 recurringId) external nonReentrant whenNotPaused {
        bytes32 payerAccount = walletToAccount[msg.sender];
        if (payerAccount == bytes32(0)) revert WalletNotLinked();
        if (accountVerificationBaseline[payerAccount] < MIN_TRANSACT_BASELINE) revert PayerNotVerified();

        RecurringPledge storage rp = recurringPledges[recurringId];
        if (rp.id == 0) revert PledgeMissing();
        if (payerAccount != rp.payerAccount) revert NotAuthorized();
        if (rp.status != RecurringStatus.PENDING_SETTLEMENT) revert PledgeNotInSettlement();

        uint256 debt = rp.totalMissedDebt;
        if (debt == 0) revert NoOutstandingDebt();

        uint256 grossDebt = _grossWithFee(debt, rp.appliedFeeBps);
        uint256 fee = (debt * rp.appliedFeeBps) / 10000;

        rp.totalMissedDebt = 0;
        rp.status = RecurringStatus.COMPLETED;
        if (rp.periodsCompleted > 0) {
            _decrementActive(rp.payerAccount);
        }

        _applyCompletionBonus(rp.payerAccount, rp.amountPerPeriod, rp.totalPeriods);

        IERC20(rp.token).safeTransferFrom(msg.sender, address(this), grossDebt);
        if (fee > 0) {
            IERC20(rp.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(recurringId, feeRecipient, fee);
        }
        accountBalances[rp.merchantAccount][rp.token] += debt;
        emit FundsCredited(rp.merchantAccount, rp.token, debt, "debt_settled");

        emit DebtSettled(recurringId, payerAccount, debt);
        emit RecurringPledgeCompleted(recurringId, rp.merchantAccount);
    }

    /// @notice Payer cancels a recurring pledge with off-chain merchant signature.
    function cancelRecurring(
        uint256 recurringId,
        uint256 sigExpiry,
        bytes calldata merchantSig
    ) external nonReentrant whenNotPaused {
        RecurringPledge storage rp = recurringPledges[recurringId];
        bytes32 callerAccount = walletToAccount[msg.sender];

        if (rp.id == 0) revert PledgeMissing();
        if (callerAccount != rp.payerAccount) revert NotAuthorized();
        if (rp.status != RecurringStatus.ACTIVE && rp.status != RecurringStatus.PENDING_SETTLEMENT) revert PledgeNotCancellable();
        if (block.timestamp > sigExpiry) revert SignatureExpired();

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
        address signer = ECDSA.recover(ethHash, merchantSig);
        if (walletToAccount[signer] != rp.merchantAccount) revert InvalidSignature();

        recurringCancelNonces[recurringId]++;

        rp.status = RecurringStatus.CANCELLED;
        rp.totalMissedDebt = 0;
        if (rp.periodsCompleted > 0) {
            _decrementActive(rp.payerAccount);
        }

        emit RecurringPledgeCancelled(recurringId, rp.payerAccount, rp.merchantAccount);
    }

    // ── P2P (closed network — both parties must be linked) ─────────────────────

    /// @notice Send tokens instantly to another RemitSafe account's escrow balance.
    /// @dev Recipient must have a linked wallet on a RemitSafe account. Unregistered wallets
    ///      are rejected — RemitSafe operates as a closed network for P2P.
    function sendP2P(
        address token,
        address recipient,
        uint256 amount
    ) external nonReentrant whenNotPaused {
        bytes32 senderAccount = walletToAccount[msg.sender];
        if (senderAccount == bytes32(0)) revert WalletNotLinked();
        if (
            accountVerificationBaseline[senderAccount] < MIN_TRANSACT_BASELINE
                && !accountIsMerchantVerified[senderAccount]
        ) revert SenderNotVerified();
        if (!allowedTokens[token]) revert TokenNotSupported();
        if (recipient == address(0)) revert InvalidAddress();
        if (recipient == msg.sender) revert SelfTransferDisallowed();
        if (amount < MIN_PLEDGE_AMOUNT) revert AmountBelowMinimum();

        bytes32 recipientAccount = walletToAccount[recipient];
        if (recipientAccount == bytes32(0)) revert RecipientNotRegistered();
        if (recipientAccount == senderAccount) revert SelfTransferDisallowed();

        uint256 feeBps = getServiceFeeBps(senderAccount);
        uint256 gross = _grossWithFee(amount, feeBps);
        uint256 fee = gross - amount;

        IERC20(token).safeTransferFrom(msg.sender, address(this), gross);
        if (fee > 0) {
            IERC20(token).safeTransfer(feeRecipient, fee);
        }
        accountBalances[recipientAccount][token] += amount;
        emit FundsCredited(recipientAccount, token, amount, "p2p_received");

        emit P2PSent(msg.sender, recipient, senderAccount, recipientAccount, token, amount, fee);
    }

    // ── Internal ───────────────────────────────────────────────────────────────

    function _releaseFunds(uint256 pledgeId) internal {
        Pledge storage pledge = pledges[pledgeId];
        uint256 amount = pledge.totalAmount;

        pledge.status = PledgeStatus.COMPLETED;
        pledge.depositedAmount = 0;

        Reputation storage rep = accountReputation[pledge.payerAccount];
        if (pledge.paidDuringGrace) {
            rep.lateCount++;
            rep.weightedScore += amount * WEIGHT_LATE;
        } else {
            rep.onTimeCount++;
            rep.weightedScore += amount * WEIGHT_ON_TIME;
        }
        rep.totalWeight += amount;
        rep.totalCount++;
        _decrementActive(pledge.payerAccount);

        uint256 fee = (amount * pledge.appliedFeeBps) / 10000;

        if (fee > 0) {
            IERC20(pledge.token).safeTransfer(feeRecipient, fee);
            emit FeeCollected(pledgeId, feeRecipient, fee);
        }

        accountBalances[pledge.merchantAccount][pledge.token] += amount;
        emit FundsCredited(pledge.merchantAccount, pledge.token, amount, "pledge_completed");

        emit PledgeCompleted(pledgeId, pledge.merchantAccount, amount);
    }

    function _finalizeRecurring(uint256 recurringId) internal {
        RecurringPledge storage rp = recurringPledges[recurringId];

        if (rp.totalMissedDebt == 0) {
            rp.status = RecurringStatus.COMPLETED;
            if (rp.periodsCompleted > 0) {
                _decrementActive(rp.payerAccount);
            }
            _applyCompletionBonus(rp.payerAccount, rp.amountPerPeriod, rp.totalPeriods);
            accountReputation[rp.payerAccount].totalCount++;
            emit RecurringPledgeCompleted(recurringId, rp.merchantAccount);
        } else {
            rp.status = RecurringStatus.PENDING_SETTLEMENT;
            if (rp.periodsCompleted > 0) {
                Reputation storage rep = accountReputation[rp.payerAccount];
                rep.defaultCount++;
                rep.totalCount++;
            }
        }
    }

    function _applyCompletionBonus(
        bytes32 payerAccount,
        uint256 amountPerPeriod,
        uint256 totalPeriods
    ) internal {
        Reputation storage rep = accountReputation[payerAccount];
        // slither-disable-next-line divide-before-multiply
        uint256 bonusAmount = (amountPerPeriod * totalPeriods) / 2;
        rep.weightedScore += bonusAmount * WEIGHT_ON_TIME;
        rep.totalWeight += bonusAmount;
    }

    function _recordDefault(bytes32 payerAccount, uint256 amount) internal {
        Reputation storage rep = accountReputation[payerAccount];
        rep.defaultCount++;
        rep.totalWeight += amount;
        rep.totalCount++;
    }

    function _decrementActive(bytes32 accountId) internal {
        if (accountActivePledgeCount[accountId] > 0) {
            accountActivePledgeCount[accountId]--;
        }
    }

    function _grossWithFee(uint256 totalAmount, uint256 feeBps)
        internal
        pure
        returns (uint256)
    {
        return totalAmount + (totalAmount * feeBps) / 10000;
    }

    function _accountTrustScore(bytes32 accountId) internal view returns (uint256) {
        Reputation storage rep = accountReputation[accountId];
        uint256 baseline = accountVerificationBaseline[accountId];
        if (rep.totalWeight == 0) return baseline;
        uint256 behavioral = rep.weightedScore / rep.totalWeight;
        return behavioral > baseline ? behavioral : baseline;
    }

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

    // ── Admin Functions ────────────────────────────────────────────────────────

    function setTokenAllowed(address token, bool allowed) external onlyOwner {
        if (token == address(0)) revert InvalidAddress();
        allowedTokens[token] = allowed;
        emit TokenAllowanceSet(token, allowed);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function setFeeRecipient(address newRecipient) external onlyOwner {
        if (newRecipient == address(0)) revert InvalidAddress();
        emit FeeRecipientUpdated(feeRecipient, newRecipient);
        feeRecipient = newRecipient;
    }

    function setVerificationOperator(address newOp) external onlyOwner {
        emit VerificationOperatorChanged(verificationOperator, newOp);
        verificationOperator = newOp;
    }

    function setLinkOperator(address newOp) external onlyOwner {
        emit LinkOperatorChanged(linkOperator, newOp);
        linkOperator = newOp;
    }

    /// @notice Set or update an account's KYC baseline score (owner-only).
    /// @dev Used for KYC approval (0 → 5000), revocation (any → 0), or manual overrides.
    function setVerificationBaseline(bytes32 accountId, uint256 newScore) external onlyOwner {
        if (accountId == bytes32(0)) revert InvalidAccountId();
        if (newScore > MAX_BASELINE) revert BaselineExceedsMax();
        uint256 oldScore = accountVerificationBaseline[accountId];
        accountVerificationBaseline[accountId] = newScore;
        emit AccountVerificationBaselineChanged(accountId, oldScore, newScore);
    }

    /// @notice Operator-only narrow function: boost an account from BASELINE_KYC to
    ///         BASELINE_KYC_PLUS_AVATAR (typically on avatar upload).
    function boostVerificationBaseline(bytes32 accountId) external whenNotPaused {
        if (msg.sender != verificationOperator) revert OnlyOperator();
        if (accountId == bytes32(0)) revert InvalidAccountId();
        if (accountVerificationBaseline[accountId] != BASELINE_KYC) revert BaselineNotKyc();
        accountVerificationBaseline[accountId] = BASELINE_KYC_PLUS_AVATAR;
        emit AccountVerificationBaselineChanged(accountId, BASELINE_KYC, BASELINE_KYC_PLUS_AVATAR);
    }

    /// @notice Set merchant verification flag for an account (owner-only).
    function setMerchantVerified(bytes32 accountId, bool verified) external onlyOwner {
        if (accountId == bytes32(0)) revert InvalidAccountId();
        accountIsMerchantVerified[accountId] = verified;
        emit AccountMerchantVerificationChanged(accountId, verified);
    }

    // ── View Functions ─────────────────────────────────────────────────────────

    /// @notice Service fee rate (basis points) for a given account based on their trust score.
    function getServiceFeeBps(bytes32 accountId) public view returns (uint256 bps) {
        if (_accountTrustScore(accountId) >= TIER_HIGH) {
            return FEE_BPS_LOYALTY;
        }
        return FEE_BPS_STANDARD;
    }

    /// @notice Gross amount an account would need to deposit for a pledge of `totalAmount`.
    function quoteGrossAmount(bytes32 payerAccount, uint256 totalAmount)
        external
        view
        returns (uint256)
    {
        return _grossWithFee(totalAmount, getServiceFeeBps(payerAccount));
    }

    /// @notice Gross amount for an existing pledge, using its locked-in fee rate.
    function grossAmountForPledge(uint256 pledgeId) external view returns (uint256) {
        Pledge storage pledge = pledges[pledgeId];
        if (pledge.id == 0) revert PledgeMissing();
        return _grossWithFee(pledge.totalAmount, pledge.appliedFeeBps);
    }

    /// @notice Trust score for an account, 0–10000 (divide by 100 for percentage).
    function getAccountTrustScore(bytes32 accountId) external view returns (uint256) {
        return _accountTrustScore(accountId);
    }

    /// @notice Full reputation breakdown for an account.
    function getAccountReputation(bytes32 accountId)
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
        Reputation storage rep = accountReputation[accountId];
        return (
            _accountTrustScore(accountId),
            rep.onTimeCount,
            rep.lateCount,
            rep.defaultCount,
            rep.totalCount
        );
    }

    /// @notice All wallets linked to an account.
    function getAccountWallets(bytes32 accountId) external view returns (address[] memory) {
        return accountWallets[accountId];
    }

    /// @notice Account ID associated with a wallet (zero bytes32 if not linked).
    function getWalletAccount(address wallet) external view returns (bytes32) {
        return walletToAccount[wallet];
    }

    /// @notice Account-held escrow balance for a token.
    function getAccountBalance(bytes32 accountId, address token) external view returns (uint256) {
        return accountBalances[accountId][token];
    }

    /// @notice Daily withdrawal cap for a wallet/token.
    /// @dev Returns DEFAULT_DAILY_CAP if unconfigured. If configured, returns the stored value
    ///      (which may be 0 = disabled or type(uint256).max = unlimited).
    function getDailyCap(address wallet, address token) external view returns (uint256) {
        if (!walletCapConfigured[wallet][token]) return DEFAULT_DAILY_CAP;
        return walletDailyCap[wallet][token];
    }

    /// @notice Amount already withdrawn today (rolling daily window).
    function getDailyUsed(address wallet, address token) external view returns (uint256) {
        uint256 dayIndex = block.timestamp / 1 days;
        return dailyWithdrawnAmount[wallet][token][dayIndex];
    }

    /// @notice Pending withdrawal record.
    /// @dev Reverts on non-existent IDs (id == 0 or id > pendingWithdrawalCounter).
    function getPendingWithdrawal(uint256 id) external view returns (PendingWithdrawal memory) {
        if (id == 0 || id > pendingWithdrawalCounter) revert PledgeMissing();
        return pendingWithdrawals[id];
    }

    /// @notice Full pledge details.
    function getPledge(uint256 pledgeId) external view returns (Pledge memory) {
        if (pledges[pledgeId].id == 0) revert PledgeMissing();
        return pledges[pledgeId];
    }

    /// @notice Full recurring pledge details.
    function getRecurringPledge(uint256 recurringId) external view returns (RecurringPledge memory) {
        if (recurringPledges[recurringId].id == 0) revert PledgeMissing();
        return recurringPledges[recurringId];
    }

    /// @notice All pledge IDs where the given account is the payer.
    function getAccountPayerPledges(bytes32 accountId) external view returns (uint256[] memory) {
        return accountPayerPledgeIds[accountId];
    }

    /// @notice All pledge IDs created by the given account as merchant.
    function getAccountMerchantPledges(bytes32 accountId) external view returns (uint256[] memory) {
        return accountMerchantPledgeIds[accountId];
    }

    function getAccountPayerPledgesPaginated(bytes32 accountId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(accountPayerPledgeIds[accountId], offset, limit);
    }

    function getAccountMerchantPledgesPaginated(bytes32 accountId, uint256 offset, uint256 limit)
        external
        view
        returns (uint256[] memory page, uint256 total)
    {
        return _paginate(accountMerchantPledgeIds[accountId], offset, limit);
    }

    function getAccountPayerRecurringPledges(bytes32 accountId) external view returns (uint256[] memory) {
        return accountPayerRecurringIds[accountId];
    }

    function getAccountMerchantRecurringPledges(bytes32 accountId) external view returns (uint256[] memory) {
        return accountMerchantRecurringIds[accountId];
    }

    function getAccountPayerRecurringPledgesPaginated(
        bytes32 accountId,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory page, uint256 total) {
        return _paginate(accountPayerRecurringIds[accountId], offset, limit);
    }

    function getAccountMerchantRecurringPledgesPaginated(
        bytes32 accountId,
        uint256 offset,
        uint256 limit
    ) external view returns (uint256[] memory page, uint256 total) {
        return _paginate(accountMerchantRecurringIds[accountId], offset, limit);
    }

    /// @notice Max concurrent active pledges allowed for an account.
    /// @dev Serial defaulters (defaultCount ≥ DEFAULT_LOCKOUT_THRESHOLD) are capped at the
    ///      no-history limit regardless of any on-time history they may also have.
    function getAccountMaxActivePledges(bytes32 accountId) public view returns (uint256) {
        Reputation storage rep = accountReputation[accountId];

        if (rep.defaultCount >= DEFAULT_LOCKOUT_THRESHOLD) {
            return MAX_ACTIVE_NO_HISTORY;
        }

        uint256 score = _accountTrustScore(accountId);
        if (score >= TIER_HIGH) return MAX_ACTIVE_HIGH;
        if (score >= TIER_MID)  return MAX_ACTIVE_MID;
        return MAX_ACTIVE_NO_HISTORY;
    }

    /// @notice Required upfront deposit percentage for an account, based on their trust score.
    function getAccountRequiredDepositPct(bytes32 accountId) public view returns (uint256) {
        uint256 score = _accountTrustScore(accountId);
        if (score >= TIER_HIGH) return DEPOSIT_TIER_HIGH;
        if (score >= TIER_MID)  return DEPOSIT_TIER_MID;
        if (score >= TIER_LOW)  return DEPOSIT_TIER_LOW;
        return DEPOSIT_TIER_RISK;
    }
}

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
/// @notice Lets a sender lock a partial USDC deposit and commit to a future payment date.
///         Merchants can trust the on-chain pledge like cash. On default, the merchant
///         claims the locked deposit. Reputation is tracked on-chain across resolved pledges.
/// @dev Assumes a standard, non-rebasing, non-fee-on-transfer ERC20 (USDC). Pledge IDs
///      start at 1 (pre-increment of pledgeCounter), so id == 0 always means "nonexistent".
contract RemittancePledge is ReentrancyGuard, Pausable, Ownable2Step {
    using ECDSA for bytes32;
    using SafeERC20 for IERC20;

    // ── Constants ──────────────────────────────────────────────────────────────
    uint256 public constant GRACE_PERIOD   = 3 days;
    uint256 public constant MAX_PLEDGE_DAYS = 90 days;
    uint256 public constant MAX_EXTENSION  = 30 days;

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

    // Protocol fee: 1% of completed pledge amount (basis points, out of 10000)
    // Protocol fee tiers (basis points, out of 10000) — REWARD-ONLY model.
    // Everyone pays the standard rate; high-trust senders earn a loyalty discount.
    // No sender ever pays MORE than the standard rate — there is no penalty tier.
    uint256 public constant FEE_BPS_STANDARD = 100; // 1%   — new and mid-trust senders
    uint256 public constant FEE_BPS_LOYALTY  = 75;  // 0.75% — high-trust senders (80%+ score)

    /// @dev 1 USDC (6 decimals) — prevents dust-pledge reputation washing.
    uint256 public constant MIN_PLEDGE_AMOUNT = 1_000_000;

    // ── Types ──────────────────────────────────────────────────────────────────
    enum PledgeStatus { PENDING, COMPLETED, DEFAULTED, CANCELLED }

    struct Pledge {
        uint256 id;
        address sender;
        address merchant;
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
    IERC20  public immutable usdc;
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

    // ── Events ─────────────────────────────────────────────────────────────────
    event PledgeCreated(
        uint256 indexed pledgeId,
        address indexed sender,
        address indexed merchant,
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

    // ── Constructor ────────────────────────────────────────────────────────────
    /// @param _usdcToken Address of the USDC token contract (MockUSDC on testnet)
    /// @param _feeRecipient Address that receives the protocol fee on completed pledges
    constructor(address _usdcToken, address _feeRecipient) Ownable(msg.sender) {
        require(_usdcToken != address(0), "Invalid USDC address");
        require(_feeRecipient != address(0), "Invalid fee recipient");
        usdc = IERC20(_usdcToken);
        feeRecipient = _feeRecipient;
    }

    // ── Write Functions ────────────────────────────────────────────────────────

    /// @notice Create a new payment pledge with an initial USDC deposit.
    /// @param merchant Address of the merchant who will receive payment
    /// @param totalAmount Net USDC the merchant receives (6 decimals)
    /// @param initialDeposit Initial gross deposit — minimum depends on sender trust score
    /// @param commitmentDate Unix timestamp of the payment deadline (max 90 days out)
    function createPledge(
        address merchant,
        uint256 totalAmount,
        uint256 initialDeposit,
        uint256 commitmentDate
    ) external nonReentrant whenNotPaused {
        require(merchant != address(0), "Invalid merchant address");
        require(merchant != msg.sender, "Sender cannot be merchant");
        require(totalAmount >= MIN_PLEDGE_AMOUNT, "Amount below 1 USDC minimum");
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
        usdc.safeTransferFrom(msg.sender, address(this), initialDeposit);

        emit PledgeCreated(pledgeId, msg.sender, merchant, totalAmount, initialDeposit, commitmentDate, feeBps);

        // If the initial deposit already covers the gross amount, release immediately.
        if (initialDeposit >= gross) {
            _releaseFunds(pledgeId);
        }
    }

    /// @notice Deposit the exact remaining balance toward a pledge (all-or-nothing).
    /// @dev Enforces depositedAmount + amount == gross — partial top-ups are rejected to
    ///      prevent stranded funds (no path where a pledge sits half-funded after grace).
    /// @param pledgeId ID of the pledge to top up
    /// @param amount Amount of USDC to deposit — must equal the exact remaining balance
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
        usdc.safeTransferFrom(msg.sender, address(this), amount);

        emit DepositMade(pledgeId, msg.sender, amount, pledge.depositedAmount);

        // depositedAmount now equals gross — release.
        _releaseFunds(pledgeId);
    }

    /// @notice Merchant claims the full locked deposit after a pledge default.
    /// @dev Claims the entire depositedAmount (not a partial slice). Callable only after the
    ///      grace period and within CLAIM_WINDOW. The TIME_BUFFER absorbs validator timestamp
    ///      drift. After the claim window closes, the sender may recover the funds via
    ///      reclaimDeposit() — there is no period where funds are frozen.
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
        usdc.safeTransfer(pledge.merchant, claimAmount);

        emit PledgeDefaulted(pledgeId, pledge.merchant, claimAmount);
    }

    /// @notice Sender reclaims the deposit once the merchant's claim window has closed.
    /// @dev Becomes available immediately after CLAIM_WINDOW expires (plus TIME_BUFFER) — there
    ///      is no dead zone where funds are frozen. The default is still recorded against the
    ///      sender, so reclaiming is not a way to escape the reputation penalty. Emits both
    ///      PledgeDefaulted (amount 0 — merchant claimed nothing) and DepositReclaimed so
    ///      off-chain indexers counting defaults stay consistent.
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
        usdc.safeTransfer(pledge.sender, amount);

        // PledgeDefaulted with amount 0 — the merchant claimed nothing. DepositReclaimed
        // carries the amount actually returned to the sender.
        emit PledgeDefaulted(pledgeId, pledge.merchant, 0);
        emit DepositReclaimed(pledgeId, pledge.sender, amount);
    }

    /// @notice Extend a pledge deadline with the merchant's off-chain signature approval.
    /// @dev The signed hash includes chainId, contract address, a per-pledge nonce and an
    ///      expiry — preventing cross-chain replay, cross-contract replay and signature reuse.
    /// @param pledgeId ID of the pledge to extend
    /// @param newDate New commitment date (max 30 days past the current deadline)
    /// @param sigExpiry Timestamp after which the merchant signature is no longer valid
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
    /// @param pledgeId ID of the pledge to cancel
    /// @param sigExpiry Timestamp after which the merchant signature is no longer valid
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
        usdc.safeTransfer(pledge.sender, refund);

        emit PledgeCancelled(pledgeId, pledge.sender, pledge.merchant, refund);
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
            usdc.safeTransfer(feeRecipient, fee);
            emit FeeCollected(pledgeId, feeRecipient, fee);
        }
        usdc.safeTransfer(pledge.merchant, amount);

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

    /// @dev Gross amount (net + fee) for a given fee rate. Used internally so that
    ///      creation and top-up always agree on the same locked-in rate.
    function _grossWithFee(uint256 totalAmount, uint256 feeBps)
        internal
        pure
        returns (uint256)
    {
        return totalAmount + (totalAmount * feeBps) / 10000;
    }

    /// @notice Gross amount a given sender would deposit for a pledge of `totalAmount`,
    ///         using their current trust-tier fee rate. For frontends/quotes.
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

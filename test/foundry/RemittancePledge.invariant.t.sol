// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../contracts/RemittancePledge.sol";
import "../../contracts/MockTokens.sol";

/// @notice Handler exposes the actions the fuzzer can call in any order/combination.
///         Only actions that don't require off-chain signatures are included here —
///         those are covered by the unit tests.
contract PledgeHandler is Test {
    RemittancePledge public pledge;
    MockUSDC         public usdc;

    address public payer    = address(0xA11CE);
    address public merchant = address(0xB0B);
    address public feeRecip;

    bytes32 public constant PAYER_ACCT    = keccak256("payer");
    bytes32 public constant MERCHANT_ACCT = keccak256("merchant");

    // Physical token flow through the contract (escrow funds remain inside it).
    uint256 public ghost_in;    // tokens transferred INTO the contract
    uint256 public ghost_out;   // tokens transferred OUT of the contract (fees, refunds)

    constructor(RemittancePledge _pledge, MockUSDC _usdc, address _feeRecip) {
        pledge  = _pledge;
        usdc    = _usdc;
        feeRecip = _feeRecip;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    function createAndCompletePledge(uint256 amount) external {
        amount = bound(amount, 1_000_000, 1_000_000_000_000);
        uint256 gross = pledge.quoteGrossAmount(PAYER_ACCT, amount);

        vm.prank(merchant);
        try pledge.createPledge(address(usdc), PAYER_ACCT, amount, block.timestamp + 1 days) {
            uint256 pledgeId = pledge.pledgeCounter();

            deal(address(usdc), payer, gross);
            vm.prank(payer);
            usdc.approve(address(pledge), gross);

            vm.prank(payer);
            try pledge.submitDeposit(pledgeId, gross) {
                ghost_in  += gross;
                ghost_out += (gross - amount); // fee leaves on completion; net stays as escrow
            } catch {}
        } catch {}
    }

    function createAndTopUpPledge(uint256 amount, uint256 depositPct) external {
        amount     = bound(amount, 1_000_000, 500_000_000_000);
        depositPct = bound(depositPct, 30, 99); // KYC payer (MID tier) needs >= 30%

        uint256 gross     = pledge.quoteGrossAmount(PAYER_ACCT, amount);
        uint256 deposit   = (gross * depositPct) / 100;
        uint256 remaining = gross - deposit;
        if (deposit == 0 || remaining == 0) return;

        vm.prank(merchant);
        try pledge.createPledge(address(usdc), PAYER_ACCT, amount, block.timestamp + 7 days) {
            uint256 pledgeId = pledge.pledgeCounter();

            deal(address(usdc), payer, gross);
            vm.prank(payer);
            usdc.approve(address(pledge), gross);

            vm.prank(payer);
            try pledge.submitDeposit(pledgeId, deposit) {
                ghost_in += deposit;

                vm.prank(payer);
                try pledge.submitDeposit(pledgeId, remaining) {
                    ghost_in  += remaining;
                    ghost_out += (gross - amount); // fee leaves on completion
                } catch {}
            } catch {}
        } catch {}
    }

    function claimDefault(uint256 pledgeId) external {
        pledgeId = bound(pledgeId, 1, pledge.pledgeCounter());
        if (pledgeId == 0) return;
        RemittancePledge.Pledge memory p = pledge.getPledge(pledgeId);

        if (p.status != RemittancePledge.PledgeStatus.PENDING) return;
        if (p.depositedAmount == 0) return;

        uint256 claimableAt = p.commitmentDate
            + pledge.GRACE_PERIOD()
            + pledge.TIME_BUFFER()
            + 1;

        vm.warp(claimableAt);

        // Defaulted deposit is credited to merchant escrow — it stays in the contract,
        // so no physical outflow is recorded.
        vm.prank(merchant);
        try pledge.claimDefaultedDeposit(pledgeId) {} catch {}
    }
}

contract RemittancePledgeInvariantTest is Test {
    RemittancePledge internal pledgeContract;
    MockUSDC         internal usdc;
    PledgeHandler    internal handler;

    uint256 internal constant OP_PK = 0xA11CE;
    address internal feeRecip = address(0xFEE);

    bytes32 internal constant PAYER_ACCT    = keccak256("payer");
    bytes32 internal constant MERCHANT_ACCT = keccak256("merchant");

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        address linkOp = vm.addr(OP_PK);
        pledgeContract = new RemittancePledge(tokens, feeRecip, linkOp, linkOp);

        pledgeContract.setVerificationBaseline(PAYER_ACCT, 5000);
        pledgeContract.setMerchantVerified(MERCHANT_ACCT, true);

        _link(address(0xA11CE), PAYER_ACCT);
        _link(address(0xB0B), MERCHANT_ACCT);

        handler = new PledgeHandler(pledgeContract, usdc, feeRecip);
        targetContract(address(handler));
    }

    function _link(address wallet, bytes32 acct) internal {
        uint256 sigExpiry = block.timestamp + 30 minutes;
        uint256 nonce = pledgeContract.linkNonces(acct);
        bytes32 msgHash = keccak256(
            abi.encodePacked(block.chainid, address(pledgeContract), "link", acct, wallet, sigExpiry, nonce)
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OP_PK, ethHash);
        vm.prank(wallet);
        pledgeContract.linkWallet(acct, sigExpiry, abi.encodePacked(r, s, v));
    }

    // ── Invariant 1 ───────────────────────────────────────────────────────────
    // The contract's live token balance must equal total flowed in minus total flowed out.
    // Escrow balances are accounting entries — the underlying tokens remain in the contract.
    function invariant_contractBalanceMatchesFlow() public view {
        uint256 contractBal = usdc.balanceOf(address(pledgeContract));
        uint256 expected    = handler.ghost_in() - handler.ghost_out();
        assertEq(contractBal, expected, "contract balance != in - out");
    }

    // ── Invariant 2 ───────────────────────────────────────────────────────────
    // The contract never holds more tokens than what was deposited into it.
    function invariant_noUnaccountedBalance() public view {
        uint256 contractBal = usdc.balanceOf(address(pledgeContract));
        assertLe(contractBal, handler.ghost_in(), "contract holds more than flowed in");
    }

    // ── Invariant 3 ───────────────────────────────────────────────────────────
    // Pledge IDs are strictly sequential starting at 1.
    function invariant_pledgeIdsAreSequential() public view {
        uint256 counter = pledgeContract.pledgeCounter();
        for (uint256 i = 1; i <= counter; i++) {
            RemittancePledge.Pledge memory p = pledgeContract.getPledge(i);
            assertEq(p.id, i, "pledge id mismatch");
        }
    }

    // ── Invariant 4 ───────────────────────────────────────────────────────────
    // A PENDING pledge's depositedAmount must never exceed its gross amount.
    function invariant_depositNeverExceedsGross() public view {
        uint256 counter = pledgeContract.pledgeCounter();
        for (uint256 i = 1; i <= counter; i++) {
            RemittancePledge.Pledge memory p = pledgeContract.getPledge(i);
            if (p.status == RemittancePledge.PledgeStatus.PENDING) {
                uint256 gross = pledgeContract.grossAmountForPledge(i);
                assertLe(p.depositedAmount, gross, "depositedAmount > gross");
            }
        }
    }

    // ── Invariant 5 ───────────────────────────────────────────────────────────
    // A COMPLETED pledge must have depositedAmount == 0 (funds were fully released).
    function invariant_completedPledgeHasZeroDeposit() public view {
        uint256 counter = pledgeContract.pledgeCounter();
        for (uint256 i = 1; i <= counter; i++) {
            RemittancePledge.Pledge memory p = pledgeContract.getPledge(i);
            if (p.status == RemittancePledge.PledgeStatus.COMPLETED) {
                assertEq(p.depositedAmount, 0, "completed pledge still holds funds");
            }
        }
    }
}

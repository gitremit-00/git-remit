// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
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

    uint256 public ghost_totalDeposited;   // tracks every token sent into the contract
    uint256 public ghost_totalReleased;    // tracks every token sent out of the contract

    constructor(RemittancePledge _pledge, MockUSDC _usdc, address _feeRecip) {
        pledge  = _pledge;
        usdc    = _usdc;
        feeRecip = _feeRecip;
    }

    // ── Actions ────────────────────────────────────────────────────────────────

    function createAndCompletePledge(uint256 amount) external {
        amount = bound(amount, 1_000_000, 1_000_000_000_000);
        uint256 gross = pledge.quoteGrossAmount(payer, amount);

        // Merchant creates the pledge
        vm.prank(merchant);
        pledge.createPledge(address(usdc), payer, amount, block.timestamp + 1 days);

        uint256 pledgeId = pledge.pledgeCounter();

        // Payer submits the full gross amount in one shot
        deal(address(usdc), payer, gross);
        vm.prank(payer);
        usdc.approve(address(pledge), gross);

        vm.prank(payer);
        try pledge.submitDeposit(pledgeId, gross) {
            ghost_totalDeposited += gross;
            ghost_totalReleased  += gross;
        } catch {}
    }

    function createAndTopUpPledge(uint256 amount, uint256 depositPct) external {
        amount     = bound(amount, 1_000_000, 500_000_000_000);
        depositPct = bound(depositPct, 20, 99);

        uint256 gross     = pledge.quoteGrossAmount(payer, amount);
        uint256 deposit   = (gross * depositPct) / 100;
        uint256 remaining = gross - deposit;
        if (deposit == 0 || remaining == 0) return;

        // Merchant creates the pledge
        vm.prank(merchant);
        try pledge.createPledge(
            address(usdc),
            payer,
            amount,
            block.timestamp + 7 days
        ) {
            uint256 pledgeId = pledge.pledgeCounter();

            deal(address(usdc), payer, gross);
            vm.prank(payer);
            usdc.approve(address(pledge), gross);

            vm.prank(payer);
            try pledge.submitDeposit(pledgeId, deposit) {
                ghost_totalDeposited += deposit;

                vm.prank(payer);
                try pledge.submitDeposit(pledgeId, remaining) {
                    ghost_totalDeposited += remaining;
                    ghost_totalReleased  += gross;
                } catch {}
            } catch {}
        } catch {}
    }

    function claimDefault(uint256 pledgeId) external {
        pledgeId = bound(pledgeId, 1, pledge.pledgeCounter());
        RemittancePledge.Pledge memory p = pledge.getPledge(pledgeId);

        if (p.status != RemittancePledge.PledgeStatus.PENDING) return;
        if (p.depositedAmount == 0) return;

        uint256 claimableAt = p.commitmentDate
            + pledge.GRACE_PERIOD()
            + pledge.TIME_BUFFER()
            + 1;

        vm.warp(claimableAt);

        vm.prank(merchant);
        try pledge.claimDefaultedDeposit(pledgeId) {
            ghost_totalReleased += p.depositedAmount;
        } catch {}
    }
}

contract RemittancePledgeInvariantTest is Test {
    RemittancePledge internal pledgeContract;
    MockUSDC         internal usdc;
    PledgeHandler    internal handler;

    address internal feeRecip = address(0xFEE);

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        pledgeContract = new RemittancePledge(tokens, feeRecip);

        handler = new PledgeHandler(pledgeContract, usdc, feeRecip);

        targetContract(address(handler));
    }

    // ── Invariant 1 ───────────────────────────────────────────────────────────
    // The contract's live token balance must equal total deposited minus total released.
    // If this breaks, tokens are either leaking out or being double-counted.
    function invariant_contractBalanceMatchesFlow() public view {
        uint256 contractBal = usdc.balanceOf(address(pledgeContract));
        uint256 expected    = handler.ghost_totalDeposited() - handler.ghost_totalReleased();
        assertEq(contractBal, expected, "contract balance != deposited - released");
    }

    // ── Invariant 2 ───────────────────────────────────────────────────────────
    // The contract never holds more tokens than what was deposited into it.
    // Guards against minting bugs or unexpected token inflows inflating the balance.
    function invariant_noUnaccountedBalance() public view {
        uint256 contractBal = usdc.balanceOf(address(pledgeContract));
        assertLe(contractBal, handler.ghost_totalDeposited(), "contract holds more than deposited");
    }

    // ── Invariant 3 ───────────────────────────────────────────────────────────
    // Pledge IDs are strictly sequential starting at 1.
    // Verifies the counter increments correctly and no ID is skipped or reused.
    function invariant_pledgeIdsAreSequential() public view {
        uint256 counter = pledgeContract.pledgeCounter();
        for (uint256 i = 1; i <= counter; i++) {
            RemittancePledge.Pledge memory p = pledgeContract.getPledge(i);
            assertEq(p.id, i, "pledge id mismatch");
        }
    }

    // ── Invariant 4 ───────────────────────────────────────────────────────────
    // A PENDING pledge's depositedAmount must never exceed its gross amount.
    // Prevents overfunded pledges from being created or topped up beyond the cap.
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
    // Verifies _releaseFunds always zeroes out the deposit on completion.
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

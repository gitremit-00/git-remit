// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../contracts/RemittancePledge.sol";
import "../contracts/MockTokens.sol";

contract RemittancePledgeFuzzTest is Test {
    RemittancePledge internal pledge;
    MockUSDC internal usdc;

    address internal sender   = address(0xA11CE);
    address internal merchant = address(0xB0B);
    address internal feeRecip = address(0xFEE);

    uint256 internal constant MIN_PLEDGE = 1_000_000;
    uint256 internal constant MAX_PLEDGE = 1_000_000_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        pledge = new RemittancePledge(tokens, feeRecip);
    }

    function testFuzz_grossNeverBelowNet(uint256 totalAmount) public view {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        uint256 gross = pledge.quoteGrossAmount(sender, totalAmount);
        assertGe(gross, totalAmount, "gross must be >= net");
        uint256 fee = gross - totalAmount;
        assertEq(fee, (totalAmount * 100) / 10000, "fee must equal exactly 1%");
    }

    function testFuzz_grossNoOverflow(uint256 totalAmount) public view {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        uint256 gross = pledge.quoteGrossAmount(sender, totalAmount);
        assertGt(gross, 0);
    }

    function testFuzz_escrowBalanceMatchesDeposit(uint256 totalAmount, uint256 depositPct) public {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        depositPct  = bound(depositPct, 20, 100);
        uint256 gross   = pledge.quoteGrossAmount(sender, totalAmount);
        uint256 deposit = (gross * depositPct) / 100;
        if (deposit == 0) return;
        deal(address(usdc), sender, gross);
        vm.prank(sender);
        usdc.approve(address(pledge), deposit);
        vm.prank(sender);
        pledge.createPledge(address(usdc), merchant, totalAmount, deposit, block.timestamp + 30 days);
        uint256 contractBal = usdc.balanceOf(address(pledge));
        if (deposit >= gross) {
            assertEq(contractBal, 0, "completed pledge should leave 0 in contract");
        } else {
            assertEq(contractBal, deposit, "escrow must equal deposit");
        }
    }

    function testFuzz_completionConservesMoney(uint256 totalAmount) public {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        uint256 gross   = pledge.quoteGrossAmount(sender, totalAmount);
        uint256 deposit = (gross * 40) / 100;
        deal(address(usdc), sender, gross);
        vm.prank(sender);
        usdc.approve(address(pledge), gross);
        vm.prank(sender);
        pledge.createPledge(address(usdc), merchant, totalAmount, deposit, block.timestamp + 30 days);
        uint256 remaining = gross - deposit;
        vm.prank(sender);
        pledge.depositRemaining(1, remaining);
        uint256 merchantBal = usdc.balanceOf(merchant);
        uint256 feeBal      = usdc.balanceOf(feeRecip);
        assertEq(merchantBal, totalAmount,           "merchant receives net amount");
        assertEq(merchantBal + feeBal, gross,        "merchant + fee == gross");
        assertEq(usdc.balanceOf(address(pledge)), 0, "contract empties on completion");
    }

    function testFuzz_feeBpsAlwaysValidTier(address anyWallet) public view {
        uint256 bps = pledge.getServiceFeeBps(anyWallet);
        assertTrue(bps == 75 || bps == 100, "fee must be a valid tier");
    }

    function testFuzz_depositPctAlwaysValidTier(address anyWallet) public view {
        uint256 pct = pledge.getRequiredDepositPct(anyWallet);
        assertTrue(pct == 20 || pct == 30 || pct == 40 || pct == 50, "deposit pct must be a valid tier");
    }
}

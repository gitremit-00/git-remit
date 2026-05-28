// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../../contracts/RemittancePledge.sol";
import "../../contracts/MockTokens.sol";

/// @notice Fork tests — run against the live Morph testnet deployment.
///         These verify the deployed contract is configured correctly and
///         that core flows work on the actual network.
///
/// Run with:
///   forge test --match-path test/foundry/RemittancePledge.fork.t.sol \
///     --fork-url https://rpc-quicknode-holesky.morphl2.io -v
contract RemittancePledgeForkTest is Test {
    // ── Deployed addresses on Morph Holesky testnet ────────────────────────
    address constant PLEDGE_ADDR = 0xd44280f56e1b8571f6b52D57Bc41bABD5c1e961A;
    address constant USDC_ADDR   = 0xe3bC47ef2353391dE4BC9691A358e99F3e2a06CE;
    address constant USDT_ADDR   = 0xe7E4CdAED4a034380904c5DA5A26890015358bE5;

    RemittancePledge internal pledge;
    MockUSDC         internal usdc;
    MockUSDT         internal usdt;

    // payer = the OFW who fulfills pledges; merchant = creates the pledge
    address internal payer    = address(0xA11CE);
    address internal merchant = address(0xB0B);

    function setUp() public {
        pledge = RemittancePledge(PLEDGE_ADDR);
        usdc   = MockUSDC(USDC_ADDR);
        usdt   = MockUSDT(USDT_ADDR);
    }

    // ── Deployment checks ──────────────────────────────────────────────────

    // Verify the contract is live and USDC is whitelisted
    function test_fork_usdcIsWhitelisted() public view {
        assertTrue(pledge.allowedTokens(USDC_ADDR), "USDC not whitelisted");
    }

    // Verify USDT was added via setTokenAllowed
    function test_fork_usdtIsWhitelisted() public view {
        assertTrue(pledge.allowedTokens(USDT_ADDR), "USDT not whitelisted");
    }

    // Verify fee recipient is set (non-zero)
    function test_fork_feeRecipientIsSet() public view {
        assertNotEq(pledge.feeRecipient(), address(0), "fee recipient not set");
    }

    // Verify pledge counter starts at 0 (no pledges yet)
    function test_fork_pledgeCounterStartsAtZero() public view {
        assertEq(pledge.pledgeCounter(), 0, "pledge counter should be 0 on fresh deploy");
    }

    // ── USDC token checks ──────────────────────────────────────────────────

    // Verify MockUSDC has 6 decimals
    function test_fork_usdcDecimals() public view {
        assertEq(usdc.decimals(), 6, "USDC should have 6 decimals");
    }

    // Verify MockUSDT has 6 decimals
    function test_fork_usdtDecimals() public view {
        assertEq(usdt.decimals(), 6, "USDT should have 6 decimals");
    }

    // ── Live flow: create and complete a pledge using USDC ─────────────────

    function test_fork_createAndCompletePledgeUSDC() public {
        uint256 amount = 10_000_000; // 10 USDC
        uint256 gross  = pledge.quoteGrossAmount(payer, amount);

        // Merchant creates the pledge targeting the payer
        vm.prank(merchant);
        pledge.createPledge(
            USDC_ADDR,
            payer,
            amount,
            block.timestamp + 1 days
        );

        assertEq(pledge.pledgeCounter(), 1, "pledge counter should be 1");

        // Use faucet to fund the payer on the live network
        usdc.faucet(payer, gross);

        vm.prank(payer);
        usdc.approve(PLEDGE_ADDR, gross);

        // Payer submits the full gross amount to complete the pledge
        vm.prank(payer);
        pledge.submitDeposit(1, gross);

        assertEq(usdc.balanceOf(merchant), amount, "merchant should have received funds");
        assertEq(usdc.balanceOf(PLEDGE_ADDR), 0,   "contract should be empty after completion");
    }

    // ── Live flow: create and complete a pledge using USDT ─────────────────

    function test_fork_createAndCompletePledgeUSDT() public {
        uint256 amount = 10_000_000; // 10 USDT
        uint256 gross  = pledge.quoteGrossAmount(payer, amount);

        // Merchant creates the pledge targeting the payer
        vm.prank(merchant);
        pledge.createPledge(
            USDT_ADDR,
            payer,
            amount,
            block.timestamp + 1 days
        );

        usdt.faucet(payer, gross);

        vm.prank(payer);
        usdt.approve(PLEDGE_ADDR, gross);

        vm.prank(payer);
        pledge.submitDeposit(1, gross);

        assertEq(usdt.balanceOf(merchant), amount, "merchant should have received USDT");
        assertEq(usdt.balanceOf(PLEDGE_ADDR), 0,   "contract should be empty after completion");
    }

    // ── Live flow: fee is correctly deducted ───────────────────────────────

    function test_fork_feeIsDeducted() public {
        uint256 amount   = 10_000_000; // 10 USDC
        uint256 gross    = pledge.quoteGrossAmount(payer, amount);
        uint256 expected = gross - amount; // expected fee

        address feeRecip  = pledge.feeRecipient();
        uint256 feeBefore = usdc.balanceOf(feeRecip);

        // Merchant creates the pledge
        vm.prank(merchant);
        pledge.createPledge(
            USDC_ADDR,
            payer,
            amount,
            block.timestamp + 1 days
        );

        usdc.faucet(payer, gross);

        vm.prank(payer);
        usdc.approve(PLEDGE_ADDR, gross);

        vm.prank(payer);
        pledge.submitDeposit(1, gross);

        uint256 feeAfter = usdc.balanceOf(feeRecip);
        assertEq(feeAfter - feeBefore, expected, "fee not correctly collected");
    }
}

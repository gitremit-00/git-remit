// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../contracts/RemittancePledge.sol";
import "../../contracts/MockTokens.sol";

/// @notice Fork tests — run against the live Morph testnet token deployments.
///
/// The v2 RemittancePledge is account-keyed: every wallet must be linked to an account
/// via an operator-co-signed `linkWallet` call before it can transact. The production
/// link-operator key is not available to the test runner, so these tests deploy a fresh
/// RemittancePledge (with a test-controlled operator) ON the fork and exercise the v2
/// flows against the REAL forked MockUSDC / MockUSDT token contracts.
///
/// Update USDC_ADDR / USDT_ADDR to match the current Morph deployment before running.
///
/// Run with:
///   forge test --match-path test/foundry/RemittancePledge.fork.t.sol \
///     --fork-url https://rpc-quicknode-holesky.morphl2.io -v
contract RemittancePledgeForkTest is Test {
    // ── Deployed token addresses on Morph Holesky testnet ──────────────────────
    address constant USDC_ADDR = 0x165186FCF4b2c145bEA0073ef3cb1f2b1F3837da;
    address constant USDT_ADDR = 0xb49a61765a05fE938491507e3A02873ACD4cD8dc;

    RemittancePledge internal pledge;
    MockUSDC         internal usdc;
    MockUSDT         internal usdt;

    uint256 internal constant OP_PK = 0xA11CE;
    address internal linkOp;
    address internal feeRecip = address(0xFEE);

    // payer = the OFW who fulfils pledges; merchant = creates the pledge
    address internal payer    = address(0xA11CE);
    address internal merchant = address(0xB0B);

    bytes32 internal constant PAYER_ACCT    = keccak256("payer");
    bytes32 internal constant MERCHANT_ACCT = keccak256("merchant");

    function setUp() public {
        usdc = MockUSDC(USDC_ADDR);
        usdt = MockUSDT(USDT_ADDR);

        linkOp = vm.addr(OP_PK);
        address[] memory tokens = new address[](2);
        tokens[0] = USDC_ADDR;
        tokens[1] = USDT_ADDR;
        // Fresh deploy on the fork; test contract is the owner.
        pledge = new RemittancePledge(tokens, feeRecip, linkOp, linkOp);

        pledge.setVerificationBaseline(PAYER_ACCT, 5000);
        pledge.setMerchantVerified(MERCHANT_ACCT, true);

        _link(payer, PAYER_ACCT);
        _link(merchant, MERCHANT_ACCT);
    }

    function _link(address wallet, bytes32 acct) internal {
        uint256 sigExpiry = block.timestamp + 30 minutes;
        uint256 nonce = pledge.linkNonces(acct);
        bytes32 msgHash = keccak256(
            abi.encodePacked(block.chainid, address(pledge), "link", acct, wallet, sigExpiry, nonce)
        );
        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(msgHash);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(OP_PK, ethHash);
        vm.prank(wallet);
        pledge.linkWallet(acct, sigExpiry, abi.encodePacked(r, s, v));
    }

    // ── Deployment checks ──────────────────────────────────────────────────────

    function test_fork_usdcIsWhitelisted() public view {
        assertTrue(pledge.allowedTokens(USDC_ADDR), "USDC not whitelisted");
    }

    function test_fork_usdtIsWhitelisted() public view {
        assertTrue(pledge.allowedTokens(USDT_ADDR), "USDT not whitelisted");
    }

    function test_fork_feeRecipientIsSet() public view {
        assertNotEq(pledge.feeRecipient(), address(0), "fee recipient not set");
    }

    function test_fork_operatorsAreSet() public view {
        assertNotEq(pledge.linkOperator(), address(0), "link operator not set");
        assertNotEq(pledge.verificationOperator(), address(0), "verification operator not set");
    }

    function test_fork_pledgeCounterStartsAtZero() public view {
        assertEq(pledge.pledgeCounter(), 0, "pledge counter should be 0 on fresh deploy");
    }

    // ── Forked token checks ──────────────────────────────────────────────────

    function test_fork_usdcDecimals() public view {
        assertEq(usdc.decimals(), 6, "USDC should have 6 decimals");
    }

    function test_fork_usdtDecimals() public view {
        assertEq(usdt.decimals(), 6, "USDT should have 6 decimals");
    }

    // ── Live flow: create and complete a pledge using forked USDC ──────────────

    function test_fork_createAndCompletePledgeUSDC() public {
        uint256 amount = 10_000_000; // 10 USDC
        uint256 gross  = pledge.quoteGrossAmount(PAYER_ACCT, amount);

        vm.prank(merchant);
        pledge.createPledge(USDC_ADDR, PAYER_ACCT, amount, block.timestamp + 1 days);
        assertEq(pledge.pledgeCounter(), 1, "pledge counter should be 1");

        usdc.faucet(payer, gross);
        vm.prank(payer);
        usdc.approve(address(pledge), gross);
        vm.prank(payer);
        pledge.submitDeposit(1, gross);

        // Merchant net lands in escrow; the fee leaves to the fee recipient.
        assertEq(pledge.getAccountBalance(MERCHANT_ACCT, USDC_ADDR), amount, "merchant escrow == net");
        assertEq(usdc.balanceOf(address(pledge)), amount, "contract holds escrowed net");
    }

    // ── Live flow: create and complete a pledge using forked USDT ──────────────

    function test_fork_createAndCompletePledgeUSDT() public {
        uint256 amount = 10_000_000; // 10 USDT
        uint256 gross  = pledge.quoteGrossAmount(PAYER_ACCT, amount);

        vm.prank(merchant);
        pledge.createPledge(USDT_ADDR, PAYER_ACCT, amount, block.timestamp + 1 days);

        usdt.faucet(payer, gross);
        vm.prank(payer);
        usdt.approve(address(pledge), gross);
        vm.prank(payer);
        pledge.submitDeposit(1, gross);

        assertEq(pledge.getAccountBalance(MERCHANT_ACCT, USDT_ADDR), amount, "merchant escrow == net (USDT)");
        assertEq(usdt.balanceOf(address(pledge)), amount, "contract holds escrowed net (USDT)");
    }

    // ── Live flow: fee is correctly deducted ───────────────────────────────────

    function test_fork_feeIsDeducted() public {
        uint256 amount   = 10_000_000; // 10 USDC
        uint256 gross    = pledge.quoteGrossAmount(PAYER_ACCT, amount);
        uint256 expected = gross - amount; // expected fee

        address feeRecipient = pledge.feeRecipient();
        uint256 feeBefore    = usdc.balanceOf(feeRecipient);

        vm.prank(merchant);
        pledge.createPledge(USDC_ADDR, PAYER_ACCT, amount, block.timestamp + 1 days);

        usdc.faucet(payer, gross);
        vm.prank(payer);
        usdc.approve(address(pledge), gross);
        vm.prank(payer);
        pledge.submitDeposit(1, gross);

        uint256 feeAfter = usdc.balanceOf(feeRecipient);
        assertEq(feeAfter - feeBefore, expected, "fee not correctly collected");
    }
}

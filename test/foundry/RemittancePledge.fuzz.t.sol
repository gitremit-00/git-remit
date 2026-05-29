// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import "forge-std/Test.sol";
import "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";
import "../../contracts/RemittancePledge.sol";
import "../../contracts/MockTokens.sol";

contract RemittancePledgeFuzzTest is Test {
    RemittancePledge internal pledge;
    MockUSDC internal usdc;

    // Off-chain link operator — its key is known to the test so we can co-sign links.
    uint256 internal constant OP_PK = 0xA11CE;
    address internal linkOp;

    address internal payer    = address(0xA11CE);
    address internal merchant = address(0xB0B);
    address internal feeRecip = address(0xFEE);

    // Account IDs (bytes32) stand in for off-chain RemitSafe profile UUIDs.
    bytes32 internal constant PAYER_ACCT    = keccak256("payer");
    bytes32 internal constant MERCHANT_ACCT = keccak256("merchant");

    uint256 internal constant MIN_PLEDGE = 1_000_000;
    uint256 internal constant MAX_PLEDGE = 1_000_000_000_000;

    function setUp() public {
        usdc = new MockUSDC();
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);

        linkOp = vm.addr(OP_PK);
        // Test contract is the owner (it deploys).
        pledge = new RemittancePledge(tokens, feeRecip, linkOp, linkOp);

        pledge.setVerificationBaseline(PAYER_ACCT, 5000);
        pledge.setMerchantVerified(MERCHANT_ACCT, true);

        _link(payer, PAYER_ACCT);
        _link(merchant, MERCHANT_ACCT);
    }

    // Link a wallet to an account with a fresh operator signature.
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

    function testFuzz_grossNeverBelowNet(uint256 totalAmount) public view {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        uint256 gross = pledge.quoteGrossAmount(PAYER_ACCT, totalAmount);
        assertGe(gross, totalAmount, "gross must be >= net");
        uint256 fee = gross - totalAmount;
        assertEq(fee, (totalAmount * 100) / 10000, "fee must equal exactly 1%");
    }

    function testFuzz_grossNoOverflow(uint256 totalAmount) public view {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        uint256 gross = pledge.quoteGrossAmount(PAYER_ACCT, totalAmount);
        assertGt(gross, 0);
    }

    // After a deposit, the contract physically holds: the deposit (while pending) or, once
    // complete, the net amount credited to merchant escrow (the fee has been paid out).
    function testFuzz_escrowBalanceMatchesDeposit(uint256 totalAmount, uint256 depositPct) public {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        depositPct  = bound(depositPct, 30, 100); // KYC payer (MID tier) needs >= 30%
        uint256 gross   = pledge.quoteGrossAmount(PAYER_ACCT, totalAmount);
        uint256 deposit = (gross * depositPct) / 100;
        if (deposit == 0) return;

        vm.prank(merchant);
        pledge.createPledge(address(usdc), PAYER_ACCT, totalAmount, block.timestamp + 30 days);

        deal(address(usdc), payer, gross);
        vm.prank(payer);
        usdc.approve(address(pledge), deposit);
        vm.prank(payer);
        pledge.submitDeposit(1, deposit);

        uint256 contractBal = usdc.balanceOf(address(pledge));
        if (deposit >= gross) {
            // Completed: fee paid out, net stays in the contract as merchant escrow.
            assertEq(contractBal, totalAmount, "completed pledge leaves net as escrow");
            assertEq(pledge.getAccountBalance(MERCHANT_ACCT, address(usdc)), totalAmount, "merchant escrow == net");
        } else {
            assertEq(contractBal, deposit, "pending escrow must equal deposit");
        }
    }

    function testFuzz_completionConservesMoney(uint256 totalAmount) public {
        totalAmount = bound(totalAmount, MIN_PLEDGE, MAX_PLEDGE);
        uint256 gross   = pledge.quoteGrossAmount(PAYER_ACCT, totalAmount);
        uint256 deposit = (gross * 40) / 100;
        uint256 remaining = gross - deposit;

        vm.prank(merchant);
        pledge.createPledge(address(usdc), PAYER_ACCT, totalAmount, block.timestamp + 30 days);

        deal(address(usdc), payer, gross);
        vm.prank(payer);
        usdc.approve(address(pledge), gross);

        vm.prank(payer);
        pledge.submitDeposit(1, deposit);
        vm.prank(payer);
        pledge.submitDeposit(1, remaining);

        uint256 escrowBal = pledge.getAccountBalance(MERCHANT_ACCT, address(usdc));
        uint256 feeBal    = usdc.balanceOf(feeRecip);
        assertEq(escrowBal, totalAmount,                "merchant escrow receives net amount");
        assertEq(escrowBal + feeBal, gross,             "escrow + fee == gross");
        assertEq(usdc.balanceOf(merchant), 0,           "merchant wallet untouched (escrow model)");
        assertEq(usdc.balanceOf(address(pledge)), totalAmount, "contract holds escrowed net");
    }

    function testFuzz_feeBpsAlwaysValidTier(bytes32 anyAccount) public view {
        uint256 bps = pledge.getServiceFeeBps(anyAccount);
        assertTrue(bps == 75 || bps == 100, "fee must be a valid tier");
    }

    function testFuzz_depositPctAlwaysValidTier(bytes32 anyAccount) public view {
        uint256 pct = pledge.getAccountRequiredDepositPct(anyAccount);
        assertTrue(pct == 20 || pct == 30 || pct == 40 || pct == 50, "deposit pct must be a valid tier");
    }
}

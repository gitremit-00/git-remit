// test/hardhat/RemittancePledge.test.js
// v2 account-keyed model: identity is a bytes32 accountId derived off-chain from the
// RemitSafe profile UUID. Wallets are linked to accounts via linkWallet (operator co-sign).
// Merchant creates pledges targeting a payer ACCOUNT; the payer fulfils them from any
// linked wallet. Merchant/P2P receipts land in an account-held escrow balance and are
// withdrawn to a linked wallet under tiered timelocks.
//
// Run:   npx hardhat test
// Cover: npx hardhat coverage

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ── Constants mirrored from the contract ──────────────────────────────────────
const UNITS = (n) => ethers.parseUnits(n.toString(), 6); // 6-decimal token amount
const GRACE_PERIOD = 3 * 24 * 60 * 60;
const CLAIM_WINDOW = 45 * 24 * 60 * 60; // 45 days
const TIME_BUFFER = 15 * 60;
const DAY = 24 * 60 * 60;
const INTERVAL_30D = 30 * DAY;
const INTERVAL_7D = 7 * DAY;
const DEFAULT_DAILY_CAP = UNITS(500);
const TIMELOCK_1H = 60 * 60;
const TIMELOCK_24H = 24 * 60 * 60;

// Account IDs (bytes32) — keccak hashes stand in for off-chain RemitSafe profile UUIDs.
const PAYER_ACCT = ethers.id("payer-account");
const MERCHANT_ACCT = ethers.id("merchant-account");
const OUTSIDER_ACCT = ethers.id("outsider-account");
const FRESH_ACCT = ethers.id("fresh-account");

describe("RemittancePledge", function () {
  let usdc, usdt, pledge;
  let owner, payer, merchant, feeRecipient, outsider, linkOp, verifOp, extra;
  let usdcAddr, usdtAddr, pledgeAddr;
  let chainId;

  // ── Signing helpers ──────────────────────────────────────────────────────────

  // linkOperator co-signs a wallet→account binding
  async function signLink(accountId, wallet, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "bytes32", "address", "uint256", "uint256"],
      [chainId, pledgeAddr, "link", accountId, wallet, sigExpiry, nonce]
    );
    return linkOp.signMessage(ethers.getBytes(hash));
  }

  // Link a wallet to an account using a fresh operator signature
  async function linkWallet(wallet, accountId) {
    const sigExpiry = (await time.latest()) + 30 * 60; // within LINK_SIG_MAX_VALIDITY (1h)
    const nonce = await pledge.linkNonces(accountId);
    const sig = await signLink(accountId, wallet.address, sigExpiry, nonce);
    await pledge.connect(wallet).linkWallet(accountId, sigExpiry, sig);
  }

  // merchant signs an extension approval
  async function signExtension(pledgeId, newDate, oldDate, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
      [chainId, pledgeAddr, "extend", pledgeId, newDate, oldDate, sigExpiry, nonce]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // merchant signs a pledge cancellation approval
  async function signCancel(pledgeId, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256"],
      [chainId, pledgeAddr, "cancel", pledgeId, sigExpiry, nonce]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // merchant signs a recurring cancellation approval
  async function signCancelRecurring(recurringId, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256"],
      [chainId, pledgeAddr, "cancelRecurring", recurringId, sigExpiry, nonce]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // ── Scenario helpers ───────────────────────────────────────────────────────

  // merchant creates a standard USDC pledge (150 total), payer submits 40% deposit
  async function createStandardPledge(token = null) {
    const tok = token ?? usdc;
    const tokAddr = await tok.getAddress();
    const total = UNITS(150);
    const pledgeId = Number(await pledge.pledgeCounter()) + 1;
    const deadline = (await time.latest()) + 30 * DAY;
    await pledge.connect(merchant).createPledge(tokAddr, PAYER_ACCT, total, deadline);
    const gross = await pledge.grossAmountForPledge(pledgeId);
    const deposit = (gross * 40n) / 100n;
    await tok.connect(payer).approve(pledgeAddr, deposit);
    await pledge.connect(payer).submitDeposit(pledgeId, deposit);
    return { total, gross, deposit, deadline, tokAddr, pledgeId };
  }

  // merchant creates a recurring pledge targeting the payer
  async function createStandardRecurring(periods = 3, amountPerPeriod = 100) {
    const amount = UNITS(amountPerPeriod);
    const firstDueDate = (await time.latest()) + INTERVAL_30D;
    await pledge
      .connect(merchant)
      .createRecurringPledge(usdcAddr, PAYER_ACCT, amount, INTERVAL_30D, periods, firstDueDate);
    return { amount, firstDueDate, periods };
  }

  // payer pays one installment (handles approval of gross-with-fee)
  async function payInstallment(recurringId, amount) {
    const feeBps = (await pledge.recurringPledges(recurringId)).appliedFeeBps;
    const gross = amount + (amount * feeBps) / 10000n;
    await usdc.connect(payer).approve(pledgeAddr, gross);
    await pledge.connect(payer).payInstallment(recurringId);
  }

  // completes a pledge of `total` to credit `MERCHANT_ACCT` escrow; returns total
  async function fundMerchantEscrow(total) {
    const amt = UNITS(total);
    const pledgeId = Number(await pledge.pledgeCounter()) + 1;
    const deadline = (await time.latest()) + 30 * DAY;
    await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, amt, deadline);
    const gross = await pledge.grossAmountForPledge(pledgeId);
    await usdc.connect(payer).approve(pledgeAddr, gross);
    await pledge.connect(payer).submitDeposit(pledgeId, gross);
    return amt;
  }

  beforeEach(async function () {
    [owner, payer, merchant, feeRecipient, outsider, linkOp, verifOp, extra] =
      await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    usdc = await MockUSDC.deploy();
    usdt = await MockUSDT.deploy();

    usdcAddr = await usdc.getAddress();
    usdtAddr = await usdt.getAddress();

    const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
    pledge = await RemittancePledge.deploy(
      [usdcAddr, usdtAddr],
      feeRecipient.address,
      linkOp.address,
      verifOp.address
    );
    pledgeAddr = await pledge.getAddress();
    chainId = (await ethers.provider.getNetwork()).chainId;

    // Fund the payer (OFW) with both tokens
    await usdc.faucet(payer.address, UNITS(100000));
    await usdt.faucet(payer.address, UNITS(100000));

    // Link the standard cast of wallets to their accounts.
    await linkWallet(payer, PAYER_ACCT);
    await linkWallet(merchant, MERCHANT_ACCT);
    await linkWallet(outsider, OUTSIDER_ACCT);

    // Default verification: KYC-approved payer + verified merchant. The outsider is
    // verified as both OFW and merchant so role/ownership revert tests reach their
    // intended check, not the verification gate. Tests that exercise unverified paths
    // set their own state.
    await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 5000);
    await pledge.connect(owner).setVerificationBaseline(OUTSIDER_ACCT, 5000);
    await pledge.connect(owner).setMerchantVerified(MERCHANT_ACCT, true);
    await pledge.connect(owner).setMerchantVerified(OUTSIDER_ACCT, true);
    // Merchant account also gets an OFW baseline so "merchant as payer" tests reach
    // their intended check, not the verification gate.
    await pledge.connect(owner).setVerificationBaseline(MERCHANT_ACCT, 5000);
  });

  // ── Constructor ───────────────────────────────────────────────────────────────
  describe("constructor", function () {
    it("reverts with empty token list", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy([], feeRecipient.address, linkOp.address, verifOp.address))
        .to.be.revertedWithCustomError(pledge, "InvalidAmount");
    });

    it("reverts on zero token address in list", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy([ethers.ZeroAddress], feeRecipient.address, linkOp.address, verifOp.address))
        .to.be.revertedWithCustomError(pledge, "InvalidAddress");
    });

    it("reverts on zero fee recipient", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy([usdcAddr], ethers.ZeroAddress, linkOp.address, verifOp.address))
        .to.be.revertedWithCustomError(pledge, "InvalidAddress");
    });

    it("whitelists all tokens passed at deployment", async function () {
      expect(await pledge.allowedTokens(usdcAddr)).to.equal(true);
      expect(await pledge.allowedTokens(usdtAddr)).to.equal(true);
    });

    it("records the link and verification operators", async function () {
      expect(await pledge.linkOperator()).to.equal(linkOp.address);
      expect(await pledge.verificationOperator()).to.equal(verifOp.address);
    });

    it("emits LinkOperatorChanged and VerificationOperatorChanged at deploy", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      const c = await F.deploy([usdcAddr], feeRecipient.address, linkOp.address, verifOp.address);
      await expect(c.deploymentTransaction())
        .to.emit(c, "LinkOperatorChanged").withArgs(ethers.ZeroAddress, linkOp.address)
        .and.to.emit(c, "VerificationOperatorChanged").withArgs(ethers.ZeroAddress, verifOp.address);
    });
  });

  // ── Wallet linking ──────────────────────────────────────────────────────────
  describe("linkWallet", function () {
    it("links a fresh wallet to an account with a valid operator signature", async function () {
      await linkWallet(extra, FRESH_ACCT);
      expect(await pledge.getWalletAccount(extra.address)).to.equal(FRESH_ACCT);
      const wallets = await pledge.getAccountWallets(FRESH_ACCT);
      expect(wallets).to.deep.equal([extra.address]);
    });

    it("emits WalletLinked with isPrimary=true for the first wallet", async function () {
      const sigExpiry = (await time.latest()) + 30 * 60;
      const nonce = await pledge.linkNonces(FRESH_ACCT);
      const sig = await signLink(FRESH_ACCT, extra.address, sigExpiry, nonce);
      await expect(pledge.connect(extra).linkWallet(FRESH_ACCT, sigExpiry, sig))
        .to.emit(pledge, "WalletLinked").withArgs(FRESH_ACCT, extra.address, true);
    });

    it("links a second wallet to the same account (isPrimary=false)", async function () {
      const sigExpiry = (await time.latest()) + 30 * 60;
      const nonce = await pledge.linkNonces(MERCHANT_ACCT);
      const sig = await signLink(MERCHANT_ACCT, extra.address, sigExpiry, nonce);
      await expect(pledge.connect(extra).linkWallet(MERCHANT_ACCT, sigExpiry, sig))
        .to.emit(pledge, "WalletLinked").withArgs(MERCHANT_ACCT, extra.address, false);
      expect((await pledge.getAccountWallets(MERCHANT_ACCT)).length).to.equal(2);
    });

    it("reverts on a zero accountId", async function () {
      const sigExpiry = (await time.latest()) + 30 * 60;
      const sig = await signLink(ethers.ZeroHash, extra.address, sigExpiry, 0);
      await expect(pledge.connect(extra).linkWallet(ethers.ZeroHash, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "InvalidAccountId");
    });

    it("reverts when the wallet is already linked", async function () {
      const sigExpiry = (await time.latest()) + 30 * 60;
      const nonce = await pledge.linkNonces(FRESH_ACCT);
      const sig = await signLink(FRESH_ACCT, payer.address, sigExpiry, nonce);
      await expect(pledge.connect(payer).linkWallet(FRESH_ACCT, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "WalletAlreadyLinked");
    });

    it("reverts when the signature has expired", async function () {
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signLink(FRESH_ACCT, extra.address, sigExpiry, 0);
      await expect(pledge.connect(extra).linkWallet(FRESH_ACCT, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "SignatureExpired");
    });

    it("reverts when sigExpiry exceeds the max validity window", async function () {
      const sigExpiry = (await time.latest()) + 2 * 60 * 60; // 2h > 1h max
      const sig = await signLink(FRESH_ACCT, extra.address, sigExpiry, 0);
      await expect(pledge.connect(extra).linkWallet(FRESH_ACCT, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "SignatureValidityTooLong");
    });

    it("reverts on a signature from a non-operator", async function () {
      const sigExpiry = (await time.latest()) + 30 * 60;
      const nonce = await pledge.linkNonces(FRESH_ACCT);
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "bytes32", "address", "uint256", "uint256"],
        [chainId, pledgeAddr, "link", FRESH_ACCT, extra.address, sigExpiry, nonce]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(extra).linkWallet(FRESH_ACCT, sigExpiry, badSig))
        .to.be.revertedWithCustomError(pledge, "InvalidSignature");
    });

    it("reverts when linking is disabled (operator unset)", async function () {
      await pledge.connect(owner).setLinkOperator(ethers.ZeroAddress);
      const sigExpiry = (await time.latest()) + 30 * 60;
      const sig = await signLink(FRESH_ACCT, extra.address, sigExpiry, 0);
      await expect(pledge.connect(extra).linkWallet(FRESH_ACCT, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "LinkingDisabled");
    });

    it("consumes the nonce, preventing signature replay", async function () {
      await linkWallet(extra, FRESH_ACCT);
      // Re-using the same nonce/signature on another wallet must fail.
      const sigExpiry = (await time.latest()) + 30 * 60;
      const staleSig = await signLink(FRESH_ACCT, owner.address, sigExpiry, 0);
      await expect(pledge.connect(owner).linkWallet(FRESH_ACCT, sigExpiry, staleSig))
        .to.be.revertedWithCustomError(pledge, "InvalidSignature");
    });
  });

  describe("unlinkWallet", function () {
    it("unlinks a non-last wallet", async function () {
      await linkWallet(extra, MERCHANT_ACCT); // merchant account now has 2 wallets
      await pledge.connect(extra).unlinkWallet();
      expect(await pledge.getWalletAccount(extra.address)).to.equal(ethers.ZeroHash);
      expect((await pledge.getAccountWallets(MERCHANT_ACCT)).length).to.equal(1);
    });

    it("emits WalletUnlinked", async function () {
      await linkWallet(extra, MERCHANT_ACCT);
      await expect(pledge.connect(extra).unlinkWallet())
        .to.emit(pledge, "WalletUnlinked").withArgs(MERCHANT_ACCT, extra.address);
    });

    it("reverts when the wallet is not linked", async function () {
      await expect(pledge.connect(extra).unlinkWallet())
        .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
    });

    it("reverts when trying to unlink the last wallet", async function () {
      await expect(pledge.connect(payer).unlinkWallet())
        .to.be.revertedWithCustomError(pledge, "LastWalletCannotUnlink");
    });
  });

  describe("panicUnlink", function () {
    it("unlinks every wallet except the caller's", async function () {
      await linkWallet(extra, MERCHANT_ACCT);
      // merchant + extra are both on MERCHANT_ACCT; merchant panics.
      await pledge.connect(merchant).panicUnlink();
      expect(await pledge.getWalletAccount(extra.address)).to.equal(ethers.ZeroHash);
      expect(await pledge.getWalletAccount(merchant.address)).to.equal(MERCHANT_ACCT);
      expect(await pledge.getAccountWallets(MERCHANT_ACCT)).to.deep.equal([merchant.address]);
    });

    it("emits PanicUnlinkAll naming the survivor", async function () {
      await linkWallet(extra, MERCHANT_ACCT);
      await expect(pledge.connect(merchant).panicUnlink())
        .to.emit(pledge, "PanicUnlinkAll").withArgs(MERCHANT_ACCT, merchant.address);
    });

    it("reverts when the caller is not linked", async function () {
      await expect(pledge.connect(extra).panicUnlink())
        .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
    });
  });

  // ── Verification (KYC) ────────────────────────────────────────────────────────
  describe("verification", function () {
    describe("setVerificationBaseline", function () {
      it("owner can set an account baseline to KYC level (5000)", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000);
        expect(await pledge.accountVerificationBaseline(FRESH_ACCT)).to.equal(5000);
        expect(await pledge.getAccountTrustScore(FRESH_ACCT)).to.equal(5000);
      });

      it("owner can set baseline to KYC+avatar level (6000)", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 6000);
        expect(await pledge.getAccountTrustScore(FRESH_ACCT)).to.equal(6000);
      });

      it("operator cannot call setVerificationBaseline directly (owner-only)", async function () {
        await expect(pledge.connect(verifOp).setVerificationBaseline(FRESH_ACCT, 6000))
          .to.be.revertedWithCustomError(pledge, "OwnableUnauthorizedAccount");
      });

      it("non-owner cannot set baseline", async function () {
        await expect(pledge.connect(outsider).setVerificationBaseline(FRESH_ACCT, 5000))
          .to.be.revertedWithCustomError(pledge, "OwnableUnauthorizedAccount");
      });

      it("reverts on baseline above MAX_BASELINE", async function () {
        await expect(pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 6001))
          .to.be.revertedWithCustomError(pledge, "BaselineExceedsMax");
      });

      it("reverts on zero accountId", async function () {
        await expect(pledge.connect(owner).setVerificationBaseline(ethers.ZeroHash, 5000))
          .to.be.revertedWithCustomError(pledge, "InvalidAccountId");
      });

      it("emits AccountVerificationBaselineChanged", async function () {
        await expect(pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000))
          .to.emit(pledge, "AccountVerificationBaselineChanged")
          .withArgs(FRESH_ACCT, 0, 5000);
      });

      it("downgrading baseline to 0 fully revokes verification", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000);
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 0);
        expect(await pledge.getAccountTrustScore(FRESH_ACCT)).to.equal(0);
      });
    });

    describe("boostVerificationBaseline (operator)", function () {
      it("operator can boost a KYC-approved account from 5000 to 6000", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000);
        await pledge.connect(verifOp).boostVerificationBaseline(FRESH_ACCT);
        expect(await pledge.accountVerificationBaseline(FRESH_ACCT)).to.equal(6000);
      });

      it("emits AccountVerificationBaselineChanged on boost", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000);
        await expect(pledge.connect(verifOp).boostVerificationBaseline(FRESH_ACCT))
          .to.emit(pledge, "AccountVerificationBaselineChanged")
          .withArgs(FRESH_ACCT, 5000, 6000);
      });

      it("operator cannot boost an unverified account (0 baseline)", async function () {
        await expect(pledge.connect(verifOp).boostVerificationBaseline(FRESH_ACCT))
          .to.be.revertedWithCustomError(pledge, "BaselineNotKyc");
      });

      it("operator cannot boost an already-boosted account", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 6000);
        await expect(pledge.connect(verifOp).boostVerificationBaseline(FRESH_ACCT))
          .to.be.revertedWithCustomError(pledge, "BaselineNotKyc");
      });

      it("non-operator cannot call boost (even owner)", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000);
        await expect(pledge.connect(owner).boostVerificationBaseline(FRESH_ACCT))
          .to.be.revertedWithCustomError(pledge, "OnlyOperator");
      });

      it("reverts on zero accountId", async function () {
        await expect(pledge.connect(verifOp).boostVerificationBaseline(ethers.ZeroHash))
          .to.be.revertedWithCustomError(pledge, "InvalidAccountId");
      });

      it("compromised operator cannot revoke accounts", async function () {
        // The operator has no function that lowers a baseline — only boosts.
        await expect(pledge.connect(verifOp).setVerificationBaseline(PAYER_ACCT, 0))
          .to.be.revertedWithCustomError(pledge, "OwnableUnauthorizedAccount");
      });
    });

    describe("setMerchantVerified", function () {
      it("owner can verify a merchant account", async function () {
        await pledge.connect(owner).setMerchantVerified(FRESH_ACCT, true);
        expect(await pledge.accountIsMerchantVerified(FRESH_ACCT)).to.equal(true);
      });

      it("owner can revoke merchant verification", async function () {
        await pledge.connect(owner).setMerchantVerified(FRESH_ACCT, true);
        await pledge.connect(owner).setMerchantVerified(FRESH_ACCT, false);
        expect(await pledge.accountIsMerchantVerified(FRESH_ACCT)).to.equal(false);
      });

      it("operator cannot verify merchants (owner only)", async function () {
        await expect(pledge.connect(verifOp).setMerchantVerified(FRESH_ACCT, true))
          .to.be.revertedWithCustomError(pledge, "OwnableUnauthorizedAccount");
      });

      it("reverts on zero accountId", async function () {
        await expect(pledge.connect(owner).setMerchantVerified(ethers.ZeroHash, true))
          .to.be.revertedWithCustomError(pledge, "InvalidAccountId");
      });

      it("emits AccountMerchantVerificationChanged", async function () {
        await expect(pledge.connect(owner).setMerchantVerified(FRESH_ACCT, true))
          .to.emit(pledge, "AccountMerchantVerificationChanged")
          .withArgs(FRESH_ACCT, true);
      });
    });

    describe("setVerificationOperator / setLinkOperator", function () {
      it("owner can change the verification operator", async function () {
        await pledge.connect(owner).setVerificationOperator(outsider.address);
        expect(await pledge.verificationOperator()).to.equal(outsider.address);
      });

      it("non-owner cannot set verification operator", async function () {
        await expect(pledge.connect(outsider).setVerificationOperator(payer.address))
          .to.be.revertedWithCustomError(pledge, "OwnableUnauthorizedAccount");
      });

      it("emits VerificationOperatorChanged", async function () {
        await expect(pledge.connect(owner).setVerificationOperator(outsider.address))
          .to.emit(pledge, "VerificationOperatorChanged")
          .withArgs(verifOp.address, outsider.address);
      });

      it("owner can change the link operator", async function () {
        await pledge.connect(owner).setLinkOperator(outsider.address);
        expect(await pledge.linkOperator()).to.equal(outsider.address);
      });

      it("emits LinkOperatorChanged", async function () {
        await expect(pledge.connect(owner).setLinkOperator(outsider.address))
          .to.emit(pledge, "LinkOperatorChanged")
          .withArgs(linkOp.address, outsider.address);
      });
    });

    describe("trust score with baseline", function () {
      it("baseline floors the trust score", async function () {
        await pledge.connect(owner).setVerificationBaseline(FRESH_ACCT, 5000);
        expect(await pledge.getAccountTrustScore(FRESH_ACCT)).to.equal(5000);
      });

      it("behavioral score above baseline wins", async function () {
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(10), (await time.latest()) + 30 * DAY);
        const gross = await pledge.grossAmountForPledge(1);
        await usdc.connect(payer).approve(pledgeAddr, gross);
        await pledge.connect(payer).submitDeposit(1, gross);
        expect(await pledge.getAccountTrustScore(PAYER_ACCT)).to.be.gte(8000);
      });
    });

    describe("transaction gating", function () {
      beforeEach(async function () {
        // A linked-but-unverified wallet/account for gating tests.
        await linkWallet(extra, FRESH_ACCT);
        await usdc.faucet(extra.address, UNITS(10000));
      });

      it("createPledge reverts when merchant is not verified", async function () {
        const deadline = (await time.latest()) + 30 * DAY;
        await expect(pledge.connect(extra).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline))
          .to.be.revertedWithCustomError(pledge, "MerchantNotVerified");
      });

      it("createPledge reverts when caller wallet is not linked", async function () {
        const deadline = (await time.latest()) + 30 * DAY;
        await expect(pledge.connect(feeRecipient).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("createPledge reverts when payer account is not verified", async function () {
        const deadline = (await time.latest()) + 30 * DAY;
        await expect(pledge.connect(merchant).createPledge(usdcAddr, FRESH_ACCT, UNITS(150), deadline))
          .to.be.revertedWithCustomError(pledge, "PayerNotVerified");
      });

      it("submitDeposit reverts when the payer's baseline drops below threshold", async function () {
        await createStandardPledge();
        await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
        const gross = await pledge.grossAmountForPledge(1);
        const remaining = gross - (gross * 40n) / 100n;
        await usdc.connect(payer).approve(pledgeAddr, remaining);
        await expect(pledge.connect(payer).submitDeposit(1, remaining))
          .to.be.revertedWithCustomError(pledge, "PayerNotVerified");
      });

      it("sendP2P reverts when sender is not verified", async function () {
        await usdc.connect(extra).approve(pledgeAddr, UNITS(20));
        await expect(pledge.connect(extra).sendP2P(usdcAddr, payer.address, UNITS(10)))
          .to.be.revertedWithCustomError(pledge, "SenderNotVerified");
      });

      it("sendP2P works for a verified merchant even without OFW baseline", async function () {
        await pledge.connect(owner).setMerchantVerified(FRESH_ACCT, true);
        await usdc.connect(extra).approve(pledgeAddr, UNITS(20));
        await pledge.connect(extra).sendP2P(usdcAddr, payer.address, UNITS(10));
        expect(await pledge.getAccountBalance(PAYER_ACCT, usdcAddr)).to.equal(UNITS(10));
      });

      it("reclaimDeposit works even when payer is unverified (wind-down)", async function () {
        const { deadline } = await createStandardPledge();
        await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
        await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
        await pledge.connect(payer).reclaimDeposit(1);
        expect((await pledge.getPledge(1)).status).to.equal(2); // DEFAULTED
      });
    });
  });

  // ── createPledge ──────────────────────────────────────────────────────────────
  describe("createPledge", function () {
    it("merchant creates a USDC pledge targeting the payer account", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
      const p = await pledge.getPledge(1);
      expect(p.merchantAccount).to.equal(MERCHANT_ACCT);
      expect(p.payerAccount).to.equal(PAYER_ACCT);
      expect(p.token).to.equal(usdcAddr);
      expect(p.totalAmount).to.equal(total);
      expect(p.depositedAmount).to.equal(0);
      expect(p.depositingWallet).to.equal(ethers.ZeroAddress);
      expect(p.status).to.equal(0); // PENDING
    });

    it("merchant creates a USDT pledge targeting the payer account", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdtAddr, PAYER_ACCT, total, deadline);
      const p = await pledge.getPledge(1);
      expect(p.token).to.equal(usdtAddr);
      expect(p.depositedAmount).to.equal(0);
    });

    it("does not transfer funds at creation", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      const merchantBefore = await usdc.balanceOf(merchant.address);
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore);
    });

    it("reverts when token is not whitelisted", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(await rogue.getAddress(), PAYER_ACCT, UNITS(150), deadline)
      ).to.be.revertedWithCustomError(pledge, "TokenNotSupported");
    });

    it("reverts on zero payer account", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, ethers.ZeroHash, UNITS(150), deadline)
      ).to.be.revertedWithCustomError(pledge, "InvalidAccountId");
    });

    it("reverts when merchant account is also the payer account", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, MERCHANT_ACCT, UNITS(150), deadline)
      ).to.be.revertedWithCustomError(pledge, "SelfTransferDisallowed");
    });

    it("reverts below the minimum amount", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(0.5), deadline)
      ).to.be.revertedWithCustomError(pledge, "AmountBelowMinimum");
    });

    it("reverts when commitment date is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), past)
      ).to.be.revertedWithCustomError(pledge, "CommitmentInPast");
    });

    it("reverts when commitment date exceeds 90 days", async function () {
      const tooFar = (await time.latest()) + 100 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), tooFar)
      ).to.be.revertedWithCustomError(pledge, "CommitmentTooFar");
    });

    it("emits PledgeCreated with correct args", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline))
        .to.emit(pledge, "PledgeCreated")
        .withArgs(1, MERCHANT_ACCT, PAYER_ACCT, usdcAddr, total, deadline, 100n);
    });

    it("indexes the pledge under both accounts", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(100), deadline);
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(200), deadline);
      expect(await pledge.pledgeCounter()).to.equal(2);
      expect((await pledge.getAccountPayerPledges(PAYER_ACCT)).length).to.equal(2);
      expect((await pledge.getAccountMerchantPledges(MERCHANT_ACCT)).length).to.equal(2);
    });
  });

  // ── submitDeposit ─────────────────────────────────────────────────────────────
  describe("submitDeposit", function () {
    it("payer submits initial deposit and pledge stays pending", async function () {
      const { deposit } = await createStandardPledge();
      const p = await pledge.getPledge(1);
      expect(p.depositedAmount).to.equal(deposit);
      expect(p.status).to.equal(0); // PENDING
      expect(p.depositingWallet).to.equal(payer.address);
    });

    it("increments activePledgeCount on first deposit", async function () {
      await createStandardPledge();
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(1);
    });

    it("completes the pledge when full gross is deposited, crediting merchant escrow", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).submitDeposit(1, gross);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(1); // COMPLETED
      // Merchant receipts land in escrow, not the wallet.
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(total);
      expect(await usdc.balanceOf(merchant.address)).to.equal(0);
    });

    it("completes the pledge when exact remaining is deposited as top-up", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge();
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      expect((await pledge.getPledge(pledgeId)).status).to.equal(1); // COMPLETED
    });

    it("reverts on a partial (non-exact) top-up after initial deposit", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge();
      const partial = (gross - deposit) / 2n;
      await usdc.connect(payer).approve(pledgeAddr, partial);
      await expect(pledge.connect(payer).submitDeposit(pledgeId, partial))
        .to.be.revertedWithCustomError(pledge, "DepositExactRemainder");
    });

    it("reverts when a wallet on another account tries to deposit", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.faucet(outsider.address, gross);
      await usdc.connect(outsider).approve(pledgeAddr, gross);
      await expect(pledge.connect(outsider).submitDeposit(1, gross))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts when the depositing wallet is not linked", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      await expect(pledge.connect(feeRecipient).submitDeposit(1, UNITS(60)))
        .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
    });

    it("reverts after the grace period ends", async function () {
      const { gross, deposit, deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + 1);
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await expect(pledge.connect(payer).submitDeposit(pledgeId, remaining))
        .to.be.revertedWithCustomError(pledge, "GraceEnded");
    });

    it("reverts on a zero amount", async function () {
      await createStandardPledge();
      await expect(pledge.connect(payer).submitDeposit(1, 0))
        .to.be.revertedWithCustomError(pledge, "InvalidAmount");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(payer).submitDeposit(999, UNITS(1)))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("reverts on a non-PENDING pledge", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge();
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      await expect(pledge.connect(payer).submitDeposit(pledgeId, remaining))
        .to.be.revertedWithCustomError(pledge, "PledgeNotPending");
    });

    it("reverts when initial deposit is below the required percentage", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      const tooLittle = UNITS(1);
      await usdc.connect(payer).approve(pledgeAddr, tooLittle);
      await expect(pledge.connect(payer).submitDeposit(1, tooLittle))
        .to.be.revertedWithCustomError(pledge, "DepositBelowRequiredPct");
    });

    it("reverts when initial deposit exceeds the gross amount", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      const gross = await pledge.grossAmountForPledge(1);
      const tooMuch = gross + UNITS(1);
      await usdc.connect(payer).approve(pledgeAddr, tooMuch);
      await expect(pledge.connect(payer).submitDeposit(1, tooMuch))
        .to.be.revertedWithCustomError(pledge, "DepositExceedsTotal");
    });

    it("marks paidDuringGrace when paid after the deadline", async function () {
      const { gross, deposit, deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + DAY);
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      expect((await pledge.getPledge(pledgeId)).paidDuringGrace).to.equal(true);
    });

    it("emits DepositMade", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      const deposit = (gross * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, deposit);
      await expect(pledge.connect(payer).submitDeposit(1, deposit))
        .to.emit(pledge, "DepositMade")
        .withArgs(1, PAYER_ACCT, payer.address, deposit, deposit);
    });

    it("works with a USDT pledge", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge(usdt);
      const remaining = gross - deposit;
      await usdt.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      expect((await pledge.getPledge(pledgeId)).status).to.equal(1); // COMPLETED
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdtAddr)).to.equal(UNITS(150));
    });

    it("any linked wallet on the payer account can top up the same pledge", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge();
      // Link a second payer wallet, fund it, finish the pledge from it.
      await linkWallet(extra, PAYER_ACCT);
      const remaining = gross - deposit;
      await usdc.faucet(extra.address, remaining);
      await usdc.connect(extra).approve(pledgeAddr, remaining);
      await pledge.connect(extra).submitDeposit(pledgeId, remaining);
      expect((await pledge.getPledge(pledgeId)).status).to.equal(1); // COMPLETED
    });

    it("enforces the active pledge limit on the payer", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      for (let i = 0; i < 4; i++) {
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      }
      for (let i = 1; i <= 3; i++) {
        const gross = await pledge.grossAmountForPledge(i);
        const dep = (gross * 40n) / 100n;
        await usdc.connect(payer).approve(pledgeAddr, dep);
        await pledge.connect(payer).submitDeposit(i, dep);
      }
      const gross4 = await pledge.grossAmountForPledge(4);
      const dep4 = (gross4 * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, dep4);
      await expect(pledge.connect(payer).submitDeposit(4, dep4))
        .to.be.revertedWithCustomError(pledge, "DepositLimitReached");
    });

    it("allows full payment when payer is at active pledge limit", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      for (let i = 0; i < 3; i++) {
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      }
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(100), deadline);
      for (let i = 1; i <= 3; i++) {
        const gross = await pledge.grossAmountForPledge(i);
        const dep = (gross * 40n) / 100n;
        await usdc.connect(payer).approve(pledgeAddr, dep);
        await pledge.connect(payer).submitDeposit(i, dep);
      }
      const gross4 = await pledge.grossAmountForPledge(4);
      await usdc.connect(payer).approve(pledgeAddr, gross4);
      await pledge.connect(payer).submitDeposit(4, gross4);
      expect((await pledge.getPledge(4)).status).to.equal(1); // COMPLETED
    });
  });

  // ── claimDefaultedDeposit ─────────────────────────────────────────────────────
  describe("claimDefaultedDeposit", function () {
    it("lets the merchant claim after the grace period, crediting escrow", async function () {
      const { deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(1);
      expect((await pledge.getPledge(1)).status).to.equal(2); // DEFAULTED
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(deposit);
    });

    it("reverts when claimed too early (within grace)", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + DAY);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWithCustomError(pledge, "GraceNotOver");
    });

    it("reverts when claimed after the 45-day claim window", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + DAY);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWithCustomError(pledge, "ClaimWindowExpired");
    });

    it("reverts when nothing has been deposited", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWithCustomError(pledge, "NothingToClaim");
    });

    it("reverts when a different merchant account claims", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      // outsider is merchant-verified but on a different account.
      await expect(pledge.connect(outsider).claimDefaultedDeposit(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(merchant).claimDefaultedDeposit(999))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("emits PledgeDefaulted and FundsCredited", async function () {
      const { deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.emit(pledge, "PledgeDefaulted").withArgs(1, MERCHANT_ACCT, deposit)
        .and.to.emit(pledge, "FundsCredited").withArgs(MERCHANT_ACCT, usdcAddr, deposit, "default_claimed");
    });

    it("records a default against the payer's reputation", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(1);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── reclaimDeposit ────────────────────────────────────────────────────────────
  describe("reclaimDeposit", function () {
    it("lets the payer reclaim to the depositing wallet after the claim window closes", async function () {
      const { deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      const before = await usdc.balanceOf(payer.address);
      await pledge.connect(payer).reclaimDeposit(1);
      expect(await usdc.balanceOf(payer.address) - before).to.equal(deposit);
    });

    it("reverts while the merchant claim window is still open", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + DAY);
      await expect(pledge.connect(payer).reclaimDeposit(1))
        .to.be.revertedWithCustomError(pledge, "ClaimWindowOpen");
    });

    it("reverts when nothing has been deposited", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(payer).reclaimDeposit(1))
        .to.be.revertedWithCustomError(pledge, "NothingToReclaim");
    });

    it("emits DepositReclaimed only (not PledgeDefaulted)", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(payer).reclaimDeposit(1))
        .to.emit(pledge, "DepositReclaimed")
        .and.to.not.emit(pledge, "PledgeDefaulted");
    });

    it("reverts when a wallet on another account reclaims", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(outsider).reclaimDeposit(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(payer).reclaimDeposit(999))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("records a default on payer reputation after reclaim", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await pledge.connect(payer).reclaimDeposit(1);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── extendDeadline ────────────────────────────────────────────────────────────
  describe("extendDeadline", function () {
    it("payer extends with a valid merchant signature", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig);
      expect((await pledge.getPledge(pledgeId)).commitmentDate).to.equal(newDate);
    });

    it("reverts with an invalid signature (signed by outsider)", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [chainId, pledgeAddr, "extend", pledgeId, newDate, deadline, sigExpiry, 0]
      );
      const badSig = await feeRecipient.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, badSig))
        .to.be.revertedWithCustomError(pledge, "InvalidSignature");
    });

    it("reverts when the signature has expired", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "SignatureExpired");
    });

    it("reverts when extending beyond 30 days", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const tooFar = deadline + 40 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, tooFar, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, tooFar, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "ExtensionTooLong");
    });

    it("reverts when extending after the deadline has passed", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + 1);
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "ExtensionTooLate");
    });

    it("reverts when a wallet on another account tries to extend", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(outsider).extendDeadline(pledgeId, newDate, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts when newDate is not later than current deadline", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, deadline, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, deadline, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "ExtensionDateInvalid");
    });

    it("reverts when the same signature is replayed (nonce consumed)", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + 100 * DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig);
      const laterDate = newDate + DAY;
      await expect(pledge.connect(payer).extendDeadline(pledgeId, laterDate, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "InvalidSignature");
    });
  });

  // ── cancelPledge ──────────────────────────────────────────────────────────────
  describe("cancelPledge", function () {
    it("payer cancels and gets full refund with a valid merchant signature", async function () {
      const { deposit, pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      const before = await usdc.balanceOf(payer.address);
      await pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig);
      expect(await usdc.balanceOf(payer.address) - before).to.equal(deposit);
      expect((await pledge.getPledge(pledgeId)).status).to.equal(3); // CANCELLED
    });

    it("cancellation before any deposit gives zero refund", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      const before = await usdc.balanceOf(payer.address);
      await pledge.connect(payer).cancelPledge(1, sigExpiry, sig);
      expect(await usdc.balanceOf(payer.address)).to.equal(before);
      expect((await pledge.getPledge(1)).status).to.equal(3); // CANCELLED
    });

    it("does not count a cancellation against payer reputation", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.defaultCount).to.equal(0);
      expect(rep.totalCount).to.equal(0);
    });

    it("reverts on an invalid cancel signature", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256"],
        [chainId, pledgeAddr, "cancel", pledgeId, sigExpiry, 0]
      );
      const badSig = await feeRecipient.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, badSig))
        .to.be.revertedWithCustomError(pledge, "InvalidSignature");
    });

    it("reverts when called after the deadline", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + 1);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "ExtensionTooLate");
    });

    it("reverts when called by a wallet on another account", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(outsider).cancelPledge(pledgeId, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts when the cancel signature has expired", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "SignatureExpired");
    });

    it("emits PledgeCancelled", async function () {
      const { deposit, pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig))
        .to.emit(pledge, "PledgeCancelled")
        .withArgs(pledgeId, PAYER_ACCT, MERCHANT_ACCT, deposit);
    });
  });

  // ── Withdrawals & escrow ──────────────────────────────────────────────────────
  describe("withdraw", function () {
    it("withdraws instantly when within the daily cap", async function () {
      await fundMerchantEscrow(150); // 150 < 500 cap
      const before = await usdc.balanceOf(merchant.address);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(150));
      expect(await usdc.balanceOf(merchant.address) - before).to.equal(UNITS(150));
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(0);
    });

    it("emits WithdrawalInstant and tracks daily usage", async function () {
      await fundMerchantEscrow(150);
      await expect(pledge.connect(merchant).withdraw(usdcAddr, UNITS(150)))
        .to.emit(pledge, "WithdrawalInstant")
        .withArgs(MERCHANT_ACCT, merchant.address, usdcAddr, UNITS(150));
      expect(await pledge.getDailyUsed(merchant.address, usdcAddr)).to.equal(UNITS(150));
    });

    it("queues a 1h-timelocked withdrawal above the cap (≤ 5×)", async function () {
      await fundMerchantEscrow(600); // 600 > 500 cap, ≤ 2500
      const tx = await pledge.connect(merchant).withdraw(usdcAddr, UNITS(600));
      const rc = await tx.wait();
      const w = await pledge.getPendingWithdrawal(1);
      expect(w.active).to.equal(true);
      expect(w.amount).to.equal(UNITS(600));
      const now = (await ethers.provider.getBlock(rc.blockNumber)).timestamp;
      expect(w.claimableAt).to.equal(BigInt(now) + BigInt(TIMELOCK_1H));
      // Funds debited from escrow immediately.
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(0);
    });

    it("queues a 24h-timelocked withdrawal above 5× the cap", async function () {
      await fundMerchantEscrow(3000); // > 2500
      const tx = await pledge.connect(merchant).withdraw(usdcAddr, UNITS(3000));
      const rc = await tx.wait();
      const w = await pledge.getPendingWithdrawal(1);
      const now = (await ethers.provider.getBlock(rc.blockNumber)).timestamp;
      expect(w.claimableAt).to.equal(BigInt(now) + BigInt(TIMELOCK_24H));
    });

    it("claims a queued withdrawal once the timelock elapses", async function () {
      await fundMerchantEscrow(600);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(600));
      await time.increase(TIMELOCK_1H + 1);
      const before = await usdc.balanceOf(merchant.address);
      await pledge.connect(merchant).claimPendingWithdrawal(1);
      expect(await usdc.balanceOf(merchant.address) - before).to.equal(UNITS(600));
      expect((await pledge.getPendingWithdrawal(1)).active).to.equal(false);
    });

    it("reverts claiming before the timelock elapses", async function () {
      await fundMerchantEscrow(600);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(600));
      await expect(pledge.connect(merchant).claimPendingWithdrawal(1))
        .to.be.revertedWithCustomError(pledge, "TimelockNotElapsed");
    });

    it("cancels a queued withdrawal and restores escrow", async function () {
      await fundMerchantEscrow(600);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(600));
      await pledge.connect(merchant).cancelPendingWithdrawal(1);
      expect((await pledge.getPendingWithdrawal(1)).active).to.equal(false);
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(UNITS(600));
    });

    it("auto-cancels and refunds a queued withdrawal whose source wallet was unlinked", async function () {
      await fundMerchantEscrow(600);
      // Link a second merchant wallet, queue from it, then unlink it.
      await linkWallet(extra, MERCHANT_ACCT);
      // Move escrow withdrawal to `extra` — it shares the account balance.
      await pledge.connect(extra).withdraw(usdcAddr, UNITS(600));
      await pledge.connect(extra).unlinkWallet();
      await time.increase(TIMELOCK_1H + 1);
      await expect(pledge.connect(merchant).claimPendingWithdrawal(1))
        .to.emit(pledge, "WithdrawalCancelled").withArgs(1, MERCHANT_ACCT, "wallet_unlinked");
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(UNITS(600));
    });

    it("reverts withdrawing more than the escrow balance", async function () {
      await fundMerchantEscrow(150);
      await expect(pledge.connect(merchant).withdraw(usdcAddr, UNITS(200)))
        .to.be.revertedWithCustomError(pledge, "InsufficientBalance");
    });

    it("reverts withdrawing on an unlinked wallet", async function () {
      await expect(pledge.connect(feeRecipient).withdraw(usdcAddr, UNITS(1)))
        .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
    });

    it("reverts on a zero amount", async function () {
      await fundMerchantEscrow(150);
      await expect(pledge.connect(merchant).withdraw(usdcAddr, 0))
        .to.be.revertedWithCustomError(pledge, "InvalidAmount");
    });

    it("another wallet on the same account can cancel a pending withdrawal", async function () {
      await fundMerchantEscrow(600);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(600));
      await linkWallet(extra, MERCHANT_ACCT);
      await pledge.connect(extra).cancelPendingWithdrawal(1);
      expect((await pledge.getPendingWithdrawal(1)).active).to.equal(false);
    });

    it("reverts cancelling a pending withdrawal from a foreign account", async function () {
      await fundMerchantEscrow(600);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(600));
      await expect(pledge.connect(outsider).cancelPendingWithdrawal(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });
  });

  describe("setWalletDailyCap", function () {
    it("a configured cap of 0 disables withdrawals", async function () {
      await fundMerchantEscrow(150);
      await pledge.connect(merchant).setWalletDailyCap(usdcAddr, 0);
      await expect(pledge.connect(merchant).withdraw(usdcAddr, UNITS(10)))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("an unlimited cap makes every withdrawal instant", async function () {
      await fundMerchantEscrow(3000);
      await pledge.connect(merchant).setWalletDailyCap(usdcAddr, ethers.MaxUint256);
      const before = await usdc.balanceOf(merchant.address);
      await pledge.connect(merchant).withdraw(usdcAddr, UNITS(3000));
      expect(await usdc.balanceOf(merchant.address) - before).to.equal(UNITS(3000));
    });

    it("emits DailyCapChanged from the default", async function () {
      await expect(pledge.connect(merchant).setWalletDailyCap(usdcAddr, UNITS(1000)))
        .to.emit(pledge, "DailyCapChanged")
        .withArgs(merchant.address, usdcAddr, DEFAULT_DAILY_CAP, UNITS(1000));
    });

    it("getDailyCap returns the default until configured", async function () {
      expect(await pledge.getDailyCap(merchant.address, usdcAddr)).to.equal(DEFAULT_DAILY_CAP);
      await pledge.connect(merchant).setWalletDailyCap(usdcAddr, UNITS(1000));
      expect(await pledge.getDailyCap(merchant.address, usdcAddr)).to.equal(UNITS(1000));
    });

    it("reverts when the caller is not linked", async function () {
      await expect(pledge.connect(feeRecipient).setWalletDailyCap(usdcAddr, UNITS(1000)))
        .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
    });

    it("reverts on an unsupported token", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      await expect(pledge.connect(merchant).setWalletDailyCap(await rogue.getAddress(), UNITS(1000)))
        .to.be.revertedWithCustomError(pledge, "TokenNotSupported");
    });
  });

  // ── sendP2P ───────────────────────────────────────────────────────────────────
  describe("sendP2P", function () {
    it("credits the recipient account's escrow", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(PAYER_ACCT);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount);
      expect(await pledge.getAccountBalance(OUTSIDER_ACCT, usdcAddr)).to.equal(amount);
    });

    it("collects the protocol fee on P2P transfer", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(PAYER_ACCT);
      const gross = amount + (amount * feeBps) / 10000n;
      const fee = gross - amount;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(feeRecipient.address);
      await pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount);
      expect(await usdc.balanceOf(feeRecipient.address) - before).to.equal(fee);
    });

    it("does not affect payer reputation", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(PAYER_ACCT);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.totalCount).to.equal(0);
      expect(rep.onTimeCount).to.equal(0);
    });

    it("emits P2PSent with account context", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(PAYER_ACCT);
      const gross = amount + (amount * feeBps) / 10000n;
      const fee = gross - amount;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount))
        .to.emit(pledge, "P2PSent")
        .withArgs(payer.address, outsider.address, PAYER_ACCT, OUTSIDER_ACCT, usdcAddr, amount, fee);
    });

    it("reverts when the recipient wallet is not registered", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(PAYER_ACCT);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).sendP2P(usdcAddr, feeRecipient.address, amount))
        .to.be.revertedWithCustomError(pledge, "RecipientNotRegistered");
    });

    it("reverts when sending to another wallet on your own account", async function () {
      await linkWallet(extra, PAYER_ACCT);
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(PAYER_ACCT);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).sendP2P(usdcAddr, extra.address, amount))
        .to.be.revertedWithCustomError(pledge, "SelfTransferDisallowed");
    });

    it("reverts on unsupported token", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      await expect(pledge.connect(payer).sendP2P(await rogue.getAddress(), outsider.address, UNITS(100)))
        .to.be.revertedWithCustomError(pledge, "TokenNotSupported");
    });

    it("reverts on zero recipient address", async function () {
      await expect(pledge.connect(payer).sendP2P(usdcAddr, ethers.ZeroAddress, UNITS(100)))
        .to.be.revertedWithCustomError(pledge, "InvalidAddress");
    });

    it("reverts when sending to your own wallet", async function () {
      await expect(pledge.connect(payer).sendP2P(usdcAddr, payer.address, UNITS(100)))
        .to.be.revertedWithCustomError(pledge, "SelfTransferDisallowed");
    });

    it("reverts below minimum amount", async function () {
      await expect(pledge.connect(payer).sendP2P(usdcAddr, outsider.address, UNITS(0.5)))
        .to.be.revertedWithCustomError(pledge, "AmountBelowMinimum");
    });
  });

  // ── Admin functions ───────────────────────────────────────────────────────────
  describe("admin", function () {
    it("only owner can pause", async function () {
      await expect(pledge.connect(outsider).pause()).to.be.reverted;
      await pledge.connect(owner).pause();
    });

    it("blocks createPledge while paused", async function () {
      await pledge.connect(owner).pause();
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline)
      ).to.be.reverted;
    });

    it("unpause restores functionality", async function () {
      await pledge.connect(owner).pause();
      await pledge.connect(owner).unpause();
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
      expect(await pledge.pledgeCounter()).to.equal(1);
    });

    it("owner can update fee recipient", async function () {
      await pledge.connect(owner).setFeeRecipient(outsider.address);
      expect(await pledge.feeRecipient()).to.equal(outsider.address);
    });

    it("reverts setting fee recipient to zero", async function () {
      await expect(pledge.connect(owner).setFeeRecipient(ethers.ZeroAddress))
        .to.be.revertedWithCustomError(pledge, "InvalidAddress");
    });

    it("owner can add a new token to the whitelist", async function () {
      const newToken = await (await ethers.getContractFactory("MockUSDC")).deploy();
      await pledge.connect(owner).setTokenAllowed(await newToken.getAddress(), true);
      expect(await pledge.allowedTokens(await newToken.getAddress())).to.equal(true);
    });

    it("owner can remove a token from the whitelist", async function () {
      await pledge.connect(owner).setTokenAllowed(usdtAddr, false);
      expect(await pledge.allowedTokens(usdtAddr)).to.equal(false);
    });

    it("reverts setTokenAllowed with zero address", async function () {
      await expect(pledge.connect(owner).setTokenAllowed(ethers.ZeroAddress, true))
        .to.be.revertedWithCustomError(pledge, "InvalidAddress");
    });

    it("removed token cannot be used in new pledges", async function () {
      await pledge.connect(owner).setTokenAllowed(usdtAddr, false);
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdtAddr, PAYER_ACCT, UNITS(150), deadline)
      ).to.be.revertedWithCustomError(pledge, "TokenNotSupported");
    });

    it("non-owner cannot change token whitelist", async function () {
      await expect(pledge.connect(outsider).setTokenAllowed(usdcAddr, false))
        .to.be.reverted;
    });

    it("emits TokenAllowanceSet when whitelist changes", async function () {
      await expect(pledge.connect(owner).setTokenAllowed(usdtAddr, false))
        .to.emit(pledge, "TokenAllowanceSet")
        .withArgs(usdtAddr, false);
    });
  });

  // ── Multi-token & unified reputation ─────────────────────────────────────────
  describe("multi-token unified reputation", function () {
    it("USDC pledge completion builds reputation that applies to USDT pledges", async function () {
      const total = UNITS(100);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).submitDeposit(1, gross);

      expect(await pledge.getServiceFeeBps(PAYER_ACCT)).to.equal(75);
      expect(await pledge.getAccountRequiredDepositPct(PAYER_ACCT)).to.equal(20);
      expect(await pledge.getAccountMaxActivePledges(PAYER_ACCT)).to.equal(5);

      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdtAddr, PAYER_ACCT, total, deadline2);
      const usdtGross = await pledge.grossAmountForPledge(2);
      const usdtDeposit = (usdtGross * 20n) / 100n + 1n;
      await usdt.connect(payer).approve(pledgeAddr, usdtDeposit);
      await pledge.connect(payer).submitDeposit(2, usdtDeposit);
      expect((await pledge.getPledge(2)).token).to.equal(usdtAddr);
    });

    it("USDT default reduces trust score affecting USDC pledge requirements", async function () {
      const total = UNITS(10);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline1);
      const gross1 = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross1);
      await pledge.connect(payer).submitDeposit(1, gross1);

      const largeTotal = UNITS(40);
      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdtAddr, PAYER_ACCT, largeTotal, deadline2);
      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      await usdt.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      // Displayed score is floored at the KYC baseline (5000); verify the underlying
      // weighted reputation degraded once the floor is removed.
      const rep = await pledge.accountReputation(PAYER_ACCT);
      const behavioral = rep.totalWeight > 0n ? rep.weightedScore / rep.totalWeight : 0n;
      expect(behavioral).to.be.lt(5000n);
      expect(await pledge.getAccountRequiredDepositPct(PAYER_ACCT)).to.be.gte(30);
    });
  });

  // ── Views and fee tiers ───────────────────────────────────────────────────────
  describe("views and fee tiers", function () {
    it("KYC-verified payer gets the standard 1% fee", async function () {
      expect(await pledge.getServiceFeeBps(PAYER_ACCT)).to.equal(100);
    });

    it("KYC-verified payer gets the MID 30% deposit tier", async function () {
      expect(await pledge.getAccountRequiredDepositPct(PAYER_ACCT)).to.equal(30);
    });

    it("KYC-verified payer gets the MID active limit of 3", async function () {
      expect(await pledge.getAccountMaxActivePledges(PAYER_ACCT)).to.equal(3);
    });

    it("unverified account gets the RISK 50% deposit tier and lowest cap", async function () {
      expect(await pledge.getAccountRequiredDepositPct(FRESH_ACCT)).to.equal(50);
      expect(await pledge.getAccountMaxActivePledges(FRESH_ACCT)).to.equal(2);
      expect(await pledge.getAccountTrustScore(FRESH_ACCT)).to.equal(0);
    });

    it("getPledge reverts on a nonexistent pledge", async function () {
      await expect(pledge.getPledge(999)).to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("grossAmountForPledge reverts on a nonexistent pledge", async function () {
      await expect(pledge.grossAmountForPledge(999)).to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("grossAmountForPledge returns correct gross for an existing pledge", async function () {
      const { gross } = await createStandardPledge();
      expect(await pledge.grossAmountForPledge(1)).to.equal(gross);
    });

    it("getAccountTrustScore returns the KYC baseline for a verified account", async function () {
      expect(await pledge.getAccountTrustScore(PAYER_ACCT)).to.equal(5000);
    });

    it("pagination returns the correct slice", async function () {
      await createStandardPledge();
      await createStandardPledge();
      const [page, total] = await pledge.getAccountPayerPledgesPaginated(PAYER_ACCT, 0, 1);
      expect(total).to.equal(2);
      expect(page.length).to.equal(1);
    });

    it("pagination handles offset beyond range", async function () {
      await createStandardPledge();
      const [page, total] = await pledge.getAccountPayerPledgesPaginated(PAYER_ACCT, 5, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(0);
    });

    it("getAccountPayerPledges returns all pledge IDs assigned to the payer", async function () {
      await createStandardPledge();
      await createStandardPledge();
      const ids = await pledge.getAccountPayerPledges(PAYER_ACCT);
      expect(ids.length).to.equal(2);
    });

    it("getAccountMerchantPledges returns pledges created by the merchant", async function () {
      await createStandardPledge();
      const ids = await pledge.getAccountMerchantPledges(MERCHANT_ACCT);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getAccountMerchantPledgesPaginated works correctly", async function () {
      await createStandardPledge();
      const [page, total] = await pledge.getAccountMerchantPledgesPaginated(MERCHANT_ACCT, 0, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(1);
    });

    it("quoteGrossAmount adds the 1% fee for a new payer", async function () {
      expect(await pledge.quoteGrossAmount(PAYER_ACCT, UNITS(100))).to.equal(UNITS(101));
    });

    it("high-trust payer gets 0.75% loyalty fee after full on-time payment", async function () {
      const total = UNITS(100);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).submitDeposit(1, gross);
      expect(await pledge.getServiceFeeBps(PAYER_ACCT)).to.equal(75);
      expect(await pledge.getAccountRequiredDepositPct(PAYER_ACCT)).to.equal(20);
      expect(await pledge.getAccountMaxActivePledges(PAYER_ACCT)).to.equal(5);
    });

    it("mid-trust payer (50% score) gets 3 active pledge slots", async function () {
      const total = UNITS(100);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline1);
      const gross1 = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross1);
      await pledge.connect(payer).submitDeposit(1, gross1);

      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline2);
      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      await usdc.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      expect(await pledge.getAccountTrustScore(PAYER_ACCT)).to.equal(5000);
      expect(await pledge.getAccountMaxActivePledges(PAYER_ACCT)).to.equal(3);
    });

    it("low-trust payer (20-49% score) requires 40% deposit", async function () {
      const deadline1 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(10), deadline1);
      const gross1 = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross1);
      await pledge.connect(payer).submitDeposit(1, gross1);

      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(40), deadline2);
      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      await usdc.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
      const score = await pledge.getAccountTrustScore(PAYER_ACCT);
      expect(score).to.be.gte(2000n);
      expect(score).to.be.lt(5000n);
      expect(await pledge.getAccountRequiredDepositPct(PAYER_ACCT)).to.equal(40);
    });

    it("serial defaulter (3 defaults) is capped at 2 active pledges", async function () {
      for (let i = 0; i < 3; i++) {
        const deadline = (await time.latest()) + 30 * DAY;
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, UNITS(150), deadline);
        const pledgeId = i + 1;
        const gross = await pledge.grossAmountForPledge(pledgeId);
        const requiredPct = await pledge.getAccountRequiredDepositPct(PAYER_ACCT);
        const deposit = (gross * requiredPct) / 100n + 1n;
        await usdc.connect(payer).approve(pledgeAddr, deposit);
        await pledge.connect(payer).submitDeposit(pledgeId, deposit);
        await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).claimDefaultedDeposit(pledgeId);
      }
      expect(await pledge.getAccountMaxActivePledges(PAYER_ACCT)).to.equal(2);
    });

    it("MockUSDC decimals() returns 6", async function () {
      expect(await usdc.decimals()).to.equal(6);
    });

    it("MockUSDC mints 1M tokens to deployer on construction", async function () {
      expect(await usdc.balanceOf(owner.address)).to.equal(ethers.parseUnits("1000000", 6));
    });

    it("MockUSDC reverts when faucet amount exceeds MAX_FAUCET", async function () {
      const maxFaucet = await usdc.MAX_FAUCET();
      await expect(usdc.faucet(payer.address, maxFaucet + 1n))
        .to.be.revertedWith("Faucet: amount too large");
    });
  });

  // ── createRecurringPledge ─────────────────────────────────────────────────────
  describe("createRecurringPledge", function () {
    it("merchant creates a recurring pledge targeting the payer account", async function () {
      const { amount, firstDueDate, periods } = await createStandardRecurring();
      const rp = await pledge.getRecurringPledge(1);
      expect(rp.merchantAccount).to.equal(MERCHANT_ACCT);
      expect(rp.payerAccount).to.equal(PAYER_ACCT);
      expect(rp.token).to.equal(usdcAddr);
      expect(rp.amountPerPeriod).to.equal(amount);
      expect(rp.totalPeriods).to.equal(periods);
      expect(rp.periodsCompleted).to.equal(0);
      expect(rp.missedCount).to.equal(0);
      expect(rp.totalMissedDebt).to.equal(0);
      expect(rp.nextDueDate).to.equal(firstDueDate);
      expect(rp.status).to.equal(0); // ACTIVE
    });

    it("does NOT increment payer's activePledgeCount at creation", async function () {
      await createStandardRecurring();
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(0);
    });

    it("increments payer's activePledgeCount on first installment payment", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(1);
    });

    it("emits RecurringPledgeCreated", async function () {
      const amount = UNITS(100);
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, PAYER_ACCT, amount, INTERVAL_30D, 3, firstDueDate)
      ).to.emit(pledge, "RecurringPledgeCreated");
    });

    it("reverts on unsupported token", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(await rogue.getAddress(), PAYER_ACCT, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "TokenNotSupported");
    });

    it("reverts on zero payer account", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, ethers.ZeroHash, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "InvalidAccountId");
    });

    it("reverts when merchant account is also the payer account", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, MERCHANT_ACCT, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "SelfTransferDisallowed");
    });

    it("reverts when amount is below minimum", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(0.5), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "AmountBelowMinimum");
    });

    it("reverts when interval is below 7 days", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(100), INTERVAL_7D - 1, 3, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "IntervalTooShort");
    });

    it("reverts when totalPeriods is zero", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(100), INTERVAL_30D, 0, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "InvalidPeriodCount");
    });

    it("reverts when totalPeriods exceeds 12", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(100), INTERVAL_30D, 13, firstDueDate)
      ).to.be.revertedWithCustomError(pledge, "InvalidPeriodCount");
    });

    it("reverts when firstDueDate is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(100), INTERVAL_30D, 3, past)
      ).to.be.revertedWithCustomError(pledge, "CommitmentInPast");
    });

    it("reverts on first installment when payer active pledge limit is reached", async function () {
      await createStandardPledge();
      await createStandardPledge();
      await createStandardPledge();
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(3);

      const r = await createStandardRecurring();
      await time.increaseTo(r.firstDueDate);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = r.amount + (r.amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
        .to.be.revertedWithCustomError(pledge, "DepositLimitReached");
    });

    it("getRecurringPledge reverts on nonexistent id", async function () {
      await expect(pledge.getRecurringPledge(999)).to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });
  });

  // ── payInstallment ────────────────────────────────────────────────────────────
  describe("payInstallment", function () {
    it("payer pays the first installment, crediting merchant escrow", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(amount);
    });

    it("increments periodsCompleted and advances nextDueDate", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      const rp = await pledge.recurringPledges(1);
      expect(rp.periodsCompleted).to.equal(1);
      expect(rp.nextDueDate).to.equal(BigInt(firstDueDate) + BigInt(INTERVAL_30D));
    });

    it("emits InstallmentPaid", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
        .to.emit(pledge, "InstallmentPaid")
        .withArgs(1, PAYER_ACCT, 1, amount);
    });

    it("allows early payment before the due date", async function () {
      const { amount } = await createStandardRecurring();
      await payInstallment(1, amount);
      const rp = await pledge.recurringPledges(1);
      expect(rp.periodsCompleted).to.equal(1);
    });

    it("marks late when paid after due date but within grace", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + DAY);
      await payInstallment(1, amount);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.lateCount).to.equal(1);
    });

    it("collects fee on each installment", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      const before = await usdc.balanceOf(feeRecipient.address);
      await payInstallment(1, amount);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const expectedFee = (amount * feeBps) / 10000n;
      expect(await usdc.balanceOf(feeRecipient.address) - before).to.equal(expectedFee);
    });

    it("auto-completes when last period is paid with no missed debt", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      await time.increase(INTERVAL_30D);
      await payInstallment(1, amount);
      const rp = await pledge.recurringPledges(1);
      expect(rp.status).to.equal(2); // COMPLETED
    });

    it("moves to PENDING_SETTLEMENT when last period is paid but debt exists", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      await time.increaseTo(firstDueDate + INTERVAL_30D);
      await payInstallment(1, amount);
      const rp = await pledge.recurringPledges(1);
      expect(rp.status).to.equal(1); // PENDING_SETTLEMENT
    });

    it("reverts after grace period ends", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
        .to.be.revertedWithCustomError(pledge, "GraceEnded");
    });

    it("reverts when called by non-payer", async function () {
      await createStandardRecurring();
      await expect(pledge.connect(outsider).payInstallment(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(payer).payInstallment(999))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("reverts when pledge is no longer active", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
        .to.be.revertedWithCustomError(pledge, "PledgeNotActive");
    });
  });

  // ── markMissedInstallment ─────────────────────────────────────────────────────
  describe("markMissedInstallment", function () {
    it("records missed installment and advances schedule", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const rp = await pledge.recurringPledges(1);
      expect(rp.missedCount).to.equal(1);
      expect(rp.totalMissedDebt).to.equal(UNITS(100));
      expect(rp.nextDueDate).to.equal(BigInt(firstDueDate) + BigInt(INTERVAL_30D));
    });

    it("does NOT damage reputation when payer has never engaged", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);

      await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.defaultCount).to.equal(0);
      expect(rep.basisPoints).to.equal(0);
      const rp = await pledge.recurringPledges(1);
      expect(rp.missedCount).to.equal(1);
    });

    it("drags the trust score per miss only after the payer engages", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      const repBefore = await pledge.getAccountReputation(PAYER_ACCT);

      await time.increaseTo(firstDueDate + INTERVAL_30D + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const repAfter = await pledge.getAccountReputation(PAYER_ACCT);
      expect(repAfter.defaultCount).to.equal(0);
      expect(repAfter.basisPoints).to.be.lt(repBefore.basisPoints);
    });

    it("emits InstallmentMissed", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(merchant).markMissedInstallment(1))
        .to.emit(pledge, "InstallmentMissed")
        .withArgs(1, 1, UNITS(100));
    });

    it("only defaults that period — schedule continues for next period", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      await time.increaseTo(firstDueDate + INTERVAL_30D);
      await payInstallment(1, amount);
      const rp = await pledge.recurringPledges(1);
      expect(rp.periodsCompleted).to.equal(1);
      expect(rp.missedCount).to.equal(1);
      expect(rp.status).to.equal(0); // still ACTIVE
    });

    it("moves to PENDING_SETTLEMENT when last period is missed", async function () {
      const { firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const rp = await pledge.recurringPledges(1);
      expect(rp.status).to.equal(1); // PENDING_SETTLEMENT
    });

    it("reverts before grace period ends", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + DAY);
      await expect(pledge.connect(merchant).markMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "GraceNotOver");
    });

    it("reverts when called by a non-merchant account", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(outsider).markMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(merchant).markMissedInstallment(999))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("reverts when pledge is no longer active", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      await expect(pledge.connect(merchant).markMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "PledgeNotActive");
    });
  });

  // ── payMissedInstallment ──────────────────────────────────────────────────────
  describe("payMissedInstallment", function () {
    async function createMissedRecurring() {
      const { amount, firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      return { amount, firstDueDate };
    }

    it("payer catches up on a missed installment mid-contract", async function () {
      const { amount } = await createMissedRecurring();
      const merchantBefore = await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).payMissedInstallment(1);

      const rp = await pledge.recurringPledges(1);
      expect(rp.missedCount).to.equal(0);
      expect(rp.totalMissedDebt).to.equal(0);
      expect(rp.periodsCompleted).to.equal(1);
      expect(rp.status).to.equal(0); // still ACTIVE
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr)).to.equal(merchantBefore + amount);
    });

    it("counts a made-up payment as LATE for reputation purposes", async function () {
      const { amount } = await createMissedRecurring();
      const repBefore = await pledge.getAccountReputation(PAYER_ACCT);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).payMissedInstallment(1);

      const repAfter = await pledge.getAccountReputation(PAYER_ACCT);
      expect(repAfter.lateCount).to.equal(repBefore.lateCount + 1n);
      expect(repAfter.basisPoints).to.be.gte(repBefore.basisPoints);
    });

    it("emits InstallmentPaid", async function () {
      const { amount } = await createMissedRecurring();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.emit(pledge, "InstallmentPaid");
    });

    it("reverts when caller is on another account", async function () {
      const { amount } = await createMissedRecurring();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.faucet(outsider.address, gross);
      await usdc.connect(outsider).approve(pledgeAddr, gross);
      await expect(pledge.connect(outsider).payMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts when there are no missed installments", async function () {
      await createStandardRecurring(3);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "NoMissedInstallments");
    });

    it("reverts on a non-ACTIVE recurring pledge", async function () {
      const { firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "PledgeNotActive");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(payer).payMissedInstallment(999))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });

    it("takes an active slot when used as first engagement", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(0);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).payMissedInstallment(1);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(1);
    });

    it("reverts on first engagement if payer is at slot cap", async function () {
      await createStandardPledge();
      await createStandardPledge();
      await createStandardPledge();
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(3);

      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.be.revertedWithCustomError(pledge, "DepositLimitReached");
    });
  });

  // ── settleDebt ────────────────────────────────────────────────────────────────
  describe("settleDebt", function () {
    async function createPendingSettlement() {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      return { amount };
    }

    it("payer settles debt and releases full amount to merchant escrow", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      const before = await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr);
      await pledge.connect(payer).settleDebt(1);
      expect(await pledge.getAccountBalance(MERCHANT_ACCT, usdcAddr) - before).to.equal(amount);
    });

    it("marks the pledge as COMPLETED after settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).settleDebt(1);
      expect((await pledge.recurringPledges(1)).status).to.equal(2); // COMPLETED
    });

    it("clears totalMissedDebt after settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).settleDebt(1);
      expect((await pledge.recurringPledges(1)).totalMissedDebt).to.equal(0);
    });

    it("emits DebtSettled and RecurringPledgeCompleted", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).settleDebt(1))
        .to.emit(pledge, "DebtSettled")
        .and.to.emit(pledge, "RecurringPledgeCompleted");
    });

    it("decrements payer activePledgeCount after settlement", async function () {
      // Engage first so a slot is taken (settleDebt only decrements when periodsCompleted > 0).
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(1);
      // Miss the final period → PENDING_SETTLEMENT.
      await time.increaseTo(firstDueDate + INTERVAL_30D + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).settleDebt(1);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(0);
    });

    it("collects fee on settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      const expectedFee = (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(feeRecipient.address);
      await pledge.connect(payer).settleDebt(1);
      expect(await usdc.balanceOf(feeRecipient.address) - before).to.equal(expectedFee);
    });

    it("reverts when called by another account", async function () {
      await createPendingSettlement();
      await expect(pledge.connect(outsider).settleDebt(1))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts when status is not PENDING_SETTLEMENT", async function () {
      await createStandardRecurring();
      await expect(pledge.connect(payer).settleDebt(1))
        .to.be.revertedWithCustomError(pledge, "PledgeNotInSettlement");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(payer).settleDebt(999))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });
  });

  // ── cancelRecurring ───────────────────────────────────────────────────────────
  describe("cancelRecurring", function () {
    it("payer cancels with a valid merchant signature", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      expect((await pledge.recurringPledges(1)).status).to.equal(3); // CANCELLED
    });

    it("forgives missed debt on cancellation", async function () {
      const { firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      expect((await pledge.recurringPledges(1)).totalMissedDebt).to.equal(0);
      expect((await pledge.recurringPledges(1)).status).to.equal(3); // CANCELLED
    });

    it("decrements payer activePledgeCount on cancellation after engagement", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(1);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(0);
    });

    it("can cancel a PENDING_SETTLEMENT pledge", async function () {
      const { firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      expect((await pledge.recurringPledges(1)).status).to.equal(1); // PENDING_SETTLEMENT
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      expect((await pledge.recurringPledges(1)).status).to.equal(3); // CANCELLED
    });

    it("emits RecurringPledgeCancelled", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, sig))
        .to.emit(pledge, "RecurringPledgeCancelled");
    });

    it("reverts with an invalid signature", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256"],
        [chainId, pledgeAddr, "cancelRecurring", 1, sigExpiry, 0]
      );
      const badSig = await feeRecipient.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, badSig))
        .to.be.revertedWithCustomError(pledge, "InvalidSignature");
    });

    it("reverts when signature has expired", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "SignatureExpired");
    });

    it("reverts when called by another account", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(outsider).cancelRecurring(1, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "NotAuthorized");
    });

    it("reverts when already cancelled", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      const sig2 = await signCancelRecurring(1, sigExpiry, 1);
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, sig2))
        .to.be.revertedWithCustomError(pledge, "PledgeNotCancellable");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(999, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelRecurring(999, sigExpiry, sig))
        .to.be.revertedWithCustomError(pledge, "PledgeMissing");
    });
  });

  // ── Recurring reputation ──────────────────────────────────────────────────────
  describe("recurring pledge reputation", function () {
    it("builds partial reputation per on-time installment", async function () {
      const { amount } = await createStandardRecurring(3);
      await payInstallment(1, amount);
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.onTimeCount).to.equal(1);
    });

    it("grants completion bonus when all periods paid with no debt", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      await time.increase(INTERVAL_30D);
      await payInstallment(1, amount);
      expect(await pledge.getAccountTrustScore(PAYER_ACCT)).to.be.gt(0);
    });

    it("no completion bonus until settleDebt is called on a missed pledge", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      await time.increaseTo(firstDueDate + INTERVAL_30D);
      await payInstallment(1, amount);
      const scoreBefore = await pledge.getAccountTrustScore(PAYER_ACCT);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).settleDebt(1);
      const scoreAfter = await pledge.getAccountTrustScore(PAYER_ACCT);
      expect(scoreAfter).to.be.gte(scoreBefore);
    });

    it("missed installments drag the score but defaultCount only ticks at contract end", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);

      let due = firstDueDate + INTERVAL_30D;
      for (let i = 0; i < 2; i++) {
        await time.increaseTo(due + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).markMissedInstallment(1);
        due += INTERVAL_30D;
      }
      const rep = await pledge.getAccountReputation(PAYER_ACCT);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── Recurring view functions ──────────────────────────────────────────────────
  describe("recurring view functions", function () {
    it("getAccountPayerRecurringPledges returns correct ids", async function () {
      await createStandardRecurring();
      const ids = await pledge.getAccountPayerRecurringPledges(PAYER_ACCT);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getAccountMerchantRecurringPledges returns correct ids", async function () {
      await createStandardRecurring();
      const ids = await pledge.getAccountMerchantRecurringPledges(MERCHANT_ACCT);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getAccountPayerRecurringPledgesPaginated returns correct slice", async function () {
      await createStandardRecurring();
      await createStandardRecurring();
      const [page, total] = await pledge.getAccountPayerRecurringPledgesPaginated(PAYER_ACCT, 0, 1);
      expect(total).to.equal(2);
      expect(page.length).to.equal(1);
    });

    it("getAccountMerchantRecurringPledgesPaginated handles offset beyond range", async function () {
      await createStandardRecurring();
      const [page, total] = await pledge.getAccountMerchantRecurringPledgesPaginated(MERCHANT_ACCT, 5, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(0);
    });
  });

  // ── Additional guard coverage ─────────────────────────────────────────────────
  // Reachable auth/state revert paths and view bounds not exercised by the happy-path
  // and primary revert tests above. Grouped here to keep the per-function blocks focused.
  describe("additional guard coverage", function () {
    describe("withdraw / caps", function () {
      it("withdraw reverts on an unsupported token", async function () {
        const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
        await expect(pledge.connect(merchant).withdraw(await rogue.getAddress(), UNITS(1)))
          .to.be.revertedWithCustomError(pledge, "TokenNotSupported");
      });

      it("setWalletDailyCap reports the previous configured cap as oldCap when reconfigured", async function () {
        await pledge.connect(merchant).setWalletDailyCap(usdcAddr, UNITS(1000));
        await expect(pledge.connect(merchant).setWalletDailyCap(usdcAddr, UNITS(2000)))
          .to.emit(pledge, "DailyCapChanged")
          .withArgs(merchant.address, usdcAddr, UNITS(1000), UNITS(2000));
      });

      it("getPendingWithdrawal reverts on id 0", async function () {
        await expect(pledge.getPendingWithdrawal(0))
          .to.be.revertedWithCustomError(pledge, "PledgeMissing");
      });

      it("getPendingWithdrawal reverts on an out-of-range id", async function () {
        await expect(pledge.getPendingWithdrawal(999))
          .to.be.revertedWithCustomError(pledge, "PledgeMissing");
      });
    });

    describe("createRecurringPledge gating", function () {
      it("reverts when the caller wallet is not linked", async function () {
        const firstDueDate = (await time.latest()) + INTERVAL_30D;
        await expect(
          pledge.connect(feeRecipient).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(100), INTERVAL_30D, 3, firstDueDate)
        ).to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("reverts when the merchant account is not verified", async function () {
        await linkWallet(extra, FRESH_ACCT);
        const firstDueDate = (await time.latest()) + INTERVAL_30D;
        await expect(
          pledge.connect(extra).createRecurringPledge(usdcAddr, PAYER_ACCT, UNITS(100), INTERVAL_30D, 3, firstDueDate)
        ).to.be.revertedWithCustomError(pledge, "MerchantNotVerified");
      });

      it("reverts when the payer account is not verified", async function () {
        const firstDueDate = (await time.latest()) + INTERVAL_30D;
        await expect(
          pledge.connect(merchant).createRecurringPledge(usdcAddr, FRESH_ACCT, UNITS(100), INTERVAL_30D, 3, firstDueDate)
        ).to.be.revertedWithCustomError(pledge, "PayerNotVerified");
      });
    });

    describe("claimDefaultedDeposit gating", function () {
      it("reverts when the caller wallet is not linked", async function () {
        const { deadline } = await createStandardPledge();
        await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
        await expect(pledge.connect(feeRecipient).claimDefaultedDeposit(1))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("reverts when the caller account is not merchant-verified", async function () {
        const { deadline } = await createStandardPledge();
        await linkWallet(extra, FRESH_ACCT);
        await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
        await expect(pledge.connect(extra).claimDefaultedDeposit(1))
          .to.be.revertedWithCustomError(pledge, "MerchantNotVerified");
      });

      it("reverts on a non-PENDING pledge (already completed)", async function () {
        const total = UNITS(150);
        const deadline = (await time.latest()) + 30 * DAY;
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
        const gross = await pledge.grossAmountForPledge(1);
        await usdc.connect(payer).approve(pledgeAddr, gross);
        await pledge.connect(payer).submitDeposit(1, gross);
        await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
          .to.be.revertedWithCustomError(pledge, "PledgeNotPending");
      });
    });

    describe("reclaimDeposit gating", function () {
      it("reverts on a non-PENDING pledge", async function () {
        const total = UNITS(150);
        const deadline = (await time.latest()) + 30 * DAY;
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
        const gross = await pledge.grossAmountForPledge(1);
        await usdc.connect(payer).approve(pledgeAddr, gross);
        await pledge.connect(payer).submitDeposit(1, gross); // COMPLETED
        await expect(pledge.connect(payer).reclaimDeposit(1))
          .to.be.revertedWithCustomError(pledge, "PledgeNotPending");
      });
    });

    describe("extendDeadline gating", function () {
      it("reverts when the caller wallet is not linked", async function () {
        const { deadline, pledgeId } = await createStandardPledge();
        const newDate = deadline + 20 * DAY;
        const sigExpiry = (await time.latest()) + DAY;
        const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
        await expect(pledge.connect(feeRecipient).extendDeadline(pledgeId, newDate, sigExpiry, sig))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("reverts on a nonexistent pledge", async function () {
        const newDate = (await time.latest()) + 40 * DAY;
        const sigExpiry = (await time.latest()) + DAY;
        const sig = await signExtension(999, newDate, 0, sigExpiry, 0);
        await expect(pledge.connect(payer).extendDeadline(999, newDate, sigExpiry, sig))
          .to.be.revertedWithCustomError(pledge, "PledgeMissing");
      });

      it("reverts on a non-PENDING pledge", async function () {
        const total = UNITS(150);
        const deadline = (await time.latest()) + 30 * DAY;
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
        const gross = await pledge.grossAmountForPledge(1);
        await usdc.connect(payer).approve(pledgeAddr, gross);
        await pledge.connect(payer).submitDeposit(1, gross); // COMPLETED, deadline still future
        const newDate = deadline + 20 * DAY;
        const sigExpiry = (await time.latest()) + DAY;
        const sig = await signExtension(1, newDate, deadline, sigExpiry, 0);
        await expect(pledge.connect(payer).extendDeadline(1, newDate, sigExpiry, sig))
          .to.be.revertedWithCustomError(pledge, "PledgeNotPending");
      });
    });

    describe("cancelPledge gating", function () {
      it("reverts on a nonexistent pledge", async function () {
        const sigExpiry = (await time.latest()) + DAY;
        const sig = await signCancel(999, sigExpiry, 0);
        await expect(pledge.connect(payer).cancelPledge(999, sigExpiry, sig))
          .to.be.revertedWithCustomError(pledge, "PledgeMissing");
      });

      it("reverts on a non-PENDING pledge", async function () {
        const total = UNITS(150);
        const deadline = (await time.latest()) + 30 * DAY;
        await pledge.connect(merchant).createPledge(usdcAddr, PAYER_ACCT, total, deadline);
        const gross = await pledge.grossAmountForPledge(1);
        await usdc.connect(payer).approve(pledgeAddr, gross);
        await pledge.connect(payer).submitDeposit(1, gross); // COMPLETED
        const sigExpiry = (await time.latest()) + DAY;
        const sig = await signCancel(1, sigExpiry, 0);
        await expect(pledge.connect(payer).cancelPledge(1, sigExpiry, sig))
          .to.be.revertedWithCustomError(pledge, "PledgeNotPending");
      });
    });

    describe("payInstallment / payMissedInstallment / settleDebt gating", function () {
      it("payInstallment reverts when the caller wallet is not linked", async function () {
        await createStandardRecurring();
        await expect(pledge.connect(feeRecipient).payInstallment(1))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("payInstallment reverts when the payer account is not verified", async function () {
        await createStandardRecurring();
        await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
        await expect(pledge.connect(payer).payInstallment(1))
          .to.be.revertedWithCustomError(pledge, "PayerNotVerified");
      });

      it("payMissedInstallment reverts when the caller wallet is not linked", async function () {
        await createStandardRecurring();
        await expect(pledge.connect(feeRecipient).payMissedInstallment(1))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("payMissedInstallment reverts when the payer account is not verified", async function () {
        await createStandardRecurring();
        await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
        await expect(pledge.connect(payer).payMissedInstallment(1))
          .to.be.revertedWithCustomError(pledge, "PayerNotVerified");
      });

      it("payMissedInstallment after prior engagement does not consume a new active slot", async function () {
        // Engage (period 1), then miss period 2 and catch up — exercises the
        // firstEngagement == false branch (no new slot, no totalWeight bump).
        const { amount, firstDueDate } = await createStandardRecurring(3);
        await time.increaseTo(firstDueDate);
        await payInstallment(1, amount); // periodsCompleted = 1
        const activeBefore = await pledge.accountActivePledgeCount(PAYER_ACCT);

        await time.increaseTo(firstDueDate + INTERVAL_30D + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).markMissedInstallment(1);

        const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
        const gross = amount + (amount * feeBps) / 10000n;
        await usdc.connect(payer).approve(pledgeAddr, gross);
        await pledge.connect(payer).payMissedInstallment(1);

        const rp = await pledge.recurringPledges(1);
        expect(rp.missedCount).to.equal(0);
        expect(rp.periodsCompleted).to.equal(2);
        expect(await pledge.accountActivePledgeCount(PAYER_ACCT)).to.equal(activeBefore);
      });

      it("settleDebt reverts when the caller wallet is not linked", async function () {
        await createStandardRecurring();
        await expect(pledge.connect(feeRecipient).settleDebt(1))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });

      it("settleDebt reverts when the payer account is not verified", async function () {
        await createStandardRecurring();
        await pledge.connect(owner).setVerificationBaseline(PAYER_ACCT, 0);
        await expect(pledge.connect(payer).settleDebt(1))
          .to.be.revertedWithCustomError(pledge, "PayerNotVerified");
      });
    });

    describe("sendP2P gating", function () {
      it("reverts when the sender wallet is not linked", async function () {
        await expect(pledge.connect(feeRecipient).sendP2P(usdcAddr, payer.address, UNITS(10)))
          .to.be.revertedWithCustomError(pledge, "WalletNotLinked");
      });
    });
  });
});

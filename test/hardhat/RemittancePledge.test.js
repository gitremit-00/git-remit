// test/RemittancePledge.test.js
// Hardhat test suite for RemittancePledge — targets 100% branch coverage.
// Run:  npx hardhat test
// Cover: npx hardhat coverage

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ── Constants mirrored from the contract ──────────────────────────────────────
const UNITS = (n) => ethers.parseUnits(n.toString(), 6); // 6-decimal token amount
const GRACE_PERIOD = 3 * 24 * 60 * 60;
const CLAIM_WINDOW = 30 * 24 * 60 * 60;
const TIME_BUFFER = 15 * 60;
const DAY = 24 * 60 * 60;
const INTERVAL_30D = 30 * DAY;
const INTERVAL_7D  = 7 * DAY;

describe("RemittancePledge", function () {
  let usdc, usdt, pledge;
  let owner, sender, merchant, feeRecipient, outsider;
  let usdcAddr, usdtAddr, pledgeAddr;

  // Helper: merchant signs an extension approval
  async function signExtension(pledgeId, newDate, oldDate, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
      [
        (await ethers.provider.getNetwork()).chainId,
        pledgeAddr,
        "extend",
        pledgeId,
        newDate,
        oldDate,
        sigExpiry,
        nonce,
      ]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // Helper: merchant signs a recurring cancellation approval
  async function signCancelRecurring(recurringId, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256"],
      [
        (await ethers.provider.getNetwork()).chainId,
        pledgeAddr,
        "cancelRecurring",
        recurringId,
        sigExpiry,
        nonce,
      ]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // Helper: create a standard recurring pledge (100/month, 30d interval, 3 periods)
  async function createStandardRecurring(periods = 3, amountPerPeriod = 100) {
    const amount = UNITS(amountPerPeriod);
    const firstDueDate = (await time.latest()) + INTERVAL_30D;
    await pledge
      .connect(sender)
      .createRecurringPledge(usdcAddr, merchant.address, amount, INTERVAL_30D, periods, firstDueDate);
    return { amount, firstDueDate, periods };
  }

  // Helper: approve and pay one installment
  async function payInstallment(recurringId, amount) {
    const feeBps = (await pledge.recurringPledges(recurringId)).appliedFeeBps;
    const gross = amount + (amount * feeBps) / 10000n;
    await usdc.connect(sender).approve(pledgeAddr, gross);
    await pledge.connect(sender).payInstallment(recurringId);
  }

  // Helper: merchant signs a cancellation approval
  async function signCancel(pledgeId, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256"],
      [
        (await ethers.provider.getNetwork()).chainId,
        pledgeAddr,
        "cancel",
        pledgeId,
        sigExpiry,
        nonce,
      ]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // Helper: create a standard USDC pledge (150 total, 40% deposit)
  async function createStandardPledge(token = null) {
    const tok = token ?? usdc;
    const tokAddr = await tok.getAddress();
    const total = UNITS(150);
    const gross = await pledge.quoteGrossAmount(sender.address, total);
    const deposit = (gross * 40n) / 100n;
    const deadline = (await time.latest()) + 30 * DAY;
    await tok.connect(sender).approve(pledgeAddr, deposit);
    await pledge.connect(sender).createPledge(tokAddr, merchant.address, total, deposit, deadline);
    return { total, gross, deposit, deadline, tokAddr };
  }

  beforeEach(async function () {
    [owner, sender, merchant, feeRecipient, outsider] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    usdc = await MockUSDC.deploy();  // defined in MockTokens.sol
    usdt = await MockUSDT.deploy();  // defined in MockTokens.sol

    usdcAddr = await usdc.getAddress();
    usdtAddr = await usdt.getAddress();

    const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
    pledge = await RemittancePledge.deploy([usdcAddr, usdtAddr], feeRecipient.address);
    pledgeAddr = await pledge.getAddress();

    // Fund the sender with both tokens
    await usdc.faucet(sender.address, UNITS(100000));
    await usdt.faucet(sender.address, UNITS(100000));
  });

  // ── Constructor ───────────────────────────────────────────────────────────────
  describe("constructor", function () {
    it("reverts with empty token list", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy([], feeRecipient.address))
        .to.be.revertedWith("At least one token required");
    });

    it("reverts on zero token address in list", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy([ethers.ZeroAddress], feeRecipient.address))
        .to.be.revertedWith("Invalid token address");
    });

    it("reverts on zero fee recipient", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy([usdcAddr], ethers.ZeroAddress))
        .to.be.revertedWith("Invalid fee recipient");
    });

    it("whitelists all tokens passed at deployment", async function () {
      expect(await pledge.allowedTokens(usdcAddr)).to.equal(true);
      expect(await pledge.allowedTokens(usdtAddr)).to.equal(true);
    });
  });

  // ── createPledge ──────────────────────────────────────────────────────────────
  describe("createPledge", function () {
    it("creates a USDC pledge and locks the initial deposit", async function () {
      const { deposit } = await createStandardPledge(usdc);
      const p = await pledge.getPledge(1);
      expect(p.sender).to.equal(sender.address);
      expect(p.merchant).to.equal(merchant.address);
      expect(p.token).to.equal(usdcAddr);
      expect(p.depositedAmount).to.equal(deposit);
      expect(p.status).to.equal(0); // PENDING
    });

    it("creates a USDT pledge and locks the initial deposit", async function () {
      const { deposit } = await createStandardPledge(usdt);
      const p = await pledge.getPledge(1);
      expect(p.token).to.equal(usdtAddr);
      expect(p.depositedAmount).to.equal(deposit);
    });

    it("reverts when token is not whitelisted", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(await rogue.getAddress(), merchant.address, UNITS(150), UNITS(30), deadline)
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts on zero merchant address", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, ethers.ZeroAddress, UNITS(150), UNITS(60), deadline)
      ).to.be.revertedWith("Invalid merchant address");
    });

    it("reverts when sender is the merchant", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, sender.address, UNITS(150), UNITS(60), deadline)
      ).to.be.revertedWith("Sender cannot be merchant");
    });

    it("reverts below the minimum amount", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(0.5), UNITS(0.5), deadline)
      ).to.be.revertedWith("Amount below minimum");
    });

    it("reverts when commitment date is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(150), UNITS(60), past)
      ).to.be.revertedWith("Commitment date must be in future");
    });

    it("reverts when commitment date exceeds 90 days", async function () {
      const tooFar = (await time.latest()) + 100 * DAY;
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(150), UNITS(60), tooFar)
      ).to.be.revertedWith("Max 90 days commitment");
    });

    it("reverts when initial deposit is below the required percentage", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      const tooLittle = UNITS(1);
      await usdc.connect(sender).approve(pledgeAddr, tooLittle);
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(150), tooLittle, deadline)
      ).to.be.reverted;
    });

    it("reverts when initial deposit exceeds the gross amount", async function () {
      const total = UNITS(150);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      const tooMuch = gross + UNITS(1);
      await usdc.connect(sender).approve(pledgeAddr, tooMuch);
      await expect(
        pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, tooMuch, deadline)
      ).to.be.revertedWith("Deposit cannot exceed total");
    });

    it("auto-releases when initial deposit covers the full gross", async function () {
      const total = UNITS(150);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, gross, deadline);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(1); // COMPLETED
      expect(await usdc.balanceOf(merchant.address)).to.equal(total);
    });

    it("enforces the active pledge limit", async function () {
      await createStandardPledge();
      await createStandardPledge();
      await expect(createStandardPledge())
        .to.be.revertedWith("Active pledge limit reached for your trust tier");
    });
  });

  // ── depositRemaining ──────────────────────────────────────────────────────────
  describe("depositRemaining", function () {
    it("completes the pledge when the exact remaining balance is deposited", async function () {
      const { gross, deposit } = await createStandardPledge();
      const remaining = gross - deposit;
      await usdc.connect(sender).approve(pledgeAddr, remaining);
      await pledge.connect(sender).depositRemaining(1, remaining);
      expect((await pledge.getPledge(1)).status).to.equal(1); // COMPLETED
    });

    it("reverts on a partial (non-exact) deposit", async function () {
      const { gross, deposit } = await createStandardPledge();
      const partial = (gross - deposit) / 2n;
      await usdc.connect(sender).approve(pledgeAddr, partial);
      await expect(pledge.connect(sender).depositRemaining(1, partial))
        .to.be.revertedWith("Must deposit the exact remaining balance");
    });

    it("reverts when a non-sender tries to deposit", async function () {
      const { gross, deposit } = await createStandardPledge();
      const remaining = gross - deposit;
      await expect(pledge.connect(outsider).depositRemaining(1, remaining))
        .to.be.revertedWith("Only sender can deposit");
    });

    it("reverts after the grace period ends", async function () {
      const { gross, deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + 1);
      const remaining = gross - deposit;
      await usdc.connect(sender).approve(pledgeAddr, remaining);
      await expect(pledge.connect(sender).depositRemaining(1, remaining))
        .to.be.revertedWith("Grace period has ended");
    });

    it("reverts on a zero amount", async function () {
      await createStandardPledge();
      await expect(pledge.connect(sender).depositRemaining(1, 0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(sender).depositRemaining(999, UNITS(1)))
        .to.be.revertedWith("Pledge does not exist");
    });

    it("reverts on a non-PENDING pledge", async function () {
      const { gross, deposit } = await createStandardPledge();
      const remaining = gross - deposit;
      await usdc.connect(sender).approve(pledgeAddr, remaining);
      await pledge.connect(sender).depositRemaining(1, remaining);
      await expect(pledge.connect(sender).depositRemaining(1, remaining))
        .to.be.revertedWith("Pledge not pending");
    });

    it("marks paidDuringGrace when paid after the deadline", async function () {
      const { gross, deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + DAY);
      const remaining = gross - deposit;
      await usdc.connect(sender).approve(pledgeAddr, remaining);
      await pledge.connect(sender).depositRemaining(1, remaining);
      expect((await pledge.getPledge(1)).paidDuringGrace).to.equal(true);
    });

    it("works with USDT pledge", async function () {
      const { gross, deposit } = await createStandardPledge(usdt);
      const remaining = gross - deposit;
      await usdt.connect(sender).approve(pledgeAddr, remaining);
      await pledge.connect(sender).depositRemaining(1, remaining);
      expect((await pledge.getPledge(1)).status).to.equal(1); // COMPLETED
      expect(await usdt.balanceOf(merchant.address)).to.equal(UNITS(150));
    });
  });

  // ── claimDefaultedDeposit ─────────────────────────────────────────────────────
  describe("claimDefaultedDeposit", function () {
    it("lets the merchant claim after the grace period", async function () {
      const { deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(1);
      expect((await pledge.getPledge(1)).status).to.equal(2); // DEFAULTED
      expect(await usdc.balanceOf(merchant.address)).to.equal(deposit);
    });

    it("reverts when claimed too early (within grace)", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + DAY);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWith("Grace period not over yet");
    });

    it("reverts when claimed after the claim window", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + DAY);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWith("Claim window has expired");
    });

    it("reverts when a non-merchant claims", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(outsider).claimDefaultedDeposit(1))
        .to.be.revertedWith("Only merchant can claim");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(merchant).claimDefaultedDeposit(999))
        .to.be.revertedWith("Pledge does not exist");
    });

    it("records a default against the sender's reputation", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(1);
      const rep = await pledge.getReputation(sender.address);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── reclaimDeposit ────────────────────────────────────────────────────────────
  describe("reclaimDeposit", function () {
    it("lets the sender reclaim after the claim window closes", async function () {
      const { deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      const before = await usdc.balanceOf(sender.address);
      await pledge.connect(sender).reclaimDeposit(1);
      expect(await usdc.balanceOf(sender.address) - before).to.equal(deposit);
    });

    it("reverts while the merchant claim window is still open", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + DAY);
      await expect(pledge.connect(sender).reclaimDeposit(1))
        .to.be.revertedWith("Merchant claim window still open");
    });

    it("emits both PledgeDefaulted and DepositReclaimed", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(sender).reclaimDeposit(1))
        .to.emit(pledge, "PledgeDefaulted")
        .and.to.emit(pledge, "DepositReclaimed");
    });

    it("reverts when a non-sender reclaims", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(outsider).reclaimDeposit(1))
        .to.be.revertedWith("Only sender can reclaim");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(sender).reclaimDeposit(999))
        .to.be.revertedWith("Pledge does not exist");
    });

    it("records a default on reputation after reclaim", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await pledge.connect(sender).reclaimDeposit(1);
      const rep = await pledge.getReputation(sender.address);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── extendDeadline ────────────────────────────────────────────────────────────
  describe("extendDeadline", function () {
    it("extends with a valid merchant signature", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(1, newDate, deadline, sigExpiry, 0);
      await pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, sig);
      expect((await pledge.getPledge(1)).commitmentDate).to.equal(newDate);
    });

    it("reverts with an invalid signature (signed by outsider)", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [(await ethers.provider.getNetwork()).chainId, pledgeAddr, "extend", 1, newDate, deadline, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when the signature has expired", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signExtension(1, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, sig))
        .to.be.revertedWith("Signature expired");
    });

    it("reverts when extending beyond 30 days", async function () {
      const { deadline } = await createStandardPledge();
      const tooFar = deadline + 40 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(1, tooFar, deadline, sigExpiry, 0);
      await expect(pledge.connect(sender).extendDeadline(1, tooFar, sigExpiry, sig))
        .to.be.revertedWith("Max 30-day extension");
    });

    it("reverts when extending after the deadline has passed", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + 1);
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(1, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, sig))
        .to.be.revertedWith("Cannot extend after deadline");
    });

    it("reverts when a non-sender tries to extend", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(1, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(outsider).extendDeadline(1, newDate, sigExpiry, sig))
        .to.be.revertedWith("Only sender can extend");
    });

    it("reverts when newDate is not later than current deadline", async function () {
      const { deadline } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(1, deadline, deadline, sigExpiry, 0);
      await expect(pledge.connect(sender).extendDeadline(1, deadline, sigExpiry, sig))
        .to.be.revertedWith("New date must be later");
    });

    it("reverts when the same signature is replayed (nonce consumed)", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + 100 * DAY;
      const sig = await signExtension(1, newDate, deadline, sigExpiry, 0);
      await pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, sig);
      const laterDate = newDate + DAY;
      await expect(pledge.connect(sender).extendDeadline(1, laterDate, sigExpiry, sig))
        .to.be.revertedWith("Invalid merchant signature");
    });
  });

  // ── cancelPledge ──────────────────────────────────────────────────────────────
  describe("cancelPledge", function () {
    it("cancels and refunds with a valid merchant signature", async function () {
      const { deposit } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      const before = await usdc.balanceOf(sender.address);
      await pledge.connect(sender).cancelPledge(1, sigExpiry, sig);
      expect(await usdc.balanceOf(sender.address) - before).to.equal(deposit);
      expect((await pledge.getPledge(1)).status).to.equal(3); // CANCELLED
    });

    it("does not count a cancellation against reputation", async function () {
      await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      await pledge.connect(sender).cancelPledge(1, sigExpiry, sig);
      const rep = await pledge.getReputation(sender.address);
      expect(rep.defaultCount).to.equal(0);
      expect(rep.totalCount).to.equal(0);
    });

    it("reverts on an invalid cancel signature", async function () {
      await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256"],
        [(await ethers.provider.getNetwork()).chainId, pledgeAddr, "cancel", 1, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(sender).cancelPledge(1, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when called after the deadline", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + 1);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      await expect(pledge.connect(sender).cancelPledge(1, sigExpiry, sig))
        .to.be.revertedWith("Cannot cancel after deadline");
    });

    it("reverts when called by a non-sender", async function () {
      await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      await expect(pledge.connect(outsider).cancelPledge(1, sigExpiry, sig))
        .to.be.revertedWith("Only sender can cancel");
    });

    it("reverts when the cancel signature has expired", async function () {
      await createStandardPledge();
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signCancel(1, sigExpiry, 0);
      await expect(pledge.connect(sender).cancelPledge(1, sigExpiry, sig))
        .to.be.revertedWith("Signature expired");
    });

    it("emits PledgeCancelled", async function () {
      await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      await expect(pledge.connect(sender).cancelPledge(1, sigExpiry, sig))
        .to.emit(pledge, "PledgeCancelled");
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
        pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(150), UNITS(60), deadline)
      ).to.be.reverted;
    });

    it("unpause restores functionality", async function () {
      await pledge.connect(owner).pause();
      await pledge.connect(owner).unpause();
      await createStandardPledge();
    });

    it("owner can update fee recipient", async function () {
      await pledge.connect(owner).setFeeRecipient(outsider.address);
      expect(await pledge.feeRecipient()).to.equal(outsider.address);
    });

    it("reverts setting fee recipient to zero", async function () {
      await expect(pledge.connect(owner).setFeeRecipient(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid fee recipient");
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
        .to.be.revertedWith("Invalid token address");
    });

    it("removed token cannot be used in new pledges", async function () {
      await pledge.connect(owner).setTokenAllowed(usdtAddr, false);
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(usdtAddr, merchant.address, UNITS(150), UNITS(30), deadline)
      ).to.be.revertedWith("Token not supported");
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
      // Complete a USDC pledge on time (full deposit)
      const total = UNITS(100);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, gross, deadline);

      // Sender now has 100% trust score — USDT pledge should get loyalty fee
      expect(await pledge.getServiceFeeBps(sender.address)).to.equal(75);
      expect(await pledge.getRequiredDepositPct(sender.address)).to.equal(20);
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(5);

      // Can now create a USDT pledge with the high-trust benefits
      const usdtGross = await pledge.quoteGrossAmount(sender.address, total);
      const usdtDeposit = (usdtGross * 20n) / 100n + 1n;
      const deadline2 = (await time.latest()) + 30 * DAY;
      await usdt.connect(sender).approve(pledgeAddr, usdtDeposit);
      await pledge.connect(sender).createPledge(usdtAddr, merchant.address, total, usdtDeposit, deadline2);
      expect((await pledge.getPledge(2)).token).to.equal(usdtAddr);
    });

    it("USDT default reduces trust score affecting USDC pledge requirements", async function () {
      // Build trust with a USDC on-time payment
      const total = UNITS(10);
      const gross1 = await pledge.quoteGrossAmount(sender.address, total);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, gross1);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, gross1, deadline1);

      // Default a large USDT pledge — tanks the score
      const largeTotal = UNITS(40);
      const gross2 = await pledge.quoteGrossAmount(sender.address, largeTotal);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      const deadline2 = (await time.latest()) + 30 * DAY;
      await usdt.connect(sender).approve(pledgeAddr, dep2);
      await pledge.connect(sender).createPledge(usdtAddr, merchant.address, largeTotal, dep2, deadline2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      // Score is now low — USDC pledge deposit requirement should be higher
      const score = await pledge.getTrustScore(sender.address);
      expect(score).to.be.lt(5000n);
      expect(await pledge.getRequiredDepositPct(sender.address)).to.be.gte(30);
    });
  });

  // ── Views and fee tiers ───────────────────────────────────────────────────────
  describe("views and fee tiers", function () {
    it("new user gets the standard 1% fee", async function () {
      expect(await pledge.getServiceFeeBps(sender.address)).to.equal(100);
    });

    it("new user gets the 20% deposit tier", async function () {
      expect(await pledge.getRequiredDepositPct(sender.address)).to.equal(20);
    });

    it("new user gets the no-history active limit of 2", async function () {
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(2);
    });

    it("getPledge reverts on a nonexistent pledge", async function () {
      await expect(pledge.getPledge(999)).to.be.revertedWith("Pledge does not exist");
    });

    it("grossAmountForPledge reverts on a nonexistent pledge", async function () {
      await expect(pledge.grossAmountForPledge(999)).to.be.revertedWith("Pledge does not exist");
    });

    it("grossAmountForPledge returns correct gross for an existing pledge", async function () {
      const { gross } = await createStandardPledge();
      expect(await pledge.grossAmountForPledge(1)).to.equal(gross);
    });

    it("getTrustScore returns 0 for a new wallet", async function () {
      expect(await pledge.getTrustScore(sender.address)).to.equal(0);
    });

    it("pagination returns the correct slice", async function () {
      await createStandardPledge();
      await createStandardPledge();
      const [page, total] = await pledge.getSenderPledgesPaginated(sender.address, 0, 1);
      expect(total).to.equal(2);
      expect(page.length).to.equal(1);
    });

    it("pagination handles offset beyond range", async function () {
      await createStandardPledge();
      const [page, total] = await pledge.getSenderPledgesPaginated(sender.address, 5, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(0);
    });

    it("getSenderPledges returns all pledge IDs", async function () {
      await createStandardPledge();
      await createStandardPledge();
      const ids = await pledge.getSenderPledges(sender.address);
      expect(ids.length).to.equal(2);
    });

    it("getMerchantPledges returns correct pledge IDs", async function () {
      await createStandardPledge();
      const ids = await pledge.getMerchantPledges(merchant.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getMerchantPledgesPaginated works correctly", async function () {
      await createStandardPledge();
      const [page, total] = await pledge.getMerchantPledgesPaginated(merchant.address, 0, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(1);
    });

    it("quoteGrossAmount adds the 1% fee for a new user", async function () {
      expect(await pledge.quoteGrossAmount(sender.address, UNITS(100))).to.equal(UNITS(101));
    });

    it("high-trust sender gets 0.75% loyalty fee", async function () {
      const total = UNITS(100);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, gross, deadline);
      expect(await pledge.getServiceFeeBps(sender.address)).to.equal(75);
      expect(await pledge.getRequiredDepositPct(sender.address)).to.equal(20);
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(5);
    });

    it("mid-trust sender (50% score) gets 3 active pledge slots", async function () {
      const total = UNITS(100);
      const gross1 = await pledge.quoteGrossAmount(sender.address, total);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, gross1);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, gross1, deadline1);

      const gross2 = await pledge.quoteGrossAmount(sender.address, total);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      const deadline2 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, dep2);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, dep2, deadline2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      expect(await pledge.getTrustScore(sender.address)).to.equal(5000);
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(3);
    });

    it("low-trust sender (20–49% score) requires 40% deposit", async function () {
      const gross1 = await pledge.quoteGrossAmount(sender.address, UNITS(10));
      const deadline1 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, gross1);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(10), gross1, deadline1);

      const gross2 = await pledge.quoteGrossAmount(sender.address, UNITS(40));
      const dep2 = (gross2 * 20n) / 100n + 1n;
      const deadline2 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(pledgeAddr, dep2);
      await pledge.connect(sender).createPledge(usdcAddr, merchant.address, UNITS(40), dep2, deadline2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      const score = await pledge.getTrustScore(sender.address);
      expect(score).to.be.gte(2000n);
      expect(score).to.be.lt(5000n);
      expect(await pledge.getRequiredDepositPct(sender.address)).to.equal(40);
    });

    it("serial defaulter (3 defaults) is capped at 2 active pledges", async function () {
      for (let i = 0; i < 3; i++) {
        const total = UNITS(150);
        const gross = await pledge.quoteGrossAmount(sender.address, total);
        const requiredPct = await pledge.getRequiredDepositPct(sender.address);
        const deposit = (gross * requiredPct) / 100n + 1n;
        const deadline = (await time.latest()) + 30 * DAY;
        await usdc.connect(sender).approve(pledgeAddr, deposit);
        await pledge.connect(sender).createPledge(usdcAddr, merchant.address, total, deposit, deadline);
        await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).claimDefaultedDeposit(i + 1);
      }
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(2);
    });

    it("MockUSDC decimals() returns 6", async function () {
      expect(await usdc.decimals()).to.equal(6);
    });

    it("MockUSDC mints 1M tokens to deployer on construction", async function () {
      expect(await usdc.balanceOf(owner.address)).to.equal(ethers.parseUnits("1000000", 6));
    });

    it("MockUSDC reverts when faucet amount exceeds MAX_FAUCET", async function () {
      const maxFaucet = await usdc.MAX_FAUCET();
      await expect(usdc.faucet(sender.address, maxFaucet + 1n))
        .to.be.revertedWith("Faucet: amount too large");
    });
  });

  // ── createRecurringPledge ─────────────────────────────────────────────────────
  describe("createRecurringPledge", function () {
    it("creates a recurring pledge and stores correct state", async function () {
      const { amount, firstDueDate, periods } = await createStandardRecurring();
      const rp = await pledge.getRecurringPledge(1);
      expect(rp.sender).to.equal(sender.address);
      expect(rp.merchant).to.equal(merchant.address);
      expect(rp.token).to.equal(usdcAddr);
      expect(rp.amountPerPeriod).to.equal(amount);
      expect(rp.totalPeriods).to.equal(periods);
      expect(rp.periodsCompleted).to.equal(0);
      expect(rp.missedCount).to.equal(0);
      expect(rp.totalMissedDebt).to.equal(0);
      expect(rp.nextDueDate).to.equal(firstDueDate);
      expect(rp.status).to.equal(0); // ACTIVE
    });

    it("increments activePledgeCount", async function () {
      await createStandardRecurring();
      expect(await pledge.activePledgeCount(sender.address)).to.equal(1);
    });

    it("emits RecurringPledgeCreated", async function () {
      const amount = UNITS(100);
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, merchant.address, amount, INTERVAL_30D, 3, firstDueDate)
      ).to.emit(pledge, "RecurringPledgeCreated");
    });

    it("reverts on unsupported token", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(await rogue.getAddress(), merchant.address, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts on zero merchant address", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, ethers.ZeroAddress, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Invalid merchant address");
    });

    it("reverts when sender is the merchant", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, sender.address, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Sender cannot be merchant");
    });

    it("reverts when amount is below minimum", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, merchant.address, UNITS(0.5), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Amount below minimum");
    });

    it("reverts when interval is below 7 days", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, merchant.address, UNITS(100), INTERVAL_7D - 1, 3, firstDueDate)
      ).to.be.revertedWith("Interval too short");
    });

    it("reverts when totalPeriods is zero", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, merchant.address, UNITS(100), INTERVAL_30D, 0, firstDueDate)
      ).to.be.revertedWith("Invalid period count");
    });

    it("reverts when totalPeriods exceeds 12", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, merchant.address, UNITS(100), INTERVAL_30D, 13, firstDueDate)
      ).to.be.revertedWith("Invalid period count");
    });

    it("reverts when firstDueDate is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(sender).createRecurringPledge(usdcAddr, merchant.address, UNITS(100), INTERVAL_30D, 3, past)
      ).to.be.revertedWith("First due date must be in future");
    });

    it("reverts when active pledge limit is reached", async function () {
      await createStandardRecurring();
      await createStandardRecurring();
      await expect(createStandardRecurring())
        .to.be.revertedWith("Active pledge limit reached for your trust tier");
    });

    it("getRecurringPledge reverts on nonexistent id", async function () {
      await expect(pledge.getRecurringPledge(999)).to.be.revertedWith("Recurring pledge does not exist");
    });
  });

  // ── payInstallment ────────────────────────────────────────────────────────────
  describe("payInstallment", function () {
    it("pays the first installment and releases to merchant", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      const before = await usdc.balanceOf(merchant.address);
      await payInstallment(1, amount);
      expect(await usdc.balanceOf(merchant.address) - before).to.equal(amount);
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
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await expect(pledge.connect(sender).payInstallment(1))
        .to.emit(pledge, "InstallmentPaid")
        .withArgs(1, sender.address, 1, amount);
    });

    it("allows early payment before the due date", async function () {
      const { amount } = await createStandardRecurring();
      // pay before firstDueDate — should succeed
      await payInstallment(1, amount);
      const rp = await pledge.recurringPledges(1);
      expect(rp.periodsCompleted).to.equal(1);
    });

    it("marks late when paid after due date but within grace", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + DAY);
      await payInstallment(1, amount);
      const rep = await pledge.getReputation(sender.address);
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
      // miss period 1
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      // pay period 2 — land on the due date, not past grace
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
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await expect(pledge.connect(sender).payInstallment(1))
        .to.be.revertedWith("Grace period has ended - use markMissedInstallment");
    });

    it("reverts when called by non-sender", async function () {
      await createStandardRecurring();
      await expect(pledge.connect(outsider).payInstallment(1))
        .to.be.revertedWith("Only sender can pay");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(sender).payInstallment(999))
        .to.be.revertedWith("Recurring pledge does not exist");
    });

    it("reverts when pledge is no longer active", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await expect(pledge.connect(sender).payInstallment(1))
        .to.be.revertedWith("Pledge not active");
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

    it("records a default against sender reputation", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const rep = await pledge.getReputation(sender.address);
      expect(rep.defaultCount).to.equal(1);
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
      // pay period 2 — land on its due date, not past grace
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
        .to.be.revertedWith("Grace period not over yet");
    });

    it("reverts when called by non-merchant", async function () {
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(outsider).markMissedInstallment(1))
        .to.be.revertedWith("Only merchant can mark missed");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(merchant).markMissedInstallment(999))
        .to.be.revertedWith("Recurring pledge does not exist");
    });

    it("reverts when pledge is no longer active", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      await expect(pledge.connect(merchant).markMissedInstallment(1))
        .to.be.revertedWith("Pledge not active");
    });
  });

  // ── settleDebt ────────────────────────────────────────────────────────────────
  describe("settleDebt", function () {
    // Helper: create a pledge with one missed installment ready for settlement
    async function createPendingSettlement() {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      return { amount };
    }

    it("settles debt and releases full amount to merchant", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(merchant.address);
      await pledge.connect(sender).settleDebt(1);
      expect(await usdc.balanceOf(merchant.address) - before).to.equal(amount);
    });

    it("marks the pledge as COMPLETED after settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).settleDebt(1);
      expect((await pledge.recurringPledges(1)).status).to.equal(2); // COMPLETED
    });

    it("clears totalMissedDebt after settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).settleDebt(1);
      expect((await pledge.recurringPledges(1)).totalMissedDebt).to.equal(0);
    });

    it("emits DebtSettled and RecurringPledgeCompleted", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await expect(pledge.connect(sender).settleDebt(1))
        .to.emit(pledge, "DebtSettled")
        .and.to.emit(pledge, "RecurringPledgeCompleted");
    });

    it("decrements activePledgeCount after settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).settleDebt(1);
      expect(await pledge.activePledgeCount(sender.address)).to.equal(0);
    });

    it("collects fee on settlement", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      const expectedFee = (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(feeRecipient.address);
      await pledge.connect(sender).settleDebt(1);
      expect(await usdc.balanceOf(feeRecipient.address) - before).to.equal(expectedFee);
    });

    it("reverts when called by non-sender", async function () {
      await createPendingSettlement();
      await expect(pledge.connect(outsider).settleDebt(1))
        .to.be.revertedWith("Only sender can settle");
    });

    it("reverts when status is not PENDING_SETTLEMENT", async function () {
      await createStandardRecurring();
      await expect(pledge.connect(sender).settleDebt(1))
        .to.be.revertedWith("No debt to settle");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(sender).settleDebt(999))
        .to.be.revertedWith("Recurring pledge does not exist");
    });
  });

  // ── cancelRecurring ───────────────────────────────────────────────────────────
  describe("cancelRecurring", function () {
    it("cancels with a valid merchant signature", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(sender).cancelRecurring(1, sigExpiry, sig);
      expect((await pledge.recurringPledges(1)).status).to.equal(3); // CANCELLED
    });

    it("forgives missed debt on cancellation", async function () {
      const { firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(sender).cancelRecurring(1, sigExpiry, sig);
      expect((await pledge.recurringPledges(1)).totalMissedDebt).to.equal(0);
      expect((await pledge.recurringPledges(1)).status).to.equal(3); // CANCELLED
    });

    it("decrements activePledgeCount on cancellation", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(sender).cancelRecurring(1, sigExpiry, sig);
      expect(await pledge.activePledgeCount(sender.address)).to.equal(0);
    });

    it("can cancel a PENDING_SETTLEMENT pledge", async function () {
      const { firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      expect((await pledge.recurringPledges(1)).status).to.equal(1); // PENDING_SETTLEMENT
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(sender).cancelRecurring(1, sigExpiry, sig);
      expect((await pledge.recurringPledges(1)).status).to.equal(3); // CANCELLED
    });

    it("emits RecurringPledgeCancelled", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(sender).cancelRecurring(1, sigExpiry, sig))
        .to.emit(pledge, "RecurringPledgeCancelled");
    });

    it("reverts with an invalid signature", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256"],
        [(await ethers.provider.getNetwork()).chainId, pledgeAddr, "cancelRecurring", 1, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(sender).cancelRecurring(1, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when signature has expired", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(sender).cancelRecurring(1, sigExpiry, sig))
        .to.be.revertedWith("Signature expired");
    });

    it("reverts when called by non-sender", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(outsider).cancelRecurring(1, sigExpiry, sig))
        .to.be.revertedWith("Only sender can cancel");
    });

    it("reverts when already cancelled", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(sender).cancelRecurring(1, sigExpiry, sig);
      const sig2 = await signCancelRecurring(1, sigExpiry, 1);
      await expect(pledge.connect(sender).cancelRecurring(1, sigExpiry, sig2))
        .to.be.revertedWith("Pledge not cancellable");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(999, sigExpiry, 0);
      await expect(pledge.connect(sender).cancelRecurring(999, sigExpiry, sig))
        .to.be.revertedWith("Recurring pledge does not exist");
    });
  });

  // ── Recurring reputation ──────────────────────────────────────────────────────
  describe("recurring pledge reputation", function () {
    it("builds partial reputation per on-time installment", async function () {
      const { amount } = await createStandardRecurring(3);
      // pay early — guaranteed before due date so onTimeCount increments
      await payInstallment(1, amount);
      const rep = await pledge.getReputation(sender.address);
      expect(rep.onTimeCount).to.equal(1);
    });

    it("grants completion bonus when all periods paid with no debt", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      await time.increase(INTERVAL_30D);
      await payInstallment(1, amount);
      // Trust score should be above 0 after full completion
      expect(await pledge.getTrustScore(sender.address)).to.be.gt(0);
    });

    it("no completion bonus until settleDebt is called on a missed pledge", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      // miss period 1
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      // pay period 2 — land on its due date, moves to PENDING_SETTLEMENT
      await time.increaseTo(firstDueDate + INTERVAL_30D);
      await payInstallment(1, amount);
      const scoreBefore = await pledge.getTrustScore(sender.address);
      // settle
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(sender).approve(pledgeAddr, gross);
      await pledge.connect(sender).settleDebt(1);
      const scoreAfter = await pledge.getTrustScore(sender.address);
      expect(scoreAfter).to.be.gte(scoreBefore);
    });

    it("missed installments record defaults that reduce trust score", async function () {
      const { firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const rep = await pledge.getReputation(sender.address);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── Recurring view functions ──────────────────────────────────────────────────
  describe("recurring view functions", function () {
    it("getSenderRecurringPledges returns correct ids", async function () {
      await createStandardRecurring();
      const ids = await pledge.getSenderRecurringPledges(sender.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getMerchantRecurringPledges returns correct ids", async function () {
      await createStandardRecurring();
      const ids = await pledge.getMerchantRecurringPledges(merchant.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getSenderRecurringPledgesPaginated returns correct slice", async function () {
      await createStandardRecurring();
      await createStandardRecurring();
      const [page, total] = await pledge.getSenderRecurringPledgesPaginated(sender.address, 0, 1);
      expect(total).to.equal(2);
      expect(page.length).to.equal(1);
    });

    it("getMerchantRecurringPledgesPaginated handles offset beyond range", async function () {
      await createStandardRecurring();
      const [page, total] = await pledge.getMerchantRecurringPledgesPaginated(merchant.address, 5, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(0);
    });
  });
});

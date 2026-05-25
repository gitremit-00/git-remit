// test/RemittancePledge.test.js
// Hardhat test suite for RemittancePledge — targets 100% branch coverage.
// Run:  npx hardhat test
// Cover: npx hardhat coverage

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

// ── Constants mirrored from the contract ──────────────────────────────────────
const USDC = (n) => ethers.parseUnits(n.toString(), 6); // 6-decimal USDC
const GRACE_PERIOD = 3 * 24 * 60 * 60;
const CLAIM_WINDOW = 30 * 24 * 60 * 60;
const TIME_BUFFER = 15 * 60;
const DAY = 24 * 60 * 60;

describe("RemittancePledge", function () {
  let usdc, pledge;
  let owner, sender, merchant, feeRecipient, outsider;

  // Helper: merchant signs an extension approval
  async function signExtension(pledgeId, newDate, oldDate, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
      [
        (await ethers.provider.getNetwork()).chainId,
        await pledge.getAddress(),
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

  // Helper: merchant signs a cancellation approval
  async function signCancel(pledgeId, sigExpiry, nonce) {
    const hash = ethers.solidityPackedKeccak256(
      ["uint256", "address", "string", "uint256", "uint256", "uint256"],
      [
        (await ethers.provider.getNetwork()).chainId,
        await pledge.getAddress(),
        "cancel",
        pledgeId,
        sigExpiry,
        nonce,
      ]
    );
    return merchant.signMessage(ethers.getBytes(hash));
  }

  // Helper: create a standard pledge (150 USDC total, 40% initial deposit + fee)
  async function createStandardPledge() {
    const total = USDC(150);
    const gross = await pledge.quoteGrossAmount(sender.address, total);
    const deposit = (gross * 40n) / 100n; // 40% — comfortably above 20% min
    const deadline = (await time.latest()) + 30 * DAY;
    await usdc.connect(sender).approve(await pledge.getAddress(), deposit);
    await pledge.connect(sender).createPledge(merchant.address, total, deposit, deadline);
    return { total, gross, deposit, deadline };
  }

  beforeEach(async function () {
    [owner, sender, merchant, feeRecipient, outsider] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
    pledge = await RemittancePledge.deploy(await usdc.getAddress(), feeRecipient.address);

    // Fund the sender generously
    await usdc.faucet(sender.address, USDC(100000));
  });

  // ── Constructor ───────────────────────────────────────────────────────────────
  describe("constructor", function () {
    it("reverts on zero USDC address", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy(ethers.ZeroAddress, feeRecipient.address))
        .to.be.revertedWith("Invalid USDC address");
    });
    it("reverts on zero fee recipient", async function () {
      const F = await ethers.getContractFactory("RemittancePledge");
      await expect(F.deploy(await usdc.getAddress(), ethers.ZeroAddress))
        .to.be.revertedWith("Invalid fee recipient");
    });
  });

  // ── createPledge ──────────────────────────────────────────────────────────────
  describe("createPledge", function () {
    it("creates a pledge and locks the initial deposit", async function () {
      const { deposit } = await createStandardPledge();
      const p = await pledge.getPledge(1);
      expect(p.sender).to.equal(sender.address);
      expect(p.merchant).to.equal(merchant.address);
      expect(p.depositedAmount).to.equal(deposit);
      expect(p.status).to.equal(0); // PENDING
      expect(await usdc.balanceOf(await pledge.getAddress())).to.equal(deposit);
    });

    it("reverts on zero merchant address", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(ethers.ZeroAddress, USDC(150), USDC(60), deadline)
      ).to.be.revertedWith("Invalid merchant address");
    });

    it("reverts when sender is the merchant", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(sender.address, USDC(150), USDC(60), deadline)
      ).to.be.revertedWith("Sender cannot be merchant");
    });

    it("reverts below the 1 USDC minimum", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(sender).createPledge(merchant.address, USDC(0.5), USDC(0.5), deadline)
      ).to.be.revertedWith("Amount below 1 USDC minimum");
    });

    it("reverts when commitment date is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(sender).createPledge(merchant.address, USDC(150), USDC(60), past)
      ).to.be.revertedWith("Commitment date must be in future");
    });

    it("reverts when commitment date exceeds 90 days", async function () {
      const tooFar = (await time.latest()) + 100 * DAY;
      await expect(
        pledge.connect(sender).createPledge(merchant.address, USDC(150), USDC(60), tooFar)
      ).to.be.revertedWith("Max 90 days commitment");
    });

    it("reverts when initial deposit is below the required percentage", async function () {
      const total = USDC(150);
      const deadline = (await time.latest()) + 30 * DAY;
      const tooLittle = USDC(1); // far below 20%
      await usdc.connect(sender).approve(await pledge.getAddress(), tooLittle);
      await expect(
        pledge.connect(sender).createPledge(merchant.address, total, tooLittle, deadline)
      ).to.be.reverted; // string-built revert message
    });

    it("reverts when initial deposit exceeds the gross amount", async function () {
      const total = USDC(150);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      const tooMuch = gross + USDC(1);
      await usdc.connect(sender).approve(await pledge.getAddress(), tooMuch);
      await expect(
        pledge.connect(sender).createPledge(merchant.address, total, tooMuch, deadline)
      ).to.be.revertedWith("Deposit cannot exceed total");
    });

    it("auto-releases when initial deposit covers the full gross", async function () {
      const total = USDC(150);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(await pledge.getAddress(), gross);
      await pledge.connect(sender).createPledge(merchant.address, total, gross, deadline);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(1); // COMPLETED
      expect(await usdc.balanceOf(merchant.address)).to.equal(total);
    });

    it("enforces the active pledge limit", async function () {
      // New sender cap is 2
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
      await usdc.connect(sender).approve(await pledge.getAddress(), remaining);
      await pledge.connect(sender).depositRemaining(1, remaining);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(1); // COMPLETED
    });

    it("reverts on a partial (non-exact) deposit", async function () {
      const { gross, deposit } = await createStandardPledge();
      const partial = (gross - deposit) / 2n;
      await usdc.connect(sender).approve(await pledge.getAddress(), partial);
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
      await usdc.connect(sender).approve(await pledge.getAddress(), remaining);
      await expect(pledge.connect(sender).depositRemaining(1, remaining))
        .to.be.revertedWith("Grace period has ended");
    });

    it("reverts on a zero amount", async function () {
      await createStandardPledge();
      await expect(pledge.connect(sender).depositRemaining(1, 0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(sender).depositRemaining(999, USDC(1)))
        .to.be.revertedWith("Pledge does not exist");
    });

    it("reverts on a non-PENDING pledge", async function () {
      const { gross, deposit } = await createStandardPledge();
      const remaining = gross - deposit;
      await usdc.connect(sender).approve(await pledge.getAddress(), remaining);
      await pledge.connect(sender).depositRemaining(1, remaining); // completes it
      await expect(pledge.connect(sender).depositRemaining(1, remaining))
        .to.be.revertedWith("Pledge not pending");
    });

    it("marks paidDuringGrace when paid after the deadline", async function () {
      const { gross, deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + DAY); // within grace
      const remaining = gross - deposit;
      await usdc.connect(sender).approve(await pledge.getAddress(), remaining);
      await pledge.connect(sender).depositRemaining(1, remaining);
      const p = await pledge.getPledge(1);
      expect(p.paidDuringGrace).to.equal(true);
    });
  });

  // ── claimDefaultedDeposit ─────────────────────────────────────────────────────
  describe("claimDefaultedDeposit", function () {
    it("lets the merchant claim after the grace period", async function () {
      const { deposit, deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(1);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(2); // DEFAULTED
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
      const after = await usdc.balanceOf(sender.address);
      expect(after - before).to.equal(deposit);
    });

    it("reverts while the merchant claim window is still open", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + DAY); // window still open
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
      const p = await pledge.getPledge(1);
      expect(p.commitmentDate).to.equal(newDate);
    });

    it("reverts with an invalid signature (signed by outsider)", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256", "uint256", "uint256"],
        [(await ethers.provider.getNetwork()).chainId, await pledge.getAddress(),
         "extend", 1, newDate, deadline, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when the signature has expired", async function () {
      const { deadline } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) - 1; // already expired
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
      // First use — succeeds; commitmentDate is now newDate
      await pledge.connect(sender).extendDeadline(1, newDate, sigExpiry, sig);
      // Replay: use a date beyond the updated deadline so it passes the "New date must be later"
      // check and reaches the signature verification — which fails because nonce is now 1
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
      const after = await usdc.balanceOf(sender.address);
      expect(after - before).to.equal(deposit);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(3); // CANCELLED
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
        [(await ethers.provider.getNetwork()).chainId, await pledge.getAddress(),
         "cancel", 1, sigExpiry, 0]
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
        pledge.connect(sender).createPledge(merchant.address, USDC(150), USDC(60), deadline)
      ).to.be.reverted;
    });

    it("unpause restores functionality", async function () {
      await pledge.connect(owner).pause();
      await pledge.connect(owner).unpause();
      await createStandardPledge(); // should not revert
    });

    it("owner can update fee recipient", async function () {
      await pledge.connect(owner).setFeeRecipient(outsider.address);
      expect(await pledge.feeRecipient()).to.equal(outsider.address);
    });

    it("reverts setting fee recipient to zero", async function () {
      await expect(pledge.connect(owner).setFeeRecipient(ethers.ZeroAddress))
        .to.be.revertedWith("Invalid fee recipient");
    });
  });

  // ── View functions & fee tiers ────────────────────────────────────────────────
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
      const gross = await pledge.quoteGrossAmount(sender.address, USDC(100));
      expect(gross).to.equal(USDC(101)); // 100 + 1%
    });

    it("high-trust sender gets 0.75% loyalty fee", async function () {
      // Complete a pledge on-time to build high trust score
      const total = USDC(100);
      const gross = await pledge.quoteGrossAmount(sender.address, total);
      const deadline = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(await pledge.getAddress(), gross);
      await pledge.connect(sender).createPledge(merchant.address, total, gross, deadline);
      // Now sender has 100% trust score — should get loyalty rate
      expect(await pledge.getServiceFeeBps(sender.address)).to.equal(75);
      expect(await pledge.getRequiredDepositPct(sender.address)).to.equal(20);
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(5);
    });

    it("serial defaulter (3 defaults) is capped at 2 active pledges regardless of score", async function () {
      // Trigger 3 defaults — deposit % rises after each default so we query it each iteration
      for (let i = 0; i < 3; i++) {
        const total = USDC(150);
        const gross = await pledge.quoteGrossAmount(sender.address, total);
        const requiredPct = await pledge.getRequiredDepositPct(sender.address);
        const deposit = (gross * requiredPct) / 100n + 1n; // just above minimum
        const deadline = (await time.latest()) + 30 * DAY;
        await usdc.connect(sender).approve(await pledge.getAddress(), deposit);
        await pledge.connect(sender).createPledge(merchant.address, total, deposit, deadline);
        await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).claimDefaultedDeposit(i + 1);
      }
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(2);
    });

    it("mid-trust sender (50% score) gets 3 active pledge slots", async function () {
      // 1 on-time + 1 default of equal amount → weightedScore/totalWeight = 5000 (50%)
      const total = USDC(100);
      const gross = await pledge.quoteGrossAmount(sender.address, total);

      // Pledge 1 — complete on time (full deposit upfront)
      const deadline1 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(await pledge.getAddress(), gross);
      await pledge.connect(sender).createPledge(merchant.address, total, gross, deadline1);

      // Pledge 2 — default it
      const gross2 = await pledge.quoteGrossAmount(sender.address, total);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      const deadline2 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(await pledge.getAddress(), dep2);
      await pledge.connect(sender).createPledge(merchant.address, total, dep2, deadline2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      // Score = (100 * 10000) / (100 + 100) = 5000 — exactly TIER_MID
      expect(await pledge.getTrustScore(sender.address)).to.equal(5000);
      expect(await pledge.getMaxActivePledges(sender.address)).to.equal(3);
    });

    it("low-trust sender (20–49% score) requires 40% deposit", async function () {
      // 1 on-time small + 1 default large → score between 20–49%
      // on-time: 10 USDC * 10000 = 100000; default: 40 USDC * 0 = 0
      // totalWeight = 50, weightedScore = 100000 → score = 100000/50 = 2000 (20%)
      const smallTotal = USDC(10);
      const largeTotal = USDC(40);

      // Pledge 1 — complete on time
      const gross1 = await pledge.quoteGrossAmount(sender.address, smallTotal);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(await pledge.getAddress(), gross1);
      await pledge.connect(sender).createPledge(merchant.address, smallTotal, gross1, deadline1);

      // Pledge 2 — default it (large amount tanks the score)
      const gross2 = await pledge.quoteGrossAmount(sender.address, largeTotal);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      const deadline2 = (await time.latest()) + 30 * DAY;
      await usdc.connect(sender).approve(await pledge.getAddress(), dep2);
      await pledge.connect(sender).createPledge(merchant.address, largeTotal, dep2, deadline2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      // Score should be in TIER_LOW (20–49%) → 40% deposit required
      const score = await pledge.getTrustScore(sender.address);
      expect(score).to.be.gte(2000);
      expect(score).to.be.lt(5000);
      expect(await pledge.getRequiredDepositPct(sender.address)).to.equal(40);
    });

    it("MockUSDC reverts when faucet amount exceeds MAX_FAUCET", async function () {
      const maxFaucet = await usdc.MAX_FAUCET();
      await expect(usdc.faucet(sender.address, maxFaucet + 1n))
        .to.be.revertedWith("Faucet: amount too large");
    });

    it("MockUSDC decimals() returns 6", async function () {
      expect(await usdc.decimals()).to.equal(6);
    });

    it("MockUSDC mints 1M USDC to deployer on construction", async function () {
      expect(await usdc.balanceOf(owner.address)).to.equal(ethers.parseUnits("1000000", 6));
    });
  });
});

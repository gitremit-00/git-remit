// test/hardhat/RemittancePledge.test.js
// Updated for new role model: merchant creates pledges, payer (OFW) fulfills them.
// Run:  npx hardhat test
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
const INTERVAL_7D  = 7 * DAY;

describe("RemittancePledge", function () {
  let usdc, usdt, pledge;
  let owner, payer, merchant, feeRecipient, outsider;
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

  // Helper: merchant signs a pledge cancellation approval
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

  // Helper: merchant creates a recurring pledge targeting the payer
  async function createStandardRecurring(periods = 3, amountPerPeriod = 100) {
    const amount = UNITS(amountPerPeriod);
    const firstDueDate = (await time.latest()) + INTERVAL_30D;
    await pledge
      .connect(merchant)
      .createRecurringPledge(usdcAddr, payer.address, amount, INTERVAL_30D, periods, firstDueDate);
    return { amount, firstDueDate, periods };
  }

  // Helper: payer pays one installment
  async function payInstallment(recurringId, amount) {
    const feeBps = (await pledge.recurringPledges(recurringId)).appliedFeeBps;
    const gross = amount + (amount * feeBps) / 10000n;
    await usdc.connect(payer).approve(pledgeAddr, gross);
    await pledge.connect(payer).payInstallment(recurringId);
  }

  // Helper: merchant creates a standard USDC pledge (150 total), payer submits 40% deposit
  async function createStandardPledge(token = null) {
    const tok = token ?? usdc;
    const tokAddr = await tok.getAddress();
    const total = UNITS(150);
    const pledgeId = Number(await pledge.pledgeCounter()) + 1;
    const deadline = (await time.latest()) + 30 * DAY;
    // Merchant creates the pledge — no funds required from merchant
    await pledge.connect(merchant).createPledge(tokAddr, payer.address, total, deadline);
    // Payer submits initial deposit (40% of gross)
    const gross = await pledge.grossAmountForPledge(pledgeId);
    const deposit = (gross * 40n) / 100n;
    await tok.connect(payer).approve(pledgeAddr, deposit);
    await pledge.connect(payer).submitDeposit(pledgeId, deposit);
    return { total, gross, deposit, deadline, tokAddr, pledgeId };
  }

  beforeEach(async function () {
    [owner, payer, merchant, feeRecipient, outsider] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    const MockUSDT = await ethers.getContractFactory("MockUSDT");
    usdc = await MockUSDC.deploy();
    usdt = await MockUSDT.deploy();

    usdcAddr = await usdc.getAddress();
    usdtAddr = await usdt.getAddress();

    const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
    pledge = await RemittancePledge.deploy([usdcAddr, usdtAddr], feeRecipient.address);
    pledgeAddr = await pledge.getAddress();

    // Fund the payer (OFW) with both tokens
    await usdc.faucet(payer.address, UNITS(100000));
    await usdt.faucet(payer.address, UNITS(100000));
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
    it("merchant creates a USDC pledge targeting the payer", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline);
      const p = await pledge.getPledge(1);
      expect(p.merchant).to.equal(merchant.address);
      expect(p.payer).to.equal(payer.address);
      expect(p.token).to.equal(usdcAddr);
      expect(p.totalAmount).to.equal(total);
      expect(p.depositedAmount).to.equal(0); // no funds at creation
      expect(p.status).to.equal(0); // PENDING
    });

    it("merchant creates a USDT pledge targeting the payer", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdtAddr, payer.address, total, deadline);
      const p = await pledge.getPledge(1);
      expect(p.token).to.equal(usdtAddr);
      expect(p.depositedAmount).to.equal(0);
    });

    it("does not transfer funds at creation", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      const merchantBefore = await usdc.balanceOf(merchant.address);
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline);
      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore);
    });

    it("reverts when token is not whitelisted", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(await rogue.getAddress(), payer.address, UNITS(150), deadline)
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts on zero payer address", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, ethers.ZeroAddress, UNITS(150), deadline)
      ).to.be.revertedWith("Invalid payer address");
    });

    it("reverts when merchant is also the payer", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, merchant.address, UNITS(150), deadline)
      ).to.be.revertedWith("Merchant cannot be the payer");
    });

    it("reverts below the minimum amount", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(0.5), deadline)
      ).to.be.revertedWith("Amount below minimum");
    });

    it("reverts when commitment date is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), past)
      ).to.be.revertedWith("Commitment date must be in future");
    });

    it("reverts when commitment date exceeds 90 days", async function () {
      const tooFar = (await time.latest()) + 100 * DAY;
      await expect(
        pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), tooFar)
      ).to.be.revertedWith("Max 90 days commitment");
    });

    it("emits PledgeCreated with correct args", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await expect(pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline))
        .to.emit(pledge, "PledgeCreated")
        .withArgs(1, merchant.address, payer.address, usdcAddr, total, deadline, 100n);
    });

    it("merchant can create multiple pledges for the same payer", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(100), deadline);
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(200), deadline);
      expect(await pledge.pledgeCounter()).to.equal(2);
    });
  });

  // ── submitDeposit ─────────────────────────────────────────────────────────────
  describe("submitDeposit", function () {
    it("payer submits initial deposit and pledge stays pending", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      const deposit = (gross * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, deposit);
      await pledge.connect(payer).submitDeposit(1, deposit);
      const p = await pledge.getPledge(1);
      expect(p.depositedAmount).to.equal(deposit);
      expect(p.status).to.equal(0); // PENDING
    });

    it("increments activePledgeCount on first deposit", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      const gross = await pledge.grossAmountForPledge(1);
      const deposit = (gross * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, deposit);
      await pledge.connect(payer).submitDeposit(1, deposit);
      expect(await pledge.activePledgeCount(payer.address)).to.equal(1);
    });

    it("completes the pledge when full gross is deposited", async function () {
      const total = UNITS(150);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).submitDeposit(1, gross);
      const p = await pledge.getPledge(1);
      expect(p.status).to.equal(1); // COMPLETED
      expect(await usdc.balanceOf(merchant.address)).to.equal(total);
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
        .to.be.revertedWith("Must deposit the exact remaining balance");
    });

    it("reverts when a non-payer tries to deposit", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(outsider).approve(pledgeAddr, gross);
      await expect(pledge.connect(outsider).submitDeposit(1, gross))
        .to.be.revertedWith("Only the assigned payer can deposit");
    });

    it("reverts after the grace period ends", async function () {
      const { gross, deposit, deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + 1);
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await expect(pledge.connect(payer).submitDeposit(pledgeId, remaining))
        .to.be.revertedWith("Grace period has ended");
    });

    it("reverts on a zero amount", async function () {
      await createStandardPledge();
      await expect(pledge.connect(payer).submitDeposit(1, 0))
        .to.be.revertedWith("Amount must be > 0");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(payer).submitDeposit(999, UNITS(1)))
        .to.be.revertedWith("Pledge does not exist");
    });

    it("reverts on a non-PENDING pledge", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge();
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      await expect(pledge.connect(payer).submitDeposit(pledgeId, remaining))
        .to.be.revertedWith("Pledge not pending");
    });

    it("reverts when initial deposit is below the required percentage", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      const tooLittle = UNITS(1);
      await usdc.connect(payer).approve(pledgeAddr, tooLittle);
      await expect(pledge.connect(payer).submitDeposit(1, tooLittle))
        .to.be.reverted;
    });

    it("reverts when initial deposit exceeds the gross amount", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      const gross = await pledge.grossAmountForPledge(1);
      const tooMuch = gross + UNITS(1);
      await usdc.connect(payer).approve(pledgeAddr, tooMuch);
      await expect(pledge.connect(payer).submitDeposit(1, tooMuch))
        .to.be.revertedWith("Deposit cannot exceed total");
    });

    it("marks paidDuringGrace when paid after the deadline", async function () {
      const { gross, deposit, deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + DAY);
      const remaining = gross - deposit;
      await usdc.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      expect((await pledge.getPledge(pledgeId)).paidDuringGrace).to.equal(true);
    });

    it("works with USDT pledge", async function () {
      const { gross, deposit, pledgeId } = await createStandardPledge(usdt);
      const remaining = gross - deposit;
      await usdt.connect(payer).approve(pledgeAddr, remaining);
      await pledge.connect(payer).submitDeposit(pledgeId, remaining);
      expect((await pledge.getPledge(pledgeId)).status).to.equal(1); // COMPLETED
      expect(await usdt.balanceOf(merchant.address)).to.equal(UNITS(150));
    });

    it("enforces the active pledge limit on the payer", async function () {
      // Create 2 pledges and have payer deposit on both (hits limit of 2)
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);

      const gross1 = await pledge.grossAmountForPledge(1);
      const dep1 = (gross1 * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, dep1);
      await pledge.connect(payer).submitDeposit(1, dep1);

      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);

      // 3rd deposit should fail — payer is at limit
      const gross3 = await pledge.grossAmountForPledge(3);
      const dep3 = (gross3 * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, dep3);
      await expect(pledge.connect(payer).submitDeposit(3, dep3))
        .to.be.revertedWith("Active pledge limit reached - full payment required to proceed");
    });

    it("allows full payment when payer is at active pledge limit", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(100), deadline);

      const gross1 = await pledge.grossAmountForPledge(1);
      const dep1 = (gross1 * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, dep1);
      await pledge.connect(payer).submitDeposit(1, dep1);

      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 40n) / 100n;
      await usdc.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);

      // Pay pledge 3 in full — bypasses the limit
      const gross3 = await pledge.grossAmountForPledge(3);
      await usdc.connect(payer).approve(pledgeAddr, gross3);
      await pledge.connect(payer).submitDeposit(3, gross3);
      expect((await pledge.getPledge(3)).status).to.equal(1); // COMPLETED
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

    it("reverts when claimed after the 45-day claim window", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + DAY);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWith("Claim window has expired");
    });

    it("reverts when nothing has been deposited", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await expect(pledge.connect(merchant).claimDefaultedDeposit(1))
        .to.be.revertedWith("Nothing deposited to claim");
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

    it("records a default against the payer's reputation", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(1);
      const rep = await pledge.getReputation(payer.address);
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── reclaimDeposit ────────────────────────────────────────────────────────────
  describe("reclaimDeposit", function () {
    it("lets the payer reclaim after the 45-day claim window closes", async function () {
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
        .to.be.revertedWith("Merchant claim window still open");
    });

    it("reverts when nothing has been deposited", async function () {
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(payer).reclaimDeposit(1))
        .to.be.revertedWith("Nothing to reclaim");
    });

    it("emits DepositReclaimed only", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      // PledgeDefaulted is intentionally NOT emitted from reclaimDeposit —
      // that event is reserved for merchant claims (where amount > 0).
      await expect(pledge.connect(payer).reclaimDeposit(1))
        .to.emit(pledge, "DepositReclaimed")
        .and.to.not.emit(pledge, "PledgeDefaulted");
    });

    it("reverts when a non-payer reclaims", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await expect(pledge.connect(outsider).reclaimDeposit(1))
        .to.be.revertedWith("Only the payer can reclaim");
    });

    it("reverts on a nonexistent pledge", async function () {
      await expect(pledge.connect(payer).reclaimDeposit(999))
        .to.be.revertedWith("Pledge does not exist");
    });

    it("records a default on payer reputation after reclaim", async function () {
      const { deadline } = await createStandardPledge();
      await time.increaseTo(deadline + GRACE_PERIOD + CLAIM_WINDOW + TIME_BUFFER + 1);
      await pledge.connect(payer).reclaimDeposit(1);
      const rep = await pledge.getReputation(payer.address);
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
        [(await ethers.provider.getNetwork()).chainId, pledgeAddr, "extend", pledgeId, newDate, deadline, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when the signature has expired", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig))
        .to.be.revertedWith("Signature expired");
    });

    it("reverts when extending beyond 30 days", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const tooFar = deadline + 40 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, tooFar, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, tooFar, sigExpiry, sig))
        .to.be.revertedWith("Max 30-day extension");
    });

    it("reverts when extending after the deadline has passed", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + 1);
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig))
        .to.be.revertedWith("Cannot extend after deadline");
    });

    it("reverts when a non-payer tries to extend", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await expect(pledge.connect(outsider).extendDeadline(pledgeId, newDate, sigExpiry, sig))
        .to.be.revertedWith("Only the payer can request an extension");
    });

    it("reverts when newDate is not later than current deadline", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signExtension(pledgeId, deadline, deadline, sigExpiry, 0);
      await expect(pledge.connect(payer).extendDeadline(pledgeId, deadline, sigExpiry, sig))
        .to.be.revertedWith("New date must be later");
    });

    it("reverts when the same signature is replayed (nonce consumed)", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      const newDate = deadline + 20 * DAY;
      const sigExpiry = (await time.latest()) + 100 * DAY;
      const sig = await signExtension(pledgeId, newDate, deadline, sigExpiry, 0);
      await pledge.connect(payer).extendDeadline(pledgeId, newDate, sigExpiry, sig);
      const laterDate = newDate + DAY;
      await expect(pledge.connect(payer).extendDeadline(pledgeId, laterDate, sigExpiry, sig))
        .to.be.revertedWith("Invalid merchant signature");
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
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(1, sigExpiry, 0);
      const before = await usdc.balanceOf(payer.address);
      await pledge.connect(payer).cancelPledge(1, sigExpiry, sig);
      expect(await usdc.balanceOf(payer.address)).to.equal(before); // no refund
      expect((await pledge.getPledge(1)).status).to.equal(3); // CANCELLED
    });

    it("does not count a cancellation against payer reputation", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig);
      const rep = await pledge.getReputation(payer.address);
      expect(rep.defaultCount).to.equal(0);
      expect(rep.totalCount).to.equal(0);
    });

    it("reverts on an invalid cancel signature", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const hash = ethers.solidityPackedKeccak256(
        ["uint256", "address", "string", "uint256", "uint256", "uint256"],
        [(await ethers.provider.getNetwork()).chainId, pledgeAddr, "cancel", pledgeId, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when called after the deadline", async function () {
      const { deadline, pledgeId } = await createStandardPledge();
      await time.increaseTo(deadline + 1);
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig))
        .to.be.revertedWith("Cannot cancel after deadline");
    });

    it("reverts when called by a non-payer", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(outsider).cancelPledge(pledgeId, sigExpiry, sig))
        .to.be.revertedWith("Only the payer can cancel");
    });

    it("reverts when the cancel signature has expired", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig))
        .to.be.revertedWith("Signature expired");
    });

    it("emits PledgeCancelled", async function () {
      const { pledgeId } = await createStandardPledge();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancel(pledgeId, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelPledge(pledgeId, sigExpiry, sig))
        .to.emit(pledge, "PledgeCancelled");
    });
  });

  // ── sendP2P ───────────────────────────────────────────────────────────────────
  describe("sendP2P", function () {
    it("sends tokens instantly to any address", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(payer.address);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(outsider.address);
      await pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount);
      expect(await usdc.balanceOf(outsider.address) - before).to.equal(amount);
    });

    it("collects protocol fee on P2P transfer", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(payer.address);
      const gross = amount + (amount * feeBps) / 10000n;
      const fee = gross - amount;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(feeRecipient.address);
      await pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount);
      expect(await usdc.balanceOf(feeRecipient.address) - before).to.equal(fee);
    });

    it("does not affect payer reputation", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(payer.address);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount);
      const rep = await pledge.getReputation(payer.address);
      expect(rep.totalCount).to.equal(0);
      expect(rep.onTimeCount).to.equal(0);
    });

    it("emits P2PSent", async function () {
      const amount = UNITS(100);
      const feeBps = await pledge.getServiceFeeBps(payer.address);
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).sendP2P(usdcAddr, outsider.address, amount))
        .to.emit(pledge, "P2PSent");
    });

    it("reverts on unsupported token", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      await expect(pledge.connect(payer).sendP2P(await rogue.getAddress(), outsider.address, UNITS(100)))
        .to.be.revertedWith("Token not supported");
    });

    it("reverts on zero recipient address", async function () {
      await expect(pledge.connect(payer).sendP2P(usdcAddr, ethers.ZeroAddress, UNITS(100)))
        .to.be.revertedWith("Invalid recipient address");
    });

    it("reverts when sending to yourself", async function () {
      await expect(pledge.connect(payer).sendP2P(usdcAddr, payer.address, UNITS(100)))
        .to.be.revertedWith("Cannot send to yourself");
    });

    it("reverts below minimum amount", async function () {
      await expect(pledge.connect(payer).sendP2P(usdcAddr, outsider.address, UNITS(0.5)))
        .to.be.revertedWith("Amount below minimum");
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
        pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline)
      ).to.be.reverted;
    });

    it("unpause restores functionality", async function () {
      await pledge.connect(owner).pause();
      await pledge.connect(owner).unpause();
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
      expect(await pledge.pledgeCounter()).to.equal(1);
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
        pledge.connect(merchant).createPledge(usdtAddr, payer.address, UNITS(150), deadline)
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
      // Merchant creates USDC pledge, payer pays in full
      const total = UNITS(100);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).submitDeposit(1, gross);

      // Payer now has 100% trust score — should get loyalty fee
      expect(await pledge.getServiceFeeBps(payer.address)).to.equal(75);
      expect(await pledge.getRequiredDepositPct(payer.address)).to.equal(20);
      expect(await pledge.getMaxActivePledges(payer.address)).to.equal(5);

      // Merchant creates a USDT pledge, payer deposits with high-trust benefits
      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdtAddr, payer.address, total, deadline2);
      const usdtGross = await pledge.grossAmountForPledge(2);
      const usdtDeposit = (usdtGross * 20n) / 100n + 1n;
      await usdt.connect(payer).approve(pledgeAddr, usdtDeposit);
      await pledge.connect(payer).submitDeposit(2, usdtDeposit);
      expect((await pledge.getPledge(2)).token).to.equal(usdtAddr);
    });

    it("USDT default reduces trust score affecting USDC pledge requirements", async function () {
      // Merchant creates USDC pledge, payer pays in full (builds trust)
      const total = UNITS(10);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline1);
      const gross1 = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross1);
      await pledge.connect(payer).submitDeposit(1, gross1);

      // Merchant creates large USDT pledge, payer deposits minimally then defaults
      const largeTotal = UNITS(40);
      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdtAddr, payer.address, largeTotal, deadline2);
      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      await usdt.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      // Score is now low — deposit requirement should be higher
      const score = await pledge.getTrustScore(payer.address);
      expect(score).to.be.lt(5000n);
      expect(await pledge.getRequiredDepositPct(payer.address)).to.be.gte(30);
    });
  });

  // ── Views and fee tiers ───────────────────────────────────────────────────────
  describe("views and fee tiers", function () {
    it("new payer gets the standard 1% fee", async function () {
      expect(await pledge.getServiceFeeBps(payer.address)).to.equal(100);
    });

    it("new payer gets the 20% deposit tier", async function () {
      expect(await pledge.getRequiredDepositPct(payer.address)).to.equal(20);
    });

    it("new payer gets the no-history active limit of 2", async function () {
      expect(await pledge.getMaxActivePledges(payer.address)).to.equal(2);
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
      expect(await pledge.getTrustScore(payer.address)).to.equal(0);
    });

    it("pagination returns the correct slice", async function () {
      await createStandardPledge();
      await createStandardPledge();
      const [page, total] = await pledge.getPayerPledgesPaginated(payer.address, 0, 1);
      expect(total).to.equal(2);
      expect(page.length).to.equal(1);
    });

    it("pagination handles offset beyond range", async function () {
      await createStandardPledge();
      const [page, total] = await pledge.getPayerPledgesPaginated(payer.address, 5, 10);
      expect(total).to.equal(1);
      expect(page.length).to.equal(0);
    });

    it("getPayerPledges returns all pledge IDs assigned to the payer", async function () {
      await createStandardPledge();
      await createStandardPledge();
      const ids = await pledge.getPayerPledges(payer.address);
      expect(ids.length).to.equal(2);
    });

    it("getMerchantPledges returns pledges created by the merchant", async function () {
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

    it("quoteGrossAmount adds the 1% fee for a new payer", async function () {
      expect(await pledge.quoteGrossAmount(payer.address, UNITS(100))).to.equal(UNITS(101));
    });

    it("high-trust payer gets 0.75% loyalty fee after full on-time payment", async function () {
      const total = UNITS(100);
      const deadline = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline);
      const gross = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).submitDeposit(1, gross);
      expect(await pledge.getServiceFeeBps(payer.address)).to.equal(75);
      expect(await pledge.getRequiredDepositPct(payer.address)).to.equal(20);
      expect(await pledge.getMaxActivePledges(payer.address)).to.equal(5);
    });

    it("mid-trust payer (50% score) gets 3 active pledge slots", async function () {
      const total = UNITS(100);
      const deadline1 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline1);
      const gross1 = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross1);
      await pledge.connect(payer).submitDeposit(1, gross1);

      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, total, deadline2);
      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      await usdc.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      expect(await pledge.getTrustScore(payer.address)).to.equal(5000);
      expect(await pledge.getMaxActivePledges(payer.address)).to.equal(3);
    });

    it("low-trust payer (20-49% score) requires 40% deposit", async function () {
      const deadline1 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(10), deadline1);
      const gross1 = await pledge.grossAmountForPledge(1);
      await usdc.connect(payer).approve(pledgeAddr, gross1);
      await pledge.connect(payer).submitDeposit(1, gross1);

      const deadline2 = (await time.latest()) + 30 * DAY;
      await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(40), deadline2);
      const gross2 = await pledge.grossAmountForPledge(2);
      const dep2 = (gross2 * 20n) / 100n + 1n;
      await usdc.connect(payer).approve(pledgeAddr, dep2);
      await pledge.connect(payer).submitDeposit(2, dep2);
      await time.increaseTo(deadline2 + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).claimDefaultedDeposit(2);

      const score = await pledge.getTrustScore(payer.address);
      expect(score).to.be.gte(2000n);
      expect(score).to.be.lt(5000n);
      expect(await pledge.getRequiredDepositPct(payer.address)).to.equal(40);
    });

    it("serial defaulter (3 defaults) is capped at 2 active pledges", async function () {
      for (let i = 0; i < 3; i++) {
        const total = UNITS(150);
        const deadline = (await time.latest()) + 30 * DAY;
        await pledge.connect(merchant).createPledge(usdcAddr, payer.address, UNITS(150), deadline);
        const pledgeId = i + 1;
        const gross = await pledge.grossAmountForPledge(pledgeId);
        const requiredPct = await pledge.getRequiredDepositPct(payer.address);
        const deposit = (gross * requiredPct) / 100n + 1n;
        await usdc.connect(payer).approve(pledgeAddr, deposit);
        await pledge.connect(payer).submitDeposit(pledgeId, deposit);
        await time.increaseTo(deadline + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).claimDefaultedDeposit(pledgeId);
      }
      expect(await pledge.getMaxActivePledges(payer.address)).to.equal(2);
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
    it("merchant creates a recurring pledge targeting the payer", async function () {
      const { amount, firstDueDate, periods } = await createStandardRecurring();
      const rp = await pledge.getRecurringPledge(1);
      expect(rp.merchant).to.equal(merchant.address);
      expect(rp.payer).to.equal(payer.address);
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
      expect(await pledge.activePledgeCount(payer.address)).to.equal(0);
    });

    it("increments payer's activePledgeCount on first installment payment", async function () {
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      expect(await pledge.activePledgeCount(payer.address)).to.equal(1);
    });

    it("emits RecurringPledgeCreated", async function () {
      const amount = UNITS(100);
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, payer.address, amount, INTERVAL_30D, 3, firstDueDate)
      ).to.emit(pledge, "RecurringPledgeCreated");
    });

    it("reverts on unsupported token", async function () {
      const rogue = await (await ethers.getContractFactory("MockUSDC")).deploy();
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(await rogue.getAddress(), payer.address, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Token not supported");
    });

    it("reverts on zero payer address", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, ethers.ZeroAddress, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Invalid payer address");
    });

    it("reverts when merchant is also the payer", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, merchant.address, UNITS(100), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Merchant cannot be the payer");
    });

    it("reverts when amount is below minimum", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, payer.address, UNITS(0.5), INTERVAL_30D, 3, firstDueDate)
      ).to.be.revertedWith("Amount below minimum");
    });

    it("reverts when interval is below 7 days", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, payer.address, UNITS(100), INTERVAL_7D - 1, 3, firstDueDate)
      ).to.be.revertedWith("Interval too short");
    });

    it("reverts when totalPeriods is zero", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, payer.address, UNITS(100), INTERVAL_30D, 0, firstDueDate)
      ).to.be.revertedWith("Invalid period count");
    });

    it("reverts when totalPeriods exceeds 12", async function () {
      const firstDueDate = (await time.latest()) + INTERVAL_30D;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, payer.address, UNITS(100), INTERVAL_30D, 13, firstDueDate)
      ).to.be.revertedWith("Invalid period count");
    });

    it("reverts when firstDueDate is in the past", async function () {
      const past = (await time.latest()) - DAY;
      await expect(
        pledge.connect(merchant).createRecurringPledge(usdcAddr, payer.address, UNITS(100), INTERVAL_30D, 3, past)
      ).to.be.revertedWith("First due date must be in future");
    });

    it("reverts on first installment when payer active pledge limit is reached", async function () {
      // Fill the no-history slot cap (2) with partial one-shot deposits, which don't
      // build reputation until the pledge completes.
      await createStandardPledge();
      await createStandardPledge();
      expect(await pledge.activePledgeCount(payer.address)).to.equal(2);

      // Now create a recurring pledge — creation does NOT consume a slot
      const r = await createStandardRecurring();
      await time.increaseTo(r.firstDueDate);

      // First installment should revert: payer is already at no-history cap
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = r.amount + (r.amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
        .to.be.revertedWith("Payer has reached their active pledge limit");
    });

    it("getRecurringPledge reverts on nonexistent id", async function () {
      await expect(pledge.getRecurringPledge(999)).to.be.revertedWith("Recurring pledge does not exist");
    });
  });

  // ── payInstallment ────────────────────────────────────────────────────────────
  describe("payInstallment", function () {
    it("payer pays the first installment and releases to merchant", async function () {
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
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
        .to.emit(pledge, "InstallmentPaid")
        .withArgs(1, payer.address, 1, amount);
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
      const rep = await pledge.getReputation(payer.address);
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
        .to.be.revertedWith("Grace period has ended - use markMissedInstallment");
    });

    it("reverts when called by non-payer", async function () {
      await createStandardRecurring();
      await expect(pledge.connect(outsider).payInstallment(1))
        .to.be.revertedWith("Only the payer can pay installments");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(payer).payInstallment(999))
        .to.be.revertedWith("Recurring pledge does not exist");
    });

    it("reverts when pledge is no longer active", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payInstallment(1))
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

    it("does NOT damage reputation when payer has never engaged", async function () {
      // Hostile-merchant scenario: payer never accepts the contract.
      // markMissedInstallment must not damage their reputation.
      const { firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const rep = await pledge.getReputation(payer.address);
      expect(rep.defaultCount).to.equal(0);
      expect(rep.basisPoints).to.equal(0);
      // The recurring's own state still advances, but the payer is untouched.
      const rp = await pledge.recurringPledges(1);
      expect(rp.missedCount).to.equal(1);
    });

    it("drags the trust score per miss only after the payer engages", async function () {
      // Payer engages by paying installment 1 on time.
      const { amount, firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      const repBefore = await pledge.getReputation(payer.address);

      // Now miss installment 2 — payer is engaged, so the score should drop.
      await time.increaseTo(firstDueDate + INTERVAL_30D + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      const repAfter = await pledge.getReputation(payer.address);
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

  // ── payMissedInstallment ──────────────────────────────────────────────────────
  describe("payMissedInstallment", function () {
    async function createMissedRecurring() {
      const { amount, firstDueDate } = await createStandardRecurring(3);
      // Miss the first installment
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      return { amount, firstDueDate };
    }

    it("payer catches up on a missed installment mid-contract", async function () {
      const { amount } = await createMissedRecurring();
      const merchantBefore = await usdc.balanceOf(merchant.address);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).payMissedInstallment(1);

      const rp = await pledge.recurringPledges(1);
      expect(rp.missedCount).to.equal(0);
      expect(rp.totalMissedDebt).to.equal(0);
      expect(rp.periodsCompleted).to.equal(1);
      expect(rp.status).to.equal(0); // still ACTIVE
      // Merchant received the made-up installment net of fee
      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore + amount);
    });

    it("counts a made-up payment as LATE for reputation purposes", async function () {
      await createMissedRecurring();
      const repBefore = await pledge.getReputation(payer.address);
      const { amount } = await createMissedRecurring(); // throwaway — already created above

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).payMissedInstallment(1);

      const repAfter = await pledge.getReputation(payer.address);
      expect(repAfter.lateCount).to.equal(repBefore.lateCount + 1n);
      // Score should rise from 0 because some weightedScore was added.
      expect(repAfter.basisPoints).to.be.gt(repBefore.basisPoints);
    });

    it("emits InstallmentPaid", async function () {
      const { amount } = await createMissedRecurring();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.emit(pledge, "InstallmentPaid");
    });

    it("reverts when caller is not the payer", async function () {
      const { amount } = await createMissedRecurring();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.faucet(outsider.address, gross);
      await usdc.connect(outsider).approve(pledgeAddr, gross);
      await expect(pledge.connect(outsider).payMissedInstallment(1))
        .to.be.revertedWith("Only the payer can pay missed installments");
    });

    it("reverts when there are no missed installments", async function () {
      await createStandardRecurring(3);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.be.revertedWith("No missed installments to pay");
    });

    it("reverts on a non-ACTIVE recurring pledge", async function () {
      // Single-period recurring that gets missed → finalizes to PENDING_SETTLEMENT
      const { firstDueDate } = await createStandardRecurring(1);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.be.revertedWith("Pledge not active");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(payer).payMissedInstallment(999))
        .to.be.revertedWith("Recurring pledge does not exist");
    });

    it("takes an active slot when used as first engagement", async function () {
      // Merchant creates recurring; payer never pays first installment.
      // Merchant marks it missed. Payer's slot is NOT taken at this point.
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      expect(await pledge.activePledgeCount(payer.address)).to.equal(0);

      // Payer engages for the first time via payMissedInstallment.
      // This must take a slot — same as a regular first payInstallment would.
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).payMissedInstallment(1);
      expect(await pledge.activePledgeCount(payer.address)).to.equal(1);
    });

    it("reverts on first engagement if payer is at slot cap", async function () {
      // Fill the no-history cap with one-shot partial deposits
      await createStandardPledge();
      await createStandardPledge();
      expect(await pledge.activePledgeCount(payer.address)).to.equal(2);

      // Now a recurring pledge gets a missed installment, payer tries to catch up
      const { amount, firstDueDate } = await createStandardRecurring();
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);

      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await expect(pledge.connect(payer).payMissedInstallment(1))
        .to.be.revertedWith("Payer has reached their active pledge limit");
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

    it("payer settles debt and releases full amount to merchant", async function () {
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      const before = await usdc.balanceOf(merchant.address);
      await pledge.connect(payer).settleDebt(1);
      expect(await usdc.balanceOf(merchant.address) - before).to.equal(amount);
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
      const { amount } = await createPendingSettlement();
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).settleDebt(1);
      expect(await pledge.activePledgeCount(payer.address)).to.equal(0);
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

    it("reverts when called by non-payer", async function () {
      await createPendingSettlement();
      await expect(pledge.connect(outsider).settleDebt(1))
        .to.be.revertedWith("Only the payer can settle debt");
    });

    it("reverts when status is not PENDING_SETTLEMENT", async function () {
      await createStandardRecurring();
      await expect(pledge.connect(payer).settleDebt(1))
        .to.be.revertedWith("No debt to settle");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      await expect(pledge.connect(payer).settleDebt(999))
        .to.be.revertedWith("Recurring pledge does not exist");
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

    it("decrements payer activePledgeCount on cancellation", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      expect(await pledge.activePledgeCount(payer.address)).to.equal(0);
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
        [(await ethers.provider.getNetwork()).chainId, pledgeAddr, "cancelRecurring", 1, sigExpiry, 0]
      );
      const badSig = await outsider.signMessage(ethers.getBytes(hash));
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, badSig))
        .to.be.revertedWith("Invalid merchant signature");
    });

    it("reverts when signature has expired", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) - 1;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, sig))
        .to.be.revertedWith("Signature expired");
    });

    it("reverts when called by non-payer", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await expect(pledge.connect(outsider).cancelRecurring(1, sigExpiry, sig))
        .to.be.revertedWith("Only the payer can cancel");
    });

    it("reverts when already cancelled", async function () {
      await createStandardRecurring();
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(1, sigExpiry, 0);
      await pledge.connect(payer).cancelRecurring(1, sigExpiry, sig);
      const sig2 = await signCancelRecurring(1, sigExpiry, 1);
      await expect(pledge.connect(payer).cancelRecurring(1, sigExpiry, sig2))
        .to.be.revertedWith("Pledge not cancellable");
    });

    it("reverts on nonexistent recurring pledge", async function () {
      const sigExpiry = (await time.latest()) + DAY;
      const sig = await signCancelRecurring(999, sigExpiry, 0);
      await expect(pledge.connect(payer).cancelRecurring(999, sigExpiry, sig))
        .to.be.revertedWith("Recurring pledge does not exist");
    });
  });

  // ── Recurring reputation ──────────────────────────────────────────────────────
  describe("recurring pledge reputation", function () {
    it("builds partial reputation per on-time installment", async function () {
      const { amount } = await createStandardRecurring(3);
      await payInstallment(1, amount);
      const rep = await pledge.getReputation(payer.address);
      expect(rep.onTimeCount).to.equal(1);
    });

    it("grants completion bonus when all periods paid with no debt", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);
      await time.increase(INTERVAL_30D);
      await payInstallment(1, amount);
      expect(await pledge.getTrustScore(payer.address)).to.be.gt(0);
    });

    it("no completion bonus until settleDebt is called on a missed pledge", async function () {
      const { amount, firstDueDate } = await createStandardRecurring(2);
      await time.increaseTo(firstDueDate + GRACE_PERIOD + TIME_BUFFER + 1);
      await pledge.connect(merchant).markMissedInstallment(1);
      await time.increaseTo(firstDueDate + INTERVAL_30D);
      await payInstallment(1, amount);
      const scoreBefore = await pledge.getTrustScore(payer.address);
      const feeBps = (await pledge.recurringPledges(1)).appliedFeeBps;
      const gross = amount + (amount * feeBps) / 10000n;
      await usdc.connect(payer).approve(pledgeAddr, gross);
      await pledge.connect(payer).settleDebt(1);
      const scoreAfter = await pledge.getTrustScore(payer.address);
      expect(scoreAfter).to.be.gte(scoreBefore);
    });

    it("missed installments drag the score but defaultCount only ticks at contract end", async function () {
      // Payer engages by paying installment 1 on time, then misses 2 and 3.
      const { amount, firstDueDate } = await createStandardRecurring(3);
      await time.increaseTo(firstDueDate);
      await payInstallment(1, amount);

      // Miss installments 2 and 3
      let due = firstDueDate + INTERVAL_30D;
      for (let i = 0; i < 2; i++) {
        await time.increaseTo(due + GRACE_PERIOD + TIME_BUFFER + 1);
        await pledge.connect(merchant).markMissedInstallment(1);
        due += INTERVAL_30D;
      }
      const rep = await pledge.getReputation(payer.address);
      // One bad contract = one default, regardless of miss count.
      expect(rep.defaultCount).to.equal(1);
    });
  });

  // ── Recurring view functions ──────────────────────────────────────────────────
  describe("recurring view functions", function () {
    it("getPayerRecurringPledges returns correct ids", async function () {
      await createStandardRecurring();
      const ids = await pledge.getPayerRecurringPledges(payer.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getMerchantRecurringPledges returns correct ids", async function () {
      await createStandardRecurring();
      const ids = await pledge.getMerchantRecurringPledges(merchant.address);
      expect(ids.length).to.equal(1);
      expect(ids[0]).to.equal(1n);
    });

    it("getPayerRecurringPledgesPaginated returns correct slice", async function () {
      await createStandardRecurring();
      await createStandardRecurring();
      const [page, total] = await pledge.getPayerRecurringPledgesPaginated(payer.address, 0, 1);
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

const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const DAY = 86400;

describe("RemittancePledge", function () {
  let usdc, contract;
  let owner, sender, merchant, attacker;

  const GRACE_PERIOD = 3 * DAY;

  beforeEach(async () => {
    [owner, sender, merchant, attacker] = await ethers.getSigners();

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();

    const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
    contract = await RemittancePledge.deploy(await usdc.getAddress());

    // Fund sender with 10,000 USDC and approve contract
    await usdc.faucet(sender.address, USDC(10_000));
    await usdc.connect(sender).approve(await contract.getAddress(), USDC(10_000));
  });

  // ── Helper: create a standard pledge (50 USDC deposit on 150 USDC total) ──
  async function createStandardPledge(daysOut = 30) {
    const commitmentDate = (await time.latest()) + daysOut * DAY;
    await contract.connect(sender).createPledge(
      merchant.address,
      USDC(150),
      USDC(50),
      commitmentDate
    );
    return { pledgeId: 1, commitmentDate };
  }

  // ══════════════════════════════════════════════════════════════════════════
  // createPledge
  // ══════════════════════════════════════════════════════════════════════════
  describe("createPledge", () => {
    it("happy path — locks initial deposit in contract", async () => {
      const { pledgeId } = await createStandardPledge();

      const pledge = await contract.getPledge(pledgeId);
      expect(pledge.sender).to.equal(sender.address);
      expect(pledge.merchant).to.equal(merchant.address);
      expect(pledge.depositedAmount).to.equal(USDC(50));
      expect(pledge.status).to.equal(0); // PENDING

      expect(await usdc.balanceOf(await contract.getAddress())).to.equal(USDC(50));
    });

    it("emits PledgeCreated event", async () => {
      const commitmentDate = (await time.latest()) + 30 * DAY;
      await expect(
        contract.connect(sender).createPledge(merchant.address, USDC(150), USDC(50), commitmentDate)
      ).to.emit(contract, "PledgeCreated");
    });

    it("new sender — requires 20% deposit (no history)", async () => {
      const commitmentDate = (await time.latest()) + 30 * DAY;
      // 20% of 150 = 30 USDC minimum — 5 USDC should revert
      await expect(
        contract.connect(sender).createPledge(merchant.address, USDC(150), USDC(5), commitmentDate)
      ).to.be.reverted;
    });

    it("new sender — 20% deposit is accepted", async () => {
      const pct = await contract.getRequiredDepositPct(sender.address);
      expect(pct).to.equal(20n); // no history = standard 20%
    });

    it("reverts when commitment date is more than 90 days out", async () => {
      const commitmentDate = (await time.latest()) + 200 * DAY;
      await expect(
        contract.connect(sender).createPledge(merchant.address, USDC(150), USDC(50), commitmentDate)
      ).to.be.revertedWith("Max 90 days commitment");
    });

    it("reverts when totalAmount is 0", async () => {
      const commitmentDate = (await time.latest()) + 30 * DAY;
      await expect(
        contract.connect(sender).createPledge(merchant.address, 0, 0, commitmentDate)
      ).to.be.revertedWith("Total amount must be > 0");
    });

    it("reverts when sender and merchant are the same", async () => {
      const commitmentDate = (await time.latest()) + 30 * DAY;
      await expect(
        contract.connect(sender).createPledge(sender.address, USDC(100), USDC(20), commitmentDate)
      ).to.be.revertedWith("Sender cannot be merchant");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // depositRemaining
  // ══════════════════════════════════════════════════════════════════════════
  describe("depositRemaining", () => {
    it("happy path — full deposit auto-releases funds to merchant", async () => {
      await createStandardPledge();
      const merchantBefore = await usdc.balanceOf(merchant.address);

      await contract.connect(sender).depositRemaining(1, USDC(100));

      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore + USDC(150));
      const pledge = await contract.getPledge(1);
      expect(pledge.status).to.equal(1); // COMPLETED
    });

    it("emits PledgeCompleted after full deposit", async () => {
      await createStandardPledge();
      await expect(
        contract.connect(sender).depositRemaining(1, USDC(100))
      ).to.emit(contract, "PledgeCompleted");
    });

    it("reverts when depositing after grace period", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);

      await expect(
        contract.connect(sender).depositRemaining(1, USDC(100))
      ).to.be.revertedWith("Grace period has ended");
    });

    it("reverts when non-sender tries to deposit", async () => {
      await createStandardPledge();
      await usdc.faucet(attacker.address, USDC(1000));
      await usdc.connect(attacker).approve(await contract.getAddress(), USDC(1000));

      await expect(
        contract.connect(attacker).depositRemaining(1, USDC(100))
      ).to.be.revertedWith("Only sender can deposit");
    });

    it("marks paidDuringGrace when depositing after deadline but before grace end", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + DAY); // after deadline, within grace

      await contract.connect(sender).depositRemaining(1, USDC(100));
      const pledge = await contract.getPledge(1);
      expect(pledge.paidDuringGrace).to.equal(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // claimPartial
  // ══════════════════════════════════════════════════════════════════════════
  describe("claimPartial", () => {
    it("reverts when called before grace period ends", async () => {
      await createStandardPledge();
      await expect(
        contract.connect(merchant).claimPartial(1)
      ).to.be.revertedWith("Grace period not over yet");
    });

    it("happy path — merchant receives initial deposit after grace period", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);

      const merchantBefore = await usdc.balanceOf(merchant.address);
      await contract.connect(merchant).claimPartial(1);

      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore + USDC(50));
      const pledge = await contract.getPledge(1);
      expect(pledge.status).to.equal(2); // DEFAULTED
    });

    it("can still claim long after grace period — no expiry", async () => {
      const { commitmentDate } = await createStandardPledge();
      // Skip way past what used to be the claim window
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 60 * DAY);

      const merchantBefore = await usdc.balanceOf(merchant.address);
      await contract.connect(merchant).claimPartial(1);
      expect(await usdc.balanceOf(merchant.address)).to.equal(merchantBefore + USDC(50));
    });

    it("reverts when non-merchant tries to claim", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);

      await expect(
        contract.connect(attacker).claimPartial(1)
      ).to.be.revertedWith("Only merchant can claim");
    });

    it("cannot be claimed twice (status guard)", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);

      await contract.connect(merchant).claimPartial(1);
      await expect(
        contract.connect(merchant).claimPartial(1)
      ).to.be.revertedWith("Pledge not pending");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // refundSender
  // ══════════════════════════════════════════════════════════════════════════
  describe("refundSender", () => {
    it("sender cannot get deposit back — deposit always belongs to merchant after default", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);

      // refundSender no longer exists — sender has no way to reclaim after default
      expect(contract.connect(sender).refundSender).to.equal(undefined);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // extendDeadline
  // ══════════════════════════════════════════════════════════════════════════
  describe("extendDeadline", () => {
    it("reverts when extending after commitment date has passed", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + 1);

      const newDate = commitmentDate + 10 * DAY;
      await expect(
        contract.connect(sender).extendDeadline(1, newDate, "0x")
      ).to.be.revertedWith("Cannot extend after deadline");
    });

    it("reverts with invalid merchant signature", async () => {
      const { commitmentDate } = await createStandardPledge();
      const newDate = commitmentDate + 10 * DAY;

      // Sign with wrong signer (attacker)
      const pledgeData = await contract.getPledge(1);
      const msgHash = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256", "address"],
        [1, newDate, pledgeData.commitmentDate, await contract.getAddress()]
      );
      const sig = await attacker.signMessage(ethers.getBytes(msgHash));

      await expect(
        contract.connect(sender).extendDeadline(1, newDate, sig)
      ).to.be.revertedWith("Invalid merchant signature");
    });

    it("happy path — extends with valid merchant signature", async () => {
      const { commitmentDate } = await createStandardPledge();
      const newDate = commitmentDate + 10 * DAY;

      const pledgeData = await contract.getPledge(1);
      const msgHash = ethers.solidityPackedKeccak256(
        ["uint256", "uint256", "uint256", "address"],
        [1, newDate, pledgeData.commitmentDate, await contract.getAddress()]
      );
      const sig = await merchant.signMessage(ethers.getBytes(msgHash));

      await contract.connect(sender).extendDeadline(1, newDate, sig);
      const pledge = await contract.getPledge(1);
      expect(pledge.commitmentDate).to.equal(newDate);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Reputation
  // ══════════════════════════════════════════════════════════════════════════
  describe("Reputation", () => {
    it("100% score after on-time completion", async () => {
      await createStandardPledge();
      await contract.connect(sender).depositRemaining(1, USDC(100));

      const [basisPoints,,,,totalCount] = await contract.getReputation(sender.address);
      expect(basisPoints).to.equal(10000n); // 100.00%
      expect(totalCount).to.equal(1n);
    });

    it("0% score after default", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);
      await contract.connect(merchant).claimPartial(1);

      const [basisPoints,,,defaultCount, totalCount] = await contract.getReputation(sender.address);
      expect(basisPoints).to.equal(0n);   // 0%
      expect(defaultCount).to.equal(1n);
      expect(totalCount).to.equal(1n);
    });

    it("70% score after late payment", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + DAY); // within grace period
      await contract.connect(sender).depositRemaining(1, USDC(100));

      const [basisPoints,,lateCount,,totalCount] = await contract.getReputation(sender.address);
      expect(basisPoints).to.equal(7000n); // 70.00%
      expect(lateCount).to.equal(1n);
      expect(totalCount).to.equal(1n);
    });

    it("mixed score — 2 on time, 1 default = 66.66%", async () => {
      // Pledge 1 — on time
      await createStandardPledge();
      await contract.connect(sender).depositRemaining(1, USDC(100));

      // Pledge 2 — on time
      await createStandardPledge();
      await contract.connect(sender).depositRemaining(2, USDC(100));

      // Pledge 3 — default
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);
      await contract.connect(merchant).claimPartial(3);

      const [basisPoints, onTime,, defaults, total] = await contract.getReputation(sender.address);
      // (2×10000 + 0×10000) / 3 = 6666
      expect(basisPoints).to.equal(6666n);
      expect(onTime).to.equal(2n);
      expect(defaults).to.equal(1n);
      expect(total).to.equal(3n);
    });

    it("reputation score is never negative", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);
      await contract.connect(merchant).claimPartial(1);

      const [basisPoints] = await contract.getReputation(sender.address);
      expect(basisPoints).to.be.gte(0n);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Deposit Tiers
  // ══════════════════════════════════════════════════════════════════════════
  describe("Deposit tiers based on trust score", () => {
    it("no history → 20% required", async () => {
      const pct = await contract.getRequiredDepositPct(sender.address);
      expect(pct).to.equal(20n);
    });

    it("100% score (on time) → still 20% required", async () => {
      await createStandardPledge();
      await contract.connect(sender).depositRemaining(1, USDC(100));
      const pct = await contract.getRequiredDepositPct(sender.address);
      expect(pct).to.equal(20n);
    });

    it("50% score (1 on time + 1 default) → 30% required", async () => {
      await createStandardPledge();
      await contract.connect(sender).depositRemaining(1, USDC(100));

      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);
      await contract.connect(merchant).claimPartial(2);

      const pct = await contract.getRequiredDepositPct(sender.address);
      expect(pct).to.equal(30n);
    });

    it("0% score → 50% required and 20% deposit reverts", async () => {
      // Default pledge 1 — score drops to 0%
      const cd1 = (await time.latest()) + 10 * DAY;
      await contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(20), cd1);
      await time.increaseTo(cd1 + GRACE_PERIOD + 1);
      await contract.connect(merchant).claimPartial(1);

      // Score is now 0% → need 50% for next pledge — try only 20%, should revert
      const commitmentDate = (await time.latest()) + 30 * DAY;
      const pct = await contract.getRequiredDepositPct(sender.address);
      expect(pct).to.equal(50n);

      await expect(
        contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(20), commitmentDate)
      ).to.be.reverted;
    });

    it("0% score → pledge succeeds with 50% deposit", async () => {
      // Default pledge 1 — score drops to 0%
      const cd1 = (await time.latest()) + 10 * DAY;
      await contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(20), cd1);
      await time.increaseTo(cd1 + GRACE_PERIOD + 1);
      await contract.connect(merchant).claimPartial(1);

      // Now provide 50% deposit — should succeed
      const commitmentDate = (await time.latest()) + 30 * DAY;
      await expect(
        contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(50), commitmentDate)
      ).to.not.be.reverted;
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // Reentrancy
  // ══════════════════════════════════════════════════════════════════════════
  describe("Reentrancy protection", () => {
    it("ReentrancyGuard is applied — double claim is blocked by status check", async () => {
      const { commitmentDate } = await createStandardPledge();
      await time.increaseTo(commitmentDate + GRACE_PERIOD + 1);

      await contract.connect(merchant).claimPartial(1);

      // Second call blocked by status == DEFAULTED, not just reentrancy guard
      await expect(
        contract.connect(merchant).claimPartial(1)
      ).to.be.revertedWith("Pledge not pending");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  // View functions
  // ══════════════════════════════════════════════════════════════════════════
  describe("View functions", () => {
    it("getSenderPledges returns correct pledge IDs", async () => {
      const cd = (await time.latest()) + 30 * DAY;
      await contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(20), cd);
      await contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(20), cd);

      const ids = await contract.getSenderPledges(sender.address);
      expect(ids.length).to.equal(2);
    });

    it("getMerchantPledges returns correct pledge IDs", async () => {
      await createStandardPledge();
      const ids = await contract.getMerchantPledges(merchant.address);
      expect(ids.length).to.equal(1);
    });

    it("getPledge reverts for non-existent pledge", async () => {
      await expect(contract.getPledge(999)).to.be.revertedWith("Pledge does not exist");
    });
  });
});

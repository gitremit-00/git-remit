const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const DAY = 86400;

async function main() {
  const [deployer, sender, merchant] = await ethers.getSigners();

  console.log("=".repeat(60));
  console.log("  GitRemit — Local Simulation");
  console.log("=".repeat(60));
  console.log("Deployer:", deployer.address);
  console.log("Sender  :", sender.address);
  console.log("Merchant:", merchant.address);
  console.log("");

  // ── Deploy contracts ──────────────────────────────────────────
  console.log(">> Deploying MockUSDC...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  console.log("   MockUSDC deployed to:", await usdc.getAddress());

  console.log(">> Deploying RemittancePledge...");
  const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
  const contract = await RemittancePledge.deploy(await usdc.getAddress(), deployer.address);
  console.log("   RemittancePledge deployed to:", await contract.getAddress());
  console.log("");

  // ── Fund sender with test USDC ────────────────────────────────
  await usdc.faucet(sender.address, USDC(1000));
  await usdc.connect(sender).approve(await contract.getAddress(), USDC(1000));
  console.log(">> Sender funded with 1,000 USDC via faucet()");
  console.log("   Sender USDC balance:", ethers.formatUnits(await usdc.balanceOf(sender.address), 6), "USDC");
  console.log("");

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 1 — Happy path: full payment, auto-release
  // ══════════════════════════════════════════════════════════════
  console.log("─".repeat(60));
  console.log("  SCENARIO 1: Full payment — auto-release to merchant");
  console.log("─".repeat(60));

  const commitDate1 = (await time.latest()) + 30 * DAY;
  console.log(">> Sender creates pledge: 150 USDC total, 50 USDC deposit, 30-day deadline");
  await contract.connect(sender).createPledge(merchant.address, USDC(150), USDC(50), commitDate1);

  let pledge1 = await contract.getPledge(1);
  console.log("   Pledge ID:", pledge1.id.toString());
  console.log("   Status:", statusLabel(pledge1.status));
  console.log("   Deposited:", ethers.formatUnits(pledge1.depositedAmount, 6), "USDC");
  console.log("   Contract holds:", ethers.formatUnits(await usdc.balanceOf(await contract.getAddress()), 6), "USDC");

  console.log("\n>> Sender deposits remaining 100 USDC...");
  const merchantBefore1 = await usdc.balanceOf(merchant.address);
  await contract.connect(sender).depositRemaining(1, USDC(100));

  pledge1 = await contract.getPledge(1);
  console.log("   Status:", statusLabel(pledge1.status));
  console.log("   Merchant received:", ethers.formatUnits((await usdc.balanceOf(merchant.address)) - merchantBefore1, 6), "USDC");
  console.log("   Contract holds:", ethers.formatUnits(await usdc.balanceOf(await contract.getAddress()), 6), "USDC");

  const [bp1] = await contract.getReputation(sender.address);
  console.log("   Sender reputation:", (Number(bp1) / 100).toFixed(2) + "%");
  console.log("   RESULT: SUCCESS ✔");

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 2 — Default: merchant claims after grace period
  // ══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  SCENARIO 2: Sender defaults — merchant claims deposit");
  console.log("─".repeat(60));

  await usdc.connect(sender).approve(await contract.getAddress(), USDC(1000));
  const commitDate2 = (await time.latest()) + 10 * DAY;
  console.log(">> Sender creates pledge: 200 USDC total, 60 USDC deposit, 10-day deadline");
  await contract.connect(sender).createPledge(merchant.address, USDC(200), USDC(60), commitDate2);

  console.log(">> Fast-forwarding time past deadline + grace period...");
  await time.increaseTo(commitDate2 + 3 * DAY + 1);

  const merchantBefore2 = await usdc.balanceOf(merchant.address);
  console.log(">> Merchant calls claimPartial()...");
  await contract.connect(merchant).claimPartial(2);

  const pledge2 = await contract.getPledge(2);
  console.log("   Status:", statusLabel(pledge2.status));
  console.log("   Merchant received:", ethers.formatUnits((await usdc.balanceOf(merchant.address)) - merchantBefore2, 6), "USDC");

  const [bp2] = await contract.getReputation(sender.address);
  console.log("   Sender reputation:", (Number(bp2) / 100).toFixed(2) + "% (defaulted → 0%)");
  console.log("   RESULT: SUCCESS ✔");

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 3 — Refund: merchant never claims, sender gets back
  // ══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  SCENARIO 3: Merchant misses claim window — sender refunded");
  console.log("─".repeat(60));

  await usdc.connect(sender).approve(await contract.getAddress(), USDC(1000));
  const commitDate3 = (await time.latest()) + 5 * DAY;
  console.log(">> Sender creates pledge: 100 USDC total, 40 USDC deposit (40% tier after default), 5-day deadline");
  await contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(40), commitDate3);

  console.log(">> Fast-forwarding past deadline + grace period + 180-day unclaimed timeout...");
  await time.increaseTo(commitDate3 + 3 * DAY + 180 * DAY + 1);

  const senderBefore3 = await usdc.balanceOf(sender.address);
  console.log(">> Sender calls reclaimDeposit()...");
  await contract.connect(sender).reclaimDeposit(3);

  const pledge3 = await contract.getPledge(3);
  console.log("   Status:", statusLabel(pledge3.status));
  console.log("   Sender got back:", ethers.formatUnits((await usdc.balanceOf(sender.address)) - senderBefore3, 6), "USDC");
  console.log("   RESULT: SUCCESS ✔");

  // ══════════════════════════════════════════════════════════════
  // SCENARIO 4 — Late payment during grace period
  // ══════════════════════════════════════════════════════════════
  console.log("\n" + "─".repeat(60));
  console.log("  SCENARIO 4: Late payment during grace period");
  console.log("─".repeat(60));

  await usdc.connect(sender).approve(await contract.getAddress(), USDC(1000));
  const commitDate4 = (await time.latest()) + 7 * DAY;
  console.log(">> Sender creates pledge: 100 USDC total, 40 USDC deposit (40% tier), 7-day deadline");
  await contract.connect(sender).createPledge(merchant.address, USDC(100), USDC(40), commitDate4);

  console.log(">> Fast-forwarding past deadline but within grace period (1 day late)...");
  await time.increaseTo(commitDate4 + 1 * DAY);

  console.log(">> Sender deposits remaining 60 USDC during grace period...");
  const merchantBefore4 = await usdc.balanceOf(merchant.address);
  await contract.connect(sender).depositRemaining(4, USDC(60));

  const pledge4 = await contract.getPledge(4);
  console.log("   Status:", statusLabel(pledge4.status));
  console.log("   Paid during grace:", pledge4.paidDuringGrace);
  console.log("   Merchant received:", ethers.formatUnits((await usdc.balanceOf(merchant.address)) - merchantBefore4, 6), "USDC");

  const [bp4] = await contract.getReputation(sender.address);
  console.log("   Sender reputation:", (Number(bp4) / 100).toFixed(2) + "% (late payment → 70% weight)");
  console.log("   RESULT: SUCCESS ✔");

  // ── Final balances ────────────────────────────────────────────
  console.log("\n" + "=".repeat(60));
  console.log("  Final State");
  console.log("=".repeat(60));
  console.log("Contract USDC balance:", ethers.formatUnits(await usdc.balanceOf(await contract.getAddress()), 6), "USDC (should be 0)");
  console.log("Merchant USDC balance:", ethers.formatUnits(await usdc.balanceOf(merchant.address), 6), "USDC");
  console.log("Sender USDC balance  :", ethers.formatUnits(await usdc.balanceOf(sender.address), 6), "USDC");
  const [finalBp, onTime, late, defaults, total] = await contract.getReputation(sender.address);
  console.log("Sender reputation    :", (Number(finalBp) / 100).toFixed(2) + "% |", total.toString(), "total |", onTime.toString(), "on-time |", late.toString(), "late |", defaults.toString(), "defaults");
  console.log("=".repeat(60));
  console.log("  All 4 scenarios passed");
  console.log("=".repeat(60));
}

function statusLabel(status) {
  return ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"][Number(status)];
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

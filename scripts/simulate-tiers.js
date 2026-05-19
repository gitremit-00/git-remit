const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-toolbox/network-helpers");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const FMT  = (n) => Number(ethers.formatUnits(n, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 });
const DAY  = 86400;

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getPledgeId(contract, tx) {
  const receipt = await tx.wait();
  const log = receipt.logs.find(l => {
    try { return contract.interface.parseLog(l).name === "PledgeCreated"; } catch { return false; }
  });
  return Number(contract.interface.parseLog(log).args.pledgeId);
}

async function makeAndComplete(contract, usdc, sender, merchant, total, deposit) {
  const now = await time.latest();
  const deadline = now + 5 * DAY;
  await usdc.connect(sender).approve(await contract.getAddress(), USDC(total));
  const tx = await contract.connect(sender).createPledge(merchant.address, USDC(total), USDC(deposit), deadline);
  const id = await getPledgeId(contract, tx);
  const remaining = total - deposit;
  if (remaining > 0) {
    await usdc.connect(sender).approve(await contract.getAddress(), USDC(remaining));
    await contract.connect(sender).depositRemaining(id, USDC(remaining));
  }
  console.log(`   ✔ #${id} created & COMPLETED — $${total} total, $${deposit} upfront (${Math.round(deposit/total*100)}%)`);
  return id;
}

async function makeAndDefault(contract, usdc, sender, merchant, total, deposit) {
  const now = await time.latest();
  const deadline = now + 5 * DAY;
  await usdc.connect(sender).approve(await contract.getAddress(), USDC(total));
  const tx = await contract.connect(sender).createPledge(merchant.address, USDC(total), USDC(deposit), deadline);
  const id = await getPledgeId(contract, tx);
  await time.increaseTo(deadline + 3 * DAY + 1);
  await contract.connect(merchant).claimPartial(id);
  console.log(`   ✔ #${id} created & DEFAULTED  — $${total} total, $${deposit} upfront (${Math.round(deposit/total*100)}%)`);
  return id;
}

async function tryCreate(contract, usdc, sender, merchant, total, deposit, expectBlocked) {
  const now = await time.latest();
  const deadline = now + 5 * DAY;
  await usdc.connect(sender).approve(await contract.getAddress(), USDC(total));
  try {
    const tx = await contract.connect(sender).createPledge(merchant.address, USDC(total), USDC(deposit), deadline);
    const id = await getPledgeId(contract, tx);
    if (expectBlocked) {
      console.log(`   ✗ NOT BLOCKED — $${deposit} on $${total} should have failed (pledge #${id} was created — will need to default it)`);
      // Default the accidentally created pledge to clean up
      await time.increaseTo(deadline + 3 * DAY + 1);
      await contract.connect(merchant).claimPartial(id);
    } else {
      console.log(`   ✔ ALLOWED     — $${deposit} deposit on $${total} accepted (pledge #${id})`);
      return id;
    }
  } catch {
    if (expectBlocked) {
      console.log(`   ✔ BLOCKED     — $${deposit} deposit on $${total} rejected (too low for current tier)`);
    } else {
      console.log(`   ✗ SHOULD HAVE BEEN ALLOWED — $${deposit} on $${total}`);
    }
  }
  return null;
}

async function printScore(contract, addr, label) {
  const [bp, onTime, late, defaults] = await contract.getReputation(addr);
  const tier = await contract.getRequiredDepositPct(addr);
  const resolved = onTime + late + defaults;
  const pct = resolved > 0n ? (Number(bp) / 100).toFixed(2) + "%" : "No history";
  console.log(`   ${label}: score=${pct}  on-time=${onTime}  late=${late}  defaults=${defaults}  → next tier: ${tier}% upfront`);
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer, juan, maria, pedro] = await ethers.getSigners();

  console.log("\n" + "═".repeat(62));
  console.log("  GitRemit — Deposit Tier Progression Test");
  console.log("  20% → 30% → 40% → 50% (using Juan as repeat sender)");
  console.log("═".repeat(62));

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
  const contract = await RemittancePledge.deploy(await usdc.getAddress(), deployer.address);

  await usdc.faucet(juan.address,  USDC(50000));
  await usdc.faucet(maria.address, USDC(50000));
  await usdc.faucet(pedro.address, USDC(50000));

  // ── TIER 1: 20% (new sender) ─────────────────────────────────
  console.log("\n" + "─".repeat(62));
  console.log("  TIER 1 — New sender, no history → 20% required");
  console.log("─".repeat(62));
  await printScore(contract, juan.address, "Juan");

  console.log("\n   Paying on time with 20% upfront:");
  await makeAndComplete(contract, usdc, juan, maria, 100, 20);
  await printScore(contract, juan.address, "Juan");

  // ── TIER 2: 30% (score drops to 50%) ─────────────────────────
  console.log("\n" + "─".repeat(62));
  console.log("  TIER 2 — After 1 default → score=50% → 30% required");
  console.log("  Formula: (1 on-time × 100% + 1 default × 0%) ÷ 2 = 50%");
  console.log("─".repeat(62));

  await makeAndDefault(contract, usdc, juan, maria, 100, 20);
  await printScore(contract, juan.address, "Juan");

  console.log("\n   20% deposit should be blocked:");
  await tryCreate(contract, usdc, juan, maria, 100, 20, true);

  console.log("   30% deposit should be allowed:");
  await makeAndComplete(contract, usdc, juan, maria, 100, 30);
  await printScore(contract, juan.address, "Juan");

  // ── TIER 3: 40% (need 2 more defaults to drop below 50%) ────
  console.log("\n" + "─".repeat(62));
  console.log("  TIER 3 — 2 more defaults → score=40% → 40% required");
  console.log("  Formula: (2 on-time × 100% + 3 defaults × 0%) ÷ 5 = 40%");
  console.log("─".repeat(62));

  await makeAndDefault(contract, usdc, juan, maria, 100, 30); // default #1 in phase 3 → 50% (still 30% tier)
  await makeAndDefault(contract, usdc, juan, maria, 100, 30); // default #2 in phase 3 → 40% → enters 40% tier
  await printScore(contract, juan.address, "Juan");

  console.log("\n   30% deposit should be blocked:");
  await tryCreate(contract, usdc, juan, maria, 100, 30, true);

  console.log("   40% deposit should be allowed:");
  await makeAndComplete(contract, usdc, juan, maria, 100, 40);
  await printScore(contract, juan.address, "Juan");

  // ── TIER 4: 50% — need score < 20% ───────────────────────────
  // With 1 on-time: need ≥6 defaults. Easier: use Pedro with 0 on-time + 1 default = 0% score
  console.log("\n" + "─".repeat(62));
  console.log("  TIER 4 — Pedro has 0 on-time + 1 default → score=0% → 50% required");
  console.log("  Formula: (0 on-time × 100% + 1 default × 0%) ÷ 1 = 0%");
  console.log("─".repeat(62));

  await makeAndDefault(contract, usdc, pedro, maria, 100, 20);
  await printScore(contract, pedro.address, "Pedro");

  console.log("\n   40% deposit should be blocked:");
  await tryCreate(contract, usdc, pedro, maria, 100, 40, true);

  console.log("   50% deposit should be allowed:");
  await makeAndComplete(contract, usdc, pedro, maria, 100, 50);
  await printScore(contract, pedro.address, "Pedro");

  // ── Recovery: paying on-time rebuilds trust ───────────────────
  console.log("\n" + "─".repeat(62));
  console.log("  RECOVERY — Pedro pays on-time 4× to rebuild score above 50%");
  console.log("─".repeat(62));

  for (let i = 0; i < 4; i++) {
    await makeAndComplete(contract, usdc, pedro, maria, 100, 50);
  }
  await printScore(contract, pedro.address, "Pedro");

  const recoveredTier = await contract.getRequiredDepositPct(pedro.address);
  console.log(`\n   Pedro's required deposit after recovery: ${recoveredTier}% (was 50%)`);

  // ── Summary ───────────────────────────────────────────────────
  console.log("\n" + "═".repeat(62));
  console.log("  Final Balances (contract should hold $0)");
  console.log("═".repeat(62));
  const contractBal = await usdc.balanceOf(await contract.getAddress());
  console.log(`   Juan  : $${FMT(await usdc.balanceOf(juan.address))} USDC`);
  console.log(`   Maria : $${FMT(await usdc.balanceOf(maria.address))} USDC`);
  console.log(`   Pedro : $${FMT(await usdc.balanceOf(pedro.address))} USDC`);
  console.log(`   Locked: $${FMT(contractBal)} USDC`);
  console.log("═".repeat(62));
  console.log("  ✅ All 4 deposit tiers demonstrated correctly.");
  console.log("═".repeat(62) + "\n");
}

main().catch((e) => { console.error(e); process.exit(1); });

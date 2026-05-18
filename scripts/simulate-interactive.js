const { ethers } = require("hardhat");
const readline = require("readline");

const USDC = (n) => ethers.parseUnits(String(n), 6);
const FROM_USDC = (n) => Number(ethers.formatUnits(n, 6)).toLocaleString("en-US", { minimumFractionDigits: 2 });
const DAY = 86400;

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((res) => rl.question(q, res));

let usdc, contract, accounts;
let blockTime = 0;

// ── Helpers ────────────────────────────────────────────────────
function statusBadge(s) {
  const badges = [
    "🟡 Waiting for full payment",
    "✅ Fully paid — money sent to receiver",
    "❌ Missed deadline — deposit was forfeited",
    "⚠️  Under dispute",
  ];
  return badges[Number(s)];
}

function roleName(i) {
  return ["", "Juan (Sender)", "Maria (Receiver)", "Pedro (Extra)"][i];
}

function shortAddr(addr) {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

async function getSimTime() {
  const block = await ethers.provider.getBlock("latest");
  return block.timestamp;
}

async function fastForward(days) {
  await ethers.provider.send("evm_increaseTime", [days * DAY]);
  await ethers.provider.send("evm_mine", []);
  blockTime += days;
  console.log(`\n   ⏩ Skipped ${days} day(s) forward — total time skipped: ${blockTime} days\n`);
}

async function printBalances() {
  const contractBal = await usdc.balanceOf(await contract.getAddress());
  console.log("\n┌─────────────────────────────────────────────────────────┐");
  console.log("│                    Wallet Balances                      │");
  console.log("├─────────────────────────────────────────────────────────┤");
  for (let i = 1; i <= 3; i++) {
    const bal = await usdc.balanceOf(accounts[i].address);
    const name = roleName(i).padEnd(20);
    console.log(`│   ${name}  $${FROM_USDC(bal)} USDC`);
  }
  console.log(`│   ${"Locked in Contract".padEnd(20)}  $${FROM_USDC(contractBal)} USDC`);
  console.log("└─────────────────────────────────────────────────────────┘\n");
}

async function printPledge(id) {
  try {
    const p = await contract.getPledge(id);
    const statusNum = Number(p.status);
    const remaining = p.totalAmount - p.depositedAmount;

    let paymentLine;
    if (statusNum === 0) {
      paymentLine = `$${FROM_USDC(p.depositedAmount)} paid so far — $${FROM_USDC(remaining)} still needed`;
    } else if (statusNum === 1) {
      paymentLine = `$${FROM_USDC(p.totalAmount)} sent to receiver`;
    } else if (statusNum === 2) {
      paymentLine = `$${FROM_USDC(p.initialDeposit)} deposit was forfeited`;
    } else {
      paymentLine = `$${FROM_USDC(p.depositedAmount)} (under dispute)`;
    }

    const senderName = roleName(accounts.findIndex(a => a.address.toLowerCase() === p.sender.toLowerCase()));
    const merchantName = roleName(accounts.findIndex(a => a.address.toLowerCase() === p.merchant.toLowerCase()));
    const deadline = new Date(Number(p.commitmentDate) * 1000).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
    const paidLate = p.paidDuringGrace ? "Yes (paid during grace period)" : "No";

    console.log(`\n┌─────────────────────────────────────────────────────────┐`);
    console.log(`│                   Payment #${String(id).padEnd(29)}│`);
    console.log(`├─────────────────────────────────────────────────────────┤`);
    console.log(`│   Status      : ${statusBadge(p.status)}`);
    console.log(`│   From        : ${senderName || shortAddr(p.sender)}`);
    console.log(`│   To          : ${merchantName || shortAddr(p.merchant)}`);
    console.log(`│   Total Amount: $${FROM_USDC(p.totalAmount)} USDC`);
    console.log(`│   Upfront Paid: $${FROM_USDC(p.initialDeposit)} USDC`);
    console.log(`│   Payment     : ${paymentLine}`);
    console.log(`│   Due Date    : ${deadline}`);
    console.log(`│   Paid Late   : ${paidLate}`);
    console.log(`└─────────────────────────────────────────────────────────┘\n`);
  } catch {
    console.log(`\n   Payment #${id} not found.\n`);
  }
}

async function printReputation(wallet, label) {
  const [basisPoints, onTime, late, defaults, total] = await contract.getReputation(wallet);
  const pct = total > 0n ? (Number(basisPoints) / 100).toFixed(2) : "No payments yet";
  const bar = total > 0n ? buildBar(Number(basisPoints)) : "──────────────────────";

  console.log(`\n┌─────────────────────────────────────────────────────────┐`);
  console.log(`│             Trust Score — ${label.padEnd(30)}│`);
  console.log(`├─────────────────────────────────────────────────────────┤`);
  console.log(`│   Score       : ${total > 0n ? pct + "%" : pct}`);
  console.log(`│   ${bar}`);
  console.log(`│   Paid On Time: ${onTime} payment(s)`);
  console.log(`│   Paid Late   : ${late} payment(s) — within grace period`);
  console.log(`│   Missed      : ${defaults} payment(s)`);
  console.log(`│   Total       : ${total} payment(s) made`);
  console.log(`└─────────────────────────────────────────────────────────┘\n`);
}

function buildBar(basisPoints) {
  const filled = Math.round(basisPoints / 500); // 20 chars = 10000 bp
  const empty = 20 - filled;
  const bar = "█".repeat(filled) + "░".repeat(empty);
  return `[${bar}] ${(basisPoints / 100).toFixed(0)}%`;
}

// ── Actions ────────────────────────────────────────────────────
async function doCreatePledge() {
  console.log("\n   Who is sending the payment?");
  console.log("   1 = Juan (Sender)");
  console.log("   2 = Maria (Receiver)");
  console.log("   3 = Pedro (Extra)");
  const sIdx = parseInt(await ask("   Pick sender (1/2/3): "));

  console.log("\n   Who is receiving the payment?");
  const mIdx = parseInt(await ask("   Pick receiver (1/2/3): "));

  if (sIdx === mIdx) { console.log("\n   Sender and receiver cannot be the same person.\n"); return; }

  const total = await ask("\n   Total amount to pay (USDC): $");
  const requiredPct = await contract.getRequiredDepositPct(accounts[sIdx].address);
  const minDeposit = (Number(total) * Number(requiredPct) / 100).toFixed(2);
  const deposit = await ask(`   Upfront deposit (minimum $${minDeposit} — ${requiredPct}% required for your trust score): $`);
  const days = await ask("   Pay in full within how many days? (max 90): ");

  const now = await getSimTime();
  const commitDate = now + parseInt(days) * DAY;

  try {
    const sender = accounts[sIdx];
    const merchant = accounts[mIdx];

    await usdc.connect(sender).approve(await contract.getAddress(), USDC(total));
    const tx = await contract.connect(sender).createPledge(
      merchant.address, USDC(total), USDC(deposit), commitDate
    );
    const receipt = await tx.wait();
    const event = receipt.logs.find(l => {
      try { return contract.interface.parseLog(l).name === "PledgeCreated"; } catch { return false; }
    });
    const parsed = contract.interface.parseLog(event);
    console.log(`\n   Payment commitment created!`);
    await printPledge(Number(parsed.args.pledgeId));
  } catch (e) {
    const msg = e.message.includes("Min 20%") ? "Upfront deposit is below the 20% minimum."
      : e.message.includes("Max 90") ? "Due date cannot be more than 90 days from now."
      : e.message.includes("must be > 0") ? "Amount must be greater than zero."
      : e.message.includes("ERC20Insufficient") ? "Not enough USDC in your wallet. Use option 9 to get more."
      : e.message.split("'")[1] || e.message.split("(")[0].trim();
    console.log(`\n   Could not create payment: ${msg}\n`);
  }
}

async function doDeposit() {
  const id = await ask("   Which payment number do you want to top up? #");
  const amount = await ask("   How much USDC do you want to add? $");

  try {
    const pledge = await contract.getPledge(id);
    const sender = accounts.find(a => a.address.toLowerCase() === pledge.sender.toLowerCase());
    if (!sender) { console.log("   This wallet is not the sender for this payment.\n"); return; }

    await usdc.connect(sender).approve(await contract.getAddress(), USDC(amount));
    await contract.connect(sender).depositRemaining(id, USDC(amount));
    console.log(`\n   $${amount} USDC added successfully!`);
    await printPledge(Number(id));
  } catch (e) {
    const msg = e.message.includes("Grace period has ended") ? "The grace period has ended. You can no longer add to this payment."
      : e.message.includes("not pending") ? "This payment is no longer active."
      : e.message.includes("ERC20Insufficient") ? "Not enough USDC in your wallet."
      : e.message.split("'")[1] || e.message.split("(")[0].trim();
    console.log(`\n   Could not add payment: ${msg}\n`);
  }
}

async function doClaimPartial() {
  const id = await ask("   Which payment number do you want to claim? #");

  try {
    const pledge = await contract.getPledge(id);
    const merchant = accounts.find(a => a.address.toLowerCase() === pledge.merchant.toLowerCase());
    if (!merchant) { console.log("   This wallet is not the receiver for this payment.\n"); return; }

    await contract.connect(merchant).claimPartial(id);
    console.log(`\n   Deposit claimed! The upfront amount has been sent to the receiver.`);
    await printPledge(Number(id));
  } catch (e) {
    const msg = e.message.includes("Grace period not over") ? "The grace period is not over yet. Please wait 3 days after the due date."
      : e.message.includes("Claim window has expired") ? "The 30-day claim window has passed. You can no longer claim this."
      : e.message.includes("not pending") ? "This payment is no longer active."
      : e.message.split("'")[1] || e.message.split("(")[0].trim();
    console.log(`\n   Could not claim: ${msg}\n`);
  }
}


async function doFaucet() {
  console.log("\n   Who needs USDC?");
  console.log("   1 = Juan (Sender)");
  console.log("   2 = Maria (Receiver)");
  console.log("   3 = Pedro (Extra)");
  const idx = parseInt(await ask("   Pick wallet (1/2/3): "));
  const amount = await ask(`   How much USDC to add to ${roleName(idx)}? $`);
  await usdc.faucet(accounts[idx].address, USDC(amount));
  console.log(`\n   $${amount} USDC added to ${roleName(idx)}'s wallet!\n`);
}

// ── Main menu ──────────────────────────────────────────────────
async function menu() {
  console.log("\n╔═══════════════════════════════════════════════════╗");
  console.log("║           GitRemit — Payment Simulator            ║");
  console.log("╠═══════════════════════════════════════════════════╣");
  console.log("║  1.  Make a Payment Commitment                    ║");
  console.log("║  2.  Send Remaining Balance                       ║");
  console.log("║  3.  Claim Missed Payment (Receiver only)         ║");
  console.log("║  4.  View Payment Details                         ║");
  console.log("║  5.  View Trust Score                             ║");
  console.log("║  6.  View Wallet Balances                         ║");
  console.log("║  7.  Skip Days (simulate time passing)            ║");
  console.log("║  8.  Add USDC to Wallet                           ║");
  console.log("║  0.  Exit                                         ║");
  console.log("╚═══════════════════════════════════════════════════╝");

  const choice = await ask("   What would you like to do? ");

  switch (choice.trim()) {
    case "1": await doCreatePledge(); break;
    case "2": await doDeposit(); break;
    case "3": await doClaimPartial(); break;
    case "4": {
      const id = await ask("   Payment number: #");
      await printPledge(Number(id));
      break;
    }
    case "5": {
      console.log("   1 = Juan  2 = Maria  3 = Pedro");
      const idx = parseInt(await ask("   Which person? (1/2/3): "));
      await printReputation(accounts[idx].address, roleName(idx));
      break;
    }
    case "6": await printBalances(); break;
    case "7": {
      const days = await ask("   Skip how many days? ");
      await fastForward(parseInt(days));
      break;
    }
    case "8": await doFaucet(); break;
    case "0":
      console.log("\n   Thanks for using GitRemit. Goodbye!\n");
      rl.close();
      process.exit(0);
    default:
      console.log("   Please enter a number from the menu.\n");
  }

  await menu();
}

// ── Bootstrap ──────────────────────────────────────────────────
async function main() {
  accounts = await ethers.getSigners();

  console.log("\n   Starting GitRemit simulator...");
  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  usdc = await MockUSDC.deploy();

  const RemittancePledge = await ethers.getContractFactory("RemittancePledge");
  contract = await RemittancePledge.deploy(await usdc.getAddress());

  for (let i = 1; i <= 3; i++) {
    await usdc.faucet(accounts[i].address, USDC(500));
  }

  console.log("\n   ✅ Ready! Here are your test wallets:\n");
  console.log(`   1. Juan  (Sender)   — ${accounts[1].address} — $500.00 USDC`);
  console.log(`   2. Maria (Receiver) — ${accounts[2].address} — $500.00 USDC`);
  console.log(`   3. Pedro (Extra)    — ${accounts[3].address} — $500.00 USDC`);
  console.log("\n   Each wallet starts with $500 USDC. Use option 9 to add more.\n");

  await menu();
}

main().catch((err) => {
  console.error(err);
  rl.close();
  process.exit(1);
});

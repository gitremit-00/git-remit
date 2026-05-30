/**
 * One-time script: push correct on-chain verification for all DB-verified profiles.
 * Run from the repo root:
 *   node scripts/fix-onchain-kyc.mjs
 */

import { ethers } from "ethers";
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const frontendDir = __dirname; // script is inside frontend/
config({ path: join(frontendDir, ".env.local") });

const REQUIRED = [
  "MORPH_RPC_URL",
  "OWNER_PRIVATE_KEY",
  "NEXT_PUBLIC_SUPABASE_URL",
  "SUPABASE_SERVICE_ROLE_KEY",
];
for (const key of REQUIRED) {
  if (!process.env[key]) { console.error(`Missing env var: ${key}`); process.exit(1); }
}

// Load ABI + address
const abi = JSON.parse(readFileSync(join(frontendDir, "contracts/RemittancePledge.json"), "utf8"));

// Parse REMITTANCE_PLEDGE address directly from addresses.ts
const addressesTs = readFileSync(join(frontendDir, "contracts/addresses.ts"), "utf8");
const pledgeAddrMatch = addressesTs.match(/REMITTANCE_PLEDGE:\s*"(0x[0-9a-fA-F]+)"/);
if (!pledgeAddrMatch) { console.error("Could not parse REMITTANCE_PLEDGE from addresses.ts"); process.exit(1); }
const PLEDGE_ADDRESS = pledgeAddrMatch[1];

// deriveAccountId (mirrors frontend/lib/accountId.ts)
function deriveAccountId(profileUuid) {
  return ethers.keccak256(ethers.toUtf8Bytes(`remitsafe:account:${profileUuid}`));
}

async function main() {
  const provider = new ethers.JsonRpcProvider(process.env.MORPH_RPC_URL);
  const wallet = new ethers.Wallet(process.env.OWNER_PRIVATE_KEY, provider);
  const contract = new ethers.Contract(PLEDGE_ADDRESS, abi, wallet);

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  const { data: profiles, error } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("kyc_status", "verified");

  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!profiles?.length) { console.log("No verified profiles found."); return; }

  console.log(`Found ${profiles.length} verified profile(s). Pushing on-chain...\n`);

  for (const profile of profiles) {
    const accountId = deriveAccountId(profile.id);
    try {
      // All verified accounts get baseline 5000 for trust score
      const tx1 = await contract.setVerificationBaseline(accountId, 5000);
      await tx1.wait();
      // Merchants additionally get the merchant-verified flag
      if (profile.role === "merchant") {
        const tx2 = await contract.setMerchantVerified(accountId, true);
        await tx2.wait();
      }
      console.log(`✅ ${profile.role.padEnd(10)} ${profile.id}  →  ${accountId.slice(0, 14)}...`);
    } catch (err) {
      console.error(`❌ ${profile.id}: ${err.message}`);
    }
  }

  console.log("\nDone.");
}

main().catch(err => { console.error(err); process.exit(1); });

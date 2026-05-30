import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { adminClient } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";
import { deriveAccountId } from "../../../../../lib/accountId";
import RemittancePledgeABI from "../../../../../contracts/RemittancePledge.json";
import { CONTRACTS } from "../../../../../contracts/addresses";

const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";

async function getOwnerContract() {
  const ownerKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerKey) throw new Error("OWNER_PRIVATE_KEY not set");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ownerKey, provider);
  return new ethers.Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, wallet);
}

async function setMerchantVerifiedOnChain(accountId: string, verified: boolean): Promise<void> {
  const contract = await getOwnerContract();
  const tx = await contract.setMerchantVerified(accountId, verified);
  await tx.wait();
}

async function setVerificationBaselineOnChain(accountId: string, verified: boolean): Promise<void> {
  const contract = await getOwnerContract();
  // BASELINE_KYC = 5000, 0 = unverified
  const tx = await contract.setVerificationBaseline(accountId, verified ? 5000 : 0);
  await tx.wait();
}

type KYCAction = "approve" | "reject" | "needs_revision";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { action, reason } = (await req.json()) as { action: KYCAction; reason?: string };

    if (!["approve", "reject", "needs_revision"].includes(action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }
    if ((action === "reject" || action === "needs_revision") && !reason?.trim()) {
      return NextResponse.json({ error: "A reason is required for this action." }, { status: 400 });
    }

    const statusMap: Record<KYCAction, string> = {
      approve: "verified",
      reject: "rejected",
      needs_revision: "needs_revision",
    };

    const admin = adminClient();

    const { data: profile, error: fetchError } = await admin
      .from("profiles")
      .select("role")
      .eq("id", id)
      .single();

    if (fetchError || !profile) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    const { error } = await admin
      .from("profiles")
      .update({
        kyc_status: statusMap[action],
        kyc_rejection_reason: reason?.trim() ?? null,
        kyc_reviewed_by: session.userId,
        kyc_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Mirror on-chain using accountId (UUID-derived), not wallet address
    const accountId = deriveAccountId(id);
    try {
      // All accounts get a verification baseline (drives trust score)
      await setVerificationBaselineOnChain(accountId, action === "approve");
      // Merchants additionally need the merchant-verified flag
      if (profile.role === "merchant") {
        await setMerchantVerifiedOnChain(accountId, action === "approve");
      }
    } catch (chainErr) {
      console.error("On-chain verification failed:", chainErr);
      return NextResponse.json({
        ok: true,
        status: statusMap[action],
        warning: "DB updated but on-chain verification failed. Check OWNER_PRIVATE_KEY and RPC.",
      });
    }

    return NextResponse.json({ ok: true, status: statusMap[action] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

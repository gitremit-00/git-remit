import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { adminClient } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";
import RemittancePledgeABI from "../../../../../contracts/RemittancePledge.json";

const PLEDGE_ADDRESS = "0x18d74B544Fa754f1A8927e916506205b9dbF2721";
const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";

async function getOwnerContract() {
  const ownerKey = process.env.OWNER_PRIVATE_KEY;
  if (!ownerKey) throw new Error("OWNER_PRIVATE_KEY not set");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(ownerKey, provider);
  return new ethers.Contract(PLEDGE_ADDRESS, RemittancePledgeABI, wallet);
}

async function setMerchantVerifiedOnChain(merchantAddress: string, verified: boolean): Promise<void> {
  const contract = await getOwnerContract();
  const tx = await contract.setMerchantVerified(merchantAddress, verified);
  await tx.wait();
}

async function setPayerVerifiedOnChain(payerAddress: string, verified: boolean): Promise<void> {
  const contract = await getOwnerContract();
  // BASELINE_KYC = 5000, 0 = unverified
  const tx = await contract.setVerificationBaseline(payerAddress, verified ? 5000 : 0);
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

    // Fetch the profile first so we have the role and wallet address
    const { data: profile, error: fetchError } = await admin
      .from("profiles")
      .select("role, wallet_address")
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

    // Mirror verification status on-chain for both merchants and senders
    if (profile.wallet_address) {
      try {
        if (profile.role === "merchant") {
          await setMerchantVerifiedOnChain(profile.wallet_address, action === "approve");
        } else {
          // sender / ofw_sender — set verificationBaseline
          await setPayerVerifiedOnChain(profile.wallet_address, action === "approve");
        }
      } catch (chainErr) {
        console.error("On-chain verification failed:", chainErr);
        return NextResponse.json({
          ok: true,
          status: statusMap[action],
          warning: "DB updated but on-chain verification failed. Check OWNER_PRIVATE_KEY and RPC.",
        });
      }
    } else if (action === "approve") {
      return NextResponse.json({
        ok: true,
        status: statusMap[action],
        warning: "User has no wallet address on file. They must connect their wallet before on-chain verification can be applied.",
      });
    }

    return NextResponse.json({ ok: true, status: statusMap[action] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

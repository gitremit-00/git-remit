import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../lib/auth-server";
import { verifySessionCookie } from "../../../lib/session";
import { deriveAccountId } from "../../../lib/accountId";
import { ethers } from "ethers";
import RemittancePledgeABI from "../../../contracts/RemittancePledge.json";
import { CONTRACTS } from "../../../contracts/addresses";

const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";

async function getVerificationOperatorContract() {
  const key = process.env.VERIFICATION_OPERATOR_PRIVATE_KEY;
  if (!key) return null;
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(key, provider);
  return new ethers.Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, wallet);
}

export async function GET(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const admin = adminClient();
    const { data, error } = await admin
      .from("profiles")
      .select(
        "id,username,role,full_name,phone_number,email," +
        "country_of_work,country_of_origin,bio,avatar_url," +
        "business_name,business_type,business_address,city," +
        "kyc_status,kyc_rejection_reason,created_at,updated_at"
      )
      .eq("id", session.userId)
      .single();

    if (error || !data) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const body = await req.json() as Record<string, string | null>;
    const { name, bio, phone, country, avatar_url } = body;

    const admin = adminClient();

    // Fetch current avatar_url to detect null→value transition
    let prevAvatarUrl: string | null = null;
    if (avatar_url !== undefined) {
      const { data } = await admin
        .from("profiles")
        .select("avatar_url")
        .eq("id", session.userId)
        .single();
      prevAvatarUrl = data?.avatar_url ?? null;
    }

    const updates: Record<string, string | null> = {};
    if (name !== undefined) updates.full_name = name ?? null;
    if (bio !== undefined) updates.bio = bio ?? null;
    if (phone !== undefined) updates.phone_number = phone ?? null;
    if (country !== undefined) updates.country_of_origin = country ?? null;
    if (avatar_url !== undefined) updates.avatar_url = avatar_url ?? null;
    updates.updated_at = new Date().toISOString();

    const { error } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", session.userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // Auto-boost verification baseline when avatar goes from null to set
    if (avatar_url && !prevAvatarUrl) {
      void boostIfEligible(session.userId);
    }

    const { data } = await admin
      .from("profiles")
      .select(
        "id,username,role,full_name,phone_number,email," +
        "country_of_work,country_of_origin,bio,avatar_url," +
        "business_name,business_type,business_address,city," +
        "kyc_status,kyc_rejection_reason,created_at,updated_at"
      )
      .eq("id", session.userId)
      .single();

    return NextResponse.json(data);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

async function boostIfEligible(profileId: string) {
  try {
    const contract = await getVerificationOperatorContract();
    if (!contract) return;
    const accountId = deriveAccountId(profileId);
    const baseline = await contract.accountVerificationBaseline(accountId) as bigint;
    // BASELINE_KYC = 5000
    if (baseline === 5000n) {
      const tx = await contract.boostVerificationBaseline(accountId);
      await tx.wait();
    }
  } catch (err) {
    console.error("Avatar boost failed (non-critical):", err);
  }
}

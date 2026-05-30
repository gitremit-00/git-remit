import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";
import { deriveAccountId } from "../../../../lib/accountId";
import RemittancePledgeABI from "../../../../contracts/RemittancePledge.json";
import { CONTRACTS } from "../../../../contracts/addresses";

const RPC_URL = process.env.MORPH_RPC_URL ?? "https://rpc-hoodi.morph.network";
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const { walletAddress } = (await req.json()) as { walletAddress?: string };
    if (!walletAddress || !WALLET_RE.test(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    const normalized = walletAddress.toLowerCase();
    const admin = adminClient();

    const { data: existing } = await admin
      .from("profile_wallets")
      .select("profile_id")
      .eq("wallet_address", normalized)
      .maybeSingle();

    if (existing) {
      if (existing.profile_id === session.userId) {
        return NextResponse.json({ available: true, alreadyOnSameAccount: true });
      }
      return NextResponse.json(
        { available: false, reason: "linked_to_other_account" },
        { status: 409 }
      );
    }

    // Cross-check on-chain
    try {
      const provider = new ethers.JsonRpcProvider(RPC_URL);
      const contract = new ethers.Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, provider);
      const onChainAccountId = await contract.walletToAccount(normalized) as string;
      const expectedAccountId = deriveAccountId(session.userId);
      if (onChainAccountId !== ethers.ZeroHash && onChainAccountId !== expectedAccountId) {
        return NextResponse.json(
          { available: false, reason: "linked_to_other_account" },
          { status: 409 }
        );
      }
    } catch {
      // Non-fatal — DB check above is authoritative
    }

    return NextResponse.json({ available: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

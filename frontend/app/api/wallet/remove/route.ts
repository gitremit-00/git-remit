import { NextRequest, NextResponse } from "next/server";
import { ethers } from "ethers";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

export async function POST(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const { walletAddress, signedMessage } = (await req.json()) as {
      walletAddress?: string;
      signedMessage?: string;
    };

    if (!walletAddress || !WALLET_RE.test(walletAddress)) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }
    if (!signedMessage) {
      return NextResponse.json({ error: "signedMessage is required." }, { status: 400 });
    }

    // Verify the signed message proves ownership of walletAddress
    const message = `RemitSafe: remove wallet ${walletAddress.toLowerCase()} from my account`;
    const recovered = ethers.verifyMessage(message, signedMessage);
    if (recovered.toLowerCase() !== walletAddress.toLowerCase()) {
      return NextResponse.json({ error: "Signature verification failed." }, { status: 403 });
    }

    const normalized = walletAddress.toLowerCase();
    const admin = adminClient();

    // Verify wallet belongs to this profile
    const { data: wallet } = await admin
      .from("profile_wallets")
      .select("is_primary")
      .eq("profile_id", session.userId)
      .eq("wallet_address", normalized)
      .maybeSingle();

    if (!wallet) {
      return NextResponse.json({ error: "Wallet not found on this account." }, { status: 404 });
    }

    // Count remaining wallets
    const { count } = await admin
      .from("profile_wallets")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", session.userId);

    if ((count ?? 0) <= 1) {
      return NextResponse.json({ error: "Cannot remove the last linked wallet." }, { status: 400 });
    }

    if (wallet.is_primary) {
      return NextResponse.json({
        error: "Cannot remove the primary wallet. Set another wallet as primary first.",
      }, { status: 400 });
    }

    const { error } = await admin
      .from("profile_wallets")
      .delete()
      .eq("profile_id", session.userId)
      .eq("wallet_address", normalized);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

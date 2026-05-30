import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

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

    // Verify the wallet belongs to this profile
    const { data: wallet } = await admin
      .from("profile_wallets")
      .select("id")
      .eq("profile_id", session.userId)
      .eq("wallet_address", normalized)
      .maybeSingle();

    if (!wallet) {
      return NextResponse.json({ error: "Wallet not found on this account." }, { status: 404 });
    }

    // Clear all primaries then set the chosen one
    await admin
      .from("profile_wallets")
      .update({ is_primary: false })
      .eq("profile_id", session.userId);

    const { error } = await admin
      .from("profile_wallets")
      .update({ is_primary: true })
      .eq("profile_id", session.userId)
      .eq("wallet_address", normalized);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

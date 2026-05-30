import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const admin = adminClient();
    const { data, error } = await admin
      .from("profile_wallets")
      .select("wallet_address,is_primary")
      .eq("profile_id", session.userId)
      .order("is_primary", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const wallets = (data ?? []).map(row => ({
      address: row.wallet_address,
      isPrimary: row.is_primary,
    }));

    return NextResponse.json({ wallets });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

export async function PATCH(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const { wallet_address } = (await req.json()) as { wallet_address: string };
    if (!wallet_address || !/^0x[0-9a-fA-F]{40}$/.test(wallet_address)) {
      return NextResponse.json({ error: "Invalid wallet address." }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin
      .from("profiles")
      .update({ wallet_address: wallet_address.toLowerCase(), updated_at: new Date().toISOString() })
      .eq("id", session.userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

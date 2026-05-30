import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { id } = await params;
    const admin = adminClient();
    const { data, error } = await admin
      .from("profile_wallets")
      .select("wallet_address,is_primary,confirmed_at")
      .eq("profile_id", id)
      .order("is_primary", { ascending: false });

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ wallets: data ?? [] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

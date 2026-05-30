import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";
import { deriveAccountId } from "../../../../lib/accountId";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ uuid: string }> }
) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const { uuid } = await params;
    if (!uuid || !UUID_RE.test(uuid)) {
      return NextResponse.json({ error: "Not a valid RemitSafe account ID." }, { status: 400 });
    }

    const admin = adminClient();
    const { data, error } = await admin
      .from("profiles")
      .select("id,role,full_name,kyc_status,avatar_url")
      .eq("id", uuid)
      .maybeSingle();

    if (error || !data) {
      return NextResponse.json({ error: "No account found." }, { status: 404 });
    }

    const accountId = deriveAccountId(data.id);

    // Check if profile has any linked wallets
    const { count: walletCount } = await admin
      .from("profile_wallets")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", data.id);

    const firstName = (data.full_name ?? "").split(" ")[0];
    const lastInitial = (data.full_name ?? "").split(" ")[1]?.[0];
    const displayName = firstName
      ? lastInitial ? `${firstName} ${lastInitial}.` : firstName
      : "RemitSafe User";

    return NextResponse.json({
      uuid: data.id,
      accountId,
      displayName,
      role: data.role,
      verified: data.kyc_status === "verified",
      hasAvatar: Boolean(data.avatar_url),
      hasLinkedWallet: (walletCount ?? 0) > 0,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

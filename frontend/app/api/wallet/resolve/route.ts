import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";
import { deriveAccountId } from "../../../../lib/accountId";

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/;

function toDisplayName(fullName: string | null): string {
  const firstName = (fullName ?? "").split(" ")[0];
  const lastInitial = (fullName ?? "").split(" ")[1]?.[0];
  return firstName ? (lastInitial ? `${firstName} ${lastInitial}.` : firstName) : "RemitSafe User";
}

// Resolve a batch of wallet addresses → their owning profile (account ID + display name).
// Used to show the sender's name / account ID for received P2P transfers.
export async function POST(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const { addresses } = (await req.json()) as { addresses?: string[] };
    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json({ profiles: [] });
    }
    const normalized = [...new Set(
      addresses.map((a) => String(a).toLowerCase()).filter((a) => WALLET_RE.test(a))
    )];
    if (normalized.length === 0) return NextResponse.json({ profiles: [] });

    const admin = adminClient();
    const { data: links } = await admin
      .from("profile_wallets")
      .select("wallet_address, profile_id")
      .in("wallet_address", normalized);

    if (!links || links.length === 0) return NextResponse.json({ profiles: [] });

    const profileIds = [...new Set(links.map((l) => l.profile_id))];
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, account_status")
      .in("id", profileIds);

    const profileMap = new Map<string, { name: string; onHold: boolean }>();
    (profiles ?? []).forEach((p) => profileMap.set(p.id, {
      name: toDisplayName(p.full_name),
      onHold: p.account_status === "on_hold",
    }));

    const result = links
      .filter((l) => !profileMap.get(l.profile_id)?.onHold)
      .map((l) => ({
        address: l.wallet_address,
        uuid: l.profile_id,
        accountId: deriveAccountId(l.profile_id),
        displayName: profileMap.get(l.profile_id)?.name ?? "RemitSafe User",
      }));

    return NextResponse.json({ profiles: result });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

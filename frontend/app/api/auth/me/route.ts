import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const admin = adminClient();
  const { data } = await admin
    .from("profiles")
    .select("kyc_status, kyc_rejection_reason")
    .eq("id", session.userId)
    .single();

  return NextResponse.json({
    userId: session.userId,
    role: session.role,
    kycStatus: (data?.kyc_status as string) ?? "pending",
    kycRejectionReason: data?.kyc_rejection_reason ?? null,
  });
}

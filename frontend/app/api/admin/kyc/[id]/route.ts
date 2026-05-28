import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";

type KYCAction = "approve" | "reject" | "needs_revision";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { action, reason } = (await req.json()) as { action: KYCAction; reason?: string };

    if (!["approve", "reject", "needs_revision"].includes(action)) {
      return NextResponse.json({ error: "Invalid action." }, { status: 400 });
    }
    if ((action === "reject" || action === "needs_revision") && !reason?.trim()) {
      return NextResponse.json({ error: "A reason is required for this action." }, { status: 400 });
    }

    const statusMap: Record<KYCAction, string> = {
      approve: "verified",
      reject: "rejected",
      needs_revision: "needs_revision",
    };

    const admin = adminClient();
    const { error } = await admin
      .from("profiles")
      .update({
        kyc_status: statusMap[action],
        kyc_rejection_reason: reason?.trim() ?? null,
        kyc_reviewed_by: session.userId,
        kyc_reviewed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ ok: true, status: statusMap[action] });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

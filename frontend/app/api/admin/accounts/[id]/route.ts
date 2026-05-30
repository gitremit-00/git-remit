import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json() as { action: "hold" | "unhold"; reason?: string };

    if (body.action !== "hold" && body.action !== "unhold") {
      return NextResponse.json({ error: "action must be 'hold' or 'unhold'." }, { status: 400 });
    }

    const admin = adminClient();
    const updates =
      body.action === "hold"
        ? {
            account_status: "on_hold",
            account_hold_reason: body.reason ?? null,
            account_held_at: new Date().toISOString(),
          }
        : {
            account_status: "active",
            account_hold_reason: null,
            account_held_at: null,
          };

    const { error } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", id);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    return NextResponse.json({ success: true, account_status: updates.account_status });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

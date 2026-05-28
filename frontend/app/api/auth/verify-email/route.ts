import { NextRequest, NextResponse } from "next/server";
import { adminClient, verifySecret } from "../../../../lib/auth-server";
import { verifySignedCookie, type PendingOtpSession } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  try {
    const { otp } = await req.json();
    const code = String(otp ?? "").trim();
    const pending = await verifySignedCookie<PendingOtpSession>(req.cookies.get("rs_pending_verify")?.value);

    if (!pending) {
      return NextResponse.json({ error: "Verification code expired. Please register again." }, { status: 400 });
    }
    if (!verifySecret(code, pending.otpHash)) {
      return NextResponse.json({ error: "Invalid verification code." }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin
      .from("profiles")
      .update({ email_verified: true, updated_at: new Date().toISOString() })
      .eq("id", pending.userId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    const response = NextResponse.json({
      message: "Email verified! You can now log in.",
    });
    response.cookies.set("rs_pending_verify", "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

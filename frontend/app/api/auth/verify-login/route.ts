import { NextRequest, NextResponse } from "next/server";
import { verifySecret } from "../../../../lib/auth-server";
import { createSessionCookie, verifySignedCookie, type PendingOtpSession } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  try {
    const { otp } = await req.json();
    const code = String(otp ?? "").trim();
    const pending = await verifySignedCookie<PendingOtpSession>(req.cookies.get("rs_pending_otp")?.value);

    if (!pending) return NextResponse.json({ error: "OTP expired. Please log in again." }, { status: 400 });
    if (!verifySecret(code, pending.otpHash)) {
      return NextResponse.json({ error: "Invalid OTP." }, { status: 400 });
    }

    const session = await createSessionCookie({
      userId: pending.userId,
      role: pending.role,
      exp: Date.now() + 60 * 60 * 24 * 30 * 1000,
    });

    const response = NextResponse.json({
      message: "Login verified.",
      role: pending.role,
      redirectTo: pending.role === "admin" ? "/admin" : pending.role === "merchant" ? "/merchant" : "/",
    });
    response.cookies.set("rs_role", pending.role, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
    });
    response.cookies.set("rs_auth", pending.userId, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      httpOnly: true,
    });
    response.cookies.set("rs_session", session, {
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
      sameSite: "lax",
      httpOnly: true,
    });
    response.cookies.delete("rs_pending_otp");
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

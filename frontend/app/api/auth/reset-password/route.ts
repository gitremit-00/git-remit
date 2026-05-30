import { NextRequest, NextResponse } from "next/server";
import { adminClient, validatePassword, verifySecret } from "../../../../lib/auth-server";
import { verifySignedCookie, type PendingResetSession } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  try {
    const { otp, password, confirmPassword } = await req.json() as {
      otp?: string;
      password?: string;
      confirmPassword?: string;
    };

    if (!otp || !password || !confirmPassword) {
      return NextResponse.json({ error: "OTP, password, and confirmation are required." }, { status: 400 });
    }

    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }

    const issues = validatePassword(password);
    if (issues.length) {
      return NextResponse.json({ error: `Password must include ${issues.join(", ")}.` }, { status: 400 });
    }

    const pending = await verifySignedCookie<PendingResetSession>(
      req.cookies.get("rs_pending_reset")?.value
    );

    if (!pending) {
      return NextResponse.json(
        { error: "Reset code has expired or is invalid. Please request a new one." },
        { status: 400 }
      );
    }

    if (!verifySecret(otp, pending.otpHash)) {
      return NextResponse.json({ error: "Incorrect reset code." }, { status: 400 });
    }

    const admin = adminClient();
    const { error } = await admin.auth.admin.updateUserById(pending.userId, { password });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const response = NextResponse.json({ message: "Password updated successfully. You can now log in." });
    response.cookies.set("rs_pending_reset", "", { path: "/", maxAge: 0 });
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

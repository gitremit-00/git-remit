import { NextRequest, NextResponse } from "next/server";
import { adminClient, generateOtp, hashSecret, sendOtpEmail } from "../../../../lib/auth-server";
import { createSignedCookie, type PendingResetSession } from "../../../../lib/session";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!normalizedEmail) {
      return NextResponse.json({ error: "Email is required." }, { status: 400 });
    }

    const admin = adminClient();
    const { data: profile } = await admin
      .from("profiles")
      .select("id, email")
      .eq("email", normalizedEmail)
      .maybeSingle();

    // Always return success to avoid email enumeration
    if (!profile) {
      return NextResponse.json({ message: "If that email is registered, a reset code has been sent." });
    }

    const otp = generateOtp();
    const pending = await createSignedCookie<PendingResetSession>({
      userId: profile.id,
      email: profile.email,
      otpHash: hashSecret(otp),
      exp: Date.now() + 15 * 60_000,
    });

    const delivery = await sendOtpEmail(profile.email, otp, "reset");

    const response = NextResponse.json({
      message: "If that email is registered, a reset code has been sent.",
      devOtp: delivery.delivered ? undefined : otp,
    });
    response.cookies.set("rs_pending_reset", pending, {
      path: "/",
      maxAge: 15 * 60,
      httpOnly: true,
      sameSite: "lax",
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

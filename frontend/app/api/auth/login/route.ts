import { NextRequest, NextResponse } from "next/server";
import { adminClient, generateOtp, hashSecret, publicClient, sendOtpEmail } from "../../../../lib/auth-server";
import { createSignedCookie, type PendingOtpSession } from "../../../../lib/session";

function appRole(profileRole: string) {
  if (profileRole === "admin") return "admin";
  if (profileRole === "merchant") return "merchant";
  return "sender";
}

export async function POST(req: NextRequest) {
  try {
    const { usernameOrEmail, password } = await req.json();
    const identifier = String(usernameOrEmail ?? "").trim().toLowerCase();
    const pass = String(password ?? "");

    if (!identifier || !pass) {
      return NextResponse.json({ error: "Username/email and password are required." }, { status: 400 });
    }

    const admin = adminClient();
    let email = identifier;

    if (!identifier.includes("@")) {
      const { data: byUsername, error: usernameError } = await admin
        .from("profiles")
        .select("email")
        .eq("username", identifier)
        .single();
      if (usernameError || !byUsername?.email) {
        return NextResponse.json({ error: "Wrong credentials." }, { status: 401 });
      }
      email = byUsername.email;
    }

    const auth = publicClient();
    const { data: authData, error: authError } = await auth.auth.signInWithPassword({ email, password: pass });

    if (authError || !authData.user) {
      return NextResponse.json({ error: "Wrong credentials." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,role,email_verified")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found for this account." }, { status: 404 });
    }

    if (!profile.email_verified) {
      return NextResponse.json({ error: "Email not verified. Please check your inbox for the verification code." }, { status: 403 });
    }

    const otp = generateOtp();
    const role = appRole(profile.role);
    const pending = await createSignedCookie<PendingOtpSession>({
      userId: profile.id,
      role,
      email: profile.email,
      otpHash: hashSecret(otp),
      exp: Date.now() + 10 * 60_000,
    });
    const delivery = await sendOtpEmail(profile.email, otp, "login");

    const response = NextResponse.json({
      message: "OTP sent to your registered email.",
      email: profile.email,
      devOtp: delivery.delivered ? undefined : otp,
    });
    response.cookies.set("rs_pending_otp", pending, {
      path: "/",
      maxAge: 10 * 60,
      httpOnly: true,
      sameSite: "lax",
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

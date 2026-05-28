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
      const message = authError?.message?.toLowerCase().includes("email not confirmed")
        ? "Email is not verified. Check your inbox for the Supabase verification link."
        : "Wrong credentials.";
      return NextResponse.json({ error: message }, { status: authError?.message?.toLowerCase().includes("email not confirmed") ? 403 : 401 });
    }

    if (!authData.user.email_confirmed_at) {
      return NextResponse.json({ error: "Email is not verified. Check your inbox for the Supabase verification link." }, { status: 403 });
    }

    const { data: profile, error: profileError } = await admin
      .from("profiles")
      .select("id,email,role")
      .eq("id", authData.user.id)
      .single();

    if (profileError || !profile) {
      return NextResponse.json({ error: "Profile not found for this account." }, { status: 404 });
    }

    await admin
      .from("profiles")
      .update({ email_verified: true, updated_at: new Date().toISOString() })
      .eq("id", profile.id);

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

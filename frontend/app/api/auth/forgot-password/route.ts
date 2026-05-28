import { NextRequest, NextResponse } from "next/server";
import { publicClient } from "../../../../lib/auth-server";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();
    const normalizedEmail = String(email ?? "").trim().toLowerCase();
    if (!normalizedEmail) return NextResponse.json({ error: "Email is required." }, { status: 400 });

    const supabase = publicClient();
    await supabase.auth.resetPasswordForEmail(normalizedEmail, {
      redirectTo: `${req.nextUrl.origin}/login`,
    });

    return NextResponse.json({ message: "If the email is registered, Supabase has sent a password reset link." });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

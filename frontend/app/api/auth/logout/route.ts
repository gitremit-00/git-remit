import { NextResponse } from "next/server";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  const cookieOpts = { path: "/", maxAge: 0, sameSite: "lax" as const };
  response.cookies.set("rs_session", "", { ...cookieOpts, httpOnly: true });
  response.cookies.set("rs_auth", "", { ...cookieOpts, httpOnly: true });
  response.cookies.set("rs_role", "", cookieOpts);
  response.cookies.set("rs_pending_otp", "", { ...cookieOpts, httpOnly: true });
  return response;
}

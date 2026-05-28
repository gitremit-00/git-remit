import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({
    message: "Email verification is handled by the Supabase verification link sent to the user email.",
  });
}

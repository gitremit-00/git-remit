import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Password reset is handled by the Supabase reset email link." },
    { status: 400 },
  );
}

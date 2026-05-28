import { NextRequest, NextResponse } from "next/server";
import { verifySessionCookie } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
  if (!session) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  return NextResponse.json({ userId: session.userId, role: session.role });
}

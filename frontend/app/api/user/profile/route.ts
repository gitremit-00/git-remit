import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

export async function GET(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const admin = adminClient();
    const { data, error } = await admin
      .from("profiles")
      .select(
        "id,username,role,full_name,phone_number,email," +
        "country_of_work,country_of_origin,gov_id_type,id_number," +
        "gov_id_photo_url,business_permit_url," +
        "business_name,business_type,business_address,city," +
        "kyc_status,kyc_rejection_reason,email_verified,created_at,updated_at"
      )
      .eq("id", session.userId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }

    return NextResponse.json({ profile: data });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";

// Raw DB row shape
interface ProfileRow {
  id: string;
  username: string;
  role: string;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  country_of_work: string | null;
  country_of_origin: string | null;
  gov_id_type: string | null;
  id_number: string | null;
  gov_id_photo_url: string | null;
  business_permit_url: string | null;
  business_name: string | null;
  business_type: string | null;
  business_address: string | null;
  city: string | null;
  bio: string | null;
  avatar_url: string | null;
  kyc_status: string | null;
  kyc_rejection_reason: string | null;
  kyc_reviewed_at: string | null;
  account_status: string | null;
  account_hold_reason: string | null;
  account_held_at: string | null;
  created_at: string;
  updated_at: string | null;
}

// Maps raw DB columns → UserProfile field names used by the KYC page
function mapRow(row: ProfileRow) {
  return {
    id:                   row.id,
    username:             row.username,
    email:                row.email,
    role:                 row.role === "merchant" ? "merchant" : "sender",
    // human-readable mapped names
    name:                 row.full_name,
    phone:                row.phone_number,
    country:              row.country_of_origin,
    country_origin:       row.country_of_origin,
    country_work:         row.country_of_work,
    id_type:              row.gov_id_type,
    id_number:            row.id_number,
    id_photo_url:         row.gov_id_photo_url,
    permit_url:           row.business_permit_url,
    business_name:        row.business_name,
    business_type:        row.business_type,
    business_address:     row.business_address,
    city:                 row.city,
    bio:                  row.bio,
    avatar_url:           row.avatar_url,
    kyc_status:           (row.kyc_status ?? "pending") as "pending" | "verified" | "rejected" | "needs_revision",
    kyc_rejection_reason: row.kyc_rejection_reason,
    kyc_reviewed_at:      row.kyc_reviewed_at,
    account_status:       (row.account_status ?? "active") as "active" | "on_hold",
    account_hold_reason:  row.account_hold_reason,
    account_held_at:      row.account_held_at,
    created_at:           row.created_at,
    updated_at:           row.updated_at,
  };
}

export async function GET(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const url = new URL(req.url);
    const statusFilter = url.searchParams.get("status") ?? "all";
    const roleFilter   = url.searchParams.get("role")   ?? "all";

    const admin = adminClient();

    let query = admin
      .from("profiles")
      .select(
        "id,username,role,full_name,phone_number,email," +
        "country_of_work,country_of_origin,gov_id_type,id_number," +
        "gov_id_photo_url,business_permit_url," +
        "business_name,business_type,business_address,city," +
        "bio,avatar_url," +
        "kyc_status,kyc_rejection_reason,kyc_reviewed_at," +
        "account_status,account_hold_reason,account_held_at,created_at,updated_at"
      )
      .order("created_at", { ascending: false });

    // Role filter
    if (roleFilter === "ofw_sender" || roleFilter === "merchant") {
      query = query.eq("role", roleFilter);
    } else {
      query = query.in("role", ["ofw_sender", "merchant"]);
    }

    // Status filter
    if (statusFilter === "all" || !statusFilter) {
      // Return ALL users — no status restriction
    } else if (statusFilter === "pending") {
      // Pending includes explicit 'pending' and any NULL kyc_status (legacy rows)
      query = query.or("kyc_status.eq.pending,kyc_status.is.null");
    } else {
      query = query.eq("kyc_status", statusFilter);
    }

    const { data, error } = await query;
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = (data ?? []) as any[] as ProfileRow[];
    return NextResponse.json({ users: rows.map(mapRow) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

import { NextRequest, NextResponse } from "next/server";
import { adminClient, assertAllowedFile, uploadSecureFile } from "../../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../../lib/session";

function fileExt(file: File) {
  const byName = file.name.split(".").pop()?.toLowerCase();
  if (byName) return byName;
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  return "jpg";
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session) return NextResponse.json({ error: "Not authenticated." }, { status: 401 });

    const admin = adminClient();

    // Verify the user's current KYC status is needs_revision
    const { data: current, error: fetchErr } = await admin
      .from("profiles")
      .select("id,role,kyc_status")
      .eq("id", session.userId)
      .single();

    if (fetchErr || !current) {
      return NextResponse.json({ error: "Profile not found." }, { status: 404 });
    }
    if (current.kyc_status !== "needs_revision") {
      return NextResponse.json({ error: "Your account is not in needs_revision status." }, { status: 400 });
    }

    const form = await req.formData();

    const fullName       = String(form.get("fullName") ?? "").trim();
    const phoneNumber    = String(form.get("phone") ?? "").trim();
    const countryWork    = String(form.get("countryWork") ?? "").trim();
    const countryOrigin  = String(form.get("countryOrigin") ?? "").trim();
    const idType         = String(form.get("idType") ?? "").trim();
    const idNumber       = String(form.get("idNumber") ?? "").trim();
    const idPhoto        = form.get("idPhoto") as File | null;
    const businessPermit = form.get("businessPermit") as File | null;

    if (!fullName || !phoneNumber || !countryWork || !countryOrigin || !idType || !idNumber) {
      return NextResponse.json({ error: "All required fields must be filled in." }, { status: 400 });
    }

    const updates: Record<string, unknown> = {
      full_name:          fullName,
      phone_number:       phoneNumber,
      country_of_work:    countryWork,
      country_of_origin:  countryOrigin,
      gov_id_type:        idType,
      id_number:          idNumber,
      kyc_status:         "pending",
      kyc_rejection_reason: null,
      updated_at:         new Date().toISOString(),
    };

    // Upload new Government ID photo if provided
    if (idPhoto && idPhoto.size > 0) {
      assertAllowedFile(idPhoto, "Government ID photo");
      const url = await uploadSecureFile(
        "government-ids",
        `${session.userId}/government-id.${fileExt(idPhoto)}`,
        idPhoto,
      );
      updates.gov_id_photo_url = url;
    }

    // Upload new Business Permit if merchant and provided
    if (current.role === "merchant" && businessPermit && businessPermit.size > 0) {
      assertAllowedFile(businessPermit, "Business permit");
      const url = await uploadSecureFile(
        "business-permits",
        `${session.userId}/business-permit.${fileExt(businessPermit)}`,
        businessPermit,
      );
      updates.business_permit_url = url;
    }

    const { error: updateErr } = await admin
      .from("profiles")
      .update(updates)
      .eq("id", session.userId);

    if (updateErr) return NextResponse.json({ error: updateErr.message }, { status: 500 });

    return NextResponse.json({
      ok: true,
      message: "Your revised KYC documents have been submitted for admin review.",
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

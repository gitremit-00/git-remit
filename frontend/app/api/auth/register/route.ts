import { NextRequest, NextResponse } from "next/server";
import {
  adminClient,
  assertAllowedFile,
  generateOtp,
  hashSecret,
  sendOtpEmail,
  uploadSecureFile,
  validatePassword,
} from "../../../../lib/auth-server";
import { createSignedCookie, type PendingOtpSession } from "../../../../lib/session";

function value(form: FormData, key: string) {
  return String(form.get(key) ?? "").trim();
}

function fileExt(file: File) {
  const byName = file.name.split(".").pop();
  if (byName) return byName.toLowerCase();
  if (file.type === "application/pdf") return "pdf";
  if (file.type === "image/png") return "png";
  return "jpg";
}

function appRole(profileRole: string) {
  if (profileRole === "merchant") return "merchant";
  return "sender";
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const rawRole = value(form, "role");
    const role = rawRole === "sender" ? "ofw_sender" : rawRole;
    const username = value(form, "username").toLowerCase();
    const password = value(form, "password");
    const confirmPassword = value(form, "confirmPassword");
    const fullName = value(form, "fullName");
    const phone = value(form, "phone");
    const email = value(form, "email").toLowerCase();
    const countryWork = value(form, "countryWork");
    const countryOrigin = value(form, "countryOrigin");
    const idType = value(form, "idType");
    const idNumber = value(form, "idNumber");
    const idPhoto = form.get("idPhoto") as File | null;
    const businessPermit = form.get("businessPermit") as File | null;
    const businessName = value(form, "businessName") || null;
    const businessType = value(form, "businessType") || null;
    const businessAddress = value(form, "businessAddress") || null;
    const city = value(form, "city") || null;

    if (role !== "ofw_sender" && role !== "merchant") {
      return NextResponse.json({ error: "Choose OFW/Sender or Merchant." }, { status: 400 });
    }
    if (!/^[a-z0-9._-]{3,32}$/.test(username)) {
      return NextResponse.json({ error: "Username must be 3-32 characters using letters, numbers, dot, underscore, or dash." }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
    }
    if (password !== confirmPassword) {
      return NextResponse.json({ error: "Passwords do not match." }, { status: 400 });
    }
    const passwordIssues = validatePassword(password);
    if (passwordIssues.length) {
      return NextResponse.json({ error: `Password must include ${passwordIssues.join(", ")}.` }, { status: 400 });
    }
    if (!fullName || !phone || !countryWork || !countryOrigin || !idType || !idNumber) {
      return NextResponse.json({ error: "Please complete all required fields." }, { status: 400 });
    }

    assertAllowedFile(idPhoto, "Government ID photo");
    if (role === "merchant") assertAllowedFile(businessPermit, "Business permit");

    const admin = adminClient();
    const { data: duplicateProfile, error: duplicateError } = await admin
      .from("profiles")
      .select("username,email")
      .or(`username.eq.${username},email.eq.${email}`)
      .limit(1);

    if (duplicateError) return NextResponse.json({ error: duplicateError.message }, { status: 500 });
    if (duplicateProfile?.some((row) => row.username === username)) {
      return NextResponse.json({ error: "Username is already taken." }, { status: 409 });
    }
    if (duplicateProfile?.some((row) => row.email === email)) {
      return NextResponse.json({ error: "Email is already registered." }, { status: 409 });
    }

    // Create user in Supabase Auth — email_confirm:true skips Supabase's own email.
    // We send our own branded OTP instead.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { username, role, full_name: fullName },
    });

    if (createError) return NextResponse.json({ error: createError.message }, { status: 400 });
    const user = created.user;
    if (!user) return NextResponse.json({ error: "Failed to create account. Please try again." }, { status: 500 });

    try {
      const safeBase = `${user.id}`;
      const idPhotoUrl = await uploadSecureFile("government-ids", `${safeBase}/government-id.${fileExt(idPhoto!)}`, idPhoto!);
      const permitUrl = role === "merchant" && businessPermit
        ? await uploadSecureFile("business-permits", `${safeBase}/business-permit.${fileExt(businessPermit)}`, businessPermit)
        : null;

      const { error: profileError } = await admin.from("profiles").insert({
        id: user.id,
        username,
        role,
        full_name: fullName,
        phone_number: phone,
        email,
        country_of_work: countryWork,
        country_of_origin: countryOrigin,
        gov_id_type: idType,
        id_number: idNumber,
        gov_id_photo_url: idPhotoUrl,
        business_permit_url: permitUrl,
        business_name: businessName,
        business_type: businessType,
        business_address: businessAddress,
        city,
        email_verified: false,
        kyc_status: "pending",
      });

      if (profileError) throw profileError;
    } catch (profileErr) {
      await admin.auth.admin.deleteUser(user.id);
      return NextResponse.json({ error: (profileErr as Error).message }, { status: 500 });
    }

    // Send branded OTP verification email
    const otp = generateOtp();
    const pending = await createSignedCookie<PendingOtpSession>({
      userId: user.id,
      role: appRole(role) as "sender" | "merchant" | "admin",
      email,
      otpHash: hashSecret(otp),
      exp: Date.now() + 30 * 60_000,
    });
    const delivery = await sendOtpEmail(email, otp, "verify");

    const response = NextResponse.json({
      message: "Account created! Check your email for a 6-digit verification code.",
      email,
      devOtp: delivery.delivered ? undefined : otp,
    });
    response.cookies.set("rs_pending_verify", pending, {
      path: "/",
      maxAge: 30 * 60,
      httpOnly: true,
      sameSite: "lax",
    });
    return response;
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

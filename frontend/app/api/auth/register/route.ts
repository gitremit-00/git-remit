import { NextRequest, NextResponse } from "next/server";
import {
  adminClient,
  assertAllowedFile,
  publicClient,
  uploadSecureFile,
  validatePassword,
} from "../../../../lib/auth-server";

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

async function findAuthUserByEmail(admin: ReturnType<typeof adminClient>, email: string) {
  const perPage = 100;
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const found = data.users.find((user) => user.email?.toLowerCase() === email);
    if (found) return found;
    if (data.users.length < perPage) break;
  }
  return null;
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

    const auth = publicClient();
    const { data: signup, error: signupError } = await auth.auth.signUp({
      email,
      password,
      options: {
        data: { username, role, full_name: fullName },
        emailRedirectTo: `${req.nextUrl.origin}/login`,
      },
    });

    if (signupError) return NextResponse.json({ error: signupError.message }, { status: 400 });
    const user = signup.user ?? await findAuthUserByEmail(admin, email);
    if (!user) {
      return NextResponse.json({
        error: "Supabase Auth did not return the new user. Check that Email provider is enabled in Supabase Auth settings, then try again.",
      }, { status: 500 });
    }

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
        email_verified: Boolean(user.email_confirmed_at),
      });

      if (profileError) throw profileError;
    } catch (profileErr) {
      await admin.auth.admin.deleteUser(user.id);
      return NextResponse.json({ error: (profileErr as Error).message }, { status: 500 });
    }

    return NextResponse.json({
      message: "Account created. Please check your email and click the Supabase verification link before logging in.",
      email,
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

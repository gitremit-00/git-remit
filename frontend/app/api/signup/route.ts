import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  return createClient(url, serviceKey);
}

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const supabase = adminClient();

    const role = form.get("role") as string;
    const walletAddress = (form.get("wallet_address") as string).toLowerCase();

    // Check if user already exists
    const { data: existing } = await supabase
      .from("users")
      .select("wallet_address")
      .eq("wallet_address", walletAddress)
      .single();

    if (existing) {
      return NextResponse.json({ error: "Wallet already registered" }, { status: 409 });
    }

    let idPhotoUrl: string | null = null;
    let permitUrl: string | null = null;

    if (role === "sender") {
      const idFile = form.get("id_photo") as File | null;
      if (idFile && idFile.size > 0) {
        const ext = idFile.name.split(".").pop();
        const path = `${walletAddress}/id.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("government-ids")
          .upload(path, idFile, { contentType: idFile.type, upsert: true });
        if (!uploadErr) {
          const { data } = supabase.storage.from("government-ids").getPublicUrl(path);
          idPhotoUrl = data.publicUrl;
        }
      }

      const { error } = await supabase.from("users").insert({
        wallet_address: walletAddress,
        role: "sender",
        kyc_status: "pending",
        name: form.get("full_name") as string,
        phone: form.get("phone") as string,
        country_work: form.get("country_work") as string,
        country_origin: form.get("country_origin") as string,
        country: form.get("country_origin") as string,
        id_type: form.get("id_type") as string,
        id_number: form.get("id_number") as string,
        id_photo_url: idPhotoUrl,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    } else if (role === "merchant") {
      const permitFile = form.get("business_permit") as File | null;
      if (permitFile && permitFile.size > 0) {
        const ext = permitFile.name.split(".").pop();
        const path = `${walletAddress}/permit.${ext}`;
        const { error: uploadErr } = await supabase.storage
          .from("permits")
          .upload(path, permitFile, { contentType: permitFile.type, upsert: true });
        if (!uploadErr) {
          const { data } = supabase.storage.from("permits").getPublicUrl(path);
          permitUrl = data.publicUrl;
        }
      }

      // Also upload merchant's gov ID if provided
      const idFile = form.get("id_photo") as File | null;
      if (idFile && idFile.size > 0) {
        const ext = idFile.name.split(".").pop();
        const path = `${walletAddress}/id.${ext}`;
        await supabase.storage
          .from("government-ids")
          .upload(path, idFile, { contentType: idFile.type, upsert: true });
      }

      const { error } = await supabase.from("users").insert({
        wallet_address: walletAddress,
        role: "merchant",
        kyc_status: "pending",
        name: form.get("business_name") as string,
        phone: form.get("phone") as string,
        business_name: form.get("business_name") as string,
        business_type: form.get("business_type") as string,
        owner_name: form.get("owner_name") as string,
        business_address: form.get("business_address") as string,
        city: form.get("city") as string,
        permit_url: permitUrl,
        id_type: form.get("id_type") as string,
        id_number: form.get("id_number") as string,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });

    } else {
      return NextResponse.json({ error: "Invalid role" }, { status: 400 });
    }

    return NextResponse.json({ role, wallet_address: walletAddress });
  } catch (err) {
    console.error("[signup]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

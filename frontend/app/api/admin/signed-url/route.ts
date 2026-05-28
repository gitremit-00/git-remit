import { NextRequest, NextResponse } from "next/server";
import { adminClient } from "../../../../lib/auth-server";
import { verifySessionCookie } from "../../../../lib/session";

// Generates a 60-minute signed URL for a private storage file.
// Only admins can call this endpoint.
export async function POST(req: NextRequest) {
  try {
    const session = await verifySessionCookie(req.cookies.get("rs_session")?.value);
    if (!session || session.role !== "admin") {
      return NextResponse.json({ error: "Forbidden." }, { status: 403 });
    }

    const { bucket, path } = (await req.json()) as { bucket?: string; path?: string };
    if (!bucket || !path) {
      return NextResponse.json({ error: "bucket and path are required." }, { status: 400 });
    }

    // Whitelist allowed buckets
    if (!["government-ids", "business-permits", "avatars"].includes(bucket)) {
      return NextResponse.json({ error: "Bucket not allowed." }, { status: 403 });
    }

    const admin = adminClient();
    const { data, error } = await admin.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60); // 1 hour

    if (error || !data?.signedUrl) {
      return NextResponse.json({ error: error?.message ?? "Could not generate signed URL." }, { status: 500 });
    }

    return NextResponse.json({ url: data.signedUrl });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

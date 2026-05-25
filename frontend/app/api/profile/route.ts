import { getUserProfile, updateUserProfile, UserProfile } from "../../../lib/supabase";

export async function GET(request: Request): Promise<Response> {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  if (!address) {
    return new Response(JSON.stringify({ error: "address required" }), { status: 400 });
  }
  const profile = await getUserProfile(address);
  if (!profile) {
    return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  }
  return Response.json(profile);
}

export async function PATCH(request: Request): Promise<Response> {
  try {
    const body = await request.json();
    const { address, ...updates } = body as { address: string } & Partial<Pick<UserProfile, "name" | "avatar_url" | "bio" | "phone" | "country">>;
    if (!address) {
      return new Response(JSON.stringify({ error: "address required" }), { status: 400 });
    }
    await updateUserProfile(address, updates);
    const profile = await getUserProfile(address);
    return Response.json(profile);
  } catch (err: unknown) {
    return new Response(JSON.stringify({ error: (err as Error).message }), { status: 500 });
  }
}

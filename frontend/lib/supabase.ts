import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

export type Role = "sender" | "merchant";

export interface UserProfile {
  wallet_address: string;
  role: Role;
  name: string | null;
  created_at: string;
}

export async function fetchUserRole(walletAddress: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();
  if (error || !data) return null;
  return data.role as Role;
}

export async function createUser(walletAddress: string, role: Role, name?: string): Promise<void> {
  await supabase.from("users").insert({
    wallet_address: walletAddress.toLowerCase(),
    role,
    name: name ?? null,
  });
}

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && key);
export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(url!, key!)
  : null;

export type Role = "sender" | "merchant" | "admin";
export type KYCStatus = "pending" | "approved" | "rejected";

export interface UserProfile {
  wallet_address: string;
  role: Role;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  // shared
  phone: string | null;
  country: string | null;
  country_origin: string | null;
  kyc_status: KYCStatus;
  kyc_reject_reason: string | null;
  created_at: string;
  updated_at: string | null;
  // OFW-specific
  country_work: string | null;
  id_type: string | null;
  id_number: string | null;
  id_photo_url: string | null;
  // Merchant-specific
  business_name: string | null;
  business_type: string | null;
  owner_name: string | null;
  business_address: string | null;
  city: string | null;
  permit_url: string | null;
}

type ProfileRow = {
  id: string;
  username: string;
  role: "ofw_sender" | "merchant";
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  country_of_work: string | null;
  country_of_origin: string | null;
  gov_id_type: string | null;
  id_number: string | null;
  gov_id_photo_url: string | null;
  business_permit_url: string | null;
  created_at: string;
  updated_at: string | null;
};

function appRole(role: string): Role {
  return role === "merchant" ? "merchant" : "sender";
}

function mapProfile(row: ProfileRow): UserProfile {
  return {
    wallet_address: row.id,
    role: appRole(row.role),
    name: row.full_name,
    avatar_url: null,
    bio: null,
    phone: row.phone_number,
    country: row.country_of_origin,
    country_origin: row.country_of_origin,
    kyc_status: "pending",
    kyc_reject_reason: null,
    created_at: row.created_at,
    updated_at: row.updated_at,
    country_work: row.country_of_work,
    id_type: row.gov_id_type,
    id_number: row.id_number,
    id_photo_url: row.gov_id_photo_url,
    business_name: row.role === "merchant" ? row.full_name : null,
    business_type: null,
    owner_name: row.role === "merchant" ? row.full_name : null,
    business_address: null,
    city: null,
    permit_url: row.business_permit_url,
  };
}

function profileQuery(identifier: string) {
  const normalized = identifier.toLowerCase();
  if (normalized.includes("@")) return supabase!.from("profiles").select("*").eq("email", normalized).single();
  if (/^[0-9a-f-]{36}$/i.test(normalized)) return supabase!.from("profiles").select("*").eq("id", normalized).single();
  return supabase!.from("profiles").select("*").eq("username", normalized).single();
}

export async function fetchUserRole(identifier: string): Promise<Role | null> {
  if (!supabase) return "sender";

  const { data, error } = await profileQuery(identifier);
  if (error || !data) return null;
  return appRole((data as ProfileRow).role);
}

export async function getUserProfile(identifier: string): Promise<UserProfile | null> {
  if (!supabase) return null;

  const { data, error } = await profileQuery(identifier);
  if (error || !data) return null;
  return mapProfile(data as ProfileRow);
}

export async function updateUserProfile(
  walletAddress: string,
  updates: Partial<Pick<UserProfile, "name" | "avatar_url" | "bio" | "phone" | "country">>
): Promise<void> {
  if (!supabase) return;

  await supabase
    .from("profiles")
    .update({
      full_name: updates.name,
      phone_number: updates.phone,
      country_of_origin: updates.country,
      updated_at: new Date().toISOString(),
    })
    .eq("id", walletAddress.toLowerCase());
}

export async function uploadAvatar(walletAddress: string, file: File): Promise<string | null> {
  if (!supabase) return null;

  const ext = file.name.split(".").pop();
  const path = `${walletAddress.toLowerCase()}/avatar.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) { console.error(error); return null; }
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

// Legacy — kept for compatibility; new signups go through /api/signup
export async function createUser(walletAddress: string, role: Role, name?: string): Promise<void> {
  return;
}

export async function getUserKYCStatus(walletAddress: string): Promise<KYCStatus | null> {
  return null;
}

export async function getKYCQueue(): Promise<UserProfile[]> {
  return [];
}

export async function approveKYC(walletAddress: string): Promise<void> {
  return;
}

export async function rejectKYC(walletAddress: string, reason: string): Promise<void> {
  return;
}

export async function getAllSenders(): Promise<UserProfile[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "ofw_sender")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ProfileRow[]).map(mapProfile);
}

export async function getAllMerchants(): Promise<UserProfile[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("role", "merchant")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ProfileRow[]).map(mapProfile);
}

export interface PaymentRequest {
  id: string;
  merchant_address: string;
  merchant_name: string | null;
  amount: number;
  deadline: string;
  title: string | null;
  note: string | null;
  status: "open" | "fulfilled" | "cancelled";
  created_at: string;
}

export async function createPaymentRequest(
  req: Pick<PaymentRequest, "merchant_address" | "merchant_name" | "amount" | "deadline" | "title" | "note">
): Promise<PaymentRequest | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("payment_requests")
    .insert({ ...req, merchant_address: req.merchant_address.toLowerCase(), status: "open" })
    .select()
    .single();
  if (error) { console.error(error); return null; }
  return data as PaymentRequest;
}

export async function getPaymentRequest(id: string): Promise<PaymentRequest | null> {
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as PaymentRequest;
}

export async function getMerchantPaymentRequests(merchantAddress: string): Promise<PaymentRequest[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("merchant_address", merchantAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as PaymentRequest[];
}

export async function updatePaymentRequestStatus(
  id: string,
  status: PaymentRequest["status"]
): Promise<void> {
  if (!supabase) return;

  await supabase.from("payment_requests").update({ status }).eq("id", id);
}

export interface PaymentRequestNotification {
  id: string;
  request_id: string;
  sender_address: string;
  read: boolean;
  created_at: string;
  payment_requests?: PaymentRequest;
}

export async function sendPaymentRequestNotification(
  requestId: string,
  senderAddress: string
): Promise<boolean> {
  if (!supabase) return false;

  const { error } = await supabase
    .from("payment_request_notifications")
    .insert({ request_id: requestId, sender_address: senderAddress.toLowerCase() });
  if (error) { console.error(error); return false; }
  return true;
}

export async function getSenderNotifications(
  senderAddress: string
): Promise<PaymentRequestNotification[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("payment_request_notifications")
    .select("*, payment_requests(*)")
    .eq("sender_address", senderAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as PaymentRequestNotification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  if (!supabase) return;

  await supabase.from("payment_request_notifications").update({ read: true }).eq("id", id);
}

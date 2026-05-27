import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(url, key);

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

export async function fetchUserRole(walletAddress: string): Promise<Role | null> {
  const { data, error } = await supabase
    .from("users")
    .select("role")
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();
  if (error || !data) return null;
  return data.role as Role;
}

export async function getUserProfile(walletAddress: string): Promise<UserProfile | null> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();
  if (error || !data) return null;
  return data as UserProfile;
}

export async function updateUserProfile(
  walletAddress: string,
  updates: Partial<Pick<UserProfile, "name" | "avatar_url" | "bio" | "phone" | "country">>
): Promise<void> {
  await supabase
    .from("users")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress.toLowerCase());
}

export async function uploadAvatar(walletAddress: string, file: File): Promise<string | null> {
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
  await supabase.from("users").insert({
    wallet_address: walletAddress.toLowerCase(),
    role,
    name: name ?? null,
  });
}

export async function getUserKYCStatus(walletAddress: string): Promise<KYCStatus | null> {
  const { data, error } = await supabase
    .from("users")
    .select("kyc_status")
    .eq("wallet_address", walletAddress.toLowerCase())
    .single();
  if (error || !data) return null;
  return data.kyc_status as KYCStatus;
}

export async function getKYCQueue(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("kyc_status", "pending")
    .order("created_at", { ascending: true });
  if (error || !data) return [];
  return data as UserProfile[];
}

export async function approveKYC(walletAddress: string): Promise<void> {
  await supabase
    .from("users")
    .update({ kyc_status: "approved", kyc_reject_reason: null, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress.toLowerCase());
}

export async function rejectKYC(walletAddress: string, reason: string): Promise<void> {
  await supabase
    .from("users")
    .update({ kyc_status: "rejected", kyc_reject_reason: reason, updated_at: new Date().toISOString() })
    .eq("wallet_address", walletAddress.toLowerCase());
}

export async function getAllSenders(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("role", "sender")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as UserProfile[];
}

export async function getAllMerchants(): Promise<UserProfile[]> {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("role", "merchant")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as UserProfile[];
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
  const { data, error } = await supabase
    .from("payment_requests")
    .insert({ ...req, merchant_address: req.merchant_address.toLowerCase(), status: "open" })
    .select()
    .single();
  if (error) { console.error(error); return null; }
  return data as PaymentRequest;
}

export async function getPaymentRequest(id: string): Promise<PaymentRequest | null> {
  const { data, error } = await supabase
    .from("payment_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as PaymentRequest;
}

export async function getMerchantPaymentRequests(merchantAddress: string): Promise<PaymentRequest[]> {
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
  const { error } = await supabase
    .from("payment_request_notifications")
    .insert({ request_id: requestId, sender_address: senderAddress.toLowerCase() });
  if (error) { console.error(error); return false; }
  return true;
}

export async function getSenderNotifications(
  senderAddress: string
): Promise<PaymentRequestNotification[]> {
  const { data, error } = await supabase
    .from("payment_request_notifications")
    .select("*, payment_requests(*)")
    .eq("sender_address", senderAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as PaymentRequestNotification[];
}

export async function markNotificationRead(id: string): Promise<void> {
  await supabase.from("payment_request_notifications").update({ read: true }).eq("id", id);
}

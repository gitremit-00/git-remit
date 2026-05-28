import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const hasSupabaseConfig = Boolean(url && key);
export const supabase: SupabaseClient | null = hasSupabaseConfig
  ? createClient(url!, key!)
  : null;

export type Role = "sender" | "merchant" | "admin";
export type KYCStatus = "pending" | "verified" | "rejected" | "needs_revision";

export interface UserProfile {
  id: string;
  username: string;
  email: string | null;
  role: Role;
  name: string | null;
  avatar_url: string | null;
  bio: string | null;
  phone: string | null;
  country: string | null;
  country_origin: string | null;
  country_work: string | null;
  kyc_status: KYCStatus;
  kyc_rejection_reason: string | null;
  kyc_reviewed_at: string | null;
  created_at: string;
  updated_at: string | null;
  // OFW-specific
  id_type: string | null;
  id_number: string | null;
  id_photo_url: string | null;
  // Merchant-specific
  business_name: string | null;
  business_type: string | null;
  business_address: string | null;
  city: string | null;
  permit_url: string | null;
}

type ProfileRow = {
  id: string;
  username: string;
  role: "ofw_sender" | "merchant" | "admin";
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  country_of_work: string | null;
  country_of_origin: string | null;
  gov_id_type: string | null;
  id_number: string | null;
  gov_id_photo_url: string | null;
  business_permit_url: string | null;
  bio: string | null;
  avatar_url: string | null;
  business_name: string | null;
  business_type: string | null;
  business_address: string | null;
  city: string | null;
  kyc_status: KYCStatus;
  kyc_rejection_reason: string | null;
  kyc_reviewed_at: string | null;
  created_at: string;
  updated_at: string | null;
};

const KYC_SELECT = "id,username,role,full_name,phone_number,email,country_of_work,country_of_origin,gov_id_type,id_number,gov_id_photo_url,business_permit_url,bio,avatar_url,business_name,business_type,business_address,city,kyc_status,kyc_rejection_reason,kyc_reviewed_at,created_at,updated_at";

function appRole(role: string): Role {
  if (role === "merchant") return "merchant";
  if (role === "admin") return "admin";
  return "sender";
}

function mapProfile(row: ProfileRow): UserProfile {
  return {
    id: row.id,
    username: row.username,
    email: row.email,
    role: appRole(row.role),
    name: row.full_name,
    avatar_url: row.avatar_url,
    bio: row.bio,
    phone: row.phone_number,
    country: row.country_of_origin,
    country_origin: row.country_of_origin,
    country_work: row.country_of_work,
    kyc_status: (row.kyc_status as KYCStatus) ?? "pending",
    kyc_rejection_reason: row.kyc_rejection_reason,
    kyc_reviewed_at: row.kyc_reviewed_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
    id_type: row.gov_id_type,
    id_number: row.id_number,
    id_photo_url: row.gov_id_photo_url,
    business_name: row.business_name,
    business_type: row.business_type,
    business_address: row.business_address,
    city: row.city,
    permit_url: row.business_permit_url,
  };
}

function profileQuery(identifier: string) {
  const normalized = identifier.toLowerCase();
  if (normalized.includes("@")) return supabase!.from("profiles").select(KYC_SELECT).eq("email", normalized).single();
  if (/^[0-9a-f-]{36}$/i.test(normalized)) return supabase!.from("profiles").select(KYC_SELECT).eq("id", normalized).single();
  return supabase!.from("profiles").select(KYC_SELECT).eq("username", normalized).single();
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
  userId: string,
  updates: Partial<Pick<UserProfile, "name" | "avatar_url" | "bio" | "phone" | "country">>
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("profiles")
    .update({
      full_name: updates.name,
      phone_number: updates.phone,
      country_of_origin: updates.country,
      avatar_url: updates.avatar_url,
      bio: updates.bio,
    })
    .eq("id", userId);
}

export async function uploadAvatar(userId: string, file: File): Promise<string | null> {
  if (!supabase) return null;
  const ext = file.name.split(".").pop();
  const path = `${userId}/avatar.${ext}`;
  const { error } = await supabase.storage
    .from("avatars")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (error) { console.error(error); return null; }
  const { data } = supabase.storage.from("avatars").getPublicUrl(path);
  return data.publicUrl;
}

export async function getUserKYCStatus(userId: string): Promise<KYCStatus | null> {
  if (!supabase) return null;
  const { data } = await supabase.from("profiles").select("kyc_status").eq("id", userId).single();
  return (data?.kyc_status as KYCStatus) ?? null;
}

export async function getKYCQueue(statusFilter?: KYCStatus): Promise<UserProfile[]> {
  if (!supabase) return [];
  let query = supabase
    .from("profiles")
    .select(KYC_SELECT)
    .in("role", ["ofw_sender", "merchant"])
    .order("created_at", { ascending: false });
  if (statusFilter) query = query.eq("kyc_status", statusFilter);
  const { data, error } = await query;
  if (error || !data) return [];
  return (data as ProfileRow[]).map(mapProfile);
}

export async function getAllSenders(): Promise<UserProfile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select(KYC_SELECT)
    .eq("role", "ofw_sender")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ProfileRow[]).map(mapProfile);
}

export async function getAllMerchants(): Promise<UserProfile[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("profiles")
    .select(KYC_SELECT)
    .eq("role", "merchant")
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return (data as ProfileRow[]).map(mapProfile);
}

// Legacy stubs
export async function createUser(_walletAddress: string, _role: Role, _name?: string): Promise<void> { return; }
export async function approveKYC(_id: string): Promise<void> { return; }
export async function rejectKYC(_id: string, _reason: string): Promise<void> { return; }

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

// ─── Transfer Requests (off-chain negotiation) ────────────────────────────────

export type TransferRequestStatus = "pending" | "accepted" | "rejected" | "renegotiating" | "cancelled" | "confirmed";
export type TransferRequestType = "partial" | "installment";
export type TransferRequestNotificationType = "new_request" | "renegotiated" | "accepted" | "rejected" | "confirmed" | "cancelled";
export type CancelledBy = "sender" | "merchant";

export interface TransferRequest {
  id: string;
  sender_address: string;
  merchant_address: string;
  type: TransferRequestType;
  status: TransferRequestStatus;
  token: "USDC" | "USDT";
  // sender's original proposal
  total_amount: number | null;
  initial_deposit: number | null;
  commitment_date: string | null;
  amount_per_period: number | null;
  interval_seconds: number | null;
  total_periods: number | null;
  first_due_date: string | null;
  note: string | null;
  // merchant counter-proposal
  counter_total_amount: number | null;
  counter_initial_deposit: number | null;
  counter_commitment_date: string | null;
  counter_amount_per_period: number | null;
  counter_interval_seconds: number | null;
  counter_total_periods: number | null;
  counter_first_due_date: string | null;
  counter_note: string | null;
  renegotiation_count: number;
  cancelled_by: CancelledBy | null;
  // blockchain result
  pledge_id: string | null;
  tx_hash: string | null;
  created_at: string;
  updated_at: string | null;
}

export interface TransferRequestNotification {
  id: string;
  request_id: string;
  recipient_address: string;
  type: TransferRequestNotificationType;
  read: boolean;
  created_at: string;
  transfer_requests?: TransferRequest;
}

// Sender creates a new transfer request (no blockchain yet)
export async function createTransferRequest(
  req: Pick<TransferRequest,
    | "sender_address" | "merchant_address" | "type" | "token"
    | "total_amount" | "initial_deposit" | "commitment_date"
    | "amount_per_period" | "interval_seconds" | "total_periods" | "first_due_date"
    | "note"
  >
): Promise<TransferRequest | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("transfer_requests")
    .insert({
      ...req,
      sender_address: req.sender_address.toLowerCase(),
      merchant_address: req.merchant_address.toLowerCase(),
      status: "pending",
    })
    .select()
    .single();
  if (error) { console.error(error); return null; }
  return data as TransferRequest;
}

export async function getTransferRequest(id: string): Promise<TransferRequest | null> {
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("transfer_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as TransferRequest;
}

export async function getSenderTransferRequests(senderAddress: string): Promise<TransferRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("transfer_requests")
    .select("*")
    .eq("sender_address", senderAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as TransferRequest[];
}

export async function getMerchantTransferRequests(merchantAddress: string): Promise<TransferRequest[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("transfer_requests")
    .select("*")
    .eq("merchant_address", merchantAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as TransferRequest[];
}

// Merchant accepts the sender's proposal as-is
export async function acceptTransferRequest(id: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_requests")
    .update({ status: "accepted", updated_at: new Date().toISOString() })
    .eq("id", id);
}

// Merchant proposes counter-terms; increments renegotiation_count
export async function merchantCounterPropose(
  id: string,
  counter: Pick<TransferRequest,
    | "counter_total_amount" | "counter_initial_deposit" | "counter_commitment_date"
    | "counter_amount_per_period" | "counter_interval_seconds" | "counter_total_periods"
    | "counter_first_due_date" | "counter_note"
  >,
  currentCount: number
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_requests")
    .update({
      ...counter,
      status: "renegotiating",
      renegotiation_count: currentCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// Sender agrees to merchant's counter — promotes counter fields to main proposal
export async function senderAcceptsCounter(id: string, counter: Pick<TransferRequest,
  | "counter_total_amount" | "counter_initial_deposit" | "counter_commitment_date"
  | "counter_amount_per_period" | "counter_interval_seconds" | "counter_total_periods"
  | "counter_first_due_date" | "counter_note"
>): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_requests")
    .update({
      total_amount: counter.counter_total_amount,
      initial_deposit: counter.counter_initial_deposit,
      commitment_date: counter.counter_commitment_date,
      amount_per_period: counter.counter_amount_per_period,
      interval_seconds: counter.counter_interval_seconds,
      total_periods: counter.counter_total_periods,
      first_due_date: counter.counter_first_due_date,
      note: counter.counter_note,
      counter_total_amount: null,
      counter_initial_deposit: null,
      counter_commitment_date: null,
      counter_amount_per_period: null,
      counter_interval_seconds: null,
      counter_total_periods: null,
      counter_first_due_date: null,
      counter_note: null,
      status: "accepted",
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

// Sender sends a new counter back to merchant (keeps renegotiating)
export async function senderCounterPropose(
  id: string,
  proposal: Pick<TransferRequest,
    | "total_amount" | "initial_deposit" | "commitment_date"
    | "amount_per_period" | "interval_seconds" | "total_periods" | "first_due_date"
    | "note"
  >,
  currentCount: number
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_requests")
    .update({
      ...proposal,
      counter_total_amount: null,
      counter_initial_deposit: null,
      counter_commitment_date: null,
      counter_amount_per_period: null,
      counter_interval_seconds: null,
      counter_total_periods: null,
      counter_first_due_date: null,
      counter_note: null,
      status: "renegotiating",
      renegotiation_count: currentCount + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
}

export async function cancelTransferRequest(id: string, cancelledBy: CancelledBy): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_requests")
    .update({ status: "cancelled", cancelled_by: cancelledBy, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// Called after on-chain pledge creation succeeds
export async function confirmTransferRequest(id: string, pledgeId: string, txHash: string): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_requests")
    .update({ status: "confirmed", pledge_id: pledgeId, tx_hash: txHash, updated_at: new Date().toISOString() })
    .eq("id", id);
}

export async function sendTransferRequestNotification(
  requestId: string,
  recipientAddress: string,
  type: TransferRequestNotificationType
): Promise<void> {
  if (!supabase) return;
  await supabase
    .from("transfer_request_notifications")
    .insert({ request_id: requestId, recipient_address: recipientAddress.toLowerCase(), type });
}

export async function getTransferRequestNotifications(
  recipientAddress: string
): Promise<TransferRequestNotification[]> {
  if (!supabase) return [];
  const { data, error } = await supabase
    .from("transfer_request_notifications")
    .select("*, transfer_requests(*)")
    .eq("recipient_address", recipientAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as TransferRequestNotification[];
}

export async function markTransferNotificationRead(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from("transfer_request_notifications").update({ read: true }).eq("id", id);
}


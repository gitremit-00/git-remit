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
  const { data, error } = await supabase
    .from("transfer_requests")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !data) return null;
  return data as TransferRequest;
}

export async function getSenderTransferRequests(senderAddress: string): Promise<TransferRequest[]> {
  const { data, error } = await supabase
    .from("transfer_requests")
    .select("*")
    .eq("sender_address", senderAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as TransferRequest[];
}

export async function getMerchantTransferRequests(merchantAddress: string): Promise<TransferRequest[]> {
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
  await supabase
    .from("transfer_requests")
    .update({ status: "cancelled", cancelled_by: cancelledBy, updated_at: new Date().toISOString() })
    .eq("id", id);
}

// Called after on-chain pledge creation succeeds
export async function confirmTransferRequest(id: string, pledgeId: string, txHash: string): Promise<void> {
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
  await supabase
    .from("transfer_request_notifications")
    .insert({ request_id: requestId, recipient_address: recipientAddress.toLowerCase(), type });
}

export async function getTransferRequestNotifications(
  recipientAddress: string
): Promise<TransferRequestNotification[]> {
  const { data, error } = await supabase
    .from("transfer_request_notifications")
    .select("*, transfer_requests(*)")
    .eq("recipient_address", recipientAddress.toLowerCase())
    .order("created_at", { ascending: false });
  if (error || !data) return [];
  return data as TransferRequestNotification[];
}

export async function markTransferNotificationRead(id: string): Promise<void> {
  await supabase.from("transfer_request_notifications").update({ read: true }).eq("id", id);
}

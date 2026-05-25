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

export interface PaymentRequest {
  id: string;
  merchant_address: string;
  merchant_name: string | null;
  amount: number;          // USDC amount (no decimals, e.g. 250.00)
  deadline: string;        // ISO datetime string
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

import type { AuthRole } from "./auth-server";

export interface AuthSession {
  userId: string;
  role: AuthRole;
  exp: number;
}

export interface PendingOtpSession extends AuthSession {
  email: string;
  otpHash: string;
}

function base64UrlEncode(input: string) {
  return Buffer.from(input).toString("base64url");
}

function base64UrlDecode(input: string) {
  return Buffer.from(input, "base64url").toString("utf8");
}

async function sign(data: string, secret: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(data));
  return Buffer.from(signature).toString("base64url");
}

function sessionSecret(): string {
  const secret = process.env.AUTH_SESSION_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SESSION_SECRET env var is not set. " +
      "Generate a random 32-byte hex string and add it to .env.local. " +
      "Do NOT reuse SUPABASE_SERVICE_ROLE_KEY for this."
    );
  }
  return secret;
}

export async function createSessionCookie(session: AuthSession) {
  const payload = base64UrlEncode(JSON.stringify(session));
  const signature = await sign(payload, sessionSecret());
  return `${payload}.${signature}`;
}

export async function createSignedCookie<T extends object>(data: T) {
  const payload = base64UrlEncode(JSON.stringify(data));
  const signature = await sign(payload, sessionSecret());
  return `${payload}.${signature}`;
}

export async function verifySignedCookie<T extends { exp?: number }>(cookie: string | undefined): Promise<T | null> {
  if (!cookie) return null;
  const [payload, signature] = cookie.split(".");
  if (!payload || !signature) return null;

  const expected = await sign(payload, sessionSecret());
  if (signature !== expected) return null;

  try {
    const data = JSON.parse(base64UrlDecode(payload)) as T;
    if (data.exp && data.exp < Date.now()) return null;
    return data;
  } catch {
    return null;
  }
}

export async function verifySessionCookie(cookie: string | undefined): Promise<AuthSession | null> {
  const session = await verifySignedCookie<AuthSession>(cookie);
  if (!session?.exp || session.exp < Date.now()) return null;
  return session;
}

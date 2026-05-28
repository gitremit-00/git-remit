import { createClient } from "@supabase/supabase-js";
import { pbkdf2Sync, randomBytes, timingSafeEqual } from "crypto";
import nodemailer from "nodemailer";

export type AuthRole = "sender" | "merchant" | "admin";
export type ProfileRole = "ofw_sender" | "merchant";

const OTP_TTL_MINUTES = 10;
const RESET_TTL_MINUTES = 15;
const HASH_ITERATIONS = 210_000;
const HASH_LENGTH = 32;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set(["image/jpeg", "image/png", "application/pdf"]);

export function adminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error("Supabase URL and service role key are required.");
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
}

export function publicClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Supabase URL and anon key are required.");
  }

  return createClient(url, anonKey, {
    auth: { persistSession: false },
  });
}

export function validatePassword(password: string) {
  const issues: string[] = [];
  if (password.length < 8) issues.push("at least 8 characters");
  if (!/[A-Z]/.test(password)) issues.push("one uppercase letter");
  if (!/[a-z]/.test(password)) issues.push("one lowercase letter");
  if (!/[0-9]/.test(password)) issues.push("one number");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("one special character");
  return issues;
}

export function hashSecret(secret: string) {
  const salt = randomBytes(16).toString("hex");
  const hash = pbkdf2Sync(secret, salt, HASH_ITERATIONS, HASH_LENGTH, "sha256").toString("hex");
  return `pbkdf2_sha256$${HASH_ITERATIONS}$${salt}$${hash}`;
}

export function verifySecret(secret: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [method, iterationsRaw, salt, expectedHex] = stored.split("$");
  if (method !== "pbkdf2_sha256" || !iterationsRaw || !salt || !expectedHex) return false;

  const actual = pbkdf2Sync(secret, salt, Number(iterationsRaw), Buffer.from(expectedHex, "hex").length, "sha256");
  const expected = Buffer.from(expectedHex, "hex");
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function generateOtp() {
  return String(randomBytes(4).readUInt32BE(0) % 900000 + 100000);
}

export function expiresInMinutes(minutes: number) {
  return new Date(Date.now() + minutes * 60_000).toISOString();
}

export function assertAllowedFile(file: File | null, label: string) {
  if (!file || file.size === 0) throw new Error(`${label} is required.`);
  if (!ALLOWED_FILE_TYPES.has(file.type)) throw new Error(`${label} must be a JPG, PNG, or PDF file.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`${label} must be 5MB or smaller.`);
}

export async function uploadSecureFile(
  bucket: string,
  path: string,
  file: File,
) {
  assertAllowedFile(file, "Uploaded file");
  const supabase = adminClient();
  const { error } = await supabase.storage
    .from(bucket)
    .upload(path, file, { contentType: file.type, upsert: true });

  if (error) throw new Error(error.message);

  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data.publicUrl;
}

function buildEmailHtml(opts: {
  title: string;
  subtitle: string;
  code: string;
  expiresIn: string;
  footerNote: string;
}) {
  const { title, subtitle, code, expiresIn, footerNote } = opts;
  const digits = code.split("").map(d =>
    `<span style="display:inline-block;width:44px;height:56px;line-height:56px;text-align:center;background:#1a1d24;border:2px solid #2a2e3a;border-radius:10px;font-size:28px;font-weight:900;color:#DDE048;font-family:monospace;">${d}</span>`
  ).join('<span style="display:inline-block;width:8px;"></span>');
  const year = new Date().getFullYear();

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head>
<body style="margin:0;padding:0;background:#0e1014;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0e1014;padding:40px 16px;">
    <tr><td align="center">
      <table width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;">

        <!-- Header -->
        <tr><td align="center" style="padding-bottom:32px;">
          <table cellpadding="0" cellspacing="0">
            <tr>
              <td style="background:#DDE048;border-radius:10px;width:36px;height:36px;text-align:center;vertical-align:middle;">
                <span style="font-size:20px;font-weight:900;color:#0e1014;line-height:36px;">R</span>
              </td>
              <td style="padding-left:10px;vertical-align:middle;">
                <div style="font-size:20px;font-weight:900;color:#ffffff;letter-spacing:-0.5px;">RemitSafe</div>
                <div style="font-size:10px;color:#DDE048;font-weight:700;letter-spacing:2px;margin-top:1px;">SECURE OFW REMITTANCE</div>
              </td>
            </tr>
          </table>
        </td></tr>

        <!-- Card -->
        <tr><td style="background:#13161c;border:1px solid #1e2230;border-radius:20px;padding:40px 36px;">

          <!-- Title -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr>
              <td style="border-left:3px solid #DDE048;padding-left:14px;">
                <div style="font-size:11px;font-weight:700;color:#DDE048;letter-spacing:2px;text-transform:uppercase;margin-bottom:4px;">RemitSafe Security</div>
                <div style="font-size:22px;font-weight:900;color:#ffffff;">${title}</div>
              </td>
            </tr>
          </table>

          <p style="margin:0 0 28px;font-size:14px;color:#888;line-height:1.6;">${subtitle}</p>

          <!-- OTP Box -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:28px;">
            <tr><td style="background:#0e1014;border:1px solid #1e2230;border-radius:14px;padding:28px 24px;text-align:center;">
              <div style="font-size:11px;font-weight:600;color:#555;letter-spacing:2px;text-transform:uppercase;margin-bottom:18px;">Your One-Time Code</div>
              <div style="margin-bottom:18px;">${digits}</div>
              <div style="display:inline-block;background:#DDE048/10;border:1px solid #2a2e3a;border-radius:8px;padding:6px 16px;">
                <span style="font-size:12px;color:#666;">Expires in&nbsp;</span>
                <span style="font-size:12px;font-weight:700;color:#DDE048;">${expiresIn}</span>
              </div>
            </td></tr>
          </table>

          <!-- Security Notice -->
          <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:24px;">
            <tr><td style="background:#1a0a0a;border:1px solid #3a1515;border-radius:12px;padding:16px 20px;">
              <div style="font-size:11px;font-weight:700;color:#ef4444;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:8px;">⚠ Security Notice</div>
              <p style="margin:0;font-size:13px;color:#888;line-height:1.6;">
                Never share this code with anyone. RemitSafe will never ask for your OTP via chat, phone, or any other channel.
              </p>
            </td></tr>
          </table>

          <p style="margin:0;font-size:12px;color:#555;line-height:1.6;">
            If you did not request this, you can safely ignore this email — your account remains secure.
          </p>
        </td></tr>

        <!-- Footer -->
        <tr><td style="padding:24px 0;text-align:center;">
          <p style="margin:0 0 6px;font-size:12px;color:#444;">${footerNote}</p>
          <p style="margin:0;font-size:11px;color:#333;">© ${year} RemitSafe &nbsp;·&nbsp; remitsafe.app &nbsp;·&nbsp; This is an automated message. Do not reply.</p>
        </td></tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function buildEmailText(opts: {
  title: string;
  subtitle: string;
  code: string;
  expiresIn: string;
  footerNote: string;
}) {
  const { title, subtitle, code, expiresIn, footerNote } = opts;
  const year = new Date().getFullYear();
  return [
    `RemitSafe — ${title}`,
    "",
    subtitle,
    "",
    `Your one-time code: ${code}`,
    `Expires in: ${expiresIn}`,
    "",
    "Never share this code with anyone. RemitSafe will never ask for your OTP via chat, phone, or any other channel.",
    "",
    "If you did not request this, you can safely ignore this email.",
    "",
    footerNote,
    `© ${year} RemitSafe · remitsafe.app`,
  ].join("\n");
}

export async function sendAuthEmail(to: string, subject: string, text: string, html: string) {
  const gmailUser = process.env.GMAIL_USER;
  const gmailPass = process.env.GMAIL_APP_PASSWORD;
  const resendKey = process.env.RESEND_API_KEY;

  // Gmail SMTP
  if (gmailUser && gmailPass) {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: { user: gmailUser, pass: gmailPass },
    });
    await transporter.sendMail({
      from: `RemitSafe <${gmailUser}>`,
      to,
      subject,
      text,
      html,
    });
    return { delivered: true };
  }

  // Resend fallback
  if (resendKey) {
    const from = process.env.AUTH_EMAIL_FROM ?? "RemitSafe <onboarding@resend.dev>";
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text, html }),
    });
    if (!response.ok) {
      const message = await response.text();
      throw new Error(`Email delivery failed: ${message}`);
    }
    return { delivered: true };
  }

  // Dev fallback — show OTP on screen
  console.log(`[auth email fallback] To: ${to}\nSubject: ${subject}\n${text}`);
  return { delivered: false };
}

export async function sendOtpEmail(to: string, code: string, purpose: "verify" | "login" | "reset") {
  const subject =
    purpose === "verify" ? "Verify your RemitSafe email"
    : purpose === "reset" ? "Reset your RemitSafe password"
    : "Your RemitSafe login code";

  const titleMap = {
    verify: "Verify your email",
    login: "Your login code",
    reset: "Reset your password",
  };
  const subtitleMap = {
    verify: "Enter this code to verify your RemitSafe account.",
    login: "Use this code to complete your sign-in to RemitSafe.",
    reset: "Use this code to reset your RemitSafe password.",
  };
  const expiresIn = purpose === "reset" ? `${RESET_TTL_MINUTES} minutes` : `${OTP_TTL_MINUTES} minutes`;
  const footerNote = purpose === "verify"
    ? "You're receiving this because you created a RemitSafe account."
    : purpose === "reset"
      ? "You're receiving this because a password reset was requested for your account."
      : "You're receiving this because a login was attempted on your RemitSafe account.";

  const emailOpts = { title: titleMap[purpose], subtitle: subtitleMap[purpose], code, expiresIn, footerNote };

  return sendAuthEmail(to, subject, buildEmailText(emailOpts), buildEmailHtml(emailOpts));
}

export const AUTH_LIMITS = {
  otpTtlMinutes: OTP_TTL_MINUTES,
  resetTtlMinutes: RESET_TTL_MINUTES,
};

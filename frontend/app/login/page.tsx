"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { ArrowRight, CheckCircle2, Loader, Mail, ShieldCheck, KeyRound } from "lucide-react";

type Mode = "login" | "otp" | "forgot" | "reset";

async function postJson(path: string, body: unknown) {
  const response = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("login");
  const [usernameOrEmail, setUsernameOrEmail] = useState("");
  const [password, setPassword] = useState("");
  const [email, setEmail] = useState("");
  const [otp, setOtp] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [devOtp, setDevOtp] = useState("");
  const [loading, setLoading] = useState(false);

  function returnToLogin() {
    setMode("login");
    setOtp("");
    setEmail("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage("");
    setError("");
    setDevOtp("");
  }

  async function submitLogin(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage(""); setDevOtp("");
    try {
      const result = await postJson("/api/auth/login", { usernameOrEmail, password });
      setEmail(result.email);
      setDevOtp(result.devOtp ?? "");
      setMessage(result.message);
      setMode("otp");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitOtp(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await postJson("/api/auth/verify-login", { email, otp });
      setMessage("Login verified. Redirecting...");
      router.replace(result.redirectTo);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitForgot(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage(""); setDevOtp("");
    try {
      const result = await postJson("/api/auth/forgot-password", { email });
      setDevOtp(result.devOtp ?? "");
      setMessage(result.message);
      setOtp("");
      setMode("reset");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitReset(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await postJson("/api/auth/reset-password", { otp, password: newPassword, confirmPassword });
      setMessage(result.message);
      setTimeout(returnToLogin, 2000);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-[420px]">
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 shadow-2xl">
          <div className="flex flex-col items-center mb-7">
            <Image src="/logo.png" alt="RemitSafe" width={48} height={48} style={{ objectFit: "contain" }} />
            <span className="text-white font-extrabold text-lg mt-3">RemitSafe</span>
            <span className="text-[#666] text-xs mt-1">Secure OFW and merchant remittance access</span>
          </div>

          <div className="mb-5">
            <h1 className="text-white text-xl font-extrabold">
              {mode === "login" && "Welcome back"}
              {mode === "otp" && "Verify your login"}
              {mode === "forgot" && "Reset password"}
              {mode === "reset" && "Set new password"}
            </h1>
            <p className="text-[#666] text-sm mt-1">
              {mode === "login" && "Sign in with username or email, then confirm the OTP sent to your Gmail/email."}
              {mode === "otp" && `Enter the 6-digit code sent to ${email}.`}
              {mode === "forgot" && "We will send a reset code to your registered email."}
              {mode === "reset" && "Enter the 6-digit code from your email and choose a new password."}
            </p>
          </div>

          {error && <Alert tone="error" text={error} />}
          {message && <Alert tone="success" text={message} />}
          {devOtp && (mode === "otp" || mode === "reset") && <Alert tone="info" text={`Development OTP: ${devOtp}`} />}

          {mode === "login" && (
            <form onSubmit={submitLogin} className="space-y-4">
              <AuthField label="Username or Email">
                <input className={inputCls} placeholder="juan.ofw or juan@gmail.com" value={usernameOrEmail} onChange={(e) => setUsernameOrEmail(e.target.value)} />
              </AuthField>
              <AuthField label="Password">
                <input className={inputCls} type="password" placeholder="Enter your password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </AuthField>
              <button type="button" onClick={() => { setMode("forgot"); setError(""); setMessage(""); }} className="text-[#DDE048] text-xs font-semibold">
                Forgot Password?
              </button>
              <SubmitButton loading={loading} label="Continue" Icon={ArrowRight} />
            </form>
          )}

          {mode === "otp" && (
            <form onSubmit={submitOtp} className="space-y-4">
              <AuthField label="Authentication Code">
                <input className={`${inputCls} tracking-[0.4em] text-center`} placeholder="000000" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
              </AuthField>
              <SubmitButton loading={loading} label="Verify and open dashboard" Icon={ShieldCheck} />
              <button type="button" onClick={returnToLogin} className="w-full text-[#666] text-xs">
                Use a different account
              </button>
            </form>
          )}

          {mode === "forgot" && (
            <form onSubmit={submitForgot} className="space-y-4">
              <AuthField label="Registered Email">
                <input className={inputCls} type="email" placeholder="you@gmail.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </AuthField>
              <SubmitButton loading={loading} label="Send reset code" Icon={Mail} />
              <button type="button" onClick={returnToLogin} className="w-full text-[#666] text-xs">
                Back to login
              </button>
            </form>
          )}

          {mode === "reset" && (
            <form onSubmit={submitReset} className="space-y-4">
              <AuthField label="Reset Code">
                <input className={`${inputCls} tracking-[0.4em] text-center`} placeholder="000000" inputMode="numeric" maxLength={6} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))} />
              </AuthField>
              <AuthField label="New Password">
                <input className={inputCls} type="password" placeholder="Enter new password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </AuthField>
              <AuthField label="Confirm Password">
                <input className={inputCls} type="password" placeholder="Confirm new password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </AuthField>
              <SubmitButton loading={loading} label="Update password" Icon={KeyRound} />
              <button type="button" onClick={() => { setMode("forgot"); setOtp(""); setError(""); setMessage(""); }} className="w-full text-[#666] text-xs">
                Resend code
              </button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-[#1e2230] text-center">
            <span className="text-[#555] text-xs">No account yet? </span>
            <Link href="/signup" className="text-[#DDE048] text-xs font-bold">Create an Account</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/60 placeholder:text-[#3a3d46] transition-colors";

function AuthField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[#888] text-xs font-semibold block mb-1.5">{label}</span>
      {children}
    </label>
  );
}

function SubmitButton({ loading, label, Icon }: { loading: boolean; label: string; Icon: React.ComponentType<{ size?: string | number }> }) {
  return (
    <button type="submit" disabled={loading} className="w-full bg-[#DDE048] text-black font-extrabold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 disabled:opacity-50">
      {loading ? <Loader size={15} className="animate-spin" /> : <Icon size={15} />}
      {loading ? "Please wait..." : label}
    </button>
  );
}

function Alert({ text, tone }: { text: string; tone: "error" | "success" | "info" }) {
  const styles = {
    error: "bg-red-500/10 border-red-500/20 text-red-400",
    success: "bg-green-500/10 border-green-500/20 text-green-400",
    info: "bg-[#DDE048]/10 border-[#DDE048]/20 text-[#DDE048]",
  };
  return (
    <div className={`border rounded-xl px-3.5 py-2.5 text-xs mb-4 flex items-start gap-2 ${styles[tone]}`}>
      {tone === "success" && <CheckCircle2 size={14} className="shrink-0 mt-px" />}
      <span>{text}</span>
    </div>
  );
}

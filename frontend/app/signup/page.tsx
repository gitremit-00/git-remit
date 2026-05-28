"use client";
import Image from "next/image";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { ArrowRight, Check, CheckCircle2, Loader, PlaneTakeoff, Store, Upload, X } from "lucide-react";

type Role = "sender" | "merchant";

const COUNTRIES = ["Philippines", "United States", "Canada", "Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Singapore", "Hong Kong", "Japan", "South Korea", "Taiwan", "Malaysia", "United Kingdom", "Italy", "Australia", "Other"];
const ID_TYPES = ["Passport", "Driver's License", "National ID", "PhilSys National ID", "UMID", "Voter's ID", "SSS ID", "Other"];
const BUSINESS_TYPES = ["Retail", "Restaurant / Food", "Grocery", "School / Education", "Medical / Pharmacy", "Services", "Rentals / Housing", "Other"];

interface FormState {
  role: Role | "";
  username: string;
  password: string;
  confirmPassword: string;
  fullName: string;
  phone: string;
  email: string;
  countryWork: string;
  countryOrigin: string;
  idType: string;
  idNumber: string;
  idPhoto: File | null;
  businessName: string;
  businessType: string;
  businessAddress: string;
  city: string;
  businessPermit: File | null;
}

const initialForm: FormState = {
  role: "",
  username: "",
  password: "",
  confirmPassword: "",
  fullName: "",
  phone: "",
  email: "",
  countryWork: "",
  countryOrigin: "Philippines",
  idType: "",
  idNumber: "",
  idPhoto: null,
  businessName: "",
  businessType: "",
  businessAddress: "",
  city: "",
  businessPermit: null,
};

function passwordIssues(password: string) {
  const issues: string[] = [];
  if (password.length < 8) issues.push("8+ characters");
  if (!/[A-Z]/.test(password)) issues.push("uppercase");
  if (!/[a-z]/.test(password)) issues.push("lowercase");
  if (!/[0-9]/.test(password)) issues.push("number");
  if (!/[^A-Za-z0-9]/.test(password)) issues.push("special");
  return issues;
}

function validFile(file: File | null) {
  if (!file) return false;
  return ["image/jpeg", "image/png", "application/pdf"].includes(file.type) && file.size <= 5 * 1024 * 1024;
}

async function postForm(path: string, form: FormData) {
  const response = await fetch(path, { method: "POST", body: form });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

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

export default function Signup() {
  const [form, setForm] = useState<FormState>(initialForm);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [verificationReady, setVerificationReady] = useState(false);
  const [devOtp, setDevOtp] = useState<string | null>(null);
  const [otpValue, setOtpValue] = useState("");
  const [verified, setVerified] = useState(false);

  const issues = useMemo(() => passwordIssues(form.password), [form.password]);
  const canSubmit = Boolean(
    form.role &&
    form.username &&
    form.password &&
    form.confirmPassword &&
    form.fullName &&
    form.phone &&
    form.email &&
    form.countryWork &&
    form.countryOrigin &&
    form.idType &&
    form.idNumber &&
    validFile(form.idPhoto) &&
    issues.length === 0 &&
    form.password === form.confirmPassword &&
    (form.role === "sender" || (form.businessName && form.businessType && form.businessAddress && form.city && validFile(form.businessPermit)))
  );

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submitRegistration(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    try {
      const data = new FormData();
      Object.entries(form).forEach(([key, value]) => {
        if (value instanceof File) data.append(key, value);
        else if (value !== null) data.append(key, String(value));
      });
      const result = await postForm("/api/auth/register", data);
      setMessage(result.message);
      if (result.devOtp) setDevOtp(result.devOtp);
      setVerificationReady(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  async function submitVerify(event: FormEvent) {
    event.preventDefault();
    setLoading(true); setError(""); setMessage("");
    try {
      const result = await postJson("/api/auth/verify-email", { otp: otpValue });
      setMessage(result.message);
      setVerified(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-3xl">
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 md:p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-7">
            <Image src="/logo.png" alt="RemitSafe" width={48} height={48} style={{ objectFit: "contain" }} />
            <span className="text-white font-extrabold text-lg mt-3">Create your RemitSafe account</span>
            <span className="text-[#666] text-xs mt-1 text-center">Secure registration for OFW senders and verified merchants</span>
          </div>

          {error && <Alert tone="error" text={error} />}
          {message && <Alert tone="success" text={message} />}

          {verificationReady ? (
            <div className="max-w-sm mx-auto text-center">
              {verified ? (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
                    <CheckCircle2 size={24} color="#22c55e" />
                  </div>
                  <h2 className="text-white font-extrabold text-lg mb-2">Email verified!</h2>
                  <p className="text-[#888] text-sm leading-relaxed mb-5">Your account is active. You can now log in.</p>
                  <Link href="/login" className="w-full bg-[#DDE048] text-black font-extrabold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2">
                    Go to Login <ArrowRight size={15} />
                  </Link>
                </>
              ) : (
                <>
                  <div className="w-14 h-14 rounded-2xl bg-[#DDE048]/10 border border-[#DDE048]/20 flex items-center justify-center mx-auto mb-4">
                    <Check size={24} color="#DDE048" />
                  </div>
                  <h2 className="text-white font-extrabold text-lg mb-1">Verify your email</h2>
                  <p className="text-[#888] text-sm leading-relaxed mb-5">
                    We sent a 6-digit code to <span className="text-white font-semibold">{form.email}</span>. Enter it below to activate your account.
                  </p>
                  {devOtp && (
                    <div className="bg-blue-500/10 border border-blue-500/20 text-blue-400 text-xs rounded-xl px-3 py-2 mb-4 text-left">
                      Development code: <span className="font-mono font-bold">{devOtp}</span>
                    </div>
                  )}
                  <form onSubmit={submitVerify} className="space-y-3">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="000000"
                      value={otpValue}
                      onChange={(e) => setOtpValue(e.target.value.replace(/\D/g, "").slice(0, 6))}
                      className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-center text-2xl font-mono tracking-[0.4em] outline-none focus:border-[#DDE048]/50"
                    />
                    <button
                      type="submit"
                      disabled={loading || otpValue.length !== 6}
                      className="w-full bg-[#DDE048] text-black font-extrabold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {loading ? <Loader size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}
                      {loading ? "Verifying…" : "Verify Email"}
                    </button>
                  </form>
                  <p className="text-[#444] text-xs mt-4">Didn&apos;t get the code? Check your spam folder.</p>
                </>
              )}
            </div>
          ) : (
            <form onSubmit={submitRegistration} className="space-y-6">
              <section>
                <SectionTitle title="Choose Role" />
                <div className="grid md:grid-cols-2 gap-3">
                  <RoleButton active={form.role === "sender"} title="OFW / Sender" desc="Send remittance pledges to people or merchants" Icon={PlaneTakeoff} onClick={() => set("role", "sender")} />
                  <RoleButton active={form.role === "merchant"} title="Merchant" desc="Receive customer pledges and payment requests" Icon={Store} onClick={() => set("role", "merchant")} />
                </div>
              </section>

              <section>
                <SectionTitle title="Login Credentials" />
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Username">
                    <input className={inputCls} placeholder="juan.ofw" value={form.username} onChange={(e) => set("username", e.target.value)} />
                  </Field>
                  <Field label="Email Address">
                    <input className={inputCls} type="email" placeholder="you@gmail.com" value={form.email} onChange={(e) => set("email", e.target.value)} />
                  </Field>
                  <Field label="Password">
                    <input className={inputCls} type="password" placeholder="Strong password" value={form.password} onChange={(e) => set("password", e.target.value)} />
                    {form.password && <p className={`text-[11px] mt-1.5 ${issues.length ? "text-amber-400" : "text-green-400"}`}>{issues.length ? `Needs: ${issues.join(", ")}` : "Password strength looks good."}</p>}
                  </Field>
                  <Field label="Confirm Password">
                    <input className={inputCls} type="password" placeholder="Repeat password" value={form.confirmPassword} onChange={(e) => set("confirmPassword", e.target.value)} />
                    {form.confirmPassword && form.password !== form.confirmPassword && <p className="text-red-400 text-[11px] mt-1.5">Passwords do not match.</p>}
                  </Field>
                </div>
              </section>

              <section>
                <SectionTitle title={form.role === "merchant" ? "Merchant Owner Details" : "OFW / Sender Details"} />
                <div className="grid md:grid-cols-2 gap-3">
                  <Field label="Full Name">
                    <input className={inputCls} placeholder="Juan Dela Cruz" value={form.fullName} onChange={(e) => set("fullName", e.target.value)} />
                  </Field>
                  <Field label="Phone Number">
                    <input className={inputCls} type="tel" placeholder="+63 9XX XXX XXXX" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
                  </Field>
                  <Field label="Country of Work">
                    <select className={inputCls} value={form.countryWork} onChange={(e) => set("countryWork", e.target.value)}>
                      <option value="">Select country</option>
                      {COUNTRIES.map((country) => <option key={country}>{country}</option>)}
                    </select>
                  </Field>
                  <Field label="Country of Origin">
                    <select className={inputCls} value={form.countryOrigin} onChange={(e) => set("countryOrigin", e.target.value)}>
                      {COUNTRIES.map((country) => <option key={country}>{country}</option>)}
                    </select>
                  </Field>
                  <Field label="Government ID Type">
                    <select className={inputCls} value={form.idType} onChange={(e) => set("idType", e.target.value)}>
                      <option value="">Select ID type</option>
                      {ID_TYPES.map((type) => <option key={type}>{type}</option>)}
                    </select>
                  </Field>
                  <Field label="ID Number">
                    <input className={inputCls} placeholder="ID number" value={form.idNumber} onChange={(e) => set("idNumber", e.target.value)} />
                  </Field>
                </div>
                <FilePicker label="Government ID Photo" file={form.idPhoto} onChange={(file) => set("idPhoto", file)} />
              </section>

              {form.role === "merchant" && (
                <section>
                  <SectionTitle title="Business Details" />
                  <div className="grid md:grid-cols-2 gap-3">
                    <Field label="Business Name">
                      <input className={inputCls} placeholder="Dela Cruz Store" value={form.businessName} onChange={(e) => set("businessName", e.target.value)} />
                    </Field>
                    <Field label="Business Type">
                      <select className={inputCls} value={form.businessType} onChange={(e) => set("businessType", e.target.value)}>
                        <option value="">Select business type</option>
                        {BUSINESS_TYPES.map((type) => <option key={type}>{type}</option>)}
                      </select>
                    </Field>
                    <Field label="Business Address">
                      <input className={inputCls} placeholder="Street, barangay, province" value={form.businessAddress} onChange={(e) => set("businessAddress", e.target.value)} />
                    </Field>
                    <Field label="City / Municipality">
                      <input className={inputCls} placeholder="Quezon City" value={form.city} onChange={(e) => set("city", e.target.value)} />
                    </Field>
                  </div>
                  <FilePicker label="Business Permit Upload" file={form.businessPermit} onChange={(file) => set("businessPermit", file)} />
                </section>
              )}

              <button disabled={!canSubmit || loading} className="w-full bg-[#DDE048] text-black font-extrabold rounded-xl py-4 text-sm flex items-center justify-center gap-2 disabled:opacity-40">
                {loading ? <Loader size={15} className="animate-spin" /> : <ArrowRight size={15} />}
                {loading ? "Creating account..." : "Create Account and Send Verification"}
              </button>
            </form>
          )}

          <div className="mt-6 pt-5 border-t border-[#1e2230] text-center">
            <span className="text-[#555] text-xs">Already registered? </span>
            <Link href="/login" className="text-[#DDE048] text-xs font-bold">Log in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/60 placeholder:text-[#3a3d46] transition-colors appearance-none";

function SectionTitle({ title }: { title: string }) {
  return <h2 className="text-white font-extrabold text-sm mb-3">{title}</h2>;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[#888] text-xs font-semibold block mb-1.5">{label} <span className="text-red-400">*</span></span>
      {children}
    </label>
  );
}

function RoleButton({ active, title, desc, Icon, onClick }: { active: boolean; title: string; desc: string; Icon: React.ComponentType<{ size?: string | number; color?: string }>; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`text-left p-4 rounded-2xl border transition-colors flex items-center gap-3 ${active ? "border-[#DDE048] bg-[#DDE048]/10" : "border-[#1e2230] bg-[#0e1014]"}`}>
      <div className="w-10 h-10 rounded-xl bg-[#DDE048]/10 flex items-center justify-center"><Icon size={20} color="#DDE048" /></div>
      <div className="flex-1">
        <div className="text-white font-bold text-sm">{title}</div>
        <div className="text-[#666] text-xs mt-0.5">{desc}</div>
      </div>
      {active && <Check size={16} color="#DDE048" />}
    </button>
  );
}

function FilePicker({ label, file, onChange }: { label: string; file: File | null; onChange: (file: File | null) => void }) {
  const valid = validFile(file);
  return (
    <div className="mt-3">
      <span className="text-[#888] text-xs font-semibold block mb-1.5">{label} <span className="text-red-400">*</span></span>
      {file ? (
        <div className={`flex items-center gap-2 bg-[#0e1014] border rounded-xl px-4 py-3 ${valid ? "border-[#DDE048]/30" : "border-red-500/30"}`}>
          <Check size={14} color={valid ? "#DDE048" : "#ef4444"} />
          <span className="text-sm text-white truncate flex-1">{file.name}</span>
          <span className="text-[#555] text-xs">{(file.size / 1024 / 1024).toFixed(1)}MB</span>
          <button type="button" onClick={() => onChange(null)} className="text-[#555]"><X size={14} /></button>
        </div>
      ) : (
        <label className="w-full flex items-center gap-2 bg-[#0e1014] border border-dashed border-[#333] rounded-xl px-4 py-3 text-[#666] text-sm cursor-pointer">
          <Upload size={14} /> Upload JPG, PNG, or PDF up to 5MB
          <input type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
        </label>
      )}
      {file && !valid && <p className="text-red-400 text-[11px] mt-1.5">File must be JPG, PNG, or PDF and 5MB or smaller.</p>}
    </div>
  );
}

function Alert({ text, tone }: { text: string; tone: "error" | "success" | "info" }) {
  const styles = {
    error: "bg-red-500/10 border-red-500/20 text-red-400",
    success: "bg-green-500/10 border-green-500/20 text-green-400",
    info: "bg-[#DDE048]/10 border-[#DDE048]/20 text-[#DDE048]",
  };
  return <div className={`border rounded-xl px-3.5 py-2.5 text-xs mb-4 ${styles[tone]}`}>{text}</div>;
}

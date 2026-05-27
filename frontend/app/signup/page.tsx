"use client";
import { useState, useEffect, useRef } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader, PlaneTakeoff, Store, Upload, X } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { fetchUserRole } from "../../lib/supabase";

type Role = "sender" | "merchant";

const OFW_COUNTRIES = [
  "Saudi Arabia", "United Arab Emirates", "Qatar", "Kuwait", "Bahrain", "Oman",
  "Singapore", "Hong Kong", "Japan", "South Korea", "Taiwan", "Malaysia",
  "United States", "Canada", "United Kingdom", "Italy", "Spain", "Germany",
  "Australia", "New Zealand", "Israel", "Other",
];

const BUSINESS_TYPES = [
  "Retail", "Restaurant / Food", "Grocery / Sari-sari", "School / Educational",
  "Pharmacy / Medical", "Services", "Transportation", "Entertainment", "Other",
];

const ID_TYPES = ["Passport", "Driver's License", "UMID", "PhilSys (National ID)", "Voter's ID", "SSS ID"];

const STEPS = ["Connect", "Choose role", "Your details", "Review"];

interface OFWForm {
  full_name: string; phone: string; country_work: string;
  country_origin: string; id_type: string; id_number: string;
  id_photo: File | null;
}

interface MerchantForm {
  business_name: string; business_type: string; owner_name: string;
  phone: string; business_address: string; city: string;
  business_permit: File | null; id_type: string; id_number: string;
}

export default function Signup() {
  const { account, connect, walletLoading } = useWallet();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [role, setRole] = useState<Role | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [ofw, setOfw] = useState<OFWForm>({
    full_name: "", phone: "", country_work: "", country_origin: "Philippines",
    id_type: "", id_number: "", id_photo: null,
  });

  const [merchant, setMerchant] = useState<MerchantForm>({
    business_name: "", business_type: "", owner_name: "", phone: "",
    business_address: "", city: "", business_permit: null, id_type: "", id_number: "",
  });

  const idPhotoRef = useRef<HTMLInputElement>(null);
  const permitRef = useRef<HTMLInputElement>(null);

  // If wallet already has an account, redirect to login (existing user)
  useEffect(() => {
    if (!account || walletLoading) return;
    fetchUserRole(account).then((r) => {
      if (r) {
        document.cookie = `rs_role=${r}; path=/; max-age=2592000`;
        router.replace(r === "admin" ? "/admin" : r === "merchant" ? "/merchant" : "/");
      } else {
        // confirmed new user
        if (step === 0) setStep(1);
      }
    });
  }, [account, walletLoading]);

  function ofwValid() {
    return ofw.full_name && ofw.phone && ofw.country_work && ofw.country_origin &&
      ofw.id_type && ofw.id_number && ofw.id_photo;
  }

  function merchantValid() {
    return merchant.business_name && merchant.business_type && merchant.owner_name &&
      merchant.phone && merchant.business_address && merchant.city &&
      merchant.business_permit && merchant.id_type && merchant.id_number;
  }

  async function handleSubmit() {
    if (!account || !role) return;
    setSaving(true);
    setError("");

    try {
      const form = new FormData();
      form.append("role", role);
      form.append("wallet_address", account);

      if (role === "sender") {
        form.append("full_name", ofw.full_name);
        form.append("phone", ofw.phone);
        form.append("country_work", ofw.country_work);
        form.append("country_origin", ofw.country_origin);
        form.append("id_type", ofw.id_type);
        form.append("id_number", ofw.id_number);
        if (ofw.id_photo) form.append("id_photo", ofw.id_photo);
      } else {
        form.append("business_name", merchant.business_name);
        form.append("business_type", merchant.business_type);
        form.append("owner_name", merchant.owner_name);
        form.append("phone", merchant.phone);
        form.append("business_address", merchant.business_address);
        form.append("city", merchant.city);
        form.append("id_type", merchant.id_type);
        form.append("id_number", merchant.id_number);
        if (merchant.business_permit) form.append("business_permit", merchant.business_permit);
      }

      const res = await fetch("/api/signup", { method: "POST", body: form });
      const json = await res.json();

      if (!res.ok) throw new Error(json.error || "Signup failed");

      document.cookie = `rs_role=${role}; path=/; max-age=2592000`;
      router.replace(role === "merchant" ? "/merchant" : "/");
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg">
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">

          {/* Logo */}
          <div className="flex flex-col items-center mb-6">
            <Image src="/logo.png" alt="RemitSafe" width={44} height={44} style={{ objectFit: "contain" }} />
            <span className="text-white font-extrabold text-base mt-2.5">RemitSafe</span>
          </div>

          {/* Step pills */}
          <div className="flex items-center justify-center gap-1 mb-6 flex-wrap">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  i < step ? "text-[#DDE048]" : i === step ? "bg-[#DDE048]/10 border border-[#DDE048]/40 text-[#DDE048]" : "text-[#333]"
                }`}>
                  {i < step ? <Check size={10} strokeWidth={3} /> : null}
                  {label}
                </div>
                {i < STEPS.length - 1 && <div className={`w-4 h-px ${i < step ? "bg-[#DDE048]/30" : "bg-[#1e2230]"}`} />}
              </div>
            ))}
          </div>

          {/* Step 0 — Connect */}
          {step === 0 && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Connect your wallet</h2>
              <p className="text-[#555] text-xs text-center mb-6">Your MetaMask wallet address is your identity.</p>
              {walletLoading ? (
                <div className="flex justify-center py-4"><Loader size={18} className="animate-spin text-[#DDE048]" /></div>
              ) : !account ? (
                <button
                  onClick={connect}
                  className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors"
                >
                  Connect MetaMask
                </button>
              ) : (
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3.5 py-3 flex items-center gap-2.5">
                  <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                  <span className="font-mono text-xs text-[#888] truncate">{account}</span>
                </div>
              )}
            </div>
          )}

          {/* Step 1 — Choose role */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Who are you?</h2>
              <p className="text-[#555] text-xs text-center mb-5">Choose your account type. This is tied to your wallet.</p>
              <div className="space-y-2.5 mb-5">
                {([
                  { r: "sender" as Role, Icon: PlaneTakeoff, title: "OFW / Sender", sub: "I'm sending money to the Philippines" },
                  { r: "merchant" as Role, Icon: Store, title: "Merchant", sub: "I'm a business receiving remittances" },
                ]).map(({ r, Icon, title, sub }) => (
                  <button
                    key={r}
                    onClick={() => setRole(r)}
                    className={`w-full flex items-center gap-3.5 p-4 rounded-xl border-2 text-left transition-all ${
                      role === r ? "border-[#DDE048] bg-[#DDE048]/5" : "border-[#1e2230] hover:border-[#2a2d36]"
                    }`}
                  >
                    <Icon size={22} color="#DDE048" className="shrink-0" />
                    <div className="flex-1">
                      <div className={`font-bold text-sm ${role === r ? "text-white" : "text-[#888]"}`}>{title}</div>
                      <div className="text-[11px] text-[#555] mt-0.5">{sub}</div>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                      role === r ? "border-[#DDE048] bg-[#DDE048]" : "border-[#333]"
                    }`}>
                      {role === r && <Check size={9} color="black" strokeWidth={3} />}
                    </div>
                  </button>
                ))}
              </div>
              <button
                disabled={!role}
                onClick={() => setStep(2)}
                className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Step 2 — Details form */}
          {step === 2 && role === "sender" && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">OFW / Sender Details</h2>
              <p className="text-[#555] text-xs text-center mb-5">Required for KYC verification.</p>
              <div className="space-y-3">
                <Field label="Full Name" required>
                  <input className={inputCls} placeholder="Juan Dela Cruz" value={ofw.full_name}
                    onChange={e => setOfw({ ...ofw, full_name: e.target.value })} />
                </Field>
                <Field label="Phone Number" required>
                  <input className={inputCls} type="tel" placeholder="+63 9XX XXX XXXX" value={ofw.phone}
                    onChange={e => setOfw({ ...ofw, phone: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Country of Work" required>
                    <select className={inputCls} value={ofw.country_work}
                      onChange={e => setOfw({ ...ofw, country_work: e.target.value })}>
                      <option value="">Select…</option>
                      {OFW_COUNTRIES.map(c => <option key={c}>{c}</option>)}
                    </select>
                  </Field>
                  <Field label="Country of Origin" required>
                    <select className={inputCls} value={ofw.country_origin}
                      onChange={e => setOfw({ ...ofw, country_origin: e.target.value })}>
                      <option value="Philippines">Philippines</option>
                      <option value="Other">Other</option>
                    </select>
                  </Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gov. ID Type" required>
                    <select className={inputCls} value={ofw.id_type}
                      onChange={e => setOfw({ ...ofw, id_type: e.target.value })}>
                      <option value="">Select…</option>
                      {ID_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="ID Number" required>
                    <input className={inputCls} placeholder="A12-3456789" value={ofw.id_number}
                      onChange={e => setOfw({ ...ofw, id_number: e.target.value })} />
                  </Field>
                </div>
                <Field label="Government ID Photo" required>
                  <input ref={idPhotoRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                    onChange={e => setOfw({ ...ofw, id_photo: e.target.files?.[0] ?? null })} />
                  {ofw.id_photo ? (
                    <div className="flex items-center gap-2 bg-[#0e1014] border border-[#DDE048]/30 rounded-xl px-4 py-3">
                      <Check size={14} color="#DDE048" />
                      <span className="text-sm text-white truncate flex-1">{ofw.id_photo.name}</span>
                      <button onClick={() => setOfw({ ...ofw, id_photo: null })} className="text-[#555] hover:text-red-400">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => idPhotoRef.current?.click()}
                      className="w-full flex items-center gap-2 bg-[#0e1014] border border-dashed border-[#333] rounded-xl px-4 py-3 text-[#555] text-sm hover:border-[#555] transition-colors">
                      <Upload size={14} /> Upload photo (JPG / PNG / PDF)
                    </button>
                  )}
                </Field>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setStep(1)} className="flex-1 border border-[#1e2230] text-[#555] rounded-xl py-3 text-sm hover:border-[#333] transition-colors">
                  ← Back
                </button>
                <button
                  disabled={!ofwValid()}
                  onClick={() => setStep(3)}
                  className="flex-1 bg-[#DDE048] text-black font-bold rounded-xl py-3 text-sm hover:bg-[#c8ce30] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Review →
                </button>
              </div>
            </div>
          )}

          {step === 2 && role === "merchant" && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Merchant Details</h2>
              <p className="text-[#555] text-xs text-center mb-5">Required for KYC verification.</p>
              <div className="space-y-3">
                <Field label="Business Name" required>
                  <input className={inputCls} placeholder="Dela Cruz General Store" value={merchant.business_name}
                    onChange={e => setMerchant({ ...merchant, business_name: e.target.value })} />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Business Type" required>
                    <select className={inputCls} value={merchant.business_type}
                      onChange={e => setMerchant({ ...merchant, business_type: e.target.value })}>
                      <option value="">Select…</option>
                      {BUSINESS_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="Owner Full Name" required>
                    <input className={inputCls} placeholder="Maria Dela Cruz" value={merchant.owner_name}
                      onChange={e => setMerchant({ ...merchant, owner_name: e.target.value })} />
                  </Field>
                </div>
                <Field label="Phone Number" required>
                  <input className={inputCls} type="tel" placeholder="+63 9XX XXX XXXX" value={merchant.phone}
                    onChange={e => setMerchant({ ...merchant, phone: e.target.value })} />
                </Field>
                <Field label="Business Address" required>
                  <input className={inputCls} placeholder="123 Main St, Barangay…" value={merchant.business_address}
                    onChange={e => setMerchant({ ...merchant, business_address: e.target.value })} />
                </Field>
                <Field label="City / Municipality" required>
                  <input className={inputCls} placeholder="Quezon City" value={merchant.city}
                    onChange={e => setMerchant({ ...merchant, city: e.target.value })} />
                </Field>
                <Field label="Business Permit" required>
                  <input ref={permitRef} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden"
                    onChange={e => setMerchant({ ...merchant, business_permit: e.target.files?.[0] ?? null })} />
                  {merchant.business_permit ? (
                    <div className="flex items-center gap-2 bg-[#0e1014] border border-[#DDE048]/30 rounded-xl px-4 py-3">
                      <Check size={14} color="#DDE048" />
                      <span className="text-sm text-white truncate flex-1">{merchant.business_permit.name}</span>
                      <button onClick={() => setMerchant({ ...merchant, business_permit: null })} className="text-[#555] hover:text-red-400">
                        <X size={14} />
                      </button>
                    </div>
                  ) : (
                    <button onClick={() => permitRef.current?.click()}
                      className="w-full flex items-center gap-2 bg-[#0e1014] border border-dashed border-[#333] rounded-xl px-4 py-3 text-[#555] text-sm hover:border-[#555] transition-colors">
                      <Upload size={14} /> Upload permit (JPG / PNG / PDF)
                    </button>
                  )}
                </Field>
                <div className="grid grid-cols-2 gap-3">
                  <Field label="Gov. ID Type" required>
                    <select className={inputCls} value={merchant.id_type}
                      onChange={e => setMerchant({ ...merchant, id_type: e.target.value })}>
                      <option value="">Select…</option>
                      {ID_TYPES.map(t => <option key={t}>{t}</option>)}
                    </select>
                  </Field>
                  <Field label="ID Number" required>
                    <input className={inputCls} placeholder="A12-3456789" value={merchant.id_number}
                      onChange={e => setMerchant({ ...merchant, id_number: e.target.value })} />
                  </Field>
                </div>
              </div>
              <div className="flex gap-2 mt-5">
                <button onClick={() => setStep(1)} className="flex-1 border border-[#1e2230] text-[#555] rounded-xl py-3 text-sm hover:border-[#333] transition-colors">
                  ← Back
                </button>
                <button
                  disabled={!merchantValid()}
                  onClick={() => setStep(3)}
                  className="flex-1 bg-[#DDE048] text-black font-bold rounded-xl py-3 text-sm hover:bg-[#c8ce30] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Review →
                </button>
              </div>
            </div>
          )}

          {/* Step 3 — Review */}
          {step === 3 && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Review & confirm</h2>
              <p className="text-[#555] text-xs text-center mb-5">Check your details before submitting.</p>

              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3.5 py-3 flex items-center gap-2.5 mb-4">
                <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="font-mono text-xs text-[#888] truncate">{account}</span>
              </div>

              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl divide-y divide-[#1e2230] mb-4">
                {role === "sender" ? (
                  <>
                    <ReviewRow label="Role" value="OFW / Sender" />
                    <ReviewRow label="Name" value={ofw.full_name} />
                    <ReviewRow label="Phone" value={ofw.phone} />
                    <ReviewRow label="Country of Work" value={ofw.country_work} />
                    <ReviewRow label="Country of Origin" value={ofw.country_origin} />
                    <ReviewRow label="ID Type" value={ofw.id_type} />
                    <ReviewRow label="ID Number" value={ofw.id_number} />
                    <ReviewRow label="ID Photo" value={ofw.id_photo?.name ?? "—"} />
                  </>
                ) : (
                  <>
                    <ReviewRow label="Role" value="Merchant" />
                    <ReviewRow label="Business" value={merchant.business_name} />
                    <ReviewRow label="Type" value={merchant.business_type} />
                    <ReviewRow label="Owner" value={merchant.owner_name} />
                    <ReviewRow label="Phone" value={merchant.phone} />
                    <ReviewRow label="Address" value={merchant.business_address} />
                    <ReviewRow label="City" value={merchant.city} />
                    <ReviewRow label="Permit" value={merchant.business_permit?.name ?? "—"} />
                    <ReviewRow label="ID Type" value={merchant.id_type} />
                    <ReviewRow label="ID Number" value={merchant.id_number} />
                  </>
                )}
              </div>

              <div className="bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs rounded-xl px-3.5 py-2.5 mb-4">
                Your KYC will be reviewed by an admin. You won't be able to transact until approved.
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-3.5 py-2.5 mb-4">
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={saving}
                className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors disabled:opacity-50"
              >
                {saving ? <><Loader size={14} className="animate-spin" /> Creating account…</> : <>Create account <ArrowRight size={14} /></>}
              </button>

              <button onClick={() => setStep(2)} className="w-full text-[#444] text-xs mt-3 hover:text-[#666] transition-colors">
                ← Edit details
              </button>
            </div>
          )}
        </div>

        <p className="text-[#2a2d36] text-[11px] text-center mt-5">
          Powered by Morph L2 · Secured by smart contracts
        </p>
      </div>
    </div>
  );
}

const inputCls = "w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/50 placeholder:text-[#333] transition-colors appearance-none";

function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs text-[#555] tracking-[0.5px] block mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between px-3.5 py-2.5 text-xs">
      <span className="text-[#555]">{label}</span>
      <span className="text-white font-medium text-right max-w-[60%] truncate">{value || "—"}</span>
    </div>
  );
}

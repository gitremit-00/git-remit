"use client";
import { useEffect, useState, useRef, FormEvent } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import {
  AlertTriangle, Upload, CheckCircle2, Loader, ArrowLeft, FileText, X,
} from "lucide-react";

const COUNTRIES = ["Philippines","United States","Canada","Saudi Arabia","United Arab Emirates","Qatar","Kuwait","Singapore","Hong Kong","Japan","South Korea","Taiwan","Malaysia","United Kingdom","Italy","Australia","Other"];
const ID_TYPES  = ["Passport","Driver's License","National ID","PhilSys National ID","UMID","Voter's ID","SSS ID","Other"];
const ALLOWED   = ["image/jpeg","image/png","application/pdf"];
const MAX_BYTES = 5 * 1024 * 1024;

interface Profile {
  id: string;
  role: string;
  full_name: string | null;
  phone_number: string | null;
  email: string | null;
  country_of_work: string | null;
  country_of_origin: string | null;
  gov_id_type: string | null;
  id_number: string | null;
  gov_id_photo_url: string | null;
  business_permit_url: string | null;
  kyc_status: string;
  kyc_rejection_reason: string | null;
}

const inputCls = "w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 placeholder:text-[#333]";
const labelCls = "block text-xs font-semibold text-[#555] uppercase tracking-[0.8px] mb-1.5";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      {children}
    </div>
  );
}

function FilePicker({
  label, file, existingUrl, onChange, onClear,
}: {
  label: string;
  file: File | null;
  existingUrl: string | null;
  onChange: (f: File) => void;
  onClear: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState("");
  const previewUrl = file ? URL.createObjectURL(file) : null;
  const isPdf = (url: string) => url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("application%2Fpdf");

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!ALLOWED.includes(f.type)) { setErr("Only JPG, PNG, or PDF allowed."); return; }
    if (f.size > MAX_BYTES) { setErr("File must be 5 MB or smaller."); return; }
    setErr("");
    onChange(f);
  }

  return (
    <div>
      <label className={labelCls}>{label}</label>

      {/* Existing doc preview */}
      {!file && existingUrl && (
        <div className="mb-2 bg-[#0e1014] border border-[#1e2230] rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2230]">
            <span className="text-[11px] text-[#555]">Current document</span>
            <a href={existingUrl} target="_blank" rel="noopener noreferrer"
              className="text-[11px] text-[#DDE048] hover:underline">Open</a>
          </div>
          {isPdf(existingUrl) ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[#555]">
              <FileText size={18} /><span className="text-xs">PDF document on file</span>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={existingUrl} alt="current doc" className="w-full object-contain max-h-40 bg-[#0e1014]" />
          )}
        </div>
      )}

      {/* New file preview */}
      {file && previewUrl && (
        <div className="mb-2 bg-[#0e1014] border border-[#DDE048]/20 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2230]">
            <span className="text-[11px] text-[#DDE048] font-semibold">New: {file.name}</span>
            <button onClick={onClear} className="text-[#555] hover:text-red-400 transition-colors"><X size={13} /></button>
          </div>
          {file.type === "application/pdf" ? (
            <div className="flex items-center justify-center gap-2 py-6 text-[#555]">
              <FileText size={18} /><span className="text-xs">PDF selected</span>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={previewUrl} alt="preview" className="w-full object-contain max-h-40 bg-[#0e1014]" />
          )}
        </div>
      )}

      <button type="button" onClick={() => ref.current?.click()}
        className="flex items-center gap-2 w-full border border-dashed border-[#2a2e3a] hover:border-[#DDE048]/30 rounded-xl px-4 py-3 text-sm text-[#555] hover:text-[#888] transition-colors justify-center">
        <Upload size={14} /> {file ? "Replace file" : "Upload new file"}
      </button>
      <input ref={ref} type="file" accept=".jpg,.jpeg,.png,.pdf" className="hidden" onChange={pick} />
      {err && <p className="text-red-400 text-xs mt-1.5">{err}</p>}
      <p className="text-[#333] text-[11px] mt-1">JPG, PNG or PDF · max 5 MB</p>
    </div>
  );
}

export default function KYCRevisionPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState("");

  // Form fields
  const [fullName, setFullName]           = useState("");
  const [phone, setPhone]                 = useState("");
  const [countryWork, setCountryWork]     = useState("");
  const [countryOrigin, setCountryOrigin] = useState("");
  const [idType, setIdType]               = useState("");
  const [idNumber, setIdNumber]           = useState("");
  const [idPhoto, setIdPhoto]             = useState<File | null>(null);
  const [businessPermit, setBusinessPermit] = useState<File | null>(null);

  useEffect(() => {
    fetch("/api/user/profile")
      .then((r) => r.json())
      .then((d) => {
        const p: Profile = d.profile;
        setProfile(p);
        // Pre-fill form
        setFullName(p.full_name ?? "");
        setPhone(p.phone_number ?? "");
        setCountryWork(p.country_of_work ?? "");
        setCountryOrigin(p.country_of_origin ?? "");
        setIdType(p.gov_id_type ?? "");
        setIdNumber(p.id_number ?? "");
      })
      .catch(() => setError("Failed to load your profile."))
      .finally(() => setLoading(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    setSubmitting(true);

    const data = new FormData();
    data.append("fullName",     fullName);
    data.append("phone",        phone);
    data.append("countryWork",  countryWork);
    data.append("countryOrigin",countryOrigin);
    data.append("idType",       idType);
    data.append("idNumber",     idNumber);
    if (idPhoto)        data.append("idPhoto",        idPhoto);
    if (businessPermit) data.append("businessPermit", businessPermit);

    try {
      const res = await fetch("/api/user/kyc/revise", { method: "PATCH", body: data });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Submission failed.");
      setSuccess(true);
      setTimeout(() => router.replace(profile?.role === "merchant" ? "/merchant" : "/"), 2500);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0e1014] flex items-center justify-center">
        <Loader size={22} className="animate-spin text-[#555]" />
      </div>
    );
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4">
        <div className="text-center max-w-sm">
          <div className="w-16 h-16 rounded-2xl bg-green-500/10 border border-green-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 size={28} className="text-green-400" />
          </div>
          <h2 className="text-white font-extrabold text-xl mb-2">Documents submitted!</h2>
          <p className="text-[#666] text-sm leading-relaxed">
            Your revised KYC documents have been submitted for admin review. Your status is now <span className="text-amber-400 font-semibold">Pending Review</span>.
          </p>
          <p className="text-[#444] text-xs mt-4">Redirecting you back to your dashboard…</p>
        </div>
      </div>
    );
  }

  const isMerchant = profile?.role === "merchant";

  return (
    <div className="min-h-screen bg-[#0e1014] px-4 py-10">
      <div className="w-full max-w-2xl mx-auto">

        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <button onClick={() => router.back()} className="text-[#555] hover:text-white transition-colors p-1">
            <ArrowLeft size={18} />
          </button>
          <div>
            <div className="flex items-center gap-2">
              <Image src="/logo.png" alt="RemitSafe" width={24} height={24} style={{ objectFit: "contain" }} />
              <span className="text-white font-extrabold text-lg">Revise KYC Documents</span>
            </div>
            <p className="text-[#555] text-xs mt-0.5">Update your information and re-upload your documents for admin review.</p>
          </div>
        </div>

        {/* Revision reason banner */}
        {profile?.kyc_rejection_reason && (
          <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl px-4 py-3.5 mb-6 flex items-start gap-3">
            <AlertTriangle size={16} className="text-orange-400 shrink-0 mt-0.5" />
            <div>
              <div className="text-orange-400 font-semibold text-sm mb-0.5">Admin requested changes</div>
              <div className="text-[#888] text-sm">{profile.kyc_rejection_reason}</div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-sm rounded-xl px-4 py-3 mb-5">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 space-y-6">

          {/* Personal info */}
          <div>
            <div className="text-[11px] font-bold text-[#DDE048] tracking-[1.5px] uppercase mb-4">Personal Information</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Full Name">
                <input className={inputCls} value={fullName} onChange={(e) => setFullName(e.target.value)}
                  placeholder="Juan Dela Cruz" required />
              </Field>
              <Field label="Phone Number">
                <input className={inputCls} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                  placeholder="+63 9XX XXX XXXX" required />
              </Field>
              <Field label="Country of Work">
                <select className={inputCls} value={countryWork} onChange={(e) => setCountryWork(e.target.value)} required>
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
              <Field label="Country of Origin">
                <select className={inputCls} value={countryOrigin} onChange={(e) => setCountryOrigin(e.target.value)} required>
                  <option value="">Select country</option>
                  {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
                </select>
              </Field>
            </div>
          </div>

          {/* Government ID */}
          <div>
            <div className="text-[11px] font-bold text-[#DDE048] tracking-[1.5px] uppercase mb-4">Government ID</div>
            <div className="grid sm:grid-cols-2 gap-4 mb-4">
              <Field label="ID Type">
                <select className={inputCls} value={idType} onChange={(e) => setIdType(e.target.value)} required>
                  <option value="">Select ID type</option>
                  {ID_TYPES.map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="ID Number">
                <input className={inputCls} value={idNumber} onChange={(e) => setIdNumber(e.target.value)}
                  placeholder="ID number" required />
              </Field>
            </div>
            <FilePicker
              label="Government ID Photo"
              file={idPhoto}
              existingUrl={profile?.gov_id_photo_url ?? null}
              onChange={setIdPhoto}
              onClear={() => setIdPhoto(null)}
            />
          </div>

          {/* Business permit — merchants only */}
          {isMerchant && (
            <div>
              <div className="text-[11px] font-bold text-[#DDE048] tracking-[1.5px] uppercase mb-4">Business Permit</div>
              <FilePicker
                label="Business Permit Upload"
                file={businessPermit}
                existingUrl={profile?.business_permit_url ?? null}
                onChange={setBusinessPermit}
                onClear={() => setBusinessPermit(null)}
              />
            </div>
          )}

          {/* Submit */}
          <div className="pt-2 border-t border-[#1e2230] flex gap-3">
            <button type="button" onClick={() => router.back()}
              className="flex-1 border border-[#1e2230] text-[#666] text-sm font-semibold py-3 rounded-xl hover:border-[#333] transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={submitting}
              className="flex-1 bg-[#DDE048] text-black font-extrabold text-sm py-3 rounded-xl hover:bg-[#c8ce30] transition-colors disabled:opacity-50 flex items-center justify-center gap-2">
              {submitting ? <><Loader size={15} className="animate-spin" /> Submitting…</> : <><CheckCircle2 size={15} /> Submit Revised Documents</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

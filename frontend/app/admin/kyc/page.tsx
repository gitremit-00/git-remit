"use client";
import { useEffect, useState, useMemo } from "react";
import {
  Check, X, AlertTriangle, Loader, ExternalLink, Search,
  ShieldCheck, ShieldX, Clock, RefreshCw,
} from "lucide-react";
import { type UserProfile, type KYCStatus } from "../../../lib/supabase";

// ─── types ───────────────────────────────────────────────────────────────────
type TabFilter = "all" | KYCStatus;
type RoleFilter = "all" | "sender" | "merchant";
type KYCAction = "approve" | "reject" | "needs_revision";

interface ConfirmState {
  userId: string;
  action: KYCAction;
  reason: string;
}

// ─── helpers ─────────────────────────────────────────────────────────────────
const STATUS_META: Record<KYCStatus, { label: string; color: string; bg: string; Icon: React.ElementType }> = {
  pending:        { label: "Pending",        color: "text-amber-400",  bg: "bg-amber-500/10 border-amber-500/20",   Icon: Clock         },
  verified:       { label: "Verified",       color: "text-green-400",  bg: "bg-green-500/10 border-green-500/20",   Icon: ShieldCheck   },
  rejected:       { label: "Rejected",       color: "text-red-400",    bg: "bg-red-500/10 border-red-500/20",       Icon: ShieldX       },
  needs_revision: { label: "Needs Revision", color: "text-orange-400", bg: "bg-orange-500/10 border-orange-500/20", Icon: AlertTriangle },
};

function KYCBadge({ status }: { status: KYCStatus }) {
  const { label, color, bg, Icon } = STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${color} ${bg}`}>
      <Icon size={11} /> {label}
    </span>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[10px] font-semibold text-[#444] uppercase tracking-[0.8px] mb-0.5">{label}</div>
      <div className="text-white text-sm">{value || "—"}</div>
    </div>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────
export default function KYCQueuePage() {
  const [all, setAll] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [tabFilter, setTabFilter] = useState<TabFilter>("all");
  const [roleFilter, setRoleFilter] = useState<RoleFilter>("all");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<UserProfile | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<{ text: string; ok: boolean } | null>(null);

  async function load(silent = false) {
    silent ? setRefreshing(true) : setLoading(true);
    try {
      const res = await fetch("/api/admin/kyc/users");
      if (res.ok) {
        const json = await res.json();
        setAll(json.users ?? []);
      }
    } catch {
      // swallow — table stays empty, user sees "no results"
    }
    silent ? setRefreshing(false) : setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function showToast(text: string, ok: boolean) {
    setToast({ text, ok });
    setTimeout(() => setToast(null), 3500);
  }

  const counts = useMemo(() => ({
    all:            all.length,
    pending:        all.filter((u) => u.kyc_status === "pending").length,
    verified:       all.filter((u) => u.kyc_status === "verified").length,
    rejected:       all.filter((u) => u.kyc_status === "rejected").length,
    needs_revision: all.filter((u) => u.kyc_status === "needs_revision").length,
  }), [all]);

  const filtered = useMemo(() => all.filter((u) => {
    if (tabFilter !== "all" && u.kyc_status !== tabFilter) return false;
    if (roleFilter !== "all" && u.role !== roleFilter) return false;
    if (query) {
      const q = query.toLowerCase();
      return (
        (u.name ?? "").toLowerCase().includes(q) ||
        (u.email ?? "").toLowerCase().includes(q) ||
        (u.username).toLowerCase().includes(q)
      );
    }
    return true;
  }), [all, tabFilter, roleFilter, query]);

  async function submitAction() {
    if (!confirm) return;
    setProcessing(true);
    try {
      const res = await fetch(`/api/admin/kyc/${confirm.userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: confirm.action, reason: confirm.reason }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Action failed.");

      const newStatus: KYCStatus =
        confirm.action === "approve" ? "verified" :
        confirm.action === "reject"  ? "rejected" : "needs_revision";

      setAll((prev) => prev.map((u) => u.id === confirm.userId ? { ...u, kyc_status: newStatus } : u));
      if (selected?.id === confirm.userId) setSelected((s) => s ? { ...s, kyc_status: newStatus } : s);
      showToast(
        confirm.action === "approve" ? "KYC approved — user is now Verified." :
        confirm.action === "reject"  ? "KYC rejected." : "Marked as Needs Revision.",
        true,
      );
    } catch (err) {
      showToast((err as Error).message, false);
    } finally {
      setProcessing(false);
      setConfirm(null);
    }
  }

  const TABS: { key: TabFilter; label: string }[] = [
    { key: "all",            label: "All"            },
    { key: "pending",        label: "Pending"        },
    { key: "verified",       label: "Verified"       },
    { key: "rejected",       label: "Rejected"       },
    { key: "needs_revision", label: "Needs Revision" },
  ];

  return (
    <div className="p-6 md:p-8 min-h-screen">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-5 right-5 z-50 flex items-center gap-2.5 px-4 py-3 rounded-xl border text-sm font-semibold shadow-2xl ${
          toast.ok ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-red-500/10 border-red-500/30 text-red-400"
        }`}>
          {toast.ok ? <Check size={14} /> : <X size={14} />} {toast.text}
        </div>
      )}

      {/* Page header */}
      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">KYC Review</h1>
          <p className="text-[#555] text-sm mt-0.5">Approve, reject, or request revisions for submitted documents.</p>
        </div>
        <button onClick={() => load(true)} disabled={refreshing}
          className="flex items-center gap-2 text-xs text-[#555] border border-[#1e2230] bg-[#13161c] px-3 py-2 rounded-xl hover:border-[#333] transition-colors disabled:opacity-50 shrink-0">
          <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {/* Tab filters */}
      <div className="flex flex-wrap gap-2 mb-4">
        {TABS.map(({ key, label }) => (
          <button key={key} onClick={() => setTabFilter(key)}
            className={`px-3.5 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
              tabFilter === key
                ? "bg-[#DDE048]/10 border-[#DDE048]/30 text-[#DDE048]"
                : "bg-[#13161c] border-[#1e2230] text-[#555] hover:border-[#333]"
            }`}>
            {label}
            <span className={`ml-1.5 ${tabFilter === key ? "text-[#DDE048]/60" : "text-[#3a3a3a]"}`}>
              {counts[key === "all" ? "all" : (key as KYCStatus)]}
            </span>
          </button>
        ))}
      </div>

      {/* Search + role filter */}
      <div className="flex gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#444]" />
          <input value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or username…"
            className="w-full bg-[#13161c] border border-[#1e2230] rounded-xl pl-9 pr-4 py-2.5 text-sm text-white outline-none focus:border-[#DDE048]/30 placeholder:text-[#333]"
          />
        </div>
        <select value={roleFilter} onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
          className="bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-2.5 text-sm text-[#888] outline-none focus:border-[#DDE048]/30">
          <option value="all">All Roles</option>
          <option value="sender">OFW / Sender</option>
          <option value="merchant">Merchant</option>
        </select>
      </div>

      {/* Users table */}
      {loading ? (
        <div className="flex items-center gap-2 text-[#555] text-sm py-16 justify-center">
          <Loader size={16} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-6 py-16 text-center">
          <ShieldCheck size={32} className="mx-auto mb-3 text-[#333]" />
          <div className="text-white font-semibold">No results</div>
          <div className="text-[#555] text-sm mt-1">Try adjusting the filters.</div>
        </div>
      ) : (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                {["User", "Email", "Role", "KYC Status", "Submitted", ""].map((h, i) => (
                  <th key={i} className={`text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 ${
                    i === 1 ? "hidden md:table-cell" : i === 4 ? "hidden lg:table-cell" : ""
                  }`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-[#1a1d23] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-xl bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#666] shrink-0">
                        {(u.name ?? u.username).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-semibold text-sm">{u.name ?? "—"}</div>
                        <div className="text-[#555] text-xs">@{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-[#666] text-xs hidden md:table-cell">{u.email ?? "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                      u.role === "merchant" ? "bg-purple-500/10 text-purple-400" : "bg-blue-500/10 text-blue-400"
                    }`}>
                      {u.role === "merchant" ? "Merchant" : "OFW"}
                    </span>
                  </td>
                  <td className="px-5 py-3"><KYCBadge status={u.kyc_status} /></td>
                  <td className="px-5 py-3 text-[#555] text-xs hidden lg:table-cell">
                    {new Date(u.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setSelected(u)}
                      className="text-xs text-[#DDE048] border border-[#DDE048]/20 px-3 py-1.5 rounded-xl hover:bg-[#DDE048]/10 transition-colors font-semibold">
                      Review
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Detail modal ────────────────────────────────────────────────────── */}
      {selected && (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/70 px-4 py-8 overflow-y-auto">
          <div className="w-full max-w-2xl bg-[#13161c] border border-[#1e2230] rounded-2xl shadow-2xl my-auto">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[#1e2230]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[#1e2230] flex items-center justify-center text-sm font-bold text-[#888]">
                  {(selected.name ?? selected.username).slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <div className="text-white font-extrabold">{selected.name ?? "—"}</div>
                  <div className="text-[#555] text-xs">@{selected.username} · {selected.email}</div>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <KYCBadge status={selected.kyc_status} />
                <button onClick={() => setSelected(null)} className="text-[#555] hover:text-white transition-colors ml-1">
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Details grid */}
            <div className="px-6 py-5 space-y-5">
              <div className="grid grid-cols-2 gap-x-8 gap-y-4">
                <Detail label="Full Name"         value={selected.name} />
                <Detail label="Email Address"     value={selected.email} />
                <Detail label="Phone Number"      value={selected.phone} />
                <Detail label="Role"              value={selected.role === "merchant" ? "Merchant" : "OFW / Sender"} />
                <Detail label="Country of Work"   value={selected.country_work} />
                <Detail label="Country of Origin" value={selected.country_origin} />
                <Detail label="Gov. ID Type"      value={selected.id_type} />
                <Detail label="ID Number"         value={selected.id_number} />
                {selected.role === "merchant" && (
                  <>
                    <Detail label="Business Name"    value={selected.business_name} />
                    <Detail label="Business Type"    value={selected.business_type} />
                    <Detail label="Business Address" value={selected.business_address} />
                    <Detail label="City"             value={selected.city} />
                  </>
                )}
              </div>

              {/* Documents — inline preview */}
              {(selected.id_photo_url || selected.permit_url) && (
                <div className="space-y-3">
                  <div className="text-[10px] font-semibold text-[#444] uppercase tracking-[0.8px]">Submitted Documents</div>
                  <div className={`grid gap-3 ${selected.permit_url && selected.id_photo_url ? "grid-cols-2" : "grid-cols-1"}`}>
                    {selected.id_photo_url && (
                      <DocPreview label="Government ID" url={selected.id_photo_url} />
                    )}
                    {selected.permit_url && (
                      <DocPreview label="Business Permit" url={selected.permit_url} />
                    )}
                  </div>
                </div>
              )}

              {/* Existing reason */}
              {selected.kyc_rejection_reason && (
                <div className="bg-[#1a0a0a] border border-red-500/20 rounded-xl px-4 py-3">
                  <div className="text-[11px] font-semibold text-red-400 uppercase tracking-[0.8px] mb-1">Reason on file</div>
                  <div className="text-[#888] text-sm">{selected.kyc_rejection_reason}</div>
                </div>
              )}
            </div>

            {/* Action buttons */}
            <div className="px-6 py-4 border-t border-[#1e2230] flex gap-2 flex-wrap">
              <button onClick={() => setConfirm({ userId: selected.id, action: "approve", reason: "" })}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 font-semibold text-sm py-2.5 rounded-xl hover:bg-green-500/20 transition-colors">
                <Check size={14} /> Approve KYC
              </button>
              <button onClick={() => setConfirm({ userId: selected.id, action: "needs_revision", reason: "" })}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 bg-orange-500/10 border border-orange-500/30 text-orange-400 font-semibold text-sm py-2.5 rounded-xl hover:bg-orange-500/20 transition-colors">
                <AlertTriangle size={14} /> Needs Revision
              </button>
              <button onClick={() => setConfirm({ userId: selected.id, action: "reject", reason: "" })}
                className="flex-1 min-w-[120px] flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-sm py-2.5 rounded-xl hover:bg-red-500/20 transition-colors">
                <X size={14} /> Reject KYC
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Confirm dialog ───────────────────────────────────────────────────── */}
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 px-4">
          <div className="w-full max-w-sm bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 shadow-2xl">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-4 ${
              confirm.action === "approve" ? "bg-green-500/10 border border-green-500/20" :
              confirm.action === "reject"  ? "bg-red-500/10 border border-red-500/20" :
                                            "bg-orange-500/10 border border-orange-500/20"
            }`}>
              {confirm.action === "approve" ? <Check size={22} className="text-green-400" /> :
               confirm.action === "reject"  ? <X size={22} className="text-red-400" /> :
                                              <AlertTriangle size={22} className="text-orange-400" />}
            </div>
            <h3 className="text-white font-extrabold text-lg text-center mb-1">
              {confirm.action === "approve" ? "Approve KYC?" :
               confirm.action === "reject"  ? "Reject KYC?" : "Request Revision?"}
            </h3>
            <p className="text-[#555] text-sm text-center mb-5 leading-relaxed">
              {confirm.action === "approve"
                ? "This user will be marked as Verified and gain full platform access. This cannot be undone without a manual update."
                : confirm.action === "reject"
                ? "The user's KYC will be rejected. Provide a reason so the user understands what went wrong."
                : "Ask the user to re-upload or correct their documents. They will see your reason."}
            </p>

            {confirm.action !== "approve" && (
              <div className="mb-4">
                <label className="text-xs text-[#555] font-semibold block mb-1.5">
                  Reason <span className="text-red-400">*</span>
                </label>
                <textarea autoFocus rows={3} value={confirm.reason}
                  onChange={(e) => setConfirm({ ...confirm, reason: e.target.value })}
                  placeholder={
                    confirm.action === "reject"
                      ? "e.g. Document is expired or not clearly legible."
                      : "e.g. Please re-upload a clearer photo of your government ID."
                  }
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/30 placeholder:text-[#333] resize-none"
                />
              </div>
            )}

            <div className="flex gap-2">
              <button onClick={() => setConfirm(null)} disabled={processing}
                className="flex-1 border border-[#1e2230] text-[#666] text-sm font-semibold py-2.5 rounded-xl hover:border-[#333] transition-colors disabled:opacity-50">
                Cancel
              </button>
              <button onClick={submitAction}
                disabled={processing || (confirm.action !== "approve" && !confirm.reason.trim())}
                className={`flex-1 flex items-center justify-center gap-2 text-sm font-extrabold py-2.5 rounded-xl transition-colors disabled:opacity-50 ${
                  confirm.action === "approve" ? "bg-green-500 text-black hover:bg-green-400" :
                  confirm.action === "reject"  ? "bg-red-500/80 text-white hover:bg-red-500" :
                                                 "bg-orange-500/80 text-white hover:bg-orange-500"
                }`}>
                {processing && <Loader size={14} className="animate-spin" />}
                {confirm.action === "approve" ? "Confirm Approve" :
                 confirm.action === "reject"  ? "Confirm Reject" : "Send Revision Request"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── document lightbox + preview ─────────────────────────────────────────────
function isPdf(url: string) {
  return url.toLowerCase().includes(".pdf") || url.toLowerCase().includes("application%2Fpdf");
}

function bucketFromUrl(url: string): string {
  if (url.includes("government-ids")) return "government-ids";
  if (url.includes("business-permits")) return "business-permits";
  return "avatars";
}

function pathFromUrl(url: string): string {
  // Supabase public/signed URL format: .../storage/v1/object/public/<bucket>/<path>
  const match = url.match(/\/object\/(?:public|sign)\/[^/]+\/(.+?)(?:\?|$)/);
  return match ? decodeURIComponent(match[1]) : "";
}

async function fetchSignedUrl(storageUrl: string): Promise<string> {
  const bucket = bucketFromUrl(storageUrl);
  const path = pathFromUrl(storageUrl);
  if (!path) return storageUrl; // fallback to original if parsing fails
  const res = await fetch("/api/admin/signed-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ bucket, path }),
  });
  if (!res.ok) return storageUrl;
  const { url } = await res.json();
  return url ?? storageUrl;
}

function DocPreview({ label, url }: { label: string; url: string }) {
  const [lightbox, setLightbox] = useState(false);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [loadingUrl, setLoadingUrl] = useState(false);
  const pdf = isPdf(url);

  async function open() {
    setLightbox(true);
    if (!signedUrl) {
      setLoadingUrl(true);
      const resolved = await fetchSignedUrl(url);
      setSignedUrl(resolved);
      setLoadingUrl(false);
    }
  }

  const displayUrl = signedUrl ?? url;

  return (
    <>
      {/* Thumbnail card */}
      <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl overflow-hidden">
        <div className="flex items-center justify-between px-3 py-2 border-b border-[#1e2230]">
          <span className="text-[11px] font-semibold text-[#555] uppercase tracking-[0.8px]">{label}</span>
          <button
            onClick={open}
            className="flex items-center gap-1 text-[11px] text-[#DDE048] hover:text-[#DDE048]/70 transition-colors font-semibold"
          >
            <ExternalLink size={11} /> View
          </button>
        </div>

        <button onClick={open} className="w-full text-left focus:outline-none group">
          {pdf ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-[#555] group-hover:text-[#888] transition-colors">
              <ExternalLink size={20} />
              <span className="text-xs font-semibold">Click to view PDF</span>
            </div>
          ) : (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img
              src={url}
              alt={label}
              className="w-full object-contain bg-[#0e1014] group-hover:opacity-80 transition-opacity"
              style={{ maxHeight: 200 }}
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = "none";
                (e.currentTarget.nextElementSibling as HTMLElement | null)?.removeAttribute("hidden");
              }}
            />
          )}
          <p hidden className="text-xs text-[#555] text-center py-4 px-3">
            Click to view document
          </p>
        </button>
      </div>

      {/* Lightbox modal */}
      {lightbox && (
        <div className="fixed inset-0 z-[60] flex flex-col bg-black/95" onClick={() => setLightbox(false)}>
          {/* Header */}
          <div
            className="flex items-center justify-between px-5 py-3 border-b border-white/10 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="text-white font-semibold text-sm">{label}</span>
            <div className="flex items-center gap-3">
              {signedUrl && (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-xs text-[#DDE048] border border-[#DDE048]/20 px-3 py-1.5 rounded-xl hover:bg-[#DDE048]/10 transition-colors font-semibold"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={12} /> Open in new tab
                </a>
              )}
              <button
                onClick={() => setLightbox(false)}
                className="text-[#666] hover:text-white transition-colors p-1"
              >
                <X size={20} />
              </button>
            </div>
          </div>

          {/* Content */}
          <div
            className="flex-1 flex items-center justify-center p-4 overflow-auto"
            onClick={() => setLightbox(false)}
          >
            {loadingUrl ? (
              <div className="flex flex-col items-center gap-3 text-[#555]">
                <Loader size={24} className="animate-spin" />
                <span className="text-sm">Loading secure document…</span>
              </div>
            ) : pdf ? (
              <iframe
                src={displayUrl}
                className="w-full max-w-4xl rounded-xl border border-white/10"
                style={{ height: "calc(100vh - 100px)" }}
                title={label}
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              /* eslint-disable-next-line @next/next/no-img-element */
              <img
                src={displayUrl}
                alt={label}
                className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              />
            )}
          </div>

          <p className="text-center text-[#333] text-xs pb-3 shrink-0">Click anywhere outside to close</p>
        </div>
      )}
    </>
  );
}

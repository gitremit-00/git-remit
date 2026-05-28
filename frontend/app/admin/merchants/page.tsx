"use client";
import { useEffect, useState } from "react";
import { Loader, Search, ShieldCheck, ShieldX, Clock, AlertTriangle } from "lucide-react";
import { type UserProfile, type KYCStatus } from "../../../lib/supabase";
import Link from "next/link";

const KYC_STYLES: Record<KYCStatus, { label: string; cls: string; Icon: React.ElementType }> = {
  pending:        { label: "Pending",        cls: "bg-amber-500/10 text-amber-400 border-amber-500/20",    Icon: Clock         },
  verified:       { label: "Verified",       cls: "bg-green-500/10 text-green-400 border-green-500/20",    Icon: ShieldCheck   },
  rejected:       { label: "Rejected",       cls: "bg-red-500/10 text-red-400 border-red-500/20",          Icon: ShieldX       },
  needs_revision: { label: "Needs Revision", cls: "bg-orange-500/10 text-orange-400 border-orange-500/20", Icon: AlertTriangle },
};

function KYCBadge({ status }: { status: KYCStatus }) {
  const { label, cls, Icon } = KYC_STYLES[status] ?? KYC_STYLES.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      <Icon size={10} /> {label}
    </span>
  );
}

export default function AdminMerchants() {
  const [merchants, setMerchants] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/admin/kyc/users?role=merchant&status=all")
      .then((r) => r.json())
      .then((d) => setMerchants(d.users ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = merchants.filter((m) =>
    !query ||
    (m.business_name ?? "").toLowerCase().includes(query.toLowerCase()) ||
    (m.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
    (m.email ?? "").toLowerCase().includes(query.toLowerCase()) ||
    m.username.toLowerCase().includes(query.toLowerCase()) ||
    (m.city ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">Merchants</h1>
      <p className="text-[#555] text-sm mb-6">All registered merchant accounts.</p>

      <div className="relative mb-5">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by business name, owner, email, or city…"
          className="w-full bg-[#13161c] border border-[#1e2230] rounded-xl pl-10 pr-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 placeholder:text-[#333]"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#555] text-sm"><Loader size={14} className="animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-[#555] text-sm">No merchants found.</div>
      ) : (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">Business</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden md:table-cell">Owner / Email</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden lg:table-cell">City</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">KYC Status</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden md:table-cell">Joined</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {filtered.map((m) => (
                <tr key={m.id} className="hover:bg-[#1a1d23] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center text-[10px] font-bold text-[#888] shrink-0">
                        {(m.business_name ?? m.name ?? m.username).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{m.business_name ?? "—"}</div>
                        <div className="text-[#555] text-xs">{m.business_type ?? "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    <div className="text-white text-sm">{m.name ?? "—"}</div>
                    <div className="text-[#555] text-xs">{m.email ?? "—"}</div>
                  </td>
                  <td className="px-5 py-3 hidden lg:table-cell text-[#888]">{m.city ?? "—"}</td>
                  <td className="px-5 py-3">
                    <KYCBadge status={m.kyc_status} />
                    {(m.kyc_status === "rejected" || m.kyc_status === "needs_revision") && m.kyc_rejection_reason && (
                      <div className="text-[10px] text-red-400 mt-0.5 max-w-[200px] truncate">{m.kyc_rejection_reason}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-[#555] text-xs">
                    {new Date(m.created_at).toLocaleDateString()}
                  </td>
                  <td className="px-5 py-3 text-right">
                    <Link href="/admin/kyc"
                      className="text-xs text-[#DDE048] border border-[#DDE048]/20 px-2.5 py-1 rounded-xl hover:bg-[#DDE048]/10 transition-colors font-semibold">
                      Review
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

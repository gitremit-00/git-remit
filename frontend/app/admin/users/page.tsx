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

export default function AdminUsers() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    fetch("/api/admin/kyc/users?role=ofw_sender&status=all")
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = users.filter((u) =>
    !query ||
    (u.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
    (u.email ?? "").toLowerCase().includes(query.toLowerCase()) ||
    u.username.toLowerCase().includes(query.toLowerCase()) ||
    (u.country_work ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">OFW Senders</h1>
      <p className="text-[#555] text-sm mb-6">All registered sender accounts.</p>

      <div className="relative mb-5">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          value={query} onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by name, email, username, or country…"
          className="w-full bg-[#13161c] border border-[#1e2230] rounded-xl pl-10 pr-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 placeholder:text-[#333]"
        />
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#555] text-sm"><Loader size={14} className="animate-spin" /> Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="text-[#555] text-sm">No senders found.</div>
      ) : (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">Name</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden md:table-cell">Email</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden lg:table-cell">Country of Work</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">KYC Status</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden md:table-cell">Joined</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {filtered.map((u) => (
                <tr key={u.id} className="hover:bg-[#1a1d23] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center text-[10px] font-bold text-[#888] shrink-0">
                        {(u.name ?? u.username).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{u.name ?? "—"}</div>
                        <div className="text-[#555] text-xs">@{u.username}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-[#666] text-xs">{u.email ?? "—"}</td>
                  <td className="px-5 py-3 hidden lg:table-cell text-[#888]">{u.country_work ?? "—"}</td>
                  <td className="px-5 py-3">
                    <KYCBadge status={u.kyc_status} />
                    {(u.kyc_status === "rejected" || u.kyc_status === "needs_revision") && u.kyc_rejection_reason && (
                      <div className="text-[10px] text-red-400 mt-0.5 max-w-[200px] truncate">{u.kyc_rejection_reason}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-[#555] text-xs">
                    {new Date(u.created_at).toLocaleDateString()}
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

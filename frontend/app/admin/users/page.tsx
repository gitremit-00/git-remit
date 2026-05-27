"use client";
import { useEffect, useState } from "react";
import { Loader, Search } from "lucide-react";
import { getAllSenders, UserProfile } from "../../../lib/supabase";

const KYC_COLORS: Record<string, string> = {
  approved: "bg-green-500/10 text-green-400",
  pending: "bg-amber-500/10 text-amber-400",
  rejected: "bg-red-500/10 text-red-400",
};

export default function AdminUsers() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getAllSenders().then((data) => { setUsers(data); setLoading(false); });
  }, []);

  const filtered = users.filter((u) =>
    !query || (u.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
    u.wallet_address.toLowerCase().includes(query.toLowerCase()) ||
    (u.country_work ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">OFW Senders</h1>
      <p className="text-[#555] text-sm mb-6">All registered sender accounts.</p>

      <div className="relative mb-5">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by name, wallet, or country…"
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
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3">NAME</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3 hidden md:table-cell">WALLET</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3 hidden lg:table-cell">COUNTRY OF WORK</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3">KYC STATUS</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3 hidden md:table-cell">JOINED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2230]">
              {filtered.map((u) => (
                <tr key={u.wallet_address} className="hover:bg-[#1a1d23] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center text-[10px] font-bold text-[#888] shrink-0">
                        {(u.name || u.wallet_address).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{u.name || "—"}</div>
                        <div className="text-[#555] text-xs">{u.phone || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    <span className="font-mono text-xs text-[#888]">{u.wallet_address.slice(0, 8)}…{u.wallet_address.slice(-6)}</span>
                  </td>
                  <td className="px-5 py-3 hidden lg:table-cell text-[#888]">{u.country_work || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${KYC_COLORS[u.kyc_status] ?? "text-[#555]"}`}>
                      {u.kyc_status ?? "—"}
                    </span>
                    {u.kyc_status === "rejected" && u.kyc_reject_reason && (
                      <div className="text-[10px] text-red-400 mt-0.5 max-w-[200px] truncate">{u.kyc_reject_reason}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-[#555] text-xs">{new Date(u.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

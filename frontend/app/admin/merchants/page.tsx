"use client";
import { useEffect, useState } from "react";
import { Loader, Search } from "lucide-react";
import { getAllMerchants, UserProfile } from "../../../lib/supabase";

const KYC_COLORS: Record<string, string> = {
  approved: "bg-green-500/10 text-green-400",
  pending: "bg-amber-500/10 text-amber-400",
  rejected: "bg-red-500/10 text-red-400",
};

export default function AdminMerchants() {
  const [merchants, setMerchants] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");

  useEffect(() => {
    getAllMerchants().then((data) => { setMerchants(data); setLoading(false); });
  }, []);

  const filtered = merchants.filter((m) =>
    !query ||
    (m.business_name ?? "").toLowerCase().includes(query.toLowerCase()) ||
    (m.owner_name ?? "").toLowerCase().includes(query.toLowerCase()) ||
    m.wallet_address.toLowerCase().includes(query.toLowerCase()) ||
    (m.city ?? "").toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">Merchants</h1>
      <p className="text-[#555] text-sm mb-6">All registered merchant accounts.</p>

      <div className="relative mb-5">
        <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555]" />
        <input
          value={query} onChange={e => setQuery(e.target.value)}
          placeholder="Search by business, owner, wallet, or city…"
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
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3">BUSINESS</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3 hidden md:table-cell">WALLET</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3 hidden lg:table-cell">CITY</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3">KYC STATUS</th>
                <th className="text-left text-[#555] font-medium text-xs tracking-[0.5px] px-5 py-3 hidden md:table-cell">JOINED</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e2230]">
              {filtered.map((m) => (
                <tr key={m.wallet_address} className="hover:bg-[#1a1d23] transition-colors">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center text-[10px] font-bold text-[#888] shrink-0">
                        {(m.business_name || m.wallet_address).slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <div className="text-white font-medium">{m.business_name || "—"}</div>
                        <div className="text-[#555] text-xs">{m.business_type || m.owner_name || "—"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell">
                    <span className="font-mono text-xs text-[#888]">{m.wallet_address.slice(0, 8)}…{m.wallet_address.slice(-6)}</span>
                  </td>
                  <td className="px-5 py-3 hidden lg:table-cell text-[#888]">{m.city || "—"}</td>
                  <td className="px-5 py-3">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${KYC_COLORS[m.kyc_status] ?? "text-[#555]"}`}>
                      {m.kyc_status ?? "—"}
                    </span>
                    {m.kyc_status === "rejected" && m.kyc_reject_reason && (
                      <div className="text-[10px] text-red-400 mt-0.5 max-w-[200px] truncate">{m.kyc_reject_reason}</div>
                    )}
                  </td>
                  <td className="px-5 py-3 hidden md:table-cell text-[#555] text-xs">{new Date(m.created_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

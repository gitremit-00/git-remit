"use client";
import { useEffect, useState } from "react";
import { Check, X, ChevronDown, ChevronUp, Loader, ExternalLink } from "lucide-react";
import { getKYCQueue, approveKYC, rejectKYC, UserProfile } from "../../../lib/supabase";

export default function KYCQueue() {
  const [queue, setQueue] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState<Record<string, string>>({});
  const [showRejectInput, setShowRejectInput] = useState<string | null>(null);
  const [processing, setProcessing] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const data = await getKYCQueue();
    setQueue(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleApprove(wallet: string) {
    setProcessing(wallet);
    await approveKYC(wallet);
    setQueue((q) => q.filter((u) => u.wallet_address !== wallet));
    setProcessing(null);
  }

  async function handleReject(wallet: string) {
    const reason = rejectReason[wallet]?.trim();
    if (!reason) { setShowRejectInput(wallet); return; }
    setProcessing(wallet);
    await rejectKYC(wallet, reason);
    setQueue((q) => q.filter((u) => u.wallet_address !== wallet));
    setProcessing(null);
    setShowRejectInput(null);
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">KYC Queue</h1>
      <p className="text-[#555] text-sm mb-6">Review submitted documents and approve or reject accounts.</p>

      {loading ? (
        <div className="flex items-center gap-2 text-[#555] text-sm"><Loader size={14} className="animate-spin" /> Loading…</div>
      ) : queue.length === 0 ? (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-6 py-12 text-center">
          <div className="text-4xl mb-3">✓</div>
          <div className="text-white font-semibold">All clear!</div>
          <div className="text-[#555] text-sm mt-1">No pending KYC applications.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map((user) => {
            const isOpen = expanded === user.wallet_address;
            const isProcessing = processing === user.wallet_address;
            const showReject = showRejectInput === user.wallet_address;

            return (
              <div key={user.wallet_address} className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
                {/* Header row */}
                <button
                  onClick={() => setExpanded(isOpen ? null : user.wallet_address)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#1a1d23] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888] shrink-0">
                      {(user.name || user.wallet_address).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-white font-semibold text-sm truncate">{user.name || "—"}</div>
                      <div className="text-[#555] text-xs font-mono">{user.wallet_address.slice(0, 10)}…{user.wallet_address.slice(-6)}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0 ml-4">
                    <span className={`text-[11px] font-semibold px-2.5 py-1 rounded-full ${
                      user.role === "sender" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
                    }`}>
                      {user.role === "sender" ? "OFW" : "Merchant"}
                    </span>
                    <span className="text-[#555] text-xs">{new Date(user.created_at).toLocaleDateString()}</span>
                    {isOpen ? <ChevronUp size={14} color="#555" /> : <ChevronDown size={14} color="#555" />}
                  </div>
                </button>

                {/* Expanded details */}
                {isOpen && (
                  <div className="border-t border-[#1e2230] px-5 py-4 space-y-4">
                    <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
                      {user.role === "sender" ? (
                        <>
                          <Detail label="Full Name" value={user.name} />
                          <Detail label="Phone" value={user.phone} />
                          <Detail label="Country of Work" value={user.country_work} />
                          <Detail label="Country of Origin" value={user.country_origin} />
                          <Detail label="ID Type" value={user.id_type} />
                          <Detail label="ID Number" value={user.id_number} />
                        </>
                      ) : (
                        <>
                          <Detail label="Business Name" value={user.business_name} />
                          <Detail label="Business Type" value={user.business_type} />
                          <Detail label="Owner" value={user.owner_name} />
                          <Detail label="Phone" value={user.phone} />
                          <Detail label="Address" value={user.business_address} />
                          <Detail label="City" value={user.city} />
                          <Detail label="ID Type" value={user.id_type} />
                          <Detail label="ID Number" value={user.id_number} />
                        </>
                      )}
                    </div>

                    {/* Document links */}
                    <div className="flex gap-2 flex-wrap">
                      {user.id_photo_url && (
                        <a href={user.id_photo_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-[#DDE048] border border-[#DDE048]/30 px-3 py-1.5 rounded-xl hover:bg-[#DDE048]/10 transition-colors">
                          <ExternalLink size={12} /> View Gov. ID
                        </a>
                      )}
                      {user.permit_url && (
                        <a href={user.permit_url} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1.5 text-xs text-[#DDE048] border border-[#DDE048]/30 px-3 py-1.5 rounded-xl hover:bg-[#DDE048]/10 transition-colors">
                          <ExternalLink size={12} /> View Business Permit
                        </a>
                      )}
                    </div>

                    {/* Reject reason input */}
                    {showReject && (
                      <div>
                        <label className="text-xs text-[#555] block mb-1.5">Rejection reason (required)</label>
                        <input
                          autoFocus
                          value={rejectReason[user.wallet_address] ?? ""}
                          onChange={e => setRejectReason({ ...rejectReason, [user.wallet_address]: e.target.value })}
                          placeholder="e.g. Document is blurry or expired"
                          className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-red-500/40 placeholder:text-[#333]"
                        />
                      </div>
                    )}

                    {/* Action buttons */}
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleApprove(user.wallet_address)}
                        disabled={!!isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 bg-green-500/10 border border-green-500/30 text-green-400 font-semibold text-sm py-2.5 rounded-xl hover:bg-green-500/20 transition-colors disabled:opacity-50"
                      >
                        {isProcessing ? <Loader size={14} className="animate-spin" /> : <Check size={14} />}
                        Approve
                      </button>
                      <button
                        onClick={() => handleReject(user.wallet_address)}
                        disabled={!!isProcessing}
                        className="flex-1 flex items-center justify-center gap-2 bg-red-500/10 border border-red-500/30 text-red-400 font-semibold text-sm py-2.5 rounded-xl hover:bg-red-500/20 transition-colors disabled:opacity-50"
                      >
                        {isProcessing ? <Loader size={14} className="animate-spin" /> : <X size={14} />}
                        {showReject ? "Confirm Reject" : "Reject"}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Detail({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div className="text-[#555] text-xs">{label}</div>
      <div className="text-white text-sm mt-0.5">{value || "—"}</div>
    </div>
  );
}

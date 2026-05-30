"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Clock, CheckCircle2, XCircle, RefreshCw, ChevronRight, FileText, Store } from "lucide-react";
import Header from "../../../components/Header";
import KYCGate from "../../../components/KYCGate";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { useWallet } from "../../../context/WalletContext";
import { getSenderTransferRequests, type TransferRequest } from "../../../lib/supabase";
import { getPledgeMeta, getAllMeta } from "../../../lib/pledgeMeta";

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }
function fmtDate(s: string) { return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtTime(s: string) { return new Date(s).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }

// Resolve a merchant's display name from locally-saved metadata (keyed by uuid)
function buildUuidNameMap(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const meta of Object.values(getAllMeta())) {
    if (meta.uuid && meta.name) out[meta.uuid.toLowerCase()] = meta.name;
  }
  return out;
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Request",
  renegotiating: "Renegotiating",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  confirmed: "Confirmed",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "#f59e0b",
  renegotiating: "#60a5fa",
  accepted: "#22c55e",
  rejected: "#ef4444",
  cancelled: "#888",
  confirmed: "#22c55e",
};
const STATUS_BG: Record<string, string> = {
  pending: "#f59e0b22",
  renegotiating: "#60a5fa22",
  accepted: "#22c55e22",
  rejected: "#ef444422",
  cancelled: "#88888822",
  confirmed: "#22c55e22",
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock size={13} color="#f59e0b" />,
  renegotiating: <RefreshCw size={13} color="#60a5fa" />,
  accepted: <CheckCircle2 size={13} color="#22c55e" />,
  rejected: <XCircle size={13} color="#ef4444" />,
  cancelled: <XCircle size={13} color="#888" />,
  confirmed: <CheckCircle2 size={13} color="#22c55e" />,
};

const FILTERS = ["ALL", "pending", "renegotiating", "accepted", "cancelled", "confirmed"];

function termsSummary(r: TransferRequest) {
  if (r.type === "installment") {
    const amt = r.amount_per_period?.toFixed(2) ?? "—";
    return `${amt} ${r.token} × ${r.total_periods ?? "?"} payments`;
  }
  return `${r.total_amount?.toFixed(2) ?? "—"} ${r.token}`;
}

export default function SenderRequests() {
  const { account, connect, walletLoading } = useWallet();
  const [requests, setRequests] = useState<TransferRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");

  useEffect(() => { if (account) loadData(); }, [account]);

  async function loadData() {
    setLoading(true);
    try {
      const data = await getSenderTransferRequests(account!);
      // Only keep merchant-request-flow rows. Direct P2P sends and merchant full
      // payments are also stored as transfer_requests (status "confirmed" with an
      // empty pledge_id) — those are completed transactions shown on My Transfers,
      // not requests sent to a merchant for review, so exclude them here.
      const onlyRequests = data.filter(r => !(r.status === "confirmed" && !r.pledge_id));
      setRequests(onlyRequests);
    } finally { setLoading(false); }
  }

  const filtered = filter === "ALL" ? requests : requests.filter(r => r.status === filter);
  const counts: Record<string, number> = { ALL: requests.length };
  requests.forEach(r => { counts[r.status] = (counts[r.status] ?? 0) + 1; });

  const uuidNames = buildUuidNameMap();
  const merchantName = (uuid: string) => uuidNames[uuid.toLowerCase()] ?? getPledgeMeta(uuid)?.name ?? null;

  const awaiting = (counts["pending"] ?? 0) + (counts["renegotiating"] ?? 0);
  const stats = [
    { label: "TOTAL", value: requests.length, color: "#fff" },
    { label: "AWAITING REVIEW", value: awaiting, color: "#f59e0b" },
    { label: "ACCEPTED", value: counts["accepted"] ?? 0, color: "#22c55e" },
    { label: "CONFIRMED", value: counts["confirmed"] ?? 0, color: "#22c55e" },
  ];

  const DesktopView = (
    <div className="hidden md:block p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/pledges" className="flex items-center gap-1 text-[#555] text-sm hover:text-[#888] transition-colors">
          <ArrowLeft size={14} /> My Transfers
        </Link>
        <span className="text-[#333]">/</span>
        <span className="text-white font-semibold text-sm">My Requests</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-1">My Requests</h1>
          <p className="text-[#555] text-sm">Requests you have sent to merchants, awaiting their review.</p>
        </div>
        <Link href="/new-transfer" className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors">
          + New Transfer
        </Link>
      </div>

      {/* Summary stats */}
      {account && requests.length > 0 && (
        <div className="grid grid-cols-4 gap-4 mb-6">
          {stats.map((s) => (
            <div key={s.label} className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-1">{s.label}</div>
              <div className="text-2xl font-extrabold" style={{ color: s.color }}>{s.value}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              filter === f ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-transparent border-[#1e2230] text-[#555] hover:text-[#888]"
            }`}
          >
            {f === "ALL" ? "All" : STATUS_LABEL[f]}
            {counts[f] > 0 && (
              <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${filter === f ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#555]"}`}>
                {counts[f]}
              </span>
            )}
          </button>
        ))}
      </div>

      {!account ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="font-bold text-white mb-1.5">Wallet not connected</div>
          <button onClick={connect} className="mt-3 bg-[#DDE048] text-black font-bold rounded-xl px-6 py-2.5 text-sm">Connect Wallet</button>
        </div>
      ) : loading ? <LoadingSpinner /> : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={32} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">No requests yet</div>
          <div className="text-[#555] text-sm mb-4">Your transfer requests to merchants will appear here.</div>
          <Link href="/new-transfer" className="bg-[#DDE048] text-black font-bold rounded-xl px-6 py-2.5 text-sm">Send a Request</Link>
        </div>
      ) : (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                {["MERCHANT", "TYPE", "AMOUNT / TERMS", "STATUS", "SENT", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] tracking-[1.5px] font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => {
                return (
                  <tr key={r.id} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0">
                          <Store size={15} color="#555" />
                        </div>
                        <div>
                          <div className="font-semibold text-white text-xs">{merchantName(r.merchant_address) || shortAddr(r.merchant_address)}</div>
                          <div className="text-[10px] text-[#555] font-mono">{shortAddr(r.merchant_address)}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 text-[#888] text-xs capitalize">{r.type}</td>
                    <td className="px-5 py-4 font-bold text-white text-xs">{termsSummary(r)}</td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full w-fit"
                        style={{ color: STATUS_COLOR[r.status], background: STATUS_BG[r.status] }}>
                        {STATUS_ICON[r.status]} {STATUS_LABEL[r.status]}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#555] text-xs">
                      <div>{fmtDate(r.created_at)}</div>
                      <div className="text-[10px] text-[#444] mt-0.5">{fmtTime(r.created_at)}</div>
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/pledges/requests/${r.id}`}
                        className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline flex items-center gap-0.5">
                        View <ChevronRight size={13} />
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const MobileView = (
    <div className="md:hidden min-h-screen">
      <Header title="My Requests" back />
      <div className="px-4 pt-4 pb-[120px]">
        <p className="text-[#888] text-[13px] mb-4">Requests you have sent to merchants, awaiting their review.</p>
        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-hide">
          {FILTERS.map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                filter === f ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "border-[#1F2127] text-[#555]"
              }`}
            >
              {f === "ALL" ? "All" : STATUS_LABEL[f]} {counts[f] ? `(${counts[f]})` : ""}
            </button>
          ))}
        </div>

        {!account && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="font-bold mb-2">Wallet not connected</div>
            <button onClick={connect} className="bg-[#DDE048] text-black font-bold rounded-xl px-6 py-3 text-sm">Connect Wallet</button>
          </div>
        )}
        {loading && <LoadingSpinner />}
        {!loading && account && filtered.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText size={28} color="#333" className="mb-3" />
            <div className="font-bold mb-1">No requests yet</div>
            <div className="text-[#888] text-sm mb-4">Requests you send to merchants appear here</div>
            <Link href="/new-transfer" className="bg-[#DDE048] text-black font-bold rounded-xl px-5 py-2.5 text-sm">Send a Request</Link>
          </div>
        )}
        {filtered.map((r) => {
          return (
            <Link key={r.id} href={`/pledges/requests/${r.id}`} className="block no-underline text-inherit">
              <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0">
                      <Store size={17} color="#555" />
                    </div>
                    <div>
                      <div className="font-semibold text-white text-sm">{merchantName(r.merchant_address) || shortAddr(r.merchant_address)}</div>
                      <div className="text-[11px] text-[#555] capitalize">{r.type} · {r.token}</div>
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
                    style={{ color: STATUS_COLOR[r.status], background: STATUS_BG[r.status] }}>
                    {STATUS_ICON[r.status]} {STATUS_LABEL[r.status]}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-lg font-extrabold text-white">{termsSummary(r)}</div>
                    <div className="text-xs text-[#666] mt-0.5">Sent {fmtDate(r.created_at)} · {fmtTime(r.created_at)}</div>
                  </div>
                  <span className="flex items-center gap-0.5 text-[#DDE048] text-xs font-semibold">View <ChevronRight size={13} /></span>
                </div>
              </div>
            </Link>
          );
        })}

        {!walletLoading && account && (
          <Link href="/new-transfer" className="fixed bottom-24 right-4 bg-[#DDE048] text-black font-bold text-sm rounded-full px-5 py-3 shadow-lg">
            + New Request
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <KYCGate featureName="Payment Requests">
      {DesktopView}
      {MobileView}
    </KYCGate>
  );
}

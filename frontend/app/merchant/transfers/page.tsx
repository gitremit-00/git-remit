"use client";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Search, ArrowLeft, Clock, CheckCircle2, AlertCircle, XCircle, ChevronRight, ShieldCheck, RefreshCw, FileText } from "lucide-react";
import Header from "../../../components/Header";
import KYCGate from "../../../components/KYCGate";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { useWallet } from "../../../context/WalletContext";

import { getPledgeMeta } from "../../../lib/pledgeMeta";
import { CONTRACTS } from "../../../contracts/addresses";
import { getMerchantTransferRequests, type TransferRequest } from "../../../lib/supabase";

interface PledgeRaw { id: bigint; payer: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; token: string; appliedFeeBps: bigint; }

function tokenSymbol(addr: string): string {
  if (addr?.toLowerCase() === CONTRACTS.MOCK_USDT.toLowerCase()) return "USDT";
  return "USDC";
}
interface SenderRep { score: number; total: number; defaults: number; }

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };
const STATUS_BG: Record<string, string> = { PENDING: "#f59e0b22", COMPLETED: "#22c55e22", DEFAULTED: "#ef444422", CANCELLED: "#88888822" };
const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING: <Clock size={14} color="#f59e0b" />,
  COMPLETED: <CheckCircle2 size={14} color="#22c55e" />,
  DEFAULTED: <AlertCircle size={14} color="#ef4444" />,
  CANCELLED: <XCircle size={14} color="#888" />,
};

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }
function fmtDate(ts: bigint) { return new Date(Number(ts) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
const AVATAR_COLORS = ["#DDE048", "#60a5fa", "#f59e0b", "#22c55e", "#f87171", "#a78bfa", "#34d399"];
function avatarColor(addr: string) { return AVATAR_COLORS[parseInt(addr.slice(2, 4), 16) % AVATAR_COLORS.length]; }
function initials(addr: string) { return addr.slice(2, 4).toUpperCase(); }

const FILTERS = ["ALL", "REQUEST_PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const FILTER_LABEL: Record<string, string> = {
  ALL: "All",
  REQUEST_PENDING: "Request",
  COMPLETED: "Completed",
  DEFAULTED: "Defaulted",
  CANCELLED: "Cancelled",
};

const TR_STATUS_LABEL: Record<string, string> = {
  pending: "Request Pending", renegotiating: "Renegotiating", accepted: "Accepted",
  rejected: "Rejected", cancelled: "Cancelled", confirmed: "Confirmed",
};
const TR_STATUS_COLOR: Record<string, string> = {
  pending: "#f59e0b", renegotiating: "#60a5fa", accepted: "#22c55e",
  rejected: "#ef4444", cancelled: "#888", confirmed: "#22c55e",
};
const TR_STATUS_BG: Record<string, string> = {
  pending: "#f59e0b22", renegotiating: "#60a5fa22", accepted: "#22c55e22",
  rejected: "#ef444422", cancelled: "#88888822", confirmed: "#22c55e22",
};

export default function MerchantTransfers() {
  const { account, connect, pledgeRead } = useWallet();
  const [pledges, setPledges] = useState<PledgeRaw[]>([]);
  const [transferRequests, setTransferRequests] = useState<TransferRequest[]>([]);
  const [senderReps, setSenderReps] = useState<Record<string, SenderRep>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => { if (account) loadData(); }, [account]);

  async function loadData() {
    setLoading(true);
    console.log("[MerchantTransfers] loadData for account:", account);
    try {
      const [idsResult, trData] = await Promise.all([
        (pledgeRead.getMerchantPledges(account) as Promise<bigint[]>).catch((e) => { console.error("[MerchantTransfers] getMerchantPledges error:", e); return [] as bigint[]; }),
        getMerchantTransferRequests(account!),
      ]);
      console.log("[MerchantTransfers] transferRequests:", trData.length, "pledges:", idsResult.length);
      setTransferRequests(trData);
      const details = await Promise.all(idsResult.map((id) => pledgeRead.getPledge(id))) as PledgeRaw[];
      setPledges(details.reverse());
      const uniqueSenders = [...new Set(details.map((p) => p.payer.toLowerCase()))];
      const reps = await Promise.all(uniqueSenders.map((s) => pledgeRead.getReputation(s)));
      const repMap: Record<string, SenderRep> = {};
      uniqueSenders.forEach((s, i) => {
        const r = reps[i];
        repMap[s] = { score: Math.round(Number(r.basisPoints) / 100), total: Number(r.totalCount), defaults: Number(r.defaultCount ?? 0) };
      });
      setSenderReps(repMap);
    } finally { setLoading(false); }
  }

  const activeRequests = transferRequests.filter(r => r.status === "pending" || r.status === "renegotiating");
  const cancelledRequests = transferRequests.filter(r => r.status === "cancelled");

  const filteredPledges = pledges.filter((p) => {
    const s = STATUS[p.status];
    if (filter === "ALL") { /* include all */ }
    else if (filter === "REQUEST_PENDING") return false;
    else if (s !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.payer.toLowerCase().includes(q) || p.id.toString().includes(q);
    }
    return true;
  });

  const requestsForFilter = filter === "ALL"
    ? [...activeRequests, ...cancelledRequests]
    : filter === "REQUEST_PENDING"
    ? activeRequests
    : filter === "CANCELLED"
    ? cancelledRequests
    : [];

  const filteredRequests = requestsForFilter.filter(r => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.sender_address.toLowerCase().includes(q);
  });

  const counts: Record<string, number> = { REQUEST_PENDING: activeRequests.length };
  pledges.forEach((p) => { const s = STATUS[p.status]; counts[s] = (counts[s] ?? 0) + 1; });
  counts.CANCELLED = (counts.CANCELLED ?? 0) + cancelledRequests.length;
  counts.ALL = (activeRequests.length + cancelledRequests.length) + pledges.length;

  /* ── DESKTOP ── */
  const DesktopView = (
    <div className="hidden md:block p-8">
      <div className="flex items-center gap-3 mb-6">
        <Link href="/merchant" className="flex items-center gap-1 text-[#555] text-sm hover:text-[#888] transition-colors">
          <ArrowLeft size={14} /> Merchant
        </Link>
        <span className="text-[#333]">/</span>
        <span className="text-white font-semibold text-sm">Incoming Transfers</span>
      </div>

      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-1">Incoming Transfers</h1>
          <p className="text-[#555] text-sm">All pledges sent to your merchant address.</p>
        </div>
        <div className="relative">
          <Search size={15} color="#555" className="absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sender or ID…"
            className="bg-[#13161c] border border-[#1e2230] text-white text-sm rounded-xl pl-9 pr-4 py-2.5 w-64 outline-none focus:border-[#333] placeholder:text-[#444]"
          />
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-5 flex-wrap">
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              filter === f ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-transparent border-[#1e2230] text-[#555] hover:text-[#888]"
            }`}
          >
            {FILTER_LABEL[f]}
            {(counts[f] ?? 0) > 0 && (
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
      ) : loading ? (
        <LoadingSpinner />
      ) : (filteredRequests.length === 0 && filteredPledges.length === 0) ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <FileText size={32} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">No transfers found</div>
          <div className="text-[#555] text-sm">
            {filter === "REQUEST_PENDING" ? "No pending requests from senders." : "Pledges and requests will appear here."}
          </div>
        </div>
      ) : (
        <div className="space-y-5">
          {/* Transfer Requests section */}
          {filteredRequests.length > 0 && (
            <div>
              {(filter === "ALL" || filter === "CANCELLED") && (
                <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3 font-semibold">
                  {filter === "CANCELLED" ? "CANCELLED REQUESTS" : "REQUEST"}
                </div>
              )}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e2230]">
                      {["SENDER", "TYPE", "AMOUNT / TERMS", "STATUS", "RECEIVED", ""].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] tracking-[1.5px] font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRequests.map((r) => {
                      const meta = getPledgeMeta(r.sender_address);
                      const termsSummary = r.type === "installment"
                        ? `${r.amount_per_period?.toFixed(2) ?? "—"} ${r.token} × ${r.total_periods ?? "?"}`
                        : `${r.total_amount?.toFixed(2) ?? "—"} ${r.token}`;
                      return (
                        <tr key={r.id} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors group">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-black shrink-0" style={{ background: avatarColor(r.sender_address) }}>
                                {initials(r.sender_address)}
                              </div>
                              <div>
                                <div className="font-semibold text-white text-xs">{meta?.name || shortAddr(r.sender_address)}</div>
                                <div className="text-[10px] text-[#555] font-mono">{shortAddr(r.sender_address)}</div>
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 text-[#888] text-xs capitalize">{r.type}</td>
                          <td className="px-5 py-4 font-bold text-white text-xs">{termsSummary}</td>
                          <td className="px-5 py-4">
                            <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full w-fit"
                              style={{ color: TR_STATUS_COLOR[r.status], background: TR_STATUS_BG[r.status] }}>
                              {r.status === "renegotiating" ? <RefreshCw size={11} /> : r.status === "cancelled" ? <XCircle size={11} /> : <Clock size={11} />}
                              {TR_STATUS_LABEL[r.status]}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-[#555] text-xs">
                            {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                          </td>
                          <td className="px-5 py-4">
                            <Link href={`/merchant/transfers/requests/${r.id}`}
                              className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline flex items-center gap-0.5">
                              Review <ChevronRight size={13} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* On-chain Pledges section */}
          {filteredPledges.length > 0 && (
            <div>
              {filter === "ALL" && filteredRequests.length > 0 && (
                <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3 font-semibold">ON-CHAIN PLEDGES</div>
              )}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[#1e2230]">
                      {["SENDER · TRUST", "PLEDGE ID", "TOTAL", "LOCKED", "REMAINING", "STATUS", "DUE DATE", ""].map((h) => (
                        <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] tracking-[1.5px] font-semibold">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPledges.map((p) => {
                      const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
                      const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
                      const feeBps = Number(p.appliedFeeBps);
                      const gross = total * (1 + feeBps / 10000);
                      const remaining = Math.max(0, parseFloat((gross - locked).toFixed(6)));
                      const sym = tokenSymbol(p.token);
                      const status = STATUS[p.status];
                      const rep = senderReps[p.payer.toLowerCase()];
                      const meta = getPledgeMeta(p.payer);
                      return (
                        <tr key={p.id.toString()} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors group">
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-2.5">
                              <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-black shrink-0" style={{ background: avatarColor(p.payer) }}>
                                {initials(p.payer)}
                              </div>
                              <div>
                                <div className="font-semibold text-white text-xs">{meta?.name || shortAddr(p.payer)}</div>
                                {rep && <div className="flex items-center gap-1 mt-0.5"><ShieldCheck size={11} color="#DDE048" /><span className="text-[10px] text-[#555]">{rep.score}/100</span></div>}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-4 font-mono text-[#555] text-xs">#{p.id.toString()}</td>
                          <td className="px-5 py-4 font-bold text-white">{total.toFixed(2)} <span className="text-[#555] text-xs font-normal">{sym}</span></td>
                          <td className="px-5 py-4 text-[#888]">{locked.toFixed(2)}</td>
                          <td className="px-5 py-4 text-[#888]">{remaining.toFixed(2)}</td>
                          <td className="px-5 py-4">
                            <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full w-fit" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                              {STATUS_ICON[status]} {status}
                            </span>
                          </td>
                          <td className="px-5 py-4 text-[#555] text-xs">{fmtDate(p.commitmentDate)}</td>
                          <td className="px-5 py-4">
                            <Link href={`/merchant/transfers/${p.id.toString()}`} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline flex items-center gap-0.5">
                              View <ChevronRight size={13} />
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );

  /* ── MOBILE ── */
  const MobileView = (
    <div className="md:hidden min-h-screen">
      <Header title="Incoming Transfers" back />
      <div className="px-4 pt-4 pb-[120px]">
        {/* Search */}
        <div className="relative mb-4">
          <Search size={15} color="#555" className="absolute left-3.5 top-1/2 -translate-y-1/2" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search…"
            className="w-full bg-[#11141A] border border-[#1F2127] text-white text-sm rounded-xl pl-10 pr-4 py-3 outline-none placeholder:text-[#555]"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-2 overflow-x-auto pb-1 mb-4 scrollbar-hide">
          {FILTERS.map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
                filter === f ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "border-[#1F2127] text-[#555]"
              }`}
            >
              {FILTER_LABEL[f]} {(counts[f] ?? 0) ? `(${counts[f]})` : ""}
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

        {!loading && account && filteredRequests.length === 0 && filteredPledges.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText size={28} color="#333" className="mb-3" />
            <div className="font-bold mb-1">{filter === "REQUEST_PENDING" ? "No pending requests" : "No transfers found"}</div>
            <div className="text-[#888] text-sm">{filter === "REQUEST_PENDING" ? "Sender requests appear here" : "Incoming pledges will appear here"}</div>
          </div>
        )}

        {/* Mobile — Request Pending cards */}
        {!loading && account && filteredRequests.length > 0 && (
          <>
            {(filter === "ALL" || filter === "CANCELLED") && (
              <div className="text-[11px] text-[#555] tracking-[1px] mb-2 font-semibold">
                {filter === "CANCELLED" ? "CANCELLED REQUESTS" : "REQUEST"}
              </div>
            )}
            {filteredRequests.map((r) => {
              const meta = getPledgeMeta(r.sender_address);
              const termsSummary = r.type === "installment"
                ? `${r.amount_per_period?.toFixed(2) ?? "—"} ${r.token} × ${r.total_periods ?? "?"}`
                : `${r.total_amount?.toFixed(2) ?? "—"} ${r.token}`;
              return (
                <Link key={r.id} href={`/merchant/transfers/requests/${r.id}`} className="block no-underline text-inherit">
                  <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black text-black shrink-0" style={{ background: avatarColor(r.sender_address) }}>
                          {initials(r.sender_address)}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-sm">{meta?.name || shortAddr(r.sender_address)}</div>
                          <div className="text-[11px] text-[#666] capitalize">{r.type}</div>
                        </div>
                      </div>
                      <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full"
                        style={{ color: TR_STATUS_COLOR[r.status], background: TR_STATUS_BG[r.status] }}>
                        {r.status === "renegotiating" ? <RefreshCw size={11} /> : r.status === "cancelled" ? <XCircle size={11} /> : <Clock size={11} />}
                        {TR_STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-lg font-extrabold text-white">{termsSummary}</div>
                        <div className="text-xs text-[#666] mt-0.5">Received {new Date(r.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                      </div>
                      <span className="flex items-center gap-0.5 text-[#DDE048] text-xs font-semibold">Review <ChevronRight size={13} /></span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </>
        )}

        {/* Mobile — On-chain Pledge cards */}
        {!loading && account && filteredPledges.length > 0 && (
          <>
            {filter === "ALL" && filteredRequests.length > 0 && (
              <div className="text-[11px] text-[#555] tracking-[1px] mb-2 font-semibold mt-2">ON-CHAIN PLEDGES</div>
            )}
            {filteredPledges.map((p) => {
              const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
              const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
              const sym = tokenSymbol(p.token);
              const status = STATUS[p.status];
              const rep = senderReps[p.payer.toLowerCase()];
              const meta = getPledgeMeta(p.payer);
              return (
                <Link key={p.id.toString()} href={`/merchant/transfers/${p.id.toString()}`} className="block no-underline text-inherit">
                  <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black text-black shrink-0" style={{ background: avatarColor(p.payer) }}>
                          {initials(p.payer)}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-sm">{meta?.name || shortAddr(p.payer)}</div>
                          {rep && <div className="text-[11px] text-[#666]">Trust {rep.score}/100</div>}
                        </div>
                      </div>
                      <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                        {STATUS_ICON[status]} {status}
                      </span>
                    </div>
                    <div className="flex justify-between items-end">
                      <div>
                        <div className="text-xl font-extrabold text-white">{total.toFixed(2)} <span className="text-sm text-[#888] font-normal">{sym}</span></div>
                        <div className="text-xs text-[#666] mt-0.5">Locked: {locked.toFixed(2)} {sym} · Due {fmtDate(p.commitmentDate)}</div>
                      </div>
                      <span className="flex items-center gap-0.5 text-[#DDE048] text-xs font-semibold">View <ChevronRight size={13} /></span>
                    </div>
                  </div>
                </Link>
              );
            })}
          </>
        )}
      </div>
    </div>
  );

  return (
    <KYCGate featureName="Incoming Transfers">
      {DesktopView}
      {MobileView}
    </KYCGate>
  );
}

"use client";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Search, ArrowLeft, Clock, CheckCircle2, AlertCircle, XCircle } from "lucide-react";
import Header from "../../../components/Header";
import LoadingSpinner from "../../../components/LoadingSpinner";
import CircularScore from "../../../components/CircularScore";
import { useWallet } from "../../../context/WalletContext";
import { useCurrency } from "../../../context/CurrencyContext";
import { getPledgeMeta } from "../../../lib/pledgeMeta";

interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; }
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

const FILTERS = ["ALL", "PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];

export default function MerchantTransfers() {
  const { account, connect, pledgeRead, walletLoading } = useWallet();
  const [pledges, setPledges] = useState<PledgeRaw[]>([]);
  const [senderReps, setSenderReps] = useState<Record<string, SenderRep>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");

  useEffect(() => { if (account) loadData(); }, [account]);

  async function loadData() {
    setLoading(true);
    try {
      const ids = await pledgeRead.getMerchantPledges(account) as bigint[];
      const details = await Promise.all(ids.map((id) => pledgeRead.getPledge(id))) as PledgeRaw[];
      setPledges(details.reverse());
      const uniqueSenders = [...new Set(details.map((p) => p.sender.toLowerCase()))];
      const reps = await Promise.all(uniqueSenders.map((s) => pledgeRead.getReputation(s)));
      const repMap: Record<string, SenderRep> = {};
      uniqueSenders.forEach((s, i) => {
        const r = reps[i];
        repMap[s] = { score: Math.round(Number(r.basisPoints) / 100), total: Number(r.totalCount), defaults: Number(r.defaultCount ?? 0) };
      });
      setSenderReps(repMap);
    } finally { setLoading(false); }
  }

  const filtered = pledges.filter((p) => {
    const s = STATUS[p.status];
    if (filter !== "ALL" && s !== filter) return false;
    if (search) {
      const q = search.toLowerCase();
      return p.sender.toLowerCase().includes(q) || p.id.toString().includes(q);
    }
    return true;
  });

  const counts: Record<string, number> = { ALL: pledges.length };
  pledges.forEach((p) => { const s = STATUS[p.status]; counts[s] = (counts[s] ?? 0) + 1; });

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
            {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()}
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
      ) : loading ? (
        <LoadingSpinner />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="font-bold text-white mb-1.5">No transfers found</div>
          <div className="text-[#555] text-sm">Pledges sent to your address will appear here</div>
        </div>
      ) : (
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
              {filtered.map((p) => {
                const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
                const gross = total * 1.01;
                const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
                const remaining = Math.max(0, parseFloat((gross - locked).toFixed(6)));
                const status = STATUS[p.status];
                const rep = senderReps[p.sender.toLowerCase()];
                const meta = getPledgeMeta(p.sender);
                return (
                  <tr key={p.id.toString()} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors group">
                    <td className="px-5 py-4">
                      <div className="flex items-center gap-2.5">
                        <div className="w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black text-black shrink-0" style={{ background: avatarColor(p.sender) }}>
                          {initials(p.sender)}
                        </div>
                        <div>
                          <div className="font-semibold text-white text-xs">{meta?.name || shortAddr(p.sender)}</div>
                          {rep && <div className="flex items-center gap-1 mt-0.5"><CircularScore score={rep.score} size={14} /><span className="text-[10px] text-[#555]">{rep.score}</span></div>}
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-4 font-mono text-[#555] text-xs">#{p.id.toString()}</td>
                    <td className="px-5 py-4 font-bold text-white">{total.toFixed(2)} <span className="text-[#555] text-xs font-normal">USDC</span></td>
                    <td className="px-5 py-4 text-[#888]">{locked.toFixed(2)}</td>
                    <td className="px-5 py-4 text-[#888]">{remaining.toFixed(2)}</td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full w-fit" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                        {STATUS_ICON[status]} {status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-[#555] text-xs">{fmtDate(p.commitmentDate)}</td>
                    <td className="px-5 py-4">
                      <Link href={`/merchant/transfers/${p.id.toString()}`} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline">
                        View →
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
              {f === "ALL" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()} {counts[f] ? `(${counts[f]})` : ""}
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
            <div className="font-bold mb-1">No transfers</div>
            <div className="text-[#888] text-sm">Incoming pledges will appear here</div>
          </div>
        )}
        {filtered.map((p) => {
          const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
          const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
          const status = STATUS[p.status];
          const rep = senderReps[p.sender.toLowerCase()];
          const meta = getPledgeMeta(p.sender);
          return (
            <Link key={p.id.toString()} href={`/merchant/transfers/${p.id.toString()}`} className="block no-underline text-inherit">
              <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center text-sm font-black text-black shrink-0" style={{ background: avatarColor(p.sender) }}>
                      {initials(p.sender)}
                    </div>
                    <div>
                      <div className="font-semibold text-white text-sm">{meta?.name || shortAddr(p.sender)}</div>
                      {rep && <div className="text-[11px] text-[#666]">Trust {rep.score}/100</div>}
                    </div>
                  </div>
                  <span className="flex items-center gap-1 text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                    {STATUS_ICON[status]} {status}
                  </span>
                </div>
                <div className="flex justify-between items-end">
                  <div>
                    <div className="text-xl font-extrabold text-white">{total.toFixed(2)} <span className="text-sm text-[#888] font-normal">USDC</span></div>
                    <div className="text-xs text-[#666] mt-0.5">Locked: {locked.toFixed(2)} USDC · Due {fmtDate(p.commitmentDate)}</div>
                  </div>
                  <span className="text-[#DDE048] text-xs font-semibold">View →</span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {DesktopView}
      {MobileView}
    </>
  );
}

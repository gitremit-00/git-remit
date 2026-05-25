"use client";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Download, Share2, Search, ExternalLink, Clock, CheckCircle2, AlertCircle, Copy, Store, BadgeCheck, ShieldCheck, Dot, FileText } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import CircularScore from "../../components/CircularScore";
import { useCurrency } from "../../context/CurrencyContext";
import { getPledgeMeta } from "../../lib/pledgeMeta";
import BottomNav from "../../components/BottomNav";
import Header from "../../components/Header";

interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; }
interface SenderRep { score: number; total: number; defaults: number; }

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };
const STATUS_BG: Record<string, string> = { PENDING: "#f59e0b22", COMPLETED: "#22c55e22", DEFAULTED: "#ef444422", CANCELLED: "#88888822" };

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }
function fmtDate(ts: bigint) { return new Date(Number(ts) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function daysOverdue(ts: bigint) { return Math.max(0, Math.floor((Date.now() / 1000 - Number(ts)) / 86400)); }
function initials(addr: string) { return addr.slice(2, 4).toUpperCase(); }

const AVATAR_COLORS = ["#DDE048", "#60a5fa", "#f59e0b", "#22c55e", "#f87171", "#a78bfa", "#34d399"];
function avatarColor(addr: string) { return AVATAR_COLORS[parseInt(addr.slice(2, 4), 16) % AVATAR_COLORS.length]; }

export default function MerchantDashboard() {
  const { account, connect, pledgeRead, walletLoading } = useWallet();
  const { fmt } = useCurrency();
  const [pledges, setPledges] = useState<PledgeRaw[]>([]);
  const [senderReps, setSenderReps] = useState<Record<string, SenderRep>>({});
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState("ALL");
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (account) loadData(); }, [account]);

  async function loadData() {
    setLoading(true);
    try {
      const ids = await pledgeRead.getMerchantPledges(account) as bigint[];
      const details = await Promise.all(ids.map((id) => pledgeRead.getPledge(id))) as PledgeRaw[];
      setPledges(details);
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

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const pending = pledges.filter((p) => Number(p.status) === 0);
  const completed = pledges.filter((p) => Number(p.status) === 1);
  const claimable = pledges.filter((p) => {
    if (Number(p.status) !== 0) return false;
    return Date.now() / 1000 > Number(p.commitmentDate) + 3 * 86400;
  });
  const totalLocked = pledges.reduce((s, p) => s + parseFloat(ethers.formatUnits(p.depositedAmount, 6)), 0);
  const totalCommitted = pledges.reduce((s, p) => s + parseFloat(ethers.formatUnits(p.totalAmount, 6)), 0);

  const filtered = pledges.filter((p) => {
    const statusMatch = filter === "ALL" || STATUS[Number(p.status)] === filter || (filter === "CLAIMABLE" && claimable.includes(p));
    const searchMatch = !search || p.sender.toLowerCase().includes(search.toLowerCase()) || p.id.toString().includes(search);
    return statusMatch && searchMatch;
  });

  if (walletLoading) return <LoadingSpinner fullScreen />;

  if (!account) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-[#0e1014]">
      <h2 className="text-2xl font-bold mb-2.5 text-white">Merchant Portal</h2>
      <p className="text-[#888] mb-10 text-sm max-w-[280px] text-center">Connect your wallet to view incoming transfers</p>
      <button className="bg-[#DDE048] text-black rounded-[14px] px-12 py-4 text-base font-bold" onClick={connect}>Connect MetaMask</button>
    </div>
  );

  /* ── DESKTOP ── */
  const Desktop = (
    <div className="hidden md:block p-8">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="text-[#555] text-sm mb-1">Merchant dashboard</div>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-[#DDE048]/10 flex items-center justify-center"><Store size={20} color="#DDE048" /></div>
            <h1 className="text-4xl font-extrabold text-white">{shortAddr(account)}</h1>
          </div>
          <div className="flex items-center gap-3 mt-2">
            <button onClick={copyAddress} className="flex items-center gap-1.5 bg-[#13161c] border border-[#1e2230] rounded-lg px-3 py-1.5 text-[13px] text-[#ccc] hover:border-[#333] transition-colors font-mono">
              <span className="w-3 h-3 rounded-sm bg-[#DDE048]/20 border border-[#DDE048]/40" />
              {copied ? <span className="text-[#DDE048]">Copied!</span> : shortAddr(account)}
              <Copy size={11} color={copied ? "#DDE048" : "#555"} />
            </button>
            <span className="text-[#444]">·</span>
            <span className="flex items-center gap-1 text-[12px] text-green-400 font-semibold"><BadgeCheck size={13} /> verified registrar</span>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] text-white text-sm font-semibold rounded-xl px-4 py-2.5 hover:border-[#333] transition-colors">
            <Download size={14} /> Export CSV
          </button>
          <Link href="/merchant/requests" className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] text-white text-sm font-semibold rounded-xl px-4 py-2.5 hover:border-[#333] transition-colors">
            <FileText size={14} /> Payment Requests
          </Link>
          <button className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors">
            <Share2 size={14} /> Share receive link
          </button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 col-span-1 relative overflow-hidden">
          <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">TOTAL TRANSFERRED (THIS TERM)</div>
          <div className="text-4xl font-extrabold text-white leading-none mb-1">
            {totalCommitted.toFixed(2)} <span className="text-base text-[#888] font-normal">USDC</span>
          </div>
          <div className="text-[#555] text-sm mb-3">≈ {fmt(totalCommitted)}</div>
          <div className="text-[12px] text-[#888]">
            <span className="text-[#DDE048] font-bold">{totalLocked.toFixed(2)} USDC</span> locked in holding
            <span className="text-[#444] mx-2">·</span>
            {(totalCommitted - totalLocked).toFixed(2)} USDC committed
          </div>
        </div>
        <StatCard label="PENDING" value={pending.length} sub="awaiting deposit" color="#f59e0b" />
        <StatCard label="COMPLETED" value={completed.length} sub="released on time" color="#22c55e" />
        <StatCard label="CLAIMABLE" value={claimable.length} sub="grace period ended" color="#ef4444" />
      </div>

      {/* Table filters + search */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex gap-2">
          {[["ALL", pledges.length], ["PENDING", pending.length], ["COMPLETED", completed.length], ["CLAIMABLE", claimable.length]].map(([f, count]) => (
            <button key={f} onClick={() => setFilter(f as string)}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${filter === f ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-transparent border-[#1e2230] text-[#555] hover:text-[#888]"}`}>
              {f} <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${filter === f ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#555]"}`}>{count}</span>
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-2">
            <Search size={14} color="#444" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search wallet, sender..." className="bg-transparent text-sm text-[#888] placeholder-[#444] outline-none w-48" />
          </div>
          <button className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] text-[#888] text-sm rounded-xl px-3 py-2 hover:border-[#333] transition-colors">
            This term
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden mb-6">
        <table className="w-full">
          <thead>
            <tr className="border-b border-[#1e2230]">
              {["SENDER · TRUST", "PLEDGE ID", "TOTAL", "LOCKED", "REMAINING", "STATUS", "DUE", "ACTION"].map((h) => (
                <th key={h} className="text-left text-[11px] text-[#555] tracking-[1px] font-semibold px-5 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={8} className="py-12 text-center"><LoadingSpinner /></td></tr>
            )}
            {!loading && filtered.length === 0 && (
              <tr><td colSpan={8} className="py-12 text-center text-[#555] text-sm">No transfers found</td></tr>
            )}
            {filtered.map((p) => {
              const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
              const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
              const remaining = Math.max(0, total * 1.01 - locked);
              const status = STATUS[p.status];
              const rep = senderReps[p.sender.toLowerCase()];
              const meta = getPledgeMeta(p.merchant);
              const isClaimable = status === "PENDING" && Date.now() / 1000 > Number(p.commitmentDate) + 3 * 86400;
              const overdue = isClaimable ? daysOverdue(p.commitmentDate) : 0;
              const pledgeShort = `0x${p.id.toString(16).slice(0, 6)}…${p.id.toString(16).slice(-4)}`;

              return (
                <tr key={p.id.toString()} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors">
                  {/* Sender */}
                  <td className="px-5 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-black shrink-0"
                        style={{ background: avatarColor(p.sender) }}>
                        {initials(p.sender)}
                      </div>
                      <div>
                        <div className="text-sm font-semibold text-white">{shortAddr(p.sender)}</div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[11px] text-[#555]">{shortAddr(p.sender)}</span>
                          {rep && (
                            <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full"
                              style={{ background: rep.score >= 50 ? "#DDE04822" : "#ef444422", color: rep.score >= 50 ? "#DDE048" : "#ef4444" }}>
                              {rep.score}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </td>
                  {/* Pledge ID */}
                  <td className="px-5 py-4">
                    <div className="font-mono text-sm text-white">{pledgeShort}</div>
                    {meta?.note && <div className="text-[11px] text-[#555] mt-0.5">{meta.note}</div>}
                  </td>
                  {/* Total */}
                  <td className="px-5 py-4 text-sm text-white font-semibold">{total.toFixed(2)}</td>
                  {/* Locked */}
                  <td className="px-5 py-4 text-sm font-bold text-[#DDE048]">{locked.toFixed(2)}</td>
                  {/* Remaining */}
                  <td className="px-5 py-4 text-sm text-[#888]">{remaining.toFixed(2)}</td>
                  {/* Status */}
                  <td className="px-5 py-4">
                    <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                      {status === "COMPLETED" ? <CheckCircle2 size={12} /> : <Dot size={14} />} {status}
                    </span>
                  </td>
                  {/* Due */}
                  <td className="px-5 py-4 text-sm">
                    {status === "PENDING" && !isClaimable && <span className="text-[#888]">{fmtDate(p.commitmentDate)}</span>}
                    {status === "COMPLETED" && <span className="text-[#555]">—</span>}
                    {isClaimable && <span className="text-red-400 font-bold">+{overdue}d</span>}
                  </td>
                  {/* Action */}
                  <td className="px-5 py-4">
                    {isClaimable ? (
                      <Link href={`/merchant/transfers/${p.id}`}>
                        <span className="bg-[#DDE048] text-black text-[12px] font-bold rounded-xl px-3 py-2 whitespace-nowrap hover:bg-[#c8ce30] transition-colors">
                          Claim {locked.toFixed(2)}
                        </span>
                      </Link>
                    ) : status === "COMPLETED" ? (
                      <a href={`https://explorer-hoodi.morph.network`} target="_blank" rel="noreferrer"
                        className="flex items-center gap-1 text-[#DDE048] text-sm font-semibold hover:underline">
                        Explorer <ExternalLink size={12} />
                      </a>
                    ) : (
                      <Link href={`/merchant/transfers/${p.id}`}
                        className="flex items-center gap-1 text-[#888] text-sm font-semibold hover:text-white transition-colors">
                        View <ExternalLink size={12} />
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Bottom row */}
      <div className="grid grid-cols-2 gap-5">
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={20} color="#DDE048" />
            <h3 className="font-bold text-white">Every transfer is verifiable</h3>
          </div>
          <p className="text-[#555] text-sm leading-relaxed">Each transfer above is backed by a smart contract. You can verify any pledge on-chain using the Pledge ID.</p>
        </div>
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
          <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">SENDER TRUST DISTRIBUTION</div>
          <div className="space-y-2.5">
            {[
              { label: "Trusted (80–100)", color: "#22c55e", count: Object.values(senderReps).filter((r) => r.score >= 80).length },
              { label: "Good (50–79)", color: "#DDE048", count: Object.values(senderReps).filter((r) => r.score >= 50 && r.score < 80).length },
              { label: "Fair (20–49)", color: "#f59e0b", count: Object.values(senderReps).filter((r) => r.score >= 20 && r.score < 50).length },
              { label: "High Risk (0–19)", color: "#ef4444", count: Object.values(senderReps).filter((r) => r.score < 20).length },
            ].map(({ label, color, count }) => (
              <div key={label} className="flex items-center gap-3">
                <div className="flex-1 h-1.5 bg-[#1e2230] rounded-full overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Object.keys(senderReps).length > 0 ? (count / Object.keys(senderReps).length) * 100 : 0}%`, background: color }} />
                </div>
                <span className="text-[12px] text-[#555] w-32">{label}</span>
                <span className="text-[12px] font-bold text-white w-4 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── MOBILE ── */
  const Mobile = (
    <div className="md:hidden">
      <Header title="Merchant" />
      <div className="px-4 pt-4 pb-24">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 col-span-2">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">TOTAL TRANSFERRED</div>
            <div className="text-3xl font-extrabold">{totalCommitted.toFixed(2)} <span className="text-sm text-[#888] font-normal">USDC</span></div>
            <div className="text-xs text-[#888] mt-1">≈ {fmt(totalCommitted)}</div>
          </div>
          <MobileStatCard label="PENDING" value={pending.length} color="#f59e0b" />
          <MobileStatCard label="COMPLETED" value={completed.length} color="#22c55e" />
        </div>

        {claimable.length > 0 && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-2xl px-4 py-3 mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} color="#ef4444" />
              <span className="text-red-400 text-sm font-semibold">{claimable.length} claimable</span>
            </div>
            <span className="text-red-400 text-xs">grace period ended</span>
          </div>
        )}

        <Link href="/merchant/requests" className="w-full flex items-center justify-between bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-3 mb-4 text-inherit">
          <div className="flex items-center gap-2.5">
            <FileText size={16} color="#DDE048" />
            <span className="font-semibold text-sm text-white">Payment Requests</span>
          </div>
          <span className="text-xs text-[#555]">Create &amp; share →</span>
        </Link>

        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">INCOMING TRANSFERS · {pledges.length}</div>

        {loading && <LoadingSpinner />}

        {filtered.map((p) => {
          const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
          const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
          const remaining = Math.max(0, total * 1.01 - locked);
          const status = STATUS[p.status];
          const rep = senderReps[p.sender.toLowerCase()];
          const isClaimable = status === "PENDING" && Date.now() / 1000 > Number(p.commitmentDate) + 3 * 86400;

          return (
            <Link key={p.id.toString()} href={`/merchant/transfers/${p.id}`} className="block bg-[#11141A] border border-[#1F2127] rounded-[18px] p-4 mb-3 text-inherit">
              <div className="flex items-start justify-between mb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold text-black shrink-0"
                    style={{ background: avatarColor(p.sender) }}>
                    {initials(p.sender)}
                  </div>
                  <div>
                    <div className="font-bold text-[15px]">{shortAddr(p.sender)}</div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-[11px] text-[#888]">{shortAddr(p.sender)}</span>
                      {rep && <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full" style={{ background: rep.score >= 50 ? "#DDE04822" : "#ef444422", color: rep.score >= 50 ? "#DDE048" : "#ef4444" }}>{rep.score}</span>}
                    </div>
                  </div>
                </div>
                <span className="text-[11px] font-bold px-2.5 py-1 rounded-full" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                  {status === "COMPLETED" ? "✓" : "●"} {status}
                </span>
              </div>
              <div className="text-[28px] font-extrabold">{total.toFixed(2)} <span className="text-sm text-[#888] font-normal">USDC</span></div>
              <div className="flex justify-between text-[12px] mt-1">
                <span className="text-[#DDE048] font-semibold">{locked.toFixed(2)} locked</span>
                <span className="text-[#888]">{remaining.toFixed(2)} remaining</span>
              </div>
              {isClaimable && (
                <div className="mt-3 bg-[#DDE048] text-black rounded-xl py-2.5 text-sm font-bold text-center">
                  Claim {locked.toFixed(2)} USDC
                </div>
              )}
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {Desktop}
      {Mobile}
    </>
  );
}

function StatCard({ label, value, sub, color }: { label: string; value: number; sub: string; color: string }) {
  return (
    <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
      <div className="flex items-center gap-2 mb-3">
        <span className="w-2 h-2 rounded-full" style={{ background: color }} />
        <span className="text-[11px] text-[#555] tracking-[1.5px]">{label}</span>
      </div>
      <div className="text-5xl font-extrabold text-white leading-none mb-2">{value}</div>
      <div className="text-[12px] text-[#555]">{sub}</div>
    </div>
  );
}

function MobileStatCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
      <div className="flex items-center gap-1.5 mb-2">
        <span className="w-1.5 h-1.5 rounded-full" style={{ background: color }} />
        <span className="text-[10px] text-[#888] tracking-[1.5px]">{label}</span>
      </div>
      <div className="text-3xl font-extrabold">{value}</div>
    </div>
  );
}

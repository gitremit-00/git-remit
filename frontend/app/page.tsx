"use client";
import Header from "../components/Header";
import LoadingSpinner from "../components/LoadingSpinner";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Copy, Clock, Inbox, Info, TrendingUp, ArrowRight, CheckCircle2, AlertCircle, AlertTriangle, PlusCircle, Shield } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import CircularScore from "../components/CircularScore";
import ProgressBar from "../components/ProgressBar";
import { useCurrency } from "../context/CurrencyContext";
import { getPledgeMeta } from "../lib/pledgeMeta";

interface RepState { score: number; onTime: number; total: number; defaults: number; late: number; }
interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; }
interface ActivityItem { type: "success" | "warning" | "error" | "info"; label: string; sub: string; time: string; }

function daysLeft(ts: bigint) { return Math.max(0, Math.ceil((Number(ts) - Date.now() / 1000) / 86400)); }
function shortAddr(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }
function fmtDate(ts: bigint) { const d = new Date(Number(ts) * 1000); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) + " at " + d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }
function fmtShortDate(ts: bigint) { const d = new Date(Number(ts) * 1000); return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function scoreLabel(s: number) { return s >= 80 ? "Excellent" : s >= 50 ? "Good" : s >= 20 ? "Fair" : "Poor"; }
function scoreColor(s: number) { return s >= 80 ? "#22c55e" : s >= 50 ? "#DDE048" : s >= 20 ? "#f59e0b" : "#ef4444"; }

export default function Home() {
  const { account, connect, pledgeRead, usdcRead, walletLoading } = useWallet();
  const { fmt, fmtAlt, currency } = useCurrency();
  const [balance, setBalance] = useState<string | null>(null);
  const [rep, setRep] = useState<RepState | null>(null);
  const [activePledges, setActivePledges] = useState<PledgeRaw[]>([]);
  const [completedPledges, setCompletedPledges] = useState<PledgeRaw[]>([]);
  const [allPledges, setAllPledges] = useState<PledgeRaw[]>([]);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  useEffect(() => { if (account) loadData(); }, [account]);

  async function loadData() {
    setLoading(true);
    try {
      const [bal, repData, ids, maxAct] = await Promise.all([
        usdcRead.balanceOf(account),
        pledgeRead.getReputation(account),
        pledgeRead.getSenderPledges(account),
        pledgeRead.getMaxActivePledges(account),
      ]);
      setBalance(ethers.formatUnits(bal, 6));
      setRep({
        score: Math.round(Number(repData.basisPoints) / 100),
        onTime: Number(repData.onTimeCount),
        total: Number(repData.totalCount),
        defaults: Number(repData.defaultCount ?? 0),
        late: Number(repData.lateCount ?? 0),
      });
      setMaxActive(Number(maxAct));
      const details = (await Promise.all((ids as bigint[]).map((id) => pledgeRead.getPledge(id)))) as PledgeRaw[];
      setAllPledges(details);
      setActivePledges(details.filter((p) => Number(p.status) === 0));
      setCompletedPledges(details.filter((p) => Number(p.status) === 1));
    } finally { setLoading(false); }
  }

  if (walletLoading) return <LoadingSpinner fullScreen />;

  /* ── Connect screen (shared mobile + desktop) ── */
  if (!account) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-[#0e1014]">
      <Image src="/logo.png" alt="RemitSafe" width={80} height={80} priority style={{ objectFit: "contain", marginBottom: 24 }} />
      <h2 className="text-2xl font-bold mb-2.5 text-white">OFW Payment Pledge</h2>
      <p className="text-[#888] mb-10 text-sm leading-relaxed max-w-[280px] text-center">
        Secure on-chain remittance commitments, powered by smart contracts
      </p>
      <button className="bg-[#DDE048] text-black border-0 rounded-[14px] px-12 py-4 text-base font-bold cursor-pointer" onClick={connect}>
        Connect MetaMask
      </button>
    </div>
  );

  /* ── DESKTOP LAYOUT ── */
  const DesktopDashboard = (
    <div className="hidden md:block p-8">
      {/* Page header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="text-[#888] text-sm mb-1">Welcome back,</div>
          <h1 className="text-4xl font-extrabold text-white">{shortAddr(account)}</h1>
          <div className="flex items-center gap-3 mt-2">
            <button
              onClick={copyAddress}
              className="flex items-center gap-1.5 bg-[#13161c] border border-[#1e2230] rounded-lg px-3 py-1.5 text-[13px] text-[#ccc] hover:border-[#333] transition-colors"
            >
              <span className="w-3 h-3 rounded-sm bg-[#DDE048]/20 border border-[#DDE048]/40" />
              <span className="font-mono">{copied ? "Copied!" : shortAddr(account)}</span>
              <Copy size={11} color={copied ? "#DDE048" : "#555"} />
            </button>
          </div>
        </div>
        <Link
          href="/new-transfer"
          className="flex items-center gap-2 bg-[#DDE048] text-black font-bold text-sm rounded-xl px-5 py-3 hover:bg-[#c8ce30] transition-colors"
        >
          + New transfer
        </Link>
      </div>

      {/* Stats row: Trust Score wide + 2 cards */}
      <div className="grid grid-cols-[1fr_1fr_1fr] gap-4 mb-8">
        {/* Trust Score */}
        <div className="relative overflow-hidden border border-[#1F2127] rounded-2xl p-5 col-span-1"
          style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)" }}>
          <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
            <Image src="/logo.png" alt="" width={110} height={110} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
          </div>
          <div className="relative">
          <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">TRUST SCORE</div>
          <div className="flex items-start gap-4">
            <CircularScore score={rep?.score ?? 0} size={76} />
            <div className="flex-1 min-w-0">
              {rep ? (
                <>
                  <p className="text-[12px] text-[#999] leading-relaxed mb-3">
                    Requires <span className="text-[#DDE048] font-bold">20%</span> upfront.
                    Reach <span className="text-[#DDE048] font-bold">80+</span> to unlock 10% upfront.
                  </p>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
                    <div><span className="text-white font-bold">{rep.onTime}/{rep.total}</span> <span className="text-[#555]">completed</span></div>
                    <div><span className="text-white font-bold">{rep.defaults}</span> <span className="text-[#555]">defaults</span></div>
                    <div><span className="text-white font-bold">{rep.late}</span> <span className="text-[#555]">late</span></div>
                  </div>
                  <div className="mt-2 text-xs font-bold" style={{ color: scoreColor(rep.score) }}>
                    {scoreLabel(rep.score).toUpperCase()}
                  </div>
                </>
              ) : <div className="text-[#555] text-sm">Loading…</div>}
            </div>
          </div>
          </div>
        </div>

        {/* Active Transfer Cap */}
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-[#DDE048]/10 flex items-center justify-center">
              <TrendingUp size={12} color="#DDE048" />
            </div>
            <span className="text-[11px] text-[#555] tracking-[1.5px]">ACTIVE TRANSFER CAP</span>
          </div>
          <div className="text-4xl font-extrabold text-white mb-1">
            {activePledges.length}<span className="text-xl text-[#888] font-normal"> / {maxActive ?? "–"}</span>
          </div>
          <div className="h-1.5 bg-[#1e2230] rounded-full mt-3 mb-2">
            <div
              className="h-full bg-[#DDE048] rounded-full transition-all"
              style={{ width: maxActive ? `${(activePledges.length / maxActive) * 100}%` : "0%" }}
            />
          </div>
          <p className="text-[12px] text-[#555] leading-relaxed">
            <span className="text-white">{maxActive ? maxActive - activePledges.length : "–"} slot{(maxActive ?? 0) - activePledges.length !== 1 ? "s" : ""}</span> left.
            Complete an active one to free a slot, or upgrade your tier.
          </p>
        </div>

        {/* USDC Balance */}
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-5 h-5 rounded-full bg-[#DDE048]/10 flex items-center justify-center">
              <span className="text-[10px] text-[#DDE048] font-bold">$</span>
            </div>
            <span className="text-[11px] text-[#555] tracking-[1.5px]">USDC BALANCE</span>
          </div>
          <div className="text-3xl font-extrabold text-white mb-0.5 truncate">
            {loading ? "–" : balance
              ? currency === "PHP"
                ? fmt(parseFloat(balance))
                : `${parseFloat(balance).toFixed(2)}`
              : currency === "PHP" ? fmt(0) : "0.00"}
            <span className="text-base text-[#888] font-normal ml-1.5">{currency === "PHP" ? "PHP" : "USDC"}</span>
          </div>
          {balance && <div className="text-[12px] text-[#555] mb-4">≈ {fmtAlt(parseFloat(balance))}</div>}
          <div className="flex gap-2 mt-auto">
            <Link href="/wallet" className="flex-1 bg-[#DDE048] text-black text-sm font-bold rounded-xl py-2.5 text-center hover:bg-[#c8ce30] transition-colors">Top up</Link>
            <Link href="/wallet" className="flex-1 bg-[#1e2230] text-white text-sm font-semibold rounded-xl py-2.5 text-center hover:bg-[#252836] transition-colors">Withdraw</Link>
          </div>
        </div>
      </div>

      {/* Active Transfers */}
      <div className="mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-xl font-bold text-white">Active Transfers</h2>
            <p className="text-[13px] text-[#555] mt-0.5">
              {activePledges.length} pending · {activePledges.reduce((s, p) => s + parseFloat(ethers.formatUnits(p.depositedAmount, 6)), 0).toFixed(2)} USDC locked in holding
            </p>
          </div>
          <Link href="/pledges" className="flex items-center gap-1 text-[#DDE048] text-sm font-semibold hover:text-[#c8ce30]">
            View all <ArrowRight size={14} />
          </Link>
        </div>

        {loading && <LoadingSpinner />}

        {!loading && activePledges.length === 0 && (
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl py-12 text-center flex flex-col items-center">
            <Inbox size={40} color="#333" className="mb-3" />
            <div className="font-bold text-base text-white mb-1.5">No active transfers</div>
            <div className="text-[#555] text-sm mb-5">Create your first pledge to get started</div>
            <Link href="/new-transfer" className="inline-block bg-[#DDE048] text-black rounded-xl px-6 py-2.5 text-sm font-bold">+ New Transfer</Link>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          {activePledges.map((p) => {
            const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
            const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
            const remaining = total - locked;
            const days = daysLeft(p.commitmentDate);
            const meta = getPledgeMeta(p.merchant);
            return (
              <Link key={p.id.toString()} href={`/pledge/${p.id}`} className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 block text-inherit hover:border-[#2a2d3a] transition-colors">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-[#1e2230] flex items-center justify-center text-lg">
                      🏢
                    </div>
                    <div>
                      <div className="font-bold text-[15px] text-white">{meta?.name || shortAddr(p.merchant)}</div>
                      <div className="text-[11px] text-[#555] font-mono mt-0.5">{shortAddr(p.merchant)}</div>
                    </div>
                  </div>
                  <span className="bg-amber-400/15 text-amber-400 rounded-full px-2.5 py-1 text-[11px] font-bold whitespace-nowrap">● PENDING</span>
                </div>

                <div className="text-[32px] font-extrabold text-white leading-none">{total.toFixed(2)}<span className="text-base text-[#888] ml-1.5">USDC</span></div>
                <div className="text-xs text-[#555] mb-3 mt-0.5">≈ {fmt(total)}</div>

                <ProgressBar locked={locked} total={total} />
                <div className="flex justify-between text-[12px] mt-1 mb-3">
                  <span className="text-[#DDE048] font-semibold">{locked.toFixed(2)} locked</span>
                  <span className="text-[#555]">{remaining.toFixed(2)} remaining</span>
                </div>

                {meta?.note && (
                  <div className="flex items-center gap-1.5 text-[12px] text-[#555] mb-3">
                    <Info size={12} color="#444" />
                    <span>{meta.note}</span>
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-[12px]">
                    <Clock size={13} color="#f59e0b" />
                    <span className="text-amber-400 font-semibold">{days} days left</span>
                    <span className="text-[#444]">· by {fmtShortDate(p.commitmentDate)}</span>
                  </div>
                  {remaining > 0 && (
                    <span className="bg-[#DDE048] text-black text-[12px] font-bold rounded-lg px-3 py-1.5">
                      Deposit {remaining.toFixed(2)} USDC
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Recent Activity + Completed */}
      <div className="grid grid-cols-[1fr_360px] gap-5 mb-8">
        {/* Recent Activity */}
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-base font-bold text-white">Recent activity</h2>
            <Link href="/notifications" className="text-[#DDE048] text-sm font-semibold hover:text-[#c8ce30]">
              View all activity →
            </Link>
          </div>
          <p className="text-[12px] text-[#555] mb-5">Latest on-chain events on your transfers</p>

          {allPledges.length === 0 && !loading && (
            <div className="text-[#555] text-sm py-6 text-center">No activity yet</div>
          )}

          <div className="space-y-0">
            {allPledges.flatMap((p): ActivityItem[] => {
              const meta = getPledgeMeta(p.merchant);
              const name = meta?.name || shortAddr(p.merchant);
              const items: ActivityItem[] = [];
              const days = daysLeft(p.commitmentDate);
              const status = Number(p.status);
              if (status === 0 && days <= 3) {
                items.push({ type: "warning", label: `Payment due in ${days} day${days !== 1 ? "s" : ""}`, sub: `Pledge ${shortAddr(p.id.toString())} · ${ethers.formatUnits(p.depositedAmount, 6)} USDC remaining`, time: "now" });
              }
              if (status === 1) {
                items.push({ type: "success", label: `Pledge ${shortAddr(p.id.toString())} completed`, sub: `${ethers.formatUnits(p.totalAmount, 6)} USDC released to ${name}`, time: fmtShortDate(p.commitmentDate) });
              }
              if (status === 2) {
                items.push({ type: "error", label: `Grace period started · ${shortAddr(p.id.toString())}`, sub: `Merchant can claim ${ethers.formatUnits(p.depositedAmount, 6)} USDC deposit after 14 days`, time: fmtShortDate(p.commitmentDate) });
              }
              if (status === 0) {
                items.push({ type: "info", label: `Pledge ${shortAddr(p.id.toString())} created`, sub: `${ethers.formatUnits(p.depositedAmount, 6)} USDC locked · ${name}`, time: fmtShortDate(p.commitmentDate) });
              }
              return items;
            }).slice(0, 6).map((item, i) => (
              <div key={i} className={`flex items-start gap-3.5 py-3.5 ${i > 0 ? "border-t border-[#1a1d24]" : ""}`}>
                <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                  item.type === "success" ? "bg-green-500/10" :
                  item.type === "warning" ? "bg-amber-400/10" :
                  item.type === "error"   ? "bg-red-500/10" :
                  "bg-blue-500/10"
                }`}>
                  {item.type === "success" && <CheckCircle2 size={14} color="#22c55e" />}
                  {item.type === "warning" && <AlertTriangle size={14} color="#f59e0b" />}
                  {item.type === "error"   && <AlertCircle size={14} color="#ef4444" />}
                  {item.type === "info"    && <PlusCircle size={14} color="#60a5fa" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white leading-snug">{item.label}</div>
                  <div className="text-[11px] text-[#555] font-mono mt-0.5">{item.sub}</div>
                </div>
                <div className="text-[11px] text-[#444] whitespace-nowrap shrink-0 mt-0.5">{item.time}</div>
              </div>
            ))}

            {rep && rep.onTime > 0 && (
              <div className="flex items-start gap-3.5 py-3.5 border-t border-[#1a1d24]">
                <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                  <Shield size={14} color="#22c55e" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Trust score updated</div>
                  <div className="text-[11px] text-[#555] mt-0.5">{rep.onTime} on-time payment{rep.onTime !== 1 ? "s" : ""} · current score {rep.score}</div>
                </div>
                <div className="text-[11px] text-[#444] whitespace-nowrap shrink-0 mt-0.5">–</div>
              </div>
            )}
          </div>
        </div>

        {/* Completed */}
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
          <h2 className="text-base font-bold text-white mb-0.5">Completed</h2>
          <p className="text-[12px] text-[#555] mb-5">{completedPledges.length} on-time release{completedPledges.length !== 1 ? "s" : ""}</p>

          {completedPledges.length === 0 && !loading && (
            <div className="text-[#555] text-sm py-6 text-center">No completed transfers yet</div>
          )}

          <div className="space-y-0">
            {completedPledges.map((p, i) => {
              const meta = getPledgeMeta(p.merchant);
              const name = meta?.name || shortAddr(p.merchant);
              const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
              return (
                <Link key={p.id.toString()} href={`/pledge/${p.id}`}
                  className={`flex items-center gap-3 py-3.5 hover:opacity-80 transition-opacity ${i > 0 ? "border-t border-[#1a1d24]" : ""}`}>
                  <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0 text-base">
                    🏢
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-bold text-white truncate">{name}</div>
                    <div className="text-[11px] text-[#555] font-mono">{shortAddr(p.merchant)} · {fmtShortDate(p.commitmentDate)}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-sm font-bold text-[#DDE048]">{total.toFixed(2)}</div>
                    <div className="text-[10px] text-[#555]">USDC</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── MOBILE LAYOUT ── */
  const MobileDashboard = (
    <div className="md:hidden">
      <Header />
      <div className="px-4 pt-5 pb-4">
        <div className="mb-3">
          <div className="text-[#888] text-[13px]">Welcome,</div>
          <div className="font-bold text-2xl">{shortAddr(account)}</div>
        </div>

        <div className="inline-flex items-center bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-3 py-[5px] text-[13px] text-[#ccc] mb-4 cursor-pointer" onClick={copyAddress}>
          <span>{copied ? "Copied!" : shortAddr(account)}</span>
          <Copy size={12} color={copied ? "#DDE048" : "#666"} className="ml-1.5" />
        </div>

        <div className="bg-gradient-to-r from-[#1B1E16] to-[#11141A] border border-[#2a2a2a] rounded-2xl p-5 mb-3.5">
          <div className="flex justify-between items-start">
            <div>
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1.5">USDC BALANCE</div>
              <div className="text-[38px] font-extrabold leading-none">
                {loading ? "–" : balance
                  ? currency === "PHP" ? fmt(parseFloat(balance)) : parseFloat(balance).toFixed(2)
                  : currency === "PHP" ? fmt(0) : "0.00"}
                <span className="text-base font-normal text-[#888]"> {currency === "PHP" ? "PHP" : "USDC"}</span>
              </div>
              {balance && <div className="text-xs text-[#888] mt-1.5">= {fmtAlt(parseFloat(balance))}</div>}
            </div>
            <div className="relative flex items-center justify-center">
              <Image src="/logo.png" alt="" width={72} height={72} style={{ position: "absolute", opacity: 0.08, filter: "grayscale(1)", objectFit: "contain", right: 20 }} />
              {rep && <CircularScore score={rep.score} size={90} />}
            </div>
          </div>
          <div className="flex gap-2.5 mt-[18px]">
            <Link href="/new-transfer" className="flex-1 bg-[#DDE048] text-black border-0 rounded-xl py-[13px] text-sm font-bold text-center block">+ New Transfer</Link>
            <Link href="/wallet" className="flex-1 bg-[#1e1e1e] text-white border border-[#1F2127] rounded-xl py-[13px] text-sm font-semibold text-center block">Top up</Link>
          </div>
        </div>

        {/* Cap + Balance row */}
        <div className="flex gap-3 mb-[22px]">
          <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
            <div className="flex items-center gap-1.5 mb-2">
              <TrendingUp size={11} color="#DDE048" />
              <div className="text-[10px] text-[#888] tracking-[1.5px]">ACTIVE CAP</div>
            </div>
            <div className="text-[28px] font-extrabold">{activePledges.length}<span className="text-[#888] font-normal text-lg"> / {maxActive ?? "–"}</span></div>
            <div className="h-[3px] bg-[#2a2a2a] rounded mt-2.5 mb-1.5">
              <div className="h-full bg-[#DDE048] rounded" style={{ width: maxActive ? `${(activePledges.length / maxActive) * 100}%` : "0%" }} />
            </div>
            <div className="text-[11px] text-[#555]">{maxActive ? maxActive - activePledges.length : "–"} slot{(maxActive ?? 0) - activePledges.length !== 1 ? "s" : ""} left</div>
          </div>
          <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">USDC BALANCE</div>
            <div className="text-[22px] font-extrabold leading-tight">
              {loading ? "–" : balance ? parseFloat(balance).toFixed(2) : "0.00"}
            </div>
            <div className="text-[11px] text-[#555] mb-2">≈ {balance ? fmtAlt(parseFloat(balance)) : "–"}</div>
            <Link href="/wallet" className="text-[11px] font-bold text-[#DDE048]">Top up →</Link>
          </div>
        </div>

        <div className="flex justify-between items-center mb-3.5">
          <span className="text-xs font-bold tracking-[1px] text-[#ccc]">ACTIVE TRANSFERS <span className="text-[#888]">•</span> {activePledges.length}</span>
          <Link href="/pledges" className="text-[#DDE048] text-[13px] font-semibold">See all</Link>
        </div>

        {loading && <LoadingSpinner />}

        {!loading && activePledges.length === 0 && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-9 px-5 text-center mb-3 flex flex-col items-center">
            <Inbox size={40} color="#444" className="mb-3" />
            <div className="font-bold text-base mb-1.5">No active transfers</div>
            <div className="text-[#888] text-[13px] mb-5">Create your first pledge to get started</div>
            <Link href="/new-transfer" className="inline-block bg-[#DDE048] text-black rounded-[10px] px-6 py-2.5 text-sm font-bold">+ New Transfer</Link>
          </div>
        )}

        {activePledges.map((p) => {
          const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
          const locked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
          const remaining = total - locked;
          const days = daysLeft(p.commitmentDate);
          const meta = getPledgeMeta(p.merchant);
          return (
            <Link key={p.id.toString()} href={`/pledge/${p.id}`} className="bg-[#11141A] border border-[#1F2127] rounded-[18px] p-4 mb-3 block text-inherit">
              <div className="flex justify-between items-start mb-2.5">
                <div>
                  <div className="font-bold text-[15px]">{meta?.name || shortAddr(p.merchant)}</div>
                  <div className="text-[11px] text-[#888] mt-0.5">{shortAddr(p.merchant)}</div>
                </div>
                <span className="bg-amber-400/15 text-amber-400 rounded-[20px] px-2.5 py-1 text-[11px] font-bold whitespace-nowrap">● PENDING</span>
              </div>
              <div className="text-[30px] font-extrabold">{total.toFixed(2)}<span className="text-[15px] text-[#888] ml-1.5">USDC</span></div>
              <div className="text-xs text-[#888] mb-2">= {fmt(total)}</div>
              <ProgressBar locked={locked} total={total} />
              <div className="flex justify-between text-[11px] text-[#888] mt-1 mb-2.5">
                <span className="text-[#DDE048]">{locked.toFixed(2)} locked</span>
                <span>{remaining.toFixed(2)} remaining</span>
              </div>
              {meta?.note && (
                <div className="flex items-center gap-1 text-[11px] text-[#888] mb-2.5">
                  <Info size={11} color="#666" />
                  <span>{meta.note}</span>
                </div>
              )}
              <div className="mb-3">
                <div className="flex items-center gap-1 text-xs">
                  <Clock size={12} color="#f59e0b" />
                  <span className="text-amber-400 font-semibold">{days} days left</span>
                  <span className="text-[#888]">· by {fmtDate(p.commitmentDate)}</span>
                </div>
              </div>
              {remaining > 0 && (
                <div className="bg-[#DDE048] text-black rounded-xl py-3 text-sm font-bold text-center w-full">Deposit {remaining.toFixed(2)} USDC</div>
              )}
            </Link>
          );
        })}

        {/* Recent Activity */}
        <div className="mt-2 mb-1 flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-white">Recent Activity</span>
            <div className="text-[11px] text-[#555] mt-0.5">Latest on-chain events on your transfers</div>
          </div>
          <Link href="/notifications" className="text-[#DDE048] text-[13px] font-semibold">See all →</Link>
        </div>

        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl mb-4">
          {allPledges.length === 0 && !loading && (
            <div className="text-[#555] text-sm py-6 text-center">No activity yet</div>
          )}
          {allPledges.flatMap((p): ActivityItem[] => {
            const meta = getPledgeMeta(p.merchant);
            const name = meta?.name || shortAddr(p.merchant);
            const items: ActivityItem[] = [];
            const days = daysLeft(p.commitmentDate);
            const status = Number(p.status);
            if (status === 0 && days <= 3) items.push({ type: "warning", label: `Payment due in ${days} day${days !== 1 ? "s" : ""}`, sub: `${shortAddr(p.id.toString())} · ${ethers.formatUnits(p.depositedAmount, 6)} USDC remaining`, time: "now" });
            if (status === 1) items.push({ type: "success", label: `Pledge ${shortAddr(p.id.toString())} completed`, sub: `${ethers.formatUnits(p.totalAmount, 6)} USDC released to ${name}`, time: fmtShortDate(p.commitmentDate) });
            if (status === 2) items.push({ type: "error", label: `Grace period started`, sub: `${shortAddr(p.id.toString())} · merchant can claim after 14 days`, time: fmtShortDate(p.commitmentDate) });
            if (status === 0) items.push({ type: "info", label: `Pledge created`, sub: `${ethers.formatUnits(p.depositedAmount, 6)} USDC locked · ${name}`, time: fmtShortDate(p.commitmentDate) });
            return items;
          }).slice(0, 5).map((item, i, arr) => (
            <div key={i} className={`flex items-start gap-3 px-4 py-3.5 ${i < arr.length - 1 ? "border-b border-[#1F2127]" : ""}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${
                item.type === "success" ? "bg-green-500/10" :
                item.type === "warning" ? "bg-amber-400/10" :
                item.type === "error"   ? "bg-red-500/10" : "bg-blue-500/10"
              }`}>
                {item.type === "success" && <CheckCircle2 size={13} color="#22c55e" />}
                {item.type === "warning" && <AlertTriangle size={13} color="#f59e0b" />}
                {item.type === "error"   && <AlertCircle size={13} color="#ef4444" />}
                {item.type === "info"    && <PlusCircle size={13} color="#60a5fa" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white leading-snug">{item.label}</div>
                <div className="text-[11px] text-[#555] font-mono mt-0.5 truncate">{item.sub}</div>
              </div>
              <div className="text-[10px] text-[#444] whitespace-nowrap shrink-0 mt-1">{item.time}</div>
            </div>
          ))}
          {rep && rep.onTime > 0 && (
            <div className="flex items-start gap-3 px-4 py-3.5 border-t border-[#1F2127]">
              <div className="w-7 h-7 rounded-full bg-green-500/10 flex items-center justify-center shrink-0 mt-0.5">
                <Shield size={13} color="#22c55e" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-semibold text-white">Trust score updated</div>
                <div className="text-[11px] text-[#555] mt-0.5">{rep.onTime} on-time payment{rep.onTime !== 1 ? "s" : ""} · score {rep.score}</div>
              </div>
            </div>
          )}
        </div>

        {/* Completed */}
        <div className="mb-1 flex items-center justify-between">
          <div>
            <span className="text-sm font-bold text-white">Completed</span>
            <div className="text-[11px] text-[#555] mt-0.5">{completedPledges.length} on-time release{completedPledges.length !== 1 ? "s" : ""}</div>
          </div>
          <Link href="/pledges" className="text-[#DDE048] text-[13px] font-semibold">See all →</Link>
        </div>

        {completedPledges.length === 0 && !loading && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl py-7 text-center text-[#555] text-sm mb-4">No completed transfers yet</div>
        )}

        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl mb-6">
          {completedPledges.map((p, i) => {
            const meta = getPledgeMeta(p.merchant);
            const name = meta?.name || shortAddr(p.merchant);
            const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
            return (
              <Link key={p.id.toString()} href={`/pledge/${p.id}`}
                className={`flex items-center gap-3 px-4 py-3.5 ${i < completedPledges.length - 1 ? "border-b border-[#1F2127]" : ""}`}>
                <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0 text-base">🏢</div>
                <div className="flex-1 min-w-0">
                  <div className="text-[13px] font-bold text-white truncate">{name}</div>
                  <div className="text-[11px] text-[#555] font-mono">{shortAddr(p.merchant)} · {fmtShortDate(p.commitmentDate)}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-sm font-bold text-[#DDE048]">{total.toFixed(2)}</div>
                  <div className="text-[10px] text-[#555]">USDC</div>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );

  return (
    <>
      {DesktopDashboard}
      {MobileDashboard}
    </>
  );
}

"use client";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Link2, Inbox, Clock, Check, CheckCircle2, AlertCircle, XCircle, Send } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import ProgressBar from "../../components/ProgressBar";
import { useCurrency } from "../../context/CurrencyContext";
import { getPledgeMeta } from "../../lib/pledgeMeta";

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };
const STATUS_BG: Record<string, string> = { PENDING: "#f59e0b22", COMPLETED: "#22c55e22", DEFAULTED: "#ef444422", CANCELLED: "#88888822" };
const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING: <Clock size={13} color="#f59e0b" />,
  COMPLETED: <CheckCircle2 size={13} color="#22c55e" />,
  DEFAULTED: <AlertCircle size={13} color="#ef4444" />,
  CANCELLED: <XCircle size={13} color="#888" />,
};

const TABS = ["All", "Sent", "Received"] as const;
type Tab = typeof TABS[number];

interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; }

function shortAddr(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }
function daysLeft(ts: bigint) { return Math.max(0, Math.ceil((Number(ts) - Date.now() / 1000) / 86400)); }
function fmtDate(ts: bigint) { return new Date(Number(ts) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

export default function Pledges() {
  const { account, connect, pledgeRead, walletLoading } = useWallet();
  const { fmt } = useCurrency();
  const [tab, setTab] = useState<Tab>("All");
  const [pledges, setPledges] = useState<PledgeRaw[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => { if (account) loadPledges(); }, [account, tab]);

  async function loadPledges() {
    setLoading(true);
    try {
      let ids: bigint[] = [];
      if (tab === "Sent" || tab === "All") ids = [...ids, ...(await pledgeRead.getSenderPledges(account)) as bigint[]];
      if (tab === "Received" || tab === "All") ids = [...ids, ...(await pledgeRead.getMerchantPledges(account)) as bigint[]];
      const unique = [...new Set(ids.map((id) => id.toString()))];
      const list = (await Promise.all(unique.map((id) => pledgeRead.getPledge(id)))) as PledgeRaw[];
      setPledges(list.slice().reverse());
    } finally { setLoading(false); }
  }

  if (walletLoading) return <LoadingSpinner fullScreen />;

  /* ── DESKTOP ── */
  const DesktopView = (
    <div className="hidden md:block p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-extrabold text-white">My Transfers</h1>
        <Link href="/new-transfer" className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors">
          <Send size={14} /> New Transfer
        </Link>
      </div>
      <p className="text-[#555] text-sm mb-6">All pledges you've sent or received on-chain.</p>

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-full text-sm font-semibold border transition-colors ${tab === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-transparent border-[#1e2230] text-[#555] hover:text-[#888]"}`}
          >{t}</button>
        ))}
      </div>

      {!account && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Link2 size={40} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">Wallet not connected</div>
          <div className="text-[#555] text-sm mb-5">Connect your wallet to view your transfers</div>
          <button onClick={connect} className="bg-[#DDE048] text-black font-bold rounded-xl px-8 py-2.5 text-sm">Connect MetaMask</button>
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && account && pledges.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox size={40} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">No transfers yet</div>
          <div className="text-[#555] text-sm mb-5">
            {tab === "Sent" ? "You haven't sent any transfers" : tab === "Received" ? "You haven't received any transfers" : "Create your first transfer to get started"}
          </div>
          <Link href="/new-transfer" className="bg-[#DDE048] text-black font-bold rounded-xl px-8 py-2.5 text-sm">+ New Transfer</Link>
        </div>
      )}

      {!loading && pledges.length > 0 && (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                {["COUNTERPARTY", "PLEDGE ID", "TOTAL", "LOCKED", "PROGRESS", "STATUS", "DEADLINE", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] tracking-[1.5px] font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pledges.map((p) => {
                const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
                const rawLocked = parseFloat(ethers.formatUnits(p.depositedAmount, 6));
                const locked = Number(p.status) === 1 ? total : rawLocked;
                const gross = total * 1.01;
                const status = STATUS[p.status];
                const isSent = account?.toLowerCase() === p.sender.toLowerCase();
                const counterparty = isSent ? p.merchant : p.sender;
                const meta = getPledgeMeta(counterparty);
                const days = daysLeft(p.commitmentDate);
                return (
                  <tr key={p.id.toString()} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors group">
                    <td className="px-5 py-4">
                      <div className="font-semibold text-white text-xs">{meta?.name || shortAddr(counterparty)}</div>
                      <div className="text-[10px] text-[#555] font-mono mt-0.5">{shortAddr(counterparty)}</div>
                      <div className="text-[10px] text-[#555] mt-0.5">{isSent ? "↑ Sent" : "↓ Received"}</div>
                    </td>
                    <td className="px-5 py-4 font-mono text-[#555] text-xs">#{p.id.toString()}</td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-white">{total.toFixed(2)} <span className="text-[#555] text-xs font-normal">USDC</span></div>
                      <div className="text-[10px] text-[#555]">{fmt(total)}</div>
                    </td>
                    <td className="px-5 py-4 text-[#DDE048] font-semibold">{locked.toFixed(2)}</td>
                    <td className="px-5 py-4 w-32">
                      <ProgressBar locked={locked} total={Number(p.status) === 1 ? total : gross} />
                      <div className="text-[10px] text-[#555] mt-0.5">{Number(p.status) === 1 ? 100 : total > 0 ? Math.round(locked / gross * 100) : 0}%</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full w-fit" style={{ color: STATUS_COLOR[status], background: STATUS_BG[status] }}>
                        {STATUS_ICON[status]} {status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-[#555]">
                      <div>{fmtDate(p.commitmentDate)}</div>
                      {status === "PENDING" && <div className="text-[#f59e0b] mt-0.5">{days}d left</div>}
                    </td>
                    <td className="px-5 py-4">
                      <Link href={`/pledge/${p.id}`} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline whitespace-nowrap">
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
    <div className="md:hidden">
      <Header title="My Pledges" />
      <div className="px-4 pt-5">
        <div className="flex gap-2 mb-5">
          {TABS.map((t) => (
            <button
              key={t}
              className={`px-5 py-2 rounded-[20px] text-[13px] cursor-pointer ${tab === t ? "bg-[rgba(212,255,0,0.1)] border border-[#DDE048] text-[#DDE048] font-semibold" : "bg-[#11141A] border border-[#1F2127] text-[#888]"}`}
              onClick={() => setTab(t)}
            >{t}</button>
          ))}
        </div>

        {!walletLoading && !account && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-10 px-6 text-center mb-3 flex flex-col items-center">
            <Link2 size={40} color="#444" className="mb-3" />
            <div className="font-bold text-base mb-1.5">Wallet not connected</div>
            <div className="text-[#888] text-[13px] mb-5">Connect your wallet to view your pledges</div>
            <button className="bg-[#DDE048] text-black border-0 rounded-xl px-7 py-3 text-sm font-bold cursor-pointer" onClick={connect}>Connect MetaMask</button>
          </div>
        )}

        {loading && <LoadingSpinner />}

        {!loading && account && pledges.length === 0 && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-10 px-6 text-center mb-3 flex flex-col items-center">
            <Inbox size={40} color="#444" className="mb-3" />
            <div className="font-bold text-base mb-1.5">No pledges yet</div>
            <div className="text-[#888] text-[13px] mb-5">{tab === "Sent" ? "You haven't sent any pledges" : tab === "Received" ? "You haven't received any pledges" : "Create your first pledge to get started"}</div>
            <Link href="/new-transfer" className="inline-block bg-[#DDE048] text-black rounded-xl px-7 py-3 text-sm font-bold">+ New Transfer</Link>
          </div>
        )}

        {pledges.map((p) => {
          const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
          const locked = Number(p.status) === 1 ? total : parseFloat(ethers.formatUnits(p.depositedAmount, 6));
          const status = STATUS[p.status];
          const days = daysLeft(p.commitmentDate);
          const deadline = new Date(Number(p.commitmentDate) * 1000);
          const isSent = account?.toLowerCase() === p.sender.toLowerCase();
          return (
            <Link key={p.id.toString()} href={`/pledge/${p.id}`} className="bg-[#11141A] border border-[#1F2127] rounded-[18px] p-4 mb-3 block text-inherit">
              <div className="flex justify-between items-start mb-2.5">
                <div>
                  {(() => { const meta = getPledgeMeta(isSent ? p.merchant : p.sender); return (<>
                    <div className="font-bold text-[15px]">{meta?.name || shortAddr(isSent ? p.merchant : p.sender)}</div>
                    <div className="text-[11px] text-[#888] mt-0.5">{shortAddr(isSent ? p.merchant : p.sender)}</div>
                  </>); })()}
                </div>
                <span className="px-2.5 py-1 rounded-[20px] text-[11px] font-bold whitespace-nowrap flex items-center gap-1" style={{ color: STATUS_COLOR[status], background: STATUS_COLOR[status] + "22" }}>
                  {status === "COMPLETED" ? <Check size={11} strokeWidth={3} /> : <span>●</span>}
                  {status}
                </span>
              </div>
              <div className="text-[26px] font-extrabold mb-0.5">{total.toFixed(2)} <span className="text-sm text-[#888]">USDC</span></div>
              <div className="text-xs text-[#888] mb-2">= {fmt(total)}</div>
              <ProgressBar locked={locked} total={total} />
              <div className="flex justify-between text-[11px] text-[#888] mt-0.5">
                <span className="text-[#DDE048]">{locked.toFixed(2)} locked</span>
                {status === "PENDING"
                  ? <span className="text-amber-400 flex items-center gap-1"><Clock size={11} color="#f59e0b" /> {days}d · {deadline.toLocaleDateString()} {deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</span>
                  : <span>{status.toLowerCase()}</span>}
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

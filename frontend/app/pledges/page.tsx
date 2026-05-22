"use client";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Link2, Inbox, Clock, Check } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import ProgressBar from "../../components/ProgressBar";
import { PHP_PER_USDC } from "../../contracts/addresses";
import { getPledgeMeta } from "../../lib/pledgeMeta";

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };
const TABS = ["All", "Sent", "Received"] as const;
type Tab = typeof TABS[number];

interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; }

function shortAddr(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }
function daysLeft(ts: bigint) { return Math.max(0, Math.ceil((Number(ts) - Date.now() / 1000) / 86400)); }

export default function Pledges() {
  const { account, connect, pledgeRead, walletLoading } = useWallet();
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
      setPledges((await Promise.all(unique.map((id) => pledgeRead.getPledge(id)))) as PledgeRaw[]);
    } finally { setLoading(false); }
  }

  if (walletLoading) return <LoadingSpinner fullScreen />;

  return (
    <div>
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

      {/* Not connected */}
      {!walletLoading && !account && (
        <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-10 px-6 text-center mb-3 flex flex-col items-center">
          <Link2 size={40} color="#444" className="mb-3" />
          <div className="font-bold text-base mb-1.5">Wallet not connected</div>
          <div className="text-[#888] text-[13px] mb-5">Connect your wallet to view your pledges</div>
          <button className="bg-[#DDE048] text-black border-0 rounded-xl px-7 py-3 text-sm font-bold cursor-pointer" onClick={connect}>Connect MetaMask</button>
        </div>
      )}

      {loading && <LoadingSpinner />}

      {/* Empty state */}
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
                {status === "COMPLETED"
                  ? <Check size={11} strokeWidth={3} />
                  : <span>●</span>}
                {status}
              </span>
            </div>
            <div className="text-[26px] font-extrabold mb-0.5">{total.toFixed(2)} <span className="text-sm text-[#888]">USDC</span></div>
            <div className="text-xs text-[#888] mb-2">= ₱{(total * PHP_PER_USDC).toLocaleString()} PHP</div>
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
}


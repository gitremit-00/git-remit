"use client";
import Header from "../components/Header";
import Image from "next/image";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Copy, Clock, Inbox, Info } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import CircularScore from "../components/CircularScore";
import ProgressBar from "../components/ProgressBar";
import { PHP_PER_USDC } from "../contracts/addresses";
import { getPledgeMeta } from "../lib/pledgeMeta";

interface RepState { score: number; onTime: number; total: number; }
interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; }

function daysLeft(ts: bigint) { return Math.max(0, Math.ceil((Number(ts) - Date.now() / 1000) / 86400)); }
function shortAddr(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }
function fmtDate(ts: bigint) { return new Date(Number(ts) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }

export default function Home() {
  const { account, connect, pledgeRead, usdcRead } = useWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [rep, setRep] = useState<RepState | null>(null);
  const [activePledges, setActivePledges] = useState<PledgeRaw[]>([]);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

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
      setRep({ score: Math.round(Number(repData.basisPoints) / 100), onTime: Number(repData.onTimeCount), total: Number(repData.totalCount) });
      setMaxActive(Number(maxAct));
      const details = await Promise.all((ids as bigint[]).map((id) => pledgeRead.getPledge(id)));
      setActivePledges((details as PledgeRaw[]).filter((p) => p.status === 0));
    } finally { setLoading(false); }
  }

  const scoreLabel = (s: number) => s >= 80 ? "EXCELLENT" : s >= 50 ? "GOOD" : s >= 20 ? "FAIR" : "POOR";

  if (!account) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <Image src="/logo.png" alt="RemitSafe" width={80} height={80} priority style={{ objectFit: "contain", marginBottom: 24 }} />
      <h2 className="text-2xl font-bold mb-2.5">OFW Payment Pledge</h2>
      <p className="text-[#888] mb-10 text-sm leading-relaxed max-w-[280px] text-center">
        Secure on-chain remittance commitments on Morph L2 Testnet
      </p>
      <button className="bg-[#DDE048] text-black border-0 rounded-[14px] px-12 py-4 text-base font-bold cursor-pointer" onClick={connect}>Connect MetaMask</button>
    </div>
  );

  return (
    <div>
      <Header />
    <div className="px-4 pt-5 pb-4">
    

      <div className="mb-3">
        <div className="text-[#888] text-[13px]">Welcome,</div>
        <div className="font-bold text-2xl">Juan</div>
      </div>

      <div className="inline-flex items-center bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-3 py-[5px] text-[13px] text-[#ccc] mb-4 cursor-pointer">
        <span>{shortAddr(account)}</span>
        <Copy size={12} color="#666" className="ml-1.5" />
      </div>

      <div className="bg-gradient-to-r from-[#1B1E16] to-[#11141A] border border-[#2a2a2a] rounded-2xl p-5 mb-3.5">
        <div className="flex justify-between items-start">
          <div>
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1.5">USDC BALANCE</div>
            <div className="text-[38px] font-extrabold leading-none">{loading ? "–" : balance ? parseFloat(balance).toFixed(2) : "0.00"}<span className="text-base font-normal text-[#888]"> USDC</span></div>
            {balance && <div className="text-xs text-[#888] mt-1.5">= ₱{(parseFloat(balance) * PHP_PER_USDC).toLocaleString()} PHP</div>}
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

      <div className="flex gap-3 mb-[22px]">
        <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">CAP</div>
          <div className="text-[28px] font-extrabold">{activePledges.length}<span className="text-[#888] font-normal text-lg"> / {maxActive ?? "–"}</span></div>
          <div className="h-[3px] bg-[#2a2a2a] rounded mt-2.5">
            <div className="h-full bg-[#DDE048] rounded" style={{ width: maxActive ? `${(activePledges.length / maxActive) * 100}%` : "0%" }} />
          </div>
        </div>
        <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">TRUST</div>
          <div className="flex items-baseline gap-1.5">
            <div className="text-[28px] font-extrabold text-[#DDE048]">{rep?.score ?? "–"}</div>
            {rep && <div className="text-[#DDE048] text-[11px] font-bold">{scoreLabel(rep.score)}</div>}
          </div>
          {rep && <div className="text-[11px] text-[#888] mt-1">{rep.onTime} / {rep.total} on time</div>}
        </div>
      </div>

      <div className="flex justify-between items-center mb-3.5">
        <span className="text-xs font-bold tracking-[1px] text-[#ccc]">ACTIVE TRANSFERS <span className="text-[#888]">•</span> {activePledges.length}</span>
        <Link href="/pledges" className="text-[#DDE048] text-[13px] font-semibold">See all</Link>
      </div>

      {loading && (
        <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-9 px-5 text-center mb-3 flex flex-col items-center">
          <div className="text-[#888] text-sm">Loading transfers...</div>
        </div>
      )}

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
            <div className="text-xs text-[#888] mb-2">= ₱{(total * PHP_PER_USDC).toLocaleString()} PHP</div>

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
    </div>
    </div>
  );
}


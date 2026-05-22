"use client";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Copy, LogOut, ShieldCheck, ArrowRight, Users } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import CircularScore from "../../components/CircularScore";
import { PHP_PER_USDC } from "../../contracts/addresses";

interface RepState { score: number; onTime: number; late: number; defaults: number; total: number; }
interface PledgeCounts { pending: number; completed: number; defaulted: number; cancelled: number; }

export default function Profile() {
  const { account, connect, disconnect, pledgeRead, usdcRead, walletLoading } = useWallet();
  const [rep, setRep] = useState<RepState | null>(null);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [reqPct, setReqPct] = useState<number | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [activePledges, setActivePledges] = useState<number>(0);
  const [counts, setCounts] = useState<PledgeCounts | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (account) loadAll(); }, [account]);

  async function loadAll() {
    const [repData, max, pct, bal, ids] = await Promise.all([
      pledgeRead.getReputation(account),
      pledgeRead.getMaxActivePledges(account),
      pledgeRead.getRequiredDepositPct(account),
      usdcRead.balanceOf(account),
      pledgeRead.getSenderPledges(account),
    ]);

    setRep({
      score: Math.round(Number(repData.basisPoints) / 100),
      onTime: Number(repData.onTimeCount),
      late: Number(repData.lateCount),
      defaults: Number(repData.defaultCount),
      total: Number(repData.totalCount),
    });
    setMaxActive(Number(max));
    setReqPct(Number(pct));
    setBalance(ethers.formatUnits(bal, 6));

    const pledgeList = await Promise.all((ids as bigint[]).map((id) => pledgeRead.getPledge(id)));
    const c = { pending: 0, completed: 0, defaulted: 0, cancelled: 0 };
    for (const p of pledgeList as { status: number }[]) {
      if (p.status === 0) c.pending++;
      else if (p.status === 1) c.completed++;
      else if (p.status === 2) c.defaulted++;
      else if (p.status === 3) c.cancelled++;
    }
    setActivePledges(c.pending);
    setCounts(c);
  }

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const scoreLabel = (s: number) => s >= 80 ? "EXCELLENT" : s >= 50 ? "GOOD" : s >= 20 ? "FAIR" : "POOR";

  if (walletLoading) return <LoadingSpinner fullScreen />;

  if (!account) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <Image src="/logo.png" alt="RemitSafe" width={80} height={80} priority style={{ objectFit: "contain", marginBottom: 24 }} />
      <h2 className="text-2xl font-bold mb-2.5">Your Profile</h2>
      <p className="text-[#888] mb-10 text-sm leading-relaxed max-w-[280px] text-center">
        Connect your wallet to view your trust score and limits
      </p>
      <button className="bg-[#DDE048] text-black border-0 rounded-[14px] px-12 py-4 text-base font-bold cursor-pointer" onClick={connect}>
        Connect MetaMask
      </button>
    </div>
  );

  return (
    <div>
      <Header title="Profile" />
      <div className="px-4 pt-5 pb-24">

        {/* Wallet address */}
        <div className="mb-3">
          <div className="text-[#888] text-[13px]">Your wallet,</div>
          <div className="font-bold text-2xl">{account.slice(0, 6)}...{account.slice(-4)}</div>
        </div>
        <div
          className="inline-flex items-center bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-3 py-[5px] text-[13px] text-[#ccc] mb-4 cursor-pointer"
          onClick={copyAddress}
        >
          <span>{copied ? "Copied!" : `${account.slice(0, 10)}...${account.slice(-8)}`}</span>
          <Copy size={12} color={copied ? "#DDE048" : "#666"} className="ml-1.5" />
        </div>

        {/* Trust score card */}
        <div className="bg-gradient-to-r from-[#1B1E16] to-[#11141A] border border-[#2a2a2a] rounded-2xl p-5 mb-3.5 relative overflow-hidden">
          <Image src="/logo.png" alt="" width={90} height={90}
            style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.06, filter: "grayscale(1)", objectFit: "contain", pointerEvents: "none" }}
          />
          <div className="flex justify-between items-start relative">
            <div>
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1.5">TRUST SCORE</div>
              <div className="text-[38px] font-extrabold leading-none text-[#DDE048]">
                {rep?.score ?? "–"}<span className="text-base font-normal text-[#888]"> / 100</span>
              </div>
              {rep && <div className="text-[#DDE048] text-[11px] font-bold mt-1.5">{scoreLabel(rep.score)}</div>}
            </div>
            {rep && <CircularScore score={rep.score} size={90} />}
          </div>
        </div>

        {/* Balance + Active pledges cap */}
        <div className="flex gap-3 mb-3.5">
          <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">USDC BALANCE</div>
            <div className="text-[28px] font-extrabold leading-none">
              {balance ? parseFloat(balance).toFixed(2) : "–"}
            </div>
            {balance && (
              <div className="text-[11px] text-[#888] mt-1">₱{(parseFloat(balance) * PHP_PER_USDC).toLocaleString()}</div>
            )}
          </div>
          <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">ACTIVE CAP</div>
            <div className="text-[28px] font-extrabold">
              {activePledges}<span className="text-[#888] font-normal text-lg"> / {maxActive ?? "–"}</span>
            </div>
            <div className="h-[3px] bg-[#2a2a2a] rounded mt-2.5">
              <div className="h-full bg-[#DDE048] rounded transition-all" style={{ width: maxActive ? `${(activePledges / maxActive) * 100}%` : "0%" }} />
            </div>
          </div>
        </div>

        {/* Pledge history breakdown */}
        {counts && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-3.5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px]">PLEDGE HISTORY</div>
              <Link href="/pledges" className="flex items-center gap-1 text-[#DDE048] text-[13px] font-semibold">
                See all <ArrowRight size={13} color="#DDE048" />
              </Link>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <HistoryStat label="Pending" value={counts.pending} color="#f59e0b" />
              <HistoryStat label="Completed" value={counts.completed} color="#22c55e" />
              <HistoryStat label="Defaulted" value={counts.defaulted} color="#ef4444" />
              <HistoryStat label="Cancelled" value={counts.cancelled} color="#888" />
            </div>
          </div>
        )}

        {/* Limits */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
          <div className="flex items-center gap-2 mb-3">
            <ShieldCheck size={15} color="#DDE048" />
            <div className="text-[10px] text-[#888] tracking-[1.5px]">YOUR LIMITS</div>
          </div>
          <div className="flex justify-between py-2.5 border-b border-[#1F2127] text-sm">
            <span className="text-[#888]">Max active pledges</span>
            <span className="font-extrabold text-[#DDE048]">{maxActive ?? "–"}</span>
          </div>
          <div className="flex justify-between py-2.5 border-b border-[#1F2127] text-sm">
            <span className="text-[#888]">Required deposit</span>
            <span className="font-extrabold text-[#DDE048]">{reqPct ?? "–"}% upfront</span>
          </div>
          <div className="flex justify-between py-2.5 text-sm">
            <span className="text-[#888]">Network</span>
            <span className="font-semibold text-white">Morph Hoodi Testnet</span>
          </div>
        </div>

        {/* Recipients shortcut */}
        <Link href="/recipients" className="w-full bg-[#11141A] border border-[#1F2127] rounded-2xl px-5 py-4 flex items-center justify-between mb-4 no-underline text-inherit">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center">
              <Users size={16} color="#DDE048" />
            </div>
            <div>
              <div className="font-semibold text-sm">Recipients</div>
              <div className="text-[11px] text-[#555]">Saved merchants & addresses</div>
            </div>
          </div>
          <ArrowRight size={16} color="#555" />
        </Link>

        {/* Disconnect */}
        <button
          type="button"
          className="w-full bg-[#11141A] border border-[#2a2a2a] text-red-400 rounded-[14px] py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2 cursor-pointer"
          onClick={disconnect}
        >
          <LogOut size={15} />
          Disconnect Wallet
        </button>
      </div>
    </div>
  );
}

function HistoryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-3 flex flex-col gap-1">
      <div className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: value > 0 ? color : "#333" }}>{value}</div>
      <div className="text-[10px] text-[#555] leading-tight">{label}</div>
    </div>
  );
}

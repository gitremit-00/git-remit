"use client";
import Header from "../../components/Header";
import { useEffect, useState } from "react";
import { UserCircle, LogOut, ShieldCheck } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import CircularScore from "../../components/CircularScore";

interface RepState { score: number; onTime: number; late: number; defaults: number; total: number; }

export default function Profile() {
  const { account, connect, disconnect, pledgeRead } = useWallet();
  const [rep, setRep] = useState<RepState | null>(null);
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [reqPct, setReqPct] = useState<number | null>(null);

  useEffect(() => { if (account) loadRep(); }, [account]);

  async function loadRep() {
    const [repData, max, pct] = await Promise.all([
      pledgeRead.getReputation(account),
      pledgeRead.getMaxActivePledges(account),
      pledgeRead.getRequiredDepositPct(account),
    ]);
    setRep({ score: Math.round(Number(repData.basisPoints) / 100), onTime: Number(repData.onTimeCount), late: Number(repData.lateCount), defaults: Number(repData.defaultCount), total: Number(repData.totalCount) });
    setMaxActive(Number(max));
    setReqPct(Number(pct));
  }

  const scoreLabel = (s: number) => s >= 80 ? "EXCELLENT" : s >= 50 ? "GOOD" : s >= 20 ? "FAIR" : "POOR";
  const scoreColor = (s: number) => s >= 80 ? "#22c55e" : s >= 50 ? "#DDE048" : s >= 20 ? "#f59e0b" : "#ef4444";

  return (
    <div className="px-4 pt-5">
      <Header title="Profile" />
      {!account ? (
        <button className="w-full bg-[#DDE048] text-black border-0 rounded-[14px] py-4 text-base font-bold cursor-pointer" onClick={connect}>Connect MetaMask</button>
      ) : (
        <>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] p-4 flex items-center gap-3.5 mb-4">
            <div className="w-12 h-12 bg-[#1e1e1e] rounded-full flex items-center justify-center">
              <UserCircle size={28} color="#888" />
            </div>
            <div>
              <div className="font-mono text-sm font-semibold mb-0.5">{account.slice(0, 10)}...{account.slice(-8)}</div>
              <div className="text-xs text-[#888]">Morph Hoodi Testnet</div>
            </div>
          </div>

          {rep && (
            <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] p-5 mb-4">
              <div className="flex justify-between items-center mb-4">
                <div>
                  <div className="text-[11px] text-[#888] tracking-[1px] mb-1">TRUST SCORE</div>
                  <div className="text-[32px] font-extrabold" style={{ color: scoreColor(rep.score) }}>{rep.score}</div>
                  <div className="font-bold text-sm" style={{ color: scoreColor(rep.score) }}>{scoreLabel(rep.score)}</div>
                </div>
                <CircularScore score={rep.score} size={80} />
              </div>
              <div className="flex justify-around border-t border-[#1F2127] pt-4">
                <RepStat label="On time" value={rep.onTime} color="#22c55e" />
                <RepStat label="Late" value={rep.late} color="#f59e0b" />
                <RepStat label="Defaults" value={rep.defaults} color="#ef4444" />
                <RepStat label="Total" value={rep.total} color="#888" />
              </div>
            </div>
          )}

          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={16} color="#DDE048" />
              <div className="font-bold">Your Limits</div>
            </div>
            <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#888]">Max active pledges</span><span className="font-semibold text-[#DDE048]">{maxActive ?? "–"}</span></div>
            <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#888]">Required deposit</span><span className="font-semibold text-[#DDE048]">{reqPct ?? "–"}% upfront</span></div>
          </div>

          <button className="w-full bg-[#11141A] border border-red-500 text-red-500 rounded-[14px] py-[14px] text-[15px] font-semibold flex items-center justify-center cursor-pointer" onClick={disconnect}>
            <LogOut size={15} className="mr-2" />Disconnect Wallet
          </button>
        </>
      )}
    </div>
  );
}

function RepStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="text-center">
      <div className="text-xl font-bold" style={{ color }}>{value}</div>
      <div className="text-[11px] text-[#888]">{label}</div>
    </div>
  );
}


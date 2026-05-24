"use client";
import { Search, Bell, ChevronRight } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";

function shortName(addr: string) { return addr.slice(0, 6) + "…" + addr.slice(-4); }

export default function DesktopTopbar() {
  const { account, pledgeRead } = useWallet();
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (!account) return;
    pledgeRead.getReputation(account)
      .then((r: { basisPoints: bigint }) => setScore(Math.round(Number(r.basisPoints) / 100)))
      .catch(() => {});
  }, [account]);

  const scoreLabel = (s: number) => s >= 80 ? "EXCELLENT" : s >= 50 ? "GOOD" : s >= 20 ? "FAIR" : "POOR";
  const scoreColor = (s: number) => s >= 80 ? "#22c55e" : s >= 50 ? "#DDE048" : s >= 20 ? "#f59e0b" : "#ef4444";

  return (
    <header className="hidden md:flex items-center gap-4 px-6 py-3 border-b border-[#1a1d24] bg-[#0e1014] sticky top-0 z-40">
      {/* Search */}
      <div className="flex-1 max-w-[480px]">
        <div className="flex items-center gap-2.5 bg-[#13161c] border border-[#1e2230] rounded-xl px-3.5 py-2.5">
          <Search size={15} color="#444" />
          <input
            type="text"
            placeholder="Search pledges, wallets, merchants..."
            className="bg-transparent text-sm text-[#888] placeholder-[#444] outline-none flex-1"
          />
          <span className="text-[11px] text-[#333] bg-[#1a1d24] rounded px-1.5 py-0.5 font-mono">⌘K</span>
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Currency corridor */}
        <div className="flex items-center gap-1.5 bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-2 text-[12px] text-[#888]">
          <span className="text-[10px] text-[#555]">US</span>
          <span>USD</span>
          <ChevronRight size={12} color="#444" />
          <span className="text-[10px] text-[#555]">PH</span>
          <span>PHP</span>
        </div>

        {/* Network */}
        <div className="flex items-center gap-1.5 bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-2 text-[12px] text-[#888]">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          <span>Morph L2</span>
        </div>

        {/* Notifications */}
        <Link href="/notifications" className="relative w-9 h-9 flex items-center justify-center bg-[#13161c] border border-[#1e2230] rounded-xl">
          <Bell size={16} color="#888" />
        </Link>

        {/* User avatar */}
        {account && (
          <Link href="/profile" className="flex items-center gap-2.5 bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-2">
            <div className="w-7 h-7 rounded-full bg-[#DDE048] flex items-center justify-center text-black text-[11px] font-bold">
              {account.slice(2, 4).toUpperCase()}
            </div>
            <div className="text-right">
              <div className="text-[12px] font-semibold text-white leading-none">{shortName(account)}</div>
              {score !== null && (
                <div className="text-[10px] font-bold mt-0.5" style={{ color: scoreColor(score) }}>
                  {score} · {scoreLabel(score)}
                </div>
              )}
            </div>
          </Link>
        )}
      </div>
    </header>
  );
}

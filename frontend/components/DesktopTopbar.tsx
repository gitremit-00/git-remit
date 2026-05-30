"use client";
import { Search, Bell, ChevronRight, LogOut } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import { useCurrency } from "../context/CurrencyContext";
import { useRole } from "../context/RoleContext";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";


export default function DesktopTopbar() {
  const { account, accountId, pledgeRead, disconnect } = useWallet();
  const { currency, toggle } = useCurrency();
  const { avatarUrl, displayName } = useRole();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    document.cookie = "rs_role=; path=/; max-age=0";
    disconnect();
    window.location.replace("/login");
  }
  const [score, setScore] = useState<number | null>(null);

  useEffect(() => {
    if (!accountId) return;
    pledgeRead.getAccountTrustScore(accountId)
      .then((s: bigint) => setScore(Math.round(Number(s) / 100)))
      .catch(() => {});
  }, [accountId]);

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
        {/* Currency toggle */}
        <button
          onClick={toggle}
          title="Switch display currency"
          className="flex items-center gap-1.5 bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-2 text-[12px] text-[#888] hover:border-[#333] transition-colors"
        >
          <span className={currency === "USD" ? "text-white font-semibold" : "text-[#555]"}>USD</span>
          <ChevronRight size={12} color="#444" />
          <span className={currency === "PHP" ? "text-white font-semibold" : "text-[#555]"}>PHP</span>
        </button>

        {/* Notifications */}
        <Link href="/notifications" className="relative w-9 h-9 flex items-center justify-center bg-[#13161c] border border-[#1e2230] rounded-xl">
          <Bell size={16} color="#888" />
        </Link>

        {/* User avatar — only when wallet connected */}
        {account && (
          <Link href="/profile" className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] rounded-xl px-2.5 py-2">
            <div className="w-7 h-7 rounded-full overflow-hidden bg-[#DDE048] flex items-center justify-center text-black text-[11px] font-bold shrink-0">
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                : (displayName ?? account).slice(0, 1).toUpperCase()
              }
            </div>
            {score !== null && (
              <div className="text-[11px] font-bold" style={{ color: scoreColor(score) }}>
                {score}
              </div>
            )}
          </Link>
        )}

        {/* Log out — always visible when session exists */}
        <button
          type="button"
          onClick={logout}
          className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold rounded-xl px-3 py-2 hover:border-red-500/40 transition-colors"
        >
          <LogOut size={14} /> Log out
        </button>
      </div>
    </header>
  );
}

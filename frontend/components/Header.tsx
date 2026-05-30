"use client";
import { ArrowLeft, Bell, LogOut, Wallet, ChevronDown, Star } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "./Logo";
import { useEffect, useRef, useState } from "react";
import { useRole } from "../context/RoleContext";
import { useWallet } from "../context/WalletContext";

const NOTIF_DIRTY_KEY = "remitsafe_notif_dirty";

interface HeaderProps {
  title?: string;
  back?: boolean;
  onBack?: () => void;
}

export default function Header({ title, back, onBack }: HeaderProps) {
  const router = useRouter();
  const [hasUnread, setHasUnread] = useState(false);
  const [walletOpen, setWalletOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const { avatarUrl, displayName } = useRole();
  const { account, activeWallet, linkedWallets, disconnect } = useWallet();

  useEffect(() => {
    function checkUnread() {
      try {
        setHasUnread(localStorage.getItem(NOTIF_DIRTY_KEY) === "true");
      } catch {
        setHasUnread(false);
      }
    }
    checkUnread();
    window.addEventListener("storage", checkUnread);
    return () => window.removeEventListener("storage", checkUnread);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setWalletOpen(false);
      }
    }
    if (walletOpen) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [walletOpen]);

  const primaryWallet = linkedWallets.find(w => w.isPrimary) ?? linkedWallets[0];

  return (
    <div className="bg-[#11141A] border-b border-[#1e2230] px-4 py-3 flex items-center justify-between sticky top-0 z-50 mb-5 w-full md:hidden">
      <div className="flex items-center gap-2.5">
        {back && (
          <button onClick={() => onBack ? onBack() : router.back()} className="bg-transparent border-0 cursor-pointer flex p-0">
            <ArrowLeft size={20} color="#fff" />
          </button>
        )}
        <Logo />
      </div>

      {title && <span className="text-sm font-semibold text-white">{title}</span>}

      <div className="flex items-center gap-2">
        <Link href="/notifications" className="relative bg-[#11141A] rounded-[10px] w-9 h-9 flex items-center justify-center border border-[#1F2127]">
          <Bell size={18} color="#ccc" />
          {hasUnread && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#DDE048] border-2 border-[#11141A]" />
          )}
        </Link>
        {account && (
          <>
            {/* Wallet picker (shown only if linked wallets exist) */}
            {linkedWallets.length > 0 && (
              <div className="relative" ref={dropdownRef}>
                <button
                  type="button"
                  onClick={() => setWalletOpen(v => !v)}
                  className="flex items-center gap-1 bg-[#1a1d24] border border-[#1F2127] rounded-[10px] px-2 h-9 text-[11px] text-[#ccc]"
                >
                  <Wallet size={13} color="#DDE048" />
                  <span className="font-mono">{(activeWallet ?? account).slice(0, 6)}…</span>
                  <ChevronDown size={11} />
                </button>
                {walletOpen && (
                  <div className="absolute right-0 top-11 bg-[#13161c] border border-[#1e2230] rounded-xl shadow-xl min-w-[220px] z-50 overflow-hidden">
                    {linkedWallets.map(w => (
                      <div key={w.address} className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1e2230] last:border-b-0">
                        {w.isPrimary && <Star size={11} className="text-[#DDE048] fill-[#DDE048] shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="text-[11px] font-mono text-white">
                            {w.address.slice(0, 10)}…{w.address.slice(-6)}
                          </div>
                          {w.address.toLowerCase() === activeWallet?.toLowerCase() && (
                            <div className="text-[10px] text-green-400">Active</div>
                          )}
                        </div>
                      </div>
                    ))}
                    <Link
                      href="/wallets"
                      onClick={() => setWalletOpen(false)}
                      className="flex items-center justify-center gap-1.5 px-3 py-2.5 text-[11px] text-[#DDE048] font-semibold border-t border-[#1e2230] hover:bg-[#1a1d24] transition-colors"
                    >
                      <Wallet size={11} /> Manage wallets
                    </Link>
                  </div>
                )}
              </div>
            )}

            <Link href="/profile" className="w-9 h-9 rounded-[10px] overflow-hidden bg-[#DDE048] border border-[#1F2127] flex items-center justify-center text-black text-[11px] font-bold shrink-0">
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" className="w-full h-full object-cover" />
                : (displayName ?? account).slice(0, 1).toUpperCase()
              }
            </Link>
            <button
              type="button"
              onClick={disconnect}
              aria-label="Log out"
              className="bg-red-500/10 rounded-[10px] w-9 h-9 flex items-center justify-center border border-red-500/20"
            >
              <LogOut size={17} color="#f87171" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

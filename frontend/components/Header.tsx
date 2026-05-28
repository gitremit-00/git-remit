"use client";
import { ArrowLeft, Bell, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "./Logo";
import { useEffect, useState } from "react";
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
  const { avatarUrl, displayName } = useRole();
  const { account, disconnect } = useWallet();

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

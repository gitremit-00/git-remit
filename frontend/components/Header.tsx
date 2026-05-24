"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Logo from "./Logo";
import { useEffect, useState } from "react";
import { Bell } from "lucide-react";

const STORAGE_KEY = "remitsafe_read_notifs";
const NOTIF_COUNT_KEY = "remitsafe_notif_count";

interface HeaderProps {
  title?: string;
  back?: boolean;
  onBack?: () => void;
}

export default function Header({ title, back, onBack }: HeaderProps) {
  const router = useRouter();
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    // Show badge if stored notification count exceeds read count
    try {
      const total = parseInt(localStorage.getItem(NOTIF_COUNT_KEY) ?? "0");
      const read = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]").length;
      setHasUnread(total > read);
    } catch {
      setHasUnread(false);
    }
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

      <Link href="/notifications" className="relative bg-[#11141A] rounded-[10px] w-9 h-9 flex items-center justify-center border border-[#1F2127]">
        <Bell size={18} color="#ccc" />
        {hasUnread && (
          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-[#DDE048] border-2 border-[#11141A]" />
        )}
      </Link>
    </div>
  );
}

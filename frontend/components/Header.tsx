"use client";
import { Bell } from "lucide-react";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import Logo from "./Logo";

interface HeaderProps {
  title?: string;
  back?: boolean;
}

export default function Header({ title, back }: HeaderProps) {
  const router = useRouter();
  return (
    <div className="bg-[#11141A] border-b border-[#1e2230] px-4 py-3 flex items-center justify-between sticky top-0 z-50 mb-5 w-full max-w-[430px]">
      <div className="flex items-center gap-2.5">
        {back && (
          <button onClick={() => router.back()} className="bg-transparent border-0 cursor-pointer flex p-0">
            <ArrowLeft size={20} color="#fff" />
          </button>
        )}
        <Logo />
      </div>

      {title && <span className="text-sm font-semibold text-white">{title}</span>}

      <div className="bg-[#11141A] rounded-[10px] w-9 h-9 flex items-center justify-center border border-[#1F2127]">
        <Bell size={18} color="#ccc" />
      </div>
    </div>
  );
}


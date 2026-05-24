"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, FileText, Plus, Wallet, User } from "lucide-react";

const navItems = [
  { href: "/", label: "Home", Icon: Home },
  { href: "/pledges", label: "Pledges", Icon: FileText },
  { href: "/new-transfer", label: "", Icon: Plus, fab: true },
  { href: "/wallet", label: "Wallet", Icon: Wallet },
  { href: "/profile", label: "Profile", Icon: User },
];

export default function BottomNav() {
  const pathname = usePathname();
  return (
    <nav className="fixed bottom-0 left-0 right-0 w-full bg-[#111] border-t border-[#1e1e1e] flex items-center justify-around px-4 pt-2.5 pb-5 z-[150] md:hidden">
      {navItems.map(({ href, label, Icon, fab }) => {
        const active = pathname === href;
        if (fab) return (
          <Link key={href} href={href} className="w-[52px] h-[52px] rounded-[18px] bg-[#DDE048] flex items-center justify-center -mt-5 shadow-[0_4px_20px_rgba(212,255,0,0.35)]">
            <Icon size={22} color="#000" strokeWidth={2.5} />
          </Link>
        );
        return (
          <Link key={href} href={href} className={`flex flex-col items-center gap-1 text-[11px] font-medium no-underline ${active ? "text-[#DDE048]" : "text-[#666]"}`}>
            <Icon size={22} color={active ? "#DDE048" : "#666"} />
            <span className="text-[10px]">{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

"use client";
import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Send, FileText, Users, Wallet, Bell, Shield, Settings, HelpCircle } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import { useRole } from "../context/RoleContext";
import Logo from "./Logo";
import Image from "next/image";
import MetaMaskGate from "./MetaMaskGate";

const senderNav = [
  { href: "/", label: "Dashboard", Icon: Home },
  { href: "/new-transfer", label: "New transfer", Icon: Send, arrow: true },
  { href: "/pledges", label: "My Transfers", Icon: FileText },
  { href: "/recipients", label: "Recipients", Icon: Users },
  { href: "/wallet", label: "Wallet", Icon: Wallet },
  { href: "/notifications", label: "Activity", Icon: Bell, badge: true },
  { href: "/profile", label: "Profile · Trust", Icon: Shield },
];

const merchantNav = [
  { href: "/merchant", label: "Dashboard", Icon: Home },
  { href: "/merchant/transfers", label: "Incoming Transfers", Icon: FileText },
  { href: "/wallet", label: "Wallet", Icon: Wallet },
  { href: "/notifications", label: "Activity", Icon: Bell, badge: true },
  { href: "/profile", label: "Profile", Icon: Shield },
];

const navBottom = [
  { href: "/settings", label: "Settings", Icon: Settings },
  { href: "/help", label: "Help", Icon: HelpCircle },
];

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }

export default function DesktopSidebar() {
  const pathname = usePathname();
  const { account, connect } = useWallet();
  const { role } = useRole();
  const isMerchant = role === "merchant";
  const navMain = isMerchant ? merchantNav : senderNav;
  const roleLabel = isMerchant ? "MERCHANT" : "OFW SENDER";

  return (
    <aside className="hidden md:flex flex-col w-[260px] min-h-screen bg-[#0e1014] border-r border-[#1a1d24] fixed left-0 top-0 bottom-0 z-50">
      {/* Logo + role */}
      <div className="px-5 pt-5 pb-4 border-b border-[#1a1d24]">
        <Logo />
        <div className="flex items-center gap-2 mt-4">
          <span className="w-2 h-2 rounded-full bg-[#DDE048]" />
          <span className="text-[11px] font-bold text-[#DDE048] tracking-[1.5px]">{roleLabel}</span>
        </div>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-3 py-4 flex flex-col gap-0.5">
        {navMain.map(({ href, label, Icon, arrow, badge }: { href: string; label: string; Icon: React.ElementType; arrow?: boolean; badge?: boolean }) => {
          const active = pathname === href || (href !== "/" && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors group ${
                active
                  ? "bg-[#1a1e14] text-white"
                  : "text-[#666] hover:text-[#ccc] hover:bg-[#15171c]"
              }`}
            >
              <Icon size={17} color={active ? "#DDE048" : "currentColor"} />
              <span className="flex-1">{label}</span>
              {arrow && <span className="text-[#444] text-xs group-hover:text-[#666]">→</span>}
              {badge && <span className="w-2 h-2 rounded-full bg-[#DDE048]" />}
            </Link>
          );
        })}

        <div className="my-3 border-t border-[#1a1d24]" />

        {navBottom.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active ? "bg-[#1a1e14] text-white" : "text-[#555] hover:text-[#ccc] hover:bg-[#15171c]"
              }`}
            >
              <Icon size={17} color={active ? "#DDE048" : "currentColor"} />
              {label}
            </Link>
          );
        })}
      </nav>

      {/* Wallet status at bottom */}
      <div className="px-4 py-4 border-t border-[#1a1d24]">
        {account ? (
          <div className="bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-[11px] text-[#888] font-medium">METAMASK · MORPH L2</span>
            </div>
            <div className="text-sm font-bold text-white font-mono">{shortAddr(account)}</div>
          </div>
        ) : (
          <MetaMaskGate>{null}</MetaMaskGate>
        )}
      </div>
    </aside>
  );
}

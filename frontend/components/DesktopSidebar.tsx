"use client";
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Send, FileText, Users, Wallet, Bell, Shield, Settings, HelpCircle, PanelLeftClose, PanelLeftOpen, ChevronRight, ClipboardList } from "lucide-react";
import { useWallet } from "../context/WalletContext";
import { useRole } from "../context/RoleContext";
import Logo from "./Logo";
import Image from "next/image";
import MetaMaskGate from "./MetaMaskGate";
import { useSidebar } from "../context/SidebarContext";

const NOTIF_DIRTY_KEY = "remitsafe_notif_dirty";

const senderNav = [
  { href: "/", label: "Dashboard", Icon: Home },
  { href: "/new-transfer", label: "New transfer", Icon: Send, arrow: true },
  { href: "/pledges", label: "My Transfers", Icon: FileText },
  { href: "/pledges/requests", label: "My Requests", Icon: ClipboardList },
  { href: "/recipients", label: "Recipients", Icon: Users },
  { href: "/wallets", label: "Wallet", Icon: Wallet },
  { href: "/notifications", label: "Activity", Icon: Bell, badge: true },
  { href: "/profile", label: "Profile · Trust", Icon: Shield },
];

const merchantNav = [
  { href: "/merchant", label: "Dashboard", Icon: Home },
  { href: "/merchant/transfers", label: "Incoming Transfers", Icon: FileText },
  { href: "/wallets", label: "Wallet", Icon: Wallet },
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

  const { collapsed, toggle } = useSidebar();
  const [hasUnread, setHasUnread] = useState(false);

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
  }, [pathname]);

  const w = collapsed ? "w-[68px]" : "w-[260px]";

  return (
    <aside className={`hidden md:flex flex-col ${w} min-h-screen bg-[#0e1014] border-r border-[#1a1d24] fixed left-0 top-0 bottom-0 z-50 transition-[width] duration-200 overflow-hidden`}>
      {/* Logo + role + collapse toggle */}
      <div className={`px-3 pt-5 pb-4 border-b border-[#1a1d24] flex items-start ${collapsed ? "justify-center" : "justify-between"}`}>
        {!collapsed && (
          <div>
            <Logo />
            <div className="flex items-center gap-2 mt-4">
              <span className="w-2 h-2 rounded-full bg-[#DDE048]" />
              <span className="text-[11px] font-bold text-[#DDE048] tracking-[1.5px]">{roleLabel}</span>
            </div>
          </div>
        )}
        <button
          onClick={toggle}
          className={`w-8 h-8 rounded-lg flex items-center justify-center text-[#555] hover:text-[#ccc] hover:bg-[#15171c] transition-colors shrink-0 ${collapsed ? "" : "mt-1"}`}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>
      </div>

      {/* Main nav */}
      <nav className="flex-1 px-2 py-4 flex flex-col gap-0.5">
        {navMain.map(({ href, label, Icon, arrow, badge }: { href: string; label: string; Icon: React.ElementType; arrow?: boolean; badge?: boolean }) => {
          const active = pathname === href || (href.split("/").length > 2 && pathname.startsWith(href + "/"));
          return (
            <div key={href} className="relative">
              {active && (
                <span className="absolute -left-2 top-1/2 -translate-y-1/2 w-[3px] h-5 bg-[#DDE048] rounded-r-full" />
              )}
              <Link
                href={href}
                title={collapsed ? label : undefined}
                className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-colors group ${
                  active ? "bg-[#1a1e14] text-white" : "text-[#666] hover:text-[#ccc] hover:bg-[#15171c]"
                } ${collapsed ? "justify-center" : ""}`}
              >
                <Icon size={17} color={active ? "#DDE048" : "currentColor"} className="shrink-0" />
                {!collapsed && <span className="flex-1 truncate">{label}</span>}
                {!collapsed && arrow && <ChevronRight size={13} color="#444" className="group-hover:text-[#666]" />}
                {!collapsed && badge && hasUnread && <span className="w-2 h-2 rounded-full bg-[#DDE048]" />}
                {collapsed && badge && hasUnread && <span className="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full bg-[#DDE048]" />}
              </Link>
            </div>
          );
        })}

        <div className="my-3 border-t border-[#1a1d24]" />

        {navBottom.map(({ href, label, Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                active ? "bg-[#1a1e14] text-white" : "text-[#555] hover:text-[#ccc] hover:bg-[#15171c]"
              } ${collapsed ? "justify-center" : ""}`}
            >
              <Icon size={17} color={active ? "#DDE048" : "currentColor"} className="shrink-0" />
              {!collapsed && label}
            </Link>
          );
        })}
      </nav>

      {/* Wallet status at bottom */}
      <div className="px-2 py-4 border-t border-[#1a1d24]">
        {collapsed ? (
          <div className="flex justify-center">
            <div className={`w-2.5 h-2.5 rounded-full ${account ? "bg-green-400" : "bg-[#333]"}`} title={account ? shortAddr(account) : "Not connected"} />
          </div>
        ) : account ? (
          <div className="bg-[#13161c] border border-[#1e2230] rounded-xl px-3 py-3">
            <div className="flex items-center gap-2 mb-1">
              <span className="w-2 h-2 rounded-full bg-green-400" />
              <span className="text-[11px] text-[#888] font-medium">METAMASK · CONNECTED</span>
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

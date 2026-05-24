"use client";
import React from "react";
import { Bell, Shield, Wallet, Globe, Moon, Trash2, ChevronRight } from "lucide-react";
import Header from "../../components/Header";

type SettingsItem = { icon: React.ElementType; label: string; sub: string; href?: string; badge?: string; toggle?: boolean; danger?: boolean; };

const sections: { title: string; items: SettingsItem[] }[] = [
  {
    title: "Account",
    items: [
      { icon: Wallet, label: "Connected Wallet", sub: "View and manage your MetaMask connection", href: "/wallet" },
      { icon: Shield, label: "Identity & KYC", sub: "Facial verification and identity documents", badge: "Coming soon" },
    ],
  },
  {
    title: "Notifications",
    items: [
      { icon: Bell, label: "Payment reminders", sub: "Get alerted 3 days and 1 day before deadline", toggle: true },
      { icon: Bell, label: "Grace period alerts", sub: "Notify when grace period starts or ends", toggle: true },
      { icon: Bell, label: "Pledge completed", sub: "Notify when funds are released to merchant", toggle: true },
    ],
  },
  {
    title: "Network",
    items: [
      { icon: Globe, label: "Blockchain network", sub: "Morph L2 · Hoodi Testnet · chainId 2818", badge: "Active" },
      { icon: Globe, label: "Currency corridor", sub: "USA → Philippines · 1 USDC ≈ ₱56", href: "/wallet" },
    ],
  },
  {
    title: "Appearance",
    items: [
      { icon: Moon, label: "Theme", sub: "Dark mode", badge: "Dark" },
    ],
  },
  {
    title: "Data",
    items: [
      { icon: Trash2, label: "Clear local data", sub: "Remove saved merchant names, notes, and preferences", danger: true },
    ],
  },
];

export default function Settings() {
  return (
    <>
      {/* Desktop */}
      <div className="hidden md:block p-8">
        <h1 className="text-3xl font-extrabold text-white mb-1">Settings</h1>
        <p className="text-[#555] text-sm mb-8">Manage your account, notifications, and preferences.</p>
        <div className="max-w-2xl space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">{section.title.toUpperCase()}</div>
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
                {section.items.map((item, i) => (
                  <div key={item.label} className={`flex items-center gap-4 px-5 py-4 ${i < section.items.length - 1 ? "border-b border-[#1e2230]" : ""} ${item.danger ? "hover:bg-red-500/5" : "hover:bg-[#15181f]"} transition-colors cursor-pointer`}>
                    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${item.danger ? "bg-red-500/10" : "bg-[#1e2230]"}`}>
                      <item.icon size={16} color={item.danger ? "#ef4444" : "#888"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${item.danger ? "text-red-400" : "text-white"}`}>{item.label}</div>
                      <div className="text-xs text-[#555] mt-0.5">{item.sub}</div>
                    </div>
                    {item.badge && (
                      <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#1e2230] text-[#888]">{item.badge}</span>
                    )}
                    {item.toggle && (
                      <div className="w-10 h-6 bg-[#DDE048]/20 border border-[#DDE048]/30 rounded-full flex items-center px-1">
                        <div className="w-4 h-4 rounded-full bg-[#DDE048]" />
                      </div>
                    )}
                    {!item.badge && !item.toggle && (
                      <ChevronRight size={16} color="#333" />
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden">
        <Header title="Settings" back />
        <div className="px-4 pt-5 pb-24 space-y-6">
          {sections.map((section) => (
            <div key={section.title}>
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">{section.title.toUpperCase()}</div>
              <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl overflow-hidden">
                {section.items.map((item, i) => (
                  <div key={item.label} className={`flex items-center gap-3.5 px-4 py-3.5 ${i < section.items.length - 1 ? "border-b border-[#1F2127]" : ""}`}>
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${item.danger ? "bg-red-500/10" : "bg-[#1e1e1e]"}`}>
                      <item.icon size={15} color={item.danger ? "#ef4444" : "#888"} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${item.danger ? "text-red-400" : "text-white"}`}>{item.label}</div>
                      <div className="text-xs text-[#666] mt-0.5">{item.sub}</div>
                    </div>
                    {item.badge && <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e1e] text-[#666]">{item.badge}</span>}
                    {item.toggle && <div className="w-9 h-5 bg-[#DDE048]/20 border border-[#DDE048]/30 rounded-full flex items-center px-0.5"><div className="w-4 h-4 rounded-full bg-[#DDE048]" /></div>}
                    {!item.badge && !item.toggle && <ChevronRight size={15} color="#333" />}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

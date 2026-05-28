"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";
import Image from "next/image";
import { LayoutDashboard, ShieldCheck, Users, Store, LogOut } from "lucide-react";

const NAV = [
  { href: "/admin", label: "Overview", Icon: LayoutDashboard, exact: true },
  { href: "/admin/kyc", label: "KYC Queue", Icon: ShieldCheck },
  { href: "/admin/users", label: "Senders", Icon: Users },
  { href: "/admin/merchants", label: "Merchants", Icon: Store },
];

export default function AdminLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function signOut() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    document.cookie = "rs_role=; path=/; max-age=0";
    router.replace("/login");
  }

  return (
    <div className="min-h-screen bg-[#0e1014] flex">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-[#1e2230] flex flex-col py-6 px-4 sticky top-0 h-screen">
        <div className="flex items-center gap-2.5 mb-8 px-2">
          <Image src="/logo.png" alt="RemitSafe" width={28} height={28} style={{ objectFit: "contain" }} />
          <div>
            <div className="text-white font-extrabold text-sm leading-tight">RemitSafe</div>
            <div className="text-[10px] text-red-400 font-semibold tracking-[1px]">ADMIN</div>
          </div>
        </div>

        <nav className="flex-1 space-y-1">
          {NAV.map(({ href, label, Icon, exact }) => {
            const active = exact ? pathname === href : pathname.startsWith(href);
            return (
              <Link key={href} href={href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
                  active ? "bg-[#DDE048]/10 text-[#DDE048]" : "text-[#555] hover:text-[#888] hover:bg-[#13161c]"
                }`}>
                <Icon size={16} />
                {label}
              </Link>
            );
          })}
        </nav>

        <button onClick={signOut}
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-sm text-[#555] hover:text-red-400 transition-colors mt-4">
          <LogOut size={16} /> Sign out
        </button>
      </aside>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}

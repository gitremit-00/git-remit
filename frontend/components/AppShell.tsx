"use client";
import { usePathname } from "next/navigation";
import { ReactNode } from "react";
import DesktopSidebar from "./DesktopSidebar";
import DesktopTopbar from "./DesktopTopbar";
import BottomNav from "./BottomNav";

const SHELL_EXCLUDED = ["/onboarding"];

export default function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const showShell = !SHELL_EXCLUDED.includes(pathname);

  if (!showShell) {
    return <div className="min-h-screen bg-[#0e1014]">{children}</div>;
  }

  return (
    <>
      {/* Desktop */}
      <div className="hidden md:flex min-h-screen bg-[#0e1014]">
        <DesktopSidebar />
        <div className="flex-1 flex flex-col ml-[260px]">
          <DesktopTopbar />
          <main className="flex-1 overflow-y-auto w-full max-w-full">{children}</main>
        </div>
      </div>

      {/* Mobile */}
      <div className="md:hidden" style={{ paddingBottom: 80 }}>{children}</div>
      <div className="md:hidden"><BottomNav /></div>
    </>
  );
}

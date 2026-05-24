import "./globals.css";
import { ReactNode } from "react";
import { WalletProvider } from "../context/WalletContext";
import { RoleProvider } from "../context/RoleContext";
import BottomNav from "../components/BottomNav";
import DesktopSidebar from "../components/DesktopSidebar";
import DesktopTopbar from "../components/DesktopTopbar";

export const metadata = { title: "RemitSafe", description: "OFW Payment Pledge System" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
        <RoleProvider>
          {/* Desktop layout */}
          <div className="hidden md:flex min-h-screen bg-[#0e1014]">
            <DesktopSidebar />
            <div className="flex-1 flex flex-col ml-[260px]">
              <DesktopTopbar />
              <main className="flex-1 overflow-y-auto w-full max-w-full">
                {children}
              </main>
            </div>
          </div>

          {/* Mobile layout */}
          <div className="md:hidden" style={{ paddingBottom: 80 }}>
            {children}
          </div>
          <div className="md:hidden">
            <BottomNav />
          </div>
        </RoleProvider>
        </WalletProvider>
      </body>
    </html>
  );
}

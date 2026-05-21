import "./globals.css";
import { ReactNode } from "react";
import { WalletProvider } from "../context/WalletContext";
import BottomNav from "../components/BottomNav";

export const metadata = { title: "RemitSafe", description: "OFW Payment Pledge System" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <div style={{ paddingBottom: 80 }}>{children}</div>
          <BottomNav />
        </WalletProvider>
      </body>
    </html>
  );
}

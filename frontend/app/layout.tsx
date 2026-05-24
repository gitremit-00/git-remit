import "./globals.css";
import { ReactNode } from "react";
import { WalletProvider } from "../context/WalletContext";
import { RoleProvider } from "../context/RoleContext";
import { CurrencyProvider } from "../context/CurrencyContext";
import AppShell from "../components/AppShell";

export const metadata = { title: "RemitSafe", description: "OFW Payment Pledge System" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <WalletProvider>
          <RoleProvider>
            <CurrencyProvider>
              <AppShell>{children}</AppShell>
            </CurrencyProvider>
          </RoleProvider>
        </WalletProvider>
      </body>
    </html>
  );
}

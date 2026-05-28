"use client";
import Image from "next/image";
import { CheckCircle2, Loader, LogOut, ShieldCheck, Wallet } from "lucide-react";

interface Props {
  role: "sender" | "merchant";
  account: string | null;
  walletLoading: boolean;
  error: string | null;
  onConnect: () => Promise<void>;
  onConfirm: () => Promise<void>;
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  document.cookie = "rs_role=; path=/; max-age=0";
  window.location.replace("/login");
}

function shortAddr(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export default function DashboardWalletConfirm({ role, account, walletLoading, error, onConnect, onConfirm }: Props) {
  const isMerchant = role === "merchant";

  return (
    <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-md bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 shadow-2xl">
        <div className="flex flex-col items-center text-center mb-6">
          <Image src="/logo.png" alt="RemitSafe" width={56} height={56} priority style={{ objectFit: "contain" }} />
          <div className="w-12 h-12 rounded-2xl bg-[#DDE048]/10 border border-[#DDE048]/20 flex items-center justify-center mt-5 mb-4">
            {account ? <ShieldCheck size={24} color="#DDE048" /> : <Wallet size={24} color="#DDE048" />}
          </div>
          <h1 className="text-white text-xl font-extrabold">
            {account ? "Confirm with MetaMask" : "Connect MetaMask"}
          </h1>
          <p className="text-[#777] text-sm leading-relaxed mt-2">
            {account
              ? `Sign a wallet confirmation to open your ${isMerchant ? "Merchant" : "OFW / Sender"} dashboard. This does not cost gas.`
              : `Connect the wallet you use for ${isMerchant ? "receiving merchant pledges" : "sending remittance pledges"}.`}
          </p>
        </div>

        {account && (
          <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 mb-4 flex items-center gap-3">
            <CheckCircle2 size={16} color="#22c55e" />
            <div>
              <div className="text-white text-sm font-semibold">Wallet connected</div>
              <div className="text-[#666] text-xs font-mono">{shortAddr(account)}</div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-3.5 py-2.5 mb-4">
            {error}
          </div>
        )}

        <button
          onClick={account ? onConfirm : onConnect}
          disabled={walletLoading}
          className="w-full bg-[#DDE048] text-black rounded-xl py-3.5 text-sm font-extrabold flex items-center justify-center gap-2 disabled:opacity-50"
        >
          {walletLoading ? <Loader size={15} className="animate-spin" /> : account ? <ShieldCheck size={15} /> : <Wallet size={15} />}
          {walletLoading ? "Checking wallet..." : account ? "Sign MetaMask Confirmation" : "Connect MetaMask"}
        </button>

        <p className="text-[#444] text-[11px] leading-relaxed text-center mt-4">
          MetaMask will ask for a signature only to prove wallet ownership. No funds are moved.
        </p>

        <div className="mt-5 pt-4 border-t border-[#1e2230] flex justify-center">
          <button
            onClick={logout}
            className="flex items-center gap-1.5 text-xs text-[#555] hover:text-red-400 transition-colors"
          >
            <LogOut size={13} /> Log out
          </button>
        </div>
      </div>
    </div>
  );
}

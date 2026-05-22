"use client";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Droplets, Info } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { PHP_PER_USDC } from "../../contracts/addresses";

export default function Wallet() {
  const { account, connect, usdcRead, usdcWrite, walletLoading } = useWallet();
  const [balance, setBalance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  useEffect(() => { if (account) fetchBalance(); }, [account]);

  async function fetchBalance() {
    const bal = await usdcRead.balanceOf(account);
    setBalance(ethers.formatUnits(bal, 6));
  }

  async function mintFaucet() {
    if (!usdcWrite) return;
    setLoading(true); setStatus("");
    try {
      const tx = await usdcWrite.faucet(account, ethers.parseUnits("1000", 6));
      setStatus("Minting...");
      await tx.wait();
      setStatus("1000 USDC added!");
      fetchBalance();
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setStatus("Error: " + (e.reason ?? e.message));
    } finally { setLoading(false); }
  }

  return (
    <div>
      <Header title="Wallet" />
      <div className="px-4 pt-5">
      {walletLoading ? (
        <LoadingSpinner fullScreen />
      ) : !account ? (
        <button className="w-full bg-[#DDE048] text-black border-0 rounded-[14px] py-4 text-base font-bold cursor-pointer" onClick={connect}>Connect MetaMask</button>
      ) : (
        <>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
            <div className="text-[11px] text-[#888] tracking-[1px] mb-1.5">USDC BALANCE</div>
            <div className="text-[36px] font-bold">{balance ? parseFloat(balance).toFixed(2) : "–"} <span className="text-lg text-[#888]">USDC</span></div>
            {balance && <div className="text-[13px] text-[#888] mt-1.5">≈ ₱{(parseFloat(balance) * PHP_PER_USDC).toLocaleString()} PHP</div>}
          </div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-1.5">
              <Droplets size={18} color="#DDE048" />
              <div className="font-bold text-base">Testnet Faucet</div>
            </div>
            <p className="text-[#888] text-[13px] mb-3.5">Get free test USDC on Morph Hoodi Testnet.</p>
            <button className="w-full bg-[#DDE048] text-black border-0 rounded-xl py-[14px] text-[15px] font-bold cursor-pointer" onClick={mintFaucet} disabled={loading}>
              {loading ? "Minting..." : "Mint 1000 USDC"}
            </button>
            {status && <p className="text-[#DDE048] text-[13px] mt-2.5">{status}</p>}
          </div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
            <div className="flex items-center gap-2 mb-2.5">
              <Info size={14} color="#888" />
              <span className="text-[11px] text-[#888] tracking-[1px]">NETWORK INFO</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#888]">Network</span><span>Morph Hoodi Testnet</span></div>
            <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#888]">Chain ID</span><span>2910</span></div>
            <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#888]">Address</span><span className="font-mono text-xs">{account.slice(0, 10)}...{account.slice(-8)}</span></div>
          </div>
        </>
      )}
      </div>
    </div>
  );
}


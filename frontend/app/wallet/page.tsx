"use client";
import Image from "next/image";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Droplets, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Copy } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS } from "../../contracts/addresses";
import { useCurrency } from "../../context/CurrencyContext";
import MetaMaskGate from "../../components/MetaMaskGate";
import Link from "next/link";

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }

export default function Wallet() {
  const { account, connect, disconnect, usdcRead, usdcWrite, walletLoading } = useWallet();
  const { fmt, fmtSub, fmtAlt, currency, rate } = useCurrency();
  const [balance, setBalance] = useState<string | null>(null);
  const [allowance, setAllowance] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (account) fetchBalance(); }, [account]);

  async function fetchBalance() {
    const [bal, allow] = await Promise.all([
      usdcRead.balanceOf(account),
      usdcRead.allowance(account, CONTRACTS.REMITTANCE_PLEDGE),
    ]);
    setBalance(ethers.formatUnits(bal, 6));
    setAllowance(ethers.formatUnits(allow, 6));
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

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  const balNum = balance ? parseFloat(balance) : 0;
  const allowNum = allowance ? parseFloat(allowance) : 0;

  /* ── DESKTOP LAYOUT ── */
  const DesktopWallet = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Wallet</h1>
      <p className="text-[#555] text-sm mb-8">Your USDC balance, MetaMask connection, and pledge spending allowance.</p>

      {!account ? (
        <div className="max-w-sm"><MetaMaskGate>{null}</MetaMaskGate></div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {/* Left column */}
          <div className="space-y-5">
            {/* USDC Balance card */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 relative overflow-hidden">
              <div className="flex items-center gap-2 mb-3">
                <div className="w-5 h-5 rounded-full bg-[#DDE048]/10 flex items-center justify-center text-[10px] text-[#DDE048] font-bold">$</div>
                <span className="text-[11px] text-[#555] tracking-[1.5px]">USDC BALANCE</span>
              </div>
              <div className="text-5xl font-extrabold text-white mb-1">
                {currency === "PHP" ? fmt(balNum) : balNum.toFixed(2)}{" "}
                <span className="text-xl text-[#888] font-normal">{currency === "PHP" ? "PHP" : "USDC"}</span>
              </div>
              <div className="text-[#555] text-sm mb-6">≈ {fmtAlt(balNum)}</div>
              <div className="flex gap-3">
                <button onClick={mintFaucet} disabled={loading} className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
                  <ArrowDownLeft size={15} /> {loading ? "Minting…" : "Top up"}
                </button>
                <button className="flex items-center gap-2 bg-[#1e2230] text-white text-sm font-semibold rounded-xl px-5 py-2.5 hover:bg-[#252836] transition-colors">
                  <ArrowUpRight size={15} /> Withdraw
                </button>
                <button className="flex items-center gap-2 bg-[#1e2230] text-white text-sm font-semibold rounded-xl px-5 py-2.5 hover:bg-[#252836] transition-colors">
                  <ArrowLeftRight size={15} /> Swap
                </button>
              </div>
              {status && <p className="text-[#DDE048] text-[13px] mt-3">{status}</p>}
            </div>

            {/* USDC Spending allowance */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-1">
                <h3 className="font-bold text-white">USDC spending allowance</h3>
                <button className="flex items-center gap-2 bg-[#DDE048]/10 border border-[#DDE048]/30 text-[#DDE048] text-sm font-bold rounded-xl px-4 py-2 hover:bg-[#DDE048]/20 transition-colors">
                  Approve 1,000 USDC
                </button>
              </div>
              <p className="text-[#555] text-sm mb-5">How much USDC the Transfer contract can move on your behalf. Required for each transfer.</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">CURRENT ALLOWANCE</div>
                  <div className="text-2xl font-extrabold text-white">{allowNum.toFixed(2)} <span className="text-sm text-[#555] font-normal">USDC</span></div>
                </div>
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">USED BY PLEDGES</div>
                  <div className="text-2xl font-extrabold text-white">—</div>
                </div>
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">AVAILABLE</div>
                  <div className="text-2xl font-extrabold text-[#DDE048]">{allowNum.toFixed(2)} <span className="text-sm text-[#555] font-normal">USDC</span></div>
                </div>
              </div>
            </div>

            {/* Corridor */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2">
                  <span className="text-2xl font-extrabold text-white">US</span>
                  <ArrowLeftRight size={16} color="#555" />
                  <span className="text-2xl font-extrabold text-white">PH</span>
                </div>
                <div>
                  <div className="font-semibold text-white text-sm">USA → Philippines</div>
                  <div className="text-[12px] text-[#555]">USD → PHP · 1 USDC ≈ ₱{rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} · merchants in PH paid in USDC, settled to PHP via partner</div>
                </div>
              </div>
              <button className="bg-[#1e2230] text-white text-sm font-semibold rounded-xl px-4 py-2 hover:bg-[#252836] transition-colors whitespace-nowrap">Change corridor</button>
            </div>
          </div>

          {/* Right column */}
          <div className="space-y-5">
            {/* MetaMask connection */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-orange-500/10 flex items-center justify-center p-1.5">
                    <Image src="/MetaMask.png" alt="MetaMask" width={28} height={28} style={{ objectFit: "contain" }} />
                  </div>
                  <div>
                    <div className="font-bold text-white">MetaMask</div>
                    <div className="flex items-center gap-1.5 text-[12px] text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400" /> Connected</div>
                  </div>
                </div>
                <button onClick={disconnect} className="bg-[#1e2230] text-white text-sm font-semibold rounded-xl px-4 py-2 hover:bg-[#252836] transition-colors">Disconnect</button>
              </div>
              <div className="space-y-3">
                <div>
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">ADDRESS</div>
                  <button onClick={copyAddress} className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-sm font-mono text-[#ccc] hover:border-[#333] transition-colors w-full">
                    <span className="w-3 h-3 rounded-sm bg-[#DDE048]/20 border border-[#DDE048]/40 shrink-0" />
                    {copied ? <span className="text-[#DDE048]">Copied!</span> : shortAddr(account)}
                    <Copy size={12} color="#555" className="ml-auto" />
                  </button>
                </div>
                <div>
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">NETWORK</div>
                  <div className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-sm text-white">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    Connected
                  </div>
                </div>
              </div>
            </div>

            {/* Testnet faucet */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <Droplets size={20} color="#DDE048" />
                <h3 className="font-bold text-white">Testnet Faucet</h3>
              </div>
              <p className="text-[#555] text-sm mb-4">Get free test USDC to start making transfers on RemitSafe.</p>
              <button onClick={mintFaucet} disabled={loading} className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
                {loading ? "Minting…" : "Mint 1,000 USDC"}
              </button>
              {status && <p className="text-[#DDE048] text-[13px] mt-3 text-center">{status}</p>}
            </div>

          </div>
        </div>
      )}
    </div>
  );

  /* ── MOBILE LAYOUT ── */
  const MobileWallet = (
    <div className="md:hidden">
      <Header title="Wallet" />
      <div className="px-4 pt-5">
        {walletLoading ? <LoadingSpinner fullScreen /> : !account ? (
          <MetaMaskGate>{null}</MetaMaskGate>
        ) : (
          <>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[11px] text-[#888] tracking-[1px] mb-1.5">USDC BALANCE</div>
              <div className="text-[36px] font-bold">
                {balance ? (currency === "PHP" ? fmt(parseFloat(balance)) : parseFloat(balance).toFixed(2)) : "–"}{" "}
                <span className="text-lg text-[#888]">{currency === "PHP" ? "PHP" : "USDC"}</span>
              </div>
              {balance && <div className="text-[13px] text-[#888] mt-1.5">≈ {fmtAlt(parseFloat(balance))}</div>}
            </div>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="flex items-center gap-2 mb-1.5">
                <Droplets size={18} color="#DDE048" />
                <div className="font-bold text-base">Testnet Faucet</div>
              </div>
              <p className="text-[#888] text-[13px] mb-3.5">Get free test USDC to start sending transfers.</p>
              <button className="w-full bg-[#DDE048] text-black border-0 rounded-xl py-[14px] text-[15px] font-bold cursor-pointer" onClick={mintFaucet} disabled={loading}>
                {loading ? "Minting..." : "Mint 1000 USDC"}
              </button>
              {status && <p className="text-[#DDE048] text-[13px] mt-2.5">{status}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  );

  if (walletLoading) return <LoadingSpinner fullScreen />;

  return (
    <>
      {DesktopWallet}
      {MobileWallet}
    </>
  );
}

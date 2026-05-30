"use client";
import Image from "next/image";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import { Droplets, ArrowDownLeft, ArrowUpRight, ArrowLeftRight, Copy, Clock, Send, Wallet as WalletIcon, ChevronRight, ShieldCheck } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS } from "../../contracts/addresses";
import { useCurrency } from "../../context/CurrencyContext";
import MetaMaskGate from "../../components/MetaMaskGate";
import Link from "next/link";

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }

export default function Wallet() {
  const { account, disconnect, usdcRead, usdtRead, usdcWrite, usdtWrite, pledgeRead, accountId, linkedWallets, walletLoading } = useWallet();
  const { fmt, fmtAlt, currency, rate } = useCurrency();
  const [usdcBalance, setUsdcBalance] = useState<string | null>(null);
  const [usdtBalance, setUsdtBalance] = useState<string | null>(null);
  const [usdcCustody, setUsdcCustody] = useState<string | null>(null);
  const [usdtCustody, setUsdtCustody] = useState<string | null>(null);
  const [usdcAllowance, setUsdcAllowance] = useState<string | null>(null);
  const [usdtAllowance, setUsdtAllowance] = useState<string | null>(null);
  const [mintTarget, setMintTarget] = useState<"USDC" | "USDT">("USDC");
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState<"USDC" | "USDT" | null>(null);
  const [status, setStatus] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => { if (account) fetchBalances(); }, [account, accountId]);

  async function fetchBalances() {
    const [uBal, tBal, uAllow, tAllow] = await Promise.all([
      usdcRead.balanceOf(account),
      usdtRead.balanceOf(account),
      usdcRead.allowance(account, CONTRACTS.REMITTANCE_PLEDGE),
      usdtRead.allowance(account, CONTRACTS.REMITTANCE_PLEDGE),
    ]);
    setUsdcBalance(ethers.formatUnits(uBal, 6));
    setUsdtBalance(ethers.formatUnits(tBal, 6));
    setUsdcAllowance(ethers.formatUnits(uAllow, 6));
    setUsdtAllowance(ethers.formatUnits(tAllow, 6));

    if (accountId) {
      try {
        const [uCust, tCust] = await Promise.all([
          pledgeRead.getAccountBalance(accountId, CONTRACTS.MOCK_USDC),
          pledgeRead.getAccountBalance(accountId, CONTRACTS.MOCK_USDT),
        ]);
        setUsdcCustody(ethers.formatUnits(uCust, 6));
        setUsdtCustody(ethers.formatUnits(tCust, 6));
      } catch { /* contract may not have custody for this account yet */ }
    }
  }

  async function approveAllowance(token: "USDC" | "USDT") {
    const write = token === "USDC" ? usdcWrite : usdtWrite;
    if (!write) return;
    setApproving(token); setStatus("");
    try {
      const tx = await write.approve(CONTRACTS.REMITTANCE_PLEDGE, ethers.parseUnits("1000", 6));
      setStatus("Approving…");
      await tx.wait();
      setStatus(`1,000 ${token} approved!`);
      fetchBalances();
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setStatus("Error: " + (e.reason ?? e.message));
    } finally { setApproving(null); }
  }

  async function mintFaucet(token: "USDC" | "USDT") {
    const write = token === "USDC" ? usdcWrite : usdtWrite;
    if (!write) return;
    setLoading(true); setMintTarget(token); setStatus("");
    try {
      const tx = await write.faucet(account, ethers.parseUnits("1000", 6));
      setStatus("Minting…");
      await tx.wait();
      setStatus(`1,000 ${token} added!`);
      fetchBalances();
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

  const usdcNum = usdcBalance ? parseFloat(usdcBalance) : 0;
  const usdtNum = usdtBalance ? parseFloat(usdtBalance) : 0;
  const usdcCustodyNum = usdcCustody ? parseFloat(usdcCustody) : 0;
  const usdtCustodyNum = usdtCustody ? parseFloat(usdtCustody) : 0;
  const usdcAllowNum = usdcAllowance ? parseFloat(usdcAllowance) : 0;
  const usdtAllowNum = usdtAllowance ? parseFloat(usdtAllowance) : 0;
  const totalNum = usdcNum + usdtNum;
  const custodyTotal = usdcCustodyNum + usdtCustodyNum;
  const primaryWallet = linkedWallets.find(w => w.isPrimary)?.address ?? null;

  /* ── DESKTOP LAYOUT ── */
  const DesktopWallet = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Wallet</h1>
      <p className="text-[#555] text-sm mb-8">Your wallet holdings, in-app balance, MetaMask connection, and pledge spending allowances.</p>

      {!account ? (
        <div className="max-w-sm"><MetaMaskGate>{null}</MetaMaskGate></div>
      ) : (
        <div className="grid grid-cols-2 gap-5">
          {/* Left column */}
          <div className="space-y-5">
            {/* Wallet holdings card */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 relative overflow-hidden">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#DDE048]/10 flex items-center justify-center text-[10px] text-[#DDE048] font-bold">$</div>
                <span className="text-[11px] text-[#555] tracking-[1.5px]">WALLET HOLDINGS</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {([
                  { sym: "USDC" as const, num: usdcNum, dotColor: "bg-blue-500/20 text-blue-400" },
                  { sym: "USDT" as const, num: usdtNum, dotColor: "bg-green-500/20 text-green-400" },
                ]).map(({ sym, num, dotColor }) => (
                  <div key={sym} className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                    <div className="flex items-center gap-1.5 mb-2">
                      <div className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${dotColor}`}>$</div>
                      <span className="text-[11px] text-[#555] tracking-[1px]">{sym}</span>
                    </div>
                    <div className="text-2xl font-extrabold text-white">
                      {currency === "PHP" ? fmt(num) : num.toFixed(2)}
                      {currency === "USD" && <span className="text-sm text-[#555] font-normal ml-1">{sym}</span>}
                    </div>
                    <div className="text-[11px] text-[#555] mt-0.5">{fmtAlt(num, sym)}</div>
                    <button
                      onClick={() => mintFaucet(sym)}
                      disabled={loading && mintTarget === sym}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 bg-[#DDE048]/10 border border-[#DDE048]/20 text-[#DDE048] text-xs font-bold rounded-lg py-1.5 hover:bg-[#DDE048]/20 transition-colors disabled:opacity-50"
                    >
                      <ArrowDownLeft size={12} /> {loading && mintTarget === sym ? "Minting…" : "Top up"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#1e2230] pt-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[#555] mb-0.5">TOTAL IN WALLET</div>
                  <div className="text-xl font-extrabold text-white">
                    {currency === "PHP" ? fmt(totalNum) : `${totalNum.toFixed(2)}`}
                    {currency === "USD" && <span className="text-sm text-[#888] font-normal ml-1">USD</span>}
                  </div>
                  {currency === "USD" && <div className="text-[11px] text-[#555] mt-0.5">≈ {fmt(totalNum)}</div>}
                </div>
                <div className="flex gap-2">
                  <Link href="/new-transfer" className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-4 py-2 hover:bg-[#c8ce30] transition-colors">
                    <Send size={14} /> Send
                  </Link>
                  <button disabled title="Coming soon" className="flex items-center gap-2 bg-[#1e2230] text-[#555] text-sm font-semibold rounded-xl px-4 py-2 cursor-not-allowed">
                    <ArrowLeftRight size={14} /> Swap
                  </button>
                </div>
              </div>
              {status && <p className="text-[#DDE048] text-[13px] mt-3">{status}</p>}
            </div>

            {/* In-app account balance (custody) */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={16} color="#DDE048" />
                <h3 className="font-bold text-white">In-app balance</h3>
              </div>
              <p className="text-[#555] text-sm mb-5">Funds held in RemitSafe custody from completed transfers — available to withdraw to a linked wallet.</p>
              <div className="grid grid-cols-2 gap-3 mb-5">
                {([
                  { sym: "USDC" as const, num: usdcCustodyNum },
                  { sym: "USDT" as const, num: usdtCustodyNum },
                ]).map(({ sym, num }) => (
                  <div key={sym} className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                    <div className="text-[11px] text-[#555] tracking-[1px] mb-1">{sym}</div>
                    <div className="text-2xl font-extrabold text-white">
                      {currency === "PHP" ? fmt(num) : num.toFixed(2)}
                      {currency === "USD" && <span className="text-sm text-[#555] font-normal ml-1">{sym}</span>}
                    </div>
                    <div className="text-[11px] text-[#555] mt-0.5">{fmtAlt(num, sym)}</div>
                  </div>
                ))}
              </div>
              <div className="border-t border-[#1e2230] pt-4 flex items-center justify-between">
                <div>
                  <div className="text-[11px] text-[#555] mb-0.5">WITHDRAWABLE</div>
                  <div className="text-xl font-extrabold text-[#DDE048]">
                    {currency === "PHP" ? fmt(custodyTotal) : `${custodyTotal.toFixed(2)}`}
                    {currency === "USD" && <span className="text-sm text-[#888] font-normal ml-1">USD</span>}
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link href="/withdraw" className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-4 py-2 hover:bg-[#c8ce30] transition-colors">
                    <ArrowUpRight size={14} /> Withdraw
                  </Link>
                  <Link href="/withdrawals/pending" className="flex items-center gap-2 bg-[#1e2230] text-white text-sm font-semibold rounded-xl px-4 py-2 hover:bg-[#252836] transition-colors">
                    <Clock size={14} /> Pending
                  </Link>
                </div>
              </div>
            </div>

            {/* Spending allowances */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <h3 className="font-bold text-white mb-1">Spending allowances</h3>
              <p className="text-[#555] text-sm mb-5">How much of each token the Transfer contract is approved to move on your behalf when you send.</p>
              <div className="space-y-4">
                {(["USDC", "USDT"] as const).map((token) => {
                  const allowNum = token === "USDC" ? usdcAllowNum : usdtAllowNum;
                  const isApproving = approving === token;
                  const isActive = allowNum > 0;
                  return (
                    <div key={token} className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-white">{token} allowance</span>
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isActive ? "bg-green-500/10 text-green-400" : "bg-[#1e2230] text-[#666]"}`}>
                            {isActive ? "Active" : "Not approved"}
                          </span>
                        </div>
                        <button
                          onClick={() => approveAllowance(token)}
                          disabled={!!approving}
                          className="flex items-center gap-1.5 bg-[#DDE048]/10 border border-[#DDE048]/30 text-[#DDE048] text-xs font-bold rounded-lg px-3 py-1.5 hover:bg-[#DDE048]/20 transition-colors disabled:opacity-50"
                        >
                          {isApproving ? "Approving…" : `Approve 1,000 ${token}`}
                        </button>
                      </div>
                      <div className="text-[10px] text-[#555] tracking-[1px] mb-1">APPROVED</div>
                      <div className="text-lg font-extrabold text-white">{allowNum.toFixed(2)} <span className="text-xs text-[#555] font-normal">{token}</span></div>
                    </div>
                  );
                })}
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
                  <div className="text-[12px] text-[#555]">USDC / USDT → PHP · 1 stablecoin ≈ ₱{rate.toLocaleString(undefined, { maximumFractionDigits: 2 })} · settled to PHP via partner</div>
                </div>
              </div>
              <button disabled title="Coming soon" className="bg-[#1e2230] text-[#555] text-sm font-semibold rounded-xl px-4 py-2 cursor-not-allowed whitespace-nowrap">Change corridor</button>
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
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">ACTIVE ADDRESS</div>
                  <button onClick={copyAddress} className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-sm font-mono text-[#ccc] hover:border-[#333] transition-colors w-full">
                    <span className="w-3 h-3 rounded-sm bg-[#DDE048]/20 border border-[#DDE048]/40 shrink-0" />
                    {copied ? <span className="text-[#DDE048]">Copied!</span> : shortAddr(account)}
                    {primaryWallet?.toLowerCase() === account.toLowerCase() && <span className="text-[10px] text-[#DDE048] font-semibold">Primary</span>}
                    <Copy size={12} color="#555" className="ml-auto" />
                  </button>
                </div>
                <div>
                  <div className="text-[11px] text-[#555] tracking-[1px] mb-2">NETWORK</div>
                  <div className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-sm text-white">
                    <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                    Morph Hoodi Testnet
                  </div>
                </div>
              </div>
            </div>

            {/* Linked wallets summary */}
            <Link href="/wallets" className="block bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 hover:border-[#333] transition-colors group">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-[#DDE048]/10 flex items-center justify-center">
                    <WalletIcon size={18} color="#DDE048" />
                  </div>
                  <div>
                    <div className="font-bold text-white">Linked wallets</div>
                    <div className="text-[12px] text-[#555]">{linkedWallets.length} wallet{linkedWallets.length === 1 ? "" : "s"} linked to your account</div>
                  </div>
                </div>
                <ChevronRight size={18} color="#555" className="group-hover:text-[#ccc] transition-colors" />
              </div>
              {primaryWallet && (
                <div className="text-[11px] text-[#555] font-mono">Primary · {shortAddr(primaryWallet)}</div>
              )}
              <div className="text-[12px] text-[#DDE048] font-semibold mt-2">Add, set primary, or panic-unlink →</div>
            </Link>

            {/* Testnet faucet */}
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center gap-3 mb-2">
                <Droplets size={20} color="#DDE048" />
                <h3 className="font-bold text-white">Testnet Faucet</h3>
              </div>
              <p className="text-[#555] text-sm mb-4">Get free test tokens to start making transfers on RemitSafe.</p>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => mintFaucet("USDC")} disabled={loading && mintTarget === "USDC"} className="bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
                  {loading && mintTarget === "USDC" ? "Minting…" : "Mint 1,000 USDC"}
                </button>
                <button onClick={() => mintFaucet("USDT")} disabled={loading && mintTarget === "USDT"} className="bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
                  {loading && mintTarget === "USDT" ? "Minting…" : "Mint 1,000 USDT"}
                </button>
              </div>
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
      <div className="px-4 pt-5 pb-28 space-y-4">
        {walletLoading ? <LoadingSpinner fullScreen /> : !account ? (
          <MetaMaskGate>{null}</MetaMaskGate>
        ) : (
          <>
            {/* Wallet holdings */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-5 h-5 rounded-full bg-[#DDE048]/10 flex items-center justify-center text-[10px] text-[#DDE048] font-bold">$</div>
                <span className="text-[11px] text-[#888] tracking-[1px]">WALLET HOLDINGS</span>
              </div>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {([
                  { sym: "USDC" as const, num: usdcNum, dotColor: "bg-blue-500/20 text-blue-400" },
                  { sym: "USDT" as const, num: usdtNum, dotColor: "bg-green-500/20 text-green-400" },
                ]).map(({ sym, num, dotColor }) => (
                  <div key={sym} className="bg-[#0d0f13] border border-[#1F2127] rounded-xl p-3">
                    <div className="flex items-center gap-1 mb-1.5">
                      <div className={`w-3.5 h-3.5 rounded-full flex items-center justify-center text-[8px] font-bold ${dotColor}`}>$</div>
                      <span className="text-[10px] text-[#555] tracking-[1px]">{sym}</span>
                    </div>
                    <div className="text-xl font-extrabold text-white">
                      {currency === "PHP" ? fmt(num) : num.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-[#555] mt-0.5">{fmtAlt(num, sym)}</div>
                    <button onClick={() => mintFaucet(sym)} disabled={loading && mintTarget === sym} className="mt-2 w-full text-[11px] font-bold text-[#DDE048] border border-[#DDE048]/20 rounded-lg py-1 disabled:opacity-50">
                      {loading && mintTarget === sym ? "Minting…" : "+ Top up"}
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center border-t border-[#1F2127] pt-3">
                <div>
                  <div className="text-[10px] text-[#555] mb-0.5">TOTAL IN WALLET</div>
                  <div className="text-lg font-extrabold text-white">
                    {currency === "PHP" ? fmt(totalNum) : `${totalNum.toFixed(2)}`}
                    {currency === "USD" && <span className="text-sm text-[#888] font-normal ml-1">USD</span>}
                  </div>
                  {currency === "USD" && <div className="text-[10px] text-[#555] mt-0.5">≈ {fmt(totalNum)}</div>}
                </div>
                <div className="flex gap-2">
                  <Link href="/new-transfer" className="flex items-center gap-1 bg-[#DDE048] text-black text-xs font-bold rounded-lg px-3 py-1.5">
                    <Send size={12} /> Send
                  </Link>
                  <button disabled className="flex items-center gap-1 bg-[#1e1e1e] text-[#555] text-xs font-semibold rounded-lg px-3 py-1.5 border border-[#1F2127] cursor-not-allowed">
                    <ArrowLeftRight size={12} /> Swap
                  </button>
                </div>
              </div>
              {status && <p className="text-[#DDE048] text-[13px] mt-3">{status}</p>}
            </div>

            {/* In-app balance (custody) */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-1">
                <ShieldCheck size={15} color="#DDE048" />
                <div className="font-bold text-sm">In-app Balance</div>
              </div>
              <p className="text-[#555] text-xs mb-4">Held in RemitSafe custody — available to withdraw to a linked wallet.</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {([
                  { sym: "USDC" as const, num: usdcCustodyNum },
                  { sym: "USDT" as const, num: usdtCustodyNum },
                ]).map(({ sym, num }) => (
                  <div key={sym} className="bg-[#0d0f13] border border-[#1F2127] rounded-xl p-3">
                    <div className="text-[10px] text-[#555] tracking-[1px] mb-1">{sym}</div>
                    <div className="text-xl font-extrabold text-white">
                      {currency === "PHP" ? fmt(num) : num.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-[#555] mt-0.5">{fmtAlt(num, sym)}</div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center border-t border-[#1F2127] pt-3 mb-3">
                <div>
                  <div className="text-[10px] text-[#555] mb-0.5">WITHDRAWABLE</div>
                  <div className="text-lg font-extrabold text-[#DDE048]">
                    {currency === "PHP" ? fmt(custodyTotal) : `${custodyTotal.toFixed(2)}`}
                    {currency === "USD" && <span className="text-sm text-[#888] font-normal ml-1">USD</span>}
                  </div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Link href="/withdraw" className="flex items-center justify-center gap-1.5 bg-[#DDE048] text-black text-sm font-bold rounded-xl py-3">
                  <ArrowUpRight size={14} /> Withdraw
                </Link>
                <Link href="/withdrawals/pending" className="flex items-center justify-center gap-1.5 bg-[#1a1d24] text-white text-sm font-semibold rounded-xl py-3 border border-[#1F2127]">
                  <Clock size={14} /> Pending
                </Link>
              </div>
            </div>

            {/* Spending allowances */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="font-bold text-sm mb-1">Spending Allowances</div>
              <p className="text-[#555] text-xs mb-4">Required for transfers — lets the contract move tokens on your behalf.</p>
              <div className="space-y-3">
                {(["USDC", "USDT"] as const).map((token) => {
                  const allowNum = token === "USDC" ? usdcAllowNum : usdtAllowNum;
                  const isApproving = approving === token;
                  const isActive = allowNum > 0;
                  return (
                    <div key={token} className="bg-[#0d0f13] border border-[#1F2127] rounded-xl p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold text-white">{token}</span>
                          <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${isActive ? "bg-green-500/10 text-green-400" : "bg-[#1e2230] text-[#666]"}`}>
                            {isActive ? "Active" : "Not approved"}
                          </span>
                        </div>
                        <button onClick={() => approveAllowance(token)} disabled={!!approving} className="text-[11px] font-bold text-[#DDE048] border border-[#DDE048]/30 bg-[#DDE048]/10 rounded-lg px-2.5 py-1 disabled:opacity-50">
                          {isApproving ? "Approving…" : "+ Approve"}
                        </button>
                      </div>
                      <div className="text-[10px] text-[#555] tracking-[1px] mb-1">APPROVED</div>
                      <div className="text-base font-extrabold text-white">{allowNum.toFixed(2)} <span className="text-[10px] text-[#555]">{token}</span></div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* MetaMask connection */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-orange-500/10 flex items-center justify-center p-1.5">
                    <Image src="/MetaMask.png" alt="MetaMask" width={24} height={24} style={{ objectFit: "contain" }} />
                  </div>
                  <div>
                    <div className="font-bold text-sm text-white">MetaMask</div>
                    <div className="flex items-center gap-1.5 text-[11px] text-green-400"><span className="w-1.5 h-1.5 rounded-full bg-green-400" />Connected</div>
                  </div>
                </div>
                <button onClick={disconnect} className="text-[12px] font-semibold text-[#888] border border-[#1F2127] rounded-lg px-3 py-1.5 hover:text-white transition-colors">Disconnect</button>
              </div>
              <button onClick={copyAddress} className="w-full flex items-center gap-2 bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-2.5 text-sm font-mono text-[#ccc] hover:border-[#333] transition-colors">
                <span className="w-3 h-3 rounded-sm bg-[#DDE048]/20 border border-[#DDE048]/40 shrink-0" />
                {copied ? <span className="text-[#DDE048]">Copied!</span> : account.slice(0, 10) + "…" + account.slice(-8)}
                <Copy size={12} color="#555" className="ml-auto" />
              </button>
            </div>

            {/* Linked wallets summary */}
            <Link href="/wallets" className="flex items-center justify-between bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#DDE048]/10 flex items-center justify-center">
                  <WalletIcon size={16} color="#DDE048" />
                </div>
                <div>
                  <div className="font-bold text-sm text-white">Linked wallets</div>
                  <div className="text-[11px] text-[#555]">{linkedWallets.length} linked · tap to manage</div>
                </div>
              </div>
              <ChevronRight size={18} color="#555" />
            </Link>

            {/* Corridor */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xl font-extrabold text-white">US</span>
                    <ArrowLeftRight size={14} color="#555" />
                    <span className="text-xl font-extrabold text-white">PH</span>
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">USA → Philippines</div>
                    <div className="text-[11px] text-[#555]">1 USDC/USDT ≈ ₱{rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  </div>
                </div>
                <button disabled className="text-[11px] text-[#555] border border-[#1F2127] rounded-lg px-3 py-1.5 cursor-not-allowed">Change</button>
              </div>
            </div>

            {/* Testnet faucet */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
              <div className="flex items-center gap-2 mb-1.5">
                <Droplets size={16} color="#DDE048" />
                <div className="font-bold text-sm">Testnet Faucet</div>
              </div>
              <p className="text-[#555] text-[13px] mb-4">Get free test tokens to start making transfers on RemitSafe.</p>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={() => mintFaucet("USDC")} disabled={loading && mintTarget === "USDC"} className="bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 disabled:opacity-50">
                  {loading && mintTarget === "USDC" ? "Minting…" : "Mint USDC"}
                </button>
                <button onClick={() => mintFaucet("USDT")} disabled={loading && mintTarget === "USDT"} className="bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 disabled:opacity-50">
                  {loading && mintTarget === "USDT" ? "Minting…" : "Mint USDT"}
                </button>
              </div>
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

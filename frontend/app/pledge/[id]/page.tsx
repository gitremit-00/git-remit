"use client";
import Header from "../../../components/Header";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ethers } from "ethers";
import { ExternalLink, Clock, CheckCircle2, Circle, Search, Copy, Loader, Info } from "lucide-react";
import TxGuard from "../../../components/TxGuard";
import LoadingSpinner from "../../../components/LoadingSpinner";
import { useWallet } from "../../../context/WalletContext";
import ProgressBar from "../../../components/ProgressBar";
import { CONTRACTS, PHP_PER_USDC } from "../../../contracts/addresses";
import { getPledgeMeta } from "../../../lib/pledgeMeta";

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };

interface PledgeRaw { id: bigint; sender: string; merchant: string; totalAmount: bigint; initialDeposit: bigint; depositedAmount: bigint; commitmentDate: bigint; status: number; paidDuringGrace: boolean; }

function shortAddr(a: string) { return a.slice(0, 6) + "..." + a.slice(-4); }
function daysLeft(ts: bigint) { return Math.max(0, Math.ceil((Number(ts) - Date.now() / 1000) / 86400)); }

export default function PledgeDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { account, signer, provider, pledgeRead, pledgeWrite, usdcRead, usdcWrite, walletLoading } = useWallet();
  const [pledge, setPledge] = useState<PledgeRaw | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState("");
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => { loadPledge(); }, [id]);

  // Re-fetch when tab regains focus — prevents acting on stale status after a background tx
  useEffect(() => {
    function onVisible() { if (document.visibilityState === "visible") loadPledge(); }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [id]);

  async function loadPledge() {
    try {
      const pledgeData = await pledgeRead.getPledge(id);
      setPledge(pledgeData as PledgeRaw);
    } finally { setLoading(false); }
  }

  async function handleDeposit() {
    if (!pledgeWrite || !usdcWrite || !pledge || !signer) return;

    const gross = pledge.totalAmount + pledge.totalAmount / 100n;
    const remaining = gross - pledge.depositedAmount;

    // Pre-flight: check balance before touching MetaMask
    const balance: bigint = await usdcRead.balanceOf(account);
    if (balance < remaining) {
      const has   = (Number(balance) / 1e6).toFixed(2);
      const needs = (Number(remaining) / 1e6).toFixed(2);
      setTxStatus(`error:Insufficient USDC balance. You have ${has} USDC but need ${needs} USDC.`);
      return;
    }

    // Encode calldata synchronously before any awaits — immune to tab-switch context re-renders
    const approveData = usdcWrite.interface.encodeFunctionData("approve", [CONTRACTS.REMITTANCE_PLEDGE, remaining]);
    const depositData = pledgeWrite.interface.encodeFunctionData("depositRemaining", [id, remaining]);
    const frozenSigner = signer;

    setTxLoading(true); setTxStatus("approving");
    try {
      const approveTx = await frozenSigner.sendTransaction({ to: CONTRACTS.MOCK_USDC, data: approveData });
      await approveTx.wait();
      setTxStatus("depositing");
      const depositTx = await frozenSigner.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: depositData });
      await depositTx.wait();
      setTxStatus("done"); loadPledge();
    } catch (err: unknown) {
      const reason = parseContractError(err);
      setTxStatus("error:" + reason);
      if (reason.includes("not pending")) loadPledge();
    } finally { setTxLoading(false); }
  }

  async function handleClaim() {
    if (!pledgeWrite) return;
    setTxLoading(true); setTxStatus("Claiming...");
    try {
      await (await pledgeWrite.claimPartial(id)).wait();
      setTxStatus("Claimed!"); loadPledge();
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setTxStatus("Error: " + (e.reason ?? e.message));
    } finally { setTxLoading(false); }
  }

  if (loading) return <LoadingSpinner />;

  if (!pledge) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Search size={40} color="#444" className="mb-3" />
      <div className="font-bold mb-2">Transfer not found</div>
      <button className="bg-transparent border-0 text-[#DDE048] text-sm cursor-pointer" onClick={() => router.back()}>← Go back</button>
    </div>
  );

  const total = parseFloat(ethers.formatUnits(pledge.totalAmount, 6));
  const gross = total * 1.01;
  const rawLocked = parseFloat(ethers.formatUnits(pledge.depositedAmount, 6));
  const locked = Number(pledge.status) === 1 ? total : rawLocked;
  const remaining = Math.max(0, parseFloat((gross - rawLocked).toFixed(6)));
  const status = STATUS[pledge.status];
  const statusColor = STATUS_COLOR[status];
  const deadline = new Date(Number(pledge.commitmentDate) * 1000);
  const days = daysLeft(pledge.commitmentDate);
  const isSender = account?.toLowerCase() === pledge.sender.toLowerCase();
  const isMerchant = account?.toLowerCase() === pledge.merchant.toLowerCase();
  const isGraceOver = Date.now() / 1000 > Number(pledge.commitmentDate) + 3 * 86400;
  const meta = getPledgeMeta(pledge.merchant);

  return (
    <div>
      <Header title={`Transfer ${shortAddr(pledge.id.toString())}`} back />
      <div className="px-4 pt-5 pb-[120px]">

      <div className="text-center mb-1.5">
        <div className="text-[44px] font-extrabold leading-none">{total.toFixed(2)} <span className="text-[22px] text-[#888] font-normal">USDC</span></div>
        <div className="text-[#888] text-sm">= ₱{(total * PHP_PER_USDC).toLocaleString()} PHP</div>
      </div>
      <div className="text-center mb-5">
        <span className="text-[#888] text-[13px]">to </span>
        <span className="bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-3 py-[3px] text-[13px] inline-block">{meta?.name || shortAddr(pledge.merchant)}</span>
        {meta?.note && (
          <div className="flex items-center justify-center gap-1 mt-2">
            <Info size={12} color="#666" />
            <span className="text-[#888] text-xs">{meta.note}</span>
          </div>
        )}
      </div>

      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
        <div className="flex justify-between text-[11px] mb-1">
          {status === "COMPLETED" ? (
            <>
              <span className="text-[#DDE048]">{total.toFixed(2)} paid in full</span>
              <span className="text-[#888]">fee {(total * 0.01).toFixed(2)} USDC</span>
            </>
          ) : status === "DEFAULTED" ? (
            <>
              <span className="text-red-400">{locked.toFixed(2)} forfeited</span>
              <span className="text-[#888]">{remaining.toFixed(2)} unpaid</span>
            </>
          ) : (
            <>
              <span className="text-[#DDE048]">{locked.toFixed(2)} locked</span>
              <span className="text-[#888]">{remaining.toFixed(2)} remaining</span>
            </>
          )}
        </div>
        <ProgressBar
          locked={locked}
          total={total}
          color={status === "COMPLETED" ? "#DDE048" : status === "DEFAULTED" ? "#ef4444" : "#DDE048"}
        />
        <div className="flex items-stretch mt-3 pt-3 border-t border-[#1F2127]">
          <StatBox label="TOTAL" value={total.toFixed(2)} />
          <div className="w-px bg-[#1F2127]" />
          <StatBox
            label={status === "COMPLETED" ? "PAID" : "LOCKED"}
            value={locked.toFixed(2)}
            accent={status !== "COMPLETED"}
            green={status === "COMPLETED"}
          />
          <div className="w-px bg-[#1F2127]" />
          <StatBox
            label={status === "COMPLETED" ? "FEE" : "DUE"}
            value={status === "COMPLETED" ? (total * 0.01).toFixed(2) : remaining.toFixed(2)}
            warn={status !== "COMPLETED" && remaining > 0}
          />
        </div>
      </div>

      {status === "COMPLETED" && (
        <div className="bg-[#0d1f0d] border border-green-500/20 rounded-2xl px-4 py-3.5 mb-3 flex items-center gap-3">
          <CheckCircle2 size={22} color="#DDE048" />
          <div>
            <div className="font-semibold text-green-500 text-sm">Payment completed</div>
            <div className="text-xs text-[#888] mt-0.5">{total.toFixed(2)} USDC sent to merchant</div>
          </div>
        </div>
      )}
      {status === "PENDING" && (
        <div className="bg-[#1a1500] border border-amber-400/20 rounded-2xl px-4 py-3.5 mb-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Clock size={22} color="#f59e0b" />
            <div>
              <div className="font-semibold text-amber-400 text-sm">Payment pending</div>
              <div className="text-xs text-[#888] mt-0.5">
                {remaining > 0
                  ? `${remaining.toFixed(2)} USDC due by ${deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} at ${deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
                  : "Fully funded — awaiting confirmation"}
              </div>
            </div>
          </div>
          {days > 0 && (
            <div className="text-right shrink-0">
              <div className="text-[22px] font-extrabold text-[#DDE048] leading-none">{days}</div>
              <div className="text-[10px] text-[#888]">days left</div>
            </div>
          )}
        </div>
      )}
      {status === "DEFAULTED" && (
        <div className="bg-[#1f0d0d] border border-red-500/20 rounded-2xl px-4 py-3.5 mb-3 flex items-center gap-3">
          <Circle size={22} color="#ef4444" fill="#ef4444" />
          <div>
            <div className="font-semibold text-red-400 text-sm">Pledge defaulted</div>
            <div className="text-xs text-[#888] mt-0.5">Merchant claimed the locked deposit</div>
          </div>
        </div>
      )}
      {status === "CANCELLED" && (
        <div className="bg-[#141414] border border-[#333] rounded-2xl px-4 py-3.5 mb-3 flex items-center gap-3">
          <Circle size={22} color="#888" fill="#888" />
          <div>
            <div className="font-semibold text-[#888] text-sm">Pledge cancelled</div>
            <div className="text-xs text-[#666] mt-0.5">Deposit was refunded to sender</div>
          </div>
        </div>
      )}

      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
        <div className="text-[11px] text-[#888] tracking-[1.5px] mb-5 uppercase">Timeline</div>
        <div className="flex flex-col gap-0">

          {/* Step 1 — always done */}
          <TimelineStep
            state="done"
            title="Pledge created"
            sub={`${pledge.initialDeposit === pledge.totalAmount ? "Full amount" : ethers.formatUnits(pledge.initialDeposit, 6) + " USDC"} locked upfront`}
            date={deadline.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            isLast={false}
            lineActive={true}
          />

          {/* Step 2 — deposit */}
          <TimelineStep
            state={
              status === "COMPLETED" ? "done"
              : status === "DEFAULTED" ? "failed"
              : status === "CANCELLED" ? "failed"
              : remaining <= 0 ? "done"
              : "active"
            }
            title={
              status === "COMPLETED" ? "Fully funded"
              : status === "DEFAULTED" ? "Payment missed"
              : status === "CANCELLED" ? "Cancelled"
              : remaining <= 0 ? "Fully funded"
              : "Deposit remaining"
            }
            sub={
              status === "COMPLETED" ? `${total.toFixed(2)} USDC paid in full`
              : status === "DEFAULTED" ? `${ethers.formatUnits(pledge.initialDeposit, 6)} USDC forfeited to merchant`
              : status === "CANCELLED" ? "Deposit refunded to sender"
              : remaining <= 0 ? "All funds locked — confirming"
              : `${remaining.toFixed(2)} USDC due by ${deadline.toLocaleDateString()} at ${deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}`
            }
            date={
              status === "PENDING" && remaining > 0 ? `${days}d left`
              : status === "PENDING" ? "Confirming"
              : ""
            }
            isLast={false}
            lineActive={status === "COMPLETED"}
          />

          {/* Step 3 — release */}
          <TimelineStep
            state={
              status === "COMPLETED" ? "done-green"
              : status === "DEFAULTED" || status === "CANCELLED" ? "failed"
              : "inactive"
            }
            title={
              status === "COMPLETED" ? "Funds released"
              : status === "DEFAULTED" ? "Deposit claimed"
              : status === "CANCELLED" ? "Pledge closed"
              : "Release"
            }
            sub={
              status === "COMPLETED" ? `${total.toFixed(2)} USDC sent to merchant (+ ${(total * 0.01).toFixed(2)} fee paid by sender)`
              : status === "DEFAULTED" ? "Merchant claimed the locked deposit"
              : status === "CANCELLED" ? "No funds transferred"
              : `Merchant receives full ${total.toFixed(2)} USDC · sender pays +1% fee`
            }
            date=""
            isLast={true}
            lineActive={false}
          />
        </div>
      </div>

      <div className="mb-3">
        <button
          className="w-full bg-transparent border-0 text-[#555] text-xs flex items-center justify-center gap-1.5 py-2 cursor-pointer"
          onClick={() => setShowAdvanced(!showAdvanced)}
        >
          {showAdvanced ? "Hide" : "Show"} advanced details
          <span className="text-[10px]">{showAdvanced ? "▲" : "▼"}</span>
        </button>

        {showAdvanced && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mt-1">
            <div className="flex justify-between items-center mb-3">
              <div className="text-[11px] text-[#888] tracking-[1.5px] uppercase">On-chain proof</div>
              <a href={`https://explorer-hoodi.morph.network/address/${CONTRACTS.REMITTANCE_PLEDGE}`}
                target="_blank" rel="noreferrer" className="text-[#DDE048] flex items-center gap-1 text-xs font-semibold">
                View on Explorer <ExternalLink size={13} />
              </a>
            </div>
            <ProofRow label="Pledge ID" value={`#${pledge.id.toString()}`} />
            <ProofRow label="Network" value="Morph Hoodi Testnet" />
            <ProofRow label="Contract" value={shortAddr(CONTRACTS.REMITTANCE_PLEDGE)} copyValue={CONTRACTS.REMITTANCE_PLEDGE} last />
          </div>
        )}
      </div>

      {txStatus === "done" && (
        <div className="bg-[#0d1f0d] border border-green-500/20 rounded-2xl px-4 py-3 my-3">
          <TxStep label="USDC approved" state="done" />
          <TxStep label="Deposit confirmed" state="done" />
        </div>
      )}
      {txStatus.startsWith("error:") && (
        <div className="bg-[#1f0d0d] border border-red-500/20 rounded-2xl px-4 py-3 my-3">
          <p className="text-red-400 text-[13px] font-semibold mb-0.5">Transaction failed</p>
          <p className="text-[#888] text-xs leading-relaxed">{txStatus.slice(6)}</p>
        </div>
      )}

      <TxGuard
        active={txLoading}
        steps={[
          { label: "Approve USDC spend", state: txStatus === "approving" ? "active" : txStatus === "depositing" || txStatus === "done" ? "done" : "pending" },
          { label: "Deposit remaining funds", state: txStatus === "depositing" ? "active" : txStatus === "done" ? "done" : "pending" },
        ]}
      />

      {!walletLoading && status === "PENDING" && isSender && remaining > 0 && (
        <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px]">
          <button className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-4 text-base font-bold cursor-pointer" onClick={handleDeposit} disabled={txLoading}>
            {txLoading ? "Processing..." : txStatus === "done" ? "✓ Deposited" : `+ Deposit ${remaining.toFixed(2)} USDC`}
          </button>
        </div>
      )}
      {!walletLoading && status === "PENDING" && isSender && remaining <= 0 && (
        <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px]">
          <div className="w-full bg-[#0d1f0d] border border-[#22c55e44] text-[#22c55e] rounded-2xl py-4 text-base font-bold text-center">
            ✓ Fully funded — awaiting on-chain confirmation
          </div>
        </div>
      )}
      {!walletLoading && status === "PENDING" && isMerchant && isGraceOver && (
        <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px]">
          <button className="w-full bg-red-500 text-white border-0 rounded-2xl py-4 text-base font-bold cursor-pointer" onClick={handleClaim} disabled={txLoading}>
            {txLoading ? "Processing..." : "Claim Deposit (Default)"}
          </button>
        </div>
      )}
      </div>
    </div>
  );
}

function parseContractError(err: unknown): string {
  const e = err as { reason?: string; data?: string; message?: string };
  if (e.reason) return e.reason;
  if (e.data?.startsWith("0xe450d38c")) {
    const needed = BigInt("0x" + e.data.slice(130, 194));
    const has    = BigInt("0x" + e.data.slice(66, 130));
    return `Insufficient USDC balance. You have ${(Number(has) / 1e6).toFixed(2)} USDC but need ${(Number(needed) / 1e6).toFixed(2)} USDC.`;
  }
  if (e.data?.startsWith("0xfb8f41b2")) return "USDC allowance too low. Please try again.";
  if (e.message?.includes("user rejected")) return "Transaction rejected in MetaMask.";
  return e.message ?? "Transaction failed.";
}

function TxStep({ label, state }: { label: string; state: "active" | "pending" | "done" }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {state === "done" && <CheckCircle2 size={15} color="#DDE048" className="shrink-0" />}
      {state === "active" && <Loader size={15} color="#f59e0b" className="shrink-0 animate-spin" />}
      {state === "pending" && <Clock size={15} color="#444" className="shrink-0" />}
      <span className={`text-sm ${state === "done" ? "text-[#DDE048]" : state === "active" ? "text-amber-400" : "text-[#444]"}`}>{label}</span>
    </div>
  );
}

function StatBox({ label, value, accent, green, warn }: { label: string; value: string; accent?: boolean; green?: boolean; warn?: boolean }) {
  return (
    <div className="flex-1 text-center py-2.5">
      <div className="text-[10px] text-[#888] tracking-[1px] mb-1.5">{label}</div>
      <div className={`text-[17px] font-bold ${green ? "text-[#DDE048]" : accent ? "text-[#DDE048]" : warn ? "text-amber-400" : "text-white"}`}>{value}</div>
    </div>
  );
}

function TimelineStep({ state, title, sub, date, isLast, lineActive }: {
  state: "done" | "done-green" | "active" | "inactive" | "failed";
  title: string; sub: string; date: string;
  isLast: boolean; lineActive: boolean;
}) {
  const nodeStyle =
    state === "done" ? "bg-[#DDE048] border-[#DDE048]"
    : state === "done-green" ? "bg-[#0d1f0d] border-[#22c55e]"
    : state === "active" ? "bg-transparent border-amber-400"
    : state === "failed" ? "bg-transparent border-red-500"
    : "bg-[#1a1a1a] border-[#2a2a2a]";

  const icon =
    state === "done" ? <CheckCircle2 size={14} color="#000" />
    : state === "done-green" ? <CheckCircle2 size={14} color="#DDE048" />
    : state === "active" ? <Circle size={8} color="#f59e0b" fill="#f59e0b" />
    : state === "failed" ? <Circle size={8} color="#ef4444" fill="#ef4444" />
    : null;

  const titleColor =
    state === "done" ? "text-white"
    : state === "done-green" ? "text-[#DDE048]"
    : state === "active" ? "text-amber-400"
    : state === "failed" ? "text-red-400"
    : "text-[#555]";

  return (
    <div className="flex gap-3">
      {/* Node + connector column */}
      <div className="flex flex-col items-center">
        <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center border-2 ${nodeStyle}`}>
          {icon}
        </div>
        {!isLast && (
          <div className="w-0.5 flex-1 min-h-[28px]" style={{ background: lineActive ? "#DDE048" : "#2a2a2a" }} />
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 pb-5 ${isLast ? "pb-0" : ""}`}>
        <div className="flex justify-between items-start">
          <div className={`font-semibold text-sm ${titleColor}`}>{title}</div>
          {date && <div className="text-[11px] text-[#888] ml-2 whitespace-nowrap">{date}</div>}
        </div>
        <div className="text-xs text-[#666] mt-0.5 leading-relaxed">{sub}</div>
      </div>
    </div>
  );
}

function ProofRow({ label, value, copyValue, last }: { label: string; value: string; copyValue?: string; last?: boolean }) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    navigator.clipboard.writeText(copyValue ?? value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className={`flex justify-between items-center py-2 text-[13px] ${last ? "" : "border-b border-[#1F2127]"}`}>
      <span className="text-[#888]">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className="font-mono">{value}</span>
        {copyValue && (
          <button className="bg-transparent border-0 p-0 cursor-pointer" onClick={handleCopy}>
            {copied
              ? <span className="text-[#DDE048] text-[11px]">Copied!</span>
              : <Copy size={11} color="#555" />}
          </button>
        )}
      </div>
    </div>
  );
}

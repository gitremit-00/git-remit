"use client";
import Header from "../../../components/Header";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ethers } from "ethers";
import { ExternalLink, Clock, CheckCircle2, Circle, Search } from "lucide-react";
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
  const { account, provider, pledgeRead, pledgeWrite, usdcWrite } = useWallet();
  const [pledge, setPledge] = useState<PledgeRaw | null>(null);
  const [blockNumber, setBlockNumber] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [txStatus, setTxStatus] = useState("");
  const [txLoading, setTxLoading] = useState(false);

  useEffect(() => { loadPledge(); }, [id]);

  async function loadPledge() {
    try {
      const [pledgeData, block] = await Promise.all([
        pledgeRead.getPledge(id),
        provider?.getBlockNumber().catch(() => null) ?? null,
      ]);
      setPledge(pledgeData as PledgeRaw);
      setBlockNumber(block);
    } finally { setLoading(false); }
  }

  async function handleDeposit() {
    if (!pledgeWrite || !usdcWrite || !pledge) return;
    setTxLoading(true); setTxStatus("Approving USDC...");
    try {
      const remaining = pledge.totalAmount - pledge.depositedAmount;
      await (await usdcWrite.approve(CONTRACTS.REMITTANCE_PLEDGE, remaining)).wait();
      setTxStatus("Depositing...");
      await (await pledgeWrite.depositRemaining(id, remaining)).wait();
      setTxStatus("Done!"); loadPledge();
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setTxStatus("Error: " + (e.reason ?? e.message));
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

  if (loading) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <div className="text-[#888] text-sm">Loading transfer...</div>
    </div>
  );

  if (!pledge) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <Search size={40} color="#444" className="mb-3" />
      <div className="font-bold mb-2">Transfer not found</div>
      <button className="bg-transparent border-0 text-[#DDE048] text-sm cursor-pointer" onClick={() => router.back()}>← Go back</button>
    </div>
  );

  const total = parseFloat(ethers.formatUnits(pledge.totalAmount, 6));
  const locked = parseFloat(ethers.formatUnits(pledge.depositedAmount, 6));
  const remaining = total - locked;
  const status = STATUS[pledge.status];
  const statusColor = STATUS_COLOR[status];
  const deadline = new Date(Number(pledge.commitmentDate) * 1000);
  const days = daysLeft(pledge.commitmentDate);
  const createdDate = new Date(Number(pledge.commitmentDate) * 1000 - 7 * 86400 * 1000);
  const isSender = account?.toLowerCase() === pledge.sender.toLowerCase();
  const isMerchant = account?.toLowerCase() === pledge.merchant.toLowerCase();
  const isGraceOver = Date.now() / 1000 > Number(pledge.commitmentDate) + 3 * 86400;
  const meta = getPledgeMeta(pledge.merchant);

  return (
    <div className="px-4 pt-5 pb-[120px]">
      <Header title={`Transfer ${shortAddr(pledge.id.toString())}`} back />

      <div className="text-center mb-5">
        <span className="rounded-[20px] px-3.5 py-[5px] text-xs font-bold" style={{ background: statusColor + "22", color: statusColor }}>● {status}</span>
      </div>

      <div className="text-center mb-1.5">
        <div className="text-[44px] font-extrabold leading-none">{total.toFixed(2)} <span className="text-[22px] text-[#888] font-normal">USDC</span></div>
        <div className="text-[#888] text-sm">= ₱{(total * PHP_PER_USDC).toLocaleString()} PHP</div>
      </div>
      <div className="text-center mb-5">
        <span className="text-[#888] text-[13px]">to </span>
        <span className="bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-3 py-[3px] text-[13px] inline-block">{meta?.name || shortAddr(pledge.merchant)}</span>
      </div>

      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
        <div className="flex justify-between text-[11px] mb-1">
          <span className="text-[#DDE048]">{locked.toFixed(2)} locked</span>
          <span className="text-[#888]">{remaining.toFixed(2)} remaining</span>
        </div>
        <ProgressBar locked={locked} total={total} />
        <div className="flex items-stretch mt-3 pt-3 border-t border-[#1F2127]">
          <StatBox label="TOTAL" value={total.toFixed(2)} />
          <div className="w-px bg-[#1F2127]" />
          <StatBox label="LOCKED" value={locked.toFixed(2)} accent />
          <div className="w-px bg-[#1F2127]" />
          <StatBox label="DUE" value={remaining.toFixed(2)} warn={remaining > 0} />
        </div>
      </div>

      {status === "PENDING" && (
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-[18px] py-3.5 mb-3 flex justify-between items-center">
          <div className="flex items-center gap-2 text-sm">
            <Clock size={18} color="#f59e0b" />
            <div>
              <div className="font-semibold">Commitment in {days} days</div>
              <div className="text-xs text-[#888]">by {deadline.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
            </div>
          </div>
          <span className="text-[28px] font-extrabold text-[#DDE048]">{days}</span>
        </div>
      )}

      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
        <div className="text-[11px] text-[#888] tracking-[1.5px] mb-4 uppercase">Timeline</div>
        <div className="relative">
          <div className="absolute left-[13px] top-7 bottom-3.5 w-0.5 bg-[#1F2127] z-0" />
          <TimelineItem
            icon={<CheckCircle2 size={20} color="#000" />}
            done
            title="Pledge created"
            sub={`Locked ${locked.toFixed(2)} USDC`}
            date={createdDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
            time={createdDate.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}
          />
          <TimelineItem
            icon={<Circle size={14} color="#f59e0b" />}
            active={status === "PENDING"}
            title="Awaiting deposit"
            sub={`${remaining.toFixed(2)} USDC due ${deadline.toLocaleDateString()}`}
            date={`${days}d`}
          />
          <TimelineItem
            icon={<span className="text-xs font-bold text-[#666]">3</span>}
            last
            title="Release"
            sub={`After 1% fee · ${(total * 0.99).toFixed(2)} USDC`}
            date="pending"
          />
        </div>
      </div>

      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mb-3">
        <div className="flex justify-between items-center mb-3">
          <div className="text-[11px] text-[#888] tracking-[1.5px] uppercase">On-chain proof</div>
          <a href={`https://explorer-hoodi.morph.network/address/${CONTRACTS.REMITTANCE_PLEDGE}`}
            target="_blank" rel="noreferrer" className="text-[#DDE048] flex">
            <ExternalLink size={18} />
          </a>
        </div>
        <ProofRow label="ID" value={shortAddr(pledge.id.toString())} />
        {blockNumber && <ProofRow label="Block" value={blockNumber.toLocaleString()} />}
        <ProofRow label="Network" value="Morph L2" />
        <ProofRow label="Contract" value={shortAddr(CONTRACTS.REMITTANCE_PLEDGE)} last />
      </div>

      {txStatus && <p className="text-[#DDE048] text-[13px] my-3 text-center">{txStatus}</p>}

      {status === "PENDING" && isSender && remaining > 0 && (
        <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px]">
          <button className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-4 text-base font-bold cursor-pointer" onClick={handleDeposit} disabled={txLoading}>
            {txLoading ? txStatus || "Processing..." : `+ Deposit ${remaining.toFixed(2)} USDC`}
          </button>
        </div>
      )}
      {status === "PENDING" && isMerchant && isGraceOver && (
        <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px]">
          <button className="w-full bg-red-500 text-white border-0 rounded-2xl py-4 text-base font-bold cursor-pointer" onClick={handleClaim} disabled={txLoading}>
            {txLoading ? txStatus : "Claim Deposit (Default)"}
          </button>
        </div>
      )}
    </div>
  );
}

function StatBox({ label, value, accent, warn }: { label: string; value: string; accent?: boolean; warn?: boolean }) {
  return (
    <div className="flex-1 text-center py-2.5">
      <div className="text-[10px] text-[#888] tracking-[1px] mb-1.5">{label}</div>
      <div className={`text-[17px] font-bold ${accent ? "text-[#DDE048]" : warn ? "text-amber-400" : "text-white"}`}>{value}</div>
    </div>
  );
}

function TimelineItem({ icon, done, active, last, title, sub, date, time }: {
  icon: React.ReactNode; done?: boolean; active?: boolean; last?: boolean;
  title: string; sub: string; date: string; time?: string;
}) {
  return (
    <div className={`flex gap-3.5 relative z-[1] ${last ? "" : "mb-[22px]"}`}>
      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center ${done ? "bg-[#DDE048]" : active ? "bg-transparent border-2 border-amber-400" : "bg-[#1a1a1a] border-2 border-[#1F2127]"}`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="font-semibold text-sm">{title}</div>
        <div className="text-xs text-[#888] mt-0.5">{sub}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="text-xs text-[#888]">{date}</div>
        {time && <div className="text-[11px] text-[#555] mt-0.5">{time}</div>}
      </div>
    </div>
  );
}

function ProofRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-2 text-[13px] ${last ? "" : "border-b border-[#1F2127]"}`}>
      <span className="text-[#888]">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

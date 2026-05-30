"use client";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Loader2, Clock, CheckCircle } from "lucide-react";
import Link from "next/link";
import Header from "../../../components/Header";
import { useWallet } from "../../../context/WalletContext";

interface PendingWithdrawal {
  id: bigint;
  token: string;
  amount: bigint;
  to: string;
  claimableAt: bigint;
  active: boolean;
}

function useCountdown(targetTimestamp: bigint): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const interval = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(interval);
  }, []);
  const secs = Number(targetTimestamp) - now;
  if (secs <= 0) return "Ready to claim";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = secs % 60;
  if (h > 0) return `${h}h ${m}m remaining`;
  if (m > 0) return `${m}m ${s}s remaining`;
  return `${s}s remaining`;
}

function WithdrawalCard({
  w,
  onClaim,
  onCancel,
  processing,
}: {
  w: PendingWithdrawal;
  onClaim: (id: bigint) => void;
  onCancel: (id: bigint) => void;
  processing: bigint | null;
}) {
  const countdown = useCountdown(w.claimableAt);
  const isReady = Number(w.claimableAt) <= Math.floor(Date.now() / 1000);
  const isProcessing = processing === w.id;
  const tokenSymbol = w.token.endsWith("C") ? "USDC" : "USDT"; // rough approximation from address

  return (
    <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div>
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">WITHDRAWAL #{w.id.toString()}</div>
          <div className="text-xl font-extrabold text-white">
            {ethers.formatUnits(w.amount, 6)} {tokenSymbol}
          </div>
          <div className="text-[11px] text-[#555] mt-0.5 font-mono">
            To: {w.to.slice(0, 10)}…{w.to.slice(-8)}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          {isReady
            ? <CheckCircle size={16} className="text-green-400" />
            : <Clock size={16} className="text-[#f59e0b]" />}
          <span className={`text-xs font-semibold ${isReady ? "text-green-400" : "text-[#f59e0b]"}`}>
            {countdown}
          </span>
        </div>
      </div>
      <div className="flex gap-2">
        <button
          onClick={() => onClaim(w.id)}
          disabled={!isReady || isProcessing}
          className="flex-1 flex items-center justify-center gap-1.5 bg-[#DDE048] text-black text-sm font-bold rounded-xl py-2.5 disabled:opacity-40"
        >
          {isProcessing ? <Loader2 size={13} className="animate-spin" /> : null}
          {isReady ? "Claim now" : "Claim (locked)"}
        </button>
        <button
          onClick={() => onCancel(w.id)}
          disabled={isProcessing}
          className="flex-1 flex items-center justify-center gap-1.5 border border-red-500/30 text-red-400 text-sm font-semibold rounded-xl py-2.5 disabled:opacity-40 hover:border-red-500/60 transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export default function PendingWithdrawalsPage() {
  const { accountId, pledgeRead, pledgeWrite, walletLoading } = useWallet();
  const [withdrawals, setWithdrawals] = useState<PendingWithdrawal[]>([]);
  const [fetching, setFetching] = useState(true);
  const [processing, setProcessing] = useState<bigint | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId || !pledgeRead) return;
    async function loadWithdrawals() {
      setFetching(true);
      try {
        const counter = await pledgeRead.pendingWithdrawalCounter() as bigint;
        const results: PendingWithdrawal[] = [];
        const total = Number(counter);
        // Fetch in batches — scan all IDs for those matching this accountId
        for (let i = 1; i <= total; i++) {
          try {
            const w = await pledgeRead.pendingWithdrawals(BigInt(i));
            if (
              w.accountId === accountId &&
              w.active
            ) {
              results.push({
                id: BigInt(i),
                token: w.token as string,
                amount: w.amount as bigint,
                to: w.to as string,
                claimableAt: w.claimableAt as bigint,
                active: w.active as boolean,
              });
            }
          } catch { /* skip individual fetch errors */ }
        }
        setWithdrawals(results.reverse());
      } finally {
        setFetching(false);
      }
    }
    loadWithdrawals();
  }, [accountId, pledgeRead]);

  async function handleClaim(id: bigint) {
    if (!pledgeWrite) return;
    setProcessing(id);
    setError(null);
    try {
      const tx = await pledgeWrite.claimWithdrawal(id);
      await tx.wait();
      setWithdrawals(prev => prev.filter(w => w.id !== id));
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setProcessing(null);
    }
  }

  async function handleCancel(id: bigint) {
    if (!pledgeWrite) return;
    setProcessing(id);
    setError(null);
    try {
      const tx = await pledgeWrite.cancelWithdrawal(id);
      await tx.wait();
      setWithdrawals(prev => prev.filter(w => w.id !== id));
    } catch (e: unknown) {
      setError((e as Error).message);
    } finally {
      setProcessing(null);
    }
  }

  if (walletLoading || fetching) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="animate-spin text-[#DDE048]" size={32} />
      </div>
    );
  }

  return (
    <>
      <div className="md:hidden">
        <Header title="Pending Withdrawals" />
        <div className="px-4 pt-5 pb-24 space-y-4">
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}
          {withdrawals.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-[#555] text-sm mb-4">No pending withdrawals.</div>
              <Link href="/withdraw" className="text-[#DDE048] text-sm font-semibold">
                Start a withdrawal →
              </Link>
            </div>
          ) : (
            withdrawals.map(w => (
              <WithdrawalCard
                key={w.id.toString()}
                w={w}
                onClaim={handleClaim}
                onCancel={handleCancel}
                processing={processing}
              />
            ))
          )}
        </div>
      </div>

      <div className="hidden md:block p-8 max-w-2xl mx-auto">
        <h1 className="text-3xl font-extrabold text-white mb-2">Pending Withdrawals</h1>
        <p className="text-[#555] text-sm mb-8">Timelocked withdrawals waiting to be claimed or cancelled.</p>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
            {error}
          </div>
        )}
        {withdrawals.length === 0 ? (
          <div className="text-center py-16">
            <div className="text-[#555] mb-4">No pending withdrawals.</div>
            <Link href="/withdraw" className="text-[#DDE048] font-semibold">
              Start a withdrawal →
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            {withdrawals.map(w => (
              <WithdrawalCard
                key={w.id.toString()}
                w={w}
                onClaim={handleClaim}
                onCancel={handleCancel}
                processing={processing}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

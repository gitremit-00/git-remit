"use client";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { Loader2, ArrowRight } from "lucide-react";
import Header from "../../components/Header";
import KYCGate from "../../components/KYCGate";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS } from "../../contracts/addresses";

const TOKENS = [
  { symbol: "USDC", address: CONTRACTS.MOCK_USDC },
  { symbol: "USDT", address: CONTRACTS.MOCK_USDT },
];

// Tier thresholds (basis points of daily cap):
// instant  <= dailyCap remaining
// 1-hour   > dailyCap, <= 10x dailyCap
// 24-hour  > 10x dailyCap
function getWithdrawalTier(amount: bigint, remaining: bigint, dailyCap: bigint): "instant" | "1h" | "24h" {
  if (amount <= remaining) return "instant";
  if (dailyCap === BigInt(0) || amount <= dailyCap * 10n) return "1h";
  return "24h";
}

export default function WithdrawPage() {
  const { activeWallet, pledgeRead, pledgeWrite, linkedWallets } = useWallet();
  const [token, setToken] = useState(TOKENS[0]);
  const [amount, setAmount] = useState("");
  const [toWallet, setToWallet] = useState(activeWallet ?? "");
  const [accountBalance, setAccountBalance] = useState<bigint | null>(null);
  const [dailyCap, setDailyCap] = useState<bigint>(500_000_000n); // 500 USDC default
  const [dailyUsed, setDailyUsed] = useState<bigint>(0n);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { accountId } = useWallet();

  useEffect(() => {
    if (!activeWallet || !accountId) return;
    async function fetchState() {
      try {
        const [bal, cap, used] = await Promise.all([
          pledgeRead.getAccountBalance(accountId, token.address),
          pledgeRead.getDailyCap(activeWallet, token.address),
          pledgeRead.getDailyUsed(activeWallet, token.address),
        ]);
        setAccountBalance(bal as bigint);
        setDailyCap(cap as bigint);
        setDailyUsed(used as bigint);
      } catch { /* ignore */ }
    }
    fetchState();
  }, [activeWallet, accountId, token, pledgeRead]);

  const amountBigInt = (() => {
    try {
      const v = parseFloat(amount);
      if (!isNaN(v) && v > 0) return ethers.parseUnits(amount, 6);
    } catch { /* */ }
    return null;
  })();

  const remaining = dailyCap > dailyUsed ? dailyCap - dailyUsed : 0n;
  const tier = amountBigInt ? getWithdrawalTier(amountBigInt, remaining, dailyCap) : null;

  async function handleWithdraw() {
    if (!pledgeWrite || !amountBigInt || !activeWallet) return;
    setLoading(true);
    setError(null);
    try {
      const tx = await pledgeWrite.withdraw(token.address, amountBigInt);
      const receipt = await tx.wait();
      // Parse the WithdrawalQueued event to check if instant or queued
      const iface = pledgeWrite.interface;
      let queuedId: bigint | null = null;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog(log);
          if (parsed?.name === "WithdrawalQueued") {
            queuedId = parsed.args[0] as bigint;
          }
        } catch { /* */ }
      }
      if (queuedId) {
        setSuccess(`Withdrawal queued (ID #${queuedId}). Check pending withdrawals for status.`);
      } else {
        setSuccess("Withdrawal complete! Funds sent to your wallet.");
      }
      setAmount("");
    } catch (e: unknown) {
      setError((e as Error).message ?? "Withdrawal failed.");
    } finally {
      setLoading(false);
    }
  }

  const fmtBal = (v: bigint | null) => v !== null ? ethers.formatUnits(v, 6) : "—";

  return (
    <KYCGate featureName="Withdraw">
      {/* Mobile */}
      <div className="md:hidden">
        <Header title="Withdraw" />
        <div className="px-4 pt-5 pb-24 space-y-4">
          <WithdrawForm
            tokens={TOKENS}
            token={token}
            setToken={setToken}
            amount={amount}
            setAmount={setAmount}
            toWallet={toWallet}
            setToWallet={setToWallet}
            linkedWallets={linkedWallets.map(w => w.address)}
            accountBalance={accountBalance}
            dailyCap={dailyCap}
            dailyUsed={dailyUsed}
            remaining={remaining}
            tier={tier}
            loading={loading}
            error={error}
            success={success}
            fmtBal={fmtBal}
            onWithdraw={handleWithdraw}
          />
        </div>
      </div>

      {/* Desktop */}
      <div className="hidden md:block p-8 max-w-xl mx-auto">
        <h1 className="text-3xl font-extrabold text-white mb-2">Withdraw</h1>
        <p className="text-[#555] text-sm mb-8">Withdraw funds from your RemitSafe account to a linked wallet.</p>
        <WithdrawForm
          tokens={TOKENS}
          token={token}
          setToken={setToken}
          amount={amount}
          setAmount={setAmount}
          toWallet={toWallet}
          setToWallet={setToWallet}
          linkedWallets={linkedWallets.map(w => w.address)}
          accountBalance={accountBalance}
          dailyCap={dailyCap}
          dailyUsed={dailyUsed}
          remaining={remaining}
          tier={tier}
          loading={loading}
          error={error}
          success={success}
          fmtBal={fmtBal}
          onWithdraw={handleWithdraw}
        />
      </div>
    </KYCGate>
  );
}

interface WithdrawFormProps {
  tokens: typeof TOKENS;
  token: (typeof TOKENS)[0];
  setToken: (t: (typeof TOKENS)[0]) => void;
  amount: string;
  setAmount: (v: string) => void;
  toWallet: string;
  setToWallet: (v: string) => void;
  linkedWallets: string[];
  accountBalance: bigint | null;
  dailyCap: bigint;
  dailyUsed: bigint;
  remaining: bigint;
  tier: "instant" | "1h" | "24h" | null;
  loading: boolean;
  error: string | null;
  success: string | null;
  fmtBal: (v: bigint | null) => string;
  onWithdraw: () => void;
}

function WithdrawForm({
  tokens, token, setToken, amount, setAmount,
  toWallet, setToWallet, linkedWallets,
  accountBalance, dailyCap, dailyUsed, remaining,
  tier, loading, error, success, fmtBal, onWithdraw,
}: WithdrawFormProps) {
  const tierLabel: Record<string, string> = {
    instant: "Instant transfer",
    "1h": "1-hour timelock",
    "24h": "24-hour timelock",
  };
  const tierColor: Record<string, string> = {
    instant: "#22c55e",
    "1h": "#f59e0b",
    "24h": "#ef4444",
  };

  return (
    <div className="space-y-4">
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}
      {success && (
        <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
          {success}
        </div>
      )}

      {/* Token select */}
      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">TOKEN</div>
        <div className="flex gap-2">
          {tokens.map(t => (
            <button
              key={t.symbol}
              onClick={() => setToken(t)}
              className={`flex-1 py-2.5 rounded-xl text-sm font-bold transition-colors ${
                token.symbol === t.symbol
                  ? "bg-[#DDE048] text-black"
                  : "bg-[#1a1d24] text-[#555] hover:text-white"
              }`}
            >
              {t.symbol}
            </button>
          ))}
        </div>
      </div>

      {/* Amount */}
      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">AMOUNT</div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={e => setAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent text-2xl font-extrabold text-white outline-none placeholder:text-[#333]"
          />
          <span className="text-[#555] font-semibold">{token.symbol}</span>
        </div>
        <div className="text-[11px] text-[#555] mt-2">
          Available: {fmtBal(accountBalance)} {token.symbol}
        </div>
      </div>

      {/* Destination wallet */}
      <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">SEND TO</div>
        <select
          value={toWallet}
          onChange={e => setToWallet(e.target.value)}
          className="w-full bg-transparent text-white text-sm outline-none"
        >
          {linkedWallets.length === 0 && <option value="">No linked wallets</option>}
          {linkedWallets.map(w => (
            <option key={w} value={w} className="bg-[#11141A]">
              {w.slice(0, 10)}…{w.slice(-8)}
            </option>
          ))}
        </select>
        <div className="text-[11px] text-[#555] mt-2">
          Daily cap remaining: {fmtBal(remaining)} {token.symbol}
          {dailyCap === BigInt(0) && " (no cap)"}
        </div>
      </div>

      {/* Preview */}
      {tier && amount && (
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">WITHDRAWAL PREVIEW</div>
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold text-white">{amount} {token.symbol}</span>
            <ArrowRight size={14} className="text-[#555]" />
            <span className="text-sm font-bold" style={{ color: tierColor[tier] }}>
              {tierLabel[tier]}
            </span>
          </div>
          {tier !== "instant" && (
            <p className="text-[11px] text-[#555] mt-1.5">
              Exceeds daily cap — a timelock applies. You can claim after the lock period.
            </p>
          )}
        </div>
      )}

      <button
        onClick={onWithdraw}
        disabled={loading || !amount || parseFloat(amount) <= 0}
        className="w-full bg-[#DDE048] text-black font-bold rounded-2xl py-4 text-sm flex items-center justify-center gap-2 disabled:opacity-50"
      >
        {loading && <Loader2 size={15} className="animate-spin" />}
        {loading ? "Submitting…" : "Withdraw"}
      </button>
    </div>
  );
}

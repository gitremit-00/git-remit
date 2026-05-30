"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { ethers } from "ethers";
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, RefreshCw, FileText,
  Store, ChevronRight, Shield, AlertCircle,
} from "lucide-react";
import Header from "../../../../components/Header";
import LoadingSpinner from "../../../../components/LoadingSpinner";
import TxGuard from "../../../../components/TxGuard";
import { useWallet } from "../../../../context/WalletContext";
import {
  getTransferRequest, cancelTransferRequest, senderAcceptsCounter,
  senderCounterPropose, confirmTransferRequest, sendTransferRequestNotification,
  type TransferRequest,
} from "../../../../lib/supabase";
import { getPledgeMeta } from "../../../../lib/pledgeMeta";
import { CONTRACTS } from "../../../../contracts/addresses";

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }
function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Request Pending",
  renegotiating: "Renegotiating",
  accepted: "Accepted",
  rejected: "Rejected",
  cancelled: "Cancelled",
  confirmed: "Confirmed",
};
const STATUS_COLOR: Record<string, string> = {
  pending: "#f59e0b", renegotiating: "#60a5fa", accepted: "#22c55e",
  rejected: "#ef4444", cancelled: "#888", confirmed: "#22c55e",
};
const STATUS_BG: Record<string, string> = {
  pending: "#f59e0b22", renegotiating: "#60a5fa22", accepted: "#22c55e22",
  rejected: "#ef444422", cancelled: "#88888822", confirmed: "#22c55e22",
};
const STATUS_ICON: Record<string, React.ReactNode> = {
  pending: <Clock size={14} color="#f59e0b" />,
  renegotiating: <RefreshCw size={14} color="#60a5fa" />,
  accepted: <CheckCircle2 size={14} color="#22c55e" />,
  rejected: <XCircle size={14} color="#ef4444" />,
  cancelled: <XCircle size={14} color="#888" />,
  confirmed: <CheckCircle2 size={14} color="#22c55e" />,
};

const INTERVAL_LABEL: Record<number, string> = {
  [7 * 86400]: "Weekly",
  [14 * 86400]: "Bi-weekly",
  [30 * 86400]: "Monthly",
};

interface FieldRowProps { label: string; original: string | null; counter: string | null; changed?: boolean; last?: boolean; }
function FieldRow({ label, original, counter, changed, last }: FieldRowProps) {
  return (
    <div className={`flex justify-between py-3 text-sm ${!last ? "border-b border-[#1e2230]" : ""}`}>
      <span className="text-[#555]">{label}</span>
      <div className="flex items-center gap-2">
        {changed && counter !== null && (
          <span className="text-[#888] line-through text-xs">{original ?? "—"}</span>
        )}
        <span className={`font-semibold ${changed ? "text-[#60a5fa]" : "text-white"}`}>
          {changed && counter !== null ? counter : (original ?? "—")}
        </span>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 text-sm ${!last ? "border-b border-[#1e2230]" : ""}`}>
      <span className="text-[#555]">{label}</span>
      <span className={`font-semibold ${accent ? "text-[#DDE048]" : "text-white"}`}>{value}</span>
    </div>
  );
}

export default function SenderRequestDetail() {
  const params = useParams();
  const router = useRouter();
  const { account, accountId, signer, pledgeRead, pledgeWrite, usdcRead, usdcWrite, usdtRead, usdtWrite } = useWallet();
  const id = params.id as string;

  const [req, setReq] = useState<TransferRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [txError, setTxError] = useState("");
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [showPayConfirm, setShowPayConfirm] = useState(false);
  const [feeBps, setFeeBps] = useState(100);
  const [requiredPct, setRequiredPct] = useState(20);

  // Counter-propose form state
  const [counterAmount, setCounterAmount] = useState("");
  const [counterDeposit, setCounterDeposit] = useState("");
  const [counterDate, setCounterDate] = useState("");
  const [counterAmtPerPeriod, setCounterAmtPerPeriod] = useState("");
  const [counterPeriods, setCounterPeriods] = useState("");
  const [counterInterval, setCounterInterval] = useState(30 * 86400);
  const [counterFirstDue, setCounterFirstDue] = useState("");
  const [counterNote, setCounterNote] = useState("");

  useEffect(() => { loadRequest(); }, [id]);
  useEffect(() => { if (account && pledgeRead) fetchFeeData(); }, [account, pledgeRead]);

  async function loadRequest() {
    setLoading(true);
    try { setReq(await getTransferRequest(id)); } finally { setLoading(false); }
  }

  async function fetchFeeData() {
    try {
      const [pct, bps] = await Promise.all([
        pledgeRead.getAccountRequiredDepositPct(accountId),
        pledgeRead.getServiceFeeBps(accountId),
      ]);
      setRequiredPct(Number(pct));
      setFeeBps(Number(bps));
    } catch { /* ignore */ }
  }

  async function handleCancel() {
    if (!req || !confirm("Cancel this request?")) return;
    setActionLoading(true);
    await cancelTransferRequest(id, "sender");
    await sendTransferRequestNotification(id, req.merchant_address, "cancelled");
    await loadRequest();
    setActionLoading(false);
  }

  async function handleCounterPropose() {
    if (!req) return;
    setActionLoading(true);
    setTxError("");
    try {
      if (req.type === "partial") {
        await senderCounterPropose(id, {
          total_amount: counterAmount ? parseFloat(counterAmount) : req.total_amount,
          initial_deposit: counterDeposit ? parseFloat(counterDeposit) : req.initial_deposit,
          commitment_date: counterDate ? new Date(counterDate).toISOString() : req.commitment_date,
          amount_per_period: null,
          interval_seconds: null,
          total_periods: null,
          first_due_date: null,
          note: counterNote || req.note,
        }, req.renegotiation_count);
      } else {
        await senderCounterPropose(id, {
          total_amount: null,
          initial_deposit: null,
          commitment_date: null,
          amount_per_period: counterAmtPerPeriod ? parseFloat(counterAmtPerPeriod) : req.amount_per_period,
          interval_seconds: counterInterval,
          total_periods: counterPeriods ? parseInt(counterPeriods) : req.total_periods,
          first_due_date: counterFirstDue ? new Date(counterFirstDue).toISOString() : req.first_due_date,
          note: counterNote || req.note,
        }, req.renegotiation_count);
      }
      await sendTransferRequestNotification(id, req.merchant_address, "renegotiated");
      setShowCounterForm(false);
      await loadRequest();
    } finally { setActionLoading(false); }
  }

  async function handleAgreeAndPay() {
    if (!req || !signer || !pledgeWrite) return;

    // Merchant must have created the pledge on-chain first and saved the pledgeId.
    if (!req.pledge_id) {
      setTxError("Waiting for merchant to confirm on-chain. Please check back shortly.");
      return;
    }

    setActionLoading(true); setTxError("");
    const useCounter = req.status === "renegotiating" && req.counter_total_amount !== null;
    const agreedTerms = {
      total_amount: useCounter ? req.counter_total_amount : req.total_amount,
      initial_deposit: useCounter ? req.counter_initial_deposit : req.initial_deposit,
      amount_per_period: useCounter ? req.counter_amount_per_period : req.amount_per_period,
    };

    const tokenAddress = req.token === "USDC" ? CONTRACTS.MOCK_USDC : CONTRACTS.MOCK_USDT;
    const tokenRead = req.token === "USDC" ? usdcRead : usdtRead;
    const tokenWrite = req.token === "USDC" ? usdcWrite : usdtWrite;
    if (!tokenWrite) { setTxError("Wallet not connected."); setActionLoading(false); return; }

    try {
      if (req.type === "partial") {
        // Merchant already created the pledge — payer submits deposit
        const gross = agreedTerms.total_amount! * (1 + feeBps / 10000);
        const deposit = agreedTerms.initial_deposit ?? gross;
        const depositAmt = ethers.parseUnits(deposit.toFixed(6), 6);

        const balance: bigint = await tokenRead.balanceOf(account);
        if (balance < depositAmt) {
          setTxError(`Insufficient ${req.token} balance.`);
          setActionLoading(false); return;
        }
        const allowance: bigint = await tokenRead.allowance(account, CONTRACTS.REMITTANCE_PLEDGE);
        if (allowance < depositAmt) {
          setTxStatus("approving");
          const approveData = tokenWrite.interface.encodeFunctionData("approve", [CONTRACTS.REMITTANCE_PLEDGE, depositAmt]);
          const approveTx = await signer.sendTransaction({ to: tokenAddress, data: approveData });
          await approveTx.wait();
        }
        setTxStatus("depositing");
        const depositData = pledgeWrite.interface.encodeFunctionData("submitDeposit", [req.pledge_id, depositAmt]);
        const depositTx = await signer.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: depositData });
        await depositTx.wait();
        await confirmTransferRequest(id, req.pledge_id, depositTx.hash);
      } else {
        // Recurring — merchant created it, payer pays first installment
        const gross = agreedTerms.amount_per_period! * (1 + feeBps / 10000);
        const grossAmt = ethers.parseUnits(gross.toFixed(6), 6);

        const balance: bigint = await tokenRead.balanceOf(account);
        if (balance < grossAmt) {
          setTxError(`Insufficient ${req.token} balance.`);
          setActionLoading(false); return;
        }
        const allowance: bigint = await tokenRead.allowance(account, CONTRACTS.REMITTANCE_PLEDGE);
        if (allowance < grossAmt) {
          setTxStatus("approving");
          const approveData = tokenWrite.interface.encodeFunctionData("approve", [CONTRACTS.REMITTANCE_PLEDGE, grossAmt]);
          const approveTx = await signer.sendTransaction({ to: tokenAddress, data: approveData });
          await approveTx.wait();
        }
        setTxStatus("depositing");
        const installData = pledgeWrite.interface.encodeFunctionData("payInstallment", [req.pledge_id]);
        const tx = await signer.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: installData });
        await tx.wait();
        await confirmTransferRequest(id, req.pledge_id, tx.hash);
      }

      if (useCounter) {
        await senderAcceptsCounter(id, {
          counter_total_amount: req.counter_total_amount,
          counter_initial_deposit: req.counter_initial_deposit,
          counter_commitment_date: req.counter_commitment_date,
          counter_amount_per_period: req.counter_amount_per_period,
          counter_interval_seconds: req.counter_interval_seconds,
          counter_total_periods: req.counter_total_periods,
          counter_first_due_date: req.counter_first_due_date,
          counter_note: req.counter_note,
        });
      }

      setTxStatus("done");
      await sendTransferRequestNotification(id, req.merchant_address, "confirmed");
      setTimeout(() => router.push("/pledges"), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setTxError(msg.length > 120 ? msg.slice(0, 120) + "…" : msg);
      setTxStatus(""); setActionLoading(false);
    }
  }

  const txGuardSteps = req?.type === "installment"
    ? [{ label: "Create recurring pledge on-chain", state: (txStatus === "creating" ? "active" : txStatus === "done" ? "done" : "pending") as "active" | "done" | "pending" }]
    : [
        { label: `Approve ${req?.token ?? ""} spend`, state: (txStatus === "approving" ? "active" : (txStatus === "creating" || txStatus === "done") ? "done" : "pending") as "active" | "done" | "pending" },
        { label: "Create pledge on-chain", state: (txStatus === "creating" ? "active" : txStatus === "done" ? "done" : "pending") as "active" | "done" | "pending" },
      ];

  if (loading) return (
    <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>
  );
  if (!req) return (
    <div className="min-h-screen flex items-center justify-center text-[#555]">Request not found.</div>
  );

  const meta = getPledgeMeta(req.merchant_address);
  const hasCounter = req.counter_total_amount !== null || req.counter_amount_per_period !== null;
  const canAct = req.status !== "cancelled" && req.status !== "confirmed" && req.status !== "rejected";
  // "confirmed" means merchant created pledge on-chain — payer can now deposit
  const canPay = (req.status === "accepted" || req.status === "confirmed") || (req.status === "renegotiating" && hasCounter);

  const termRows = req.type === "partial" ? (
    <>
      <FieldRow label="Total amount" original={`${req.total_amount?.toFixed(2) ?? "—"} ${req.token}`}
        counter={req.counter_total_amount !== null ? `${req.counter_total_amount.toFixed(2)} ${req.token}` : null}
        changed={req.counter_total_amount !== null && req.counter_total_amount !== req.total_amount} />
      <FieldRow label="Initial deposit" original={`${req.initial_deposit?.toFixed(2) ?? "—"} ${req.token}`}
        counter={req.counter_initial_deposit !== null ? `${req.counter_initial_deposit.toFixed(2)} ${req.token}` : null}
        changed={req.counter_initial_deposit !== null && req.counter_initial_deposit !== req.initial_deposit} />
      <FieldRow label="Due date" original={fmtDate(req.commitment_date)}
        counter={req.counter_commitment_date !== null ? fmtDate(req.counter_commitment_date) : null}
        changed={req.counter_commitment_date !== null && req.counter_commitment_date !== req.commitment_date} last />
    </>
  ) : (
    <>
      <FieldRow label="Amount per payment" original={`${req.amount_per_period?.toFixed(2) ?? "—"} ${req.token}`}
        counter={req.counter_amount_per_period !== null ? `${req.counter_amount_per_period.toFixed(2)} ${req.token}` : null}
        changed={req.counter_amount_per_period !== null && req.counter_amount_per_period !== req.amount_per_period} />
      <FieldRow label="Number of payments" original={`${req.total_periods ?? "—"}`}
        counter={req.counter_total_periods !== null ? `${req.counter_total_periods}` : null}
        changed={req.counter_total_periods !== null && req.counter_total_periods !== req.total_periods} />
      <FieldRow label="Interval" original={INTERVAL_LABEL[req.interval_seconds ?? 0] ?? `${req.interval_seconds}s`}
        counter={req.counter_interval_seconds !== null ? (INTERVAL_LABEL[req.counter_interval_seconds] ?? `${req.counter_interval_seconds}s`) : null}
        changed={req.counter_interval_seconds !== null && req.counter_interval_seconds !== req.interval_seconds} />
      <FieldRow label="First due" original={fmtDate(req.first_due_date)}
        counter={req.counter_first_due_date !== null ? fmtDate(req.counter_first_due_date) : null}
        changed={req.counter_first_due_date !== null && req.counter_first_due_date !== req.first_due_date} last />
    </>
  );

  const PageContent = (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#555] mb-6">
        <Link href="/pledges/requests" className="flex items-center gap-1 hover:text-[#888] transition-colors">
          <ArrowLeft size={14} /> Transfer Requests
        </Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888] text-xs font-mono">{id.slice(0, 8)}…</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-2xl font-extrabold text-white">Transfer Request</h1>
          </div>
          <p className="text-[#555] text-sm">
            {req.type === "partial" ? "Partial payment" : "Installment plan"} · {req.token}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full"
          style={{ color: STATUS_COLOR[req.status], background: STATUS_BG[req.status] }}>
          {STATUS_ICON[req.status]} {STATUS_LABEL[req.status]}
        </span>
      </div>

      {/* Merchant Info */}
      <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-4 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0">
          <Store size={18} color="#555" />
        </div>
        <div>
          <div className="text-white font-semibold">{meta?.name || "Merchant"}</div>
          <div className="text-[#555] text-xs font-mono">{req.merchant_address}</div>
        </div>
      </div>

      {/* Renegotiation banner */}
      {req.status === "renegotiating" && hasCounter && (
        <div className="bg-[#60a5fa]/5 border border-[#60a5fa]/30 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <RefreshCw size={16} color="#60a5fa" className="shrink-0 mt-0.5" />
          <div>
            <div className="text-[#60a5fa] font-semibold text-sm mb-0.5">Merchant proposed new terms</div>
            <div className="text-[#888] text-xs">Changes are highlighted in blue below. Agree to pay or send a counter-proposal.</div>
            {req.counter_note && <div className="text-[#aaa] text-xs mt-2 italic">&ldquo;{req.counter_note}&rdquo;</div>}
          </div>
        </div>
      )}

      {req.status === "accepted" && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <CheckCircle2 size={16} color="#22c55e" className="shrink-0 mt-0.5" />
          <div>
            <div className="text-green-400 font-semibold text-sm mb-0.5">Merchant accepted your request!</div>
            <div className="text-[#888] text-xs">Click &ldquo;Pay Now&rdquo; below to lock funds and record on-chain.</div>
          </div>
        </div>
      )}

      {req.status === "cancelled" && (
        <div className="bg-[#888]/5 border border-[#888]/20 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <XCircle size={16} color="#888" className="shrink-0 mt-0.5" />
          <div className="text-[#888] text-sm">
            This request was cancelled{req.cancelled_by ? ` by the ${req.cancelled_by}` : ""}.
          </div>
        </div>
      )}

      {req.status === "confirmed" && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <CheckCircle2 size={16} color="#22c55e" className="shrink-0 mt-0.5" />
          <div>
            <div className="text-green-400 font-semibold text-sm mb-0.5">Transfer confirmed on-chain</div>
            {req.pledge_id && <div className="text-[#555] text-xs">Pledge ID: #{req.pledge_id}</div>}
            {req.tx_hash && <div className="text-[#555] text-xs font-mono truncate">Tx: {req.tx_hash}</div>}
          </div>
        </div>
      )}

      {/* Terms card */}
      <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-5 py-1 mb-4">
        <div className="text-[10px] text-[#444] tracking-[1.5px] pt-4 mb-1 font-semibold">TERMS</div>
        {termRows}
        {req.note && (
          <div className="py-3 text-sm border-t border-[#1e2230]">
            <span className="text-[#555]">Note</span>
            <p className="text-[#888] text-xs mt-1 italic">&ldquo;{req.note}&rdquo;</p>
          </div>
        )}
      </div>

      {/* Renegotiation count */}
      {req.renegotiation_count > 0 && (
        <div className="text-[#555] text-xs text-center mb-4">
          {req.renegotiation_count} renegotiation{req.renegotiation_count > 1 ? "s" : ""} so far
        </div>
      )}

      {/* Actions */}
      {canAct && !showCounterForm && (
        <div className="space-y-3">
          {canPay && (
            <>
              {txStatus === "done" ? (
                <div className="w-full bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2">
                  <CheckCircle2 size={16} /> On-chain! Redirecting to pledges…
                </div>
              ) : (
                <button onClick={() => setShowPayConfirm(true)} disabled={actionLoading}
                  className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
                  {hasCounter ? "Agree & Pay →" : "Pay Now →"}
                </button>
              )}
            </>
          )}
          {req.status !== "accepted" && (
            <button onClick={() => setShowCounterForm(true)}
              className="w-full bg-[#1e2230] text-[#888] font-semibold text-sm rounded-xl py-3 hover:text-white hover:bg-[#252b38] transition-colors">
              Counter-propose
            </button>
          )}
          <button onClick={handleCancel} disabled={actionLoading}
            className="w-full text-[#555] text-sm py-2 hover:text-red-400 transition-colors">
            Cancel Request
          </button>
        </div>
      )}

      {/* Pay confirmation */}
      {showPayConfirm && (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 mb-4">
          <div className="flex items-start gap-2 mb-4">
            <Shield size={14} color="#555" className="shrink-0 mt-0.5" />
            <p className="text-[#888] text-xs leading-relaxed">
              {req.type === "partial"
                ? `MetaMask will ask you to approve two transactions: ${req.token} spend + pledge creation.`
                : "MetaMask will ask you to sign one transaction to create the recurring pledge."}
            </p>
          </div>
          {txError && (
            <div className="bg-[#1f0d0d] border border-red-500/20 rounded-xl px-4 py-3 mb-4">
              <p className="text-red-400 text-[13px] font-semibold mb-0.5">Transaction failed</p>
              <p className="text-[#888] text-xs">{txError}</p>
            </div>
          )}
          <div className="flex gap-3">
            <button onClick={handleAgreeAndPay} disabled={actionLoading}
              className="flex-1 bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
              {actionLoading ? "Processing…" : "Confirm & Sign"}
            </button>
            <button onClick={() => { setShowPayConfirm(false); setTxError(""); }}
              className="px-4 text-[#555] text-sm hover:text-[#888]">
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Counter-propose form */}
      {showCounterForm && (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
          <h3 className="text-white font-bold mb-4">Your counter-proposal</h3>
          {req.type === "partial" ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Total amount ({req.token})</label>
                <input type="number" value={counterAmount} onChange={e => setCounterAmount(e.target.value)}
                  placeholder={req.total_amount?.toFixed(2) ?? ""}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Initial deposit ({req.token})</label>
                <input type="number" value={counterDeposit} onChange={e => setCounterDeposit(e.target.value)}
                  placeholder={req.initial_deposit?.toFixed(2) ?? ""}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Due date</label>
                <input type="datetime-local" value={counterDate} onChange={e => setCounterDate(e.target.value)}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Amount per payment ({req.token})</label>
                <input type="number" value={counterAmtPerPeriod} onChange={e => setCounterAmtPerPeriod(e.target.value)}
                  placeholder={req.amount_per_period?.toFixed(2) ?? ""}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Number of payments</label>
                <input type="number" value={counterPeriods} onChange={e => setCounterPeriods(e.target.value)}
                  placeholder={String(req.total_periods ?? "")}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Interval</label>
                <select value={counterInterval} onChange={e => setCounterInterval(Number(e.target.value))}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none">
                  <option value={7 * 86400}>Weekly</option>
                  <option value={14 * 86400}>Bi-weekly</option>
                  <option value={30 * 86400}>Monthly</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-[#555] block mb-1.5">First due date</label>
                <input type="datetime-local" value={counterFirstDue} onChange={e => setCounterFirstDue(e.target.value)}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
            </div>
          )}
          <div className="mt-3">
            <label className="text-xs text-[#555] block mb-1.5">Message (optional)</label>
            <textarea value={counterNote} onChange={e => setCounterNote(e.target.value)}
              placeholder="Explain your changes…" rows={2}
              className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40 resize-none" />
          </div>
          <div className="flex gap-3 mt-4">
            <button onClick={handleCounterPropose} disabled={actionLoading}
              className="flex-1 bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
              {actionLoading ? "Sending…" : "Send Counter-proposal"}
            </button>
            <button onClick={() => setShowCounterForm(false)}
              className="px-4 text-[#555] text-sm hover:text-[#888]">
              Cancel
            </button>
          </div>
        </div>
      )}

      <TxGuard active={actionLoading && txStatus !== "done" && showPayConfirm} steps={txGuardSteps} />
    </div>
  );

  return (
    <>
      <div className="hidden md:block">{PageContent}</div>
      <div className="md:hidden min-h-screen">
        <Header title="Request Detail" back />
        {PageContent}
      </div>
    </>
  );
}

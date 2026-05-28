"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft, Clock, CheckCircle2, XCircle, RefreshCw,
  ChevronRight, User,
} from "lucide-react";
import Header from "../../../../../components/Header";
import LoadingSpinner from "../../../../../components/LoadingSpinner";
import { ethers } from "ethers";
import { useWallet } from "../../../../../context/WalletContext";
import { CONTRACTS } from "../../../../../contracts/addresses";
import {
  getTransferRequest, merchantCounterPropose,
  cancelTransferRequest, sendTransferRequestNotification,
  confirmTransferRequest, type TransferRequest,
} from "../../../../../lib/supabase";
import { getPledgeMeta } from "../../../../../lib/pledgeMeta";

function fmtDate(s: string | null) {
  if (!s) return "—";
  return new Date(s).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Request Pending", renegotiating: "Renegotiating", accepted: "Accepted",
  rejected: "Rejected", cancelled: "Cancelled", confirmed: "Confirmed",
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

function TermRow({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 text-sm ${!last ? "border-b border-[#1e2230]" : ""}`}>
      <span className="text-[#555]">{label}</span>
      <span className={`font-semibold ${accent ? "text-[#DDE048]" : "text-white"}`}>{value}</span>
    </div>
  );
}

export default function MerchantRequestDetail() {
  const params = useParams();
  const router = useRouter();
  const { signer, pledgeWrite } = useWallet();
  const id = params.id as string;

  const [req, setReq] = useState<TransferRequest | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showCounterForm, setShowCounterForm] = useState(false);
  const [error, setError] = useState("");

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

  async function loadRequest() {
    setLoading(true);
    try { setReq(await getTransferRequest(id)); } finally { setLoading(false); }
  }

  async function handleAccept() {
    if (!req) return;
    if (!signer || !pledgeWrite) {
      setError("Please connect your wallet first before accepting.");
      return;
    }
    setActionLoading(true); setError("");
    try {
      // Step 1 — determine agreed terms (use counter if renegotiating)
      const useCounter = req.status === "renegotiating" && req.counter_total_amount !== null;
      const tokenAddress = req.token === "USDC" ? CONTRACTS.MOCK_USDC : CONTRACTS.MOCK_USDT;

      let txHash: string;
      let pledgeId: string;

      if (req.type === "partial") {
        const total = useCounter ? req.counter_total_amount! : req.total_amount!;
        const commitDate = useCounter ? req.counter_commitment_date! : req.commitment_date!;
        const totalAmt = ethers.parseUnits(total.toFixed(6), 6);
        const commitTs = Math.floor(new Date(commitDate).getTime() / 1000);

        // Step 2 — merchant calls createPledge on-chain
        const createData = pledgeWrite.interface.encodeFunctionData("createPledge", [
          tokenAddress, req.sender_address, totalAmt, commitTs,
        ]);
        const tx = await signer.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: createData });
        const receipt = await tx.wait();
        txHash = tx.hash;

        // Extract pledgeId from PledgeCreated event (topic[1])
        const eventLog = (receipt?.logs ?? []).filter(l => l.topics.length >= 2)[0];
        pledgeId = eventLog ? String(BigInt(eventLog.topics[1])) : "unknown";
      } else {
        // Recurring pledge
        const amtPerPeriod = useCounter ? req.counter_amount_per_period! : req.amount_per_period!;
        const intervalSecs = useCounter ? req.counter_interval_seconds! : req.interval_seconds!;
        const totalPeriods = useCounter ? req.counter_total_periods! : req.total_periods!;
        const firstDue = useCounter ? req.counter_first_due_date! : req.first_due_date!;
        const amtAmt = ethers.parseUnits(amtPerPeriod.toFixed(6), 6);
        const firstDueTs = Math.floor(new Date(firstDue).getTime() / 1000);

        const createData = pledgeWrite.interface.encodeFunctionData("createRecurringPledge", [
          tokenAddress, req.sender_address, amtAmt, intervalSecs, totalPeriods, firstDueTs,
        ]);
        const tx = await signer.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: createData });
        const receipt = await tx.wait();
        txHash = tx.hash;

        const eventLog = (receipt?.logs ?? []).filter(l => l.topics.length >= 2)[0];
        pledgeId = eventLog ? String(BigInt(eventLog.topics[1])) : "unknown";
      }

      // Step 3 — save pledgeId to Supabase and mark accepted
      await confirmTransferRequest(id, pledgeId, txHash);
      await sendTransferRequestNotification(id, req.sender_address, "accepted");
      await loadRequest();
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setError(e.reason ?? e.message ?? "Transaction failed.");
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!req || !confirm("Cancel this request?")) return;
    setActionLoading(true);
    await cancelTransferRequest(id, "merchant");
    await sendTransferRequestNotification(id, req.sender_address, "cancelled");
    router.push("/merchant/transfers");
  }

  async function handleCounterPropose() {
    if (!req) return;
    setActionLoading(true); setError("");
    try {
      const counter = req.type === "partial" ? {
        counter_total_amount: counterAmount ? parseFloat(counterAmount) : req.total_amount,
        counter_initial_deposit: counterDeposit ? parseFloat(counterDeposit) : req.initial_deposit,
        counter_commitment_date: counterDate ? new Date(counterDate).toISOString() : req.commitment_date,
        counter_amount_per_period: null as null,
        counter_interval_seconds: null as null,
        counter_total_periods: null as null,
        counter_first_due_date: null as null,
        counter_note: counterNote || null,
      } : {
        counter_total_amount: null as null,
        counter_initial_deposit: null as null,
        counter_commitment_date: null as null,
        counter_amount_per_period: counterAmtPerPeriod ? parseFloat(counterAmtPerPeriod) : req.amount_per_period,
        counter_interval_seconds: counterInterval,
        counter_total_periods: counterPeriods ? parseInt(counterPeriods) : req.total_periods,
        counter_first_due_date: counterFirstDue ? new Date(counterFirstDue).toISOString() : req.first_due_date,
        counter_note: counterNote || null,
      };
      await merchantCounterPropose(id, counter, req.renegotiation_count);
      await sendTransferRequestNotification(id, req.sender_address, "renegotiated");
      setShowCounterForm(false);
      await loadRequest();
    } catch { setError("Failed to send counter-proposal. Please try again."); }
    finally { setActionLoading(false); }
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><LoadingSpinner /></div>;
  if (!req) return <div className="min-h-screen flex items-center justify-center text-[#555]">Request not found.</div>;

  const meta = getPledgeMeta(req.sender_address);
  const canAct = req.status === "pending" || req.status === "renegotiating";
  const isCounterPending = req.status === "renegotiating" &&
    (req.counter_total_amount !== null || req.counter_amount_per_period !== null);

  const termRows = req.type === "partial" ? (
    <>
      <TermRow label="Total amount" value={`${req.total_amount?.toFixed(2) ?? "—"} ${req.token}`} accent />
      <TermRow label="Initial deposit" value={`${req.initial_deposit?.toFixed(2) ?? "—"} ${req.token}`} />
      <TermRow label="Due date" value={fmtDate(req.commitment_date)} last />
    </>
  ) : (
    <>
      <TermRow label="Amount per payment" value={`${req.amount_per_period?.toFixed(2) ?? "—"} ${req.token}`} accent />
      <TermRow label="Number of payments" value={`${req.total_periods ?? "—"}`} />
      <TermRow label="Interval" value={INTERVAL_LABEL[req.interval_seconds ?? 0] ?? `${req.interval_seconds}s`} />
      <TermRow label="First due" value={fmtDate(req.first_due_date)} last />
    </>
  );

  const PageContent = (
    <div className="max-w-2xl mx-auto px-4 md:px-8 py-8 pb-24">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-[#555] mb-6">
        <Link href="/merchant/transfers" className="flex items-center gap-1 hover:text-[#888] transition-colors">
          <ArrowLeft size={14} /> Incoming Transfers
        </Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888] text-xs">Request</span>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888] text-xs font-mono">{id.slice(0, 8)}…</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white mb-1">Transfer Request</h1>
          <p className="text-[#555] text-sm">
            {req.type === "partial" ? "Partial payment" : "Installment plan"} · {req.token}
            {req.renegotiation_count > 0 && (
              <span className="ml-2 text-[#60a5fa]">· {req.renegotiation_count} negotiation{req.renegotiation_count > 1 ? "s" : ""}</span>
            )}
          </p>
        </div>
        <span className="flex items-center gap-1.5 text-sm font-bold px-3 py-1.5 rounded-full"
          style={{ color: STATUS_COLOR[req.status], background: STATUS_BG[req.status] }}>
          {STATUS_ICON[req.status]} {STATUS_LABEL[req.status]}
        </span>
      </div>

      {/* Sender Info */}
      <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-4 mb-4 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0">
          <User size={18} color="#555" />
        </div>
        <div>
          <div className="text-white font-semibold">{meta?.name || "Sender"}</div>
          <div className="text-[#555] text-xs font-mono">{req.sender_address}</div>
        </div>
      </div>

      {/* Status banners */}
      {req.status === "accepted" && (
        <div className="bg-green-500/5 border border-green-500/20 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <CheckCircle2 size={16} color="#22c55e" className="shrink-0 mt-0.5" />
          <div className="text-green-400 text-sm font-semibold">You accepted this request. Waiting for sender to pay.</div>
        </div>
      )}

      {isCounterPending && (
        <div className="bg-[#60a5fa]/5 border border-[#60a5fa]/20 rounded-2xl p-4 mb-4 flex items-start gap-3">
          <RefreshCw size={16} color="#60a5fa" className="shrink-0 mt-0.5" />
          <div className="text-[#60a5fa] text-sm font-semibold">You sent a counter-proposal. Waiting for the sender&apos;s response.</div>
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
            {req.tx_hash && <Link href={`/merchant/transfers/${req.pledge_id}`} className="text-[#DDE048] text-xs hover:underline">View pledge →</Link>}
          </div>
        </div>
      )}

      {/* Sender's proposed terms */}
      <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-5 py-1 mb-4">
        <div className="text-[10px] text-[#444] tracking-[1.5px] pt-4 mb-1 font-semibold">SENDER&apos;S PROPOSED TERMS</div>
        {termRows}
        {req.note && (
          <div className="py-3 text-sm border-t border-[#1e2230]">
            <span className="text-[#555]">Note</span>
            <p className="text-[#888] text-xs mt-1 italic">&ldquo;{req.note}&rdquo;</p>
          </div>
        )}
      </div>

      {/* Your counter-proposal (if any) */}
      {(req.counter_total_amount !== null || req.counter_amount_per_period !== null) && (
        <div className="bg-[#60a5fa]/5 border border-[#60a5fa]/20 rounded-2xl px-5 py-1 mb-4">
          <div className="text-[10px] text-[#60a5fa] tracking-[1.5px] pt-4 mb-1 font-semibold">YOUR COUNTER-PROPOSAL</div>
          {req.type === "partial" ? (
            <>
              {req.counter_total_amount !== null && <TermRow label="Total amount" value={`${req.counter_total_amount.toFixed(2)} ${req.token}`} accent />}
              {req.counter_initial_deposit !== null && <TermRow label="Initial deposit" value={`${req.counter_initial_deposit.toFixed(2)} ${req.token}`} />}
              {req.counter_commitment_date && <TermRow label="Due date" value={fmtDate(req.counter_commitment_date)} last />}
            </>
          ) : (
            <>
              {req.counter_amount_per_period !== null && <TermRow label="Amount per payment" value={`${req.counter_amount_per_period.toFixed(2)} ${req.token}`} accent />}
              {req.counter_total_periods !== null && <TermRow label="Number of payments" value={`${req.counter_total_periods}`} />}
              {req.counter_interval_seconds !== null && <TermRow label="Interval" value={INTERVAL_LABEL[req.counter_interval_seconds] ?? `${req.counter_interval_seconds}s`} />}
              {req.counter_first_due_date && <TermRow label="First due" value={fmtDate(req.counter_first_due_date)} last />}
            </>
          )}
          {req.counter_note && (
            <div className="py-3 text-sm border-t border-[#1e2230]">
              <p className="text-[#888] text-xs italic">&ldquo;{req.counter_note}&rdquo;</p>
            </div>
          )}
        </div>
      )}

      {/* Actions */}
      {canAct && !showCounterForm && !isCounterPending && (
        <div className="space-y-3">
          {error && !showCounterForm && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-xl px-4 py-3">
              <p className="text-red-400 text-xs">{error}</p>
            </div>
          )}
          <button onClick={handleAccept} disabled={actionLoading}
            className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
            {actionLoading ? "Processing…" : "Accept Request →"}
          </button>
          <button onClick={() => setShowCounterForm(true)}
            className="w-full bg-[#1e2230] text-[#888] font-semibold text-sm rounded-xl py-3 hover:text-white hover:bg-[#252b38] transition-colors">
            Renegotiate
          </button>
          <button onClick={handleCancel} disabled={actionLoading}
            className="w-full text-[#555] text-sm py-2 hover:text-red-400 transition-colors">
            Cancel Request
          </button>
        </div>
      )}

      {/* If counter is pending, can still cancel */}
      {canAct && isCounterPending && (
        <button onClick={handleCancel} disabled={actionLoading}
          className="w-full text-[#555] text-sm py-2 hover:text-red-400 transition-colors mt-2">
          Cancel Request
        </button>
      )}

      {/* Counter-propose form */}
      {showCounterForm && (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
          <h3 className="text-white font-bold mb-4">Propose new terms</h3>
          {req.type === "partial" ? (
            <div className="space-y-3">
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Total amount ({req.token})</label>
                <input type="number" value={counterAmount} onChange={e => setCounterAmount(e.target.value)}
                  placeholder={req.total_amount?.toFixed(2) ?? ""}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-2.5 text-white text-sm outline-none focus:border-[#DDE048]/40" />
              </div>
              <div>
                <label className="text-xs text-[#555] block mb-1.5">Required initial deposit ({req.token})</label>
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
          {error && <p className="text-red-400 text-xs mt-2">{error}</p>}
          <div className="flex gap-3 mt-4">
            <button onClick={handleCounterPropose} disabled={actionLoading}
              className="flex-1 bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 hover:bg-[#c8ce30] transition-colors disabled:opacity-50">
              {actionLoading ? "Sending…" : "Send Counter-proposal"}
            </button>
            <button onClick={() => { setShowCounterForm(false); setError(""); }}
              className="px-4 text-[#555] text-sm hover:text-[#888]">
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="hidden md:block">{PageContent}</div>
      <div className="md:hidden min-h-screen">
        <Header title="Review Request" back />
        {PageContent}
      </div>
    </>
  );
}

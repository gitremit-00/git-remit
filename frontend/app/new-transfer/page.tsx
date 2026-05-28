"use client";
import Header from "../../components/Header";
import Image from "next/image";
import DateTimePicker from "../../components/DateTimePicker";
import TxGuard from "../../components/TxGuard";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import {
  ArrowLeft, Check, Info, CheckCircle2, Clock, Loader,
  ChevronRight, FileText, User, Store, Zap, CreditCard, CalendarDays,
} from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS } from "../../contracts/addresses";
import { useCurrency } from "../../context/CurrencyContext";
import ProgressBar from "../../components/ProgressBar";
import { savePledgeMeta, getPledgeMeta } from "../../lib/pledgeMeta";
import { getPaymentRequest, type PaymentRequest, markNotificationRead, createTransferRequest, confirmTransferRequest, sendTransferRequestNotification } from "../../lib/supabase";
import Link from "next/link";

type PaymentType = "full" | "partial" | "installment";

// Step constants
// 0 = Type Picker, 1 = Recipient, 2 = Payment Type (merchant only), 3 = Amount & Terms, 4 = Review
const STEP_TYPE = 0;
const STEP_RECIPIENT = 1;
const STEP_PAYMENT_TYPE = 2;
const STEP_AMOUNT = 3;
const STEP_REVIEW = 4;

interface FormState {
  merchant: string;
  merchantName: string;
  note: string;
  totalAmount: string;    // total (full/partial) OR amount per period (installment)
  initialDeposit: string; // partial only
  commitmentDate: string; // partial: due date; installment: first due date; full: auto-set
}

const INTERVAL_OPTIONS = [
  { label: "Weekly", seconds: 7 * 86400 },
  { label: "Bi-weekly", seconds: 14 * 86400 },
  { label: "Monthly", seconds: 30 * 86400 },
];

export default function NewTransfer() {
  return (
    <Suspense fallback={<div className="px-4 pt-5 text-[#888] text-sm">Loading transfer...</div>}>
      <NewTransferContent />
    </Suspense>
  );
}

function NewTransferContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, pledgeRead, pledgeWrite, usdcRead, usdcWrite, usdtRead, usdtWrite } = useWallet();
  const { fmt } = useCurrency();

  const [transferMode, setTransferMode] = useState<"merchant" | "p2p">("merchant");
  const [step, setStep] = useState(STEP_TYPE);
  const [paymentType, setPaymentType] = useState<PaymentType>("full");
  const [installmentCount, setInstallmentCount] = useState(3);
  const [installmentInterval, setInstallmentInterval] = useState(30 * 86400);
  const [form, setForm] = useState<FormState>({
    merchant: "", merchantName: "", note: "",
    totalAmount: "", initialDeposit: "", commitmentDate: "",
  });
  const [requestId, setRequestId] = useState<string | null>(null);
  const [requestPreview, setRequestPreview] = useState<PaymentRequest | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const [lockedFields, setLockedFields] = useState<Set<string>>(new Set());
  const [requiredPct, setRequiredPct] = useState(20);
  const [feeBps, setFeeBps] = useState(100);
  const [selectedToken, setSelectedToken] = useState<"USDC" | "USDT">("USDC");
  const [usdcBalance, setUsdcBalance] = useState<string>("—");
  const [usdtBalance, setUsdtBalance] = useState<string>("—");
  const [txError, setTxError] = useState("");
  const [loading, setLoading] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  useEffect(() => {
    const to = searchParams.get("to");
    const reqId = searchParams.get("request");
    if (reqId) {
      setRequestId(reqId);
      getPaymentRequest(reqId).then((req) => {
        if (!req) return;
        setRequestPreview(req);
        setShowPreview(true);
        const notifId = searchParams.get("notif");
        if (notifId) markNotificationRead(notifId);
      });
    } else if (to) {
      const known = getPledgeMeta(to);
      setForm((f) => ({ ...f, merchant: to, merchantName: known?.name ?? "" }));
      if (known?.type) {
        setTransferMode(known.type);
        setStep(STEP_RECIPIENT);
      }
    }
  }, []);

  // Wizard step labels (excludes type picker step 0)
  const WIZARD_STEPS = transferMode === "p2p"
    ? ["Recipient", "Amount", "Review"]
    : ["Recipient", "Payment", "Amount", "Review"];

  // Map internal step → wizard pill index (for progress indicator)
  function pillIndex(s: number): number {
    if (transferMode === "p2p") {
      if (s === STEP_RECIPIENT) return 0;
      if (s === STEP_AMOUNT) return 1;
      return 2;
    }
    return s - 1; // merchant: step1→0, step2→1, step3→2, step4→3
  }

  function pad(n: number) { return String(n).padStart(2, "0"); }

  function back() {
    if (step === STEP_REVIEW) { setStep(STEP_AMOUNT); return; }
    if (step === STEP_AMOUNT) { setStep(transferMode === "p2p" ? STEP_RECIPIENT : STEP_PAYMENT_TYPE); return; }
    if (step === STEP_PAYMENT_TYPE) { setStep(STEP_RECIPIENT); return; }
    if (step === STEP_RECIPIENT) { setStep(STEP_TYPE); return; }
    router.push("/");
  }

  async function fetchAccountData() {
    if (!account) return;
    const [pct, bps, uBal, tBal] = await Promise.all([
      pledgeRead.getRequiredDepositPct(account),
      pledgeRead.getServiceFeeBps(account),
      usdcRead.balanceOf(account),
      usdtRead.balanceOf(account),
    ]);
    setRequiredPct(Number(pct));
    setFeeBps(Number(bps));
    setUsdcBalance(parseFloat(ethers.formatUnits(uBal as bigint, 6)).toFixed(2));
    setUsdtBalance(parseFloat(ethers.formatUnits(tBal as bigint, 6)).toFixed(2));
  }

  async function nextStep() {
    if (step === STEP_TYPE) {
      setStep(STEP_RECIPIENT);
    } else if (step === STEP_RECIPIENT && form.merchant) {
      await fetchAccountData();
      setStep(transferMode === "p2p" ? STEP_AMOUNT : STEP_PAYMENT_TYPE);
    } else if (step === STEP_PAYMENT_TYPE) {
      // Auto-set commitment date for full payment
      if (paymentType === "full") {
        const d = new Date();
        d.setDate(d.getDate() + 85);
        d.setHours(9, 0, 0, 0);
        setForm(f => ({
          ...f,
          initialDeposit: "",
          commitmentDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`,
        }));
      } else {
        setForm(f => ({ ...f, initialDeposit: "", commitmentDate: "" }));
      }
      setStep(STEP_AMOUNT);
    } else if (step === STEP_AMOUNT) {
      setStep(STEP_REVIEW);
    }
  }

  function selectTypeAndAdvance(mode: "merchant" | "p2p") {
    setTransferMode(mode);
    setStep(STEP_RECIPIENT);
  }

  function setQuickDate(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    const val = d.toISOString().slice(0, 16);
    const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
    setForm({ ...form, commitmentDate: isActive ? "" : val });
  }

  function setPayday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    const mid = new Date(year, month, 15, 9, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 9, 0, 0, 0);
    let payday = day < 15 ? mid : day < end.getDate() ? end : new Date(year, month + 1, 15, 9, 0, 0, 0);
    if (payday <= now) payday = new Date(year, month + 1, 15, 9, 0, 0, 0);
    setForm({ ...form, commitmentDate: payday.toISOString().slice(0, 16) });
  }

  function acceptRequest() {
    if (!requestPreview) return;
    const req = requestPreview;
    const known = getPledgeMeta(req.merchant_address);
    const d = new Date(req.deadline.replace(" ", "T"));
    const localDt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setForm(f => ({
      ...f,
      merchant: req.merchant_address,
      merchantName: req.merchant_name ?? known?.name ?? "",
      totalAmount: req.amount.toFixed(2),
      commitmentDate: localDt,
      note: req.title ?? req.note ?? f.note,
    }));
    setLockedFields(new Set(["merchant", "totalAmount", "commitmentDate"]));
    setTransferMode("merchant");
    setPaymentType("partial");
    setShowPreview(false);
    setStep(STEP_AMOUNT);
  }

  // ── Derived values ─────────────────────────────────────────────────────────
  const isFullPayment = paymentType === "full" || transferMode === "p2p";
  const total = parseFloat(form.totalAmount) || 0;
  const gross = parseFloat((total * (1 + feeBps / 10000)).toFixed(6));
  const deposit = isFullPayment ? gross : (parseFloat(form.initialDeposit) || 0);
  const remaining = isFullPayment ? 0 : Math.max(0, parseFloat((gross - deposit).toFixed(6)));
  const fee = parseFloat((total * (feeBps / 10000)).toFixed(6));
  const merchantReceives = total;
  const deadline = form.commitmentDate ? new Date(form.commitmentDate) : null;
  const reqDeadline = requestPreview ? new Date(requestPreview.deadline.replace(" ", "T")) : null;
  const deadlineStr = deadline ? deadline.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";

  // Installment schedule preview
  const installmentTotalValue = total * installmentCount;
  function computeSchedule() {
    if (!form.totalAmount || !form.commitmentDate) return [];
    const firstDue = new Date(form.commitmentDate);
    return Array.from({ length: installmentCount }, (_, i) => {
      const d = new Date(firstDue.getTime() + installmentInterval * 1000 * i);
      return { date: d, amount: total };
    });
  }
  const schedule = computeSchedule();

  const canNext = (
    step === STEP_TYPE ? true :
    step === STEP_RECIPIENT ? !!form.merchant :
    step === STEP_PAYMENT_TYPE ? true :
    step === STEP_AMOUNT ? (
      isFullPayment ? !!form.totalAmount :
      paymentType === "partial" ? (!!form.totalAmount && !!form.initialDeposit && !!form.commitmentDate) :
      (!!form.totalAmount && !!form.commitmentDate)
    ) : true
  );

  // ── Submit handlers ────────────────────────────────────────────────────────
  // In the new contract model, merchants create pledges — OFWs can only REQUEST one.
  // All merchant-flow submissions go off-chain to Supabase via sendRequest().
  // The merchant reviews the request and accepts it by calling createPledge on-chain.
  async function submit() {
    if (transferMode === "p2p") {
      await sendP2PTransaction();
    } else {
      await sendRequest();
    }
  }

  async function sendRequest() {
    if (!account) return;
    setLoading(true); setTxError("");
    try {
      const isInstallment = paymentType === "installment";
      const isFull = paymentType === "full";
      // Auto-set commitment date for full payments (85 days out)
      const fullDate = (() => { const d = new Date(); d.setDate(d.getDate() + 85); d.setHours(9, 0, 0, 0); return d.toISOString(); })();
      const req = await createTransferRequest({
        sender_address: account,
        merchant_address: form.merchant,
        type: isInstallment ? "installment" : "partial",
        token: selectedToken,
        total_amount: isInstallment ? null : parseFloat(form.totalAmount),
        initial_deposit: isInstallment || isFull ? null : parseFloat(form.initialDeposit),
        commitment_date: isInstallment ? null : isFull ? fullDate : (form.commitmentDate ? new Date(form.commitmentDate).toISOString() : null),
        amount_per_period: isInstallment ? parseFloat(form.totalAmount) : null,
        interval_seconds: isInstallment ? installmentInterval : null,
        total_periods: isInstallment ? installmentCount : null,
        first_due_date: isInstallment ? (form.commitmentDate ? new Date(form.commitmentDate).toISOString() : null) : null,
        note: form.note || null,
      });
      if (!req) { setTxError("Failed to send request. Please try again."); setLoading(false); return; }
      await sendTransferRequestNotification(req.id, form.merchant, "new_request");
      savePledgeMeta(form.merchant, { name: form.merchantName, note: form.note, type: transferMode });
      setRequestSent(true);
      setTimeout(() => router.push("/pledges/requests"), 1800);
    } catch {
      setTxError("Failed to send request. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function sendP2PTransaction() {
    if (!account || !pledgeWrite) return;
    const tokenWrite = selectedToken === "USDT" ? usdtWrite : usdcWrite;
    const tokenAddress = selectedToken === "USDT" ? CONTRACTS.MOCK_USDT : CONTRACTS.MOCK_USDC;
    if (!tokenWrite) return;
    setLoading(true); setTxError("");
    try {
      const amt = ethers.parseUnits(parseFloat(form.totalAmount).toFixed(6), 6);
      // Approve gross amount (amount + service fee) so the contract can pull the full debit
      const feeBps = await pledgeRead.getServiceFeeBps(account) as bigint;
      const gross = amt + (amt * feeBps) / 10000n;
      const approveTx = await tokenWrite.approve(CONTRACTS.REMITTANCE_PLEDGE, gross);
      await approveTx.wait();
      const sendTx = await pledgeWrite.sendP2P(tokenAddress, form.merchant, amt);
      const receipt = await sendTx.wait();
      savePledgeMeta(form.merchant, { name: form.merchantName, note: form.note, type: "p2p" });

      // Save P2P transaction to Supabase so it reflects in the UI
      const saved = await createTransferRequest({
        sender_address: account.toLowerCase(),
        merchant_address: form.merchant.toLowerCase(),
        type: "partial",
        token: selectedToken as "USDC" | "USDT",
        total_amount: parseFloat(form.totalAmount),
        initial_deposit: parseFloat(form.totalAmount),
        commitment_date: null,
        amount_per_period: null,
        interval_seconds: null,
        total_periods: null,
        first_due_date: null,
        note: form.note || null,
      });
      if (saved) {
        await Promise.all([
          confirmTransferRequest(saved.id, "", receipt?.hash ?? ""),
          sendTransferRequestNotification(saved.id, form.merchant.toLowerCase(), "accepted"),
          sendTransferRequestNotification(saved.id, account.toLowerCase(), "confirmed"),
        ]);
      }

      setRequestSent(true);
      setTimeout(() => router.push("/pledges"), 1800);
    } catch (e: unknown) {
      console.error("[sendP2P error]", e);
      const err = e as { reason?: string; code?: string; message?: string };
      const reason = err.reason ?? err.message ?? String(e);
      if (reason.includes("user rejected") || err.code === "ACTION_REJECTED") {
        setTxError("Transaction rejected.");
      } else if (reason.includes("Sender not verified")) {
        setTxError("Your wallet is not verified as a sender. Please complete KYC/verification before sending P2P.");
      } else if (reason.includes("insufficient")) {
        setTxError("Insufficient token balance to complete this transfer.");
      } else {
        setTxError(`Transaction failed: ${reason}`);
      }
    } finally {
      setLoading(false);
    }
  }

  // Merchant-flow is now off-chain (request to Supabase) — single step, no wallet needed.
  const txGuardSteps = [
    { label: "Sending payment request to merchant", state: (loading ? "active" : requestSent ? "done" : "pending") as "active" | "done" | "pending" },
  ];

  // ── Payment request preview modal ──────────────────────────────────────────
  const RequestPreviewScreen = requestPreview && showPreview && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
        <div className="relative p-6 overflow-hidden" style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)" }}>
          <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
            <Image src="/logo.png" alt="" width={120} height={120} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
          </div>
          <div className="relative">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-7 h-7 rounded-lg bg-[#DDE048]/10 border border-[#DDE048]/20 flex items-center justify-center">
                <FileText size={14} color="#DDE048" />
              </div>
              <span className="text-[11px] text-[#DDE048] tracking-[1.5px] font-semibold">PAYMENT REQUEST</span>
            </div>
            {requestPreview.title && <h2 className="text-xl font-extrabold text-white mb-1">{requestPreview.title}</h2>}
            {requestPreview.note && <p className="text-sm text-[#888]">{requestPreview.note}</p>}
          </div>
        </div>
        <div className="px-6 py-4 space-y-3 border-b border-[#1e2230]">
          <div className="flex justify-between text-sm">
            <span className="text-[#555]">From</span>
            <span className="text-white font-mono text-xs">{requestPreview.merchant_address.slice(0, 6)}…{requestPreview.merchant_address.slice(-4)}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555]">Amount</span>
            <span className="text-[#DDE048] font-extrabold text-lg">{requestPreview.amount.toFixed(2)} <span className="text-sm font-normal text-[#888]">USDC</span></span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555]">Deadline</span>
            <span className="text-white font-semibold">{reqDeadline!.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#555]">Days left</span>
            <span className="text-amber-400 font-semibold">{Math.ceil((reqDeadline!.getTime() - Date.now()) / 86400000)}d</span>
          </div>
        </div>
        <div className="px-6 py-4 flex flex-col gap-2">
          <button onClick={acceptRequest} className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm hover:bg-[#c8ce30] transition-colors">
            Accept &amp; Proceed to Pay
          </button>
          <button onClick={() => { setShowPreview(false); setRequestId(null); }} className="w-full text-[#555] text-sm py-2 hover:text-[#888] transition-colors">
            Decline
          </button>
        </div>
      </div>
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // DESKTOP LAYOUT
  // ══════════════════════════════════════════════════════════════════════════════

  // Step 0 — Type picker (desktop)
  const DesktopTypePicker = (
    <div className="hidden md:block p-8">
      <div className="flex items-center gap-2 text-[13px] text-[#555] mb-6">
        <Link href="/" className="hover:text-[#888] transition-colors flex items-center gap-1"><ArrowLeft size={14} /> Back</Link>
        <ChevronRight size={13} color="#333" />
        <Link href="/" className="hover:text-[#888] transition-colors">Dashboard</Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888]">New transfer</span>
      </div>
      <h1 className="text-3xl font-extrabold text-white mb-2">Create a transfer</h1>
      <p className="text-[#555] text-sm mb-10">Choose who you are sending to get started.</p>
      <div className="flex gap-5 max-w-2xl">
        {/* P2P Card */}
        <button
          onClick={() => selectTypeAndAdvance("p2p")}
          className="flex-1 group bg-[#13161c] border border-[#1e2230] hover:border-[#DDE048]/50 rounded-2xl p-6 text-left transition-all hover:bg-[#161920]"
        >
          <div className="w-12 h-12 rounded-xl bg-[#1e2230] group-hover:bg-[#DDE048]/10 border border-[#252830] group-hover:border-[#DDE048]/30 flex items-center justify-center mb-5 transition-all">
            <User size={22} color="#888" className="group-hover:hidden" />
            <User size={22} color="#DDE048" className="hidden group-hover:block" />
          </div>
          <div className="text-lg font-extrabold text-white mb-1">Person (P2P)</div>
          <div className="text-sm text-[#555] mb-5 leading-relaxed">Send to a friend or individual wallet address.</div>
          <div className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2">
            <Zap size={13} color="#DDE048" />
            <span className="text-xs text-[#888]">Full payment only</span>
          </div>
        </button>
        {/* Merchant Card */}
        <button
          onClick={() => selectTypeAndAdvance("merchant")}
          className="flex-1 group bg-[#13161c] border border-[#1e2230] hover:border-[#DDE048]/50 rounded-2xl p-6 text-left transition-all hover:bg-[#161920]"
        >
          <div className="w-12 h-12 rounded-xl bg-[#1e2230] group-hover:bg-[#DDE048]/10 border border-[#252830] group-hover:border-[#DDE048]/30 flex items-center justify-center mb-5 transition-all">
            <Store size={22} color="#888" className="group-hover:hidden" />
            <Store size={22} color="#DDE048" className="hidden group-hover:block" />
          </div>
          <div className="text-lg font-extrabold text-white mb-1">Merchant</div>
          <div className="text-sm text-[#555] mb-5 leading-relaxed">Pay a business, school, or service provider.</div>
          <div className="flex flex-col gap-1.5">
            {[
              { icon: <Zap size={12} color="#DDE048" />, label: "Full payment" },
              { icon: <CreditCard size={12} color="#DDE048" />, label: "Partial payment" },
              { icon: <CalendarDays size={12} color="#DDE048" />, label: "Installment plan" },
            ].map(({ icon, label }) => (
              <div key={label} className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-1.5">
                {icon}
                <span className="text-xs text-[#888]">{label}</span>
              </div>
            ))}
          </div>
        </button>
      </div>
    </div>
  );

  // Steps 1-4 — Wizard accordion (desktop)
  const DesktopWizard = (
    <div className="hidden md:block p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-[#555] mb-6">
        <button onClick={back} className="hover:text-[#888] transition-colors flex items-center gap-1"><ArrowLeft size={14} /> Back</button>
        <ChevronRight size={13} color="#333" />
        <Link href="/" className="hover:text-[#888] transition-colors">Dashboard</Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888]">New transfer</span>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#DDE048] text-[12px]">{transferMode === "p2p" ? "P2P" : "Merchant"}</span>
      </div>

      <h1 className="text-3xl font-extrabold text-white mb-6">Create a transfer</h1>

      {requestId && !showPreview && (
        <div className="flex items-center gap-3 bg-[#DDE048]/10 border border-[#DDE048]/30 rounded-xl px-4 py-3 mb-6 text-sm text-[#DDE048]">
          <FileText size={15} />
          <span>You&apos;re fulfilling a <strong>payment request</strong> — amount and deadline are set by the merchant.</span>
        </div>
      )}

      {/* Progress pills */}
      <div className="flex items-center gap-2 mb-8">
        {WIZARD_STEPS.map((label, i) => {
          const current = pillIndex(step);
          return (
            <button key={i}
              onClick={() => i < current && setStep(
                transferMode === "p2p"
                  ? [STEP_RECIPIENT, STEP_AMOUNT, STEP_REVIEW][i]
                  : [STEP_RECIPIENT, STEP_PAYMENT_TYPE, STEP_AMOUNT, STEP_REVIEW][i]
              )}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                i < current ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048] cursor-pointer"
                : i === current ? "bg-transparent border-[#DDE048] text-white cursor-default"
                : "bg-transparent border-[#1e2230] text-[#555] cursor-default"
              }`}
            >
              {i < current ? <Check size={13} strokeWidth={3} /> : <span className="text-[11px]">{i + 1}</span>}
              {label}
            </button>
          );
        })}
      </div>

      <div className="flex gap-6 items-start">
        {/* Left: form accordion */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* ── Step 1: Recipient ── */}
          <AccordionCard
            stepNum={1}
            title="Recipient"
            active={step === STEP_RECIPIENT}
            done={step > STEP_RECIPIENT}
            summary={step > STEP_RECIPIENT && form.merchant ? (
              <div className="flex items-center gap-2">
                {form.merchantName && (
                  <div className="w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888]">
                    {form.merchantName.slice(0, 2).toUpperCase()}
                  </div>
                )}
                <div>
                  {form.merchantName && <div className="text-sm font-semibold text-white">{form.merchantName}</div>}
                  <div className="text-[11px] text-[#555] font-mono">{form.merchant.slice(0, 10)}…{form.merchant.slice(-6)}</div>
                </div>
                <button onClick={() => setStep(STEP_RECIPIENT)} className="text-[12px] text-[#DDE048] ml-2 hover:underline">Change</button>
              </div>
            ) : null}
          >
            <div className="space-y-4">
              <div>
                <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">
                  {transferMode === "p2p" ? "Recipient wallet address" : "Merchant wallet address"}
                </label>
                <input
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
                  placeholder="0x..."
                  value={form.merchant}
                  onChange={(e) => {
                    const addr = e.target.value;
                    const known = getPledgeMeta(addr);
                    setForm({ ...form, merchant: addr, merchantName: known?.name ?? form.merchantName });
                  }}
                />
              </div>
              <div>
                <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">
                  {transferMode === "p2p" ? "Recipient name" : "Merchant name"} <span className="text-[#444]">(optional)</span>
                </label>
                <input
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
                  placeholder={transferMode === "p2p" ? "e.g. Maria Santos" : "e.g. St. Theresa School"}
                  value={form.merchantName}
                  onChange={(e) => setForm({ ...form, merchantName: e.target.value })}
                />
              </div>
              <button onClick={nextStep} disabled={!form.merchant}
                className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40">
                Continue →
              </button>
            </div>
          </AccordionCard>

          {/* ── Step 2: Payment Type (merchant only) ── */}
          {transferMode === "merchant" && (
            <AccordionCard
              stepNum={2}
              title="Payment type"
              active={step === STEP_PAYMENT_TYPE}
              done={step > STEP_PAYMENT_TYPE}
              summary={step > STEP_PAYMENT_TYPE ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white font-semibold capitalize">{paymentType}</span>
                  <button onClick={() => setStep(STEP_PAYMENT_TYPE)} className="text-[12px] text-[#DDE048] hover:underline">Change</button>
                </div>
              ) : null}
            >
              <div className="space-y-3">
                <PaymentTypeCard
                  type="full"
                  selected={paymentType === "full"}
                  onSelect={() => setPaymentType("full")}
                  icon={<Zap size={16} color={paymentType === "full" ? "#DDE048" : "#555"} />}
                  title="Full Payment"
                  description="Pay the entire amount upfront. Simplest option — no remaining balance."
                />
                <PaymentTypeCard
                  type="partial"
                  selected={paymentType === "partial"}
                  onSelect={() => setPaymentType("partial")}
                  icon={<CreditCard size={16} color={paymentType === "partial" ? "#DDE048" : "#555"} />}
                  title="Partial Payment"
                  description="Pay a down payment now and settle the remaining balance by a single due date."
                />
                <PaymentTypeCard
                  type="installment"
                  selected={paymentType === "installment"}
                  onSelect={() => setPaymentType("installment")}
                  icon={<CalendarDays size={16} color={paymentType === "installment" ? "#DDE048" : "#555"} />}
                  title="Installment Plan"
                  description="Split the total into recurring payments over a set period (up to 12 payments)."
                />
                <button onClick={nextStep}
                  className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5">
                  Continue →
                </button>
              </div>
            </AccordionCard>
          )}

          {/* ── Step 3: Amount & Terms ── */}
          <AccordionCard
            stepNum={transferMode === "p2p" ? 2 : 3}
            title={paymentType === "installment" ? "Schedule & amount" : "Amount"}
            active={step === STEP_AMOUNT}
            done={step > STEP_AMOUNT}
            summary={step > STEP_AMOUNT ? (
              <div className="flex items-center gap-3">
                <span className="text-sm text-white font-bold">
                  {paymentType === "installment"
                    ? `${total.toFixed(2)} ${selectedToken} × ${installmentCount}`
                    : `${total.toFixed(2)} ${selectedToken}`}
                </span>
                <button onClick={() => setStep(STEP_AMOUNT)} className="text-[12px] text-[#DDE048] hover:underline">Change</button>
              </div>
            ) : null}
          >
            {paymentType === "installment" ? (
              <InstallmentForm
                form={form} setForm={setForm}
                selectedToken={selectedToken} setSelectedToken={setSelectedToken}
                usdcBalance={usdcBalance} usdtBalance={usdtBalance}
                feeBps={feeBps}
                installmentCount={installmentCount} setInstallmentCount={setInstallmentCount}
                installmentInterval={installmentInterval} setInstallmentInterval={setInstallmentInterval}
                schedule={schedule}
                installmentTotalValue={installmentTotalValue}
                fmt={fmt}
                onNext={nextStep}
              />
            ) : (
              <AmountForm
                form={form} setForm={setForm}
                selectedToken={selectedToken} setSelectedToken={setSelectedToken}
                usdcBalance={usdcBalance} usdtBalance={usdtBalance}
                feeBps={feeBps} requiredPct={requiredPct}
                paymentType={isFullPayment ? "full" : "partial"}
                lockedFields={lockedFields}
                gross={gross} deposit={deposit} remaining={remaining} total={total} fee={fee}
                deadline={deadline}
                setQuickDate={setQuickDate} setPayday={setPayday}
                fmt={fmt}
                onNext={nextStep}
                canNext={canNext}
              />
            )}
          </AccordionCard>

          {/* ── Step 4: Review ── */}
          <AccordionCard
            stepNum={transferMode === "p2p" ? 3 : 4}
            title="Review"
            active={step === STEP_REVIEW}
            done={false}
          >
            {requestSent ? (
              <div className="bg-[#0d1f0d] border border-green-500/20 rounded-xl px-4 py-4 mb-4">
                <TxStep label="Request sent to merchant" state="done" />
                <p className="text-green-400 text-xs mt-2 text-center">Redirecting to your requests…</p>
              </div>
            ) : (
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-1 mb-4">
                {form.merchantName && <ReviewRow label="To" value={form.merchantName} />}
                <ReviewRow label="Wallet" value={`${form.merchant.slice(0, 10)}…${form.merchant.slice(-6)}`} />
                {form.note && <ReviewRow label="Note" value={form.note} />}
                <ReviewRow label="Token" value={selectedToken} />
                <ReviewRow label="Type" value={transferMode === "p2p" ? "P2P (full)" : paymentType === "full" ? "Full payment" : paymentType === "partial" ? "Partial payment" : "Installment plan"} />
                {paymentType === "installment" ? (
                  <>
                    <ReviewRow label="Amount per payment" value={`${total.toFixed(2)} ${selectedToken}`} accent />
                    <ReviewRow label="Number of payments" value={`${installmentCount}`} />
                    <ReviewRow label="Interval" value={INTERVAL_OPTIONS.find(o => o.seconds === installmentInterval)?.label ?? "Custom"} />
                    <ReviewRow label="Total value" value={`${installmentTotalValue.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="First payment due" value={deadline ? deadline.toLocaleString() : "–"} last />
                  </>
                ) : (
                  <>
                    <ReviewRow label="Pledge amount" value={`${total.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label={`Service fee (${feeBps / 100}%)`} value={`${fee.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="Total you pay" value={`${gross.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="Lock now" value={`${deposit.toFixed(2)} ${selectedToken}`} accent />
                    <ReviewRow label="Remaining" value={remaining > 0 ? `${remaining.toFixed(2)} ${selectedToken}` : "None"} />
                    <ReviewRow label="Merchant receives" value={`${merchantReceives.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "–"} last />
                  </>
                )}
              </div>
            )}
            {txError && (
              <div className="bg-[#1f0d0d] border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                <p className="text-red-400 text-[13px] font-semibold mb-0.5">Transaction failed</p>
                <p className="text-[#888] text-xs">{txError}</p>
              </div>
            )}
          </AccordionCard>
        </div>

        {/* Right: Transfer Summary panel */}
        <div className="w-[320px] shrink-0 sticky top-24">
          {requestPreview && (
            <div className="relative rounded-2xl p-4 mb-3 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)", border: "1px solid #1F2127" }}>
              <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
                <Image src="/logo.png" alt="" width={100} height={100} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
              </div>
              <div className="relative">
                <div className="flex items-center gap-1.5 mb-2">
                  <FileText size={12} color="#DDE048" />
                  <span className="text-[10px] text-[#DDE048] tracking-[1.5px] font-semibold">PAYMENT REQUEST</span>
                </div>
                {requestPreview.title && <div className="text-white font-bold text-sm mb-2 truncate">{requestPreview.title}</div>}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#555]">Amount due</span>
                    <span className="text-[#DDE048] font-bold">{requestPreview.amount.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#555]">Deadline</span>
                    <span className="text-white">{reqDeadline!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#555]">Days left</span>
                    <span className="text-amber-400 font-semibold">{Math.ceil((reqDeadline!.getTime() - Date.now()) / 86400000)}d</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-[#1e2230]">
              <div className="text-[11px] text-[#555] tracking-[1.5px]">TRANSFER SUMMARY</div>
            </div>
            <div className="px-5 py-4">
              {form.merchantName || form.merchant ? (
                <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[#1e2230]">
                  <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888]">
                    {(form.merchantName || form.merchant).slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-white">{form.merchantName || `${form.merchant.slice(0, 6)}…${form.merchant.slice(-4)}`}</div>
                    {form.merchantName && <div className="text-[11px] text-[#555] font-mono truncate">{form.merchant ? `${form.merchant.slice(0, 10)}…${form.merchant.slice(-6)}` : "—"}</div>}
                  </div>
                </div>
              ) : (
                <div className="text-[#555] text-sm mb-4 pb-4 border-b border-[#1e2230]">No recipient selected</div>
              )}

              <div className="space-y-2.5 text-sm mb-4">
                <SummaryRow label="Mode" value={transferMode === "p2p" ? "P2P" : "Merchant"} />
                {transferMode === "merchant" && step > STEP_PAYMENT_TYPE && (
                  <SummaryRow label="Payment type" value={paymentType === "full" ? "Full" : paymentType === "partial" ? "Partial" : "Installment"} />
                )}
                <SummaryRow label="Token" value={selectedToken} />

                {paymentType === "installment" && step >= STEP_AMOUNT ? (
                  <>
                    <SummaryRow label="Per payment" value={total > 0 ? `${total.toFixed(2)} ${selectedToken}` : "—"} accent />
                    <SummaryRow label="Payments" value={`${installmentCount}`} />
                    <div className="pt-2 border-t border-[#1e2230]">
                      <SummaryRow label="Total value" value={installmentTotalValue > 0 ? `${installmentTotalValue.toFixed(2)} ${selectedToken}` : "—"} bold />
                    </div>
                    <SummaryRow label="First due" value={deadlineStr} />
                  </>
                ) : (
                  <>
                    <SummaryRow label="Pledge amount" value={total > 0 ? `${total.toFixed(2)} ${selectedToken}` : "—"} />
                    <SummaryRow label={`Fee (${feeBps / 100}%)`} value={total > 0 ? `+ ${fee.toFixed(2)} ${selectedToken}` : "—"} />
                    <div className="pt-2 border-t border-[#1e2230] pb-2">
                      <SummaryRow label="Total you pay" value={gross > 0 ? `${gross.toFixed(2)} ${selectedToken}` : "—"} bold />
                    </div>
                    <SummaryRow label={transferMode === "merchant" ? "Upfront (requested)" : "Lock now"} value={deposit > 0 ? `${deposit.toFixed(2)} ${selectedToken}` : "—"} accent />
                    <SummaryRow label={`Due ${deadlineStr}`} value={remaining > 0 ? `${remaining.toFixed(2)} ${selectedToken}` : (deposit > 0 ? "None" : "—")} />
                    <div className="pt-2 border-t border-[#1e2230]">
                      <SummaryRow label="Merchant receives" value={merchantReceives > 0 ? `${merchantReceives.toFixed(2)} ${selectedToken}` : "—"} />
                    </div>
                  </>
                )}
              </div>

              {paymentType !== "installment" && deposit > 0 && (
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-3 mb-4 text-center">
                  <div className="text-[11px] text-[#555] mb-1">{transferMode === "merchant" ? "Requesting to pay" : "You pay"}</div>
                  <div className="text-2xl font-extrabold text-[#DDE048]">{deposit.toFixed(2)} <span className="text-sm font-normal text-[#888]">{selectedToken}</span></div>
                  {transferMode === "merchant" && <div className="text-[10px] text-[#555] mt-1">Funds locked after merchant accepts</div>}
                </div>
              )}

              {paymentType === "installment" && total > 0 && (
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-3 mb-4 text-center">
                  <div className="text-[11px] text-[#555] mb-1">First payment</div>
                  <div className="text-2xl font-extrabold text-[#DDE048]">{total.toFixed(2)} <span className="text-sm font-normal text-[#888]">{selectedToken}</span></div>
                  <div className="text-[11px] text-[#555] mt-1">due {deadlineStr}</div>
                </div>
              )}

              {step === STEP_REVIEW && (
                <>
                  {transferMode === "merchant" ? (
                    <>
                      <div className="flex items-start gap-2 bg-[#DDE048]/5 border border-[#DDE048]/20 rounded-xl px-3 py-3 mb-4 text-[12px] text-[#888]">
                        <FileText size={13} color="#DDE048" className="shrink-0 mt-0.5" />
                        {paymentType === "full"
                          ? "Your full payment request will be sent to the merchant. Once they accept and create the pledge, you can deposit to complete it."
                          : paymentType === "partial"
                          ? "Your request will be sent to the merchant for review. No funds are locked until they accept."
                          : "Your installment plan request will be sent to the merchant. They review and accept before any payments begin."}
                      </div>
                      {requestSent ? (
                        <div className="w-full bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2">
                          <CheckCircle2 size={16} /> Request sent! Redirecting…
                        </div>
                      ) : (
                        <button
                          onClick={sendRequest} disabled={loading}
                          className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#c8ce30] transition-colors"
                        >
                          {loading ? "Sending…" : "Send Request →"}
                        </button>
                      )}
                      {txError && <p className="text-red-400 text-[12px] mt-2 text-center">{txError}</p>}
                    </>
                  ) : (
                    <>
                      <div className="flex items-start gap-2 bg-[#DDE048]/5 border border-[#DDE048]/20 rounded-xl px-3 py-3 mb-4 text-[12px] text-[#888]">
                        <Zap size={13} color="#DDE048" className="shrink-0 mt-0.5" />
                        Funds will be sent directly to the recipient&apos;s wallet. This action cannot be undone.
                      </div>
                      {requestSent ? (
                        <div className="w-full bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2">
                          <CheckCircle2 size={16} /> Sent! Redirecting…
                        </div>
                      ) : (
                        <button
                          onClick={sendP2PTransaction} disabled={loading || !pledgeWrite}
                          className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#c8ce30] transition-colors"
                        >
                          {loading ? "Sending…" : "Send Transaction →"}
                        </button>
                      )}
                      {txError && <p className="text-red-400 text-[12px] mt-2 text-center">{txError}</p>}
                    </>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <TxGuard active={loading} steps={txGuardSteps} />
    </div>
  );

  // ══════════════════════════════════════════════════════════════════════════════
  // MOBILE LAYOUT
  // ══════════════════════════════════════════════════════════════════════════════

  const mobileStepCount = transferMode === "p2p" ? 3 : 4;
  const mobileStepIndex = transferMode === "p2p"
    ? [STEP_RECIPIENT, STEP_AMOUNT, STEP_REVIEW].indexOf(step)
    : [STEP_RECIPIENT, STEP_PAYMENT_TYPE, STEP_AMOUNT, STEP_REVIEW].indexOf(step);

  const MobileNewTransfer = (
    <div className="md:hidden">
      <Header title="New Transfer" />
      <div className="px-4 pt-5 pb-6 min-h-screen">
        {step === STEP_TYPE ? (
          /* Mobile type picker */
          <div>
            <h2 className="text-2xl font-extrabold mb-2">Who are you sending to?</h2>
            <p className="text-sm text-[#555] mb-8">Choose how you want to send money.</p>
            <div className="flex flex-col gap-4">
              <button onClick={() => selectTypeAndAdvance("p2p")}
                className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 text-left active:border-[#DDE048]/50 transition-all">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-[#1e2230] flex items-center justify-center">
                    <User size={20} color="#DDE048" />
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-white">Person (P2P)</div>
                    <div className="text-xs text-[#555]">Send to a friend or individual</div>
                  </div>
                  <ChevronRight size={18} color="#555" className="ml-auto" />
                </div>
                <div className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2">
                  <Zap size={12} color="#DDE048" />
                  <span className="text-xs text-[#888]">Full payment only</span>
                </div>
              </button>
              <button onClick={() => selectTypeAndAdvance("merchant")}
                className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 text-left active:border-[#DDE048]/50 transition-all">
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-11 h-11 rounded-xl bg-[#1e2230] flex items-center justify-center">
                    <Store size={20} color="#DDE048" />
                  </div>
                  <div>
                    <div className="text-base font-extrabold text-white">Merchant</div>
                    <div className="text-xs text-[#555]">Pay a business or service</div>
                  </div>
                  <ChevronRight size={18} color="#555" className="ml-auto" />
                </div>
                <div className="flex flex-col gap-1.5">
                  {["Full payment", "Partial payment", "Installment plan"].map(label => (
                    <div key={label} className="flex items-center gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-1.5">
                      <Check size={11} color="#DDE048" />
                      <span className="text-xs text-[#888]">{label}</span>
                    </div>
                  ))}
                </div>
              </button>
            </div>
          </div>
        ) : (
          /* Mobile wizard */
          <div>
            <button onClick={back} className="flex items-center gap-1.5 text-[#888] text-sm mb-5 bg-transparent border-0 cursor-pointer p-0">
              <ArrowLeft size={16} color="#888" /> Back
            </button>
            {requestPreview && !showPreview && (
              <div className="relative rounded-2xl p-4 mb-4 overflow-hidden"
                style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)", border: "1px solid #1F2127" }}>
                <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
                  <Image src="/logo.png" alt="" width={90} height={90} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
                </div>
                <div className="relative">
                  <div className="flex items-center gap-1.5 mb-2">
                    <FileText size={11} color="#DDE048" />
                    <span className="text-[10px] text-[#DDE048] tracking-[1.5px] font-semibold">PAYMENT REQUEST</span>
                  </div>
                  {requestPreview.title && <div className="text-white font-bold text-sm truncate mb-1">{requestPreview.title}</div>}
                  <div className="flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <div className="text-[10px] text-[#555] mb-0.5">Amount due</div>
                      <div className="text-[#DDE048] font-extrabold">{requestPreview.amount.toFixed(2)} <span className="text-xs font-normal text-[#888]">USDC</span></div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#555] mb-0.5">Deadline</div>
                      <div className="text-white text-sm font-semibold">{reqDeadline!.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</div>
                    </div>
                    <div>
                      <div className="text-[10px] text-[#555] mb-0.5">Days left</div>
                      <div className="text-amber-400 font-bold">{Math.ceil((reqDeadline!.getTime() - Date.now()) / 86400000)}d</div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Step progress */}
            <div className="text-[11px] text-[#888] tracking-[1px] mb-2">
              STEP {mobileStepIndex + 1} OF {mobileStepCount} · {WIZARD_STEPS[mobileStepIndex]?.toUpperCase() ?? "REVIEW"}
            </div>
            <div className="flex gap-1 mb-[22px]">
              {WIZARD_STEPS.map((_, i) => (
                <div key={i} className="flex-1 h-1 rounded bg-[#2a2a2a] overflow-hidden">
                  <div className="h-full bg-[#DDE048] rounded transition-all duration-500 ease-out"
                    style={{ width: i <= mobileStepIndex ? "100%" : "0%" }} />
                </div>
              ))}
            </div>

            {/* Step 1 — Recipient */}
            {step === STEP_RECIPIENT && (
              <div>
                <h2 className="text-2xl font-extrabold mb-[22px]">Who are you sending to?</h2>
                <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">
                  {transferMode === "p2p" ? "Recipient wallet address" : "Merchant wallet address"}
                </label>
                <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
                  placeholder="0x..."
                  value={form.merchant}
                  onChange={(e) => {
                    const addr = e.target.value;
                    const known = getPledgeMeta(addr);
                    setForm({ ...form, merchant: addr, merchantName: known?.name ?? form.merchantName });
                  }} />
                <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">
                  {transferMode === "p2p" ? "Recipient name" : "Merchant name"} <span className="font-normal">(optional)</span>
                </label>
                <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
                  placeholder={transferMode === "p2p" ? "e.g. Maria Santos" : "e.g. Dr. Yanga's Colleges Inc."}
                  value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} />
                <div className="flex items-start gap-1.5 mt-1.5">
                  <Info size={13} color="#666" />
                  <span className="text-xs text-[#888] leading-relaxed">
                    {transferMode === "p2p" ? "Enter the recipient's wallet address." : "Enter the merchant's wallet address."}
                  </span>
                </div>
              </div>
            )}

            {/* Step 2 — Payment type (merchant only) */}
            {step === STEP_PAYMENT_TYPE && (
              <div>
                <h2 className="text-2xl font-extrabold mb-2">How would you like to pay?</h2>
                <p className="text-sm text-[#555] mb-6">Choose a payment structure that works for you.</p>
                <div className="flex flex-col gap-3">
                  <PaymentTypeCard
                    type="full" selected={paymentType === "full"} onSelect={() => setPaymentType("full")}
                    icon={<Zap size={16} color={paymentType === "full" ? "#DDE048" : "#555"} />}
                    title="Full Payment"
                    description="Pay the entire amount upfront. No remaining balance."
                  />
                  <PaymentTypeCard
                    type="partial" selected={paymentType === "partial"} onSelect={() => setPaymentType("partial")}
                    icon={<CreditCard size={16} color={paymentType === "partial" ? "#DDE048" : "#555"} />}
                    title="Partial Payment"
                    description="Down payment now, remaining balance by a single due date."
                  />
                  <PaymentTypeCard
                    type="installment" selected={paymentType === "installment"} onSelect={() => setPaymentType("installment")}
                    icon={<CalendarDays size={16} color={paymentType === "installment" ? "#DDE048" : "#555"} />}
                    title="Installment Plan"
                    description="Split into recurring payments over a set period."
                  />
                </div>
              </div>
            )}

            {/* Step 3 — Amount & Terms */}
            {step === STEP_AMOUNT && paymentType === "installment" && (
              <MobileInstallmentForm
                form={form} setForm={setForm}
                selectedToken={selectedToken} setSelectedToken={setSelectedToken}
                usdcBalance={usdcBalance} usdtBalance={usdtBalance}
                installmentCount={installmentCount} setInstallmentCount={setInstallmentCount}
                installmentInterval={installmentInterval} setInstallmentInterval={setInstallmentInterval}
                schedule={schedule} installmentTotalValue={installmentTotalValue} fmt={fmt}
              />
            )}

            {step === STEP_AMOUNT && !("installment" === paymentType) && (
              <MobileAmountForm
                form={form} setForm={setForm}
                selectedToken={selectedToken} setSelectedToken={setSelectedToken}
                usdcBalance={usdcBalance} usdtBalance={usdtBalance}
                feeBps={feeBps} requiredPct={requiredPct}
                paymentType={isFullPayment ? "full" : "partial"}
                lockedFields={lockedFields}
                gross={gross} deposit={deposit} remaining={remaining} total={total}
                deadline={deadline} setQuickDate={setQuickDate} setPayday={setPayday} fmt={fmt}
              />
            )}

            {/* Step 4 — Review */}
            {step === STEP_REVIEW && (
              <div>
                <h2 className="text-2xl font-extrabold mb-[22px]">Review Transfer</h2>
                <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-1 mb-3">
                  {form.merchantName && <ReviewRow label="To" value={form.merchantName} />}
                  <ReviewRow label="Wallet" value={`${form.merchant.slice(0, 10)}...${form.merchant.slice(-6)}`} />
                  {form.note && <ReviewRow label="Note" value={form.note} />}
                  <ReviewRow label="Token" value={selectedToken} />
                  <ReviewRow label="Type" value={transferMode === "p2p" ? "P2P (full)" : paymentType === "full" ? "Full payment" : paymentType === "partial" ? "Partial payment" : "Installment plan"} />
                  {paymentType === "installment" ? (
                    <>
                      <ReviewRow label="Per payment" value={`${total.toFixed(2)} ${selectedToken}`} accent />
                      <ReviewRow label="Payments" value={`${installmentCount}`} />
                      <ReviewRow label="Interval" value={INTERVAL_OPTIONS.find(o => o.seconds === installmentInterval)?.label ?? "Custom"} />
                      <ReviewRow label="Total value" value={`${installmentTotalValue.toFixed(2)} ${selectedToken}`} />
                      <ReviewRow label="First due" value={deadline ? deadline.toLocaleString() : "–"} last />
                    </>
                  ) : (
                    <>
                      <ReviewRow label="Pledge amount" value={`${total.toFixed(2)} ${selectedToken}`} />
                      <ReviewRow label={`Service fee (${feeBps / 100}%)`} value={`${fee.toFixed(2)} ${selectedToken}`} />
                      <ReviewRow label="Total you pay" value={`${gross.toFixed(2)} ${selectedToken}`} />
                      <ReviewRow label="Lock now" value={`${deposit.toFixed(2)} ${selectedToken}`} accent />
                      <ReviewRow label="Remaining" value={remaining > 0 ? `${remaining.toFixed(2)} ${selectedToken}` : "None"} />
                      <ReviewRow label="Merchant receives" value={`${merchantReceives.toFixed(2)} ${selectedToken}`} />
                      <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "–"} />
                      <ReviewRow label="Equiv. value" value={fmt(total)} last />
                    </>
                  )}
                </div>
                {requestSent && (
                  <div className="bg-[#0d1f0d] border border-green-500/20 rounded-2xl px-4 py-3.5 mb-3">
                    <TxStep label={transferMode === "p2p" ? "Transaction sent!" : "Request sent to merchant"} state="done" />
                    <p className="text-green-400 text-xs mt-2 text-center">{transferMode === "p2p" ? "Redirecting…" : "Redirecting to your requests..."}</p>
                  </div>
                )}
                {txError && (
                  <div className="bg-[#1f0d0d] border border-red-500/20 rounded-2xl px-4 py-3 mb-3">
                    <p className="text-red-400 text-[13px] font-semibold mb-0.5">{transferMode === "p2p" ? "Transaction failed" : "Request failed"}</p>
                    <p className="text-[#888] text-xs leading-relaxed">{txError}</p>
                  </div>
                )}
              </div>
            )}

            <TxGuard active={loading} steps={txGuardSteps} />

            {step !== STEP_TYPE && (
              step === STEP_REVIEW && transferMode === "merchant" ? (
                requestSent ? (
                  <div className="w-full bg-green-500/10 border border-green-500/20 text-green-400 font-bold text-base rounded-2xl py-[17px] flex items-center justify-center gap-2 mt-6 mb-6">
                    <CheckCircle2 size={18} /> Request sent! Redirecting…
                  </div>
                ) : (
                  <button
                    className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-[17px] text-base font-bold cursor-pointer mt-6 mb-6 disabled:opacity-50"
                    onClick={sendRequest}
                    disabled={loading}>
                    {loading ? "Sending…" : "Send Request →"}
                  </button>
                )
              ) : (
                <button
                  className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-[17px] text-base font-bold cursor-pointer mt-6 mb-6 disabled:opacity-50"
                  style={{ opacity: canNext ? 1 : 0.5 }}
                  onClick={step < STEP_REVIEW ? nextStep : submit}
                  disabled={!canNext || loading}>
                  {loading ? "Processing..." : step < STEP_REVIEW ? "Continue →" : transferMode === "p2p" ? "Send Transaction →" : "Send →"}
                </button>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {RequestPreviewScreen}
      {/* Desktop */}
      {step === STEP_TYPE ? DesktopTypePicker : DesktopWizard}
      {/* Mobile */}
      {MobileNewTransfer}
    </>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function AccordionCard({
  stepNum, title, active, done, summary, children,
}: {
  stepNum: number; title: string; active: boolean; done: boolean;
  summary?: React.ReactNode; children?: React.ReactNode;
}) {
  return (
    <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${
      active ? "border-[#DDE048]/40" : done ? "border-[#1e2230]" : "border-[#1e2230] opacity-50"
    }`}>
      <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2230]">
        <div className="flex items-center gap-3">
          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${done ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>
            {done ? <Check size={12} strokeWidth={3} /> : stepNum}
          </div>
          <span className={`font-semibold ${active ? "text-[#DDE048]" : done ? "text-white" : "text-[#555]"}`}>{title}</span>
        </div>
        {done && summary}
        {active && <span className="text-[11px] text-[#DDE048] font-bold tracking-[1px]">EDITING</span>}
      </div>
      {active && <div className="px-5 py-5">{children}</div>}
    </div>
  );
}

function PaymentTypeCard({
  type, selected, onSelect, icon, title, description,
}: {
  type: PaymentType; selected: boolean; onSelect: () => void;
  icon: React.ReactNode; title: string; description: string;
}) {
  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-start gap-3 px-4 py-4 rounded-2xl border text-left transition-all ${
        selected
          ? "bg-[#DDE048]/5 border-[#DDE048]/50 text-white"
          : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"
      }`}
    >
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5 transition-colors ${selected ? "bg-[#DDE048]/10" : "bg-[#1e2230]"}`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className={`text-sm font-bold mb-0.5 ${selected ? "text-white" : "text-[#888]"}`}>{title}</div>
        <div className="text-xs text-[#555] leading-relaxed">{description}</div>
      </div>
      <div className={`w-4 h-4 rounded-full border-2 shrink-0 mt-1 flex items-center justify-center transition-all ${selected ? "border-[#DDE048] bg-[#DDE048]" : "border-[#333]"}`}>
        {selected && <div className="w-1.5 h-1.5 rounded-full bg-black" />}
      </div>
    </button>
  );
}

// Desktop amount form (full / partial)
function AmountForm({
  form, setForm, selectedToken, setSelectedToken, usdcBalance, usdtBalance,
  feeBps, requiredPct, paymentType, lockedFields,
  gross, deposit, remaining, total, fee, deadline,
  setQuickDate, setPayday, fmt, onNext, canNext,
}: {
  form: FormState; setForm: (f: FormState) => void;
  selectedToken: "USDC" | "USDT"; setSelectedToken: (t: "USDC" | "USDT") => void;
  usdcBalance: string; usdtBalance: string;
  feeBps: number; requiredPct: number; paymentType: "full" | "partial";
  lockedFields: Set<string>;
  gross: number; deposit: number; remaining: number; total: number; fee: number;
  deadline: Date | null;
  setQuickDate: (d: number) => void; setPayday: () => void;
  fmt: (n: number) => string;
  onNext: () => void; canNext: boolean;
}) {
  return (
    <div className="space-y-4">
      {/* Token selector */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TOKEN</label>
        <div className="flex gap-2">
          {(["USDC", "USDT"] as const).map((t) => (
            <button key={t} onClick={() => setSelectedToken(t)}
              className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-bold transition-colors text-left ${selectedToken === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"}`}>
              <div>{t}</div>
              <div className={`text-[11px] font-normal mt-0.5 ${selectedToken === t ? "text-[#DDE048]/70" : "text-[#444]"}`}>
                {t === "USDC" ? usdcBalance : usdtBalance} available
              </div>
            </button>
          ))}
        </div>
      </div>
      {/* Fee badge */}
      <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] border ${feeBps === 75 ? "bg-[#1a1e14] border-[#DDE048]/20 text-[#ccc]" : "bg-[#13161c] border-[#1e2230] text-[#888]"}`}>
        {feeBps === 75 ? <span className="text-base">⭐</span> : <Info size={13} color="#555" />}
        <span className={feeBps === 75 ? "text-[#DDE048] font-bold" : "text-[#888]"}>
          {feeBps === 75 ? "Loyalty rate · 0.75%" : "Standard rate · 1%"}
        </span>
        <span className="text-[#555] ml-1 text-xs">
          {feeBps === 75 ? "— reduced fee for high trust score" : "— reach 80%+ trust score for 0.75%"}
        </span>
      </div>
      {/* Total amount */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TOTAL AMOUNT</label>
        <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-4">
          <input
            className="w-full bg-transparent text-white text-2xl font-extrabold outline-none disabled:opacity-70 disabled:cursor-not-allowed"
            type="number" placeholder="0.00"
            disabled={lockedFields.has("totalAmount")}
            value={form.totalAmount}
            onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
          />
          {form.totalAmount && <div className="text-xs text-[#555] mt-1">{selectedToken} · ≈ {fmt(total)}</div>}
        </div>
      </div>
      {paymentType === "full" && (
        <div className="flex items-center gap-2 bg-[#1a1e14] border border-[#DDE048]/20 rounded-xl px-4 py-3 text-[13px]">
          <Zap size={13} color="#DDE048" />
          <span className="text-[#888]">Full amount will be locked: <span className="text-[#DDE048] font-bold">{gross.toFixed(2)} {selectedToken}</span></span>
        </div>
      )}
      {paymentType === "partial" && (
        <>
          <div className="flex items-center gap-2 bg-[#1a1e14] border border-[#DDE048]/20 rounded-xl px-4 py-2.5 text-[13px] text-[#ccc]">
            <Info size={13} color="#DDE048" />
            Trust Score {requiredPct}% · minimum upfront is <span className="text-[#DDE048] font-bold ml-1">{requiredPct}% ({((gross * requiredPct) / 100).toFixed(2)} {selectedToken})</span>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">DOWN PAYMENT</label>
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3">
                <input
                  className="w-full bg-transparent text-white text-xl font-extrabold outline-none"
                  type="number"
                  placeholder={`Min ${((gross * requiredPct) / 100).toFixed(2)}`}
                  value={form.initialDeposit}
                  onChange={(e) => setForm({ ...form, initialDeposit: e.target.value })}
                />
                <div className="text-[11px] text-[#555] mt-1">
                  {form.initialDeposit && total > 0 ? `${((deposit / total) * 100).toFixed(0)}% of total` : ""}
                </div>
              </div>
            </div>
            <div>
              <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">REMAINING</label>
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3">
                <div className="text-xl font-extrabold text-white">{remaining > 0 ? remaining.toFixed(2) : "0.00"} <span className="text-sm font-normal text-[#555]">{selectedToken}</span></div>
                <div className="text-[11px] text-[#555] mt-1">Due on commitment date</div>
              </div>
            </div>
          </div>
          {form.totalAmount && (
            <>
              <ProgressBar locked={deposit} total={total} />
              <div className="flex justify-between text-[12px] -mt-2">
                <span className="text-[#DDE048]">{deposit.toFixed(2)} locked</span>
                <span className="text-[#555]">{remaining.toFixed(2)} remaining</span>
              </div>
            </>
          )}
          {/* Due date */}
          <div>
            <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">DUE DATE FOR REMAINING BALANCE</label>
            <DateTimePicker value={form.commitmentDate} onChange={(val) => setForm({ ...form, commitmentDate: val })} />
            <div className="flex gap-2 flex-wrap mt-3">
              <button onClick={setPayday} className={`rounded-xl px-4 py-2 text-[13px] font-semibold border ${deadline && (deadline.getDate() === 15 || deadline.getDate() === new Date(deadline.getFullYear(), deadline.getMonth() + 1, 0).getDate()) ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#0e1014] border-[#1e2230] text-[#888]"}`}>Payday</button>
              {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
                const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
                return <button key={label} onClick={() => setQuickDate(days)} className={`rounded-xl px-4 py-2 text-[13px] font-semibold border ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#0e1014] border-[#1e2230] text-[#888]"}`}>{label}</button>;
              })}
            </div>
            <div className="flex items-start gap-1.5 mt-3">
              <Info size={13} color="#555" className="shrink-0 mt-0.5" />
              <span className="text-xs text-[#555] leading-relaxed">Max 90 days. After this date a 7-day grace period starts.</span>
            </div>
          </div>
        </>
      )}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">NOTE / REFERENCE <span className="text-[#444]">(optional)</span></label>
        <input
          className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
          placeholder="e.g. Tuition · 2nd Semester"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </div>
      <button onClick={onNext} disabled={!canNext}
        className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40">
        Continue →
      </button>
    </div>
  );
}

// Desktop installment form
function InstallmentForm({
  form, setForm, selectedToken, setSelectedToken, usdcBalance, usdtBalance,
  feeBps, installmentCount, setInstallmentCount, installmentInterval, setInstallmentInterval,
  schedule, installmentTotalValue, fmt, onNext,
}: {
  form: FormState; setForm: (f: FormState) => void;
  selectedToken: "USDC" | "USDT"; setSelectedToken: (t: "USDC" | "USDT") => void;
  usdcBalance: string; usdtBalance: string;
  feeBps: number;
  installmentCount: number; setInstallmentCount: (n: number) => void;
  installmentInterval: number; setInstallmentInterval: (s: number) => void;
  schedule: { date: Date; amount: number }[];
  installmentTotalValue: number;
  fmt: (n: number) => string;
  onNext: () => void;
}) {
  const total = parseFloat(form.totalAmount) || 0;
  const canNext = !!form.totalAmount && !!form.commitmentDate;
  return (
    <div className="space-y-4">
      {/* Token selector */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TOKEN</label>
        <div className="flex gap-2">
          {(["USDC", "USDT"] as const).map((t) => (
            <button key={t} onClick={() => setSelectedToken(t)}
              className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-bold transition-colors text-left ${selectedToken === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"}`}>
              <div>{t}</div>
              <div className={`text-[11px] font-normal mt-0.5 ${selectedToken === t ? "text-[#DDE048]/70" : "text-[#444]"}`}>
                {t === "USDC" ? usdcBalance : usdtBalance} available
              </div>
            </button>
          ))}
        </div>
      </div>
      <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] border ${feeBps === 75 ? "bg-[#1a1e14] border-[#DDE048]/20" : "bg-[#13161c] border-[#1e2230]"}`}>
        <Info size={13} color={feeBps === 75 ? "#DDE048" : "#555"} />
        <span className={feeBps === 75 ? "text-[#DDE048] font-bold" : "text-[#888]"}>
          {feeBps === 75 ? "Loyalty rate · 0.75% per installment" : "Standard rate · 1% per installment"}
        </span>
      </div>
      {/* Amount per period */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">AMOUNT PER PAYMENT</label>
        <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-4">
          <input
            className="w-full bg-transparent text-white text-2xl font-extrabold outline-none"
            type="number" placeholder="0.00"
            value={form.totalAmount}
            onChange={(e) => setForm({ ...form, totalAmount: e.target.value })}
          />
          {form.totalAmount && <div className="text-xs text-[#555] mt-1">{selectedToken} per payment · ≈ {fmt(total)}</div>}
        </div>
      </div>
      {/* Number of payments */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">NUMBER OF PAYMENTS</label>
        <div className="flex gap-2">
          {[3, 6, 12].map(n => (
            <button key={n} onClick={() => setInstallmentCount(n)}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-colors ${installmentCount === n ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"}`}>
              {n}×
            </button>
          ))}
          <input
            type="number" min={1} max={12}
            value={![3, 6, 12].includes(installmentCount) ? installmentCount : ""}
            onChange={(e) => { const v = parseInt(e.target.value); if (v >= 1 && v <= 12) setInstallmentCount(v); }}
            placeholder="Custom"
            className="flex-1 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-white text-sm text-center outline-none focus:border-[#DDE048]/40"
          />
        </div>
        <div className="text-[11px] text-[#555] mt-1.5">Max 12 payments allowed by contract</div>
      </div>
      {/* Interval */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">PAYMENT INTERVAL</label>
        <div className="flex gap-2">
          {INTERVAL_OPTIONS.map(({ label, seconds }) => (
            <button key={label} onClick={() => setInstallmentInterval(seconds)}
              className={`flex-1 py-2.5 rounded-xl border text-sm font-bold transition-colors ${installmentInterval === seconds ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {/* First due date */}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">FIRST PAYMENT DATE</label>
        <DateTimePicker value={form.commitmentDate} onChange={(val) => setForm({ ...form, commitmentDate: val })} />
        <div className="flex items-start gap-1.5 mt-2">
          <Info size={13} color="#555" className="shrink-0 mt-0.5" />
          <span className="text-xs text-[#555]">Subsequent payments will be due every {INTERVAL_OPTIONS.find(o => o.seconds === installmentInterval)?.label.toLowerCase() ?? "period"} after this date.</span>
        </div>
      </div>
      {/* Total summary */}
      {form.totalAmount && (
        <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3">
          <div className="flex justify-between text-sm">
            <span className="text-[#555]">Total value</span>
            <span className="text-white font-bold">{installmentTotalValue.toFixed(2)} {selectedToken}</span>
          </div>
          <div className="flex justify-between text-sm mt-1">
            <span className="text-[#555]">Per payment</span>
            <span className="text-[#DDE048] font-bold">{total.toFixed(2)} {selectedToken}</span>
          </div>
        </div>
      )}
      {/* Schedule preview */}
      {schedule.length > 0 && (
        <div>
          <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">PAYMENT SCHEDULE</label>
          <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl overflow-hidden">
            {schedule.map((s, i) => (
              <div key={i} className={`flex justify-between items-center px-4 py-2.5 text-sm ${i < schedule.length - 1 ? "border-b border-[#1e2230]" : ""}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>{i + 1}</div>
                  <span className="text-[#888]">{s.date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                </div>
                <span className={`font-semibold ${i === 0 ? "text-[#DDE048]" : "text-white"}`}>{s.amount.toFixed(2)} {selectedToken}</span>
              </div>
            ))}
          </div>
        </div>
      )}
      <div>
        <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">NOTE / REFERENCE <span className="text-[#444]">(optional)</span></label>
        <input
          className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
          placeholder="e.g. School tuition installment"
          value={form.note}
          onChange={(e) => setForm({ ...form, note: e.target.value })}
        />
      </div>
      <button onClick={onNext} disabled={!canNext}
        className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40">
        Continue →
      </button>
    </div>
  );
}

// Mobile amount form (full / partial)
function MobileAmountForm({
  form, setForm, selectedToken, setSelectedToken, usdcBalance, usdtBalance,
  feeBps, requiredPct, paymentType, lockedFields,
  gross, deposit, remaining, total, deadline,
  setQuickDate, setPayday, fmt,
}: {
  form: FormState; setForm: (f: FormState) => void;
  selectedToken: "USDC" | "USDT"; setSelectedToken: (t: "USDC" | "USDT") => void;
  usdcBalance: string; usdtBalance: string;
  feeBps: number; requiredPct: number; paymentType: "full" | "partial";
  lockedFields: Set<string>;
  gross: number; deposit: number; remaining: number; total: number;
  deadline: Date | null;
  setQuickDate: (d: number) => void; setPayday: () => void;
  fmt: (n: number) => string;
}) {
  return (
    <div>
      <h2 className="text-2xl font-extrabold mb-[22px]">
        {paymentType === "full" ? "How much are you sending?" : "Set your down payment"}
      </h2>
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Token</label>
      <div className="flex gap-2 mb-3.5">
        {(["USDC", "USDT"] as const).map((t) => (
          <button key={t} onClick={() => setSelectedToken(t)}
            className={`flex-1 py-3 px-3 rounded-[14px] border text-sm font-bold transition-colors text-left ${selectedToken === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#11141A] border-[#1F2127] text-[#555]"}`}>
            <div>{t}</div>
            <div className={`text-[11px] font-normal mt-0.5 ${selectedToken === t ? "text-[#DDE048]/70" : "text-[#444]"}`}>
              {t === "USDC" ? usdcBalance : usdtBalance} available
            </div>
          </button>
        ))}
      </div>
      <div className={`flex items-center gap-2 rounded-[14px] px-4 py-3 mb-3.5 border text-[13px] ${feeBps === 75 ? "bg-[#1a1e14] border-[#DDE048]/20" : "bg-[#11141A] border-[#1F2127]"}`}>
        {feeBps === 75 ? <span>⭐</span> : <Info size={13} color="#555" />}
        <span className={feeBps === 75 ? "text-[#DDE048] font-bold" : "text-[#888]"}>
          {feeBps === 75 ? "Loyalty rate · 0.75%" : "Standard rate · 1%"}
        </span>
      </div>
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Total Amount ({selectedToken})</label>
      <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block disabled:opacity-70"
        type="number" placeholder="e.g. 248.50"
        disabled={lockedFields.has("totalAmount")}
        value={form.totalAmount}
        onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
      {form.totalAmount && <div className="text-xs text-[#888] -mt-2.5 mb-3.5">= {fmt(total)}</div>}
      {paymentType === "full" && form.totalAmount && (
        <div className="flex items-center gap-2 bg-[#1a1e14] border border-[#DDE048]/20 rounded-[14px] px-4 py-3 mb-3.5">
          <Zap size={13} color="#DDE048" />
          <span className="text-sm text-[#888]">Full amount locked: <span className="text-[#DDE048] font-bold">{gross.toFixed(2)} {selectedToken}</span></span>
        </div>
      )}
      {paymentType === "partial" && (
        <>
          <div className="flex items-center gap-2 bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-3 mb-3.5 text-[13px]">
            <Info size={13} color="#555" />
            <span className="text-[#888]">Min {requiredPct}% upfront = <span className="text-[#DDE048] font-semibold">{((gross * requiredPct) / 100).toFixed(2)} {selectedToken}</span></span>
          </div>
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Down Payment</label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
            type="number" placeholder={`Min ${requiredPct}% = ${((gross * requiredPct) / 100).toFixed(2)} ${selectedToken}`}
            value={form.initialDeposit} onChange={(e) => setForm({ ...form, initialDeposit: e.target.value })} />
          {form.totalAmount && <ProgressBar locked={deposit} total={total} />}
          <div className="flex justify-between text-[11px] mt-1.5 mb-3.5">
            <span className="text-[#DDE048]">{deposit.toFixed(2)} locked</span>
            <span className="text-[#888]">{remaining.toFixed(2)} remaining</span>
          </div>
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Due Date for Remaining Balance</label>
          <div className="relative rounded-2xl p-4 mb-3 overflow-hidden" style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 60%, #0e1012 100%)", border: "1px solid #1F2127" }}>
            <DateTimePicker value={form.commitmentDate} onChange={(val) => setForm({ ...form, commitmentDate: val })} />
            <div className="flex gap-2 flex-wrap mt-3">
              <button onClick={setPayday} className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${deadline && (deadline.getDate() === 15 || deadline.getDate() === new Date(deadline.getFullYear(), deadline.getMonth() + 1, 0).getDate()) ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}>Payday</button>
              {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
                const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
                return <button key={label} onClick={() => setQuickDate(days)} className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}>{label}</button>;
              })}
            </div>
          </div>
          <div className="flex items-start gap-1.5 mb-3.5">
            <Info size={13} color="#555" className="shrink-0 mt-0.5" />
            <span className="text-xs text-[#666] leading-relaxed">Max 90 days. After this date a 7-day grace period starts.</span>
          </div>
        </>
      )}
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Note / Reference <span className="font-normal">(optional)</span></label>
      <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
        placeholder="e.g. Tuition · 2nd Semester"
        value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
    </div>
  );
}

// Mobile installment form
function MobileInstallmentForm({
  form, setForm, selectedToken, setSelectedToken, usdcBalance, usdtBalance,
  installmentCount, setInstallmentCount, installmentInterval, setInstallmentInterval,
  schedule, installmentTotalValue, fmt,
}: {
  form: FormState; setForm: (f: FormState) => void;
  selectedToken: "USDC" | "USDT"; setSelectedToken: (t: "USDC" | "USDT") => void;
  usdcBalance: string; usdtBalance: string;
  installmentCount: number; setInstallmentCount: (n: number) => void;
  installmentInterval: number; setInstallmentInterval: (s: number) => void;
  schedule: { date: Date; amount: number }[];
  installmentTotalValue: number;
  fmt: (n: number) => string;
}) {
  const total = parseFloat(form.totalAmount) || 0;
  return (
    <div>
      <h2 className="text-2xl font-extrabold mb-[22px]">Set up your installments</h2>
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Token</label>
      <div className="flex gap-2 mb-3.5">
        {(["USDC", "USDT"] as const).map((t) => (
          <button key={t} onClick={() => setSelectedToken(t)}
            className={`flex-1 py-3 px-3 rounded-[14px] border text-sm font-bold transition-colors text-left ${selectedToken === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#11141A] border-[#1F2127] text-[#555]"}`}>
            <div>{t}</div>
            <div className={`text-[11px] font-normal mt-0.5 ${selectedToken === t ? "text-[#DDE048]/70" : "text-[#444]"}`}>
              {t === "USDC" ? usdcBalance : usdtBalance} available
            </div>
          </button>
        ))}
      </div>
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Amount Per Payment ({selectedToken})</label>
      <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
        type="number" placeholder="e.g. 100.00"
        value={form.totalAmount} onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
      {form.totalAmount && <div className="text-xs text-[#888] -mt-2.5 mb-3.5">= {fmt(total)} per payment</div>}
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Number of Payments</label>
      <div className="flex gap-2 mb-3.5">
        {[3, 6, 12].map(n => (
          <button key={n} onClick={() => setInstallmentCount(n)}
            className={`flex-1 py-3 rounded-[14px] border text-sm font-bold transition-colors ${installmentCount === n ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#11141A] border-[#1F2127] text-[#555]"}`}>
            {n}×
          </button>
        ))}
      </div>
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Payment Interval</label>
      <div className="flex gap-2 mb-3.5">
        {INTERVAL_OPTIONS.map(({ label, seconds }) => (
          <button key={label} onClick={() => setInstallmentInterval(seconds)}
            className={`flex-1 py-2.5 rounded-[14px] border text-sm font-bold transition-colors ${installmentInterval === seconds ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#11141A] border-[#1F2127] text-[#555]"}`}>
            {label}
          </button>
        ))}
      </div>
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">First Payment Date</label>
      <div className="relative rounded-2xl p-4 mb-3.5 overflow-hidden" style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 60%, #0e1012 100%)", border: "1px solid #1F2127" }}>
        <DateTimePicker value={form.commitmentDate} onChange={(val) => setForm({ ...form, commitmentDate: val })} />
      </div>
      {form.totalAmount && (
        <div className="bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-3 mb-3.5">
          <div className="flex justify-between text-sm mb-1">
            <span className="text-[#888]">Per payment</span>
            <span className="text-[#DDE048] font-bold">{total.toFixed(2)} {selectedToken}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-[#888]">Total value</span>
            <span className="text-white font-bold">{installmentTotalValue.toFixed(2)} {selectedToken}</span>
          </div>
        </div>
      )}
      {schedule.length > 0 && (
        <>
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Payment Schedule</label>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl overflow-hidden mb-3.5">
            {schedule.map((s, i) => (
              <div key={i} className={`flex justify-between items-center px-4 py-2.5 text-sm ${i < schedule.length - 1 ? "border-b border-[#1F2127]" : ""}`}>
                <div className="flex items-center gap-2">
                  <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${i === 0 ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>{i + 1}</div>
                  <span className="text-[#888]">{s.date.toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
                </div>
                <span className={`font-semibold ${i === 0 ? "text-[#DDE048]" : "text-white"}`}>{s.amount.toFixed(2)} {selectedToken}</span>
              </div>
            ))}
          </div>
        </>
      )}
      <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Note / Reference <span className="font-normal">(optional)</span></label>
      <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
        placeholder="e.g. School tuition installment"
        value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
    </div>
  );
}

// ── Utility components ────────────────────────────────────────────────────────


function ReviewRow({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 ${last ? "" : "border-b border-[#1F2127]"}`}>
      <span className="text-[#888] text-sm">{label}</span>
      <span className={`font-semibold text-sm ${accent ? "text-[#DDE048]" : "text-white"}`}>{value}</span>
    </div>
  );
}

function SummaryRow({ label, value, accent, bold }: { label: string; value: string; accent?: boolean; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className={bold ? "text-white font-semibold" : "text-[#555]"}>{label}</span>
      <span className={`font-semibold ${accent ? "text-[#DDE048]" : bold ? "text-white font-extrabold" : "text-white"}`}>{value}</span>
    </div>
  );
}

function TxStep({ label, state }: { label: string; state: "active" | "pending" | "done" }) {
  return (
    <div className="flex items-center gap-2.5 py-1.5">
      {state === "done" && <CheckCircle2 size={15} color="#22c55e" className="shrink-0" />}
      {state === "active" && <Loader size={15} color="#f59e0b" className="shrink-0 animate-spin" />}
      {state === "pending" && <Clock size={15} color="#444" className="shrink-0" />}
      <span className={`text-sm ${state === "done" ? "text-[#22c55e]" : state === "active" ? "text-amber-400" : "text-[#444]"}`}>{label}</span>
    </div>
  );
}

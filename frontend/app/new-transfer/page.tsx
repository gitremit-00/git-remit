"use client";
import Header from "../../components/Header";
import Image from "next/image";
import DateTimePicker from "../../components/DateTimePicker";
import TxGuard from "../../components/TxGuard";
import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import { ArrowLeft, Calendar, Check, Info, CheckCircle2, Clock, Loader, Shield, ChevronRight, FileText } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS } from "../../contracts/addresses";
import { useCurrency } from "../../context/CurrencyContext";
import ProgressBar from "../../components/ProgressBar";
import { savePledgeMeta, getPledgeMeta } from "../../lib/pledgeMeta";
import { getPaymentRequest, type PaymentRequest, markNotificationRead, updatePaymentRequestStatus } from "../../lib/supabase";
import Link from "next/link";

const STEPS = ["Recipient", "Amount", "Commitment", "Review"];

interface FormState {
  merchant: string;
  merchantName: string;
  note: string;
  totalAmount: string;
  initialDeposit: string;
  commitmentDate: string;
}

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
  const { account, signer, pledgeRead, pledgeWrite, usdcRead, usdcWrite, usdtRead, usdtWrite } = useWallet();
  const { fmt } = useCurrency();

  useEffect(() => {
    const to = searchParams.get("to");
    const reqId = searchParams.get("request");

    if (reqId) {
      setRequestId(reqId);
      getPaymentRequest(reqId).then((req) => {
        if (!req) return;
        setRequestPreview(req);
        setShowPreview(true);
        // Mark notification read if notifId param present
        const notifId = searchParams.get("notif");
        if (notifId) markNotificationRead(notifId);
      });
    } else if (to) {
      const known = getPledgeMeta(to);
      setForm((f) => ({ ...f, merchant: to, merchantName: known?.name ?? "" }));
    }
  }, []);

  const [transferMode, setTransferMode] = useState<"merchant" | "p2p">("merchant");
  const [step, setStep] = useState(0);
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
  const [payInFull, setPayInFull] = useState(false);
  const [txStatus, setTxStatus] = useState("");
  const [txError, setTxError] = useState("");
  const [loading, setLoading] = useState(false);

  function back() {
    if (step === 3 && (payInFull || requestPreview)) { setStep(1); return; }
    if (step === 3 && !payInFull && !requestPreview) { setStep(2); return; }
    if (step > 0) setStep(step - 1);
    else router.push("/");
  }

  async function nextStep() {
    if (step === 0 && form.merchant) {
      if (account) {
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
      setStep(1);
    } else if (step === 1 && form.totalAmount) {
      if (!form.initialDeposit) setForm({ ...form, initialDeposit: ((parseFloat(form.totalAmount) * (1 + feeBps / 10000) * requiredPct) / 100).toFixed(2) });
      // Skip commitment date step if paying in full or deadline is locked by a payment request
      setStep(payInFull || requestPreview ? 3 : 2);
    } else if (step === 2 && form.commitmentDate) {
      setStep(3);
    }
  }

  async function submit() {
    const tokenRead = selectedToken === "USDC" ? usdcRead : usdtRead;
    const tokenWrite = selectedToken === "USDC" ? usdcWrite : usdtWrite;
    const tokenAddress = selectedToken === "USDC" ? CONTRACTS.MOCK_USDC : CONTRACTS.MOCK_USDT;
    if (!pledgeWrite || !tokenWrite || !signer) return;
    const totalAmt = ethers.parseUnits(form.totalAmount, 6);
    const initDeposit = ethers.parseUnits(form.initialDeposit, 6);
    const commitTs = Math.floor(new Date(form.commitmentDate).getTime() / 1000);

    setLoading(true); setTxError("");

    try {
      // Check balance of selected token
      const balance: bigint = await tokenRead.balanceOf(account);
      if (balance < initDeposit) {
        const has = parseFloat(ethers.formatUnits(balance, 6)).toFixed(2);
        const needs = parseFloat(ethers.formatUnits(initDeposit, 6)).toFixed(2);
        setTxError(`Insufficient ${selectedToken} balance. You have ${has} ${selectedToken} but need ${needs} ${selectedToken}.`);
        setLoading(false);
        return;
      }

      // Only approve if current allowance is less than the deposit needed
      const allowance: bigint = await tokenRead.allowance(account, CONTRACTS.REMITTANCE_PLEDGE);
      if (allowance < initDeposit) {
        setTxStatus("approving");
        const approveData = tokenWrite.interface.encodeFunctionData("approve", [CONTRACTS.REMITTANCE_PLEDGE, initDeposit]);
        const approveTx = await signer.sendTransaction({ to: tokenAddress, data: approveData });
        await approveTx.wait();
      } else {
        setTxStatus("approving"); // show as done immediately
      }

      setTxStatus("creating");
      const createData = pledgeWrite.interface.encodeFunctionData("createPledge", [tokenAddress, form.merchant, totalAmt, initDeposit, commitTs]);
      const createTx = await signer.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: createData });
      await createTx.wait();
      savePledgeMeta(form.merchant, { name: form.merchantName, note: form.note });
      if (requestId) updatePaymentRequestStatus(requestId, "fulfilled");
      setTxStatus("done");
      setTimeout(() => router.push("/pledges"), 1800);
    } catch (err: unknown) {
      setTxError(parseContractError(err));
      setTxStatus("");
      setLoading(false);
    }
  }

  function togglePayInFull() {
    if (!payInFull) {
      setPayInFull(true);
      // Auto-set commitment date 85 days out (contract max is 90; buffer for block timestamp drift)
      const d = new Date();
      d.setDate(d.getDate() + 85);
      d.setHours(9, 0, 0, 0);
      setForm((f) => ({
        ...f,
        initialDeposit: parseFloat((parseFloat(f.totalAmount || "0") * (1 + feeBps / 10000)).toFixed(6)).toFixed(2),
        commitmentDate: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`,
      }));
    } else {
      setPayInFull(false);
      setForm((f) => ({ ...f, initialDeposit: "", commitmentDate: "" }));
    }
  }

  function pad(n: number) { return String(n).padStart(2, "0"); }

  function acceptRequest() {
    if (!requestPreview) return;
    const req = requestPreview;
    const known = getPledgeMeta(req.merchant_address);
    // Supabase may return timestamps with a space instead of "T"; normalize before parsing
    const d = new Date(req.deadline.replace(" ", "T"));
    const localDt = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setForm((f) => ({
      ...f,
      merchant: req.merchant_address,
      merchantName: req.merchant_name ?? known?.name ?? "",
      totalAmount: req.amount.toFixed(2),
      commitmentDate: localDt,
      note: req.title ?? req.note ?? f.note,
    }));
    setLockedFields(new Set(["merchant", "totalAmount", "commitmentDate"]));
    setShowPreview(false);
    setStep(1);
  }

  function setQuickDate(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    const val = d.toISOString().slice(0, 16);
    // Toggle off if already selected
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

  const total = parseFloat(form.totalAmount) || 0;
  const gross = parseFloat((total * (1 + feeBps / 10000)).toFixed(6));
  const deposit = parseFloat(form.initialDeposit) || 0;
  const remaining = Math.max(0, parseFloat((gross - deposit).toFixed(6)));
  const fee = parseFloat((total * (feeBps / 10000)).toFixed(6));
  const merchantReceives = total;
  const deadline = form.commitmentDate ? new Date(form.commitmentDate) : null;
  // Normalize Supabase timestamp (may use space instead of "T") before parsing
  const reqDeadline = requestPreview ? new Date(requestPreview.deadline.replace(" ", "T")) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86400000) : 0;
  const canNext = (step === 0 && !!form.merchant) || (step === 1 && !!form.totalAmount && !!form.initialDeposit) || (step === 2 && !!form.commitmentDate) || (step === 3);

  const deadlineStr = deadline
    ? deadline.toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "—";

  /* ── DESKTOP LAYOUT ── */
  const RequestPreviewScreen = requestPreview && showPreview && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-md bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
        {/* Header */}
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
        {/* Details */}
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
        {/* Actions */}
        <div className="px-6 py-4 flex flex-col gap-2">
          <button onClick={acceptRequest}
            className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm hover:bg-[#c8ce30] transition-colors">
            Accept &amp; Proceed to Pay
          </button>
          <button onClick={() => { setShowPreview(false); setRequestId(null); }}
            className="w-full text-[#555] text-sm py-2 text-center hover:text-[#888] transition-colors">
            Decline
          </button>
        </div>
      </div>
    </div>
  );

  const DesktopNewTransfer = (
    <div className="hidden md:block p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-[#555] mb-6">
        <Link href="/" className="hover:text-[#888] transition-colors flex items-center gap-1">
          <ArrowLeft size={14} /> Back
        </Link>
        <ChevronRight size={13} color="#333" />
        <Link href="/" className="hover:text-[#888] transition-colors">Dashboard</Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888]">New transfer</span>
      </div>

      <h1 className="text-3xl font-extrabold text-white mb-6">Create a transfer</h1>

      {requestId && !showPreview && (
        <div className="flex items-center gap-3 bg-[#DDE048]/10 border border-[#DDE048]/30 rounded-xl px-4 py-3 mb-6 text-sm text-[#DDE048]">
          <FileText size={15} />
          <span>You&apos;re fulfilling a <strong>payment request</strong> — amount and deadline are set by the merchant.</span>
        </div>
      )}

      {/* Step pills */}
      <div className="flex items-center gap-2 mb-8">
        {STEPS.map((label, i) => (
          <button
            key={i}
            onClick={() => i < step && setStep(i)}
            className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              i < step
                ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048] cursor-pointer"
                : i === step
                ? "bg-transparent border-[#DDE048] text-white cursor-default"
                : "bg-transparent border-[#1e2230] text-[#555] cursor-default"
            }`}
          >
            {i < step ? <Check size={13} strokeWidth={3} /> : <span className="text-[11px]">{i + 1}</span>}
            {label}
          </button>
        ))}
      </div>

      <div className="flex gap-6 items-start">
        {/* Left: form */}
        <div className="flex-1 min-w-0 space-y-4">

          {/* Step 0 — Recipient */}
          <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${step === 0 ? "border-[#DDE048]/40" : step > 0 ? "border-[#1e2230]" : "border-[#1e2230]"}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2230]">
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > 0 ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>
                  {step > 0 ? <Check size={12} strokeWidth={3} /> : "1"}
                </div>
                <span className={`font-semibold ${step === 0 ? "text-[#DDE048]" : step > 0 ? "text-white" : "text-[#555]"}`}>Recipient</span>
              </div>
              {step > 0 && form.merchantName && (
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888]">
                    {form.merchantName.slice(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-white">{form.merchantName}</div>
                    <div className="text-[11px] text-[#555] font-mono">{form.merchant.slice(0, 10)}…{form.merchant.slice(-6)}</div>
                  </div>
                  <button onClick={() => setStep(0)} className="text-[12px] text-[#DDE048] ml-2 hover:underline">Change</button>
                </div>
              )}
            </div>
            {step === 0 && (
              <div className="px-5 py-5 space-y-4">
                {/* Transfer mode toggle */}
                <div>
                  <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TRANSFER TYPE</label>
                  <div className="flex gap-2">
                    {([{ v: "merchant", label: "Send to Merchant" }, { v: "p2p", label: "Send to Person (P2P)" }] as const).map(({ v, label }) => (
                      <button key={v} onClick={() => setTransferMode(v)}
                        className={`flex-1 py-2 px-3 rounded-xl border text-sm font-semibold transition-colors ${transferMode === v ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
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
                <button
                  onClick={nextStep}
                  disabled={!form.merchant}
                  className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40"
                >
                  Continue →
                </button>
              </div>
            )}
          </div>

          {/* Step 1 — Amount */}
          <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${step === 1 ? "border-[#DDE048]/40" : step > 1 ? "border-[#1e2230]" : "border-[#1e2230] opacity-50"}`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2230]">
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > 1 ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>
                  {step > 1 ? <Check size={12} strokeWidth={3} /> : "2"}
                </div>
                <span className={`font-semibold ${step === 1 ? "text-[#DDE048]" : step > 1 ? "text-white" : "text-[#555]"}`}>Amount</span>
              </div>
              {step > 1 && (
                <div className="flex items-center gap-3">
                  <span className="text-sm text-white font-bold">{total.toFixed(2)} USDC</span>
                  <button onClick={() => setStep(1)} className="text-[12px] text-[#DDE048] hover:underline">Change</button>
                </div>
              )}
            </div>
            {step === 1 && (
              <div className="px-5 py-5 space-y-4">
                {/* Token selector */}
                <div>
                  <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TOKEN</label>
                  <div className="flex gap-2">
                    {(["USDC", "USDT"] as const).map((t) => {
                      const bal = t === "USDC" ? usdcBalance : usdtBalance;
                      return (
                        <button
                          key={t}
                          onClick={() => setSelectedToken(t)}
                          className={`flex-1 py-2.5 px-3 rounded-xl border text-sm font-bold transition-colors text-left ${selectedToken === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#0e1014] border-[#1e2230] text-[#555] hover:border-[#333]"}`}
                        >
                          <div>{t}</div>
                          <div className={`text-[11px] font-normal mt-0.5 ${selectedToken === t ? "text-[#DDE048]/70" : "text-[#444]"}`}>
                            {bal} available
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
                {/* Fee tier badge */}
                <div className={`flex items-center gap-2 rounded-xl px-4 py-2.5 text-[13px] border ${feeBps === 75 ? "bg-[#1a1e14] border-[#DDE048]/20 text-[#ccc]" : "bg-[#13161c] border-[#1e2230] text-[#888]"}`}>
                  {feeBps === 75 ? <span className="text-base">⭐</span> : <Info size={13} color="#555" />}
                  <div>
                    <span className={feeBps === 75 ? "text-[#DDE048] font-bold" : "text-[#888]"}>
                      {feeBps === 75 ? "Loyalty rate · 0.75%" : "Standard rate · 1%"}
                    </span>
                    <span className="text-[#555] ml-1.5 text-xs">
                      {feeBps === 75 ? "— your trust score qualifies for a reduced fee" : "— reach 80%+ trust score for 0.75%"}
                    </span>
                  </div>
                </div>
                <div>
                  <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TOTAL AMOUNT</label>
                  <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-4">
                    <input
                      className="w-full bg-transparent text-white text-2xl font-extrabold outline-none disabled:opacity-70 disabled:cursor-not-allowed"
                      type="number" placeholder="0.00"
                      disabled={lockedFields.has("totalAmount")}
                      value={form.totalAmount}
                      onChange={(e) => {
                        const v = e.target.value;
                        const g = parseFloat((parseFloat(v || "0") * (1 + feeBps / 10000)).toFixed(6));
                        setForm({ ...form, totalAmount: v, initialDeposit: payInFull ? g.toFixed(2) : form.initialDeposit });
                      }}
                    />
                    {form.totalAmount && <div className="text-xs text-[#555] mt-1">{selectedToken} · ≈ {fmt(total)}</div>}
                  </div>
                </div>
                <div className="flex items-center gap-2 bg-[#1a1e14] border border-[#DDE048]/20 rounded-xl px-4 py-2.5 text-[13px] text-[#ccc]">
                  <Info size={13} color="#DDE048" />
                  Trust Score {requiredPct ? requiredPct : 20} · minimum upfront is <span className="text-[#DDE048] font-bold ml-1">{requiredPct}% ({((gross * requiredPct) / 100).toFixed(2)} USDC)</span>
                </div>

                {/* Pay in full toggle */}
                <button
                  type="button"
                  onClick={togglePayInFull}
                  disabled={!form.totalAmount}
                  className={`w-full flex items-center justify-between px-4 py-3 rounded-xl border transition-all ${
                    payInFull
                      ? "bg-[#DDE048]/5 border-[#DDE048]/50 text-white"
                      : "bg-[#0e1014] border-[#1e2230] text-[#666] hover:border-[#333]"
                  } disabled:opacity-40`}
                >
                  <div className="flex items-center gap-2.5">
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${payInFull ? "bg-[#DDE048] border-[#DDE048]" : "border-[#333]"}`}>
                      {payInFull && <Check size={10} color="black" strokeWidth={3} />}
                    </div>
                    <div className="text-left">
                      <div className="text-sm font-semibold">Pay in full now</div>
                      <div className="text-[11px] text-[#555] mt-0.5">Lock the entire amount upfront — no remaining balance due</div>
                    </div>
                  </div>
                  {payInFull && form.totalAmount && (
                    <span className="text-[#DDE048] font-bold text-sm shrink-0 ml-3">{gross.toFixed(2)} USDC</span>
                  )}
                </button>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">LOCK NOW (DEPOSIT)</label>
                    <div className={`bg-[#0e1014] border rounded-xl px-4 py-3 transition-colors ${payInFull ? "border-[#DDE048]/30" : "border-[#1e2230]"}`}>
                      <input
                        className="w-full bg-transparent text-white text-xl font-extrabold outline-none disabled:opacity-60"
                        type="number"
                        placeholder={`Min ${((gross * requiredPct) / 100).toFixed(2)}`}
                        value={form.initialDeposit}
                        disabled={payInFull}
                        onChange={(e) => setForm({ ...form, initialDeposit: e.target.value })}
                      />
                      <div className="text-[11px] text-[#555] mt-1">
                        {payInFull ? "Full payment" : form.initialDeposit ? `${total > 0 ? ((deposit / total) * 100).toFixed(0) : 0}% of total` : ""}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">COMMIT LATER (REMAINING)</label>
                    <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3">
                      <div className={`text-xl font-extrabold ${payInFull ? "text-green-400" : "text-white"}`}>
                        {payInFull ? "None" : `${remaining.toFixed(2)}`}
                        {!payInFull && <span className="text-sm text-[#555] font-normal"> USDC</span>}
                      </div>
                      <div className="text-[11px] text-[#555] mt-1">{payInFull ? "Fully paid upfront" : "Due on commitment date"}</div>
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
                <div>
                  <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">NOTE / REFERENCE <span className="text-[#444]">(optional)</span></label>
                  <input
                    className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
                    placeholder="e.g. Tuition · 2nd Semester"
                    value={form.note}
                    onChange={(e) => setForm({ ...form, note: e.target.value })}
                  />
                </div>
                <button
                  onClick={nextStep}
                  disabled={!form.totalAmount || !form.initialDeposit}
                  className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40"
                >
                  Continue →
                </button>
              </div>
            )}
          </div>

          {/* Step 2 — Commitment date */}
          <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${
            requestPreview
              ? "border-[#1e2230] opacity-60"
              : step === 2 ? "border-[#DDE048]/40" : step > 2 ? "border-[#1e2230]" : "border-[#1e2230] opacity-50"
          }`}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2230]">
              <div className="flex items-center gap-3">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${(step > 2 || requestPreview) ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>
                  {(step > 2 || requestPreview) ? <Check size={12} strokeWidth={3} /> : "3"}
                </div>
                <span className={`font-semibold ${step === 2 && !requestPreview ? "text-[#DDE048]" : (step > 2 || requestPreview) ? "text-white" : "text-[#555]"}`}>Commitment date</span>
              </div>
              {(step > 2 || requestPreview) && deadline && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-white">{deadline.toLocaleDateString()}</span>
                  {!requestPreview && <button onClick={() => setStep(2)} className="text-[12px] text-[#DDE048] hover:underline">Change</button>}
                  {requestPreview && <span className="text-[10px] text-[#555] bg-[#1e2230] px-2 py-0.5 rounded-full">Set by merchant</span>}
                </div>
              )}
              {step === 2 && !requestPreview && <span className="text-[11px] text-[#DDE048] font-bold tracking-[1px]">EDITING</span>}
            </div>
            {step === 2 && !requestPreview && (
              <div className="px-5 py-5 space-y-4">
                <DateTimePicker value={form.commitmentDate} onChange={(val) => setForm({ ...form, commitmentDate: val })} />
                <div className="flex gap-2 flex-wrap">
                  <button onClick={setPayday} className={`rounded-xl px-4 py-2 text-[13px] font-semibold border ${deadline && (deadline.getDate() === 15 || deadline.getDate() === new Date(deadline.getFullYear(), deadline.getMonth() + 1, 0).getDate()) ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#0e1014] border-[#1e2230] text-[#888]"}`}>Payday</button>
                  {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
                    const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
                    return (
                      <button key={label} onClick={() => setQuickDate(days)} className={`rounded-xl px-4 py-2 text-[13px] font-semibold border ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#0e1014] border-[#1e2230] text-[#888]"}`}>{label}</button>
                    );
                  })}
                </div>
                <div className="flex items-start gap-1.5">
                  <Info size={13} color="#555" className="shrink-0 mt-0.5" />
                  <span className="text-xs text-[#555] leading-relaxed">Max 90 days. After this date a 7-day grace period starts.</span>
                </div>
                <button
                  onClick={nextStep}
                  disabled={!form.commitmentDate}
                  className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40"
                >
                  Continue →
                </button>
              </div>
            )}
          </div>

          {/* Step 3 — Review */}
          <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${step === 3 ? "border-[#DDE048]/40" : "border-[#1e2230] opacity-50"}`}>
            <div className="flex items-center px-5 py-4 border-b border-[#1e2230] gap-3">
              <div className="w-6 h-6 rounded-full bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888]">4</div>
              <span className={`font-semibold ${step === 3 ? "text-white" : "text-[#555]"}`}>Review</span>
            </div>
            {step === 3 && (
              <div className="px-5 py-5">
                {txStatus === "done" ? (
                  <div className="bg-[#0d1f0d] border border-green-500/20 rounded-xl px-4 py-4 mb-4">
                    <TxStep label="USDC approved" state="done" />
                    <TxStep label="Pledge created" state="done" />
                    <p className="text-green-400 text-xs mt-2 text-center">Redirecting to your pledges…</p>
                  </div>
                ) : (
                  <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-1 mb-4">
                    {form.merchantName && <ReviewRow label="To" value={form.merchantName} />}
                    <ReviewRow label="Wallet" value={`${form.merchant.slice(0, 10)}…${form.merchant.slice(-6)}`} />
                    {form.note && <ReviewRow label="Note" value={form.note} />}
                    <ReviewRow label="Token" value={selectedToken} />
                    <ReviewRow label="Pledge amount" value={`${total.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label={`Service fee (${feeBps / 100}%)`} value={`${fee.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="Total you pay" value={`${gross.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="Lock now" value={`${deposit.toFixed(2)} ${selectedToken}`} accent />
                    <ReviewRow label="Remaining" value={remaining > 0 ? `${remaining.toFixed(2)} ${selectedToken}` : "None"} />
                    <ReviewRow label="Merchant receives" value={`${merchantReceives.toFixed(2)} ${selectedToken}`} />
                    <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "–"} last />
                  </div>
                )}
                {txError && (
                  <div className="bg-[#1f0d0d] border border-red-500/20 rounded-xl px-4 py-3 mb-4">
                    <p className="text-red-400 text-[13px] font-semibold mb-0.5">Transaction failed</p>
                    <p className="text-[#888] text-xs">{txError}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Right: Transfer Summary panel */}
        <div className="w-[320px] shrink-0 sticky top-24">
          {/* Payment request context card */}
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
                {requestPreview.note && <div className="text-[#888] text-xs mb-2 truncate">{requestPreview.note}</div>}
                <div className="space-y-1.5 text-xs">
                  <div className="flex justify-between">
                    <span className="text-[#555]">From</span>
                    <span className="text-[#888] font-mono">{requestPreview.merchant_address.slice(0, 6)}…{requestPreview.merchant_address.slice(-4)}</span>
                  </div>
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
              {/* Recipient row — hide when request context card already shows the address */}
              {!requestPreview && (
                form.merchantName || form.merchant ? (
                  <div className="flex items-center gap-3 mb-4 pb-4 border-b border-[#1e2230]">
                    <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888]">
                      {(form.merchantName || form.merchant).slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-white">{form.merchantName || `${form.merchant.slice(0, 6)}…${form.merchant.slice(-4)}`}</div>
                      {form.merchantName && <div className="text-[11px] text-[#555] font-mono">{form.merchant ? `${form.merchant.slice(0, 10)}…${form.merchant.slice(-6)}` : "—"}</div>}
                    </div>
                  </div>
                ) : (
                  <div className="text-[#555] text-sm mb-4 pb-4 border-b border-[#1e2230]">No recipient selected</div>
                )
              )}

              {/* Payment request context rows */}
              {requestPreview && (
                <div className="mb-4 pb-4 border-b border-[#1e2230] space-y-2 text-sm">
                  {requestPreview.title && (
                    <div className="flex justify-between gap-3">
                      <span className="text-[#555] shrink-0">For</span>
                      <span className="text-white font-semibold truncate text-right">{requestPreview.title}</span>
                    </div>
                  )}
                  {requestPreview.note && (
                    <div className="flex justify-between gap-3">
                      <span className="text-[#555] shrink-0">Note</span>
                      <span className="text-[#888] truncate text-right">{requestPreview.note}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-[#555]">Requested</span>
                    <span className="text-[#DDE048] font-bold">{requestPreview.amount.toFixed(2)} USDC</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#555]">Pay by</span>
                    <span className="text-white font-semibold">{reqDeadline!.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#555]">Days left</span>
                    <span className="text-amber-400 font-semibold">{Math.ceil((reqDeadline!.getTime() - Date.now()) / 86400000)}d</span>
                  </div>
                </div>
              )}

              <div className="space-y-2.5 text-sm mb-4">
                <SummaryRow label="Token" value={selectedToken} />
                <SummaryRow label="Pledge amount" value={total > 0 ? `${total.toFixed(2)} ${selectedToken}` : "—"} />
                <SummaryRow label={`Service fee (${feeBps / 100}%)`} value={total > 0 ? `+ ${fee.toFixed(2)} ${selectedToken}` : "—"} />
                <div className="pt-2 border-t border-[#1e2230] pb-2">
                  <SummaryRow label="Total you pay" value={gross > 0 ? `${gross.toFixed(2)} ${selectedToken}` : "—"} bold />
                </div>
                <SummaryRow label="Lock now" value={deposit > 0 ? `${deposit.toFixed(2)} ${selectedToken}` : "—"} accent />
                <SummaryRow label={`Due ${deadlineStr}`} value={remaining > 0 ? `${remaining.toFixed(2)} ${selectedToken}` : (deposit > 0 ? "None" : "—")} />
                <div className="pt-2 border-t border-[#1e2230]">
                  <SummaryRow label="Merchant receives" value={merchantReceives > 0 ? `${merchantReceives.toFixed(2)} ${selectedToken}` : "—"} />
                </div>
              </div>

              {deposit > 0 && (
                <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-3 mb-4 text-center">
                  <div className="text-[11px] text-[#555] mb-1">Sign now</div>
                  <div className="text-2xl font-extrabold text-[#DDE048]">{deposit.toFixed(2)} <span className="text-sm font-normal text-[#888]">USDC</span></div>
                </div>
              )}

              {step === 3 && (
                <>
                  <div className="flex items-start gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-3 mb-4 text-[12px] text-[#888]">
                    <Shield size={13} color="#555" className="shrink-0 mt-0.5" />
                    Secured by smart contract · Visible to {form.merchantName || "merchant"} as soon as you sign.
                  </div>
                  <button
                    onClick={submit}
                    disabled={loading}
                    className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#c8ce30] transition-colors"
                  >
                    {loading ? (txStatus === "done" ? "✓ Done!" : "Processing…") : "Confirm & Lock Funds"}
                  </button>
                  <button className="w-full text-[#555] text-sm py-2.5 hover:text-[#888] transition-colors">Save as draft</button>
                  <p className="text-[11px] text-[#444] text-center leading-relaxed">
                    MetaMask will ask you to approve two transactions: USDC spend + pledge creation
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <TxGuard
        active={loading && txStatus !== "done"}
        steps={[
          { label: "Approve USDC spend", state: txStatus === "approving" ? "active" : txStatus === "creating" || txStatus === "done" ? "done" : "pending" },
          { label: "Create pledge on-chain", state: txStatus === "creating" ? "active" : txStatus === "done" ? "done" : "pending" },

        ]}
      />
    </div>
  );

  /* ── MOBILE LAYOUT ── */
  const MobileNewTransfer = (
    <div className="md:hidden">
      <Header title="New Transfer" />
      <div className="px-4 pt-5 pb-6 min-h-screen">
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
        <div className="text-[11px] text-[#888] tracking-[1px] mb-2">STEP {step + 1} OF 4 · {STEPS[step].toUpperCase()}</div>
        <div className="flex gap-1 mb-[22px]">
          {STEPS.map((_, i) => (
            <div key={i} className="flex-1 h-1 rounded bg-[#2a2a2a] overflow-hidden">
              <div className="h-full bg-[#DDE048] rounded transition-all duration-500 ease-out" style={{ width: i <= step ? "100%" : "0%" }} />
            </div>
          ))}
        </div>

        {step === 0 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-[22px]">Who are you sending to?</h2>
            {/* Transfer mode toggle — mobile */}
            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Transfer type</label>
            <div className="flex gap-2 mb-3.5">
              {([{ v: "merchant", label: "Merchant" }, { v: "p2p", label: "Person (P2P)" }] as const).map(({ v, label }) => (
                <button key={v} onClick={() => setTransferMode(v)}
                  className={`flex-1 py-2.5 px-3 rounded-[14px] border text-sm font-semibold transition-colors ${transferMode === v ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#11141A] border-[#1F2127] text-[#555]"}`}>
                  {label}
                </button>
              ))}
            </div>
            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">
              {transferMode === "p2p" ? "Recipient wallet address" : "Merchant wallet address"}
            </label>
            <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="0x..."
              value={form.merchant}
              onChange={(e) => {
                const addr = e.target.value;
                const known = getPledgeMeta(addr);
                setForm({ ...form, merchant: addr, merchantName: known?.name ?? form.merchantName });
              }} />
            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">
              {transferMode === "p2p" ? "Recipient name" : "Merchant name"} <span className="text-[#888] font-normal">(optional)</span>
            </label>
            <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
              placeholder={transferMode === "p2p" ? "e.g. Maria Santos" : "e.g. Dr. Yanga's Colleges Inc."}
              value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} />
            <div className="flex items-start gap-1.5 mt-1.5"><Info size={13} color="#666" /><span className="text-xs text-[#888] leading-relaxed">Enter the merchant&apos;s wallet address.</span></div>
          </div>
        )}

        {step === 1 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-[22px]">How much are you sending?</h2>
            {/* Token selector — mobile */}
            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Token</label>
            <div className="flex gap-2 mb-3.5">
              {(["USDC", "USDT"] as const).map((t) => {
                const bal = t === "USDC" ? usdcBalance : usdtBalance;
                return (
                  <button
                    key={t}
                    onClick={() => setSelectedToken(t)}
                    className={`flex-1 py-3 px-3 rounded-[14px] border text-sm font-bold transition-colors text-left ${selectedToken === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-[#11141A] border-[#1F2127] text-[#555]"}`}
                  >
                    <div>{t}</div>
                    <div className={`text-[11px] font-normal mt-0.5 ${selectedToken === t ? "text-[#DDE048]/70" : "text-[#444]"}`}>
                      {bal} available
                    </div>
                  </button>
                );
              })}
            </div>
            {/* Fee tier badge — mobile */}
            <div className={`flex items-center gap-2 rounded-[14px] px-4 py-3 mb-3.5 border text-[13px] ${feeBps === 75 ? "bg-[#1a1e14] border-[#DDE048]/20" : "bg-[#11141A] border-[#1F2127]"}`}>
              {feeBps === 75 ? <span>⭐</span> : <Info size={13} color="#555" />}
              <div>
                <span className={feeBps === 75 ? "text-[#DDE048] font-bold" : "text-[#888]"}>
                  {feeBps === 75 ? "Loyalty rate · 0.75%" : "Standard rate · 1%"}
                </span>
                <div className="text-[11px] text-[#555] mt-0.5">
                  {feeBps === 75 ? "Your trust score qualifies for a reduced fee" : "Reach 80%+ trust score for 0.75%"}
                </div>
              </div>
            </div>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-3 flex justify-between items-center mb-[18px]">
              <div>
                {form.merchantName && <div className="font-semibold text-sm">{form.merchantName}</div>}
                <div className={`${form.merchantName ? "text-[11px] text-[#888]" : "text-sm text-white"}`}>{form.merchant.slice(0, 10)}...{form.merchant.slice(-6)}</div>
              </div>
              <Check size={16} color="#DDE048" />
            </div>
            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Total Amount (USDC)</label>
            <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block disabled:opacity-70" type="number" placeholder="e.g. 248.50"
              disabled={lockedFields.has("totalAmount")}
              value={form.totalAmount}
              onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
            {form.totalAmount && <div className="text-xs text-[#888] -mt-2.5 mb-3.5">= {fmt(total)}</div>}
            {/* Pay in full toggle — mobile */}
            <button
              type="button"
              onClick={togglePayInFull}
              disabled={!form.totalAmount}
              className={`w-full flex items-center gap-3 px-4 py-3.5 rounded-[14px] border mb-3.5 transition-all text-left ${
                payInFull ? "bg-[#DDE048]/5 border-[#DDE048]/40" : "bg-[#11141A] border-[#1F2127]"
              } disabled:opacity-40`}
            >
              <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-all ${payInFull ? "bg-[#DDE048] border-[#DDE048]" : "border-[#333]"}`}>
                {payInFull && <Check size={11} color="black" strokeWidth={3} />}
              </div>
              <div className="flex-1">
                <div className={`text-sm font-semibold ${payInFull ? "text-white" : "text-[#888]"}`}>Pay in full now</div>
                <div className="text-[11px] text-[#555] mt-0.5">Lock entire amount — no balance due later</div>
              </div>
              {payInFull && form.totalAmount && <span className="text-[#DDE048] font-bold text-sm shrink-0">{gross.toFixed(2)} USDC</span>}
            </button>

            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Lock Now (initial deposit)</label>
            <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block disabled:opacity-50" type="number"
              placeholder={`Min ${requiredPct}% = ${((gross * requiredPct) / 100).toFixed(2)} USDC`}
              disabled={payInFull}
              value={form.initialDeposit} onChange={(e) => setForm({ ...form, initialDeposit: e.target.value })} />
            <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Note / Reference <span className="text-[#888] font-normal">(optional)</span></label>
            <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="e.g. Tuition · 2nd Semester"
              value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
            <div className="flex items-start gap-1.5 mt-1.5"><Info size={13} color="#666" /><span className="text-xs text-[#888] leading-relaxed">Your trust score requires at least {requiredPct}% upfront.</span></div>
          </div>
        )}

        {step === 2 && !requestPreview && (
          <div>
            <h2 className="text-2xl font-extrabold mb-5">When can you commit?</h2>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-3 flex items-center justify-between mb-3">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-[#1e1e1e] border border-[#2a2a2a] flex items-center justify-center shrink-0">
                  <span className="text-[#555] text-xs font-bold">{(form.merchantName || form.merchant).slice(0, 2).toUpperCase()}</span>
                </div>
                <div>
                  {form.merchantName && <div className="font-semibold text-sm leading-tight">{form.merchantName}</div>}
                  <div className="text-[11px] text-[#888]">{form.merchant.slice(0, 10)}...{form.merchant.slice(-6)}</div>
                </div>
              </div>
              <Check size={16} color="#DDE048" />
            </div>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 pt-4 pb-3 mb-3">
              <div className="flex justify-between items-start mb-3">
                <div>
                  <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">TOTAL</div>
                  <div className="text-[26px] font-extrabold leading-none">{total.toFixed(2)} <span className="text-[13px] text-[#888] font-normal">USDC</span></div>
                </div>
                <div className="text-right">
                  <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">LOCK NOW</div>
                  <div className="text-[26px] font-extrabold leading-none text-[#DDE048]">{deposit.toFixed(2)} <span className="text-[13px] text-[#888] font-normal">USDC</span></div>
                </div>
              </div>
              <ProgressBar locked={deposit} total={total} />
              <div className="flex justify-between text-[11px] mt-1.5">
                <span className="text-[#DDE048]">{deposit.toFixed(2)} locked</span>
                <span className="text-[#888]">{remaining.toFixed(2)} remaining</span>
              </div>
            </div>
            <div className="relative rounded-2xl p-4 mb-3 overflow-hidden" style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 60%, #0e1012 100%)", border: "1px solid #1F2127" }}>
              <div className="absolute -right-4 -top-2 opacity-[0.07] pointer-events-none select-none">
                <Image src="/logo.png" alt="" width={110} height={110} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
              </div>
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3 relative">COMMIT REMAINING {remaining.toFixed(2)} USDC BY</div>
              {deadline && (
                <div className="bg-[#0d0f13] border border-[#1F2127] rounded-xl px-4 py-3 flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center shrink-0">
                      <Calendar size={15} color="#666" />
                    </div>
                    <div>
                      <div className="font-bold text-[17px] leading-tight">{deadline.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}</div>
                      <div className="text-xs text-[#888] mt-0.5">{deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} UTC+8</div>
                    </div>
                  </div>
                  {daysLeft > 0 && (
                    <div className="text-right shrink-0 ml-3">
                      <div className="text-[28px] font-extrabold text-[#DDE048] leading-none">{daysLeft}</div>
                      <div className="text-[10px] text-[#888] mt-0.5">days</div>
                    </div>
                  )}
                </div>
              )}
              <DateTimePicker value={form.commitmentDate} onChange={(val) => setForm({ ...form, commitmentDate: val })} />
              <div className="flex gap-2 flex-wrap mt-3 relative">
                <button onClick={setPayday} className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${deadline && (deadline.getDate() === 15 || deadline.getDate() === new Date(deadline.getFullYear(), deadline.getMonth() + 1, 0).getDate()) ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}>Payday</button>
                {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
                  const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
                  return <button key={label} className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`} onClick={() => setQuickDate(days)}>{label}</button>;
                })}
                <button className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${!deadline ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`} onClick={() => setForm({ ...form, commitmentDate: "" })}>Custom</button>
              </div>
            </div>
            <div className="flex items-start gap-1.5"><Info size={13} color="#555" className="shrink-0 mt-0.5" /><span className="text-xs text-[#666] leading-relaxed">Max 90 days. After this date a 7-day grace period starts.</span></div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h2 className="text-2xl font-extrabold mb-[22px]">Review Transfer</h2>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-1 mb-3">
              {form.merchantName && <ReviewRow label="To" value={form.merchantName} />}
              <ReviewRow label="Wallet" value={`${form.merchant.slice(0, 10)}...${form.merchant.slice(-6)}`} />
              {form.note && <ReviewRow label="Note" value={form.note} />}
              <ReviewRow label="Token" value={selectedToken} />
              <ReviewRow label="Pledge amount" value={`${total.toFixed(2)} ${selectedToken}`} />
              <ReviewRow label={`Service fee (${feeBps / 100}%)`} value={`${fee.toFixed(2)} ${selectedToken}`} />
              <ReviewRow label="Total you pay" value={`${gross.toFixed(2)} ${selectedToken}`} />
              <ReviewRow label="Lock now" value={`${deposit.toFixed(2)} ${selectedToken}`} accent />
              <ReviewRow label="Remaining" value={remaining > 0 ? `${remaining.toFixed(2)} ${selectedToken}` : "None"} />
              <ReviewRow label="Merchant receives" value={`${merchantReceives.toFixed(2)} ${selectedToken}`} />
              <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "–"} />
              <ReviewRow label="Equiv. value" value={fmt(total)} last />
            </div>
            {txStatus === "done" && (
              <div className="bg-[#0d1f0d] border border-green-500/20 rounded-2xl px-4 py-3.5 mb-3">
                <TxStep label="USDC approved" state="done" />
                <TxStep label="Pledge created" state="done" />
                <p className="text-green-400 text-xs mt-2 text-center">Redirecting to your pledges...</p>
              </div>
            )}
            {txError && (
              <div className="bg-[#1f0d0d] border border-red-500/20 rounded-2xl px-4 py-3 mb-3">
                <p className="text-red-400 text-[13px] font-semibold mb-0.5">Transaction failed</p>
                <p className="text-[#888] text-xs leading-relaxed">{txError}</p>
              </div>
            )}
          </div>
        )}

        <TxGuard active={loading && txStatus !== "done"} steps={[
          { label: "Approve USDC spend", state: txStatus === "approving" ? "active" : txStatus === "creating" || txStatus === "done" ? "done" : "pending" },
          { label: "Create pledge on-chain", state: txStatus === "creating" ? "active" : txStatus === "done" ? "done" : "pending" },

        ]} />

        <button
          className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-[17px] text-base font-bold cursor-pointer mt-6 mb-6 disabled:opacity-50"
          style={{ opacity: canNext ? 1 : 0.5 }}
          onClick={step < 3 ? nextStep : submit} disabled={!canNext || loading}>
          {loading ? (txStatus === "done" ? "✓ Done!" : "Processing...") : step < 3 ? "Continue →" : "Confirm & Lock Funds"}
        </button>
      </div>
    </div>
  );

  return (
    <>
      {RequestPreviewScreen}
      {DesktopNewTransfer}
      {MobileNewTransfer}
    </>
  );
}

function parseContractError(err: unknown): string {
  const e = err as { reason?: string; data?: string; message?: string };
  if (e.reason) return e.reason;
  if (e.data?.startsWith("0xe450d38c")) {
    const needed = BigInt("0x" + e.data.slice(130, 194));
    const has = BigInt("0x" + e.data.slice(66, 130));
    return `Insufficient USDC balance. You have ${(Number(has) / 1e6).toFixed(2)} USDC but need ${(Number(needed) / 1e6).toFixed(2)} USDC.`;
  }
  if (e.data?.startsWith("0xfb8f41b2")) return "USDC allowance too low. Please try again.";
  if (e.message?.includes("user rejected")) return "Transaction rejected in MetaMask.";
  return e.message ?? "Transaction failed.";
}

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

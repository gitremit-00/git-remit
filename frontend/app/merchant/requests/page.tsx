"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowLeft, Plus, Copy, Check, Clock, CheckCircle2, XCircle,
  Trash2, FileText, Link2, Calendar, ChevronRight, Info,
} from "lucide-react";
import Header from "../../../components/Header";
import KYCGate from "../../../components/KYCGate";
import LoadingSpinner from "../../../components/LoadingSpinner";
import BottomNav from "../../../components/BottomNav";
import DateTimePicker from "../../../components/DateTimePicker";
import { useWallet } from "../../../context/WalletContext";
import {
  createPaymentRequest,
  getMerchantPaymentRequests,
  updatePaymentRequestStatus,
  sendPaymentRequestNotification,
  type PaymentRequest,
} from "../../../lib/supabase";
import { Send } from "lucide-react";

const STEPS = ["Details", "Amount", "Deadline", "Review"];
const STATUS_COLOR: Record<string, string> = { open: "#f59e0b", fulfilled: "#22c55e", cancelled: "#555" };
const STATUS_BG: Record<string, string> = { open: "#f59e0b18", fulfilled: "#22c55e18", cancelled: "#55555518" };

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function daysUntil(iso: string) {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
}
function pad(n: number) { return String(n).padStart(2, "0"); }
function defaultDeadline(days = 30) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T09:00`;
}

interface FormState { title: string; note: string; amount: string; deadline: string; }

export default function MerchantRequests() {
  const { account, connect, walletLoading } = useWallet();
  const [requests, setRequests] = useState<PaymentRequest[]>([]);
  const [loading, setLoading] = useState(false);

  // Create flow
  const [showCreate, setShowCreate] = useState(false);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({ title: "", note: "", amount: "", deadline: defaultDeadline() });
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<PaymentRequest | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [sendModal, setSendModal] = useState<PaymentRequest | null>(null);
  const [senderInput, setSenderInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  useEffect(() => { if (account) loadRequests(); }, [account]);

  async function loadRequests() {
    setLoading(true);
    try { setRequests(await getMerchantPaymentRequests(account!)); }
    finally { setLoading(false); }
  }

  function openCreate() { setShowCreate(true); setStep(0); setCreated(null); setForm({ title: "", note: "", amount: "", deadline: defaultDeadline() }); }
  function back() { if (step > 0) setStep(step - 1); else { setShowCreate(false); } }

  function nextStep() {
    if (step === 0) setStep(1);
    else if (step === 1 && form.amount) setStep(2);
    else if (step === 2 && form.deadline) setStep(3);
  }

  async function handleCreate() {
    if (!account) return;
    setSubmitting(true);
    try {
      const req = await createPaymentRequest({
        merchant_address: account,
        merchant_name: null,
        amount: parseFloat(form.amount),
        deadline: new Date(form.deadline).toISOString(),
        title: form.title || null,
        note: form.note || null,
      });
      if (req) {
        setRequests((prev) => [req, ...prev]);
        setCreated(req);
        setStep(4); // success state
      }
    } finally { setSubmitting(false); }
  }

  async function handleCancel(id: string) {
    await updatePaymentRequestStatus(id, "cancelled");
    setRequests((prev) => prev.map((r) => r.id === id ? { ...r, status: "cancelled" } : r));
  }

  function copyLink(id: string) {
    navigator.clipboard.writeText(`${window.location.origin}/new-transfer?request=${id}`);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  }

  async function handleSendNotification() {
    if (!sendModal || !senderInput.trim()) return;
    setSending(true);
    const ok = await sendPaymentRequestNotification(sendModal.id, senderInput.trim());
    setSending(false);
    if (ok) { setSentTo(senderInput.trim()); setSenderInput(""); }
  }

  function setQuickDeadline(days: number) {
    const dl = form.deadline ? new Date(form.deadline) : null;
    const isActive = dl && Math.ceil((dl.getTime() - Date.now()) / 86400000) === days;
    setForm((f) => ({ ...f, deadline: isActive ? "" : defaultDeadline(days) }));
  }

  const amount = parseFloat(form.amount) || 0;
  const deadline = form.deadline ? new Date(form.deadline) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86400000) : 0;
  const deadlineStr = deadline ? deadline.toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "—";
  const canNext = step === 0 || (step === 1 && !!form.amount) || (step === 2 && !!form.deadline) || step === 3;

  if (walletLoading) return <LoadingSpinner fullScreen />;

  if (!account) return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-[#0e1014]">
      <div className="w-16 h-16 rounded-2xl bg-[#DDE048]/10 flex items-center justify-center mb-5">
        <FileText size={28} color="#DDE048" />
      </div>
      <h2 className="text-2xl font-bold mb-2 text-white">Payment Requests</h2>
      <p className="text-[#555] mb-8 text-sm text-center max-w-[260px]">Connect your wallet to create and manage payment requests</p>
      <button className="bg-[#DDE048] text-black rounded-xl px-10 py-3.5 text-sm font-bold" onClick={connect}>Connect MetaMask</button>
    </div>
  );

  const open = requests.filter((r) => r.status === "open");
  const fulfilled = requests.filter((r) => r.status === "fulfilled");

  /* ── DESKTOP ── */
  const Desktop = (
    <div className="hidden md:block p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-[#555] mb-6">
        <Link href="/merchant" className="hover:text-[#888] transition-colors flex items-center gap-1">
          <ArrowLeft size={14} /> Merchant
        </Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888]">Payment Requests</span>
      </div>

      {!showCreate ? (
        <>
          {/* List view header */}
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-3xl font-extrabold text-white">Payment Requests</h1>
            <button onClick={openCreate}
              className="flex items-center gap-2 bg-[#DDE048] text-black font-bold text-sm rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors">
              <Plus size={15} /> New Request
            </button>
          </div>

          {/* Stats — gradient hero card */}
          <div className="relative rounded-2xl p-6 mb-6 overflow-hidden"
            style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)", border: "1px solid #1F2127" }}>
            {/* Gray logo watermark — left */}
            <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
              <Image src="/logo.png" alt="" width={160} height={160} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
            </div>
            <div className="relative flex items-center gap-10 pl-12">
              {/* Total */}
              <div>
                <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">TOTAL REQUESTED</div>
                <div className="text-4xl font-extrabold text-white leading-none">
                  {requests.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.amount, 0).toFixed(2)}
                </div>
                <div className="text-xs text-[#666] mt-1">USDC · across active requests</div>
              </div>
              <div className="w-px h-12 bg-[#1e2230]" />
              {/* Open */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-[10px] text-[#888] tracking-[1.5px]">OPEN</span>
                </div>
                <div className="text-3xl font-extrabold text-amber-400">{open.length}</div>
                <div className="text-[11px] text-[#555] mt-1">awaiting payment</div>
              </div>
              <div className="w-px h-12 bg-[#1e2230]" />
              {/* Fulfilled */}
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                  <span className="text-[10px] text-[#888] tracking-[1.5px]">FULFILLED</span>
                </div>
                <div className="text-3xl font-extrabold text-green-400">{fulfilled.length}</div>
                <div className="text-[11px] text-[#555] mt-1">pledges created</div>
              </div>
            </div>
          </div>

          {/* Table / empty */}
          {loading ? <LoadingSpinner /> : requests.length === 0 ? (
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl py-20 flex flex-col items-center justify-center">
              <div className="w-14 h-14 rounded-2xl bg-[#1e2230] flex items-center justify-center mb-4">
                <FileText size={24} color="#333" />
              </div>
              <div className="text-white font-bold mb-1.5">No payment requests yet</div>
              <div className="text-[#555] text-sm mb-6">Create one and share the link with your sender</div>
              <button onClick={openCreate} className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 hover:bg-[#c8ce30] transition-colors">
                Create your first request
              </button>
            </div>
          ) : (
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#1e2230]">
                    {["TITLE / NOTE", "AMOUNT", "DEADLINE", "STATUS", "ACTIONS"].map((h) => (
                      <th key={h} className="px-5 py-3.5 text-left text-[10px] text-[#444] tracking-[1.5px] font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {requests.map((r) => {
                    const days = daysUntil(r.deadline);
                    const overdue = days < 0;
                    const urgent = days >= 0 && days <= 3;
                    return (
                      <tr key={r.id} className={`border-b border-[#1e2230] last:border-0 transition-colors ${r.status === "cancelled" ? "opacity-50" : "hover:bg-[#15181f]"}`}>
                        <td className="px-5 py-4">
                          <div className="font-semibold text-white">{r.title || <span className="text-[#444] font-normal italic text-xs">No title</span>}</div>
                          {r.note && <div className="text-xs text-[#555] mt-0.5">{r.note}</div>}
                        </td>
                        <td className="px-5 py-4">
                          <span className="font-bold text-white">{r.amount.toFixed(2)}</span>
                          <span className="text-xs text-[#555] ml-1">USDC</span>
                        </td>
                        <td className="px-5 py-4">
                          <div className="text-[#888] text-xs">{fmtDate(r.deadline)}</div>
                          {r.status === "open" && (
                            <div className={`text-[11px] font-semibold mt-0.5 ${overdue ? "text-red-400" : urgent ? "text-amber-400" : "text-[#555]"}`}>
                              {overdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`}
                            </div>
                          )}
                        </td>
                        <td className="px-5 py-4">
                          <span className="flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full w-fit capitalize"
                            style={{ color: STATUS_COLOR[r.status], background: STATUS_BG[r.status] }}>
                            {r.status === "open" && <Clock size={10} />}
                            {r.status === "fulfilled" && <CheckCircle2 size={10} />}
                            {r.status === "cancelled" && <XCircle size={10} />}
                            {r.status}
                          </span>
                        </td>
                        <td className="px-5 py-4">
                          {r.status === "open" && (
                            <div className="flex items-center gap-2">
                              <button onClick={() => { setSendModal(r); setSentTo(null); }}
                                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg bg-[#DDE048] text-black hover:bg-[#c8ce30] transition-colors">
                                <Send size={11} /> Send
                              </button>
                              <button onClick={() => copyLink(r.id)}
                                className={`flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 rounded-lg border transition-colors ${copiedId === r.id ? "bg-green-500/15 border-green-500/30 text-green-400" : "border-[#1e2230] text-[#888] hover:border-[#333] hover:text-white"}`}>
                                {copiedId === r.id ? <><Check size={11} /> Copied!</> : <><Copy size={11} /> Link</>}
                              </button>
                              <button onClick={() => handleCancel(r.id)}
                                className="text-[#333] hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-red-500/10">
                                <Trash2 size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* How it works — shown only when empty */}
          {requests.length === 0 && (
            <div className="grid grid-cols-3 gap-4 mt-6">
              {[
                { step: "1", title: "Set amount & deadline", body: "Enter the exact USDC amount and when you need it paid by." },
                { step: "2", title: "Share the link", body: "Copy the generated link and send it to your payer via any channel." },
                { step: "3", title: "Sender pays instantly", body: "They open the link and the pledge form is pre-filled — one tap to lock funds." },
              ].map(({ step, title, body }) => (
                <div key={step} className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                  <div className="w-7 h-7 rounded-lg bg-[#DDE048]/10 flex items-center justify-center text-[#DDE048] text-xs font-extrabold mb-3">{step}</div>
                  <div className="font-bold text-white text-sm mb-1.5">{title}</div>
                  <div className="text-[#444] text-xs leading-relaxed">{body}</div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        /* ── CREATE FLOW (new-transfer style) ── */
        <>
          <h1 className="text-3xl font-extrabold text-white mb-6">Create a payment request</h1>

          {/* Step pills */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.map((label, i) => (
              <button key={i} onClick={() => i < step && setStep(i)}
                className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                  i < step ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048] cursor-pointer"
                  : i === step ? "bg-transparent border-[#DDE048] text-white cursor-default"
                  : "bg-transparent border-[#1e2230] text-[#555] cursor-default"
                }`}>
                {i < step ? <Check size={13} strokeWidth={3} /> : <span className="text-[11px]">{i + 1}</span>}
                {label}
              </button>
            ))}
          </div>

          <div className="flex gap-6 items-start">
            {/* Left: stepped cards */}
            <div className="flex-1 min-w-0 space-y-4">

              {/* Step 0 — Details */}
              <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${step === 0 ? "border-[#DDE048]/40" : "border-[#1e2230]"}`}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2230]">
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > 0 ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>
                      {step > 0 ? <Check size={12} strokeWidth={3} /> : "1"}
                    </div>
                    <span className={`font-semibold ${step === 0 ? "text-[#DDE048]" : step > 0 ? "text-white" : "text-[#555]"}`}>Details</span>
                  </div>
                  {step > 0 && (
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm text-white truncate max-w-[160px]">{form.title || <span className="text-[#555] italic">No title</span>}</span>
                      <button onClick={() => setStep(0)} className="text-[12px] text-[#DDE048] ml-1 hover:underline shrink-0">Change</button>
                    </div>
                  )}
                </div>
                {step === 0 && (
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">Title <span className="text-[#444] normal-case">(optional)</span></label>
                      <input
                        className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
                        placeholder="e.g. Tuition · 2nd Semester"
                        value={form.title}
                        onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">Note <span className="text-[#444] normal-case">(optional)</span></label>
                      <input
                        className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors"
                        placeholder="e.g. Due before enrollment deadline"
                        value={form.note}
                        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                      />
                    </div>
                    <button onClick={nextStep} className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5">
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
                      <span className="text-sm text-white font-bold">{amount.toFixed(2)} USDC</span>
                      <button onClick={() => setStep(1)} className="text-[12px] text-[#DDE048] hover:underline">Change</button>
                    </div>
                  )}
                </div>
                {step === 1 && (
                  <div className="px-5 py-5 space-y-4">
                    <div>
                      <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">TOTAL AMOUNT (USDC)</label>
                      <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-4 focus-within:border-[#DDE048]/40 transition-colors">
                        <input
                          className="w-full bg-transparent text-white text-2xl font-extrabold outline-none"
                          type="number" placeholder="0.00"
                          value={form.amount}
                          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
                        />
                        {form.amount && <div className="text-xs text-[#555] mt-1">USDC · stablecoin</div>}
                      </div>
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Info size={13} color="#555" className="shrink-0 mt-0.5" />
                      <span className="text-xs text-[#555] leading-relaxed">This is the exact amount the sender will see pre-filled in their pledge form.</span>
                    </div>
                    <button onClick={nextStep} disabled={!form.amount}
                      className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40">
                      Continue →
                    </button>
                  </div>
                )}
              </div>

              {/* Step 2 — Deadline */}
              <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${step === 2 ? "border-[#DDE048]/40" : step > 2 ? "border-[#1e2230]" : "border-[#1e2230] opacity-50"}`}>
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#1e2230]">
                  <div className="flex items-center gap-3">
                    <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${step > 2 ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#888]"}`}>
                      {step > 2 ? <Check size={12} strokeWidth={3} /> : "3"}
                    </div>
                    <span className={`font-semibold ${step === 2 ? "text-[#DDE048]" : step > 2 ? "text-white" : "text-[#555]"}`}>Deadline</span>
                  </div>
                  {step > 2 && deadline && (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-white">{deadline.toLocaleDateString()}</span>
                      <button onClick={() => setStep(2)} className="text-[12px] text-[#DDE048] hover:underline">Change</button>
                    </div>
                  )}
                  {step === 2 && <span className="text-[11px] text-[#DDE048] font-bold tracking-[1px]">EDITING</span>}
                </div>
                {step === 2 && (
                  <div className="px-5 py-5 space-y-4">
                    <div className="relative rounded-2xl p-4 overflow-hidden"
                      style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)", border: "1px solid #1F2127" }}>
                      <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
                        <Image src="/logo.png" alt="" width={140} height={140} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
                      </div>
                      <div className="relative">
                        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">PAYMENT DEADLINE</div>
                        <DateTimePicker value={form.deadline} onChange={(val) => setForm((f) => ({ ...f, deadline: val }))} />
                      </div>
                    </div>
                    <div className="flex gap-2 flex-wrap">
                      {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
                        const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
                        return (
                          <button key={days} onClick={() => setQuickDeadline(days)}
                            className={`rounded-xl px-4 py-2 text-[13px] font-semibold border transition-colors ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#0e1014] border-[#1e2230] text-[#888] hover:border-[#333]"}`}>
                            {label}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex items-start gap-1.5">
                      <Info size={13} color="#555" className="shrink-0 mt-0.5" />
                      <span className="text-xs text-[#555] leading-relaxed">Max 90 days. The sender&apos;s pledge deadline will be locked to this date.</span>
                    </div>
                    <button onClick={nextStep} disabled={!form.deadline}
                      className="bg-[#DDE048] text-black font-bold text-sm rounded-xl px-6 py-2.5 disabled:opacity-40">
                      Continue →
                    </button>
                  </div>
                )}
              </div>

              {/* Step 3 — Review */}
              <div className={`bg-[#13161c] border rounded-2xl overflow-hidden transition-colors ${step === 3 || step === 4 ? "border-[#DDE048]/40" : "border-[#1e2230] opacity-50"}`}>
                <div className="flex items-center px-5 py-4 border-b border-[#1e2230] gap-3">
                  <div className="w-6 h-6 rounded-full bg-[#1e2230] flex items-center justify-center text-xs font-bold text-[#888]">4</div>
                  <span className={`font-semibold ${step >= 3 ? "text-white" : "text-[#555]"}`}>Review</span>
                </div>
                {step === 3 && (
                  <div className="px-5 py-5">
                    <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-1 mb-4">
                      {form.title && <ReviewRow label="Title" value={form.title} />}
                      {form.note && <ReviewRow label="Note" value={form.note} />}
                      <ReviewRow label="Amount" value={`${amount.toFixed(2)} USDC`} accent />
                      <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "—"} last />
                    </div>
                    <div className="flex items-start gap-2 bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-3 mb-4 text-[12px] text-[#888]">
                      <Link2 size={13} color="#555" className="shrink-0 mt-0.5" />
                      A unique link will be generated — share it with your sender to pre-fill their pledge.
                    </div>
                  </div>
                )}
                {step === 4 && created && (
                  <div className="px-5 py-5">
                    <div className="bg-[#0d1f0d] border border-green-500/20 rounded-xl px-4 py-4 mb-4">
                      <div className="flex items-center gap-2 mb-2">
                        <CheckCircle2 size={15} color="#22c55e" />
                        <span className="text-green-400 font-bold text-sm">Request created!</span>
                      </div>
                      <p className="text-green-400 text-xs">Copy the link below and share it with your sender.</p>
                    </div>
                    <button onClick={() => setSendModal(created)}
                      className="w-full flex items-center justify-center gap-2 rounded-xl py-3.5 text-sm font-bold bg-[#DDE048] text-black hover:bg-[#c8ce30] transition-colors mb-2">
                      <Send size={15} /> Send to Sender
                    </button>
                    <button onClick={() => copyLink(created.id)}
                      className={`w-full flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-semibold border transition-colors mb-2 ${copiedId === created.id ? "bg-green-500/20 text-green-400 border-green-500/30" : "border-[#1e2230] text-[#888] hover:border-[#333] hover:text-white"}`}>
                      {copiedId === created.id ? <><Check size={14} /> Link copied!</> : <><Copy size={14} /> Copy link instead</>}
                    </button>
                    <button onClick={() => setShowCreate(false)} className="w-full text-[#555] text-sm py-2 hover:text-[#888] transition-colors">
                      Back to requests
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Right: summary panel */}
            <div className="w-[300px] shrink-0 sticky top-24">
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
                <div className="px-5 py-4 border-b border-[#1e2230]">
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">REQUEST SUMMARY</div>
                </div>
                <div className="px-5 py-4 space-y-3">
                  <div className="flex justify-between text-sm gap-3">
                    <span className="text-[#555] shrink-0">Title</span>
                    <span className="text-white font-semibold truncate text-right">{form.title || <span className="text-[#444] italic">None</span>}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#555]">Amount</span>
                    <span className={`font-extrabold ${amount > 0 ? "text-[#DDE048]" : "text-[#333]"}`}>{amount > 0 ? `${amount.toFixed(2)} USDC` : "—"}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-[#555]">Deadline</span>
                    <span className="text-white font-semibold">{deadlineStr}</span>
                  </div>
                  {daysLeft > 0 && (
                    <div className="flex justify-between text-sm">
                      <span className="text-[#555]">Days to pay</span>
                      <span className="text-white font-semibold">{daysLeft}d</span>
                    </div>
                  )}
                  {amount > 0 && (
                    <div className="pt-2 border-t border-[#1e2230]">
                      <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-3 text-center">
                        <div className="text-[11px] text-[#555] mb-1">Sender will pay</div>
                        <div className="text-2xl font-extrabold text-[#DDE048]">{amount.toFixed(2)} <span className="text-sm font-normal text-[#888]">USDC</span></div>
                      </div>
                    </div>
                  )}
                  {step === 3 && (
                    <button onClick={handleCreate} disabled={submitting}
                      className="w-full bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3.5 flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-[#c8ce30] transition-colors mt-2">
                      <Link2 size={14} />
                      {submitting ? "Creating…" : "Create & Get Link"}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );

  /* ── MOBILE ── */
  const Mobile = (
    <div className="md:hidden min-h-screen bg-[#0e1014]">
      <Header title={showCreate ? "New Request" : "Payment Requests"} back={showCreate} />
      <div className="px-4 pt-4 pb-28">

        {!showCreate ? (
          <>
            {/* Hero stats card */}
            <div className="relative rounded-2xl p-5 mb-4 overflow-hidden"
              style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)", border: "1px solid #1F2127" }}>
              {/* Gray logo — left side watermark */}
              <div className="absolute -left-3 top-1/2 -translate-y-1/2 opacity-[0.06] pointer-events-none select-none">
                <Image src="/logo.png" alt="" width={130} height={130} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
              </div>
              <div className="relative flex items-center justify-between">
                {/* Left: total */}
                <div className="pl-10">
                  <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">TOTAL REQUESTED</div>
                  <div className="text-3xl font-extrabold text-white leading-none">
                    {requests.filter((r) => r.status !== "cancelled").reduce((s, r) => s + r.amount, 0).toFixed(2)}
                  </div>
                  <div className="text-xs text-[#666] mt-0.5">USDC</div>
                </div>
                {/* Right: terms */}
                <div className="flex flex-col gap-3 items-end">
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 justify-end mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                      <span className="text-[10px] text-[#888] tracking-[1.5px]">OPEN</span>
                    </div>
                    <div className="text-xl font-extrabold text-amber-400">{open.length}</div>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-1.5 justify-end mb-0.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                      <span className="text-[10px] text-[#888] tracking-[1.5px]">FULFILLED</span>
                    </div>
                    <div className="text-xl font-extrabold text-green-400">{fulfilled.length}</div>
                  </div>
                </div>
              </div>
            </div>

            {loading && <LoadingSpinner />}

            {!loading && requests.length === 0 && (
              <div className="flex flex-col items-center text-center py-10">
                <div className="w-14 h-14 rounded-2xl bg-[#1a1a1a] border border-[#1F2127] flex items-center justify-center mb-4">
                  <FileText size={24} color="#333" />
                </div>
                <div className="font-bold text-white mb-1">No requests yet</div>
                <div className="text-[#555] text-sm mb-1">Create one and share the link with your sender</div>
              </div>
            )}

            {requests.map((r) => {
              const days = daysUntil(r.deadline);
              const overdue = days < 0;
              const urgent = days >= 0 && days <= 3;
              return (
                <div key={r.id} className={`bg-[#11141A] border rounded-2xl p-4 mb-3 ${r.status === "cancelled" ? "border-[#1a1a1a] opacity-60" : "border-[#1F2127]"}`}>
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0 pr-3">
                      <div className="font-bold text-white text-[15px] truncate">{r.title || <span className="text-[#444] font-normal italic text-sm">No title</span>}</div>
                      {r.note && <div className="text-xs text-[#555] mt-0.5 truncate">{r.note}</div>}
                    </div>
                    <span className="text-[10px] font-bold px-2.5 py-1 rounded-full shrink-0 capitalize"
                      style={{ color: STATUS_COLOR[r.status], background: STATUS_BG[r.status] }}>
                      {r.status}
                    </span>
                  </div>
                  <div className="text-[26px] font-extrabold leading-none mb-1">
                    {r.amount.toFixed(2)} <span className="text-sm text-[#555] font-normal">USDC</span>
                  </div>
                  <div className="flex items-center gap-1.5 mb-3">
                    <Calendar size={11} color={overdue ? "#ef4444" : urgent ? "#f59e0b" : "#555"} />
                    <span className={`text-xs ${overdue ? "text-red-400 font-semibold" : urgent ? "text-amber-400 font-semibold" : "text-[#555]"}`}>
                      {overdue ? `${Math.abs(days)}d overdue` : days === 0 ? "Due today" : `${days}d left`} · {fmtDate(r.deadline)}
                    </span>
                  </div>
                  {r.status === "open" && (
                    <div className="flex gap-2">
                      <button onClick={() => { setSendModal(r); setSentTo(null); }}
                        className="flex-1 flex items-center justify-center gap-2 text-sm font-bold rounded-xl py-2.5 bg-[#DDE048] text-black hover:bg-[#c8ce30] transition-colors">
                        <Send size={14} /> Send to Sender
                      </button>
                      <button onClick={() => copyLink(r.id)}
                        className={`flex items-center justify-center gap-1.5 text-sm font-bold rounded-xl px-3.5 border transition-colors ${copiedId === r.id ? "bg-green-500/15 text-green-400 border-green-500/25" : "border-[#1F2127] text-[#555] hover:text-white"}`}>
                        {copiedId === r.id ? <Check size={14} /> : <Copy size={14} />}
                      </button>
                      <button onClick={() => handleCancel(r.id)}
                        className="bg-[#1a1a1a] border border-[#1F2127] text-[#444] hover:text-red-400 rounded-xl px-3.5 transition-colors">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {/* FAB */}
            <button onClick={openCreate}
              className="fixed bottom-24 right-5 w-14 h-14 rounded-2xl bg-[#DDE048] flex items-center justify-center shadow-[0_4px_24px_rgba(221,224,72,0.35)] z-50">
              <Plus size={24} color="#000" strokeWidth={2.5} />
            </button>
          </>
        ) : (
          /* Mobile create flow */
          <>
            <button onClick={back} className="flex items-center gap-1.5 text-[#888] text-sm mb-5">
              <ArrowLeft size={16} color="#888" /> Back
            </button>

            <div className="text-[11px] text-[#888] tracking-[1px] mb-2">STEP {Math.min(step + 1, 4)} OF 4 · {STEPS[Math.min(step, 3)].toUpperCase()}</div>
            <div className="flex gap-1 mb-6">
              {STEPS.map((_, i) => (
                <div key={i} className="flex-1 h-1 rounded bg-[#2a2a2a] overflow-hidden">
                  <div className="h-full bg-[#DDE048] rounded transition-all duration-500" style={{ width: i <= step ? "100%" : "0%" }} />
                </div>
              ))}
            </div>

            {step === 0 && (
              <div>
                <h2 className="text-2xl font-extrabold mb-5">What is this request for?</h2>
                <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Title <span className="font-normal">(optional)</span></label>
                <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
                  placeholder="e.g. Tuition · 2nd Semester"
                  value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
                <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Note <span className="font-normal">(optional)</span></label>
                <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block"
                  placeholder="e.g. Due before enrollment"
                  value={form.note} onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
              </div>
            )}

            {step === 1 && (
              <div>
                <h2 className="text-2xl font-extrabold mb-5">How much do you need?</h2>
                <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Amount (USDC)</label>
                <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-2xl font-extrabold mb-3.5 outline-none block"
                  type="number" placeholder="0.00"
                  value={form.amount} onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))} />
                <div className="flex items-start gap-1.5"><Info size={13} color="#555" /><span className="text-xs text-[#888]">This amount will be pre-filled and locked in the sender&apos;s form.</span></div>
              </div>
            )}

            {step === 2 && (
              <div>
                <h2 className="text-2xl font-extrabold mb-5">When is it due?</h2>
                <div className="relative rounded-2xl p-4 mb-3 overflow-hidden" style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 60%, #0e1012 100%)", border: "1px solid #1F2127" }}>
                  <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
                    <Image src="/logo.png" alt="" width={130} height={130} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
                  </div>
                  <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3 relative">PAYMENT DEADLINE</div>
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
                  <DateTimePicker value={form.deadline} onChange={(val) => setForm((f) => ({ ...f, deadline: val }))} />
                  <div className="flex gap-2 flex-wrap mt-3 relative">
                    {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
                      const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
                      return (
                        <button key={days} onClick={() => setQuickDeadline(days)}
                          className={`rounded-xl px-4 py-2 text-[13px] font-semibold border ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}>
                          {label}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="flex items-start gap-1.5"><Info size={13} color="#555" className="shrink-0 mt-0.5" /><span className="text-xs text-[#666] leading-relaxed">Max 90 days. The sender&apos;s pledge deadline will be locked to this date.</span></div>
              </div>
            )}

            {step === 3 && (
              <div>
                <h2 className="text-2xl font-extrabold mb-5">Review request</h2>
                <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-1 mb-3">
                  {form.title && <ReviewRow label="Title" value={form.title} />}
                  {form.note && <ReviewRow label="Note" value={form.note} />}
                  <ReviewRow label="Amount" value={`${amount.toFixed(2)} USDC`} accent />
                  <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "—"} last />
                </div>
              </div>
            )}

            {step === 4 && created && (
              <div>
                <h2 className="text-2xl font-extrabold mb-5">Request created!</h2>
                <div className="bg-[#0d1f0d] border border-green-500/20 rounded-2xl px-4 py-3.5 mb-4">
                  <div className="flex items-center gap-2 mb-1"><CheckCircle2 size={15} color="#22c55e" /><span className="text-green-400 font-bold text-sm">All set!</span></div>
                  <p className="text-green-400 text-xs">Share the link below with your sender — they&apos;ll see the amount and deadline pre-filled.</p>
                </div>
                <button onClick={() => { setSendModal(created); setSentTo(null); }}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl py-[17px] text-base font-bold mb-2 bg-[#DDE048] text-black hover:bg-[#c8ce30] transition-colors">
                  <Send size={16} /> Send to Sender
                </button>
                <button onClick={() => copyLink(created.id)}
                  className={`w-full flex items-center justify-center gap-2 rounded-2xl py-3 text-sm font-semibold border mb-3 transition-colors ${copiedId === created.id ? "bg-green-500/20 text-green-400 border-green-500/30" : "border-[#1F2127] text-[#888]"}`}>
                  {copiedId === created.id ? <><Check size={14} /> Link copied!</> : <><Copy size={14} /> Copy link instead</>}
                </button>
                <button onClick={() => setShowCreate(false)} className="w-full text-[#555] text-sm py-2 text-center">
                  Back to requests
                </button>
              </div>
            )}

            {step < 4 && (
              <button
                className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-[17px] text-base font-bold mt-6 disabled:opacity-50"
                disabled={!canNext || submitting}
                onClick={step < 3 ? nextStep : handleCreate}>
                {submitting ? "Creating…" : step < 3 ? "Continue →" : <span className="flex items-center justify-center gap-2"><Link2 size={16} /> Create & Get Link</span>}
              </button>
            )}
          </>
        )}
      </div>
      <BottomNav />
    </div>
  );

  const SendModal = sendModal && (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm px-4">
      <div className="w-full max-w-sm bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
        <div className="relative p-5 overflow-hidden" style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 55%, #0e1012 100%)" }}>
          <div className="absolute -right-4 -top-4 opacity-[0.06] pointer-events-none select-none">
            <Image src="/logo.png" alt="" width={100} height={100} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
          </div>
          <div className="relative flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Send size={13} color="#DDE048" />
                <span className="text-[11px] text-[#DDE048] tracking-[1.5px] font-semibold">SEND REQUEST</span>
              </div>
              <div className="text-white font-bold truncate max-w-[200px]">{sendModal.title || "Payment Request"}</div>
              <div className="text-[#DDE048] font-extrabold text-lg">{sendModal.amount.toFixed(2)} <span className="text-xs font-normal text-[#888]">USDC</span></div>
            </div>
            <button onClick={() => { setSendModal(null); setSentTo(null); }} className="text-[#555] hover:text-white transition-colors text-xl font-bold">×</button>
          </div>
        </div>
        <div className="p-5">
          {sentTo ? (
            <div className="flex flex-col items-center text-center py-4">
              <div className="w-12 h-12 rounded-full bg-green-500/15 border border-green-500/30 flex items-center justify-center mb-3">
                <CheckCircle2 size={22} color="#22c55e" />
              </div>
              <div className="text-green-400 font-bold mb-1">Notification sent!</div>
              <div className="text-[#555] text-xs mb-4 font-mono break-all">{sentTo}</div>
              <button onClick={() => { setSendModal(null); setSentTo(null); }}
                className="text-[#888] text-sm hover:text-white transition-colors">Close</button>
            </div>
          ) : (
            <>
              <label className="text-xs text-[#555] tracking-[0.5px] block mb-2">Sender&apos;s wallet address</label>
              <input
                className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 transition-colors mb-3 font-mono"
                placeholder="0x..."
                value={senderInput}
                onChange={(e) => setSenderInput(e.target.value)}
              />
              <p className="text-xs text-[#555] mb-4">The sender will receive a notification in their app with a direct link to pay.</p>
              <div className="flex gap-2">
                <button onClick={handleSendNotification} disabled={sending || !senderInput.trim()}
                  className="flex-1 flex items-center justify-center gap-2 bg-[#DDE048] text-black font-bold text-sm rounded-xl py-3 disabled:opacity-40 hover:bg-[#c8ce30] transition-colors">
                  {sending ? "Sending…" : <><Send size={14} /> Send Notification</>}
                </button>
                <button onClick={() => setSendModal(null)} className="px-4 border border-[#1e2230] rounded-xl text-[#555] hover:text-white transition-colors text-sm">
                  Cancel
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  return <KYCGate featureName="Payment Requests">{SendModal}{Desktop}{Mobile}</KYCGate>;
}

function ReviewRow({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 ${last ? "" : "border-b border-[#1F2127]"}`}>
      <span className="text-[#888] text-sm">{label}</span>
      <span className={`font-semibold text-sm ${accent ? "text-[#DDE048]" : "text-white"}`}>{value}</span>
    </div>
  );
}

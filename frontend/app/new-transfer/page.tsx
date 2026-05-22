"use client";
import Header from "../../components/Header";
import Image from "next/image";
import DateTimePicker from "../../components/DateTimePicker";
import TxGuard from "../../components/TxGuard";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ethers } from "ethers";
import { ArrowLeft, Calendar, Check, Info, CheckCircle2, Clock, Loader } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS, PHP_PER_USDC } from "../../contracts/addresses";
import ProgressBar from "../../components/ProgressBar";
import { savePledgeMeta, getPledgeMeta } from "../../lib/pledgeMeta";

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
  const router = useRouter();
  const searchParams = useSearchParams();
  const { account, signer, pledgeRead, pledgeWrite, usdcRead, usdcWrite } = useWallet();

  useEffect(() => {
    const to = searchParams.get("to");
    if (to) {
      const known = getPledgeMeta(to);
      setForm((f) => ({ ...f, merchant: to, merchantName: known?.name ?? "" }));
    }
  }, []);
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    merchant: "", merchantName: "", note: "",
    totalAmount: "", initialDeposit: "", commitmentDate: "",
  });
  const [requiredPct, setRequiredPct] = useState(20);
  const [txStatus, setTxStatus] = useState("");
  const [txError, setTxError] = useState("");
  const [loading, setLoading] = useState(false);

  function back() { if (step > 0) setStep(step - 1); else router.push("/"); }

  async function nextStep() {
    if (step === 0 && form.merchant) {
      if (account) { const pct = await pledgeRead.getRequiredDepositPct(account); setRequiredPct(Number(pct)); }
      setStep(1);
    } else if (step === 1 && form.totalAmount) {
      if (!form.initialDeposit) setForm({ ...form, initialDeposit: ((parseFloat(form.totalAmount) * 1.01 * requiredPct) / 100).toFixed(2) });
      setStep(2);
    } else if (step === 2 && form.commitmentDate) {
      setStep(3);
    }
  }

  async function submit() {
    if (!pledgeWrite || !usdcWrite || !signer) return;

    const totalAmt = ethers.parseUnits(form.totalAmount, 6);
    const initDeposit = ethers.parseUnits(form.initialDeposit, 6);
    const commitTs = Math.floor(new Date(form.commitmentDate).getTime() / 1000);

    // Pre-flight: check balance before touching MetaMask
    const balance: bigint = await usdcRead.balanceOf(account);
    if (balance < initDeposit) {
      const has = parseFloat(ethers.formatUnits(balance, 6)).toFixed(2);
      const needs = parseFloat(ethers.formatUnits(initDeposit, 6)).toFixed(2);
      setTxError(`Insufficient USDC balance. You have ${has} USDC but need ${needs} USDC.`);
      return;
    }

    // Encode all calldata synchronously before any awaits — immune to tab-switch context re-renders
    const approveData = usdcWrite.interface.encodeFunctionData("approve", [CONTRACTS.REMITTANCE_PLEDGE, initDeposit]);
    const createData = pledgeWrite.interface.encodeFunctionData("createPledge", [form.merchant, totalAmt, initDeposit, commitTs]);
    const frozenSigner = signer;

    setLoading(true); setTxError(""); setTxStatus("approving");
    try {
      const approveTx = await frozenSigner.sendTransaction({ to: CONTRACTS.MOCK_USDC, data: approveData });
      await approveTx.wait();
      setTxStatus("creating");
      const createTx = await frozenSigner.sendTransaction({ to: CONTRACTS.REMITTANCE_PLEDGE, data: createData });
      await createTx.wait();
      savePledgeMeta(form.merchant, { name: form.merchantName, note: form.note });
      setTxStatus("done");
      setTimeout(() => router.push("/pledges"), 1800);
    } catch (err: unknown) {
      setTxError(parseContractError(err));
      setTxStatus("");
      setLoading(false);
    }
  }

  function setQuickDate(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    setForm({ ...form, commitmentDate: d.toISOString().slice(0, 16) });
  }

  function setPayday() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const day = now.getDate();
    // Next payday = 15th or last day of month, whichever is next
    const mid = new Date(year, month, 15, 9, 0, 0, 0);
    const end = new Date(year, month + 1, 0, 9, 0, 0, 0); // last day of current month
    let payday = day < 15 ? mid : day < end.getDate() ? end : new Date(year, month + 1, 15, 9, 0, 0, 0);
    // If payday is today or past, push to next one
    if (payday <= now) payday = new Date(year, month + 1, 15, 9, 0, 0, 0);
    setForm({ ...form, commitmentDate: payday.toISOString().slice(0, 16) });
  }

  const total = parseFloat(form.totalAmount) || 0;
  const gross = parseFloat((total * 1.01).toFixed(6));
  const deposit = parseFloat(form.initialDeposit) || 0;
  const remaining = Math.max(0, parseFloat((gross - deposit).toFixed(6)));
  const deadline = form.commitmentDate ? new Date(form.commitmentDate) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86400000) : 0;
  const canNext = (step === 0 && !!form.merchant) || (step === 1 && !!form.totalAmount && !!form.initialDeposit) || (step === 2 && !!form.commitmentDate) || step === 3;

  return (
    <div>
      <Header title="New Transfer" />
      <div className="px-4 pt-5 pb-6 min-h-screen">

      <button
        onClick={back}
        className="flex items-center gap-1.5 text-[#888] text-sm mb-5 bg-transparent border-0 cursor-pointer p-0">
        <ArrowLeft size={16} color="#888" />
        Back
      </button>

      <div className="text-[11px] text-[#888] tracking-[1px] mb-2">STEP {step + 1} OF 4 · {STEPS[step].toUpperCase()}</div>
      <div className="flex gap-1 mb-[22px]">
        {STEPS.map((_, i) => (
          <div key={i} className="flex-1 h-1 rounded bg-[#2a2a2a] overflow-hidden">
            <div className="h-full bg-[#DDE048] rounded transition-all duration-500 ease-out"
              style={{ width: i <= step ? "100%" : "0%" }} />
          </div>
        ))}
      </div>

      {step === 0 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-[22px]">Who are you sending to?</h2>
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Merchant wallet address</label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="0x..."
            value={form.merchant}
            onChange={(e) => {
              const addr = e.target.value;
              const known = getPledgeMeta(addr);
              setForm({ ...form, merchant: addr, merchantName: known?.name ?? form.merchantName });
            }} />
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">
            Merchant name <span className="text-[#888] font-normal">(optional)</span>
            {form.merchantName && getPledgeMeta(form.merchant)?.name === form.merchantName && (
              <span className="ml-2 text-[#DDE048]">· from contacts</span>
            )}
          </label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="e.g. Dr. Yanga's Colleges Inc."
            value={form.merchantName} onChange={(e) => setForm({ ...form, merchantName: e.target.value })} />
          <div className="flex items-start gap-1.5 mt-1.5"><Info size={13} color="#666" /><span className="text-xs text-[#888] leading-relaxed">Enter the merchant&apos;s wallet address on Morph L2.</span></div>
        </div>
      )}

      {step === 1 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-[22px]">How much are you sending?</h2>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-3 flex justify-between items-center mb-[18px]">
            <div>
              {form.merchantName && <div className="font-semibold text-sm">{form.merchantName}</div>}
              <div className={`${form.merchantName ? "text-[11px] text-[#888]" : "text-sm text-white"}`}>
                {form.merchant.slice(0, 10)}...{form.merchant.slice(-6)}
              </div>
            </div>
            <Check size={16} color="#DDE048" />
          </div>
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Total Amount (USDC)</label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" type="number" placeholder="e.g. 248.50" value={form.totalAmount}
            onChange={(e) => setForm({ ...form, totalAmount: e.target.value })} />
          {form.totalAmount && <div className="text-xs text-[#888] -mt-2.5 mb-3.5">= ₱{(total * PHP_PER_USDC).toLocaleString()} PHP</div>}
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Lock Now (initial deposit)</label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" type="number"
            placeholder={`Min ${requiredPct}% = ${((gross * requiredPct) / 100).toFixed(2)} USDC`}
            value={form.initialDeposit} onChange={(e) => setForm({ ...form, initialDeposit: e.target.value })} />
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Note / Reference <span className="text-[#888] font-normal">(optional)</span></label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="e.g. Tuition · 2nd Semester"
            value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="flex items-start gap-1.5 mt-1.5"><Info size={13} color="#666" /><span className="text-xs text-[#888] leading-relaxed">Your trust score requires at least {requiredPct}% upfront.</span></div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-5">When can you commit?</h2>

          {/* Merchant recap */}
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

          {/* Amount summary */}
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

          {/* Date picker */}
          <div className="relative rounded-2xl p-4 mb-3 overflow-hidden"
            style={{ background: "linear-gradient(135deg, #1B1E16 0%, #11141A 60%, #0e1012 100%)", border: "1px solid #1F2127" }}>
            {/* Watermark logo */}
            <div className="absolute -right-4 -top-2 opacity-[0.07] pointer-events-none select-none">
              <Image src="/logo.png" alt="" width={110} height={110} style={{ objectFit: "contain", filter: "grayscale(1)" }} />
            </div>

            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3 relative">
              COMMIT REMAINING {remaining.toFixed(2)} USDC BY
            </div>

            {deadline && (
              <div className="bg-[#0d0f13] border border-[#1F2127] rounded-xl px-4 py-3 flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center shrink-0">
                    <Calendar size={15} color="#666" />
                  </div>
                  <div>
                    <div className="font-bold text-[17px] leading-tight">
                      {deadline.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>
                    <div className="text-xs text-[#888] mt-0.5">
                      {deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} UTC+8
                    </div>
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
            <DateTimePicker
              value={form.commitmentDate}
              onChange={(val) => setForm({ ...form, commitmentDate: val })}
            />
            {/* Quick-select pills inside the container */}
            <div className="flex gap-2 flex-wrap mt-3 relative">
            <button
              onClick={setPayday}
              className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${deadline && (deadline.getDate() === 15 || deadline.getDate() === new Date(deadline.getFullYear(), deadline.getMonth() + 1, 0).getDate()) ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}>
              Payday
            </button>
            {[{ label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
              const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
              return (
                <button key={label}
                  className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${isActive ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}
                  onClick={() => setQuickDate(days)}>{label}</button>
              );
            })}
            <button
              className={`rounded-xl px-4 py-2 text-[13px] font-semibold cursor-pointer border ${!deadline ? "bg-[#DDE048] border-[#DDE048] text-black" : "bg-[#1a1a1a] border-[#1F2127] text-[#888]"}`}
              onClick={() => setForm({ ...form, commitmentDate: "" })}>Custom</button>
            </div>
          </div>

          <div className="flex items-start gap-1.5">
            <Info size={13} color="#555" className="shrink-0 mt-0.5" />
            <span className="text-xs text-[#666] leading-relaxed">Max 90 days. After this date a 7-day grace period starts.</span>
          </div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-[22px]">Review Transfer</h2>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-1 mb-3">
            {form.merchantName && <ReviewRow label="To" value={form.merchantName} />}
            <ReviewRow label="Wallet" value={`${form.merchant.slice(0, 10)}...${form.merchant.slice(-6)}`} />
            {form.note && <ReviewRow label="Note" value={form.note} />}
            <ReviewRow label="Total" value={`${total.toFixed(2)} USDC`} />
            <ReviewRow label="Lock now" value={`${deposit.toFixed(2)} USDC`} accent />
            <ReviewRow label="Remaining" value={`${remaining.toFixed(2)} USDC`} />
            <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "–"} />
            <ReviewRow label="PHP equiv." value={`₱${(total * PHP_PER_USDC).toLocaleString()}`} last />
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

      <TxGuard
        active={loading && txStatus !== "done"}
        steps={[
          { label: "Approve USDC spend", state: txStatus === "approving" ? "active" : txStatus === "creating" || txStatus === "done" ? "done" : "pending" },
          { label: "Create pledge on-chain", state: txStatus === "creating" ? "active" : txStatus === "done" ? "done" : "pending" },
        ]}
      />

      <button
        className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-[17px] text-base font-bold cursor-pointer mt-6 mb-6 disabled:opacity-50"
        style={{ opacity: canNext ? 1 : 0.5 }}
        onClick={step < 3 ? nextStep : submit} disabled={!canNext || loading}>
        {loading ? (txStatus === "done" ? "✓ Done!" : "Processing...") : step < 3 ? "Continue →" : "Confirm & Send →"}
      </button>
      </div>
    </div>
  );
}

// Decodes common ERC20 / contract revert reasons from raw error data
function parseContractError(err: unknown): string {
  const e = err as { reason?: string; data?: string; message?: string };
  if (e.reason) return e.reason;
  // ERC20InsufficientBalance(address,uint256,uint256) — selector 0xe450d38c
  if (e.data?.startsWith("0xe450d38c")) {
    const needed = BigInt("0x" + e.data.slice(130, 194));
    const has    = BigInt("0x" + e.data.slice(66, 130));
    return `Insufficient USDC balance. You have ${(Number(has) / 1e6).toFixed(2)} USDC but need ${(Number(needed) / 1e6).toFixed(2)} USDC.`;
  }
  // ERC20InsufficientAllowance(address,uint256,uint256) — selector 0xfb8f41b2
  if (e.data?.startsWith("0xfb8f41b2")) {
    return "USDC allowance too low. Please try again.";
  }
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


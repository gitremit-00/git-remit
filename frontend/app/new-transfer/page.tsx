"use client";
import Header from "../../components/Header";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { ethers } from "ethers";
import { Calendar, Check, Info } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { CONTRACTS, PHP_PER_USDC } from "../../contracts/addresses";
import ProgressBar from "../../components/ProgressBar";
import { savePledgeMeta } from "../../lib/pledgeMeta";

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
  const { account, pledgeRead, pledgeWrite, usdcWrite } = useWallet();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormState>({
    merchant: "", merchantName: "", note: "",
    totalAmount: "", initialDeposit: "", commitmentDate: "",
  });
  const [requiredPct, setRequiredPct] = useState(20);
  const [txStatus, setTxStatus] = useState("");
  const [loading, setLoading] = useState(false);

  function back() { if (step > 0) setStep(step - 1); else router.push("/"); }

  async function nextStep() {
    if (step === 0 && form.merchant) {
      if (account) { const pct = await pledgeRead.getRequiredDepositPct(account); setRequiredPct(Number(pct)); }
      setStep(1);
    } else if (step === 1 && form.totalAmount) {
      if (!form.initialDeposit) setForm({ ...form, initialDeposit: ((parseFloat(form.totalAmount) * requiredPct) / 100).toFixed(2) });
      setStep(2);
    } else if (step === 2 && form.commitmentDate) {
      setStep(3);
    }
  }

  async function submit() {
    if (!pledgeWrite || !usdcWrite) return;
    setLoading(true); setTxStatus("Step 1/2: Approving USDC...");
    try {
      const totalAmt = ethers.parseUnits(form.totalAmount, 6);
      const initDeposit = ethers.parseUnits(form.initialDeposit, 6);
      const commitTs = Math.floor(new Date(form.commitmentDate).getTime() / 1000);
      await (await usdcWrite.approve(CONTRACTS.REMITTANCE_PLEDGE, initDeposit)).wait();
      setTxStatus("Step 2/2: Creating pledge...");
      await (await pledgeWrite.createPledge(form.merchant, totalAmt, initDeposit, commitTs)).wait();
      savePledgeMeta(form.merchant, { name: form.merchantName, note: form.note });
      router.push("/pledges");
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setTxStatus("Error: " + (e.reason ?? e.message));
      setLoading(false);
    }
  }

  function setQuickDate(days: number) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(9, 0, 0, 0);
    setForm({ ...form, commitmentDate: d.toISOString().slice(0, 16) });
  }

  const total = parseFloat(form.totalAmount) || 0;
  const deposit = parseFloat(form.initialDeposit) || 0;
  const remaining = Math.max(0, total - deposit);
  const deadline = form.commitmentDate ? new Date(form.commitmentDate) : null;
  const daysLeft = deadline ? Math.ceil((deadline.getTime() - Date.now()) / 86400000) : 0;
  const canNext = (step === 0 && !!form.merchant) || (step === 1 && !!form.totalAmount && !!form.initialDeposit) || (step === 2 && !!form.commitmentDate) || step === 3;

  return (
    <div className="px-4 pt-5 pb-[120px] min-h-screen">
      <Header title="New Transfer" back />

      <div className="flex gap-1 mb-2.5">
        {STEPS.map((_, i) => <div key={i} className="flex-1 h-1 rounded" style={{ background: i <= step ? "#DDE048" : "#2a2a2a" }} />)}
      </div>
      <div className="text-[11px] text-[#888] tracking-[1px] mb-[22px]">STEP {step + 1} OF 4 · {STEPS[step].toUpperCase()}</div>

      {step === 0 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-[22px]">Who are you sending to?</h2>
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Merchant wallet address</label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="0x..."
            value={form.merchant} onChange={(e) => setForm({ ...form, merchant: e.target.value })} />
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Merchant name <span className="text-[#888] font-normal">(optional)</span></label>
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
            placeholder={`Min ${requiredPct}% = ${((total * requiredPct) / 100).toFixed(2)} USDC`}
            value={form.initialDeposit} onChange={(e) => setForm({ ...form, initialDeposit: e.target.value })} />
          <label className="text-xs text-[#888] mb-2 block tracking-[0.5px]">Note / Reference <span className="text-[#888] font-normal">(optional)</span></label>
          <input className="w-full bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-[14px] text-white text-base mb-3.5 outline-none block" placeholder="e.g. Tuition · 2nd Semester"
            value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
          <div className="flex items-start gap-1.5 mt-1.5"><Info size={13} color="#666" /><span className="text-xs text-[#888] leading-relaxed">Your trust score requires at least {requiredPct}% upfront.</span></div>
        </div>
      )}

      {step === 2 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-[22px]">When can you commit?</h2>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[14px] px-4 py-3 flex justify-between items-center mb-[18px]">
            <div>
              {form.merchantName && <div className="font-semibold text-sm">{form.merchantName}</div>}
              <div className={`${form.merchantName ? "text-[11px] text-[#888]" : "text-sm text-white"}`}>
                {form.merchant.slice(0, 10)}...{form.merchant.slice(-6)}
              </div>
            </div>
            <Check size={18} color="#DDE048" />
          </div>
          <div className="flex justify-between mb-2.5">
            <div>
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">TOTAL</div>
              <div className="text-[22px] font-extrabold">{total.toFixed(2)} <span className="text-[13px] text-[#888]">USDC</span></div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1">LOCK NOW</div>
              <div className="text-[22px] font-extrabold text-[#DDE048]">{deposit.toFixed(2)} <span className="text-[13px] text-[#888]">USDC</span></div>
            </div>
          </div>
          <ProgressBar locked={deposit} total={total} />
          <div className="flex justify-between text-[11px] text-[#888] mb-3.5">
            <span className="text-[#DDE048]">{deposit.toFixed(2)} locked</span>
            <span>{remaining.toFixed(2)} remaining</span>
          </div>

          <div className="bg-[#11141A] border border-[#1F2127] rounded-[14px] p-4 mb-3">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2.5">
              COMMIT REMAINING {remaining.toFixed(2)} USDC BY
            </div>
            <div className="flex items-center gap-3">
              <Calendar size={18} color="#888" />
              <div className="flex-1">
                {deadline ? (
                  <>
                    <div className="font-bold text-base">
                      {deadline.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
                    </div>
                    <div className="text-xs text-[#888]">
                      {deadline.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })} UTC+8
                    </div>
                  </>
                ) : (
                  <input className="bg-transparent border-0 text-white text-[15px] outline-none w-full" type="datetime-local" value={form.commitmentDate}
                    onChange={(e) => setForm({ ...form, commitmentDate: e.target.value })} />
                )}
              </div>
              {daysLeft > 0 && (
                <div className="text-right">
                  <div className="text-[22px] font-extrabold text-[#DDE048] leading-none">{daysLeft}</div>
                  <div className="text-[10px] text-[#888]">days</div>
                </div>
              )}
            </div>
            {deadline && (
              <button className="bg-transparent border-0 text-[#888] text-xs cursor-pointer mt-2.5 p-0 underline" onClick={() => setForm({ ...form, commitmentDate: "" })}>Change date</button>
            )}
          </div>

          <div className="flex gap-2 flex-wrap mb-3 mt-1">
            {[{ label: "Payday", days: 15 }, { label: "15d", days: 15 }, { label: "30d", days: 30 }, { label: "60d", days: 60 }].map(({ label, days }) => {
              const isActive = deadline && Math.ceil((deadline.getTime() - Date.now()) / 86400000) === days;
              return (
                <button key={label}
                  className={`rounded-[20px] px-4 py-[7px] text-[13px] cursor-pointer border ${isActive ? "bg-[rgba(212,255,0,0.12)] border-[#DDE048] text-[#DDE048]" : "bg-[#1e1e1e] border-[#1F2127] text-white"}`}
                  onClick={() => setQuickDate(days)}>{label}</button>
              );
            })}
            <button className="bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-4 py-[7px] text-white text-[13px] cursor-pointer" onClick={() => setForm({ ...form, commitmentDate: "" })}>Custom</button>
          </div>

          <div className="flex items-start gap-1.5 mt-1.5"><Info size={13} color="#666" /><span className="text-xs text-[#888] leading-relaxed">Max 90 days. After this date a 7-day grace period starts.</span></div>
        </div>
      )}

      {step === 3 && (
        <div>
          <h2 className="text-2xl font-extrabold mb-[22px]">Review Transfer</h2>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-1">
            {form.merchantName && <ReviewRow label="To" value={form.merchantName} />}
            <ReviewRow label="Wallet" value={`${form.merchant.slice(0, 10)}...${form.merchant.slice(-6)}`} />
            {form.note && <ReviewRow label="Note" value={form.note} />}
            <ReviewRow label="Total" value={`${total.toFixed(2)} USDC`} />
            <ReviewRow label="Lock now" value={`${deposit.toFixed(2)} USDC`} accent />
            <ReviewRow label="Remaining" value={`${remaining.toFixed(2)} USDC`} />
            <ReviewRow label="Deadline" value={deadline ? deadline.toLocaleString() : "–"} />
            <ReviewRow label="PHP equiv." value={`₱${(total * PHP_PER_USDC).toLocaleString()}`} last />
          </div>
          {txStatus && <p className="text-[#DDE048] text-sm mt-3.5 text-center">{txStatus}</p>}
        </div>
      )}

      <div className="fixed bottom-[90px] left-1/2 -translate-x-1/2 w-[calc(100%-32px)] max-w-[398px]">
        <button
          className="w-full bg-[#DDE048] text-black border-0 rounded-2xl py-[17px] text-base font-bold cursor-pointer disabled:opacity-50"
          style={{ opacity: canNext ? 1 : 0.5 }}
          onClick={step < 3 ? nextStep : submit} disabled={!canNext || loading}>
          {loading ? (txStatus || "Processing...") : step < 3 ? "Continue →" : "Review Transfer →"}
        </button>
      </div>
    </div>
  );
}

function ReviewRow({ label, value, accent, last }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 ${last ? "" : "border-b border-[#1F2127]"}`}>
      <span className="text-[#888] text-sm">{label}</span>
      <span className={`font-semibold text-sm ${accent ? "text-[#DDE048]" : "text-white"}`}>{value}</span>
    </div>
  );
}


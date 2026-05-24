"use client";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader } from "lucide-react";
import Image from "next/image";

interface Step {
  label: string;
  state: "active" | "pending" | "done";
}

interface TxGuardProps {
  active: boolean;
  steps: Step[];
}

function TxStep({ label, state, index }: Step & { index: number }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 border ${
        state === "done"    ? "bg-green-500/15 border-green-500/40" :
        state === "active"  ? "bg-amber-400/15 border-amber-400/40" :
                              "bg-[#1a1a1a] border-[#2a2a2a]"
      }`}>
        {state === "done"    && <CheckCircle2 size={15} color="#22c55e" />}
        {state === "active"  && <Loader size={15} color="#f59e0b" className="animate-spin" />}
        {state === "pending" && <span className="text-[#444] text-xs font-bold">{index + 1}</span>}
      </div>
      <span className={`text-sm font-medium ${
        state === "done"   ? "text-[#22c55e]" :
        state === "active" ? "text-white" :
                             "text-[#444]"
      }`}>{label}</span>
      {state === "active" && (
        <span className="ml-auto text-[10px] text-amber-400 font-semibold tracking-wide animate-pulse">CONFIRMING</span>
      )}
      {state === "done" && (
        <span className="ml-auto text-[10px] text-green-500 font-semibold tracking-wide">DONE</span>
      )}
    </div>
  );
}

export default function TxGuard({ active, steps }: TxGuardProps) {
  const [needsMetaMask, setNeedsMetaMask] = useState(false);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    if (!active) return;
    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [active]);

  const stepKey = steps.map(s => s.state).join(",");
  useEffect(() => {
    if (!active) { setNeedsMetaMask(false); setElapsed(0); return; }
    setElapsed(0);
    const nudge = setTimeout(() => setNeedsMetaMask(true), 8000);
    return () => { clearTimeout(nudge); setNeedsMetaMask(false); };
  }, [active, stepKey]);

  // Elapsed seconds counter
  useEffect(() => {
    if (!active) { setElapsed(0); return; }
    const t = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(t);
  }, [active]);

  if (!active) return null;

  const activeStep = steps.find(s => s.state === "active");
  const doneCount = steps.filter(s => s.state === "done").length;
  const progress = Math.round((doneCount / steps.length) * 100);

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center px-5"
      style={{ background: "rgba(0,0,0,0.88)", backdropFilter: "blur(8px)" }}>

      <div className="w-full max-w-[360px] bg-[#11141A] border border-[#1F2127] rounded-3xl overflow-hidden">

        {/* Progress bar */}
        <div className="h-1 bg-[#1a1a1a] w-full">
          <div
            className="h-full bg-[#DDE048] transition-all duration-700 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>

        <div className="px-6 py-6">
          {/* Header */}
          <div className="flex items-center gap-3 mb-6">
            <Image src="/logo.png" alt="RemitSafe" width={36} height={36} style={{ objectFit: "contain" }} />
            <div>
              <Image src="/remitsafe.png" alt="RemitSafe" width={100} height={18} style={{ objectFit: "contain" }} priority />
              <p className="text-[#888] text-xs mt-0.5">
                {elapsed < 60 ? `${elapsed}s elapsed` : `${Math.floor(elapsed / 60)}m ${elapsed % 60}s elapsed`}
              </p>
            </div>
          </div>

          {/* Steps */}
          <div className="flex flex-col gap-4 mb-6">
            {steps.map((s, i) => (
              <div key={i}>
                <TxStep {...s} index={i} />
                {i < steps.length - 1 && (
                  <div className="ml-4 w-px h-4 mt-2"
                    style={{ background: s.state === "done" ? "#22c55e44" : "#2a2a2a" }} />
                )}
              </div>
            ))}
          </div>

          {/* MetaMask nudge */}
          {needsMetaMask ? (
            <div className="bg-amber-400/10 border border-amber-400/25 rounded-2xl px-4 py-3.5 flex items-center gap-3">
              <Image src="/MetaMask.png" alt="MetaMask" width={28} height={28} style={{ objectFit: "contain" }} className="shrink-0" />
              <div>
                <p className="text-amber-400 text-sm font-semibold leading-tight">Action required in MetaMask</p>
                <p className="text-[#777] text-xs mt-0.5 leading-relaxed">Open MetaMask and confirm the pending transaction.</p>
              </div>
            </div>
          ) : (
            <div className="bg-[#0d0d0d] border border-[#1F2127] rounded-2xl px-4 py-3 flex items-center gap-3">
              <div className="w-1.5 h-1.5 rounded-full bg-[#DDE048] animate-pulse shrink-0" />
              <p className="text-[#666] text-xs leading-relaxed">
                {activeStep
                  ? `Waiting for ${activeStep.label.toLowerCase()}...`
                  : "Processing on-chain..."}
                {" "}Do not close this page.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

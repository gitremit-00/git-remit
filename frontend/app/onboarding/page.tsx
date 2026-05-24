"use client";
import React from "react";
import Image from "next/image";
import { useState, useEffect } from "react";

import { useRouter } from "next/navigation";
import { ArrowRight, Loader, Check, PlaneTakeoff, Store } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { useRole } from "../../context/RoleContext";
import { createUser, Role } from "../../lib/supabase";
import MetaMaskGate from "../../components/MetaMaskGate";
import LoadingScreen from "../../components/LoadingScreen";

const STEPS = ["Connect", "Choose role", "Confirm"];

export default function Onboarding() {
  const { account, connect, walletLoading } = useWallet();
  const { loading: roleLoading, isNewUser } = useRole();
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [selected, setSelected] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  // Only advance to role picker once Supabase confirms this wallet has no record
  useEffect(() => {
    if (isNewUser && step === 0) setStep(1);
  }, [isNewUser]);

  async function handleContinue() {
    if (!account || !selected) return;
    setSaving(true);
    setError("");
    try {
      await createUser(account, selected, name.trim() || undefined);
      document.cookie = `rs_role=${selected}; path=/; max-age=2592000`;
      router.replace(selected === "merchant" ? "/merchant" : "/");
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // Show spinner while wallet initializes or while Supabase is confirming this is a new user.
  // This prevents the role-picker from flashing for returning users being redirected away.
  if (walletLoading || (account && (roleLoading || !isNewUser))) {
    return <LoadingScreen />;
  }

  return (
    <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">

        {/* Card */}
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">

          {/* Logo inside card */}
          <div className="flex flex-col items-center mb-6">
            <Image src="/logo.png" alt="RemitSafe" width={44} height={44} style={{ objectFit: "contain" }} />
            <span className="text-white font-extrabold text-base mt-2.5">RemitSafe</span>
          </div>


          {/* Step pills */}
          <div className="flex items-center justify-center gap-1.5 mb-6">
            {STEPS.map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-all ${
                  i < step ? "text-[#DDE048]" : i === step ? "bg-[#DDE048]/10 border border-[#DDE048]/40 text-[#DDE048]" : "text-[#333]"
                }`}>
                  {i < step ? <Check size={10} strokeWidth={3} /> : null}
                  {label}
                </div>
                {i < STEPS.length - 1 && <div className={`w-4 h-px ${i < step ? "bg-[#DDE048]/30" : "bg-[#1e2230]"}`} />}
              </div>
            ))}
          </div>

          {/* Step 0 — Connect */}
          {step === 0 && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Connect your wallet</h2>
              <p className="text-[#555] text-xs text-center mb-6">Your wallet address is your identity on RemitSafe.</p>
              <MetaMaskGate>{null}</MetaMaskGate>
            </div>
          )}

          {/* Step 1 — Choose role */}
          {step === 1 && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Who are you?</h2>
              <p className="text-[#555] text-xs text-center mb-5">This is permanent and tied to your wallet.</p>

              <div className="space-y-2.5 mb-5">
                {([
                  { role: "sender" as Role, Icon: PlaneTakeoff, title: "OFW / Sender", sub: "I'm sending money to the Philippines" },
                  { role: "merchant" as Role, Icon: Store, title: "Merchant", sub: "I'm a business receiving remittances" },
                ] as { role: Role; Icon: React.ElementType; title: string; sub: string }[]).map(({ role, Icon, title, sub }) => (
                  <button
                    key={role}
                    onClick={() => setSelected(role)}
                    className={`w-full flex items-center gap-3.5 p-4 rounded-xl border-2 text-left transition-all ${
                      selected === role ? "border-[#DDE048] bg-[#DDE048]/5" : "border-[#1e2230] hover:border-[#2a2d36]"
                    }`}
                  >
                    <Icon size={22} color="#DDE048" className="shrink-0" />
                    <div className="flex-1">
                      <div className={`font-bold text-sm ${selected === role ? "text-white" : "text-[#888]"}`}>{title}</div>
                      <div className="text-[11px] text-[#555] mt-0.5">{sub}</div>
                    </div>
                    <div className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${
                      selected === role ? "border-[#DDE048] bg-[#DDE048]" : "border-[#333]"
                    }`}>
                      {selected === role && <Check size={9} color="black" strokeWidth={3} />}
                    </div>
                  </button>
                ))}
              </div>

              <button
                disabled={!selected}
                onClick={() => setStep(2)}
                className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Continue <ArrowRight size={14} />
              </button>
            </div>
          )}

          {/* Step 2 — Confirm */}
          {step === 2 && (
            <div>
              <h2 className="text-lg font-extrabold text-white mb-1 text-center">Almost done</h2>
              <p className="text-[#555] text-xs text-center mb-5">Add a name so others can identify you.</p>

              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl px-3.5 py-3 flex items-center gap-2.5 mb-4">
                <span className="w-2 h-2 rounded-full bg-green-400 shrink-0" />
                <span className="font-mono text-xs text-[#888] truncate">{account}</span>
              </div>

              <div className="mb-4">
                <input
                  autoFocus
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleContinue()}
                  placeholder={selected === "merchant" ? "Business name (optional)" : "Your name (optional)"}
                  className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/50 placeholder:text-[#333] transition-colors"
                />
              </div>

              {error && (
                <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-3.5 py-2.5 mb-4">
                  {error}
                </div>
              )}

              <button
                onClick={handleContinue}
                disabled={saving}
                className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors disabled:opacity-50"
              >
                {saving ? <><Loader size={14} className="animate-spin" /> Setting up…</> : <>Get started <ArrowRight size={14} /></>}
              </button>

              <button onClick={() => setSelected(null)} className="w-full text-[#444] text-xs mt-3 hover:text-[#666] transition-colors">
                ← Change role
              </button>
            </div>
          )}
        </div>

        <p className="text-[#2a2d36] text-[11px] text-center mt-5">
          Powered by Morph L2 · Secured by smart contracts
        </p>
      </div>
    </div>
  );
}

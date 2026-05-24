"use client";
import Image from "next/image";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, Store, ArrowRight, Loader } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { createUser, Role } from "../../lib/supabase";

export default function Onboarding() {
  const { account, connect, walletLoading } = useWallet();
  const router = useRouter();
  const [selected, setSelected] = useState<Role | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

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

  return (
    <div className="min-h-screen bg-[#0e1014] flex flex-col items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <Image src="/logo.png" alt="RemitSafe" width={56} height={56} style={{ objectFit: "contain" }} />
        </div>

        <h1 className="text-3xl font-extrabold text-white text-center mb-2">Welcome to RemitSafe</h1>
        <p className="text-[#555] text-sm text-center mb-8">How will you be using RemitSafe?</p>

        {/* Connect wallet first if not connected */}
        {!account ? (
          <div className="text-center">
            <p className="text-[#555] text-sm mb-5">Connect your wallet to get started.</p>
            <button
              onClick={connect}
              disabled={walletLoading}
              className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-4 text-base disabled:opacity-50"
            >
              {walletLoading ? "Connecting…" : "Connect MetaMask"}
            </button>
          </div>
        ) : (
          <>
            {/* Role cards */}
            <div className="grid grid-cols-2 gap-4 mb-6">
              <RoleCard
                Icon={Send}
                title="OFW / Sender"
                description="I'm sending money to merchants in the Philippines"
                selected={selected === "sender"}
                onSelect={() => setSelected("sender")}
              />
              <RoleCard
                Icon={Store}
                title="Merchant"
                description="I'm a business in the Philippines receiving remittances"
                selected={selected === "merchant"}
                onSelect={() => setSelected("merchant")}
              />
            </div>

            {/* Optional name */}
            {selected && (
              <div className="mb-6">
                <label className="text-[11px] text-[#555] tracking-[1.5px] block mb-2">
                  {selected === "merchant" ? "BUSINESS NAME (optional)" : "YOUR NAME (optional)"}
                </label>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={selected === "merchant" ? "e.g. Santos General Store" : "e.g. Juan dela Cruz"}
                  className="w-full bg-[#13161c] border border-[#1e2230] rounded-xl px-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/50 placeholder:text-[#444]"
                />
              </div>
            )}

            {error && <p className="text-red-400 text-sm text-center mb-4">{error}</p>}

            <button
              onClick={handleContinue}
              disabled={!selected || saving}
              className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-4 text-base flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[#c8ce30] transition-colors"
            >
              {saving ? <><Loader size={16} className="animate-spin" /> Setting up…</> : <>Continue <ArrowRight size={16} /></>}
            </button>

            <p className="text-[#333] text-xs text-center mt-4">
              Your role is permanent and tied to your wallet address.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function RoleCard({ Icon, title, description, selected, onSelect }: {
  Icon: React.ElementType;
  title: string;
  description: string;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={`text-left p-5 rounded-2xl border-2 transition-all ${
        selected
          ? "border-[#DDE048] bg-[#DDE048]/5"
          : "border-[#1e2230] bg-[#13161c] hover:border-[#333]"
      }`}
    >
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${selected ? "bg-[#DDE048]/20" : "bg-[#1e2230]"}`}>
        <Icon size={20} color={selected ? "#DDE048" : "#555"} />
      </div>
      <div className={`font-bold text-sm mb-1.5 ${selected ? "text-white" : "text-[#888]"}`}>{title}</div>
      <div className="text-xs text-[#555] leading-relaxed">{description}</div>
    </button>
  );
}

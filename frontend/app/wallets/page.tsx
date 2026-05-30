"use client";
import { useState } from "react";
import { Copy, Star, Trash2, Plus, AlertTriangle, Loader2, Check, ArrowLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import Header from "../../components/Header";
import { useWallet } from "../../context/WalletContext";

function isUserRejection(e: unknown): boolean {
  const msg = (e as Error)?.message ?? "";
  const code = (e as { code?: string | number })?.code;
  return (
    code === 4001 ||
    code === "ACTION_REJECTED" ||
    msg.includes("user rejected") ||
    msg.includes("User denied") ||
    msg.includes("ACTION_REJECTED")
  );
}

export default function WalletsPage() {
  const {
    activeWallet,
    linkedWallets,
    accountId,
    connect,
    linkActiveWallet,
    unlinkWallet,
    error,
    walletLoading,
  } = useWallet();

  const [linking, setLinking] = useState(false);
  const [removingAddress, setRemovingAddress] = useState<string | null>(null);
  const [settingPrimary, setSettingPrimary] = useState<string | null>(null);
  const [panicConfirm, setPanicConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [localSuccess, setLocalSuccess] = useState<string | null>(null);
  const { pledgeWrite, refreshLinkedWallets } = useWallet();

  function copyAccountId() {
    if (!accountId) return;
    navigator.clipboard.writeText(accountId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  async function handleLinkWallet() {
    setLinking(true);
    setLocalError(null);
    try {
      if (!activeWallet) await connect();
      await linkActiveWallet();
      setLocalSuccess("Wallet linked successfully!");
      setTimeout(() => setLocalSuccess(null), 4000);
    } catch (e: unknown) {
      if (isUserRejection(e)) {
        setLocalError("Transaction cancelled — wallet was not linked.");
      } else {
        setLocalError((e as Error).message || "Failed to link wallet.");
      }
    } finally {
      setLinking(false);
    }
  }

  async function handleSetPrimary(address: string) {
    setSettingPrimary(address);
    setLocalError(null);
    try {
      const res = await fetch("/api/wallet/set-primary", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address }),
      });
      if (!res.ok) {
        const { error: e } = await res.json() as { error: string };
        setLocalError(e);
        return;
      }
      await refreshLinkedWallets();
    } finally {
      setSettingPrimary(null);
    }
  }

  async function handleRemove(address: string) {
    if (!window.confirm(`Remove ${address.slice(0, 10)}…${address.slice(-8)}? You will need to sign a message.`)) return;
    setRemovingAddress(address);
    setLocalError(null);
    try {
      await unlinkWallet(address);
      setLocalSuccess("Wallet removed.");
      setTimeout(() => setLocalSuccess(null), 3000);
    } catch (e: unknown) {
      if (isUserRejection(e)) {
        setLocalError("Cancelled — wallet was not removed.");
      } else {
        setLocalError((e as Error).message || "Failed to remove wallet.");
      }
    } finally {
      setRemovingAddress(null);
    }
  }

  async function handlePanicUnlink() {
    if (!pledgeWrite || !activeWallet) return;
    try {
      const tx = await pledgeWrite.panicUnlink();
      await tx.wait();
      await refreshLinkedWallets();
      setPanicConfirm(false);
      setLocalSuccess("Panic unlink complete — all wallets except the current one have been unlinked.");
    } catch (e: unknown) {
      setPanicConfirm(false);
      if (isUserRejection(e)) {
        setLocalError("Transaction cancelled — no wallets were unlinked.");
      } else {
        setLocalError((e as Error).message);
      }
    }
  }

  if (walletLoading) {
    return (
      <div className="flex items-center justify-center min-h-[80vh]">
        <Loader2 className="animate-spin text-[#DDE048]" size={32} />
      </div>
    );
  }

  return (
    <div>
      <div className="md:hidden">
      <Header title="My Wallets" back />
      <div className="px-4 pt-5 pb-24 space-y-4">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1.5 text-[12px] text-[#555]">
          <Link href="/wallet" className="hover:text-[#888] transition-colors flex items-center gap-1">
            <ArrowLeft size={12} /> Wallet
          </Link>
          <ChevronRight size={11} color="#333" />
          <span className="text-[#888]">Linked wallets</span>
        </div>

        {/* Account ID */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">YOUR ACCOUNT ID</div>
          <div className="font-mono text-xs text-[#ccc] break-all mb-2">{accountId ?? "—"}</div>
          <button
            onClick={copyAccountId}
            className="flex items-center gap-1.5 text-[#DDE048] text-xs font-semibold"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {/* Alerts */}
        {(localError ?? error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm">
            {localError ?? error}
          </div>
        )}
        {localSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm">
            {localSuccess}
          </div>
        )}

        {/* Wallet list */}
        <div className="space-y-3">
          <div className="text-[10px] text-[#888] tracking-[1.5px]">
            LINKED WALLETS ({linkedWallets.length})
          </div>
          {linkedWallets.length === 0 && (
            <div className="text-[#555] text-sm text-center py-6">
              No wallets linked yet. Add your first wallet below.
            </div>
          )}
          {linkedWallets.map(w => (
            <div
              key={w.address}
              className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 mb-1">
                    {w.isPrimary && <Star size={12} className="text-[#DDE048] fill-[#DDE048] shrink-0" />}
                    <span className="font-mono text-sm text-white">
                      {w.address.slice(0, 10)}…{w.address.slice(-8)}
                    </span>
                    {w.address.toLowerCase() === activeWallet?.toLowerCase() && (
                      <span className="text-[10px] text-green-400 font-semibold">Active</span>
                    )}
                  </div>
                  {w.isPrimary && (
                    <span className="text-[10px] text-[#DDE048] font-semibold">Primary</span>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {!w.isPrimary && (
                    <button
                      onClick={() => handleSetPrimary(w.address)}
                      disabled={settingPrimary === w.address}
                      className="text-[10px] text-[#555] hover:text-[#DDE048] font-semibold transition-colors disabled:opacity-50"
                    >
                      {settingPrimary === w.address ? (
                        <Loader2 size={12} className="animate-spin" />
                      ) : (
                        "Set primary"
                      )}
                    </button>
                  )}
                  {!w.isPrimary && (
                    <button
                      onClick={() => handleRemove(w.address)}
                      disabled={removingAddress === w.address}
                      className="text-red-400/60 hover:text-red-400 transition-colors disabled:opacity-50"
                    >
                      {removingAddress === w.address ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <Trash2 size={14} />
                      )}
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Add wallet */}
        <button
          onClick={handleLinkWallet}
          disabled={linking}
          className="w-full flex items-center justify-center gap-2 bg-[#DDE048] text-black font-bold rounded-2xl py-4 text-sm disabled:opacity-50"
        >
          {linking ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
          {linking ? "Linking…" : "Add Wallet"}
        </button>

        {/* Panic unlink */}
        {linkedWallets.length > 0 && (
          <>
            {!panicConfirm ? (
              <button
                onClick={() => setPanicConfirm(true)}
                className="w-full flex items-center justify-center gap-2 border border-red-500/30 text-red-400 font-semibold rounded-2xl py-4 text-sm hover:border-red-500/60 transition-colors"
              >
                <AlertTriangle size={15} />
                Panic Unlink
              </button>
            ) : (
              <div className="bg-red-500/10 border border-red-500/40 rounded-2xl p-4 space-y-3">
                <div className="text-red-400 font-bold text-sm">Confirm Panic Unlink</div>
                <p className="text-[#888] text-xs leading-relaxed">
                  This will immediately unlink ALL wallets except the one currently connected to MetaMask. Any pending withdrawals from those wallets will be cancelled.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={handlePanicUnlink}
                    className="flex-1 bg-red-500 text-white font-bold rounded-xl py-3 text-sm"
                  >
                    Confirm
                  </button>
                  <button
                    onClick={() => setPanicConfirm(false)}
                    className="flex-1 border border-[#333] text-[#888] font-semibold rounded-xl py-3 text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
      </div>{/* end md:hidden */}

      {/* Desktop layout */}
      <div className="hidden md:block p-8">
        {/* Breadcrumb — flush to the left corner beside the sidebar */}
        <div className="flex items-center gap-2 text-[13px] text-[#555] mb-6">
          <Link href="/wallet" className="hover:text-[#888] transition-colors flex items-center gap-1">
            <ArrowLeft size={14} /> Wallet
          </Link>
          <ChevronRight size={13} color="#333" />
          <span className="text-[#888]">Linked wallets</span>
        </div>
        <div className="max-w-2xl mx-auto">
        <h1 className="text-3xl font-extrabold text-white mb-2">My Wallets</h1>
        <p className="text-[#555] text-sm mb-8">Manage the wallets linked to your RemitSafe account.</p>

        {/* Account ID */}
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 mb-6">
          <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">ACCOUNT ID</div>
          <div className="font-mono text-sm text-[#ccc] break-all mb-3">{accountId ?? "—"}</div>
          <button
            onClick={copyAccountId}
            className="flex items-center gap-1.5 text-[#DDE048] text-xs font-semibold"
          >
            {copied ? <Check size={13} /> : <Copy size={13} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>

        {(localError ?? error) && (
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-3 text-red-400 text-sm mb-4">
            {localError ?? error}
          </div>
        )}
        {localSuccess && (
          <div className="bg-green-500/10 border border-green-500/30 rounded-xl px-4 py-3 text-green-400 text-sm mb-4">
            {localSuccess}
          </div>
        )}

        <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">
          LINKED WALLETS ({linkedWallets.length})
        </div>
        <div className="space-y-3 mb-6">
          {linkedWallets.map(w => (
            <div key={w.address} className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-5 py-4 flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {w.isPrimary && <Star size={14} className="text-[#DDE048] fill-[#DDE048] shrink-0" />}
                <div>
                  <div className="font-mono text-sm text-white">
                    {w.address.slice(0, 14)}…{w.address.slice(-12)}
                    {w.address.toLowerCase() === activeWallet?.toLowerCase() && (
                      <span className="ml-2 text-[10px] text-green-400 font-semibold">Active</span>
                    )}
                  </div>
                  {w.isPrimary && <div className="text-[11px] text-[#DDE048] font-semibold mt-0.5">Primary</div>}
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                {!w.isPrimary && (
                  <button
                    onClick={() => handleSetPrimary(w.address)}
                    disabled={settingPrimary === w.address}
                    className="text-xs text-[#555] hover:text-[#DDE048] font-semibold transition-colors disabled:opacity-50"
                  >
                    {settingPrimary === w.address ? <Loader2 size={12} className="animate-spin" /> : "Set primary"}
                  </button>
                )}
                {!w.isPrimary && (
                  <button
                    onClick={() => handleRemove(w.address)}
                    disabled={removingAddress === w.address}
                    className="text-red-400/60 hover:text-red-400 transition-colors"
                  >
                    {removingAddress === w.address ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {linkedWallets.length === 0 && (
            <div className="text-[#555] text-sm text-center py-8">No wallets linked yet.</div>
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleLinkWallet}
            disabled={linking}
            className="flex items-center gap-2 bg-[#DDE048] text-black font-bold rounded-xl px-6 py-3 text-sm disabled:opacity-50"
          >
            {linking ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {linking ? "Linking…" : "Add Wallet"}
          </button>
          {linkedWallets.length > 0 && (
            <button
              onClick={() => setPanicConfirm(true)}
              className="flex items-center gap-2 border border-red-500/30 text-red-400 font-semibold rounded-xl px-6 py-3 text-sm hover:border-red-500/60 transition-colors"
            >
              <AlertTriangle size={14} />
              Panic Unlink
            </button>
          )}
        </div>

        {panicConfirm && (
          <div className="mt-4 bg-red-500/10 border border-red-500/40 rounded-2xl p-5 space-y-3 max-w-md">
            <div className="text-red-400 font-bold">Confirm Panic Unlink</div>
            <p className="text-[#888] text-sm leading-relaxed">
              This will unlink ALL wallets except the currently active one. Pending withdrawals from those wallets will be cancelled on-chain.
            </p>
            <div className="flex gap-3">
              <button onClick={handlePanicUnlink} className="bg-red-500 text-white font-bold rounded-xl px-5 py-2.5 text-sm">Confirm</button>
              <button onClick={() => setPanicConfirm(false)} className="border border-[#333] text-[#888] font-semibold rounded-xl px-5 py-2.5 text-sm">Cancel</button>
            </div>
          </div>
        )}
        </div>{/* end centered content */}
      </div>
    </div>
  );
}

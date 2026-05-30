"use client";
import Header from "../../components/Header";
import LoadingSpinner from "../../components/LoadingSpinner";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { Copy, LogOut, ShieldCheck, ShieldX, ArrowRight, Users, BadgeCheck, Store, FileText, Info, X, Pencil, Check, Loader2, Phone, MapPin } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { useRole } from "../../context/RoleContext";
import { UserProfile, uploadAvatar } from "../../lib/supabase";
import CircularScore from "../../components/CircularScore";
import { useCurrency } from "../../context/CurrencyContext";

interface RepState { score: number; onTime: number; late: number; defaults: number; total: number; }
interface SenderCounts { pending: number; completed: number; defaulted: number; cancelled: number; }
interface MerchantCounts { pending: number; completed: number; defaulted: number; totalReceived: number; }

export default function Profile() {
  const { account, connect, confirmWallet, disconnect, walletVerified, error: walletError, pledgeRead, usdcRead, usdtRead, walletLoading, accountId } = useWallet();
  const { role, displayName, setDisplayName, setAvatarUrl } = useRole();
  const { fmt } = useCurrency();
  const isMerchant = role === "merchant";

  const [rep, setRep] = useState<RepState | null>(null);
  const [showTrustTooltip, setShowTrustTooltip] = useState(false);
  const [usdcBal, setUsdcBal] = useState<string | null>(null);
  const [usdtBal, setUsdtBal] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [accountIdCopied, setAccountIdCopied] = useState(false);

  // Profile card state
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [kycStatus, setKycStatus] = useState<string | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [avatarCacheBust, setAvatarCacheBust] = useState(Date.now());

  // Sender-only state
  const [maxActive, setMaxActive] = useState<number | null>(null);
  const [reqPct, setReqPct] = useState<number | null>(null);
  const [activePledges, setActivePledges] = useState<number>(0);
  const [senderCounts, setSenderCounts] = useState<SenderCounts | null>(null);

  // Merchant-only state
  const [merchantCounts, setMerchantCounts] = useState<MerchantCounts | null>(null);

  useEffect(() => {
    if (account && accountId) {
      loadAll();
      fetch("/api/auth/me")
        .then(r => r.ok ? r.json() : null)
        .then(me => {
          if (!me) return;
          if (me.kycStatus) setKycStatus(me.kycStatus);
          fetch(`/api/profile`)
            .then(r => r.ok ? r.json() : null)
            .then(data => { if (data) setProfile(data); });
        });
    }
  }, [account, accountId, role]);

  async function loadAll() {
    const [repData, trustScore, uBal, tBal] = await Promise.all([
      accountId ? pledgeRead.getAccountReputation(accountId).catch(() => null) : Promise.resolve(null),
      accountId ? pledgeRead.getAccountTrustScore(accountId).catch(() => null) : Promise.resolve(null),
      usdcRead.balanceOf(account),
      usdtRead.balanceOf(account),
    ]);
    setRep({
      score: trustScore !== null
        ? Math.round(Number(trustScore) / 100)
        : repData ? Math.round(Number(repData.basisPoints) / 100) : 0,
      onTime: Number(repData?.onTimeCount ?? 0),
      late: Number(repData?.lateCount ?? 0),
      defaults: Number(repData?.defaultCount ?? 0),
      total: Number(repData?.totalCount ?? 0),
    });
    setUsdcBal(ethers.formatUnits(uBal, 6));
    setUsdtBal(ethers.formatUnits(tBal, 6));

    if (isMerchant) {
      const ids = await pledgeRead.getAccountMerchantPledges(accountId) as bigint[];
      const pledgeList = await Promise.all(ids.map((id) => pledgeRead.getPledge(id))) as { status: number; totalAmount: bigint }[];
      let pending = 0, completed = 0, defaulted = 0, totalReceived = 0;
      for (const p of pledgeList) {
        const s = Number(p.status);
        if (s === 0) pending++;
        else if (s === 1) { completed++; totalReceived += parseFloat(ethers.formatUnits(p.totalAmount, 6)); }
        else if (s === 2) defaulted++;
      }
      setMerchantCounts({ pending, completed, defaulted, totalReceived });
    } else {
      const [max, pct, ids] = await Promise.all([
        pledgeRead.getAccountMaxActivePledges(accountId),
        pledgeRead.getAccountRequiredDepositPct(accountId),
        pledgeRead.getAccountPayerPledges(accountId),
      ]);
      setMaxActive(Number(max));
      setReqPct(Number(pct));
      const pledgeList = await Promise.all((ids as bigint[]).map((id) => pledgeRead.getPledge(id)));
      const c = { pending: 0, completed: 0, defaulted: 0, cancelled: 0 };
      for (const p of pledgeList as { status: number }[]) {
        if (Number(p.status) === 0) c.pending++;
        else if (Number(p.status) === 1) c.completed++;
        else if (Number(p.status) === 2) c.defaulted++;
        else if (Number(p.status) === 3) c.cancelled++;
      }
      setActivePledges(c.pending);
      setSenderCounts(c);
    }
  }

  function copyAccountId() {
    if (!profile?.id) return;
    navigator.clipboard.writeText(profile.id);
    setAccountIdCopied(true);
    setTimeout(() => setAccountIdCopied(false), 2000);
  }

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function startEdit(field: string, current: string | null) {
    setEditingField(field);
    setEditValue(current ?? "");
  }

  async function saveEdit(field: string) {
    if (!account) return;
    setSaving(true);
    const res = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: editValue || null }),
    });
    if (res.ok) {
      const updated = await res.json();
      setProfile(updated);
      if (field === "name") setDisplayName(editValue || null);
    }
    setSaving(false);
    setEditingField(null);
  }

  async function handleAvatarFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !account) return;
    setAvatarUploading(true);
    const publicUrl = await uploadAvatar(account, file);
    if (publicUrl) {
      // Show image immediately everywhere
      setProfile(prev => prev ? { ...prev, avatar_url: publicUrl } : prev);
      setAvatarUrl(publicUrl);
      setAvatarCacheBust(Date.now());
      // Persist to DB
      const res = await fetch("/api/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatar_url: publicUrl }),
      });
      if (!res.ok) console.error("Failed to save avatar_url", await res.text());
    }
    setAvatarUploading(false);
    e.target.value = "";
  }

  const scoreLabel = (s: number) => s >= 80 ? "EXCELLENT" : s >= 50 ? "GOOD" : s >= 20 ? "FAIR" : "POOR";
  const scoreBg = (s: number) => s >= 80 ? "#22c55e" : s >= 50 ? "#DDE048" : s >= 20 ? "#f59e0b" : "#ef4444";

  if (walletLoading) return <LoadingSpinner fullScreen />;

  if (!account || !walletVerified) {
    const isConfirmStep = !!account && !walletVerified;
    const heading = isConfirmStep ? "Confirm your wallet" : "Your Profile";
    const sub = isConfirmStep
      ? "Sign a quick message in MetaMask to verify wallet ownership. No gas required."
      : "Connect your wallet to view your profile";
    const btnLabel = isConfirmStep ? "Sign MetaMask Confirmation" : "Connect MetaMask";
    const btnAction = isConfirmStep ? confirmWallet : connect;

    return (
      <>
        {/* Desktop */}
        <div className="hidden md:flex flex-col items-center justify-center min-h-[80vh] gap-5">
          <Image src="/logo.png" alt="RemitSafe" width={80} height={80} priority style={{ objectFit: "contain" }} />
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white mb-2">{heading}</h2>
            <p className="text-[#555] text-sm max-w-xs">{sub}</p>
          </div>
          {isConfirmStep && (
            <div className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] rounded-xl px-4 py-2.5">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-[#888] font-mono">{account.slice(0, 10)}…{account.slice(-8)}</span>
            </div>
          )}
          {walletError && <p className="text-red-400 text-xs text-center max-w-xs">{walletError}</p>}
          <button className="bg-[#DDE048] text-black font-bold rounded-xl px-10 py-3 text-sm" onClick={btnAction}>{btnLabel}</button>
          {isConfirmStep && (
            <button onClick={disconnect} className="text-xs text-[#555] hover:text-[#888] transition-colors">Use a different wallet</button>
          )}
        </div>

        {/* Mobile */}
        <div className="md:hidden flex flex-col items-center justify-center min-h-screen p-8">
          <Image src="/logo.png" alt="RemitSafe" width={80} height={80} priority style={{ objectFit: "contain", marginBottom: 24 }} />
          <h2 className="text-2xl font-bold mb-2.5">{heading}</h2>
          <p className="text-[#888] mb-6 text-sm leading-relaxed max-w-[280px] text-center">{sub}</p>
          {isConfirmStep && (
            <div className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] rounded-xl px-4 py-2.5 mb-4">
              <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
              <span className="text-xs text-[#888] font-mono">{account!.slice(0, 10)}…{account!.slice(-8)}</span>
            </div>
          )}
          {walletError && <p className="text-red-400 text-xs text-center max-w-[280px] mb-4">{walletError}</p>}
          <button className="bg-[#DDE048] text-black border-0 rounded-[14px] px-12 py-4 text-base font-bold cursor-pointer mb-4" onClick={btnAction}>{btnLabel}</button>
          {isConfirmStep && (
            <button onClick={disconnect} className="text-xs text-[#555]">Use a different wallet</button>
          )}
        </div>
      </>
    );
  }

  /* ── DESKTOP ── */
  const DesktopProfile = (
    <div className="hidden md:block p-8">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-3xl font-extrabold text-white mb-1">
            {isMerchant ? "Merchant Profile" : "Profile · Trust"}
          </h1>
          <p className="text-[#555] text-sm">
            {isMerchant ? "Your merchant identity and incoming transfer stats." : "Your on-chain reputation and transfer limits."}
          </p>
        </div>
        <button
          onClick={disconnect}
          className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] text-red-400 text-sm font-semibold rounded-xl px-4 py-2.5 hover:border-red-500/30 transition-colors"
        >
          <LogOut size={14} /> Disconnect
        </button>
      </div>

      <div className="grid grid-cols-[1fr_320px] gap-6">
        {/* Left column */}
        <div className="space-y-5">
          {/* Profile card */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
            {/* Top banner with avatar */}
            <div className="bg-gradient-to-r from-[#1a1d24] to-[#13161c] px-6 pt-6 pb-5 flex items-center gap-4 border-b border-[#1e2230]">
              <div className="relative shrink-0">
                <input ref={avatarInputRef} type="file" accept="image/*" className="hidden" onChange={handleAvatarFileChange} />
                <button
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={avatarUploading}
                  className="w-[60px] h-[60px] rounded-2xl overflow-hidden bg-[#1e2230] border-2 border-[#2a2f3d] flex items-center justify-center hover:border-[#DDE048]/40 transition-colors group disabled:opacity-60"
                >
                  {profile?.avatar_url ? (
                    <img src={`${profile.avatar_url}?t=${avatarCacheBust}`} alt="avatar" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-2xl font-extrabold text-[#DDE048]">
                      {(profile?.name ?? displayName ?? account)?.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <span className="absolute inset-0 bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-2xl">
                    {avatarUploading ? <Loader2 size={14} className="text-white animate-spin" /> : <Pencil size={13} className="text-white" />}
                  </span>
                </button>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-white font-bold text-base leading-tight truncate">
                    {profile?.name ?? displayName ?? "Unnamed"}
                  </span>
                  {/* Verification pill */}
                  {kycStatus === "verified" ? (
                    <span className="inline-flex items-center gap-1 text-[#DDE048] text-[11px] font-semibold">
                      {isMerchant ? <Store size={11} /> : <BadgeCheck size={11} />}
                      {isMerchant ? "Verified Merchant" : "Verified OFW"}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[#ef4444] text-[11px] font-semibold">
                      <ShieldX size={11} /> Not Verified
                    </span>
                  )}
                </div>
                <div className="text-[#555] text-xs mt-1 font-mono truncate">{account.slice(0, 10)}…{account.slice(-8)}</div>
              </div>
            </div>
            {/* Editable fields */}
            <div className="px-6 py-4 space-y-2.5">
              <InlineField
                field="name"
                value={profile?.name ?? null}
                placeholder="Add your name"
                editingField={editingField}
                editValue={editValue}
                saving={saving}
                onEdit={startEdit}
                onSave={saveEdit}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
              />
              <InlineField
                field="bio"
                value={profile?.bio ?? null}
                placeholder="Add a short bio"
                multiline
                editingField={editingField}
                editValue={editValue}
                saving={saving}
                onEdit={startEdit}
                onSave={saveEdit}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
              />
              <InlineField
                field="phone"
                value={profile?.phone ?? null}
                placeholder="Add phone number"
                editingField={editingField}
                editValue={editValue}
                saving={saving}
                onEdit={startEdit}
                onSave={saveEdit}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
                icon={<Phone size={13} />}
              />
              <InlineField
                field="country"
                value={profile?.country ?? null}
                placeholder="Add country"
                editingField={editingField}
                editValue={editValue}
                saving={saving}
                onEdit={startEdit}
                onSave={saveEdit}
                onCancel={() => setEditingField(null)}
                onEditValueChange={setEditValue}
                icon={<MapPin size={13} />}
              />
            </div>
          </div>
          {/* Identity hero */}
          <div className="bg-gradient-to-r from-[#1B1E16] to-[#13161c] border border-[#1e2230] rounded-2xl p-7 relative overflow-hidden">
            <Image src="/logo.png" alt="" width={120} height={120}
              style={{ position: "absolute", right: 24, top: "50%", transform: "translateY(-50%)", opacity: 0.05, filter: "grayscale(1)", objectFit: "contain", pointerEvents: "none" }}
            />
            <div className="flex items-center gap-8 relative">
              {rep && <CircularScore score={rep.score} size={120} />}
              <div>
                <div className="flex items-center gap-1.5 mb-3">
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">
                    {isMerchant ? "MERCHANT RATING" : "TRUST SCORE"}
                  </div>
                  {!isMerchant && (
                    <button onClick={() => setShowTrustTooltip(true)} className="text-[#555] hover:text-[#888] transition-colors">
                      <Info size={12} />
                    </button>
                  )}
                </div>
                {rep && (
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-sm font-bold px-3 py-1 rounded-full" style={{ color: scoreBg(rep.score), background: scoreBg(rep.score) + "22" }}>
                      {scoreLabel(rep.score)}
                    </span>
                  </div>
                )}
                <div className="text-[#555] text-xs font-mono">{account.slice(0, 14)}…{account.slice(-12)}</div>
                <button onClick={copyAddress} className="flex items-center gap-1.5 mt-1.5 text-[#555] text-xs hover:text-[#888] transition-colors">
                  <Copy size={11} /> {copied ? <span className="text-[#DDE048]">Copied!</span> : "Copy address"}
                </button>
                {profile?.id && (
                  <div className="mt-3 pt-3 border-t border-[#1e2230]">
                    <div className="text-[10px] text-[#555] tracking-[1px] mb-1">ACCOUNT ID</div>
                    <div className="text-[11px] font-mono text-white break-all leading-tight mb-1.5">{profile.id}</div>
                    <button onClick={copyAccountId} className="flex items-center gap-1.5 text-[#555] text-xs hover:text-[#888] transition-colors">
                      <Copy size={11} /> {accountIdCopied ? <span className="text-[#DDE048]">Copied!</span> : "Copy account ID"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Stats grid */}
          {isMerchant ? (
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="TOKEN BALANCE" value={usdcBal && usdtBal ? `${(parseFloat(usdcBal) + parseFloat(usdtBal)).toFixed(2)}` : "–"} sub={usdcBal && usdtBal ? fmt(parseFloat(usdcBal) + parseFloat(usdtBal)) : undefined} />
              <StatCard label="PENDING TRANSFERS" value={`${merchantCounts?.pending ?? "–"}`} sub="awaiting deposit" highlight />
              <StatCard label="COMPLETED" value={`${merchantCounts?.completed ?? "–"}`} sub="fully fulfilled" />
            </div>
          ) : (
            <div className="grid grid-cols-4 gap-3">
              <StatCard label="TOKEN BALANCE" value={usdcBal && usdtBal ? `${(parseFloat(usdcBal) + parseFloat(usdtBal)).toFixed(2)}` : "–"} sub={usdcBal && usdtBal ? fmt(parseFloat(usdcBal) + parseFloat(usdtBal)) : undefined} />
              <StatCard label="ACTIVE TRANSFERS" value={`${activePledges}`} sub={maxActive !== null ? `of ${maxActive} max` : undefined} highlight />
              <StatCard label="MAX ACTIVE" value={maxActive !== null ? `${maxActive}` : "–"} sub="pledge cap" />
              <StatCard label="DEPOSIT REQUIRED" value={reqPct !== null ? `${reqPct}%` : "–"} sub="upfront" />
            </div>
          )}

          {/* History */}
          {isMerchant ? merchantCounts && (
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="text-[11px] text-[#555] tracking-[1.5px]">INCOMING TRANSFER HISTORY</div>
                <Link href="/merchant/transfers" className="flex items-center gap-1 text-[#DDE048] text-xs font-semibold hover:underline">
                  See all <ArrowRight size={12} />
                </Link>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <HistoryCard label="Pending" value={merchantCounts.pending} color="#f59e0b" />
                <HistoryCard label="Completed" value={merchantCounts.completed} color="#22c55e" />
                <HistoryCard label="Defaulted" value={merchantCounts.defaulted} color="#ef4444" />
              </div>
              <div className="mt-4 bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                <div className="text-[11px] text-[#555] tracking-[1px] mb-1">TOTAL RECEIVED</div>
                <div className="text-2xl font-extrabold text-[#DDE048]">{merchantCounts.totalReceived.toFixed(2)} <span className="text-sm text-[#555] font-normal">tokens</span></div>
                <div className="text-xs text-[#555] mt-0.5">≈ {fmt(merchantCounts.totalReceived)}</div>
              </div>
            </div>
          ) : senderCounts && (
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="flex items-center justify-between mb-5">
                <div className="text-[11px] text-[#555] tracking-[1.5px]">PLEDGE HISTORY</div>
                <Link href="/pledges" className="flex items-center gap-1 text-[#DDE048] text-xs font-semibold hover:underline">
                  See all <ArrowRight size={12} />
                </Link>
              </div>
              <div className="grid grid-cols-4 gap-3">
                <HistoryCard label="Pending" value={senderCounts.pending} color="#f59e0b" />
                <HistoryCard label="Completed" value={senderCounts.completed} color="#22c55e" />
                <HistoryCard label="Defaulted" value={senderCounts.defaulted} color="#ef4444" />
                <HistoryCard label="Cancelled" value={senderCounts.cancelled} color="#888" />
              </div>
            </div>
          )}

          {/* Reputation breakdown */}
          {rep && (
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">REPUTATION BREAKDOWN</div>
              <div className="space-y-0">
                <RepRow label="Total pledges" value={rep.total.toString()} />
                <RepRow label="On-time completions" value={rep.onTime.toString()} color="#22c55e" />
                <RepRow label="Late completions" value={rep.late.toString()} color="#f59e0b" />
                <RepRow label="Defaults" value={rep.defaults.toString()} color="#ef4444" last />
              </div>
            </div>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {isMerchant ? (
            <>
              {/* Merchant quick links */}
              <Link href="/merchant/transfers" className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-5 py-4 flex items-center justify-between hover:border-[#333] transition-colors no-underline text-inherit">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center">
                    <FileText size={16} color="#DDE048" />
                  </div>
                  <div>
                    <div className="font-semibold text-white text-sm">Incoming Transfers</div>
                    <div className="text-[11px] text-[#555]">View all pledges sent to you</div>
                  </div>
                </div>
                <ArrowRight size={16} color="#333" />
              </Link>
              <Link href="/wallet" className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-5 py-4 flex items-center justify-between hover:border-[#333] transition-colors no-underline text-inherit">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center">
                    <ShieldCheck size={16} color="#DDE048" />
                  </div>
                  <div>
                    <div className="font-semibold text-white text-sm">Wallet</div>
                    <div className="text-[11px] text-[#555]">USDC & USDT balance</div>
                  </div>
                </div>
                <ArrowRight size={16} color="#333" />
              </Link>
              {/* How merchant rating works */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">HOW MERCHANT RATING WORKS</div>
                <div className="space-y-3 text-xs text-[#555] leading-relaxed">
                  <p>Your merchant rating is calculated from fulfilled transfers and sender reputation. A higher rating builds sender confidence.</p>
                  <div className="space-y-1.5">
                    <TrustTier score="90–100" label="Excellent" color="#22c55e" desc="Top-tier merchant" />
                    <TrustTier score="75–89" label="Good" color="#DDE048" desc="Trusted merchant" />
                    <TrustTier score="50–74" label="Fair" color="#f59e0b" desc="Growing reputation" />
                    <TrustTier score="0–49" label="Low" color="#ef4444" desc="Needs improvement" />
                  </div>
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Sender limits */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
                <div className="flex items-center gap-2 mb-4">
                  <ShieldCheck size={15} color="#DDE048" />
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">YOUR LIMITS</div>
                </div>
                <div className="space-y-0">
                  <LimitRow label="Max active pledges" value={maxActive !== null ? `${maxActive}` : "–"} />
                  <LimitRow label="Required deposit" value={reqPct !== null ? `${reqPct}% upfront` : "–"} />
                </div>
                <p className="text-[11px] text-[#555] mt-4 leading-relaxed">
                  Limits improve automatically as your trust score rises. Complete pledges on time to increase your score.
                </p>
              </div>
              {/* Recipients shortcut */}
              <Link href="/recipients" className="bg-[#13161c] border border-[#1e2230] rounded-2xl px-5 py-4 flex items-center justify-between hover:border-[#333] transition-colors no-underline text-inherit">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center">
                    <Users size={16} color="#DDE048" />
                  </div>
                  <div>
                    <div className="font-semibold text-white text-sm">Recipients</div>
                    <div className="text-[11px] text-[#555]">Saved merchants & addresses</div>
                  </div>
                </div>
                <ArrowRight size={16} color="#333" />
              </Link>
              {/* How trust works */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">HOW TRUST WORKS</div>
                <div className="space-y-3 text-xs text-[#555] leading-relaxed">
                  <p>Your trust score is calculated on-chain from your pledge history. Higher score = higher active pledge cap and lower required deposit.</p>
                  <div className="space-y-1.5">
                    <TrustTier score="90–100" label="Excellent" color="#22c55e" desc="5 active · 10% deposit" />
                    <TrustTier score="75–89" label="Good" color="#DDE048" desc="3 active · 20% deposit" />
                    <TrustTier score="50–74" label="Fair" color="#f59e0b" desc="2 active · 30% deposit" />
                    <TrustTier score="0–49" label="Low" color="#ef4444" desc="1 active · 50% deposit" />
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );

  /* ── MOBILE ── */
  const MobileProfile = (
    <div className="md:hidden">
      <Header title="Profile" />
      <div className="px-4 pt-5 pb-24">
        <div className="mb-3">
          <div className="text-[#888] text-[13px]">{isMerchant ? "Merchant wallet," : "Your wallet,"}</div>
          <div className="font-bold text-2xl">{account.slice(0, 6)}...{account.slice(-4)}</div>
        </div>
        <div className="inline-flex items-center bg-[#1e1e1e] border border-[#1F2127] rounded-[20px] px-3 py-[5px] text-[13px] text-[#ccc] mb-3 cursor-pointer" onClick={copyAddress}>
          <span>{copied ? "Copied!" : `${account.slice(0, 10)}...${account.slice(-8)}`}</span>
          <Copy size={12} color={copied ? "#DDE048" : "#666"} className="ml-1.5" />
        </div>

        {/* Account ID (UUID) — shareable */}
        {profile?.id && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-3 mb-4">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-1.5">ACCOUNT ID</div>
            <div className="font-mono text-sm text-white break-all leading-snug mb-2">{profile.id}</div>
            <button onClick={copyAccountId} className="flex items-center gap-1.5 text-[#DDE048] text-xs font-semibold">
              <Copy size={12} /> {accountIdCopied ? "Copied!" : "Copy to share"}
            </button>
          </div>
        )}

        {/* Profile card (mobile) */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl overflow-hidden mb-3.5">
          {/* Top banner */}
          <div className="bg-gradient-to-r from-[#161920] to-[#11141A] px-4 pt-4 pb-4 flex items-center gap-3 border-b border-[#1F2127]">
            <button
              onClick={() => avatarInputRef.current?.click()}
              disabled={avatarUploading}
              className="relative w-[52px] h-[52px] rounded-xl overflow-hidden bg-[#1a1a1a] border-2 border-[#2a2a2a] flex items-center justify-center shrink-0 disabled:opacity-60"
            >
              {profile?.avatar_url ? (
                <img src={`${profile.avatar_url}?t=${avatarCacheBust}`} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <span className="text-xl font-extrabold text-[#DDE048]">
                  {(profile?.name ?? displayName ?? account)?.slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="absolute inset-0 bg-black/40 flex items-center justify-center rounded-xl">
                {avatarUploading ? <Loader2 size={12} className="text-white animate-spin" /> : <Pencil size={12} className="text-white opacity-60" />}
              </span>
            </button>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-white font-bold text-sm leading-tight truncate">
                  {profile?.name ?? displayName ?? "Unnamed"}
                </span>
                {kycStatus === "verified" ? (
                  <span className="inline-flex items-center gap-1 text-[#DDE048] text-[10px] font-semibold">
                    {isMerchant ? <Store size={10} /> : <BadgeCheck size={10} />}
                    {isMerchant ? "Verified Merchant" : "Verified OFW"}
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-[#ef4444] text-[10px] font-semibold">
                    <ShieldX size={10} /> Not Verified
                  </span>
                )}
              </div>
              <div className="text-[#555] text-[11px] mt-0.5 font-mono truncate">{account.slice(0, 10)}…{account.slice(-8)}</div>
            </div>
          </div>
          {/* Editable fields */}
          <div className="px-4 py-3 space-y-2">
            <InlineField
              field="name"
              value={profile?.name ?? null}
              placeholder="Add your name"
              editingField={editingField}
              editValue={editValue}
              saving={saving}
              onEdit={startEdit}
              onSave={saveEdit}
              onCancel={() => setEditingField(null)}
              onEditValueChange={setEditValue}
            />
            <InlineField
              field="bio"
              value={profile?.bio ?? null}
              placeholder="Add a short bio"
              multiline
              editingField={editingField}
              editValue={editValue}
              saving={saving}
              onEdit={startEdit}
              onSave={saveEdit}
              onCancel={() => setEditingField(null)}
              onEditValueChange={setEditValue}
            />
            <InlineField
              field="phone"
              value={profile?.phone ?? null}
              placeholder="Phone"
              editingField={editingField}
              editValue={editValue}
              saving={saving}
              onEdit={startEdit}
              onSave={saveEdit}
              onCancel={() => setEditingField(null)}
              onEditValueChange={setEditValue}
              icon={<Phone size={12} />}
            />
            <InlineField
              field="country"
              value={profile?.country ?? null}
              placeholder="Country"
              editingField={editingField}
              editValue={editValue}
              saving={saving}
              onEdit={startEdit}
              onSave={saveEdit}
              onCancel={() => setEditingField(null)}
              onEditValueChange={setEditValue}
              icon={<MapPin size={12} />}
            />
          </div>
        </div>

        {/* Trust score card */}
        <div className="bg-gradient-to-r from-[#1B1E16] to-[#11141A] border border-[#2a2a2a] rounded-2xl p-5 mb-3.5 relative overflow-hidden">
          <Image src="/logo.png" alt="" width={90} height={90}
            style={{ position: "absolute", right: 16, top: "50%", transform: "translateY(-50%)", opacity: 0.06, filter: "grayscale(1)", objectFit: "contain", pointerEvents: "none" }}
          />
          <div className="flex items-center gap-3 relative">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5 mb-1.5">
                <div className="text-[10px] text-[#888] tracking-[1.5px]">
                  {isMerchant ? "MERCHANT RATING" : "TRUST SCORE"}
                </div>
                {!isMerchant && (
                  <button onClick={() => setShowTrustTooltip(true)} className="text-[#555] hover:text-[#888] transition-colors">
                    <Info size={11} />
                  </button>
                )}
              </div>
              <div className="text-[38px] font-extrabold leading-none text-[#DDE048]">
                {rep?.score ?? "–"}<span className="text-base font-normal text-[#888]"> / 100</span>
              </div>
              {rep && <div className="text-[#DDE048] text-[11px] font-bold mt-1.5">{scoreLabel(rep.score)}</div>}
            </div>
            {rep && <div className="shrink-0"><CircularScore score={rep.score} size={80} /></div>}
          </div>
        </div>

        {/* Stats row */}
        {isMerchant ? (
          <div className="flex gap-3 mb-3.5">
            <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">TOKEN BALANCE</div>
              <div className="text-[28px] font-extrabold leading-none">{usdcBal && usdtBal ? (parseFloat(usdcBal) + parseFloat(usdtBal)).toFixed(2) : "–"}</div>
              {usdcBal && usdtBal && <div className="text-[11px] text-[#888] mt-1">{fmt(parseFloat(usdcBal) + parseFloat(usdtBal))}</div>}
            </div>
            <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">PENDING</div>
              <div className="text-[28px] font-extrabold text-[#f59e0b]">{merchantCounts?.pending ?? "–"}</div>
              <div className="text-[10px] text-[#888] mt-1">incoming transfers</div>
            </div>
          </div>
        ) : (
          <div className="flex gap-3 mb-3.5">
            <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">TOKEN BALANCE</div>
              <div className="text-[28px] font-extrabold leading-none">{usdcBal && usdtBal ? (parseFloat(usdcBal) + parseFloat(usdtBal)).toFixed(2) : "–"}</div>
              {usdcBal && usdtBal && <div className="text-[11px] text-[#888] mt-1">{fmt(parseFloat(usdcBal) + parseFloat(usdtBal))}</div>}
            </div>
            <div className="flex-1 bg-[#11141A] border border-[#1F2127] rounded-2xl px-4 py-[14px]">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">ACTIVE CAP</div>
              <div className="text-[28px] font-extrabold">{activePledges}<span className="text-[#888] font-normal text-lg"> / {maxActive ?? "–"}</span></div>
              <div className="h-[3px] bg-[#2a2a2a] rounded mt-2.5">
                <div className="h-full bg-[#DDE048] rounded transition-all" style={{ width: maxActive ? `${(activePledges / maxActive) * 100}%` : "0%" }} />
              </div>
            </div>
          </div>
        )}

        {/* History */}
        {isMerchant ? merchantCounts && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-3.5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px]">TRANSFER HISTORY</div>
              <Link href="/merchant/transfers" className="flex items-center gap-1 text-[#DDE048] text-[13px] font-semibold">See all <ArrowRight size={13} color="#DDE048" /></Link>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <HistoryStat label="Pending" value={merchantCounts.pending} color="#f59e0b" />
              <HistoryStat label="Completed" value={merchantCounts.completed} color="#22c55e" />
              <HistoryStat label="Defaulted" value={merchantCounts.defaulted} color="#ef4444" />
            </div>
            <div className="bg-[#0d0f13] border border-[#1F2127] rounded-xl p-3">
              <div className="text-[10px] text-[#888] mb-1">TOTAL RECEIVED</div>
              <div className="text-xl font-extrabold text-[#DDE048]">{merchantCounts.totalReceived.toFixed(2)} <span className="text-sm text-[#555] font-normal">tokens</span></div>
            </div>
          </div>
        ) : senderCounts && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-3.5">
            <div className="flex items-center justify-between mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px]">PLEDGE HISTORY</div>
              <Link href="/pledges" className="flex items-center gap-1 text-[#DDE048] text-[13px] font-semibold">See all <ArrowRight size={13} color="#DDE048" /></Link>
            </div>
            <div className="grid grid-cols-4 gap-2">
              <HistoryStat label="Pending" value={senderCounts.pending} color="#f59e0b" />
              <HistoryStat label="Completed" value={senderCounts.completed} color="#22c55e" />
              <HistoryStat label="Defaulted" value={senderCounts.defaulted} color="#ef4444" />
              <HistoryStat label="Cancelled" value={senderCounts.cancelled} color="#888" />
            </div>
          </div>
        )}

        {/* Limits (sender only) */}
        {!isMerchant && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
            <div className="flex items-center gap-2 mb-3">
              <ShieldCheck size={15} color="#DDE048" />
              <div className="text-[10px] text-[#888] tracking-[1.5px]">YOUR LIMITS</div>
            </div>
            <div className="flex justify-between py-2.5 border-b border-[#1F2127] text-sm"><span className="text-[#888]">Max active pledges</span><span className="font-extrabold text-[#DDE048]">{maxActive ?? "–"}</span></div>
            <div className="flex justify-between py-2.5 text-sm"><span className="text-[#888]">Required deposit</span><span className="font-extrabold text-[#DDE048]">{reqPct ?? "–"}% upfront</span></div>
          </div>
        )}

        {/* Quick link */}
        {isMerchant ? (
          <Link href="/merchant/transfers" className="w-full bg-[#11141A] border border-[#1F2127] rounded-2xl px-5 py-4 flex items-center justify-between mb-4 no-underline text-inherit">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center"><FileText size={16} color="#DDE048" /></div>
              <div>
                <div className="font-semibold text-sm">Incoming Transfers</div>
                <div className="text-[11px] text-[#555]">View all pledges sent to you</div>
              </div>
            </div>
            <ArrowRight size={16} color="#555" />
          </Link>
        ) : (
          <Link href="/recipients" className="w-full bg-[#11141A] border border-[#1F2127] rounded-2xl px-5 py-4 flex items-center justify-between mb-4 no-underline text-inherit">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-xl bg-[#1a1a1a] border border-[#2a2a2a] flex items-center justify-center"><Users size={16} color="#DDE048" /></div>
              <div>
                <div className="font-semibold text-sm">Recipients</div>
                <div className="text-[11px] text-[#555]">Saved merchants & addresses</div>
              </div>
            </div>
            <ArrowRight size={16} color="#555" />
          </Link>
        )}

        <button type="button" className="w-full bg-[#11141A] border border-[#2a2a2a] text-red-400 rounded-[14px] py-[14px] text-[15px] font-semibold flex items-center justify-center gap-2 cursor-pointer" onClick={disconnect}>
          <LogOut size={15} /> Disconnect Wallet
        </button>
      </div>
    </div>
  );

  const TrustTooltip = showTrustTooltip ? (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={() => setShowTrustTooltip(false)}
    >
      <div
        className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5 w-full max-w-sm shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Info size={13} color="#DDE048" />
            <span className="text-xs font-bold text-white tracking-wide">TRUST SCORE</span>
          </div>
          <button onClick={() => setShowTrustTooltip(false)} className="text-[#555] hover:text-[#888] transition-colors">
            <X size={15} />
          </button>
        </div>
        <div className="space-y-3.5 text-xs leading-relaxed">
          <div>
            <div className="font-semibold text-white mb-0.5">What is it?</div>
            <div className="text-[#888]">A 0–100 on-chain score built entirely from your pledge history. Higher score = lower upfront deposit + more simultaneous pledges allowed.</div>
          </div>
          <div>
            <div className="font-semibold text-white mb-0.5">How does it increase?</div>
            <div className="text-[#888]">Complete pledges on time. Each on-time completion contributes <span className="text-[#22c55e] font-semibold">100% weight</span> to your score average.</div>
            <Link
              href="/help?open=trust-score-improve"
              onClick={() => setShowTrustTooltip(false)}
              className="flex items-center gap-1 mt-1 text-[#DDE048] text-[11px] font-semibold hover:underline no-underline"
            >
              See more <ArrowRight size={11} />
            </Link>
          </div>
          <div>
            <div className="font-semibold text-white mb-0.5">How does it decrease?</div>
            <div className="text-[#888]">
              Paying during the grace period contributes <span className="text-[#f59e0b] font-semibold">70% weight</span> — a slight drop. Defaulting contributes <span className="text-[#ef4444] font-semibold">0% weight</span> — significantly pulling your average down. Larger pledges have more impact than smaller ones.
            </div>
          </div>
          <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-3">
            <div className="space-y-1.5">
              {[
                { range: "90–100", label: "Elite OFW", deposit: "10% deposit · 5 pledges", color: "#22c55e" },
                { range: "80–89", label: "Trusted", deposit: "12% deposit · 4 pledges", color: "#DDE048" },
                { range: "50–79", label: "Good standing", deposit: "15% deposit · 3 pledges", color: "#f59e0b" },
                { range: "0–49", label: "New sender", deposit: "20% deposit · 1 pledge", color: "#ef4444" },
              ].map(({ range, label, deposit, color }) => (
                <div key={range} className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
                    <span className="font-semibold text-[10px]" style={{ color }}>{label}</span>
                  </div>
                  <div className="text-right">
                    <span className="text-[10px] text-[#555]">{range} · {deposit}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
        <Link
          href="/help?open=trust-score-decrease"
          onClick={() => setShowTrustTooltip(false)}
          className="flex items-center justify-end gap-1 mt-4 text-[#DDE048] text-xs font-semibold hover:underline no-underline"
        >
          See more in Help <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  ) : null;

  return (
    <>
      {TrustTooltip}
      {DesktopProfile}
      {MobileProfile}
    </>
  );
}

function StatCard({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
      <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">{label}</div>
      <div className={`text-3xl font-extrabold ${highlight ? "text-[#DDE048]" : "text-white"}`}>{value}</div>
      {sub && <div className="text-xs text-[#555] mt-1">{sub}</div>}
    </div>
  );
}

function HistoryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4 text-center">
      <div className="text-3xl font-extrabold" style={{ color: value > 0 ? color : "#333" }}>{value}</div>
      <div className="text-[10px] text-[#555] mt-1">{label.toUpperCase()}</div>
    </div>
  );
}

function RepRow({ label, value, color, last }: { label: string; value: string; color?: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 text-sm ${last ? "" : "border-b border-[#1e2230]"}`}>
      <span className="text-[#555]">{label}</span>
      <span className="font-bold" style={{ color: color ?? "white" }}>{value}</span>
    </div>
  );
}

function LimitRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-3 text-sm ${last ? "" : "border-b border-[#1e2230]"}`}>
      <span className="text-[#555]">{label}</span>
      <span className="font-extrabold text-[#DDE048]">{value}</span>
    </div>
  );
}

function TrustTier({ score, label, color, desc }: { score: string; label: string; color: string; desc: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: color }} />
        <span style={{ color }} className="font-semibold">{label}</span>
        <span className="text-[#333]">·</span>
        <span>{score}</span>
      </div>
      <span>{desc}</span>
    </div>
  );
}

function HistoryStat({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="bg-[#0d0f13] border border-[#1F2127] rounded-xl px-3 py-3 flex flex-col gap-1">
      <div className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color: value > 0 ? color : "#333" }}>{value}</div>
      <div className="text-[10px] text-[#555] leading-tight">{label}</div>
    </div>
  );
}

interface InlineFieldProps {
  field: string;
  value: string | null;
  placeholder: string;
  multiline?: boolean;
  editingField: string | null;
  editValue: string;
  saving: boolean;
  onEdit: (field: string, current: string | null) => void;
  onSave: (field: string) => void;
  onCancel: () => void;
  onEditValueChange: (v: string) => void;
  icon?: React.ReactNode;
}

function InlineField({ field, value, placeholder, multiline, editingField, editValue, saving, onEdit, onSave, onCancel, onEditValueChange, icon }: InlineFieldProps) {
  const isEditing = editingField === field;
  return (
    <div className="group flex items-start gap-2 min-h-[24px]">
      {icon && <span className="mt-0.5 shrink-0 text-[#555]">{icon}</span>}
      {isEditing ? (
        <div className="flex-1 flex items-start gap-1.5">
          {multiline ? (
            <textarea
              autoFocus
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              placeholder={placeholder}
              rows={3}
              className="flex-1 bg-[#0e1014] border border-[#DDE048]/40 rounded-lg px-2.5 py-1.5 text-sm text-white resize-none outline-none focus:border-[#DDE048]/70 placeholder:text-[#444]"
            />
          ) : (
            <input
              autoFocus
              value={editValue}
              onChange={e => onEditValueChange(e.target.value)}
              placeholder={placeholder}
              className="flex-1 bg-[#0e1014] border border-[#DDE048]/40 rounded-lg px-2.5 py-1 text-sm text-white outline-none focus:border-[#DDE048]/70 placeholder:text-[#444]"
            />
          )}
          {saving ? (
            <Loader2 size={16} className="animate-spin text-[#DDE048] mt-1.5 shrink-0" />
          ) : (
            <>
              <button onClick={() => onSave(field)} className="mt-1 text-[#22c55e] hover:text-green-400 shrink-0"><Check size={15} /></button>
              <button onClick={onCancel} className="mt-1 text-[#555] hover:text-[#888] shrink-0"><X size={15} /></button>
            </>
          )}
        </div>
      ) : (
        <div className="flex-1 flex items-center gap-1.5">
          <span className={value ? "text-sm text-white" : "text-sm text-[#444] italic"}>{value || placeholder}</span>
          <button
            onClick={() => onEdit(field, value)}
            className="opacity-0 group-hover:opacity-100 transition-opacity text-[#555] hover:text-[#888] shrink-0"
          >
            <Pencil size={12} />
          </button>
        </div>
      )}
    </div>
  );
}

"use client";
import Header from "../../../../components/Header";
import LoadingSpinner from "../../../../components/LoadingSpinner";
import CircularScore from "../../../../components/CircularScore";
import ProgressBar from "../../../../components/ProgressBar";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { ethers } from "ethers";
import { ArrowLeft, ChevronRight, ExternalLink, CheckCircle2, Circle, Clock, AlertCircle, BadgeCheck, MessageCircle, Dot } from "lucide-react";
import { useWallet } from "../../../../context/WalletContext";
import { CONTRACTS } from "../../../../contracts/addresses";

function tokenSymbol(addr: string) {
  if (addr.toLowerCase() === CONTRACTS.MOCK_USDC.toLowerCase()) return "USDC";
  if (addr.toLowerCase() === CONTRACTS.MOCK_USDT.toLowerCase()) return "USDT";
  return "TOKEN";
}
import { useCurrency } from "../../../../context/CurrencyContext";
import { getPledgeMeta } from "../../../../lib/pledgeMeta";

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };
const STATUS_BG: Record<string, string> = { PENDING: "#f59e0b22", COMPLETED: "#22c55e22", DEFAULTED: "#ef444422", CANCELLED: "#88888822" };

interface PledgeRaw { id: bigint; sender: string; merchant: string; token: string; totalAmount: bigint; initialDeposit: bigint; depositedAmount: bigint; commitmentDate: bigint; appliedFeeBps: bigint; status: number; paidDuringGrace: boolean; }
interface SenderRep { score: number; total: number; defaults: number; label: string; }

function shortAddr(a: string) { return a.slice(0, 6) + "…" + a.slice(-4); }
function fmtDate(ts: bigint) { return new Date(Number(ts) * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function daysLeft(ts: bigint) { return Math.max(0, Math.ceil((Number(ts) - Date.now() / 1000) / 86400)); }
function daysOverdue(ts: bigint) { return Math.max(0, Math.floor((Date.now() / 1000 - Number(ts)) / 86400)); }

function trustLabel(score: number) {
  if (score >= 90) return "Excellent";
  if (score >= 75) return "Good";
  if (score >= 50) return "Fair";
  return "Low";
}

const AVATAR_COLORS = ["#DDE048", "#60a5fa", "#f59e0b", "#22c55e", "#f87171", "#a78bfa", "#34d399"];
function avatarColor(addr: string) { return AVATAR_COLORS[parseInt(addr.slice(2, 4), 16) % AVATAR_COLORS.length]; }
function initials(addr: string) { return addr.slice(2, 4).toUpperCase(); }

interface TimelineStepProps { done: boolean; active?: boolean; label: string; sub?: string; amount?: string; last?: boolean; }
function TimelineStep({ done, active, label, sub, amount, last }: TimelineStepProps) {
  return (
    <div className={`flex gap-4 ${last ? "" : "pb-6"}`}>
      <div className="flex flex-col items-center">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${done ? "bg-[#22c55e]" : active ? "bg-[#DDE048]" : "bg-[#1e2230]"}`}>
          {done ? <CheckCircle2 size={16} color="white" /> : active ? <Clock size={15} color="black" /> : <Circle size={16} color="#444" />}
        </div>
        {!last && <div className={`w-px flex-1 mt-1 ${done ? "bg-[#22c55e44]" : "bg-[#1e2230]"}`} />}
      </div>
      <div className="flex-1 min-w-0 pb-1">
        <div className={`text-sm font-semibold ${done ? "text-white" : active ? "text-[#DDE048]" : "text-[#555]"}`}>{label}</div>
        {sub && <div className="text-xs text-[#555] mt-0.5">{sub}</div>}
        {amount && <div className={`text-sm font-bold mt-1 ${done ? "text-[#22c55e]" : active ? "text-[#DDE048]" : "text-[#555]"}`}>{amount}</div>}
      </div>
    </div>
  );
}

export default function MerchantTransferDetail() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { account, pledgeRead, pledgeWrite, walletLoading } = useWallet();
  const { fmt } = useCurrency();
  const [pledge, setPledge] = useState<PledgeRaw | null>(null);
  const [rep, setRep] = useState<SenderRep | null>(null);
  const [loading, setLoading] = useState(true);
  const [txLoading, setTxLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");

  useEffect(() => { loadPledge(); }, [id]);

  async function loadPledge() {
    try {
      const pledgeData = await pledgeRead.getPledge(id) as PledgeRaw;
      setPledge(pledgeData);
      const r = await pledgeRead.getReputation(pledgeData.sender);
      const score = Math.round(Number(r.basisPoints) / 100);
      setRep({ score, total: Number(r.totalCount), defaults: Number(r.defaultCount ?? 0), label: trustLabel(score) });
    } finally { setLoading(false); }
  }

  async function handleClaim() {
    if (!pledgeWrite) return;
    setTxLoading(true); setTxStatus("Claiming...");
    try {
      const tx = await pledgeWrite.claimDefaultedDeposit(id);
      await tx.wait();
      setTxStatus("Claimed!"); loadPledge();
    } catch (err: unknown) {
      const e = err as { reason?: string; message?: string };
      setTxStatus("Error: " + (e.reason ?? e.message));
    } finally { setTxLoading(false); }
  }

  if (loading || walletLoading) return <LoadingSpinner fullScreen />;
  if (!pledge) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
      <AlertCircle size={40} color="#444" />
      <div className="font-bold">Transfer not found</div>
      <button className="text-[#DDE048] text-sm" onClick={() => router.back()}>← Go back</button>
    </div>
  );

  const token = tokenSymbol(pledge.token);
  const total = parseFloat(ethers.formatUnits(pledge.totalAmount, 6));
  const feeBps = Number(pledge.appliedFeeBps);
  const gross = total * (1 + feeBps / 10000);
  const fee = total * (feeBps / 10000);
  const merchantReceives = total;
  const rawLocked = parseFloat(ethers.formatUnits(pledge.depositedAmount, 6));
  const locked = Number(pledge.status) === 1 ? total : rawLocked;
  const remaining = Math.max(0, parseFloat((gross - rawLocked).toFixed(6)));
  const status = STATUS[pledge.status];
  const statusColor = STATUS_COLOR[status];
  const statusBg = STATUS_BG[status];
  const isGraceOver = Date.now() / 1000 > Number(pledge.commitmentDate) + 3 * 86400;
  const isCompleted = status === "COMPLETED";
  const isDefaulted = status === "DEFAULTED";
  const isPending = status === "PENDING";
  const deadlineDate = fmtDate(pledge.commitmentDate);
  const graceEndTs = pledge.commitmentDate + BigInt(3 * 86400);
  const graceEndDate = fmtDate(graceEndTs);
  const pledgeIdHex = `#${pledge.id.toString()}`;
  const senderMeta = getPledgeMeta(pledge.sender);

  /* ── DESKTOP ── */
  const DesktopDetail = (
    <div className="hidden md:block p-8">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-[13px] text-[#555] mb-6">
        <Link href="/merchant" className="hover:text-[#888] transition-colors flex items-center gap-1">
          <ArrowLeft size={14} /> Merchant
        </Link>
        <ChevronRight size={13} color="#333" />
        <Link href="/merchant/transfers" className="hover:text-[#888] transition-colors">Transfers</Link>
        <ChevronRight size={13} color="#333" />
        <span className="text-[#888]">{pledgeIdHex}</span>
      </div>

      {/* Header row */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-xs font-bold px-3 py-1.5 rounded-full" style={{ color: statusColor, background: statusBg }} className="flex items-center gap-1"><Dot size={14} style={{ color: statusColor }} />{status}</span>
            <span className="text-[#555] text-sm font-mono">{pledgeIdHex}</span>
          </div>
          <div className="text-[56px] font-extrabold text-white leading-none">
            {total.toFixed(2)} <span className="text-2xl text-[#888] font-normal">{token}</span>
          </div>
          <div className="text-[#555] text-sm mt-1">≈ {fmt(total)} · from sender</div>
          <div className="flex items-center gap-2 mt-3">
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-black"
              style={{ background: avatarColor(pledge.sender) }}
            >
              {initials(pledge.sender)}
            </div>
            <span className="text-white font-semibold text-sm">{senderMeta?.name || shortAddr(pledge.sender)}</span>
            <span className="text-[#555] font-mono text-xs">{shortAddr(pledge.sender)}</span>
          </div>
        </div>

        <div className="flex items-center gap-3 shrink-0 pt-2">
          <button className="flex items-center gap-2 bg-[#13161c] border border-[#1e2230] text-white text-sm font-semibold rounded-xl px-4 py-2.5 hover:border-[#333] transition-colors">
            <MessageCircle size={14} /> Message sender
          </button>
          {isPending && isGraceOver && (
            <button
              onClick={handleClaim}
              disabled={txLoading}
              className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors disabled:opacity-50"
            >
              {txLoading ? "Processing…" : `Claim deposit · ${rawLocked.toFixed(2)} USDC`}
            </button>
          )}
          {isPending && !isGraceOver && (
            <button disabled className="flex items-center gap-2 bg-[#1e2230] text-[#555] text-sm font-bold rounded-xl px-5 py-2.5 cursor-not-allowed">
              Claim available after grace period
            </button>
          )}
          {isDefaulted && (
            <button
              onClick={handleClaim}
              disabled={txLoading}
              className="flex items-center gap-2 bg-[#ef4444] text-white text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#dc2626] transition-colors disabled:opacity-50"
            >
              {txLoading ? "Processing…" : `Claim deposit · ${rawLocked.toFixed(2)} USDC`}
            </button>
          )}
        </div>
      </div>

      {txStatus && (
        <div className={`mb-6 px-4 py-3 rounded-xl text-sm font-semibold border ${txStatus.startsWith("Error") ? "border-red-500/30 bg-red-500/10 text-red-400" : "border-[#DDE048]/30 bg-[#DDE048]/10 text-[#DDE048]"}`}>
          {txStatus}
        </div>
      )}

      {/* 2-column layout */}
      <div className="grid grid-cols-[1fr_340px] gap-6">
        {/* Left column */}
        <div className="space-y-5">
          {/* Transfer Timeline */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-5">TRANSFER TIMELINE</div>
            <TimelineStep
              done={true}
              label="Pledge received"
              sub={`Sender locked initial deposit · ${shortAddr(pledge.sender)}`}
              amount={`${locked.toFixed(2)} USDC locked`}
            />
            <TimelineStep
              done={isCompleted}
              active={isPending}
              label={isCompleted ? "Receipt confirmed" : "Awaiting receipt confirmation"}
              sub={isCompleted ? "You confirmed receipt of the transfer" : "Confirm once you receive the funds"}
            />
            <TimelineStep
              done={isCompleted || isDefaulted}
              active={isPending && isGraceOver}
              label={isCompleted ? "Funds fully deposited" : isDefaulted ? "Commitment missed" : "Awaiting full deposit"}
              sub={isCompleted ? "Sender deposited remaining balance" : isDefaulted ? `Sender missed deadline · ${daysOverdue(pledge.commitmentDate)} days overdue` : `Deadline: ${deadlineDate} · Grace until ${graceEndDate}`}
            />
            <TimelineStep
              done={isCompleted}
              active={isDefaulted}
              label={isCompleted ? "Funds released to you" : isDefaulted ? "Deposit claimable" : "Pending release"}
              sub={isCompleted ? `${merchantReceives.toFixed(2)} USDC released to your wallet` : isDefaulted ? `${rawLocked.toFixed(2)} USDC available to claim` : "Funds will release after full deposit"}
              amount={isCompleted ? `+${merchantReceives.toFixed(2)} USDC` : isDefaulted ? `+${rawLocked.toFixed(2)} USDC` : undefined}
              last
            />
          </div>

          {/* Amounts */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-5">AMOUNTS</div>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                <div className="text-[11px] text-[#555] tracking-[1px] mb-2">TOTAL PLEDGED</div>
                <div className="text-2xl font-extrabold text-white">{total.toFixed(2)} <span className="text-sm text-[#555] font-normal">{token}</span></div>
                <div className="text-xs text-[#555] mt-1">≈ {fmt(total)}</div>
              </div>
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                <div className="text-[11px] text-[#555] tracking-[1px] mb-2">LOCKED SO FAR</div>
                <div className="text-2xl font-extrabold text-white">{rawLocked.toFixed(2)} <span className="text-sm text-[#555] font-normal">{token}</span></div>
                <div className="text-xs text-[#555] mt-1">{total > 0 ? Math.round(rawLocked / gross * 100) : 0}% of total</div>
              </div>
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                <div className="text-[11px] text-[#555] tracking-[1px] mb-2">REMAINING</div>
                <div className={`text-2xl font-extrabold ${remaining > 0 ? "text-[#f59e0b]" : "text-[#22c55e]"}`}>{remaining.toFixed(2)} <span className="text-sm text-[#555] font-normal">{token}</span></div>
              </div>
              <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-4">
                <div className="text-[11px] text-[#555] tracking-[1px] mb-2">YOU RECEIVE</div>
                <div className="text-2xl font-extrabold text-[#DDE048]">{merchantReceives.toFixed(2)} <span className="text-sm text-[#555] font-normal">{token}</span></div>
                <div className="text-xs text-[#555] mt-1">after 1% service fee</div>
              </div>
            </div>
            <div className="mb-1.5 flex justify-between text-xs text-[#555]">
              <span>Deposit progress</span>
              <span>{total > 0 ? Math.round(rawLocked / gross * 100) : 0}%</span>
            </div>
            <ProgressBar locked={rawLocked} total={gross} />
          </div>

          {/* On-chain proof */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">ON-CHAIN PROOF</div>
            <div className="space-y-3">
              <ProofRow label="Pledge ID" value={pledge.id.toString()} />
              <ProofRow label="Sender" value={pledge.sender} mono />
              <ProofRow label="Contract" value={CONTRACTS.REMITTANCE_PLEDGE} mono link={`https://explorer-hoodi.morphl2.io/address/${CONTRACTS.REMITTANCE_PLEDGE}`} />
              <ProofRow label="Commitment date" value={deadlineDate} />
              <ProofRow label="Grace end" value={graceEndDate} last />
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          {/* Sender Trust Profile */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">SENDER TRUST PROFILE</div>
            <div className="flex items-center gap-4 mb-4">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-lg font-black text-black shrink-0"
                style={{ background: avatarColor(pledge.sender) }}
              >
                {initials(pledge.sender)}
              </div>
              <div>
                <div className="font-bold text-white text-base">{senderMeta?.name || shortAddr(pledge.sender)}</div>
                <div className="text-[#555] text-xs font-mono mt-0.5">{shortAddr(pledge.sender)}</div>
                <div className="flex items-center gap-1.5 mt-1.5">
                  <BadgeCheck size={13} color="#DDE048" />
                  <span className="text-[11px] text-[#DDE048] font-semibold">Verified OFW</span>
                </div>
              </div>
            </div>
            {rep && (
              <>
                <div className="flex items-center justify-center mb-4">
                  <CircularScore score={rep.score} size={100} />
                </div>
                <div className="grid grid-cols-2 gap-2 mb-4">
                  <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-3 text-center">
                    <div className="text-xl font-extrabold text-white">{rep.total}</div>
                    <div className="text-[10px] text-[#555] mt-0.5">PLEDGES</div>
                  </div>
                  <div className="bg-[#0e1014] border border-[#1e2230] rounded-xl p-3 text-center">
                    <div className="text-xl font-extrabold text-white">{rep.defaults}</div>
                    <div className="text-[10px] text-[#555] mt-0.5">DEFAULTS</div>
                  </div>
                </div>
                <div className={`text-center text-sm font-bold px-3 py-2 rounded-xl ${rep.score >= 75 ? "bg-[#22c55e]/10 text-[#22c55e]" : rep.score >= 50 ? "bg-[#f59e0b]/10 text-[#f59e0b]" : "bg-red-500/10 text-red-400"}`}>
                  {rep.label} trust · {rep.score}/100
                </div>
              </>
            )}
          </div>

          {/* Recommended Action */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">RECOMMENDED ACTION</div>
            {isCompleted && (
              <div className="flex items-start gap-3">
                <CheckCircle2 size={18} color="#22c55e" className="shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-white">No action needed</div>
                  <div className="text-xs text-[#555] mt-1">This transfer is complete. Funds have been released to your wallet.</div>
                </div>
              </div>
            )}
            {isPending && !isGraceOver && (
              <div className="flex items-start gap-3">
                <Clock size={18} color="#f59e0b" className="shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-white">Wait for sender deposit</div>
                  <div className="text-xs text-[#555] mt-1">
                    Deadline is <span className="text-white font-semibold">{deadlineDate}</span>. Grace period ends {graceEndDate}. If sender misses, you can claim locked deposit.
                  </div>
                </div>
              </div>
            )}
            {isPending && isGraceOver && (
              <div className="flex items-start gap-3">
                <AlertCircle size={18} color="#ef4444" className="shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-white">Grace period has ended</div>
                  <div className="text-xs text-[#555] mt-1">Sender missed the deadline. You may now claim the locked deposit of <span className="text-[#DDE048] font-semibold">{rawLocked.toFixed(2)} USDC</span>.</div>
                </div>
              </div>
            )}
            {isDefaulted && (
              <div className="flex items-start gap-3">
                <AlertCircle size={18} color="#ef4444" className="shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-white">Claim your deposit</div>
                  <div className="text-xs text-[#555] mt-1">Transfer defaulted. Click "Claim deposit" above to receive <span className="text-[#DDE048] font-semibold">{rawLocked.toFixed(2)} USDC</span>.</div>
                </div>
              </div>
            )}
          </div>

          {/* Key Dates */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">KEY DATES</div>
            <div className="space-y-0">
              <DateRow label="Commitment deadline" value={deadlineDate} />
              <DateRow label="Grace period ends" value={graceEndDate} />
              <DateRow label="Days left" value={isPending && !isGraceOver ? `${daysLeft(pledge.commitmentDate)} days` : isGraceOver ? "Expired" : "—"} highlight={isPending && !isGraceOver} last />
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ── MOBILE ── */
  const MobileDetail = (
    <div className="md:hidden min-h-screen">
      <Header title={`Transfer ${pledgeIdHex}`} back />
      <div className="px-4 pt-5 pb-[120px] space-y-4">
        {/* Status + amount */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-bold px-2.5 py-1 rounded-full" style={{ color: statusColor, background: statusBg }} className="flex items-center gap-1"><Dot size={14} style={{ color: statusColor }} />{status}</span>
            <span className="text-[#555] text-xs font-mono">{pledgeIdHex}</span>
          </div>
          <div className="text-[32px] font-extrabold text-white">{total.toFixed(2)} <span className="text-base text-[#888] font-normal">USDC</span></div>
          <div className="text-[#888] text-sm mt-1">≈ {fmt(total)}</div>
          <div className="flex items-center gap-2 mt-3 pt-3 border-t border-[#1F2127]">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-black text-black" style={{ background: avatarColor(pledge.sender) }}>
              {initials(pledge.sender)}
            </div>
            <div>
              <div className="text-sm font-semibold text-white">{senderMeta?.name || shortAddr(pledge.sender)}</div>
              <div className="text-xs text-[#666] font-mono">{shortAddr(pledge.sender)}</div>
            </div>
          </div>
        </div>

        {/* Claim button */}
        {(isPending && isGraceOver) || isDefaulted ? (
          <button
            onClick={handleClaim}
            disabled={txLoading}
            className="w-full bg-[#DDE048] text-black text-base font-bold rounded-2xl py-4 disabled:opacity-50"
          >
            {txLoading ? "Processing…" : `Claim deposit · ${rawLocked.toFixed(2)} USDC`}
          </button>
        ) : isPending ? (
          <button disabled className="w-full bg-[#1e2230] text-[#555] text-base font-bold rounded-2xl py-4 cursor-not-allowed">
            Claim available after grace period
          </button>
        ) : null}

        {txStatus && (
          <div className={`px-4 py-3 rounded-xl text-sm font-semibold ${txStatus.startsWith("Error") ? "bg-red-500/10 text-red-400" : "bg-[#DDE048]/10 text-[#DDE048]"}`}>
            {txStatus}
          </div>
        )}

        {/* Timeline */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-4">TIMELINE</div>
          <TimelineStep done label="Pledge received" sub={`Initial deposit locked · ${rawLocked.toFixed(2)} USDC`} />
          <TimelineStep done={isCompleted} active={isPending} label={isCompleted ? "Receipt confirmed" : "Awaiting confirmation"} />
          <TimelineStep
            done={isCompleted || isDefaulted}
            active={isPending && isGraceOver}
            label={isCompleted ? "Fully deposited" : isDefaulted ? "Commitment missed" : "Awaiting deposit"}
            sub={isDefaulted ? `${daysOverdue(pledge.commitmentDate)}d overdue` : `Deadline: ${deadlineDate}`}
          />
          <TimelineStep
            done={isCompleted}
            active={isDefaulted}
            label={isCompleted ? "Funds released" : isDefaulted ? "Claimable" : "Pending release"}
            amount={isCompleted ? `+${merchantReceives.toFixed(2)} USDC` : isDefaulted ? `+${rawLocked.toFixed(2)} USDC` : undefined}
            last
          />
        </div>

        {/* Amounts */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">AMOUNTS</div>
          <div className="grid grid-cols-2 gap-3">
            <MobileStatBox label="TOTAL" value={`${total.toFixed(2)} USDC`} />
            <MobileStatBox label="LOCKED" value={`${rawLocked.toFixed(2)} USDC`} />
            <MobileStatBox label="REMAINING" value={`${remaining.toFixed(2)} USDC`} highlight={remaining > 0} />
            <MobileStatBox label="YOU RECEIVE" value={`${merchantReceives.toFixed(2)} USDC`} accent />
          </div>
        </div>

        {/* Sender Trust */}
        {rep && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
            <div className="text-[10px] text-[#888] tracking-[1.5px] mb-4">SENDER TRUST</div>
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 rounded-xl flex items-center justify-center text-base font-black text-black" style={{ background: avatarColor(pledge.sender) }}>
                {initials(pledge.sender)}
              </div>
              <div>
                <div className="font-bold text-white">{senderMeta?.name || shortAddr(pledge.sender)}</div>
                <div className="text-xs text-[#666]">{rep.total} pledges · {rep.defaults} defaults</div>
              </div>
              <div className="ml-auto">
                <CircularScore score={rep.score} size={56} />
              </div>
            </div>
            <div className={`text-center text-sm font-bold px-3 py-2 rounded-xl ${rep.score >= 75 ? "bg-[#22c55e]/10 text-[#22c55e]" : rep.score >= 50 ? "bg-[#f59e0b]/10 text-[#f59e0b]" : "bg-red-500/10 text-red-400"}`}>
              {rep.label} trust · {rep.score}/100
            </div>
          </div>
        )}

        {/* Key dates */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">KEY DATES</div>
          <div className="flex justify-between py-2.5 border-b border-[#1F2127] text-sm"><span className="text-[#666]">Deadline</span><span>{deadlineDate}</span></div>
          <div className="flex justify-between py-2.5 border-b border-[#1F2127] text-sm"><span className="text-[#666]">Grace ends</span><span>{graceEndDate}</span></div>
          <div className="flex justify-between py-2.5 text-sm">
            <span className="text-[#666]">Days left</span>
            <span className={isPending && !isGraceOver ? "text-[#DDE048] font-bold" : "text-[#888]"}>
              {isPending && !isGraceOver ? `${daysLeft(pledge.commitmentDate)} days` : isGraceOver ? "Expired" : "—"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      {DesktopDetail}
      {MobileDetail}
    </>
  );
}

function ProofRow({ label, value, mono, link, last }: { label: string; value: string; mono?: boolean; link?: string; last?: boolean }) {
  return (
    <div className={`flex items-center justify-between py-2.5 text-sm ${last ? "" : "border-b border-[#1e2230]"}`}>
      <span className="text-[#555]">{label}</span>
      {link ? (
        <a href={link} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-[#DDE048] font-mono text-xs hover:underline">
          {value.slice(0, 10)}…{value.slice(-8)} <ExternalLink size={11} />
        </a>
      ) : (
        <span className={`text-white ${mono ? "font-mono text-xs" : ""}`}>{mono ? `${value.slice(0, 10)}…${value.slice(-8)}` : value}</span>
      )}
    </div>
  );
}

function DateRow({ label, value, highlight, last }: { label: string; value: string; highlight?: boolean; last?: boolean }) {
  return (
    <div className={`flex justify-between py-2.5 text-sm ${last ? "" : "border-b border-[#1e2230]"}`}>
      <span className="text-[#555]">{label}</span>
      <span className={highlight ? "text-[#DDE048] font-bold" : "text-white"}>{value}</span>
    </div>
  );
}

function MobileStatBox({ label, value, highlight, accent }: { label: string; value: string; highlight?: boolean; accent?: boolean }) {
  return (
    <div className="bg-[#0e1014] border border-[#1F2127] rounded-xl p-3">
      <div className="text-[10px] text-[#666] tracking-[1px] mb-1">{label}</div>
      <div className={`text-base font-extrabold ${accent ? "text-[#DDE048]" : highlight ? "text-[#f59e0b]" : "text-white"}`}>{value}</div>
    </div>
  );
}

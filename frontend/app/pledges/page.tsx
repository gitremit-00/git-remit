"use client";
import Header from "../../components/Header";
import KYCGate from "../../components/KYCGate";
import LoadingSpinner from "../../components/LoadingSpinner";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Link2, Inbox, Clock, Check, CheckCircle2, AlertCircle, XCircle, Send, Copy, CheckCheck, Store, User, Zap, X, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import ProgressBar from "../../components/ProgressBar";
import { useCurrency } from "../../context/CurrencyContext";
import { getPledgeMeta, getAllMeta } from "../../lib/pledgeMeta";
import { getSenderTransferRequests, getMerchantTransferRequests, type TransferRequest } from "../../lib/supabase";
import { CONTRACTS } from "../../contracts/addresses";

function tokenSymbol(addr: string) {
  if (!addr) return "TOKEN";
  if (addr.toLowerCase() === CONTRACTS.MOCK_USDC.toLowerCase()) return "USDC";
  if (addr.toLowerCase() === CONTRACTS.MOCK_USDT.toLowerCase()) return "USDT";
  return "TOKEN";
}

const STATUS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
const STATUS_COLOR: Record<string, string> = { PENDING: "#f59e0b", COMPLETED: "#22c55e", DEFAULTED: "#ef4444", CANCELLED: "#888" };
const STATUS_BG: Record<string, string> = { PENDING: "#f59e0b22", COMPLETED: "#22c55e22", DEFAULTED: "#ef444422", CANCELLED: "#88888822" };
const STATUS_ICON: Record<string, React.ReactNode> = {
  PENDING: <Clock size={13} color="#f59e0b" />,
  COMPLETED: <CheckCircle2 size={13} color="#22c55e" />,
  DEFAULTED: <AlertCircle size={13} color="#ef4444" />,
  CANCELLED: <XCircle size={13} color="#888" />,
};

const TABS = ["All", "Sent", "Received"] as const;
type Tab = typeof TABS[number];

// ── Unified transaction model ──────────────────────────────────────────────
// "pledge" = on-chain escrow pledge (merchant partial/installment)
// "p2p"    = direct sendP2P transfer (P2P + merchant full payments), Supabase-only
interface Tx {
  key: string;
  kind: "pledge" | "p2p";
  counterpartyId: string;          // accountId (pledge) or uuid/wallet (p2p)
  counterpartyName: string | null;
  symbol: string;
  total: number;
  locked: number;
  feeBps: number;
  status: string;                  // PENDING / COMPLETED / DEFAULTED / CANCELLED
  isSent: boolean;
  date: number;                    // unix seconds — for sort + display
  pledgeId?: string;
  txHash?: string | null;
  note?: string | null;
}

function DetailRow({ label, value, children }: { label: string; value?: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 text-sm">
      <span className="text-[#555] shrink-0">{label}</span>
      {children ?? <span className="text-white text-right break-words">{value}</span>}
    </div>
  );
}

interface PledgeRaw { id: bigint; payer: string; merchant: string; token: string; totalAmount: bigint; depositedAmount: bigint; commitmentDate: bigint; appliedFeeBps: bigint; status: number; }
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizePledge(p: any): PledgeRaw {
  return {
    id: p.id,
    payer: p.payerAccount ?? p.payer ?? "",
    merchant: p.merchantAccount ?? p.merchant ?? "",
    token: p.token,
    totalAmount: p.totalAmount,
    depositedAmount: p.depositedAmount,
    commitmentDate: p.commitmentDate,
    appliedFeeBps: p.appliedFeeBps,
    status: Number(p.status),
  };
}

function shortAddr(a: string) { return a ? a.slice(0, 6) + "..." + a.slice(-4) : "—"; }
function daysLeft(ts: number) { return Math.max(0, Math.ceil((ts - Date.now() / 1000) / 86400)); }
function fmtDate(ts: number) { return new Date(ts * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }); }
function fmtTime(ts: number) { return new Date(ts * 1000).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }); }

// Build a uuid → display name map from locally-saved pledge metadata
function buildUuidNameMap(): Record<string, string> {
  const out: Record<string, string> = {};
  const all = getAllMeta();
  for (const meta of Object.values(all)) {
    if (meta.uuid && meta.name) out[meta.uuid.toLowerCase()] = meta.name;
  }
  return out;
}

export default function Pledges() {
  const { account, accountId, connect, pledgeRead, walletLoading } = useWallet();
  const { fmt } = useCurrency();
  const [tab, setTab] = useState<Tab>("All");
  const [txs, setTxs] = useState<Tx[]>([]);
  const [loading, setLoading] = useState(false);
  const [myUuid, setMyUuid] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [detailTx, setDetailTx] = useState<Tx | null>(null);

  // `key` identifies which button was clicked so only that one shows "copied"
  function copyAddress(value: string, key: string) {
    navigator.clipboard.writeText(value);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1500);
  }

  // Resolve the current user's profile UUID (needed to find received P2P transfers)
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(me => { if (me?.userId) setMyUuid(String(me.userId).toLowerCase()); })
      .catch(() => { /* non-critical */ });
  }, []);

  useEffect(() => { if (account && accountId) loadAll(); }, [account, accountId, myUuid]);

  async function loadAll() {
    setLoading(true);
    try {
      const uuidNames = buildUuidNameMap();

      // 1. On-chain pledges (merchant partial / installment)
      const [payerIds, merchantIds] = await Promise.all([
        pledgeRead.getAccountPayerPledges(accountId) as Promise<bigint[]>,
        pledgeRead.getAccountMerchantPledges(accountId) as Promise<bigint[]>,
      ]);
      const uniqueIds = [...new Set([...payerIds, ...merchantIds].map(id => id.toString()))];
      const pledges = (await Promise.all(uniqueIds.map(id => pledgeRead.getPledge(id)))).map(normalizePledge);

      const pledgeTxs: Tx[] = pledges.map((p) => {
        const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
        const locked = p.status === 1 ? total : parseFloat(ethers.formatUnits(p.depositedAmount, 6));
        const isSent = account!.toLowerCase() === p.payer.toLowerCase();
        const counterpartyId = isSent ? p.merchant : p.payer;
        return {
          key: `pledge-${p.id}`,
          kind: "pledge",
          counterpartyId,
          counterpartyName: getPledgeMeta(counterpartyId)?.name ?? null,
          symbol: tokenSymbol(p.token),
          total,
          locked,
          feeBps: Number(p.appliedFeeBps),
          status: STATUS[p.status],
          isSent,
          date: Number(p.commitmentDate),
          pledgeId: p.id.toString(),
        };
      });

      // 2. Direct P2P transfers (Supabase-only — no on-chain pledge_id)
      const isDirectP2P = (r: TransferRequest) => r.status === "confirmed" && !r.pledge_id;
      const [sentReqs, recvReqs] = await Promise.all([
        getSenderTransferRequests(account!),
        myUuid ? getMerchantTransferRequests(myUuid) : Promise.resolve([] as TransferRequest[]),
      ]);
      const sentDirect = sentReqs.filter(isDirectP2P);
      const recvDirect = recvReqs.filter(isDirectP2P);

      // Resolve the senders of received transfers → their account ID + name
      const senderMap: Record<string, { uuid: string; name: string }> = {};
      const senderAddrs = [...new Set(recvDirect.map(r => r.sender_address.toLowerCase()))];
      if (senderAddrs.length > 0) {
        try {
          const res = await fetch("/api/wallet/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ addresses: senderAddrs }),
          });
          if (res.ok) {
            const { profiles } = await res.json() as { profiles: { address: string; uuid: string; displayName: string }[] };
            profiles.forEach(p => { senderMap[p.address.toLowerCase()] = { uuid: p.uuid, name: p.displayName }; });
          }
        } catch { /* non-critical — falls back to wallet address */ }
      }

      const toP2PTx = (r: TransferRequest, isSent: boolean): Tx => {
        const amount = r.total_amount ?? r.initial_deposit ?? 0;
        // Always surface the account ID (UUID) used for lookups, not the raw wallet address.
        let counterpartyId = isSent ? r.merchant_address : r.sender_address;
        let counterpartyName = isSent ? (uuidNames[r.merchant_address.toLowerCase()] ?? null) : null;
        if (!isSent) {
          const resolved = senderMap[r.sender_address.toLowerCase()];
          if (resolved) { counterpartyId = resolved.uuid; counterpartyName = resolved.name; }
        }
        return {
          key: `p2p-${r.id}`,
          kind: "p2p",
          counterpartyId,
          counterpartyName,
          symbol: r.token,
          total: amount,
          locked: amount,
          feeBps: 0,
          status: "COMPLETED",
          isSent,
          date: Math.floor(new Date(r.created_at).getTime() / 1000),
          txHash: r.tx_hash,
          note: r.note,
        };
      };

      const p2pTxs: Tx[] = [
        ...sentDirect.map(r => toP2PTx(r, true)),
        ...recvDirect.map(r => toP2PTx(r, false)),
      ];

      // Merge + de-dupe + sort by date (newest first)
      const merged = [...pledgeTxs, ...p2pTxs];
      const seen = new Set<string>();
      const unique = merged.filter(t => (seen.has(t.key) ? false : seen.add(t.key)));
      unique.sort((a, b) => b.date - a.date);
      setTxs(unique);
    } finally { setLoading(false); }
  }

  const filtered = tab === "All" ? txs : txs.filter(t => (tab === "Sent" ? t.isSent : !t.isSent));

  // Summary stats (across all transactions, ignoring the active tab)
  const sentCount = txs.filter(t => t.isSent).length;
  const recvCount = txs.filter(t => !t.isSent).length;
  const sentTotal = txs.filter(t => t.isSent).reduce((s, t) => s + t.total, 0);
  const recvTotal = txs.filter(t => !t.isSent).reduce((s, t) => s + t.total, 0);

  // Single loading state — shown once, centered, while the wallet inits or the
  // first batch of transactions loads. Background refreshes keep the list visible.
  if (walletLoading || (loading && txs.length === 0)) {
    return (
      <KYCGate featureName="My Transfers">
        <div className="flex items-center justify-center min-h-[60vh]">
          <LoadingSpinner />
        </div>
      </KYCGate>
    );
  }

  const KindBadge = ({ kind }: { kind: Tx["kind"] }) => (
    kind === "p2p"
      ? <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#60a5fa22] text-[#60a5fa]"><Zap size={9} /> P2P</span>
      : <span className="inline-flex items-center gap-1 text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#a78bfa22] text-[#a78bfa]"><Store size={9} /> Pledge</span>
  );

  /* ── DESKTOP ── */
  const DesktopView = (
    <div className="hidden md:block p-8">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-3xl font-extrabold text-white">My Transfers</h1>
        <Link href="/new-transfer" className="flex items-center gap-2 bg-[#DDE048] text-black text-sm font-bold rounded-xl px-5 py-2.5 hover:bg-[#c8ce30] transition-colors">
          <Send size={14} /> New Transfer
        </Link>
      </div>
      <p className="text-[#555] text-sm mb-6">Every transfer you&apos;ve made or received — direct P2P sends and merchant pledges.</p>

      {/* Summary stats */}
      {account && txs.length > 0 && (
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-1">TOTAL TRANSFERS</div>
            <div className="text-2xl font-extrabold text-white">{txs.length}</div>
          </div>
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="flex items-center gap-1.5 text-[11px] text-[#555] tracking-[1.5px] mb-1"><ArrowUpRight size={12} color="#f59e0b" /> SENT ({sentCount})</div>
            <div className="text-2xl font-extrabold text-white">{fmt(sentTotal)}</div>
          </div>
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="flex items-center gap-1.5 text-[11px] text-[#555] tracking-[1.5px] mb-1"><ArrowDownLeft size={12} color="#22c55e" /> RECEIVED ({recvCount})</div>
            <div className="text-2xl font-extrabold text-white">{fmt(recvTotal)}</div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex items-center gap-2 mb-6">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-full text-sm font-semibold border transition-colors ${tab === t ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "bg-transparent border-[#1e2230] text-[#555] hover:text-[#888]"}`}
          >{t}</button>
        ))}
      </div>

      {!account && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Link2 size={40} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">Wallet not connected</div>
          <div className="text-[#555] text-sm mb-5">Connect your wallet to view your transfers</div>
          <button onClick={connect} className="bg-[#DDE048] text-black font-bold rounded-xl px-8 py-2.5 text-sm">Connect MetaMask</button>
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && account && filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Inbox size={40} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">No transfers yet</div>
          <div className="text-[#555] text-sm mb-5">
            {tab === "Sent" ? "You haven't sent any transfers" : tab === "Received" ? "You haven't received any transfers" : "Create your first transfer to get started"}
          </div>
          <Link href="/new-transfer" className="bg-[#DDE048] text-black font-bold rounded-xl px-8 py-2.5 text-sm">+ New Transfer</Link>
        </div>
      )}

      {!loading && filtered.length > 0 && (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                {["COUNTERPARTY", "REF", "TOTAL", "LOCKED", "PROGRESS", "STATUS", "DATE", ""].map((h) => (
                  <th key={h} className="px-5 py-3 text-left text-[10px] text-[#444] tracking-[1.5px] font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((t) => {
                const gross = t.total * (1 + t.feeBps / 10000);
                const progressTotal = t.status === "COMPLETED" ? t.total : gross;
                const pct = t.status === "COMPLETED" ? 100 : progressTotal > 0 ? Math.round(t.locked / progressTotal * 100) : 0;
                const days = daysLeft(t.date);
                return (
                  <tr key={t.key} className="border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors group">
                    <td className="px-5 py-4">
                      {t.counterpartyName && <div className="font-semibold text-white text-xs">{t.counterpartyName}</div>}
                      <div className="flex items-center gap-1 mt-0.5">
                        <span className="text-[10px] text-[#555] font-mono">{shortAddr(t.counterpartyId)}</span>
                        <button
                          onClick={(e) => { e.preventDefault(); copyAddress(t.counterpartyId, t.key); }}
                          className="text-[#444] hover:text-[#DDE048] transition-colors"
                          title="Copy account ID"
                        >
                          {copiedKey === t.key ? <CheckCheck size={11} color="#22c55e" /> : <Copy size={11} />}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5 mt-1">
                        <span className="text-[10px] text-[#555]">{t.isSent ? "↑ Sent" : "↓ Received"}</span>
                        <KindBadge kind={t.kind} />
                      </div>
                    </td>
                    <td className="px-5 py-4 font-mono text-[#555] text-xs">
                      {t.kind === "pledge" ? `#${t.pledgeId}` : "P2P"}
                    </td>
                    <td className="px-5 py-4">
                      <div className="font-bold text-white">{t.total.toFixed(2)} <span className="text-[#555] text-xs font-normal">{t.symbol}</span></div>
                      <div className="text-[10px] text-[#555]">{fmt(t.total)}</div>
                    </td>
                    <td className="px-5 py-4 text-[#DDE048] font-semibold">{t.locked.toFixed(2)}</td>
                    <td className="px-5 py-4 w-32">
                      <ProgressBar locked={t.locked} total={progressTotal} />
                      <div className="text-[10px] text-[#555] mt-0.5">{pct}%</div>
                    </td>
                    <td className="px-5 py-4">
                      <span className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1 rounded-full w-fit" style={{ color: STATUS_COLOR[t.status], background: STATUS_BG[t.status] }}>
                        {STATUS_ICON[t.status]} {t.status}
                      </span>
                    </td>
                    <td className="px-5 py-4 text-xs text-[#555]">
                      <div>{fmtDate(t.date)}</div>
                      <div className="text-[10px] text-[#444] mt-0.5">{fmtTime(t.date)}</div>
                      {t.kind === "pledge" && t.status === "PENDING" && <div className="text-[#f59e0b] mt-0.5">{days}d left</div>}
                    </td>
                    <td className="px-5 py-4">
                      {t.kind === "pledge" ? (
                        <Link href={`/pledge/${t.pledgeId}`} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline whitespace-nowrap">
                          View →
                        </Link>
                      ) : (
                        <button onClick={() => setDetailTx(t)} className="opacity-0 group-hover:opacity-100 transition-opacity text-[#DDE048] text-xs font-semibold hover:underline whitespace-nowrap">
                          View →
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  /* ── MOBILE ── */
  const MobileView = (
    <div className="md:hidden">
      <Header title="My Transfers" />
      <div className="px-4 pt-5">
        {/* Summary stats */}
        {account && txs.length > 0 && (
          <div className="grid grid-cols-2 gap-3 mb-5">
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-[10px] text-[#888] tracking-[1px] mb-1"><ArrowUpRight size={11} color="#f59e0b" /> SENT ({sentCount})</div>
              <div className="text-lg font-extrabold text-white">{fmt(sentTotal)}</div>
            </div>
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
              <div className="flex items-center gap-1.5 text-[10px] text-[#888] tracking-[1px] mb-1"><ArrowDownLeft size={11} color="#22c55e" /> RECEIVED ({recvCount})</div>
              <div className="text-lg font-extrabold text-white">{fmt(recvTotal)}</div>
            </div>
          </div>
        )}

        <div className="flex gap-2 mb-5">
          {TABS.map((t) => (
            <button
              key={t}
              className={`px-5 py-2 rounded-[20px] text-[13px] cursor-pointer ${tab === t ? "bg-[rgba(212,255,0,0.1)] border border-[#DDE048] text-[#DDE048] font-semibold" : "bg-[#11141A] border border-[#1F2127] text-[#888]"}`}
              onClick={() => setTab(t)}
            >{t}</button>
          ))}
        </div>

        {!walletLoading && !account && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-10 px-6 text-center mb-3 flex flex-col items-center">
            <Link2 size={40} color="#444" className="mb-3" />
            <div className="font-bold text-base mb-1.5">Wallet not connected</div>
            <div className="text-[#888] text-[13px] mb-5">Connect your wallet to view your transfers</div>
            <button className="bg-[#DDE048] text-black border-0 rounded-xl px-7 py-3 text-sm font-bold cursor-pointer" onClick={connect}>Connect MetaMask</button>
          </div>
        )}

        {loading && <LoadingSpinner />}

        {!loading && account && filtered.length === 0 && (
          <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] py-10 px-6 text-center mb-3 flex flex-col items-center">
            <Inbox size={40} color="#444" className="mb-3" />
            <div className="font-bold text-base mb-1.5">No transfers yet</div>
            <div className="text-[#888] text-[13px] mb-5">{tab === "Sent" ? "You haven't sent any transfers" : tab === "Received" ? "You haven't received any transfers" : "Create your first transfer to get started"}</div>
            <Link href="/new-transfer" className="inline-block bg-[#DDE048] text-black rounded-xl px-7 py-3 text-sm font-bold">+ New Transfer</Link>
          </div>
        )}

        {filtered.map((t) => {
          const gross = t.total * (1 + t.feeBps / 10000);
          const progressTotal = t.status === "COMPLETED" ? t.total : gross;
          const days = daysLeft(t.date);
          const inner = (
            <div className="bg-[#11141A] border border-[#1F2127] rounded-[18px] p-4 mb-3">
              <div className="flex justify-between items-start mb-2.5">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-[#1e2230] flex items-center justify-center shrink-0">
                    {t.kind === "p2p" ? <User size={17} color="#60a5fa" /> : <Store size={17} color="#a78bfa" />}
                  </div>
                  <div>
                    <div className="font-bold text-[15px]">{t.counterpartyName || shortAddr(t.counterpartyId)}</div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[11px] text-[#888]">{t.isSent ? "↑ Sent" : "↓ Received"}</span>
                      <KindBadge kind={t.kind} />
                    </div>
                  </div>
                </div>
                <span className="px-2.5 py-1 rounded-[20px] text-[11px] font-bold whitespace-nowrap flex items-center gap-1" style={{ color: STATUS_COLOR[t.status], background: STATUS_COLOR[t.status] + "22" }}>
                  {t.status === "COMPLETED" ? <Check size={11} strokeWidth={3} /> : <span>●</span>}
                  {t.status}
                </span>
              </div>
              <div className="text-[26px] font-extrabold mb-0.5">{t.total.toFixed(2)} <span className="text-sm text-[#888]">{t.symbol}</span></div>
              <div className="text-xs text-[#888] mb-2">= {fmt(t.total)}</div>
              {t.kind === "pledge" ? (
                <>
                  <ProgressBar locked={t.locked} total={progressTotal} />
                  <div className="flex justify-between text-[11px] text-[#888] mt-0.5">
                    <span className="text-[#DDE048]">{t.locked.toFixed(2)} locked</span>
                    {t.status === "PENDING"
                      ? <span className="text-amber-400 flex items-center gap-1"><Clock size={11} color="#f59e0b" /> {days}d · {fmtDate(t.date)} {fmtTime(t.date)}</span>
                      : <span>{fmtDate(t.date)} · {fmtTime(t.date)}</span>}
                  </div>
                </>
              ) : (
                <div className="flex justify-between items-center text-[11px] text-[#888] mt-1">
                  <span>{fmtDate(t.date)} · {fmtTime(t.date)}</span>
                  <span className="flex items-center gap-0.5 text-[#DDE048] font-semibold">View →</span>
                </div>
              )}
            </div>
          );
          return t.kind === "pledge"
            ? <Link key={t.key} href={`/pledge/${t.pledgeId}`} className="block text-inherit">{inner}</Link>
            : <button key={t.key} onClick={() => setDetailTx(t)} className="block w-full text-left text-inherit">{inner}</button>;
        })}
      </div>
    </div>
  );

  /* ── TRANSACTION DETAIL MODAL ── */
  const DetailModal = detailTx && (
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm px-4"
      onClick={() => setDetailTx(null)}
    >
      <div
        className="w-full max-w-md bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-6 border-b border-[#1e2230]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <KindBadge kind={detailTx.kind} />
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ color: STATUS_COLOR[detailTx.status], background: STATUS_BG[detailTx.status] }}>
                {STATUS_ICON[detailTx.status]} {detailTx.status}
              </span>
            </div>
            <button onClick={() => setDetailTx(null)} className="text-[#555] hover:text-white transition-colors">
              <X size={18} />
            </button>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] text-[#555] tracking-[1.5px] mb-1.5">
            {detailTx.isSent
              ? <><ArrowUpRight size={12} color="#f59e0b" /> SENT</>
              : <><ArrowDownLeft size={12} color="#22c55e" /> RECEIVED</>}
          </div>
          <div className="text-3xl font-extrabold text-white">
            {detailTx.total.toFixed(2)} <span className="text-base text-[#555] font-normal">{detailTx.symbol}</span>
          </div>
          <div className="text-sm text-[#888] mt-0.5">= {fmt(detailTx.total)}</div>
        </div>

        {/* Details */}
        <div className="px-6 py-5 space-y-3.5">
          <DetailRow label={detailTx.isSent ? "To" : "From"} value={detailTx.counterpartyName || shortAddr(detailTx.counterpartyId)} />
          <DetailRow label={detailTx.isSent ? "Recipient account ID" : "Sender account ID"}>
            <button onClick={() => copyAddress(detailTx.counterpartyId, `${detailTx.key}-modal`)} className="flex items-center gap-1.5 text-white font-mono text-xs hover:text-[#DDE048] transition-colors">
              {shortAddr(detailTx.counterpartyId)}
              {copiedKey === `${detailTx.key}-modal` ? <CheckCheck size={12} color="#22c55e" /> : <Copy size={12} />}
            </button>
          </DetailRow>
          <DetailRow label="Type" value={detailTx.kind === "pledge" ? "Merchant pledge" : "Direct P2P transfer"} />
          <DetailRow label="Token" value={detailTx.symbol} />
          <DetailRow label="Date" value={new Date(detailTx.date * 1000).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })} />
          {detailTx.note && <DetailRow label="Note" value={detailTx.note} />}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6">
          <button onClick={() => setDetailTx(null)} className="w-full bg-[#1e2230] text-white font-semibold rounded-xl py-3 text-sm hover:bg-[#252836] transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <KYCGate featureName="My Transfers">
      {DesktopView}
      {MobileView}
      {DetailModal}
    </KYCGate>
  );
}

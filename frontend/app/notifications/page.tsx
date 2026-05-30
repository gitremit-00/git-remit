"use client";
import Header from "../../components/Header";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Bell, CheckCircle2, AlertCircle, ArrowDownCircle, PlusCircle, XCircle, FileText, ArrowUpRight, ArrowDownLeft, Clock } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import { CONTRACTS } from "../../contracts/addresses";
import RemittancePledgeABI from "../../contracts/RemittancePledge.json";
import MockUSDCABI from "../../contracts/MockTokens.json";
import { getSenderNotifications, markNotificationRead, getTransferRequestNotifications, markTransferNotificationRead, type PaymentRequestNotification, type TransferRequestNotification } from "../../lib/supabase";

interface ActivityItem {
  id: string;
  kind: "pledge" | "transfer";
  // pledge fields
  type?: "created" | "completed" | "defaulted" | "deposit" | "cancelled" | "downpayment" | "fulfilment";
  pledgeId?: string;
  // transfer fields
  direction?: "sent" | "received";
  counterparty?: string;
  // shared
  title: string;
  sub: string;
  amount?: string;
  fee?: string;
  sign?: "positive" | "negative" | "neutral";
  href: string;
  blockNumber: number;
}

interface DeadlineWarning {
  pledgeId: string;
  hoursLeft: number;
  amount: string;
  commitmentDate: bigint;
}

const STORAGE_KEY = "remitsafe_read_notifs";
function getReadIds(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]")); }
  catch { return new Set(); }
}
function markRead(ids: string[]) {
  const existing = getReadIds();
  ids.forEach((id) => existing.add(id));
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...existing]));
}

const PLEDGE_ICON: Record<string, React.ReactNode> = {
  created:     <PlusCircle size={18} color="#DDE048" />,
  completed:   <CheckCircle2 size={18} color="#22c55e" />,
  defaulted:   <AlertCircle size={18} color="#ef4444" />,
  deposit:     <ArrowDownCircle size={18} color="#60a5fa" />,
  cancelled:   <XCircle size={18} color="#888" />,
  downpayment: <ArrowDownCircle size={18} color="#f59e0b" />,
  fulfilment:  <CheckCircle2 size={18} color="#60a5fa" />,
};
const PLEDGE_BG: Record<string, string> = {
  created: "#DDE04822", completed: "#22c55e22", defaulted: "#ef444422",
  deposit: "#60a5fa22", cancelled: "#88888822",
  downpayment: "#f59e0b22", fulfilment: "#60a5fa22",
};

export default function Notifications() {
  const { account, accountId, provider, pledgeRead, walletLoading } = useWallet();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [paymentReqNotifs, setPaymentReqNotifs] = useState<PaymentRequestNotification[]>([]);
  const [transferReqNotifs, setTransferReqNotifs] = useState<TransferRequestNotification[]>([]);
  const [deadlineWarnings, setDeadlineWarnings] = useState<DeadlineWarning[]>([]);
  const [tab, setTab] = useState<"all" | "requests" | "sent" | "received">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    if (account && accountId) { setReadIds(getReadIds()); loadAll(); }
    else if (!walletLoading) setLoading(false);
  }, [account, accountId, walletLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadActivity(), loadPaymentReqNotifs(), loadTransferReqNotifs()]);
    } catch (err) {
      console.error("Failed to load notifications:", err);
    } finally { setLoading(false); }
  }

  async function loadDeadlineWarnings(pendingPledges: { id: string; commitmentDate: bigint; totalAmount: bigint }[]) {
    const now = Date.now() / 1000;
    const warnings: DeadlineWarning[] = [];
    for (const p of pendingPledges) {
      const deadline = Number(p.commitmentDate);
      const secondsLeft = deadline - now;
      const hoursLeft = secondsLeft / 3600;
      // warn if deadline is within 24 hours and hasn't passed yet
      if (hoursLeft > 0 && hoursLeft <= 24) {
        warnings.push({
          pledgeId: p.id,
          hoursLeft: Math.ceil(hoursLeft),
          amount: parseFloat(ethers.formatUnits(p.totalAmount, 6)).toFixed(2),
          commitmentDate: p.commitmentDate,
        });
      }
    }
    setDeadlineWarnings(warnings);
  }

  async function loadPaymentReqNotifs() {
    try {
      const data = await getSenderNotifications(account!);
      setPaymentReqNotifs(data);
    } catch (err) {
      console.error("Failed to load payment request notifications:", err);
    }
  }

  async function loadTransferReqNotifs() {
    try {
      const data = await getTransferRequestNotifications(account!);
      setTransferReqNotifs(data);
    } catch (err) {
      console.error("Failed to load transfer request notifications:", err);
    }
  }

  async function loadActivity() {
    const pledgeIface = new ethers.Interface(RemittancePledgeABI);
    const usdcIface = new ethers.Interface(MockUSDCABI);
    const addr = account!.toLowerCase();
    const addrAccountId = accountId?.toLowerCase() ?? "";
    const pledgeContract = CONTRACTS.REMITTANCE_PLEDGE.toLowerCase();
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 4998);

    // New contract uses bytes32 accountId in indexed topics
    const paddedAccountId = addrAccountId ? addrAccountId : ethers.zeroPadValue(account!, 32);

    const [createdSender, createdMerchant, completed, defaulted, deposits, cancelled, usdcSent, usdcReceived] = await Promise.all([
      // PledgeCreated(uint256 pledgeId, bytes32 merchantAccount, bytes32 payerAccount, ...)
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCreated(uint256,bytes32,bytes32,address,uint256,uint256,uint256)"), null, null, paddedAccountId], fromBlock }),
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCreated(uint256,bytes32,bytes32,address,uint256,uint256,uint256)"), null, paddedAccountId], fromBlock }),
      // PledgeCompleted(uint256 pledgeId, bytes32 merchantAccount, uint256 amount)
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCompleted(uint256,bytes32,uint256)"), null, paddedAccountId], fromBlock }),
      // PledgeDefaulted(uint256 pledgeId, bytes32 merchantAccount, uint256 amount)
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeDefaulted(uint256,bytes32,uint256)"), null, paddedAccountId], fromBlock }),
      // DepositMade(uint256 pledgeId, bytes32 payerAccount, address wallet, uint256 amount, uint256 totalDeposited)
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("DepositMade(uint256,bytes32,address,uint256,uint256)"), null, paddedAccountId], fromBlock }),
      // PledgeCancelled(uint256 pledgeId, bytes32 payerAccount, bytes32 merchantAccount, uint256 refund)
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCancelled(uint256,bytes32,bytes32,uint256)"), null, paddedAccountId], fromBlock }),
      provider.getLogs({ address: CONTRACTS.MOCK_USDC, topics: [ethers.id("Transfer(address,address,uint256)"), ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.MOCK_USDC, topics: [ethers.id("Transfer(address,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
    ]);

    const results: ActivityItem[] = [];

    // Build pledgeId → totalAmount map from PledgeCreated events so we can detect full payments in DepositMade
    // PledgeCreated args: pledgeId, merchant, payer, token, totalAmount, commitmentDate, appliedFeeBps
    const pledgeTotalMap = new Map<string, number>();

    for (const log of [...createdSender, ...createdMerchant]) {
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      // PledgeCreated(pledgeId, merchantAccount, payerAccount, token, totalAmount, commitmentDate, appliedFeeBps)
      const isMerchant = p.args[1].toLowerCase() === addrAccountId;
      const isPayer    = p.args[2].toLowerCase() === addrAccountId;
      const total = parseFloat(ethers.formatUnits(p.args[4], 6));
      const fee = parseFloat((total * 0.01).toFixed(2));
      pledgeTotalMap.set(pledgeId, total);

      results.push({ id: log.transactionHash + "_created", kind: "pledge", type: "created", pledgeId, amount: total.toFixed(2),
        fee: isMerchant ? fee.toFixed(2) : undefined,
        sign: isPayer ? "negative" : "positive",
        title: isPayer ? "Pledge payment requested" : "Pledge invoice created",
        sub: isPayer
          ? `${total.toFixed(2)} USDC payment requested · #${pledgeId}`
          : `${total.toFixed(2)} USDC requested from payer · #${pledgeId}`,
        href: `/pledge/${pledgeId}`, blockNumber: log.blockNumber });
    }
    for (const log of completed) {
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      const amount = parseFloat(ethers.formatUnits(p.args[2], 6)).toFixed(2);
      results.push({ id: log.transactionHash + "_completed", kind: "pledge", type: "completed", pledgeId, amount,
        sign: "positive",
        title: "Pledge completed", sub: `${amount} USDC released · #${pledgeId}`,
        href: `/pledge/${pledgeId}`, blockNumber: log.blockNumber });
    }
    for (const log of defaulted) {
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      const amount = parseFloat(ethers.formatUnits(p.args[2], 6)).toFixed(2);
      results.push({ id: log.transactionHash + "_defaulted", kind: "pledge", type: "defaulted", pledgeId, amount,
        sign: "negative",
        title: "Pledge defaulted", sub: `${amount} USDC claimed · #${pledgeId}`,
        href: `/pledge/${pledgeId}`, blockNumber: log.blockNumber });
    }
    for (const log of deposits) {
      // DepositMade(pledgeId, payerAccount, wallet, amount, totalDeposited)
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      const amount = parseFloat(ethers.formatUnits(p.args[3], 6));
      const totalDeposited = parseFloat(ethers.formatUnits(p.args[4], 6));
      const pledgeTotal = pledgeTotalMap.get(pledgeId);
      const isFullPayment = pledgeTotal !== undefined && totalDeposited >= pledgeTotal;
      results.push({ id: log.transactionHash + "_deposit", kind: "pledge",
        type: isFullPayment ? "fulfilment" : "deposit",
        pledgeId, amount: amount.toFixed(2),
        sign: "negative",
        title: isFullPayment ? "Full payment sent" : "Installment payment",
        sub: isFullPayment
          ? `Pledge #${pledgeId} fully paid · ${amount.toFixed(2)} USDC`
          : `You paid ${amount.toFixed(2)} USDC · #${pledgeId}`,
        href: `/pledge/${pledgeId}`, blockNumber: log.blockNumber });
    }
    for (const log of cancelled) {
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      results.push({ id: log.transactionHash + "_cancelled", kind: "pledge", type: "cancelled", pledgeId,
        sign: "positive",
        title: "Pledge cancelled", sub: `Pledge #${pledgeId} cancelled · deposit refunded`,
        href: `/pledge/${pledgeId}`, blockNumber: log.blockNumber });
    }
    for (const log of usdcSent) {
      const p = usdcIface.parseLog(log); if (!p) continue;
      const to = p.args[1].toLowerCase();
      if (to === addr || to === pledgeContract) continue;
      const amount = parseFloat(ethers.formatUnits(p.args[2], 6)).toFixed(2);
      const short = p.args[1].slice(0, 6) + "…" + p.args[1].slice(-4);
      results.push({ id: log.transactionHash + "_sent", kind: "transfer", direction: "sent", counterparty: p.args[1], amount,
        title: "Sent USDC", sub: `To ${short}`,
        href: `https://explorer-hoodi.morph.network/tx/${log.transactionHash}`, blockNumber: log.blockNumber });
    }
    for (const log of usdcReceived) {
      const p = usdcIface.parseLog(log); if (!p) continue;
      const from = p.args[0].toLowerCase();
      if (from === addr || from === pledgeContract) continue;
      const amount = parseFloat(ethers.formatUnits(p.args[2], 6)).toFixed(2);
      const short = p.args[0].slice(0, 6) + "…" + p.args[0].slice(-4);
      results.push({ id: log.transactionHash + "_received", kind: "transfer", direction: "received", counterparty: p.args[0], amount,
        title: "Received USDC", sub: `From ${short}`,
        href: `https://explorer-hoodi.morph.network/tx/${log.transactionHash}`, blockNumber: log.blockNumber });
    }

    // Fetch ALL pledge IDs from contract storage (not limited by block range)
    try {
      const [senderIds, merchantIds] = await Promise.all([
        accountId ? (pledgeRead.getAccountPayerPledges(accountId) as Promise<bigint[]>) : Promise.resolve([]),
        accountId ? (pledgeRead.getAccountMerchantPledges(accountId) as Promise<bigint[]>) : Promise.resolve([]),
      ]);
      const allIds = [...new Set([...senderIds, ...merchantIds].map((id) => id.toString()))];
      const allPledges = (await Promise.all(
        allIds.map((id) => pledgeRead.getPledge(id))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      )).map((p: any) => ({ ...p, payer: p.payerAccount ?? p.payer ?? "", merchant: p.merchantAccount ?? p.merchant ?? "", status: Number(p.status) }));

      // Entries with type "downpayment"/"fulfilment"/"deposit" share a pledgeId with "created" — only skip if
      // the pledge itself (created event) was already seen
      const seenCreatedIds = new Set(
        results.filter((r) => r.pledgeId && r.type === "created").map((r) => r.pledgeId)
      );
      const STATUS_LABELS = ["PENDING", "COMPLETED", "DEFAULTED", "CANCELLED"];
      const typeMap: Record<string, ActivityItem["type"]> = { COMPLETED: "completed", DEFAULTED: "defaulted", CANCELLED: "cancelled", PENDING: "created" };

      for (const p of allPledges) {
        const pledgeId = p.id.toString();
        const total = parseFloat(ethers.formatUnits(p.totalAmount, 6));
        // Populate map so any DepositMade log for this pledge can detect full payments
        if (!pledgeTotalMap.has(pledgeId)) pledgeTotalMap.set(pledgeId, total);
        if (seenCreatedIds.has(pledgeId)) continue;
        const isPayer = p.payer.toLowerCase() === addrAccountId || p.payer.toLowerCase() === addr;
        const statusLabel = STATUS_LABELS[p.status] ?? "UNKNOWN";
        results.push({
          id: `pledge_${pledgeId}_contract`,
          kind: "pledge",
          type: typeMap[statusLabel] ?? "created",
          pledgeId,
          amount: total.toFixed(2),
          sign: isPayer ? "negative" : "positive",
          title: isPayer ? `Pledge #${pledgeId}` : `Received pledge #${pledgeId}`,
          sub: `${total.toFixed(2)} USDC · ${statusLabel}`,
          href: `/pledge/${pledgeId}`,
          blockNumber: 0,
        });
      }

      // Deadline warnings: pending pledges where user is payer and deadline is within 24h
      const pendingForWarning = allPledges.filter((p) => p.status === 0 && (p.payer.toLowerCase() === addrAccountId || p.payer.toLowerCase() === addr));
      await loadDeadlineWarnings(pendingForWarning.map((p) => ({ id: p.id.toString(), commitmentDate: p.commitmentDate, totalAmount: p.totalAmount })));
    } catch (_) {
      // contract read failed, continue with log-based results only
    }

    results.sort((a, b) => b.blockNumber - a.blockNumber);
    setActivity(results);
    setPage(1);
    // Clear the dirty flag — user is now viewing activity
    localStorage.setItem("remitsafe_notif_dirty", "false");
    localStorage.setItem("remitsafe_pledge_count", String(results.filter((r) => r.kind === "pledge" && r.type === "created").length));
    window.dispatchEvent(new Event("storage"));
    markRead(results.map((n) => n.id));
    setReadIds(getReadIds());
  }

  if (walletLoading) return <LoadingSpinner fullScreen />;

  const filteredActivity = tab === "sent"
    ? activity.filter((a) => a.sign === "negative" || (a.kind === "transfer" && a.direction === "sent"))
    : tab === "received"
    ? activity.filter((a) => a.sign === "positive" || (a.kind === "transfer" && a.direction === "received"))
    : activity;

  const showRequests = tab === "all" || tab === "requests";
  const showActivity = tab !== "requests";

  const totalPages = Math.max(1, Math.ceil(filteredActivity.length / PAGE_SIZE));
  const paged = filteredActivity.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function Pagination() {
    if (totalPages <= 1) return null;
    return (
      <div className="flex items-center justify-end gap-2 mt-4 px-1">
        <span className="text-xs text-[#777]">{page} / {totalPages}</span>
        <div className="flex items-center gap-px bg-[#13161c] border border-[#1e2230] rounded-lg overflow-hidden">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}
            className="px-3 py-1.5 text-xs text-[#777] hover:text-white hover:bg-[#1e2230] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">‹ Prev</button>
          <div className="w-px h-5 bg-[#1e2230]" />
          <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page === totalPages}
            className="px-3 py-1.5 text-xs text-[#777] hover:text-white hover:bg-[#1e2230] transition-colors disabled:opacity-30 disabled:cursor-not-allowed">Next ›</button>
        </div>
      </div>
    );
  }

  function ActivityIcon({ item }: { item: ActivityItem }) {
    if (item.kind === "transfer") {
      const isSent = item.direction === "sent";
      return (
        <div className={`w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center ${isSent ? "bg-[#ef444422]" : "bg-[#22c55e22]"}`}>
          {isSent ? <ArrowUpRight size={18} color="#ef4444" /> : <ArrowDownLeft size={18} color="#22c55e" />}
        </div>
      );
    }
    return (
      <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: PLEDGE_BG[item.type!] }}>
        {PLEDGE_ICON[item.type!]}
      </div>
    );
  }

  function AmountBadge({ item }: { item: ActivityItem }) {
    if (!item.amount) return null;
    const sign = item.kind === "transfer"
      ? (item.direction === "sent" ? "negative" : "positive")
      : item.sign;
    const color = !sign || sign === "neutral" ? "text-[#888]" : sign === "positive" ? "text-[#22c55e]" : "text-[#ef4444]";
    const prefix = sign === "positive" ? "+" : sign === "negative" ? "−" : "";
    return (
      <div className="text-right shrink-0">
        <div className={`text-sm font-bold ${color}`}>{prefix}{item.amount} <span className="text-xs font-normal text-[#555]">USDC</span></div>
        {item.fee && <div className="text-[11px] text-[#555] mt-0.5">fee {item.fee} USDC</div>}
      </div>
    );
  }

  const TABS = [
    { key: "all",      label: "All" },
    { key: "requests", label: "Requests" },
    { key: "sent",     label: "Sent" },
    { key: "received", label: "Received" },
  ] as const;

  function TabBar({ className }: { className?: string }) {
    return (
      <div className={`flex items-center gap-1 ${className ?? ""}`}>
        {TABS.map((t) => (
          <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
            className={`px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
              tab === t.key ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "border-[#1e2230] text-[#555] hover:text-[#888]"
            }`}>
            {t.label}
          </button>
        ))}
      </div>
    );
  }

  /* ── DESKTOP ── */
  const Desktop = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Activity</h1>
      <p className="text-[#555] text-sm mb-4">Your transactions and pledge events, newest first.</p>

      <TabBar className="mb-6" />

      {!account ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bell size={40} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">Wallet not connected</div>
          <div className="text-[#555] text-sm">Connect your wallet to see activity</div>
        </div>
      ) : (
        <>
          {/* Deadline warnings */}
          {(tab === "all" || tab === "sent") && deadlineWarnings.length > 0 && (
            <div className="mb-6">
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">URGENT · DEADLINE TODAY</div>
              <div className="space-y-2">
                {deadlineWarnings.map((w) => (
                  <Link key={w.pledgeId} href={`/pledge/${w.pledgeId}`}
                    className="flex items-center gap-4 p-4 rounded-2xl border border-[#f59e0b]/40 bg-[#f59e0b08] hover:border-[#f59e0b]/60 transition-colors no-underline text-inherit">
                    <div className="w-10 h-10 rounded-full bg-[#f59e0b22] flex items-center justify-center shrink-0">
                      <Clock size={18} color="#f59e0b" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className="font-bold text-white text-sm">Last day before grace period</span>
                        <span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
                      </div>
                      <div className="text-xs text-[#888]">Pledge #{w.pledgeId} · {w.amount} USDC · {w.hoursLeft}h left to pay before grace activates</div>
                    </div>
                    <div className="text-[#f59e0b] text-xs font-bold shrink-0">Pay now →</div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Transfer requests (off-chain negotiation notifications) */}
          {showRequests && transferReqNotifs.length > 0 && (
            <div className="mb-6">
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">TRANSFER REQUESTS</div>
              <div className="space-y-2">
                {transferReqNotifs.map((n) => {
                  const r = n.transfer_requests;
                  const trType = n.type;
                  const label: Record<string, string> = {
                    new_request: "New transfer request",
                    renegotiated: "Merchant proposed new terms",
                    accepted: "Merchant accepted your request",
                    rejected: "Merchant rejected your request",
                    cancelled: "Request was cancelled",
                    confirmed: "Transfer confirmed on-chain",
                  };
                  const color: Record<string, string> = {
                    new_request: "#DDE048", renegotiated: "#60a5fa", accepted: "#22c55e",
                    rejected: "#ef4444", cancelled: "#888", confirmed: "#22c55e",
                  };
                  const isMerchantNotif = r && r.merchant_address === account?.toLowerCase();
                  const detailHref = isMerchantNotif
                    ? `/merchant/transfers/requests/${n.request_id}`
                    : `/pledges/requests/${n.request_id}`;
                  return (
                    <Link key={n.id} href={detailHref}
                      onClick={() => markTransferNotificationRead(n.id)}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-colors no-underline text-inherit ${
                        n.read ? "bg-[#13161c] border-[#1e2230] hover:border-[#DDE048]/30" : "bg-[#1a1d12] border-[#DDE048]/20 hover:border-[#DDE048]/30"
                      }`}>
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                        style={{ background: color[trType] + "22", border: `1px solid ${color[trType]}33` }}>
                        <FileText size={18} color={color[trType]} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-white text-sm truncate">{label[trType] ?? trType}</span>
                          {!n.read && <span className="w-2 h-2 rounded-full bg-[#DDE048] shrink-0" />}
                        </div>
                        {r && (
                          <div className="text-xs text-[#888]">
                            {r.type === "installment"
                              ? `${r.amount_per_period?.toFixed(2) ?? "—"} ${r.token} × ${r.total_periods ?? "?"} payments`
                              : `${r.total_amount?.toFixed(2) ?? "—"} ${r.token}`}
                          </div>
                        )}
                      </div>
                      <div className="text-[#DDE048] text-xs font-bold shrink-0">View →</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payment requests */}
          {showRequests && paymentReqNotifs.length > 0 && (
            <div className="mb-6">
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">PAYMENT REQUESTS</div>
              <div className="space-y-2">
                {paymentReqNotifs.map((n) => {
                  const req = n.payment_requests;
                  if (!req) return null;
                  const days = Math.ceil((new Date(req.deadline.replace(" ", "T")).getTime() - Date.now()) / 86400000);
                  return (
                    <Link key={n.id} href={req.status === "fulfilled" ? "#" : `/new-transfer?request=${req.id}&notif=${n.id}`}
                      onClick={() => { if (req.status !== "fulfilled") markNotificationRead(n.id); }}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-colors no-underline text-inherit ${req.status === "fulfilled" ? "opacity-60 cursor-default border-[#1e2230] bg-[#13161c]" : n.read ? "bg-[#13161c] border-[#1e2230] hover:border-[#DDE048]/30" : "bg-[#1a1d12] border-[#DDE048]/20 hover:border-[#DDE048]/30"}`}>
                      <div className="w-10 h-10 rounded-xl bg-[#DDE048]/10 border border-[#DDE048]/20 flex items-center justify-center shrink-0">
                        <FileText size={18} color="#DDE048" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="font-bold text-white text-sm truncate">{req.title || "Payment Request"}</span>
                          {!n.read && <span className="w-2 h-2 rounded-full bg-[#DDE048] shrink-0" />}
                        </div>
                        <div className="text-xs text-[#888]">{req.amount.toFixed(2)} USDC · {days > 0 ? `${days}d left` : "Overdue"} · from {req.merchant_address.slice(0, 6)}…{req.merchant_address.slice(-4)}</div>
                      </div>
                      {req.status === "fulfilled"
                        ? <div className="flex items-center gap-1 text-[#22c55e] text-xs font-bold shrink-0"><CheckCircle2 size={13} /> Paid</div>
                        : <div className="text-[#DDE048] text-xs font-bold shrink-0">Pay →</div>}

                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {loading && <LoadingSpinner />}

          {!loading && showActivity && filteredActivity.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell size={40} color="#333" className="mb-3" />
              <div className="font-bold text-white mb-1.5">No activity yet</div>
              <div className="text-[#555] text-sm">Your pledge events and transfers will appear here</div>
            </div>
          )}

          {!loading && showActivity && filteredActivity.length > 0 && (
            <>
            <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
              {paged.map((item) => {
                const isUnread = !readIds.has(item.id);
                const isExternal = item.href.startsWith("http");
                const inner = (
                  <div className={`flex items-center gap-4 px-6 py-4 border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors ${isUnread ? "bg-[#DDE04806]" : ""}`}>
                    <ActivityIcon item={item} />
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${isUnread ? "text-white" : "text-[#aaa]"}`}>{item.title}</div>
                      <div className="text-xs text-[#555] mt-0.5">{item.sub}</div>
                    </div>
                    <AmountBadge item={item} />
                    {isUnread && <div className="w-2 h-2 rounded-full bg-[#DDE048] flex-shrink-0" />}
                  </div>
                );
                return isExternal
                  ? <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" className="block no-underline text-inherit">{inner}</a>
                  : <Link key={item.id} href={item.href} className="block no-underline text-inherit">{inner}</Link>;
              })}
            </div>
            <Pagination />
            </>
          )}
        </>
      )}
    </div>
  );

  /* ── MOBILE ── */
  const Mobile = (
    <div className="md:hidden min-h-screen">
      <Header title="Activity" back />
      <div className="px-4 pt-4 pb-[120px]">
        {/* Tab bar */}
        <div className="flex gap-1 overflow-x-auto pb-1 mb-4 scrollbar-hide">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => { setTab(t.key); setPage(1); }}
              className={`shrink-0 px-4 py-2 rounded-full text-xs font-semibold border transition-colors ${
                tab === t.key ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]" : "border-[#1F2127] text-[#555]"
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {!account && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell size={40} color="#444" className="mb-3" />
            <div className="font-bold mb-1.5">Wallet not connected</div>
            <div className="text-[#888] text-sm">Connect your wallet to see activity</div>
          </div>
        )}

        {/* Deadline warnings */}
        {!loading && account && (tab === "all" || tab === "sent") && deadlineWarnings.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">URGENT · DEADLINE TODAY</div>
            {deadlineWarnings.map((w) => (
              <Link key={w.pledgeId} href={`/pledge/${w.pledgeId}`}
                className="flex items-center gap-3.5 p-3.5 rounded-2xl mb-2 border border-[#f59e0b]/40 bg-[#f59e0b08] no-underline text-inherit">
                <div className="w-10 h-10 rounded-full bg-[#f59e0b22] flex items-center justify-center shrink-0">
                  <Clock size={18} color="#f59e0b" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-bold text-white text-sm truncate">Last day before grace period</span>
                    <span className="w-2 h-2 rounded-full bg-[#f59e0b] shrink-0" />
                  </div>
                  <div className="text-xs text-[#888]">Pledge #{w.pledgeId} · {w.amount} USDC · {w.hoursLeft}h left</div>
                </div>
                <span className="text-[#f59e0b] text-xs font-bold shrink-0">Pay →</span>
              </Link>
            ))}
          </div>
        )}

        {/* Transfer requests mobile */}
        {!loading && account && showRequests && transferReqNotifs.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">TRANSFER REQUESTS</div>
            {transferReqNotifs.map((n) => {
              const r = n.transfer_requests;
              const trType = n.type;
              const label: Record<string, string> = {
                new_request: "New transfer request", renegotiated: "Merchant proposed new terms",
                accepted: "Merchant accepted your request", rejected: "Merchant rejected",
                cancelled: "Request cancelled", confirmed: "Transfer confirmed",
              };
              const color: Record<string, string> = {
                new_request: "#DDE048", renegotiated: "#60a5fa", accepted: "#22c55e",
                rejected: "#ef4444", cancelled: "#888", confirmed: "#22c55e",
              };
              const isMerchantNotif = r && r.merchant_address === account?.toLowerCase();
              const detailHref = isMerchantNotif ? `/merchant/transfers/requests/${n.request_id}` : `/pledges/requests/${n.request_id}`;
              return (
                <Link key={n.id} href={detailHref}
                  onClick={() => markTransferNotificationRead(n.id)}
                  className={`flex items-center gap-3.5 p-3.5 rounded-2xl mb-2 border no-underline text-inherit ${n.read ? "border-[#1F2127] bg-[#11141A]" : "border-[#DDE048]/20 bg-[#1a1d12]"}`}>
                  <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                    style={{ background: color[trType] + "22", border: `1px solid ${color[trType]}33` }}>
                    <FileText size={18} color={color[trType]} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-white text-sm truncate">{label[trType] ?? trType}</span>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[#DDE048] shrink-0" />}
                    </div>
                    {r && (
                      <div className="text-xs text-[#888]">
                        {r.type === "installment" ? `${r.amount_per_period?.toFixed(2) ?? "—"} ${r.token} × ${r.total_periods ?? "?"}` : `${r.total_amount?.toFixed(2) ?? "—"} ${r.token}`}
                      </div>
                    )}
                  </div>
                  <span className="text-[#DDE048] text-xs font-bold shrink-0">View →</span>
                </Link>
              );
            })}
          </div>
        )}

        {/* Payment requests */}
        {!loading && account && showRequests && paymentReqNotifs.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">PAYMENT REQUESTS</div>
            {paymentReqNotifs.map((n) => {
              const req = n.payment_requests;
              if (!req) return null;
              const days = Math.ceil((new Date(req.deadline.replace(" ", "T")).getTime() - Date.now()) / 86400000);
              return (
                <Link key={n.id} href={req.status === "fulfilled" ? "#" : `/new-transfer?request=${req.id}&notif=${n.id}`}
                  onClick={() => { if (req.status !== "fulfilled") markNotificationRead(n.id); }}
                  className={`flex items-center gap-3.5 p-3.5 rounded-2xl mb-2 border no-underline text-inherit ${req.status === "fulfilled" ? "opacity-60 cursor-default border-[#1F2127] bg-[#11141A]" : n.read ? "border-[#1F2127] bg-[#11141A]" : "border-[#DDE048]/20 bg-[#1a1d12]"}`}>
                  <div className="w-10 h-10 rounded-xl bg-[#DDE048]/10 border border-[#DDE048]/20 flex items-center justify-center shrink-0">
                    <FileText size={18} color="#DDE048" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="font-bold text-white text-sm truncate">{req.title || "Payment Request"}</span>
                      {!n.read && <span className="w-2 h-2 rounded-full bg-[#DDE048] shrink-0" />}
                    </div>
                    <div className="text-xs text-[#888]">{req.amount.toFixed(2)} USDC · {days > 0 ? `${days}d left` : "Overdue"}</div>
                  </div>
                  {req.status === "fulfilled"
                    ? <span className="flex items-center gap-1 text-[#22c55e] text-xs font-bold shrink-0"><CheckCircle2 size={13} /> Paid</span>
                    : <span className="text-[#DDE048] text-xs font-bold shrink-0">Pay →</span>}

                </Link>
              );
            })}
          </div>
        )}

        {loading && <LoadingSpinner />}

        {!loading && account && showActivity && filteredActivity.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Bell size={40} color="#444" className="mb-3" />
            <div className="font-bold mb-1.5">No activity yet</div>
            <div className="text-[#888] text-sm">Your pledge events and transfers will appear here</div>
          </div>
        )}

        {!loading && account && showActivity && filteredActivity.length > 0 && (
          <>
            {paged.map((item) => {
              const isUnread = !readIds.has(item.id);
              const isExternal = item.href.startsWith("http");
              const inner = (
                <div className={`flex items-center gap-3.5 p-3.5 rounded-2xl mb-2 border ${isUnread ? "border-[#DDE04833] bg-[#DDE04808]" : "border-[#1F2127] bg-[#11141A]"}`}>
                  <ActivityIcon item={item} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <div className={`text-sm font-semibold ${isUnread ? "text-white" : "text-[#aaa]"}`}>{item.title}</div>
                      {isUnread && <div className="w-2 h-2 rounded-full bg-[#DDE048] flex-shrink-0" />}
                    </div>
                    <div className="flex items-center justify-between gap-2 mt-0.5">
                      <div className="text-xs text-[#666] leading-relaxed truncate">{item.sub}</div>
                      <AmountBadge item={item} />
                    </div>
                  </div>
                </div>
              );
              return isExternal
                ? <a key={item.id} href={item.href} target="_blank" rel="noopener noreferrer" className="block no-underline text-inherit">{inner}</a>
                : <Link key={item.id} href={item.href} className="block no-underline text-inherit">{inner}</Link>;
            })}
            <Pagination />
          </>
        )}
      </div>
    </div>
  );

  return (
    <>
      {Desktop}
      {Mobile}
    </>
  );
}

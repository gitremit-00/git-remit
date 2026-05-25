"use client";
import Header from "../../components/Header";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Bell, CheckCircle2, AlertCircle, ArrowDownCircle, PlusCircle, XCircle, FileText, ArrowUpRight, ArrowDownLeft } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import { CONTRACTS } from "../../contracts/addresses";
import RemittancePledgeABI from "../../contracts/RemittancePledge.json";
import MockUSDCABI from "../../contracts/MockUSDC.json";
import { getSenderNotifications, markNotificationRead, type PaymentRequestNotification } from "../../lib/supabase";

interface ActivityItem {
  id: string;
  kind: "pledge" | "transfer";
  // pledge fields
  type?: "created" | "completed" | "defaulted" | "deposit" | "cancelled";
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
  created:   <PlusCircle size={18} color="#DDE048" />,
  completed: <CheckCircle2 size={18} color="#22c55e" />,
  defaulted: <AlertCircle size={18} color="#ef4444" />,
  deposit:   <ArrowDownCircle size={18} color="#60a5fa" />,
  cancelled: <XCircle size={18} color="#888" />,
};
const PLEDGE_BG: Record<string, string> = {
  created: "#DDE04822", completed: "#22c55e22", defaulted: "#ef444422", deposit: "#60a5fa22", cancelled: "#88888822",
};

export default function Notifications() {
  const { account, provider, walletLoading } = useWallet();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [paymentReqNotifs, setPaymentReqNotifs] = useState<PaymentRequestNotification[]>([]);
  const [tab, setTab] = useState<"all" | "requests" | "sent" | "received">("all");
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  useEffect(() => {
    if (account) { setReadIds(getReadIds()); loadAll(); }
    else if (!walletLoading) setLoading(false);
  }, [account, walletLoading]);

  async function loadAll() {
    setLoading(true);
    try {
      await Promise.all([loadActivity(), loadPaymentReqNotifs()]);
    } finally { setLoading(false); }
  }

  async function loadPaymentReqNotifs() {
    const data = await getSenderNotifications(account!);
    setPaymentReqNotifs(data);
  }

  async function loadActivity() {
    const pledgeIface = new ethers.Interface(RemittancePledgeABI);
    const usdcIface = new ethers.Interface(MockUSDCABI);
    const addr = account!.toLowerCase();
    const pledgeContract = CONTRACTS.REMITTANCE_PLEDGE.toLowerCase();
    const latest = await provider.getBlockNumber();
    const fromBlock = Math.max(0, latest - 4998);

    const [createdSender, createdMerchant, completed, defaulted, deposits, cancelled, usdcSent, usdcReceived] = await Promise.all([
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCreated(uint256,address,address,uint256,uint256,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCreated(uint256,address,address,uint256,uint256,uint256)"), null, null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCompleted(uint256,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeDefaulted(uint256,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("DepositMade(uint256,address,uint256,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCancelled(uint256,address,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.MOCK_USDC, topics: [ethers.id("Transfer(address,address,uint256)"), ethers.zeroPadValue(account!, 32)], fromBlock }),
      provider.getLogs({ address: CONTRACTS.MOCK_USDC, topics: [ethers.id("Transfer(address,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
    ]);

    const results: ActivityItem[] = [];

    for (const log of [...createdSender, ...createdMerchant]) {
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      const isSender = p.args[1].toLowerCase() === addr;
      const total = parseFloat(ethers.formatUnits(p.args[3], 6));
      const fee = parseFloat((total * 0.01).toFixed(2));
      const gross = parseFloat((total * 1.01).toFixed(2));
      const amount = total.toFixed(2);
      results.push({ id: log.transactionHash + "_created", kind: "pledge", type: "created", pledgeId, amount,
        fee: isSender ? fee.toFixed(2) : undefined,
        sign: isSender ? "negative" : "positive",
        title: isSender ? "Pledge created" : "New pledge received",
        sub: isSender ? `You pledged · #${pledgeId}` : `${total.toFixed(2)} USDC pledged to you · #${pledgeId}`,
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
      const p = pledgeIface.parseLog(log); if (!p) continue;
      const pledgeId = p.args[0].toString();
      const amount = parseFloat(ethers.formatUnits(p.args[2], 6)).toFixed(2);
      results.push({ id: log.transactionHash + "_deposit", kind: "pledge", type: "deposit", pledgeId, amount,
        sign: "negative",
        title: "Deposit made", sub: `You deposited ${amount} USDC · #${pledgeId}`,
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

    results.sort((a, b) => b.blockNumber - a.blockNumber);
    setActivity(results);
    setPage(1);
    localStorage.setItem("remitsafe_notif_count", results.length.toString());
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

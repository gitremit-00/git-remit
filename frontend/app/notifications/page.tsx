"use client";
import Header from "../../components/Header";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Bell, CheckCircle2, AlertCircle, ArrowDownCircle, PlusCircle, XCircle, FileText } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import { CONTRACTS } from "../../contracts/addresses";
import RemittancePledgeABI from "../../contracts/RemittancePledge.json";
import { getSenderNotifications, markNotificationRead, type PaymentRequestNotification } from "../../lib/supabase";

interface Notification {
  id: string;
  type: "created" | "completed" | "defaulted" | "deposit" | "cancelled";
  pledgeId: string;
  title: string;
  sub: string;
  txHash: string;
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

const TYPE_ICON: Record<string, React.ReactNode> = {
  created:   <PlusCircle size={20} color="#DDE048" />,
  completed: <CheckCircle2 size={20} color="#22c55e" />,
  defaulted: <AlertCircle size={20} color="#ef4444" />,
  deposit:   <ArrowDownCircle size={20} color="#60a5fa" />,
  cancelled: <XCircle size={20} color="#888" />,
};

const TYPE_COLOR: Record<string, string> = {
  created:   "#DDE04822",
  completed: "#22c55e22",
  defaulted: "#ef444422",
  deposit:   "#60a5fa22",
  cancelled: "#88888822",
};

const TYPE_FILTER_LABEL: Record<string, string> = {
  all: "All",
  created: "Created",
  completed: "Released",
  defaulted: "Defaulted",
  deposit: "Deposits",
  cancelled: "Cancelled",
};

export default function Notifications() {
  const { account, provider, walletLoading } = useWallet();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");
  const [paymentReqNotifs, setPaymentReqNotifs] = useState<PaymentRequestNotification[]>([]);

  useEffect(() => {
    if (account) { setReadIds(getReadIds()); loadNotifs(); loadPaymentReqNotifs(); }
    else if (!walletLoading) setLoading(false);
  }, [account, walletLoading]);

  async function loadPaymentReqNotifs() {
    const data = await getSenderNotifications(account!);
    setPaymentReqNotifs(data);
  }

  async function loadNotifs() {
    setLoading(true);
    try {
      const iface = new ethers.Interface(RemittancePledgeABI);
      const addr = account!.toLowerCase();
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 4998);

      const [createdSender, createdMerchant, completed, defaulted, deposits, cancelled] = await Promise.all([
        provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCreated(uint256,address,address,uint256,uint256,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
        provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCreated(uint256,address,address,uint256,uint256,uint256)"), null, null, ethers.zeroPadValue(account!, 32)], fromBlock }),
        provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCompleted(uint256,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
        provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeDefaulted(uint256,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
        provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("DepositMade(uint256,address,uint256,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
        provider.getLogs({ address: CONTRACTS.REMITTANCE_PLEDGE, topics: [ethers.id("PledgeCancelled(uint256,address,address,uint256)"), null, ethers.zeroPadValue(account!, 32)], fromBlock }),
      ]);

      const results: Notification[] = [];

      for (const log of [...createdSender, ...createdMerchant]) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const sender = parsed.args[1].toLowerCase();
        const isSender = sender === addr;
        const total = ethers.formatUnits(parsed.args[3], 6);
        results.push({ id: log.transactionHash + "_created", type: "created", pledgeId, title: isSender ? "Pledge created" : "New pledge received", sub: isSender ? `You locked funds for pledge #${pledgeId} · ${parseFloat(total).toFixed(2)} USDC` : `Pledge #${pledgeId} was created for you · ${parseFloat(total).toFixed(2)} USDC`, txHash: log.transactionHash, blockNumber: log.blockNumber });
      }
      for (const log of completed) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const amount = ethers.formatUnits(parsed.args[2], 6);
        results.push({ id: log.transactionHash + "_completed", type: "completed", pledgeId, title: "Pledge completed", sub: `Pledge #${pledgeId} completed · ${parseFloat(amount).toFixed(2)} USDC released`, txHash: log.transactionHash, blockNumber: log.blockNumber });
      }
      for (const log of defaulted) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const amount = ethers.formatUnits(parsed.args[2], 6);
        results.push({ id: log.transactionHash + "_defaulted", type: "defaulted", pledgeId, title: "Pledge defaulted", sub: `Pledge #${pledgeId} defaulted · ${parseFloat(amount).toFixed(2)} USDC claimed`, txHash: log.transactionHash, blockNumber: log.blockNumber });
      }
      for (const log of deposits) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const amount = ethers.formatUnits(parsed.args[2], 6);
        results.push({ id: log.transactionHash + "_deposit", type: "deposit", pledgeId, title: "Deposit made", sub: `You deposited ${parseFloat(amount).toFixed(2)} USDC on pledge #${pledgeId}`, txHash: log.transactionHash, blockNumber: log.blockNumber });
      }
      for (const log of cancelled) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        results.push({ id: log.transactionHash + "_cancelled", type: "cancelled", pledgeId, title: "Pledge cancelled", sub: `Pledge #${pledgeId} was cancelled and deposit refunded`, txHash: log.transactionHash, blockNumber: log.blockNumber });
      }

      results.sort((a, b) => b.blockNumber - a.blockNumber);
      setNotifs(results);
      localStorage.setItem("remitsafe_notif_count", results.length.toString());
      markRead(results.map((n) => n.id));
      setReadIds(getReadIds());
    } finally { setLoading(false); }
  }

  if (walletLoading) return <LoadingSpinner fullScreen />;

  const filtered = filter === "all" ? notifs : notifs.filter((n) => n.type === filter);
  const counts: Record<string, number> = { all: notifs.length };
  notifs.forEach((n) => { counts[n.type] = (counts[n.type] ?? 0) + 1; });

  /* ── DESKTOP LAYOUT ── */
  const DesktopActivity = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Activity</h1>
      <p className="text-[#555] text-sm mb-6">On-chain events on your transfers, ranked newest first.</p>

      {!account ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bell size={40} color="#333" className="mb-3" />
          <div className="font-bold text-white mb-1.5">Wallet not connected</div>
          <div className="text-[#555] text-sm">Connect your wallet to see activity</div>
        </div>
      ) : (
        <>
          {/* Filter tabs */}
          <div className="flex items-center gap-2 mb-6 flex-wrap">
            {["all", "created", "completed", "defaulted", "deposit", "cancelled"].map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-semibold border transition-colors ${
                  filter === f
                    ? "bg-[#DDE048]/10 border-[#DDE048] text-[#DDE048]"
                    : "bg-transparent border-[#1e2230] text-[#555] hover:text-[#888]"
                }`}
              >
                {TYPE_FILTER_LABEL[f]}
                {counts[f] > 0 && (
                  <span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${filter === f ? "bg-[#DDE048] text-black" : "bg-[#1e2230] text-[#555]"}`}>
                    {counts[f]}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* Payment request notifications */}
          {paymentReqNotifs.length > 0 && (
            <div className="mb-6">
              <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">PAYMENT REQUESTS</div>
              <div className="space-y-2">
                {paymentReqNotifs.map((n) => {
                  const req = n.payment_requests;
                  if (!req) return null;
                  const days = Math.ceil((new Date(req.deadline).getTime() - Date.now()) / 86400000);
                  const href = `/new-transfer?request=${req.id}&notif=${n.id}`;
                  return (
                    <Link key={n.id} href={href}
                      onClick={() => markNotificationRead(n.id)}
                      className={`flex items-center gap-4 p-4 rounded-2xl border transition-colors hover:border-[#DDE048]/30 ${n.read ? "bg-[#13161c] border-[#1e2230]" : "bg-[#1a1d12] border-[#DDE048]/20"}`}>
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
                      <div className="text-[#DDE048] text-xs font-bold shrink-0">Pay →</div>
                    </Link>
                  );
                })}
              </div>
            </div>
          )}

          {loading && <LoadingSpinner />}

          {!loading && filtered.length === 0 && (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Bell size={40} color="#333" className="mb-3" />
              <div className="font-bold text-white mb-1.5">No activity yet</div>
              <div className="text-[#555] text-sm">On-chain events on your pledges will appear here</div>
            </div>
          )}

          {/* Activity list */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
            {filtered.map((n, i) => {
              const isUnread = !readIds.has(n.id);
              return (
                <Link key={n.id} href={`/pledge/${n.pledgeId}`} className="block no-underline text-inherit">
                  <div className={`flex items-center gap-4 px-6 py-4 border-b border-[#1e2230] last:border-0 hover:bg-[#15181f] transition-colors ${isUnread ? "bg-[#DDE04806]" : ""}`}>
                    <div className="w-9 h-9 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: TYPE_COLOR[n.type] }}>
                      {TYPE_ICON[n.type]}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className={`text-sm font-semibold ${isUnread ? "text-white" : "text-[#aaa]"}`}>{n.title}</div>
                      <div className="text-xs text-[#555] mt-0.5 font-mono">{n.sub}</div>
                    </div>
                    <div className="text-[12px] text-[#444] whitespace-nowrap">block #{n.blockNumber}</div>
                    {isUnread && <div className="w-2 h-2 rounded-full bg-[#DDE048] flex-shrink-0" />}
                  </div>
                </Link>
              );
            })}
          </div>
        </>
      )}
    </div>
  );

  /* ── MOBILE LAYOUT ── */
  const MobileActivity = (
    <div className="md:hidden min-h-screen">
      <Header title="Notifications" back />
      <div className="px-4 pt-5 pb-[120px]">
        {!account && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell size={40} color="#444" className="mb-3" />
            <div className="font-bold mb-1.5">Wallet not connected</div>
            <div className="text-[#888] text-sm">Connect your wallet to see notifications</div>
          </div>
        )}
        {/* Payment request notifications */}
        {!loading && account && paymentReqNotifs.length > 0 && (
          <div className="mb-4">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-2">PAYMENT REQUESTS</div>
            {paymentReqNotifs.map((n) => {
              const req = n.payment_requests;
              if (!req) return null;
              const days = Math.ceil((new Date(req.deadline).getTime() - Date.now()) / 86400000);
              return (
                <Link key={n.id} href={`/new-transfer?request=${req.id}&notif=${n.id}`}
                  onClick={() => markNotificationRead(n.id)}
                  className={`flex items-center gap-3.5 p-3.5 rounded-2xl mb-2 border no-underline text-inherit ${n.read ? "border-[#1F2127] bg-[#11141A]" : "border-[#DDE048]/20 bg-[#1a1d12]"}`}>
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
                  <span className="text-[#DDE048] text-xs font-bold shrink-0">Pay →</span>
                </Link>
              );
            })}
          </div>
        )}

        {loading && <LoadingSpinner />}
        {!loading && account && notifs.length === 0 && paymentReqNotifs.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <Bell size={40} color="#444" className="mb-3" />
            <div className="font-bold mb-1.5">No notifications yet</div>
            <div className="text-[#888] text-sm">Activity on your pledges will appear here</div>
          </div>
        )}
        {notifs.map((n) => {
          const isUnread = !readIds.has(n.id);
          return (
            <Link key={n.id} href={`/pledge/${n.pledgeId}`} className="block no-underline text-inherit">
              <div className={`flex gap-3.5 p-3.5 rounded-2xl mb-2.5 border ${isUnread ? "border-[#DDE04833] bg-[#DDE04808]" : "border-[#1F2127] bg-[#11141A]"}`}>
                <div className="w-10 h-10 rounded-full flex-shrink-0 flex items-center justify-center" style={{ background: TYPE_COLOR[n.type] }}>
                  {TYPE_ICON[n.type]}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex justify-between items-start gap-2">
                    <div className={`text-sm font-semibold ${isUnread ? "text-white" : "text-[#aaa]"}`}>{n.title}</div>
                    {isUnread && <div className="w-2 h-2 rounded-full bg-[#DDE048] flex-shrink-0 mt-1" />}
                  </div>
                  <div className="text-xs text-[#666] mt-0.5 leading-relaxed">{n.sub}</div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );

  return (
    <>
      {DesktopActivity}
      {MobileActivity}
    </>
  );
}

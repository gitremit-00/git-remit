"use client";
import Header from "../../components/Header";
import { useEffect, useState } from "react";
import { ethers } from "ethers";
import Link from "next/link";
import { Bell, CheckCircle2, AlertCircle, ArrowDownCircle, PlusCircle, XCircle } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import LoadingSpinner from "../../components/LoadingSpinner";
import { CONTRACTS } from "../../contracts/addresses";
import RemittancePledgeABI from "../../contracts/RemittancePledge.json";

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

export default function Notifications() {
  const { account, provider, walletLoading } = useWallet();
  const [notifs, setNotifs] = useState<Notification[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (account) { setReadIds(getReadIds()); loadNotifs(); }
    else if (!walletLoading) setLoading(false);
  }, [account, walletLoading]);

  async function loadNotifs() {
    setLoading(true);
    try {
      const iface = new ethers.Interface(RemittancePledgeABI);
      const addr = account!.toLowerCase();
      const latest = await provider.getBlockNumber();
      const fromBlock = Math.max(0, latest - 4999);

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
        results.push({
          id: log.transactionHash + "_created",
          type: "created",
          pledgeId,
          title: isSender ? "Pledge created" : "New pledge received",
          sub: isSender ? `You locked funds for pledge #${pledgeId} · ${parseFloat(total).toFixed(2)} USDC` : `Pledge #${pledgeId} was created for you · ${parseFloat(total).toFixed(2)} USDC`,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }

      for (const log of completed) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const amount = ethers.formatUnits(parsed.args[2], 6);
        results.push({
          id: log.transactionHash + "_completed",
          type: "completed",
          pledgeId,
          title: "Pledge completed",
          sub: `Pledge #${pledgeId} completed · ${parseFloat(amount).toFixed(2)} USDC released`,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }

      for (const log of defaulted) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const amount = ethers.formatUnits(parsed.args[2], 6);
        results.push({
          id: log.transactionHash + "_defaulted",
          type: "defaulted",
          pledgeId,
          title: "Pledge defaulted",
          sub: `Pledge #${pledgeId} defaulted · ${parseFloat(amount).toFixed(2)} USDC claimed`,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }

      for (const log of deposits) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        const amount = ethers.formatUnits(parsed.args[2], 6);
        results.push({
          id: log.transactionHash + "_deposit",
          type: "deposit",
          pledgeId,
          title: "Deposit made",
          sub: `You deposited ${parseFloat(amount).toFixed(2)} USDC on pledge #${pledgeId}`,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }

      for (const log of cancelled) {
        const parsed = iface.parseLog(log);
        if (!parsed) continue;
        const pledgeId = parsed.args[0].toString();
        results.push({
          id: log.transactionHash + "_cancelled",
          type: "cancelled",
          pledgeId,
          title: "Pledge cancelled",
          sub: `Pledge #${pledgeId} was cancelled and deposit refunded`,
          txHash: log.transactionHash,
          blockNumber: log.blockNumber,
        });
      }

      results.sort((a, b) => b.blockNumber - a.blockNumber);
      setNotifs(results);

      // Store total count for header badge, then mark all as read
      localStorage.setItem("remitsafe_notif_count", results.length.toString());
      markRead(results.map((n) => n.id));
      setReadIds(getReadIds());
    } finally {
      setLoading(false);
    }
  }

  if (walletLoading) return <LoadingSpinner fullScreen />;

  return (
    <div className="min-h-screen">
      <Header title="Notifications" back />
      <div className="px-4 pt-5 pb-[120px]">

      {!account && (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <Bell size={40} color="#444" className="mb-3" />
          <div className="font-bold mb-1.5">Wallet not connected</div>
          <div className="text-[#888] text-sm">Connect your wallet to see notifications</div>
        </div>
      )}

      {loading && <LoadingSpinner />}

      {!loading && account && notifs.length === 0 && (
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
}

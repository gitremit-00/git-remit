"use client";
import { useEffect, useState } from "react";
import { Users, Store, ShieldCheck, ShieldX, Clock } from "lucide-react";
import Link from "next/link";

export default function AdminOverview() {
  const [senderCount, setSenderCount] = useState(0);
  const [merchantCount, setMerchantCount] = useState(0);
  const [pendingKYC, setPendingKYC] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/kyc/users?role=ofw_sender&status=all").then((r) => r.json()),
      fetch("/api/admin/kyc/users?role=merchant&status=all").then((r) => r.json()),
      fetch("/api/admin/kyc/users?status=pending").then((r) => r.json()),
    ]).then(([senders, merchants, pending]) => {
      setSenderCount((senders.users ?? []).length);
      setMerchantCount((merchants.users ?? []).length);
      setPendingKYC((pending.users ?? []).length);
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">Admin Overview</h1>
      <p className="text-[#555] text-sm mb-8">Platform summary and pending actions.</p>

      {loading ? (
        <div className="text-[#555] text-sm">Loading…</div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
          <StatCard label="OFW Senders" value={senderCount} Icon={Users} href="/admin/users" />
          <StatCard label="Merchants" value={merchantCount} Icon={Store} href="/admin/merchants" />
          <StatCard label="Pending KYC" value={pendingKYC} Icon={Clock} href="/admin/kyc"
            accent={pendingKYC > 0 ? "amber" : undefined} />
          <StatCard label="Approved" value={senderCount + merchantCount - pendingKYC} Icon={ShieldCheck} />
        </div>
      )}

      {pendingKYC > 0 && (
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldX size={20} color="#f59e0b" />
            <div>
              <div className="text-white font-semibold text-sm">{pendingKYC} KYC {pendingKYC === 1 ? "application" : "applications"} pending</div>
              <div className="text-[#888] text-xs mt-0.5">Review and approve or reject submitted documents.</div>
            </div>
          </div>
          <Link href="/admin/kyc"
            className="bg-amber-500 text-black font-bold text-sm px-4 py-2 rounded-xl hover:bg-amber-400 transition-colors shrink-0">
            Review
          </Link>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, Icon, href, accent,
}: {
  label: string; value: number; Icon: React.ElementType;
  href?: string; accent?: "amber";
}) {
  const inner = (
    <div className={`bg-[#13161c] border rounded-2xl px-5 py-5 ${accent === "amber" ? "border-amber-500/30" : "border-[#1e2230]"} ${href ? "hover:border-[#333] transition-colors cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[#555] text-xs tracking-[0.5px] font-medium">{label.toUpperCase()}</span>
        <Icon size={16} color={accent === "amber" ? "#f59e0b" : "#444"} />
      </div>
      <div className={`text-3xl font-extrabold ${accent === "amber" ? "text-amber-400" : "text-white"}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

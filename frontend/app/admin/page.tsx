"use client";
import { useEffect, useState } from "react";
import { Users, Store, ShieldCheck, ShieldX, Clock, AlertTriangle, UserCog } from "lucide-react";
import Link from "next/link";

interface KYCCounts {
  total: number;
  pending: number;
  verified: number;
  rejected: number;
  needs_revision: number;
  senders: number;
  merchants: number;
}

export default function AdminOverview() {
  const [counts, setCounts] = useState<KYCCounts | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/kyc/users?status=all")
      .then((r) => r.json())
      .then((d) => {
        const users = d.users ?? [];
        setCounts({
          total:          users.length,
          pending:        users.filter((u: { kyc_status: string }) => u.kyc_status === "pending").length,
          verified:       users.filter((u: { kyc_status: string }) => u.kyc_status === "verified").length,
          rejected:       users.filter((u: { kyc_status: string }) => u.kyc_status === "rejected").length,
          needs_revision: users.filter((u: { kyc_status: string }) => u.kyc_status === "needs_revision").length,
          senders:        users.filter((u: { role: string }) => u.role === "sender").length,
          merchants:      users.filter((u: { role: string }) => u.role === "merchant").length,
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="p-8">
      <h1 className="text-2xl font-extrabold text-white mb-1">Admin Overview</h1>
      <p className="text-[#555] text-sm mb-8">Platform summary and KYC status breakdown.</p>

      {loading ? (
        <div className="text-[#555] text-sm">Loading…</div>
      ) : counts ? (
        <>
          {/* Role counts */}
          <div className="mb-2">
            <div className="text-[11px] font-semibold text-[#444] uppercase tracking-[1px] mb-3">Registered Users</div>
            <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
              <StatCard label="OFW Senders"  value={counts.senders}   Icon={Users}    href="/admin/users" />
              <StatCard label="Merchants"    value={counts.merchants} Icon={Store}    href="/admin/merchants" />
              <StatCard label="Total Users"  value={counts.total}     Icon={UserCog}  href="/admin/kyc" />
            </div>
          </div>

          {/* KYC status breakdown */}
          <div className="mb-2">
            <div className="text-[11px] font-semibold text-[#444] uppercase tracking-[1px] mb-3">KYC Status Breakdown</div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <StatCard label="Pending"       value={counts.pending}        Icon={Clock}          href="/admin/kyc" accent="amber"  />
              <StatCard label="Verified"      value={counts.verified}       Icon={ShieldCheck}    href="/admin/kyc" accent="green"  />
              <StatCard label="Rejected"      value={counts.rejected}       Icon={ShieldX}        href="/admin/kyc" accent="red"    />
              <StatCard label="Needs Revision" value={counts.needs_revision} Icon={AlertTriangle}  href="/admin/kyc" accent="orange" />
            </div>
          </div>

          {/* Alert banner if action needed */}
          {counts.pending > 0 && (
            <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl px-5 py-4 flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <Clock size={20} color="#f59e0b" />
                <div>
                  <div className="text-white font-semibold text-sm">
                    {counts.pending} KYC {counts.pending === 1 ? "application" : "applications"} awaiting review
                  </div>
                  <div className="text-[#888] text-xs mt-0.5">Review submitted documents and approve or reject.</div>
                </div>
              </div>
              <Link href="/admin/kyc"
                className="bg-amber-500 text-black font-bold text-sm px-4 py-2 rounded-xl hover:bg-amber-400 transition-colors shrink-0">
                Review Now
              </Link>
            </div>
          )}
          {counts.needs_revision > 0 && (
            <div className="bg-orange-500/10 border border-orange-500/20 rounded-2xl px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <AlertTriangle size={20} color="#f97316" />
                <div>
                  <div className="text-white font-semibold text-sm">
                    {counts.needs_revision} {counts.needs_revision === 1 ? "account" : "accounts"} waiting to re-submit documents
                  </div>
                  <div className="text-[#888] text-xs mt-0.5">Users have been notified to update their KYC submission.</div>
                </div>
              </div>
              <Link href="/admin/kyc"
                className="bg-orange-500 text-black font-bold text-sm px-4 py-2 rounded-xl hover:bg-orange-400 transition-colors shrink-0">
                View
              </Link>
            </div>
          )}
        </>
      ) : (
        <div className="text-[#555] text-sm">Failed to load stats.</div>
      )}
    </div>
  );
}

function StatCard({
  label, value, Icon, href, accent,
}: {
  label: string; value: number; Icon: React.ElementType;
  href?: string; accent?: "amber" | "green" | "red" | "orange";
}) {
  const colorMap = {
    amber:  { border: "border-amber-500/30",  text: "text-amber-400",  icon: "#f59e0b" },
    green:  { border: "border-green-500/30",  text: "text-green-400",  icon: "#22c55e" },
    red:    { border: "border-red-500/30",    text: "text-red-400",    icon: "#ef4444" },
    orange: { border: "border-orange-500/30", text: "text-orange-400", icon: "#f97316" },
  };
  const c = accent ? colorMap[accent] : null;

  const inner = (
    <div className={`bg-[#13161c] border rounded-2xl px-5 py-5 ${c ? c.border : "border-[#1e2230]"} ${href ? "hover:border-[#333] transition-colors cursor-pointer" : ""}`}>
      <div className="flex items-center justify-between mb-3">
        <span className="text-[#555] text-xs tracking-[0.5px] font-medium uppercase">{label}</span>
        <Icon size={16} color={c ? c.icon : "#444"} />
      </div>
      <div className={`text-3xl font-extrabold ${c ? c.text : "text-white"}`}>{value}</div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : <div>{inner}</div>;
}

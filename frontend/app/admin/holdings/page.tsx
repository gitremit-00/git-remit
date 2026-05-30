"use client";
import { useEffect, useState, useCallback } from "react";
import {
  Loader, Search, ShieldAlert, ShieldOff, ShieldCheck,
  Lock, LockOpen, AlertTriangle, ChevronDown, ChevronUp, X,
} from "lucide-react";
import { type UserProfile } from "../../../lib/supabase";

type AccountStatus = "active" | "on_hold";

interface HoldDialogState {
  user: UserProfile;
  action: "hold" | "unhold";
}

function AccountStatusBadge({ status }: { status: AccountStatus }) {
  if (status === "on_hold") {
    return (
      <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-red-500/10 text-red-400 border-red-500/20">
        <Lock size={10} /> On Hold
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border bg-green-500/10 text-green-400 border-green-500/20">
      <LockOpen size={10} /> Active
    </span>
  );
}

function KYCBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    verified:       { label: "Verified",       cls: "bg-green-500/10 text-green-400 border-green-500/20" },
    pending:        { label: "Pending",         cls: "bg-amber-500/10 text-amber-400 border-amber-500/20" },
    rejected:       { label: "Rejected",        cls: "bg-red-500/10 text-red-400 border-red-500/20" },
    needs_revision: { label: "Needs Revision",  cls: "bg-orange-500/10 text-orange-400 border-orange-500/20" },
  };
  const { label, cls } = map[status] ?? map.pending;
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${cls}`}>
      {label}
    </span>
  );
}

function HoldDialog({
  state,
  onClose,
  onConfirm,
}: {
  state: HoldDialogState;
  onClose: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  const isHold = state.action === "hold";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl w-full max-w-md p-6 shadow-2xl">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            {isHold
              ? <ShieldAlert size={18} className="text-red-400" />
              : <ShieldCheck size={18} className="text-green-400" />}
            <h2 className="text-white font-bold text-base">
              {isHold ? "Place Account On Hold" : "Release Account Hold"}
            </h2>
          </div>
          <button onClick={onClose} className="text-[#555] hover:text-white transition-colors">
            <X size={16} />
          </button>
        </div>

        <p className="text-[#666] text-sm mb-4">
          {isHold
            ? <>You are placing <span className="text-white font-semibold">@{state.user.username}</span>'s account on hold. Their in-app balance will be frozen and all transactions will be blocked.</>
            : <>You are releasing the hold on <span className="text-white font-semibold">@{state.user.username}</span>'s account. They will regain full access to their balance and transactions.</>}
        </p>

        {isHold && (
          <div className="mb-4">
            <label className="block text-[11px] font-semibold text-[#555] uppercase tracking-[0.8px] mb-1.5">
              Reason <span className="text-[#444]">(optional)</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Suspected malicious activity, account compromised…"
              rows={3}
              className="w-full bg-[#0e1014] border border-[#1e2230] rounded-xl px-3 py-2.5 text-white text-sm outline-none focus:border-red-500/40 placeholder:text-[#333] resize-none"
            />
          </div>
        )}

        {isHold && (
          <div className="bg-red-500/5 border border-red-500/20 rounded-xl p-3 mb-4 flex gap-2">
            <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
            <p className="text-[#888] text-xs leading-relaxed">
              The user's funds will be secured in escrow and cannot be withdrawn or transferred while on hold.
            </p>
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-sm text-[#555] border border-[#1e2230] hover:text-white hover:border-[#2a2e3a] transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(reason)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              isHold
                ? "bg-red-500/10 text-red-400 border border-red-500/20 hover:bg-red-500/20"
                : "bg-green-500/10 text-green-400 border border-green-500/20 hover:bg-green-500/20"
            }`}
          >
            {isHold ? "Confirm Hold" : "Release Hold"}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function AdminHoldings() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"all" | "on_hold" | "active">("all");
  const [dialog, setDialog] = useState<HoldDialogState | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadUsers = useCallback(() => {
    setLoading(true);
    fetch("/api/admin/kyc/users?role=all&status=all")
      .then((r) => r.json())
      .then((d) => setUsers(d.users ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const filtered = users.filter((u) => {
    const matchQuery =
      !query ||
      (u.name ?? "").toLowerCase().includes(query.toLowerCase()) ||
      (u.email ?? "").toLowerCase().includes(query.toLowerCase()) ||
      u.username.toLowerCase().includes(query.toLowerCase());
    const matchFilter =
      filter === "all" ||
      (filter === "on_hold" && u.account_status === "on_hold") ||
      (filter === "active" && (u.account_status === "active" || !u.account_status));
    return matchQuery && matchFilter;
  });

  const onHoldCount = users.filter((u) => u.account_status === "on_hold").length;

  async function handleConfirm(reason: string) {
    if (!dialog) return;
    setActionLoading(dialog.user.id);
    setDialog(null);
    try {
      const res = await fetch(`/api/admin/accounts/${dialog.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: dialog.action, reason }),
      });
      if (res.ok) {
        setUsers((prev) =>
          prev.map((u) =>
            u.id === dialog.user.id
              ? {
                  ...u,
                  account_status: dialog.action === "hold" ? "on_hold" : "active",
                  account_hold_reason: dialog.action === "hold" ? reason || null : null,
                  account_held_at: dialog.action === "hold" ? new Date().toISOString() : null,
                }
              : u
          )
        );
      }
    } finally {
      setActionLoading(null);
    }
  }

  return (
    <div className="p-8">
      {dialog && (
        <HoldDialog
          state={dialog}
          onClose={() => setDialog(null)}
          onConfirm={handleConfirm}
        />
      )}

      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold text-white mb-1">Holdings</h1>
          <p className="text-[#555] text-sm">Manage account holds to protect in-app balances.</p>
        </div>
        {onHoldCount > 0 && (
          <div className="flex items-center gap-2 bg-red-500/10 border border-red-500/20 rounded-xl px-3 py-2">
            <ShieldOff size={14} className="text-red-400" />
            <span className="text-red-400 text-sm font-semibold">{onHoldCount} account{onHoldCount !== 1 ? "s" : ""} on hold</span>
          </div>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-5">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-4 top-1/2 -translate-y-1/2 text-[#555]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email, or username…"
            className="w-full bg-[#13161c] border border-[#1e2230] rounded-xl pl-10 pr-4 py-3 text-white text-sm outline-none focus:border-[#DDE048]/40 placeholder:text-[#333]"
          />
        </div>
        <div className="flex gap-1.5">
          {(["all", "on_hold", "active"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-3 py-2 rounded-xl text-xs font-semibold border transition-colors ${
                filter === f
                  ? f === "on_hold"
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-[#DDE048]/10 text-[#DDE048] border-[#DDE048]/20"
                  : "text-[#555] border-[#1e2230] hover:text-[#888]"
              }`}
            >
              {f === "all" ? "All" : f === "on_hold" ? "On Hold" : "Active"}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-[#555] text-sm">
          <Loader size={14} className="animate-spin" /> Loading…
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-[#555] text-sm">No accounts found.</div>
      ) : (
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e2230]">
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">Account</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3 hidden md:table-cell">Role</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">KYC</th>
                <th className="text-left text-[#444] font-medium text-[11px] tracking-[0.8px] uppercase px-5 py-3">Status</th>
                <th className="px-5 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1a1d24]">
              {filtered.map((u) => {
                const isOnHold = u.account_status === "on_hold";
                const expanded = expandedId === u.id;
                return (
                  <>
                    <tr key={u.id} className={`transition-colors ${isOnHold ? "bg-red-500/[0.03]" : "hover:bg-[#1a1d23]"}`}>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2.5">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center text-[10px] font-bold shrink-0 ${isOnHold ? "bg-red-500/10 text-red-400" : "bg-[#1e2230] text-[#888]"}`}>
                            {(u.name ?? u.username).slice(0, 2).toUpperCase()}
                          </div>
                          <div>
                            <div className="text-white font-medium">{u.name ?? "—"}</div>
                            <div className="text-[#555] text-xs">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td className="px-5 py-3 hidden md:table-cell">
                        <span className="text-[#666] text-xs capitalize">{u.role}</span>
                      </td>
                      <td className="px-5 py-3">
                        <KYCBadge status={u.kyc_status} />
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <AccountStatusBadge status={isOnHold ? "on_hold" : "active"} />
                          {isOnHold && u.account_hold_reason && (
                            <button
                              onClick={() => setExpandedId(expanded ? null : u.id)}
                              className="text-[#444] hover:text-[#666] transition-colors"
                            >
                              {expanded ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                            </button>
                          )}
                        </div>
                        {expanded && u.account_hold_reason && (
                          <div className="mt-1.5 text-[11px] text-red-400 max-w-[220px]">{u.account_hold_reason}</div>
                        )}
                      </td>
                      <td className="px-5 py-3 text-right">
                        {actionLoading === u.id ? (
                          <Loader size={14} className="animate-spin text-[#555] ml-auto" />
                        ) : isOnHold ? (
                          <button
                            onClick={() => setDialog({ user: u, action: "unhold" })}
                            className="text-xs text-green-400 border border-green-500/20 px-2.5 py-1 rounded-xl hover:bg-green-500/10 transition-colors font-semibold"
                          >
                            Release
                          </button>
                        ) : (
                          <button
                            onClick={() => setDialog({ user: u, action: "hold" })}
                            className="text-xs text-red-400 border border-red-500/20 px-2.5 py-1 rounded-xl hover:bg-red-500/10 transition-colors font-semibold"
                          >
                            Hold
                          </button>
                        )}
                      </td>
                    </tr>
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

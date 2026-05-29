"use client";
import { useState } from "react";
import { ShieldCheck, Clock, ShieldX, AlertTriangle, X, ArrowRight } from "lucide-react";
import Link from "next/link";
import { useRole, type KYCStatus } from "../context/RoleContext";

interface BannerConfig {
  icon: React.ElementType;
  bg: string;
  border: string;
  iconColor: string;
  title: string;
  body: (reason?: string | null) => string;
  action?: { label: string; href: string; cls: string };
}

const CONFIG: Record<KYCStatus, BannerConfig> = {
  pending: {
    icon: Clock,
    bg: "bg-amber-500/10",
    border: "border-amber-500/20",
    iconColor: "text-amber-400",
    title: "KYC Pending Review",
    body: () => "Your documents are under review. Transaction features are locked until your account is verified.",
  },
  verified: {
    icon: ShieldCheck,
    bg: "bg-green-500/10",
    border: "border-green-500/20",
    iconColor: "text-green-400",
    title: "Account Verified",
    body: () => "Your identity has been verified. You have full access to all platform features.",
  },
  rejected: {
    icon: ShieldX,
    bg: "bg-red-500/10",
    border: "border-red-500/20",
    iconColor: "text-red-400",
    title: "KYC Rejected",
    body: (reason) => reason
      ? `Your KYC was rejected: ${reason}`
      : "Your KYC application was rejected. Please contact support for assistance.",
  },
  needs_revision: {
    icon: AlertTriangle,
    bg: "bg-orange-500/10",
    border: "border-orange-500/20",
    iconColor: "text-orange-400",
    title: "Documents Need Revision",
    body: (reason) => reason
      ? `Admin requested: ${reason}`
      : "Please update or re-upload your documents for review.",
    action: {
      label: "Revise Documents",
      href: "/kyc-revision",
      cls: "bg-orange-500 hover:bg-orange-400 text-white",
    },
  },
};

export default function KYCBanner() {
  const { kycStatus, kycRejectionReason, loading } = useRole();
  const [dismissed, setDismissed] = useState(false);

  if (loading || !kycStatus || dismissed || kycStatus === "verified") return null;

  const { icon: Icon, bg, border, iconColor, title, body, action } = CONFIG[kycStatus];

  return (
    <div className={`flex items-start gap-3 ${bg} border ${border} rounded-xl px-4 py-3.5 mb-4 mx-4 md:mx-0`}>
      <Icon size={16} className={`${iconColor} shrink-0 mt-0.5`} />
      <div className="flex-1 min-w-0">
        <div className={`text-sm font-semibold ${iconColor}`}>{title}</div>
        <div className="text-[#888] text-xs mt-0.5 leading-relaxed">{body(kycRejectionReason)}</div>
        {action && (
          <Link href={action.href}
            className={`inline-flex items-center gap-1.5 mt-2.5 text-xs font-bold px-3 py-1.5 rounded-lg transition-colors ${action.cls}`}>
            {action.label} <ArrowRight size={12} />
          </Link>
        )}
      </div>
      <button onClick={() => setDismissed(true)} className="text-[#555] hover:text-[#888] transition-colors shrink-0 mt-0.5">
        <X size={14} />
      </button>
    </div>
  );
}

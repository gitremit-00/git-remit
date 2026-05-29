"use client";
import { ReactNode } from "react";
import { ShieldX, Clock, AlertTriangle, ArrowRight, Loader } from "lucide-react";
import Link from "next/link";
import { useRole, type KYCStatus } from "../context/RoleContext";

interface GateConfig {
  icon: React.ElementType;
  iconColor: string;
  iconBg: string;
  heading: string;
  body: (reason?: string | null) => string;
  action?: { label: string; href: string; cls: string };
}

const GATE_CONFIG: Record<Exclude<KYCStatus, "verified">, GateConfig> = {
  pending: {
    icon: Clock,
    iconColor: "text-amber-400",
    iconBg: "bg-amber-500/10 border-amber-500/20",
    heading: "KYC Verification Pending",
    body: () => "Your documents are currently under admin review. Transaction features will be unlocked once your account is verified.",
    action: undefined,
  },
  needs_revision: {
    icon: AlertTriangle,
    iconColor: "text-orange-400",
    iconBg: "bg-orange-500/10 border-orange-500/20",
    heading: "Documents Need Revision",
    body: (reason) => reason
      ? `Admin requested: ${reason} — Please update your documents to regain transaction access.`
      : "The admin has requested changes to your KYC documents. Please revise them to continue.",
    action: { label: "Revise Documents", href: "/kyc-revision", cls: "bg-orange-500 hover:bg-orange-400 text-black font-extrabold" },
  },
  rejected: {
    icon: ShieldX,
    iconColor: "text-red-400",
    iconBg: "bg-red-500/10 border-red-500/20",
    heading: "KYC Application Rejected",
    body: (reason) => reason
      ? `Your KYC was rejected: ${reason}`
      : "Your KYC application has been rejected. Please contact support for assistance.",
    action: undefined,
  },
};

interface Props {
  children: ReactNode;
  /** Optional label shown above the lock message e.g. "New Transfer" */
  featureName?: string;
}

export default function KYCGate({ children, featureName }: Props) {
  const { kycStatus, kycRejectionReason, loading } = useRole();

  // While loading, show a spinner instead of the page
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader size={22} className="animate-spin text-[#555]" />
      </div>
    );
  }

  // Verified — render the page normally
  if (kycStatus === "verified") return <>{children}</>;

  // Null status (shouldn't happen after load, but handle gracefully)
  if (!kycStatus) return <>{children}</>;

  const config = GATE_CONFIG[kycStatus];
  const { icon: Icon, iconColor, iconBg, heading, body, action } = config;

  return (
    <div className="flex items-center justify-center min-h-[60vh] px-4">
      <div className="w-full max-w-md text-center">
        {/* Icon */}
        <div className={`w-16 h-16 rounded-2xl border flex items-center justify-center mx-auto mb-5 ${iconBg}`}>
          <Icon size={28} className={iconColor} />
        </div>

        {/* Heading */}
        {featureName && (
          <div className="text-[11px] font-semibold text-[#444] uppercase tracking-[1.5px] mb-2">{featureName}</div>
        )}
        <h2 className="text-white font-extrabold text-xl mb-3">{heading}</h2>
        <p className="text-[#666] text-sm leading-relaxed mb-6">{body(kycRejectionReason)}</p>

        {/* Action button */}
        {action ? (
          <Link href={action.href}
            className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm transition-colors ${action.cls}`}>
            {action.label} <ArrowRight size={14} />
          </Link>
        ) : (
          <Link href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm bg-[#13161c] border border-[#1e2230] text-[#888] hover:border-[#333] transition-colors">
            Back to Dashboard
          </Link>
        )}

        {/* KYC status chip */}
        <div className="mt-6 flex justify-center">
          <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-3 py-1 rounded-full border ${iconBg} ${iconColor}`}>
            <Icon size={11} />
            {kycStatus === "pending"        ? "Pending Review" :
             kycStatus === "needs_revision" ? "Needs Revision"  :
             "Rejected"}
          </span>
        </div>
      </div>
    </div>
  );
}

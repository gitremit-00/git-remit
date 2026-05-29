"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWallet } from "./WalletContext";
import { getUserProfile, Role } from "../lib/supabase";
import { isSenderOnly, isMerchantOnly, isAdminOnly, isPublic } from "../lib/routes";

export type KYCStatus = "pending" | "verified" | "rejected" | "needs_revision";

interface RoleContextValue {
  role: Role | null;
  loading: boolean;
  isNewUser: boolean;
  kycStatus: KYCStatus | null;
  kycRejectionReason: string | null;
  displayName: string | null;
  setDisplayName: (name: string | null) => void;
  avatarUrl: string | null;
  setAvatarUrl: (url: string | null) => void;
}

const RoleContext = createContext<RoleContextValue>({
  role: null, loading: true, isNewUser: false,
  kycStatus: null, kycRejectionReason: null,
  displayName: null, setDisplayName: () => {},
  avatarUrl: null, setAvatarUrl: () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole]                       = useState<Role | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [isNewUser, setIsNewUser]             = useState(false);
  const [kycStatus, setKycStatus]             = useState<KYCStatus | null>(null);
  const [kycRejectionReason, setKycReason]    = useState<string | null>(null);
  const [displayName, setDisplayName]         = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl]             = useState<string | null>(null);

  // Fetch role + KYC status from auth session on mount.
  // Wallet state is for on-chain features only; role/KYC come from session cookie.
  useEffect(() => {
    setLoading(true);
    setIsNewUser(false);

    fetch("/api/auth/me").then(async (res) => {
      if (!res.ok) {
        setRole(null);
        setLoading(false);
        if (!isPublic(pathname)) router.replace("/login");
        return;
      }

      const { userId, role: r, kycStatus: ks, kycRejectionReason: kr } =
        await res.json() as { userId: string; role: Role; kycStatus: KYCStatus; kycRejectionReason: string | null };

      setRole(r);
      setKycStatus(ks ?? "pending");
      setKycReason(kr ?? null);
      document.cookie = `rs_role=${r}; path=/; max-age=2592000`;

      if (isPublic(pathname) || pathname === "/onboarding") {
        if (r === "admin") router.replace("/admin");
        else if (r === "merchant") router.replace("/merchant");
        else router.replace("/");
      }

      const profile = await getUserProfile(userId);
      if (profile?.name) setDisplayName(profile.name);
      if (profile?.avatar_url) setAvatarUrl(profile.avatar_url);
      setLoading(false);
    });
  }, []);

  // Route guard — runs when role or pathname changes
  useEffect(() => {
    if (loading || !role) return;
    if (isPublic(pathname) || pathname === "/onboarding") return;

    if (role === "sender") {
      if (isMerchantOnly(pathname) || isAdminOnly(pathname)) router.replace("/");
    } else if (role === "merchant") {
      if (isSenderOnly(pathname) || isAdminOnly(pathname)) router.replace("/merchant");
    } else if (role === "admin") {
      if (isSenderOnly(pathname) || isMerchantOnly(pathname)) router.replace("/admin");
    }
  }, [role, pathname, loading]);

  return (
    <RoleContext.Provider value={{
      role, loading, isNewUser,
      kycStatus, kycRejectionReason,
      displayName, setDisplayName,
      avatarUrl, setAvatarUrl,
    }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() { return useContext(RoleContext); }

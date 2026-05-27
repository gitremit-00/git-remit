"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWallet } from "./WalletContext";
import { fetchUserRole, getUserProfile, Role } from "../lib/supabase";
import { isSenderOnly, isMerchantOnly, isAdminOnly, isPublic } from "../lib/routes";

interface RoleContextValue {
  role: Role | null;
  loading: boolean;
  isNewUser: boolean;
  displayName: string | null;
  setDisplayName: (name: string) => void;
  avatarUrl: string | null;
  setAvatarUrl: (url: string | null) => void;
}

const RoleContext = createContext<RoleContextValue>({
  role: null, loading: true, isNewUser: false,
  displayName: null, setDisplayName: () => {},
  avatarUrl: null, setAvatarUrl: () => {},
});

export function RoleProvider({ children }: { children: ReactNode }) {
  const { account, walletLoading } = useWallet();
  const router = useRouter();
  const pathname = usePathname();
  const [role, setRole] = useState<Role | null>(null);
  const [loading, setLoading] = useState(true);
  const [isNewUser, setIsNewUser] = useState(false);
  const [displayName, setDisplayName] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    if (walletLoading) return;

    if (!account) {
      setRole(null);
      setIsNewUser(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    setIsNewUser(false);

    // Always re-fetch role from Supabase — never trust cookie alone
    fetchUserRole(account).then(async (r) => {
      if (!r) {
        setIsNewUser(true);
        if (!isPublic(pathname) && pathname !== "/onboarding") {
          router.replace("/signup");
        }
      } else {
        setRole(r);
        document.cookie = `rs_role=${r}; path=/; max-age=2592000`;

        // Redirect if on login/signup/onboarding with a known role
        if (isPublic(pathname) || pathname === "/onboarding") {
          if (r === "admin") router.replace("/admin");
          else if (r === "merchant") router.replace("/merchant");
          else router.replace("/");
        }

        const profile = await getUserProfile(account);
        if (profile?.name) setDisplayName(profile.name);
        if (profile?.avatar_url) setAvatarUrl(profile.avatar_url);
      }
      setLoading(false);
    });
  }, [account, walletLoading]);

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
    <RoleContext.Provider value={{ role, loading, isNewUser, displayName, setDisplayName, avatarUrl, setAvatarUrl }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() { return useContext(RoleContext); }

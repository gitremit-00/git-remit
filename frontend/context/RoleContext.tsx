"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWallet } from "./WalletContext";
import { fetchUserRole, getUserProfile, Role } from "../lib/supabase";

interface RoleContextValue {
  role: Role | null;
  loading: boolean;
  isNewUser: boolean;
  displayName: string | null;
  setDisplayName: (name: string) => void;
  avatarUrl: string | null;
  setAvatarUrl: (url: string | null) => void;
}

const RoleContext = createContext<RoleContextValue>({ role: null, loading: true, isNewUser: false, displayName: null, setDisplayName: () => {}, avatarUrl: null, setAvatarUrl: () => {} });

// Routes only senders can access
const SENDER_ONLY = ["/", "/new-transfer", "/pledges", "/pledge", "/recipients"];
// Routes only merchants can access
const MERCHANT_ONLY = ["/merchant"];
// Routes accessible to both
const SHARED = ["/wallet", "/notifications", "/profile", "/settings", "/help", "/onboarding"];

function isSenderOnly(path: string) {
  return SENDER_ONLY.some((r) => path === r || path.startsWith(r + "/"));
}
function isMerchantOnly(path: string) {
  return MERCHANT_ONLY.some((r) => path === r || path.startsWith(r + "/"));
}

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

    // Wallet connected — fetch role from Supabase
    setLoading(true);
    setIsNewUser(false);
    fetchUserRole(account).then(async (r) => {
      if (!r) {
        // New user — send to onboarding unless already there
        setIsNewUser(true);
        if (pathname !== "/onboarding") router.replace("/onboarding");
      } else {
        setRole(r);
        // Set cookie for middleware to read
        document.cookie = `rs_role=${r}; path=/; max-age=2592000`;
        // Returning user who landed on /onboarding (e.g. after disconnect) — send to dashboard
        if (pathname === "/onboarding") {
          router.replace(r === "merchant" ? "/merchant" : "/");
        }
        // Load display name
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
    if (pathname === "/onboarding") return;

    if (role === "sender" && isMerchantOnly(pathname)) {
      router.replace("/");
    } else if (role === "merchant" && isSenderOnly(pathname)) {
      router.replace("/merchant");
    }
  }, [role, pathname, loading]);

  return (
    <RoleContext.Provider value={{ role, loading, isNewUser, displayName, setDisplayName, avatarUrl, setAvatarUrl }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() { return useContext(RoleContext); }

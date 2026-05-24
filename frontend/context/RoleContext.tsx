"use client";
import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { useRouter, usePathname } from "next/navigation";
import { useWallet } from "./WalletContext";
import { fetchUserRole, Role } from "../lib/supabase";

interface RoleContextValue {
  role: Role | null;
  loading: boolean;
}

const RoleContext = createContext<RoleContextValue>({ role: null, loading: true });

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

  useEffect(() => {
    if (walletLoading) return;

    if (!account) {
      setRole(null);
      setLoading(false);
      return;
    }

    // Wallet connected — fetch role from Supabase
    setLoading(true);
    fetchUserRole(account).then((r) => {
      if (!r) {
        // New user — send to onboarding unless already there
        if (pathname !== "/onboarding") router.replace("/onboarding");
      } else {
        setRole(r);
        // Set cookie for middleware to read
        document.cookie = `rs_role=${r}; path=/; max-age=2592000`;
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
    <RoleContext.Provider value={{ role, loading }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() { return useContext(RoleContext); }

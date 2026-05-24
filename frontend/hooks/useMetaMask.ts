"use client";
import { useEffect, useState } from "react";

export type MetaMaskState =
  | "loading"        // SSR / not yet checked
  | "installed"      // window.ethereum.isMetaMask = true
  | "not-installed"  // desktop, no MetaMask extension
  | "mobile-no-mm"   // mobile browser, not inside MetaMask app
  | "mobile-mm";     // inside MetaMask mobile browser

function isMobileBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
}

export function useMetaMask(): MetaMaskState {
  const [state, setState] = useState<MetaMaskState>("loading");

  useEffect(() => {
    const mobile = isMobileBrowser();
    const hasEthereum = typeof window !== "undefined" && !!window.ethereum;
    const isMetaMask = hasEthereum && !!(window.ethereum as { isMetaMask?: boolean }).isMetaMask;

    if (isMetaMask) {
      setState(mobile ? "mobile-mm" : "installed");
    } else if (mobile) {
      setState("mobile-no-mm");
    } else {
      setState("not-installed");
    }
  }, []);

  return state;
}

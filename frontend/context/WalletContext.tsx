"use client";
import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import { ethers, Contract, JsonRpcProvider, BrowserProvider, Signer } from "ethers";
import { MORPH_TESTNET, CONTRACTS } from "../contracts/addresses";
import MockUSDCABI from "../contracts/MockUSDC.json";
import RemittancePledgeABI from "../contracts/RemittancePledge.json";

interface WalletContextType {
  account: string | null;
  signer: Signer | null;
  provider: JsonRpcProvider;
  error: string | null;
  walletLoading: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  usdcRead: Contract;
  pledgeRead: Contract;
  usdcWrite: Contract | null;
  pledgeWrite: Contract | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

function getReadProvider(): JsonRpcProvider {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  return new JsonRpcProvider(`${base}/api/rpc`);
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletLoading, setWalletLoading] = useState(true);
  const [readProvider] = useState<JsonRpcProvider>(() => getReadProvider());

  const connect = useCallback(async () => {
    try {
      sessionStorage.removeItem("rs_disconnected");
      if (!window.ethereum) { setError("MetaMask not found."); return; }
      try {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MORPH_TESTNET.chainId }] });
      } catch (e: unknown) {
        if ((e as { code: number }).code === 4902) {
          await window.ethereum.request({ method: "wallet_addEthereumChain", params: [MORPH_TESTNET] });
        }
      }
      const provider = new BrowserProvider(window.ethereum);
      await provider.send("eth_requestAccounts", []);
      const _signer = await provider.getSigner();
      setAccount(await _signer.getAddress());
      setSigner(_signer);
      setError(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const disconnect = useCallback(() => {
    // Don't mutate state — redirect immediately so the current page never re-renders
    document.cookie = "rs_role=; path=/; max-age=0";
    sessionStorage.setItem("rs_disconnected", "1");
    window.location.href = "/onboarding";
  }, []);

  // Auto-reconnect if MetaMask is already connected (skipped if user explicitly disconnected)
  useEffect(() => {
    async function tryReconnect() {
      try {
        if (!window.ethereum) return;
        if (sessionStorage.getItem("rs_disconnected")) return;
        const accounts = await window.ethereum.request({ method: "eth_accounts" }) as string[];
        if (accounts.length === 0) return;
        const provider = new BrowserProvider(window.ethereum);
        const _signer = await provider.getSigner();
        setAccount(await _signer.getAddress());
        setSigner(_signer);
      } catch {
        // silently fail — user just isn't connected
      } finally {
        setWalletLoading(false);
      }
    }
    tryReconnect();
  }, []);

  const contracts = useMemo(() => ({
    usdcRead: new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, readProvider),
    pledgeRead: new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, readProvider),
    usdcWrite: signer ? new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, signer) : null,
    pledgeWrite: signer ? new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, signer) : null,
  }), [signer, readProvider]);

  return (
    <WalletContext.Provider value={{ account, signer, provider: readProvider, error, walletLoading, connect, disconnect, ...contracts }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

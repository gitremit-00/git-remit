"use client";
import { createContext, useContext, useState, useCallback, useMemo, useEffect, ReactNode } from "react";
import { Contract, JsonRpcProvider, BrowserProvider, Signer } from "ethers";
import { MORPH_TESTNET, CONTRACTS } from "../contracts/addresses";
import MockUSDCABI from "../contracts/MockTokens.json";
import RemittancePledgeABI from "../contracts/RemittancePledge.json";

interface WalletContextType {
  account: string | null;
  signer: Signer | null;
  provider: JsonRpcProvider;
  error: string | null;
  walletVerified: boolean;
  walletLoading: boolean;
  connect: () => Promise<void>;
  confirmWallet: () => Promise<void>;
  disconnect: () => void;
  usdcRead: Contract;
  usdtRead: Contract;
  pledgeRead: Contract;
  usdcWrite: Contract | null;
  usdtWrite: Contract | null;
  pledgeWrite: Contract | null;
}

const WalletContext = createContext<WalletContextType | null>(null);

function getReadProvider(): JsonRpcProvider {
  const base = typeof window !== "undefined" ? window.location.origin : "http://localhost:3000";
  return new JsonRpcProvider(`${base}/api/rpc`);
}

function getMetaMaskProvider() {
  const ethereum = typeof window !== "undefined" ? window.ethereum : undefined;
  if (!ethereum) return null;

  const providers = ethereum.providers;
  if (providers?.length) {
    return providers.find((provider) => provider?.isMetaMask) ?? null;
  }

  return ethereum.isMetaMask ? ethereum : null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<string | null>(null);
  const [signer, setSigner] = useState<Signer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [walletVerified, setWalletVerified] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [readProvider] = useState<JsonRpcProvider>(() => getReadProvider());

  const connect = useCallback(async () => {
    try {
      sessionStorage.removeItem("rs_disconnected");
      const injectedProvider = getMetaMaskProvider();
      if (!injectedProvider) {
        setError("MetaMask not found. Disable other wallet extensions or open this page with MetaMask.");
        return;
      }
      try {
        await injectedProvider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: MORPH_TESTNET.chainId }] });
      } catch (e: unknown) {
        if ((e as { code: number }).code === 4902) {
          await injectedProvider.request({ method: "wallet_addEthereumChain", params: [MORPH_TESTNET] });
        }
      }
      const provider = new BrowserProvider(injectedProvider);
      await provider.send("eth_requestAccounts", []);
      const _signer = await provider.getSigner();
      const address = await _signer.getAddress();
      setAccount(address);
      setSigner(_signer);
      setWalletVerified(sessionStorage.getItem(`rs_wallet_confirmed_${address.toLowerCase()}`) === "1");
      setError(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const confirmWallet = useCallback(async () => {
    try {
      if (!signer) {
        await connect();
        return;
      }

      const address = await signer.getAddress();
      const message = [
        "RemitSafe dashboard access",
        "",
        "Confirm this wallet to view your on-chain remittance dashboard.",
        `Wallet: ${address}`,
        `Time: ${new Date().toISOString()}`,
      ].join("\n");

      await signer.signMessage(message);
      sessionStorage.setItem(`rs_wallet_confirmed_${address.toLowerCase()}`, "1");
      setWalletVerified(true);
      setError(null);
    } catch (err: unknown) {
      setWalletVerified(false);
      setError((err as Error).message || "MetaMask confirmation was rejected.");
    }
  }, [connect, signer]);

  const disconnect = useCallback(() => {
    if (account) sessionStorage.removeItem(`rs_wallet_confirmed_${account.toLowerCase()}`);
    sessionStorage.setItem("rs_disconnected", "1");
    setAccount(null);
    setSigner(null);
    setWalletVerified(false);

    const injectedProvider = getMetaMaskProvider();
    if (!injectedProvider) return;

    injectedProvider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    }).catch(() => {
      // Some wallets do not support permission revocation — local disconnect still succeeds.
    });
  }, [account]);

  // Auto-reconnect if MetaMask is already connected (skipped if user explicitly disconnected)
  useEffect(() => {
    async function tryReconnect() {
      try {
        const injectedProvider = getMetaMaskProvider();
        if (!injectedProvider) return;
        if (sessionStorage.getItem("rs_disconnected")) return;
        const accounts = await injectedProvider.request({ method: "eth_accounts" }) as string[];
        if (accounts.length === 0) return;
        const provider = new BrowserProvider(injectedProvider);
        const _signer = await provider.getSigner();
        const address = await _signer.getAddress();
        setAccount(address);
        setSigner(_signer);
        setWalletVerified(sessionStorage.getItem(`rs_wallet_confirmed_${address.toLowerCase()}`) === "1");
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
    usdtRead: new Contract(CONTRACTS.MOCK_USDT, MockUSDCABI, readProvider),
    pledgeRead: new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, readProvider),
    usdcWrite: signer ? new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, signer) : null,
    usdtWrite: signer ? new Contract(CONTRACTS.MOCK_USDT, MockUSDCABI, signer) : null,
    pledgeWrite: signer ? new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, signer) : null,
  }), [signer, readProvider]);

  return (
    <WalletContext.Provider value={{ account, signer, provider: readProvider, error, walletVerified, walletLoading, connect, confirmWallet, disconnect, ...contracts }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

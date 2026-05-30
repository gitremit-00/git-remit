"use client";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  useEffect,
  ReactNode,
} from "react";
import { Contract, JsonRpcProvider, BrowserProvider, Signer } from "ethers";
import { MORPH_TESTNET, CONTRACTS } from "../contracts/addresses";
import MockUSDCABI from "../contracts/MockTokens.json";
import RemittancePledgeABI from "../contracts/RemittancePledge.json";
import { deriveAccountId } from "../lib/accountId";

export interface LinkedWallet {
  address: string;
  isPrimary: boolean;
}

interface WalletContextType {
  // Active wallet (the one MetaMask is currently connected to)
  activeWallet: string | null;
  activeSigner: Signer | null;

  // All wallets linked to the current profile's account
  linkedWallets: LinkedWallet[];

  // The user's accountId derived from their profile UUID
  accountId: string | null;

  // Account-level flags (read from on-chain / session)
  accountVerified: boolean;

  // Legacy field — still used by pages that haven't been updated yet
  account: string | null;
  signer: Signer | null;
  walletVerified: boolean;
  walletLoading: boolean;
  error: string | null;

  // Read-only RPC provider
  provider: JsonRpcProvider;

  // Contract instances
  usdcRead: Contract;
  usdtRead: Contract;
  pledgeRead: Contract;
  usdcWrite: Contract | null;
  usdtWrite: Contract | null;
  pledgeWrite: Contract | null;

  // Actions
  connect: () => Promise<void>;
  linkActiveWallet: () => Promise<void>;
  unlinkWallet: (address: string) => Promise<void>;
  setActiveWallet: (address: string) => void;
  disconnect: () => void;
  refreshLinkedWallets: () => Promise<void>;

  // Legacy
  confirmWallet: () => Promise<void>;
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
    return providers.find((p: { isMetaMask?: boolean }) => p?.isMetaMask) ?? null;
  }
  return ethereum.isMetaMask ? ethereum : null;
}

export function WalletProvider({ children }: { children: ReactNode }) {
  const [activeWallet, setActiveWalletState] = useState<string | null>(null);
  const [activeSigner, setActiveSigner] = useState<Signer | null>(null);
  const [linkedWallets, setLinkedWallets] = useState<LinkedWallet[]>([]);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [accountVerified, setAccountVerified] = useState(false);
  const [walletVerified, setWalletVerified] = useState(false);
  const [walletLoading, setWalletLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [readProvider] = useState<JsonRpcProvider>(() => getReadProvider());

  // Derive accountId from session on mount
  useEffect(() => {
    fetch("/api/auth/me")
      .then(r => r.ok ? r.json() : null)
      .then(me => {
        if (!me?.userId) return;
        const id = deriveAccountId(me.userId);
        setAccountId(id);
        setAccountVerified(me.kycStatus === "verified");
      })
      .catch(() => { /* non-critical */ });
  }, []);

  const refreshLinkedWallets = useCallback(async () => {
    try {
      const walletsRes = await fetch("/api/wallet/list");
      if (!walletsRes.ok) return;
      const { wallets } = await walletsRes.json() as { wallets: LinkedWallet[] };
      setLinkedWallets(wallets ?? []);
    } catch { /* non-critical */ }
  }, []);

  const connect = useCallback(async () => {
    try {
      sessionStorage.removeItem("rs_disconnected");
      const injectedProvider = getMetaMaskProvider();
      if (!injectedProvider) {
        setError("MetaMask not found. Disable other wallet extensions or open this page with MetaMask.");
        return;
      }
      try {
        await injectedProvider.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: MORPH_TESTNET.chainId }],
        });
      } catch (e: unknown) {
        if ((e as { code: number }).code === 4902) {
          await injectedProvider.request({ method: "wallet_addEthereumChain", params: [MORPH_TESTNET] });
        }
      }
      const provider = new BrowserProvider(injectedProvider);
      await provider.send("eth_requestAccounts", []);
      const _signer = await provider.getSigner();
      const address = await _signer.getAddress();
      setActiveWalletState(address);
      setActiveSigner(_signer);
      setWalletVerified(
        sessionStorage.getItem(`rs_wallet_confirmed_${address.toLowerCase()}`) === "1"
      );
      setError(null);
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, []);

  const linkActiveWallet = useCallback(async () => {
    if (!activeWallet || !activeSigner) {
      setError("Connect a wallet first.");
      return;
    }
    try {
      // 1. Get operator signature
      const sigRes = await fetch("/api/wallet/link-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: activeWallet }),
      });
      if (!sigRes.ok) {
        const { error: e } = await sigRes.json() as { error: string };
        setError(e);
        return;
      }
      const { accountId: accId, sigExpiry, operatorSig } = await sigRes.json() as {
        accountId: string;
        sigExpiry: number;
        operatorSig: string;
      };

      // 2. Send on-chain linkWallet tx
      const pledgeWrite = new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, activeSigner);
      const tx = await pledgeWrite.linkWallet(accId, sigExpiry, operatorSig);
      const receipt = await tx.wait();

      // 3. Persist to DB
      const addRes = await fetch("/api/wallet/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: activeWallet, txHash: receipt.hash }),
      });
      if (!addRes.ok) {
        const { error: e } = await addRes.json() as { error: string };
        setError(e);
        return;
      }

      sessionStorage.setItem(`rs_wallet_confirmed_${activeWallet.toLowerCase()}`, "1");
      setWalletVerified(true);
      await refreshLinkedWallets();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, [activeWallet, activeSigner, refreshLinkedWallets]);

  const unlinkWallet = useCallback(async (address: string) => {
    if (!activeSigner) return;
    try {
      const message = `RemitSafe: remove wallet ${address.toLowerCase()} from my account`;
      const signedMessage = await activeSigner.signMessage(message);
      const res = await fetch("/api/wallet/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ walletAddress: address, signedMessage }),
      });
      if (!res.ok) {
        const { error: e } = await res.json() as { error: string };
        setError(e);
        return;
      }
      await refreshLinkedWallets();
    } catch (err: unknown) {
      setError((err as Error).message);
    }
  }, [activeSigner, refreshLinkedWallets]);

  const setActiveWallet = useCallback((address: string) => {
    setActiveWalletState(address);
  }, []);

  const disconnect = useCallback(() => {
    if (activeWallet) sessionStorage.removeItem(`rs_wallet_confirmed_${activeWallet.toLowerCase()}`);
    sessionStorage.setItem("rs_disconnected", "1");
    setActiveWalletState(null);
    setActiveSigner(null);
    setWalletVerified(false);
    const injectedProvider = getMetaMaskProvider();
    if (!injectedProvider) return;
    injectedProvider.request({
      method: "wallet_revokePermissions",
      params: [{ eth_accounts: {} }],
    }).catch(() => { /* some wallets don't support this */ });
  }, [activeWallet]);

  // Legacy confirmWallet — signs a message to "verify" the wallet session-side
  const confirmWallet = useCallback(async () => {
    try {
      if (!activeSigner) { await connect(); return; }
      const address = await activeSigner.getAddress();
      const message = [
        "RemitSafe dashboard access",
        "",
        "Confirm this wallet to view your on-chain remittance dashboard.",
        `Wallet: ${address}`,
        `Time: ${new Date().toISOString()}`,
      ].join("\n");
      await activeSigner.signMessage(message);
      sessionStorage.setItem(`rs_wallet_confirmed_${address.toLowerCase()}`, "1");
      setWalletVerified(true);
      setError(null);
    } catch (err: unknown) {
      setWalletVerified(false);
      setError((err as Error).message || "MetaMask confirmation was rejected.");
    }
  }, [connect, activeSigner]);

  // Auto-reconnect on mount
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
        setActiveWalletState(address);
        setActiveSigner(_signer);
        setWalletVerified(
          sessionStorage.getItem(`rs_wallet_confirmed_${address.toLowerCase()}`) === "1"
        );
      } catch { /* silently fail */ } finally {
        setWalletLoading(false);
      }
    }
    tryReconnect();
    refreshLinkedWallets();
  }, [refreshLinkedWallets]);

  const contracts = useMemo(() => ({
    usdcRead: new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, readProvider),
    usdtRead: new Contract(CONTRACTS.MOCK_USDT, MockUSDCABI, readProvider),
    pledgeRead: new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, readProvider),
    usdcWrite: activeSigner ? new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, activeSigner) : null,
    usdtWrite: activeSigner ? new Contract(CONTRACTS.MOCK_USDT, MockUSDCABI, activeSigner) : null,
    pledgeWrite: activeSigner ? new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, activeSigner) : null,
  }), [activeSigner, readProvider]);

  const value: WalletContextType = {
    activeWallet,
    activeSigner,
    linkedWallets,
    accountId,
    accountVerified,
    // Legacy aliases
    account: activeWallet,
    signer: activeSigner,
    walletVerified,
    walletLoading,
    error,
    provider: readProvider,
    ...contracts,
    connect,
    linkActiveWallet,
    unlinkWallet,
    setActiveWallet,
    disconnect,
    refreshLinkedWallets,
    confirmWallet,
  };

  return (
    <WalletContext.Provider value={value}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

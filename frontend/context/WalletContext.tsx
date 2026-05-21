"use client";
import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";
import { ethers, Contract, JsonRpcProvider, BrowserProvider, Signer } from "ethers";
import { MORPH_TESTNET, CONTRACTS } from "../contracts/addresses";
import MockUSDCABI from "../contracts/MockUSDC.json";
import RemittancePledgeABI from "../contracts/RemittancePledge.json";

interface WalletContextType {
  account: string | null;
  signer: Signer | null;
  provider: JsonRpcProvider;
  error: string | null;
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
  const [readProvider] = useState<JsonRpcProvider>(() => getReadProvider());

  const connect = useCallback(async () => {
    try {
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

  const disconnect = useCallback(() => { setAccount(null); setSigner(null); }, []);

  const contracts = useMemo(() => ({
    usdcRead: new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, readProvider),
    pledgeRead: new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, readProvider),
    usdcWrite: signer ? new Contract(CONTRACTS.MOCK_USDC, MockUSDCABI, signer) : null,
    pledgeWrite: signer ? new Contract(CONTRACTS.REMITTANCE_PLEDGE, RemittancePledgeABI, signer) : null,
  }), [signer, readProvider]);

  return (
    <WalletContext.Provider value={{ account, signer, provider: readProvider, error, connect, disconnect, ...contracts }}>
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet(): WalletContextType {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

"use client";
import { useState, useEffect } from "react";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { Loader } from "lucide-react";
import { useWallet } from "../../context/WalletContext";
import { fetchUserRole } from "../../lib/supabase";

export default function Login() {
  const { account, connect, walletLoading } = useWallet();
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  // When account connects, check DB and redirect
  useEffect(() => {
    if (!account || walletLoading) return;

    setChecking(true);
    setError("");

    fetchUserRole(account).then((role) => {
      if (!role) {
        // No record → go to signup
        router.replace("/signup");
      } else {
        // Known user → set cookie and redirect to dashboard
        document.cookie = `rs_role=${role}; path=/; max-age=2592000`;
        if (role === "admin") router.replace("/admin");
        else if (role === "merchant") router.replace("/merchant");
        else router.replace("/");
      }
    }).catch(() => {
      setError("Unable to connect. Please try again.");
      setChecking(false);
    });
  }, [account, walletLoading]);

  const isLoading = walletLoading || checking;

  return (
    <div className="min-h-screen bg-[#0e1014] flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-6">

          {/* Logo */}
          <div className="flex flex-col items-center mb-8">
            <Image src="/logo.png" alt="RemitSafe" width={44} height={44} style={{ objectFit: "contain" }} />
            <span className="text-white font-extrabold text-base mt-2.5">RemitSafe</span>
            <span className="text-[#555] text-xs mt-1">Blockchain-powered remittance</span>
          </div>

          <h2 className="text-lg font-extrabold text-white mb-1 text-center">Welcome back</h2>
          <p className="text-[#555] text-xs text-center mb-6">Connect your wallet to sign in.</p>

          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-xl px-3.5 py-2.5 mb-4 text-center">
              {error}
            </div>
          )}

          {isLoading ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Loader size={20} className="animate-spin text-[#DDE048]" />
              <span className="text-[#555] text-xs">
                {checking ? "Checking your account…" : "Initializing wallet…"}
              </span>
            </div>
          ) : !account ? (
            <button
              onClick={connect}
              className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors"
            >
              <svg width="18" height="18" viewBox="0 0 318.6 318.6" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M274.1 35.5l-99.7 74.1 18.4-43.6 81.3-30.5z" fill="#E2761B" />
                <path d="M44.4 35.5l98.9 74.8-17.5-44.3L44.4 35.5z" fill="#E4761B" />
                <path d="M238.3 206.8l-26.5 40.6 56.7 15.6 16.3-55.3-46.5-.9z" fill="#E4761B" />
                <path d="M33.9 207.7l16.2 55.3 56.7-15.6-26.5-40.6-46.4.9z" fill="#E4761B" />
              </svg>
              Connect MetaMask
            </button>
          ) : null}

          <div className="mt-6 text-center">
            <span className="text-[#444] text-xs">New to RemitSafe?{" "}</span>
            <button
              onClick={() => router.push("/signup")}
              className="text-[#DDE048] text-xs font-semibold hover:underline"
            >
              Create an account
            </button>
          </div>
        </div>

        <p className="text-[#2a2d36] text-[11px] text-center mt-5">
          Powered by Morph L2 · Secured by smart contracts
        </p>
      </div>
    </div>
  );
}

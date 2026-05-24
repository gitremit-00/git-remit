"use client";
import Image from "next/image";
import { Loader, X, ExternalLink } from "lucide-react";
import { useState } from "react";
import { useMetaMask } from "../hooks/useMetaMask";
import { useWallet } from "../context/WalletContext";

const MM_DEEP_LINK = "https://metamask.app.link/dapp/" +
  (typeof window !== "undefined" ? window.location.host : "remitsafe.app");

interface Props {
  children: React.ReactNode;
}

function NoMetaMaskPopup({ onClose, mobile }: { onClose: () => void; mobile: boolean }) {
  return (
    <div className="fixed inset-0 z-[999] flex items-center justify-center px-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      {/* Modal */}
      <div className="relative w-full max-w-sm bg-[#13161c] border border-[#1e2230] rounded-2xl p-6 shadow-2xl">
        {/* Close */}
        <button onClick={onClose} className="absolute top-4 right-4 w-7 h-7 rounded-lg bg-[#1e2230] flex items-center justify-center hover:bg-[#252836] transition-colors">
          <X size={14} color="#555" />
        </button>

        {/* Icon + title */}
        <div className="flex flex-col items-center text-center mb-5">
          <div className="w-16 h-16 rounded-2xl bg-orange-500/10 flex items-center justify-center p-2 mb-4">
            <Image src="/MetaMask.png" alt="MetaMask" width={48} height={48} style={{ objectFit: "contain" }} />
          </div>
          <h3 className="text-white font-extrabold text-lg mb-1">
            {mobile ? "MetaMask required" : "MetaMask not installed"}
          </h3>
          <p className="text-[#555] text-sm leading-relaxed">
            {mobile
              ? "Open this page inside the MetaMask app browser, or install MetaMask on your device."
              : "RemitSafe needs the MetaMask browser extension to sign transactions. Install it and refresh the page."}
          </p>
        </div>

        {/* Actions */}
        {mobile ? (
          <>
            <a
              href={MM_DEEP_LINK}
              className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors mb-2.5"
            >
              <Image src="/MetaMask.png" alt="" width={16} height={16} style={{ objectFit: "contain" }} />
              Open in MetaMask
            </a>
            <div className="flex gap-2">
              <a href="https://apps.apple.com/app/metamask/id1438144202" target="_blank" rel="noopener noreferrer"
                className="flex-1 bg-[#1e2230] text-white text-xs font-semibold rounded-xl py-2.5 flex items-center justify-center gap-1.5 hover:bg-[#252836] transition-colors">
                🍎 App Store
              </a>
              <a href="https://play.google.com/store/apps/details?id=io.metamask" target="_blank" rel="noopener noreferrer"
                className="flex-1 bg-[#1e2230] text-white text-xs font-semibold rounded-xl py-2.5 flex items-center justify-center gap-1.5 hover:bg-[#252836] transition-colors">
                🤖 Google Play
              </a>
            </div>
          </>
        ) : (
          <a
            href="https://metamask.io/download"
            target="_blank"
            rel="noopener noreferrer"
            className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors"
          >
            <ExternalLink size={14} />
            Install MetaMask
          </a>
        )}

        <p className="text-[#333] text-[11px] text-center mt-3">
          {mobile ? "Use MetaMask's built-in browser to access RemitSafe." : "After installing, refresh this page."}
        </p>
      </div>
    </div>
  );
}

export default function MetaMaskGate({ children }: Props) {
  const mmState = useMetaMask();
  const { account, connect, walletLoading } = useWallet();
  const [showPopup, setShowPopup] = useState(false);

  if (account) return <>{children}</>;

  const needsInstall = mmState === "not-installed" || mmState === "mobile-no-mm";
  const isMobile = mmState === "mobile-no-mm";

  function handleClick() {
    if (needsInstall) {
      setShowPopup(true);
    } else {
      connect();
    }
  }

  return (
    <>
      <button
        onClick={handleClick}
        disabled={walletLoading || mmState === "loading"}
        className="w-full bg-[#DDE048] text-black font-bold rounded-xl py-3.5 text-sm flex items-center justify-center gap-2 hover:bg-[#c8ce30] transition-colors disabled:opacity-50"
      >
        {walletLoading
          ? <><Loader size={14} className="animate-spin" /> Connecting…</>
          : <><Image src="/MetaMask.png" alt="MetaMask" width={18} height={18} style={{ objectFit: "contain" }} /> Connect MetaMask</>}
      </button>

      {showPopup && (
        <NoMetaMaskPopup onClose={() => setShowPopup(false)} mobile={isMobile} />
      )}
    </>
  );
}

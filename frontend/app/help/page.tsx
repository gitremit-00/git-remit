"use client";
import Header from "../../components/Header";
import { ChevronDown, ChevronUp, ExternalLink, MessageCircle, FileText, Shield, Wallet, Send } from "lucide-react";
import { useState } from "react";

interface FAQ { q: string; a: string; }
const FAQS: FAQ[] = [
  { q: "What is RemitSafe?", a: "RemitSafe is a blockchain-based remittance platform for OFWs (Overseas Filipino Workers) to send money to merchants in the Philippines. Transfers are secured by smart contracts on Morph L2 — the sender locks funds as a pledge, and the merchant receives them once the commitment is fulfilled." },
  { q: "How does a pledge work?", a: "You create a pledge by specifying the merchant address, total amount, and commitment deadline. You lock an initial deposit (percentage depends on your trust score) and pay the rest before the deadline. The merchant receives the full amount minus a 1% protocol fee once you complete the deposit." },
  { q: "What happens if I miss the deadline?", a: "If you miss the commitment deadline, a 3-day grace period begins. You can still deposit during grace. After grace ends, the merchant can claim your locked deposit. Your trust score will also decrease, raising future deposit requirements." },
  { q: "What is a trust score?", a: "Your trust score (0–100) is calculated on-chain from your pledge history. On-time completions increase it; defaults decrease it. A higher score means a higher active pledge cap and a lower required upfront deposit — up to 5 active pledges and only 10% deposit at score 90+." },
  { q: "Which network does RemitSafe use?", a: "RemitSafe runs on Morph L2 Hoodi Testnet (chainId 2818). You'll need to add the network to MetaMask: RPC rpc-hoodi.morph.network, currency ETH. Transfers use USDC (test token) — get free USDC from the Wallet page faucet." },
  { q: "How do I add Morph Hoodi to MetaMask?", a: "Open MetaMask → Networks → Add network manually. Network name: Morph Hoodi Testnet. RPC URL: https://rpc-hoodi.morphl2.io. Chain ID: 2818. Currency: ETH. Explorer: https://explorer-hoodi.morphl2.io." },
  { q: "Can I cancel a pledge?", a: "Yes — if both the sender and merchant agree, the pledge can be mutually cancelled and the deposit is refunded. One-sided cancellation is not available once funds are locked to protect the merchant." },
  { q: "How does the merchant side work?", a: "Merchants access the /merchant section to see incoming transfers, track sender trust scores, and claim defaulted deposits. Merchants receive USDC directly to their wallet when a pledge completes." },
];

const LINKS = [
  { label: "Smart contract on explorer", href: "https://explorer-hoodi.morphl2.io", Icon: ExternalLink },
  { label: "Morph L2 documentation", href: "https://docs.morphl2.io", Icon: FileText },
  { label: "GitHub repository", href: "https://github.com", Icon: FileText },
];

function FAQItem({ q, a }: FAQ) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`border-b border-[#1e2230] last:border-0 transition-colors ${open ? "bg-[#15181f]" : ""}`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-6 py-4 text-left gap-4">
        <span className="text-sm font-semibold text-white">{q}</span>
        {open ? <ChevronUp size={16} color="#555" className="shrink-0" /> : <ChevronDown size={16} color="#555" className="shrink-0" />}
      </button>
      {open && <div className="px-6 pb-5 text-sm text-[#888] leading-relaxed">{a}</div>}
    </div>
  );
}

function MobileFAQItem({ q, a }: FAQ) {
  const [open, setOpen] = useState(false);
  return (
    <div className={`bg-[#11141A] border border-[#1F2127] rounded-2xl mb-2.5 overflow-hidden`}>
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3">
        <span className="text-sm font-semibold text-white">{q}</span>
        {open ? <ChevronUp size={15} color="#555" className="shrink-0" /> : <ChevronDown size={15} color="#555" className="shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4 text-sm text-[#888] leading-relaxed">{a}</div>}
    </div>
  );
}

export default function Help() {
  /* ── DESKTOP ── */
  const DesktopHelp = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Help & FAQ</h1>
      <p className="text-[#555] text-sm mb-8">Everything you need to know about using RemitSafe.</p>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        {/* FAQ */}
        <div>
          <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">FREQUENTLY ASKED QUESTIONS</div>
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
            {FAQS.map((f) => <FAQItem key={f.q} {...f} />)}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {/* Quick start */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">QUICK START</div>
            <div className="space-y-3">
              <QuickStep n={1} Icon={Wallet} label="Connect MetaMask" sub="Add Morph Hoodi network and connect your wallet" />
              <QuickStep n={2} Icon={Wallet} label="Get test USDC" sub="Mint free USDC from the Wallet faucet" />
              <QuickStep n={3} Icon={Send} label="Create a pledge" sub="Enter merchant address, amount, and deadline" />
              <QuickStep n={4} Icon={Shield} label="Complete deposit" sub="Pay remaining balance before deadline to release funds" />
            </div>
          </div>

          {/* Network info */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">NETWORK</div>
            <div className="space-y-0 text-sm">
              <InfoRow label="Name" value="Morph Hoodi Testnet" />
              <InfoRow label="Chain ID" value="2818" />
              <InfoRow label="RPC" value="rpc-hoodi.morphl2.io" />
              <InfoRow label="Currency" value="ETH" last />
            </div>
          </div>

          {/* Links */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">RESOURCES</div>
            <div className="space-y-2">
              {LINKS.map(({ label, href, Icon }) => (
                <a key={label} href={href} target="_blank" rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2.5 rounded-xl bg-[#0e1014] border border-[#1e2230] hover:border-[#333] transition-colors text-sm text-white no-underline">
                  <div className="flex items-center gap-2.5">
                    <Icon size={13} color="#555" />
                    <span>{label}</span>
                  </div>
                  <ExternalLink size={11} color="#333" />
                </a>
              ))}
            </div>
          </div>

          {/* Contact */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={15} color="#DDE048" />
              <div className="text-[11px] text-[#555] tracking-[1.5px]">SUPPORT</div>
            </div>
            <p className="text-xs text-[#555] leading-relaxed">This is a hackathon project on Morph L2 Hoodi Testnet. All funds are test tokens with no real value.</p>
          </div>
        </div>
      </div>
    </div>
  );

  /* ── MOBILE ── */
  const MobileHelp = (
    <div className="md:hidden min-h-screen">
      <Header title="Help & FAQ" back />
      <div className="px-4 pt-5 pb-[120px]">
        {/* Quick start */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-5">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-4">QUICK START</div>
          <div className="space-y-3">
            <MobileQuickStep n={1} label="Connect MetaMask" sub="Add Morph Hoodi · chainId 2818" />
            <MobileQuickStep n={2} label="Get test USDC" sub="Wallet page → Mint 1,000 USDC" />
            <MobileQuickStep n={3} label="Create a pledge" sub="New Transfer → fill in details" />
            <MobileQuickStep n={4} label="Complete deposit" sub="Pay before deadline to release funds" />
          </div>
        </div>

        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">FAQ</div>
        {FAQS.map((f) => <MobileFAQItem key={f.q} {...f} />)}

        {/* Network card */}
        <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 mt-4">
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">NETWORK INFO</div>
          <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#666]">Network</span><span>Morph Hoodi Testnet</span></div>
          <div className="flex justify-between py-2 border-b border-[#1F2127] text-sm"><span className="text-[#666]">Chain ID</span><span>2818</span></div>
          <div className="flex justify-between py-2 text-sm"><span className="text-[#666]">RPC</span><span className="font-mono text-xs">rpc-hoodi.morphl2.io</span></div>
        </div>

        <p className="text-xs text-[#555] text-center mt-6 leading-relaxed">Hackathon project on Morph L2 Hoodi Testnet. All funds are test tokens.</p>
      </div>
    </div>
  );

  return (
    <>
      {DesktopHelp}
      {MobileHelp}
    </>
  );
}

function QuickStep({ n, Icon, label, sub }: { n: number; Icon: React.ElementType; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-[#DDE048]/10 border border-[#DDE048]/30 flex items-center justify-center text-[11px] font-bold text-[#DDE048] shrink-0 mt-0.5">{n}</div>
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-xs text-[#555] mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

function MobileQuickStep({ n, label, sub }: { n: number; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-6 h-6 rounded-full bg-[#DDE048]/10 border border-[#DDE048]/30 flex items-center justify-center text-[11px] font-bold text-[#DDE048] shrink-0 mt-0.5">{n}</div>
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        <div className="text-xs text-[#666] mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

function InfoRow({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div className={`flex justify-between py-2.5 text-sm ${last ? "" : "border-b border-[#1e2230]"}`}>
      <span className="text-[#555]">{label}</span>
      <span className="text-white font-mono text-xs">{value}</span>
    </div>
  );
}

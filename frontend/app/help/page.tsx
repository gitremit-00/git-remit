"use client";
import Header from "../../components/Header";
import { ChevronDown, ChevronUp, MessageCircle, Shield, Wallet, Send, AlertTriangle, Clock, TrendingUp, Lock, Store } from "lucide-react";
import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useRole } from "../../context/RoleContext";

interface FAQ { q: string; a: string; }

const SENDER_FAQS: FAQ[] = [
  { q: "What is RemitSafe?", a: "RemitSafe is a decentralized remittance platform built for OFWs (Overseas Filipino Workers) to send money to merchants and family businesses in the Philippines. Unlike traditional remittance services, RemitSafe uses smart contracts to escrow funds — no intermediaries hold your money, and every transfer is publicly verifiable on-chain. Transfers settle in USDC, eliminating currency conversion risk on the sending side." },
  { q: "How does a pledge work?", a: "A pledge is a binding on-chain commitment between you and a registered merchant. You specify the total amount, the merchant's wallet address, and a commitment deadline of up to 90 days. At creation, you lock an initial deposit based on your trust score tier. You pay the remaining balance any time before the deadline. Once fully funded, the merchant receives the amount and the 1% service fee is deducted from your total. The entire flow is trustless — neither party can unilaterally access funds outside the rules of the contract." },
  { q: "Can I pay the full amount upfront?", a: "Yes. When creating a new transfer, toggle 'Pay in full' on the amount step. This sets your initial deposit to the full pledge amount plus the 1% service fee, and auto-assigns a commitment date 85 days out. The pledge is effectively complete at creation — the merchant receives payment as soon as the contract confirms the full amount is locked. Paying in full skips the date selection step and is the fastest way to release funds to the merchant." },
  { q: "How does the upfront deposit work?", a: "When you create a pledge, you must lock an initial deposit immediately — the percentage depends on your trust score. New wallets (score 0–49) lock 20% upfront and can hold 1 active pledge. Score 50–79 locks 15% with up to 3 active pledges. Score 80–89 locks 12% with up to 4 active pledges. Score 90–100 unlocks the best tier at 10% with up to 5 active pledges. The remaining balance is due before the commitment deadline. This deposit protects the merchant in case of default." },
  { q: "What is my trust score and how do I improve it?", a: "Your trust score (0–100) is an on-chain reputation score calculated entirely from your pledge history. It increases each time you complete a pledge on time and decreases when you default. A higher score unlocks lower deposit requirements and a higher active pledge cap — at score 90+ you only need to lock 10% upfront and can hold up to 5 pledges at once. New wallets start at 0. There is no manual override; improve it by completing pledges reliably." },
  { q: "How does my trust score decrease?", a: "Your score is a weighted average across all your pledge history, where each pledge is weighted by its transfer amount. Completing a pledge on time contributes its full value to the average (100% weight). Paying late during the 3-day grace period contributes only 70% — pulling your average down slightly. Defaulting contributes 0% — the pledge amount is added to the total weight but nothing is added to your score, which pulls the average down significantly. Larger pledges have proportionally more impact than smaller ones. The only way to recover from a default is to complete future pledges reliably so the average rises again over time." },
  { q: "What is the service fee?", a: "RemitSafe charges a 1% service fee on the total transfer amount, paid by the sender on top of the pledge. For example, a 100 USDC pledge costs 101 USDC total. The merchant always receives the full 100 USDC. There are no hidden fees, foreign exchange markups, or withdrawal charges." },
  { q: "What happens if I miss the deadline?", a: "If you miss your commitment deadline, a 3-day grace period begins automatically. You can still complete the deposit during grace at no extra penalty. If the grace period also expires without full payment, the merchant gains the right to claim your locked deposit as partial compensation, and your trust score will decrease — raising your deposit requirement for future pledges." },
  { q: "Is my USDC safe while it's locked?", a: "Yes. Locked funds are held entirely by the RemitSafe smart contract — not by any company wallet or custodian. Only you can add deposits, only the merchant can claim on completion or after default, and mutual cancellation returns the deposit to you. You can verify the contract address and source code on the Morph Hoodi block explorer at any time." },
  { q: "Can I cancel a pledge?", a: "Pledges can be cancelled only if both you and the merchant agree on-chain. When both parties confirm, your locked deposit is returned in full. One-sided cancellation is not available once funds are locked — this protects merchants from senders who back out without consequence. To cancel, contact the merchant and request a mutual cancellation from the pledge detail page." },
  { q: "How do I track my active pledges?", a: "Your dashboard shows all active transfers with their current progress, commitment deadline, and amount still owed. Each pledge detail page shows a live progress bar, the locked amount, the remaining balance, and the deadline countdown. You can top up any pledge at any time from the pledge detail page." },
];

const MERCHANT_FAQS: FAQ[] = [
  { q: "What is RemitSafe for merchants?", a: "RemitSafe lets you receive USDC payments from OFW senders via smart contract pledges. Senders lock funds on-chain and you receive the full transfer amount directly to your wallet once the pledge is complete — no payment processor, no chargebacks, and no manual reconciliation. Every transfer is publicly verifiable on the blockchain." },
  { q: "How do I receive a transfer?", a: "Senders create a pledge using your wallet address as the destination. You don't need to do anything to accept it — the pledge is directed to your address by the contract. You will see incoming pledges on your merchant dashboard as soon as they are created on-chain. When the sender fully funds the pledge, the USDC is released to your wallet automatically." },
  { q: "When do I actually receive the USDC?", a: "You receive USDC the moment a pledge is fully funded. There is no withdrawal step — the contract transfers the amount directly to your wallet. If a sender pays in full at creation, the funds arrive almost immediately. If they pay in installments, the funds release once the final deposit brings the total to 100%." },
  { q: "What is the service fee and does it affect me?", a: "The 1% service fee is paid by the sender on top of the pledge amount. As a merchant, you receive the full pledged amount — the fee does not come out of your payment. For example, if a sender creates a 500 USDC pledge, they pay 505 USDC and you receive 500 USDC." },
  { q: "What happens if a sender misses the deadline?", a: "If a sender misses their commitment deadline, a 3-day grace period begins. You cannot claim anything during grace — the sender can still complete the payment at no penalty. If grace expires without full payment, you gain the right to claim the sender's locked deposit from the pledge detail page. This deposit is partial compensation; it is not the full pledge amount unless the sender had already locked the full amount." },
  { q: "How do I claim a defaulted pledge?", a: "Navigate to the defaulted pledge on your merchant dashboard, open the detail page, and tap 'Claim deposit'. This triggers an on-chain transaction that transfers the sender's locked deposit to your wallet. You will need a small amount of ETH for the gas fee. Claiming is final — once claimed, the pledge is closed." },
  { q: "Can a sender cancel a pledge without my agreement?", a: "No. One-sided cancellation is not permitted once funds are locked in the contract. A pledge can only be cancelled if both you and the sender confirm the cancellation on-chain. If a sender requests a cancellation you disagree with, you are not obligated to sign — your funds remain protected." },
  { q: "How can I evaluate a sender before accepting a transfer?", a: "Every sender has a public on-chain trust score (0–100) derived from their full pledge history. From your merchant dashboard you can see each sender's score, their count of completed, late, and defaulted pledges. A high score (80+) indicates a reliable sender; a score below 50 means they are new or have a history of defaults. Use this to decide whether to engage with a sender before they create a pledge to your address." },
  { q: "Can multiple senders send to me at the same time?", a: "Yes. There is no limit on how many senders can create pledges directed to your wallet address. All incoming pledges appear on your merchant dashboard regardless of how many are active. Each pledge is independent — funding, deadlines, and claims are tracked separately per pledge." },
  { q: "What happens to my funds if there is a smart contract bug?", a: "RemitSafe's contracts are deployed on a testnet environment. The platform is under active development and no formal third-party audit has been completed yet. Do not use this for real-value transfers. All USDC on the Hoodi Testnet is test currency with no monetary value. A mainnet deployment will only follow a comprehensive security audit." },
];

function FAQItem({ q, a, open, onToggle, id }: FAQ & { open: boolean; onToggle: () => void; id?: string }) {
  return (
    <div id={id} className={`border-b border-[#1e2230] last:border-0 transition-colors ${open ? "bg-[#15181f]" : ""}`}>
      <button onClick={onToggle} className="w-full flex items-center justify-between px-6 py-4 text-left gap-4">
        <span className="text-sm font-semibold text-white">{q}</span>
        {open ? <ChevronUp size={16} color="#555" className="shrink-0" /> : <ChevronDown size={16} color="#555" className="shrink-0" />}
      </button>
      {open && <div className="px-6 pb-5 text-sm text-[#888] leading-relaxed">{a}</div>}
    </div>
  );
}

function MobileFAQItem({ q, a, defaultOpen, id }: FAQ & { defaultOpen?: boolean; id?: string }) {
  const [open, setOpen] = useState(defaultOpen ?? false);
  return (
    <div id={id} className="bg-[#11141A] border border-[#1F2127] rounded-2xl mb-2.5 overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-4 py-3.5 text-left gap-3">
        <span className="text-sm font-semibold text-white">{q}</span>
        {open ? <ChevronUp size={15} color="#555" className="shrink-0" /> : <ChevronDown size={15} color="#555" className="shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4 text-sm text-[#888] leading-relaxed">{a}</div>}
    </div>
  );
}

export default function Help() {
  return (
    <Suspense>
      <HelpContent />
    </Suspense>
  );
}

function HelpContent() {
  const { role } = useRole();
  const isMerchant = role === "merchant";
  const FAQS = isMerchant ? MERCHANT_FAQS : SENDER_FAQS;
  const searchParams = useSearchParams();

  const [openStates, setOpenStates] = useState<boolean[]>(FAQS.map(() => false));
  const allClosed = openStates.every((v) => !v);

  const autoOpenIdx = (() => {
    const param = searchParams.get("open");
    if (!param || isMerchant) return -1;
    if (param === "trust-score-decrease") return SENDER_FAQS.findIndex(f => f.q.includes("decrease"));
    if (param === "trust-score-improve") return SENDER_FAQS.findIndex(f => f.q.includes("improve"));
    return -1;
  })();

  useEffect(() => {
    if (autoOpenIdx === -1) return;
    setOpenStates(s => s.map((_, i) => i === autoOpenIdx));
    const id = `faq-desktop-${autoOpenIdx}`;
    const idMobile = `faq-mobile-${autoOpenIdx}`;
    const tryScroll = (attempts = 0) => {
      const el = document.getElementById(id) || document.getElementById(idMobile);
      if (el) { el.scrollIntoView({ behavior: "smooth", block: "center" }); return; }
      if (attempts < 5) setTimeout(() => tryScroll(attempts + 1), 80);
    };
    setTimeout(() => tryScroll(), 100);
  }, [autoOpenIdx]);

  function toggleFaq(i: number) { setOpenStates((s) => s.map((v, j) => (j === i ? !v : v))); }
  function toggleAll() { setOpenStates(FAQS.map(() => allClosed)); }

  /* ── DESKTOP ── */
  const DesktopHelp = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Help & FAQ</h1>
      <p className="text-[#555] text-sm mb-1">
        {isMerchant ? "Everything merchants need to know about receiving transfers on RemitSafe." : "Everything OFW senders need to know about using RemitSafe."}
      </p>
      <div className="inline-flex items-center gap-1.5 mb-8 mt-2">
        <div className="w-1.5 h-1.5 rounded-full bg-[#DDE048]" />
        <span className="text-[11px] text-[#555]">
          {isMerchant ? "Viewing as Merchant" : "Viewing as OFW Sender"}
        </span>
      </div>

      <div className="grid grid-cols-[1fr_300px] gap-6">
        {/* FAQ */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="text-[11px] text-[#555] tracking-[1.5px]">FREQUENTLY ASKED QUESTIONS</div>
            <button onClick={toggleAll} className="text-[11px] text-[#555] hover:text-[#ccc] transition-colors">
              {allClosed ? "Expand all" : "Hide all"}
            </button>
          </div>
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">
            {FAQS.map((f, i) => <FAQItem key={f.q} {...f} open={openStates[i]} onToggle={() => toggleFaq(i)} id={`faq-desktop-${i}`} />)}
          </div>
        </div>

        {/* Right sidebar */}
        <div className="space-y-5">
          {isMerchant ? (
            <>
              {/* Merchant quick reference */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-4">
                  <Store size={14} color="#DDE048" />
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">MERCHANT QUICK REF</div>
                </div>
                <div className="space-y-3">
                  <QuickStep n={1} Icon={Wallet} label="Share your address" sub="Give senders your wallet address to receive pledges" />
                  <QuickStep n={2} Icon={Shield} label="Monitor incoming pledges" sub="Track sender trust scores from your dashboard" />
                  <QuickStep n={3} Icon={Send} label="Funds release automatically" sub="USDC sent to your wallet when pledge is complete" />
                  <QuickStep n={4} Icon={AlertTriangle} label="Claim defaults" sub="Claim locked deposit after grace period expires" />
                </div>
              </div>

              {/* Merchant protections */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Lock size={14} color="#DDE048" />
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">YOUR PROTECTIONS</div>
                </div>
                <div className="space-y-3">
                  <ProtectionRow Icon={Shield} label="Locked deposit guarantee" sub="Sender must lock funds before the pledge is active" />
                  <ProtectionRow Icon={Clock} label="Grace period visibility" sub="You see grace status in real time on your dashboard" />
                  <ProtectionRow Icon={AlertTriangle} label="No forced cancellation" sub="Only mutual agreement can cancel a locked pledge" />
                  <ProtectionRow Icon={TrendingUp} label="Sender reputation" sub="View trust score and full history before engaging" />
                </div>
              </div>
            </>
          ) : (
            <>
              {/* Sender quick start */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="text-[11px] text-[#555] tracking-[1.5px] mb-4">QUICK START</div>
                <div className="space-y-3">
                  <QuickStep n={1} Icon={Wallet} label="Connect MetaMask" sub="Connect your MetaMask wallet to get started" />
                  <QuickStep n={2} Icon={Wallet} label="Get test USDC" sub="Mint free USDC from the Wallet faucet" />
                  <QuickStep n={3} Icon={Send} label="Create a pledge" sub="Enter merchant address, amount, and deadline" />
                  <QuickStep n={4} Icon={Shield} label="Complete deposit" sub="Pay remaining balance before deadline to release funds" />
                </div>
              </div>

              {/* Trust score tiers */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} color="#DDE048" />
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">TRUST SCORE TIERS</div>
                </div>
                <div className="space-y-2.5">
                  {[
                    { range: "0 – 49", label: "New sender", deposit: "20% deposit", cap: "1 active pledge", color: "#ef4444" },
                    { range: "50 – 79", label: "Good standing", deposit: "15% deposit", cap: "3 active pledges", color: "#f59e0b" },
                    { range: "80 – 89", label: "Trusted sender", deposit: "12% deposit", cap: "4 active pledges", color: "#DDE048" },
                    { range: "90 – 100", label: "Elite OFW", deposit: "10% deposit", cap: "5 active pledges", color: "#22c55e" },
                  ].map(({ range, label, deposit, cap, color }) => (
                    <div key={range} className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-bold" style={{ color }}>{label}</div>
                        <div className="text-[10px] text-[#555] mt-0.5">Score {range}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-white font-semibold">{deposit}</div>
                        <div className="text-[10px] text-[#555] mt-0.5">{cap}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Score impact breakdown */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp size={14} color="#DDE048" />
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">HOW SCORE IS AFFECTED</div>
                </div>
                <p className="text-[10px] text-[#555] mb-3 leading-relaxed">Each pledge is weighted by its transfer amount. Larger pledges have more impact on your score.</p>
                <div className="space-y-2.5">
                  <ScoreImpactRow color="#22c55e" label="On-time completion" weight="100%" effect="Score increases" />
                  <ScoreImpactRow color="#f59e0b" label="Late (paid in grace)" weight="70%" effect="Score decreases slightly" />
                  <ScoreImpactRow color="#ef4444" label="Default" weight="0%" effect="Score decreases significantly" />
                </div>
                <p className="text-[10px] text-[#555] mt-3 leading-relaxed">Recover from a default by completing future pledges on time — the weighted average rises again over time.</p>
              </div>

              {/* Sender protections */}
              <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
                <div className="flex items-center gap-2 mb-3">
                  <Lock size={14} color="#DDE048" />
                  <div className="text-[11px] text-[#555] tracking-[1.5px]">YOUR PROTECTIONS</div>
                </div>
                <div className="space-y-3">
                  <ProtectionRow Icon={Shield} label="Non-custodial" sub="Funds held by smart contract, not RemitSafe" />
                  <ProtectionRow Icon={Clock} label="Grace period" sub="3-day grace window after every missed deadline" />
                  <ProtectionRow Icon={AlertTriangle} label="Mutual cancellation" sub="Both parties must agree before a pledge is cancelled" />
                  <ProtectionRow Icon={TrendingUp} label="On-chain reputation" sub="Trust score computed by contract, not manually" />
                </div>
              </div>
            </>
          )}

          {/* Support — same for both roles */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-2">
              <MessageCircle size={15} color="#DDE048" />
              <div className="text-[11px] text-[#555] tracking-[1.5px]">SUPPORT</div>
            </div>
            <p className="text-xs text-[#555] leading-relaxed">For questions, bug reports, or feedback, open an issue on the RemitSafe GitHub repository. Include your wallet address and the pledge transaction hash when reporting issues.</p>
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

        {/* Role badge */}
        <div className="flex items-center gap-2 mb-4 px-1">
          <div className="w-1.5 h-1.5 rounded-full bg-[#DDE048]" />
          <span className="text-[11px] text-[#555]">{isMerchant ? "Viewing as Merchant" : "Viewing as OFW Sender"}</span>
        </div>

        {isMerchant ? (
          <>
            {/* Merchant quick ref */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-4">MERCHANT QUICK REF</div>
              <div className="space-y-3">
                <MobileQuickStep n={1} label="Share your address" sub="Give senders your wallet address" />
                <MobileQuickStep n={2} label="Monitor incoming pledges" sub="Check sender trust scores on dashboard" />
                <MobileQuickStep n={3} label="Funds release automatically" sub="USDC sent to your wallet on completion" />
                <MobileQuickStep n={4} label="Claim defaults" sub="Claim locked deposit after grace expires" />
              </div>
            </div>

            {/* Merchant protections */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">YOUR PROTECTIONS</div>
              <div className="space-y-3">
                <ProtectionRow Icon={Shield} label="Locked deposit guarantee" sub="Sender must lock funds before pledge is active" />
                <ProtectionRow Icon={Clock} label="Grace period visibility" sub="Real-time grace status on your dashboard" />
                <ProtectionRow Icon={AlertTriangle} label="No forced cancellation" sub="Only mutual agreement cancels a locked pledge" />
                <ProtectionRow Icon={TrendingUp} label="Sender reputation" sub="View trust score and history before engaging" />
              </div>
            </div>
          </>
        ) : (
          <>
            {/* Sender quick start */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-4">QUICK START</div>
              <div className="space-y-3">
                <MobileQuickStep n={1} label="Connect MetaMask" sub="Connect your MetaMask wallet" />
                <MobileQuickStep n={2} label="Get test USDC" sub="Wallet page → Mint 1,000 USDC" />
                <MobileQuickStep n={3} label="Create a pledge" sub="New Transfer → fill in details" />
                <MobileQuickStep n={4} label="Complete deposit" sub="Pay before deadline to release funds" />
              </div>
            </div>

            {/* Trust score tiers */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">TRUST SCORE TIERS</div>
              <div className="space-y-2.5">
                {[
                  { range: "0 – 49", label: "New sender", deposit: "20%", cap: "1 pledge", color: "#ef4444" },
                  { range: "50 – 79", label: "Good standing", deposit: "15%", cap: "3 pledges", color: "#f59e0b" },
                  { range: "80 – 89", label: "Trusted sender", deposit: "12%", cap: "4 pledges", color: "#DDE048" },
                  { range: "90 – 100", label: "Elite OFW", deposit: "10%", cap: "5 pledges", color: "#22c55e" },
                ].map(({ range, label, deposit, cap, color }) => (
                  <div key={range} className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold" style={{ color }}>{label}</div>
                      <div className="text-[10px] text-[#555]">Score {range}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-white font-semibold">{deposit} deposit</div>
                      <div className="text-[10px] text-[#555]">{cap} max</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Score impact breakdown */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">HOW SCORE IS AFFECTED</div>
              <p className="text-[10px] text-[#555] mb-3 leading-relaxed">Each pledge is weighted by its transfer amount. Larger pledges have more impact.</p>
              <div className="space-y-2.5">
                <ScoreImpactRow color="#22c55e" label="On-time completion" weight="100%" effect="Score increases" />
                <ScoreImpactRow color="#f59e0b" label="Late (paid in grace)" weight="70%" effect="Score decreases slightly" />
                <ScoreImpactRow color="#ef4444" label="Default" weight="0%" effect="Score decreases significantly" />
              </div>
              <p className="text-[10px] text-[#555] mt-3 leading-relaxed">Recover by completing future pledges on time — the weighted average rises again.</p>
            </div>

            {/* Sender protections */}
            <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-5 mb-4">
              <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">YOUR PROTECTIONS</div>
              <div className="space-y-3">
                <ProtectionRow Icon={Shield} label="Non-custodial" sub="Funds held by smart contract, not RemitSafe" />
                <ProtectionRow Icon={Clock} label="Grace period" sub="3-day grace window after every missed deadline" />
                <ProtectionRow Icon={AlertTriangle} label="Mutual cancellation" sub="Both parties must agree to cancel a pledge" />
                <ProtectionRow Icon={TrendingUp} label="On-chain reputation" sub="Trust score computed by contract, not manually" />
              </div>
            </div>
          </>
        )}

        <div className="text-[10px] text-[#888] tracking-[1.5px] mb-3">FREQUENTLY ASKED QUESTIONS</div>
        {FAQS.map((f, i) => <MobileFAQItem key={f.q} {...f} id={`faq-mobile-${i}`} defaultOpen={autoOpenIdx === i} />)}

        <p className="text-xs text-[#555] text-center mt-6 leading-relaxed">RemitSafe · Non-custodial remittance for OFWs</p>
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

function ScoreImpactRow({ color, label, weight, effect }: { color: string; label: string; weight: string; effect: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: color }} />
        <div>
          <div className="text-xs font-semibold text-white">{label}</div>
          <div className="text-[10px] text-[#555] mt-0.5">{effect}</div>
        </div>
      </div>
      <div className="text-xs font-bold shrink-0" style={{ color }}>{weight}</div>
    </div>
  );
}

function ProtectionRow({ Icon, label, sub }: { Icon: React.ElementType; label: string; sub: string }) {
  return (
    <div className="flex items-start gap-2.5">
      <div className="w-6 h-6 rounded-lg bg-[#DDE048]/5 border border-[#DDE048]/20 flex items-center justify-center shrink-0 mt-0.5">
        <Icon size={12} color="#DDE048" />
      </div>
      <div>
        <div className="text-xs font-semibold text-white">{label}</div>
        <div className="text-[10px] text-[#555] mt-0.5">{sub}</div>
      </div>
    </div>
  );
}

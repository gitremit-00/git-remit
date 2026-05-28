"use client";
import { useState, useEffect } from "react";
import { Bell, Shield, Wallet, Globe, RefreshCw, Trash2, ChevronRight, Check, Copy, LogOut, User, Store, TrendingUp, ArrowLeftRight } from "lucide-react";
import Header from "../../components/Header";
import { useCurrency } from "../../context/CurrencyContext";
import { useWallet } from "../../context/WalletContext";
import { useRole } from "../../context/RoleContext";
import Link from "next/link";

const NOTIF_KEYS = ["notif_reminders", "notif_grace", "notif_completed", "notif_merchant_received"] as const;

function useNotifToggles() {
  const [state, setState] = useState<Record<string, boolean>>({
    notif_reminders: true,
    notif_grace: true,
    notif_completed: true,
    notif_merchant_received: true,
  });

  useEffect(() => {
    const loaded: Record<string, boolean> = {};
    NOTIF_KEYS.forEach((k) => {
      const v = localStorage.getItem(k);
      loaded[k] = v === null ? true : v === "1";
    });
    setState(loaded);
  }, []);

  function toggle(key: string) {
    setState((s) => {
      const next = { ...s, [key]: !s[key] };
      localStorage.setItem(key, next[key] ? "1" : "0");
      return next;
    });
  }

  return { state, toggle };
}

function Toggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors shrink-0 ${on ? "bg-[#DDE048]" : "bg-[#1e2230] border border-[#333]"}`}
    >
      <div className={`w-5 h-5 rounded-full transition-transform ${on ? "bg-black translate-x-5" : "bg-[#555] translate-x-0"}`} />
    </button>
  );
}

function SectionLabel({ label }: { label: string }) {
  return <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">{label}</div>;
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl overflow-hidden">{children}</div>;
}

function Row({ children, border = true }: { children: React.ReactNode; border?: boolean }) {
  return (
    <div className={`flex items-center gap-4 px-5 py-4 ${border ? "border-b border-[#1e2230]" : ""}`}>
      {children}
    </div>
  );
}

function IconBox({ Icon, color = "#888", bg = "bg-[#1e2230]", danger = false }: { Icon: React.ElementType; color?: string; bg?: string; danger?: boolean }) {
  return (
    <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${danger ? "bg-red-500/10" : bg}`}>
      <Icon size={16} color={danger ? "#ef4444" : color} />
    </div>
  );
}

export default function Settings() {
  const { currency, toggle: toggleCurrency, rate } = useCurrency();
  const { account, connect, disconnect } = useWallet();
  const { role } = useRole();
  const { state: notifs, toggle: toggleNotif } = useNotifToggles();
  const [copied, setCopied] = useState(false);
  const [cleared, setCleared] = useState(false);

  const liveRate = `1 USDC ≈ ₱${rate.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;

  function copyAddress() {
    if (!account) return;
    navigator.clipboard.writeText(account);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function clearLocalData() {
    ["rs_sidebar_collapsed", "rs_fx_rate", "rs_fx_rate_at", ...NOTIF_KEYS].forEach((k) => localStorage.removeItem(k));
    setCleared(true);
    setTimeout(() => setCleared(false), 2000);
  }

  const shortAddr = account ? `${account.slice(0, 10)}…${account.slice(-8)}` : "–";

  /* ── DESKTOP ── */
  const Desktop = (
    <div className="hidden md:block p-8">
      <h1 className="text-3xl font-extrabold text-white mb-1">Settings</h1>
      <p className="text-[#555] text-sm mb-8">Manage your account preferences, notifications, and display options.</p>

      <div className="grid grid-cols-[1fr_340px] gap-6 items-start">
        {/* Left column */}
        <div className="space-y-6">

          {/* Account */}
          <div>
            <SectionLabel label="ACCOUNT" />
            <Card>
              <Row>
                <IconBox Icon={role === "merchant" ? Store : User} color="#DDE048" bg="bg-[#DDE048]/10" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{role === "merchant" ? "Merchant account" : "OFW Sender account"}</div>
                  <div className="text-xs text-[#555] mt-0.5">Role assigned during onboarding</div>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#DDE048]/10 text-[#DDE048]">{role === "merchant" ? "Merchant" : "Sender"}</span>
              </Row>
              <Row>
                <IconBox Icon={Wallet} color={account ? "#DDE048" : "#888"} bg={account ? "bg-[#DDE048]/10" : "bg-[#1e2230]"} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">{account ? "Connected wallet" : "No wallet connected"}</div>
                  <div className="text-xs text-[#555] mt-0.5 font-mono">{account ? shortAddr : "Connect MetaMask to use on-chain features"}</div>
                </div>
                {account ? (
                  <button onClick={copyAddress} className="flex items-center gap-1.5 text-xs text-[#555] hover:text-[#ccc] transition-colors">
                    {copied ? <><Check size={13} color="#DDE048" /><span className="text-[#DDE048]">Copied</span></> : <><Copy size={13} /><span>Copy</span></>}
                  </button>
                ) : (
                  <button onClick={connect} className="text-xs font-semibold text-[#DDE048] hover:text-[#c8ce30] transition-colors px-3 py-1.5 bg-[#DDE048]/10 rounded-lg">
                    Connect
                  </button>
                )}
              </Row>
              <Row>
                <IconBox Icon={Shield} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Identity & KYC</div>
                  <div className="text-xs text-[#555] mt-0.5">Facial verification and identity documents</div>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#1e2230] text-[#555]">Coming soon</span>
              </Row>
              {account && (
                <Row border={false}>
                  <IconBox Icon={LogOut} danger />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold text-red-400">Disconnect wallet</div>
                    <div className="text-xs text-[#555] mt-0.5">Clears your wallet connection</div>
                  </div>
                  <button onClick={disconnect} className="text-xs font-semibold text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 bg-red-500/10 rounded-lg">
                    Disconnect
                  </button>
                </Row>
              )}
            </Card>
          </div>

          {/* Notifications */}
          <div>
            <SectionLabel label="NOTIFICATIONS" />
            <Card>
              <Row>
                <IconBox Icon={Bell} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Payment reminders</div>
                  <div className="text-xs text-[#555] mt-0.5">Alerts 3 days and 1 day before your deadline</div>
                </div>
                <Toggle on={notifs.notif_reminders} onToggle={() => toggleNotif("notif_reminders")} />
              </Row>
              <Row>
                <IconBox Icon={Bell} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Grace period alerts</div>
                  <div className="text-xs text-[#555] mt-0.5">Notify when grace period starts or is about to expire</div>
                </div>
                <Toggle on={notifs.notif_grace} onToggle={() => toggleNotif("notif_grace")} />
              </Row>
              <Row>
                <IconBox Icon={Bell} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Pledge completed</div>
                  <div className="text-xs text-[#555] mt-0.5">Notify when funds are fully released to the merchant</div>
                </div>
                <Toggle on={notifs.notif_completed} onToggle={() => toggleNotif("notif_completed")} />
              </Row>
              <Row border={false}>
                <IconBox Icon={Bell} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Transfer received {role === "merchant" ? "(merchant)" : ""}</div>
                  <div className="text-xs text-[#555] mt-0.5">Notify when a new pledge is directed to your address</div>
                </div>
                <Toggle on={notifs.notif_merchant_received} onToggle={() => toggleNotif("notif_merchant_received")} />
              </Row>
            </Card>
          </div>

          {/* Data */}
          <div>
            <SectionLabel label="DATA" />
            <Card>
              <Row border={false}>
                <IconBox Icon={Trash2} danger />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-red-400">Clear local data</div>
                  <div className="text-xs text-[#555] mt-0.5">Removes saved preferences, exchange rate cache, and sidebar state</div>
                </div>
                <button onClick={clearLocalData} className="text-xs font-semibold text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 bg-red-500/10 rounded-lg whitespace-nowrap">
                  {cleared ? "Cleared" : "Clear"}
                </button>
              </Row>
            </Card>
          </div>
        </div>

        {/* Right column */}
        <div className="space-y-6">

          {/* Display currency */}
          <div>
            <SectionLabel label="DISPLAY" />
            <Card>
              <Row>
                <IconBox Icon={ArrowLeftRight} color="#DDE048" bg="bg-[#DDE048]/10" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Display currency</div>
                  <div className="text-xs text-[#555] mt-0.5">Primary value shown across the app</div>
                </div>
              </Row>
              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-2">
                  {(["USD", "PHP"] as const).map((c) => (
                    <button
                      key={c}
                      onClick={() => currency !== c && toggleCurrency()}
                      className={`flex flex-col items-center gap-1 py-3 rounded-xl border transition-all ${currency === c ? "border-[#DDE048] bg-[#DDE048]/5" : "border-[#1e2230] bg-[#0e1014] hover:border-[#333]"}`}
                    >
                      <span className={`text-base font-extrabold ${currency === c ? "text-[#DDE048]" : "text-[#555]"}`}>{c === "USD" ? "$" : "₱"}</span>
                      <span className={`text-xs font-semibold ${currency === c ? "text-white" : "text-[#555]"}`}>{c}</span>
                      {currency === c && <span className="text-[10px] text-[#DDE048]">Active</span>}
                    </button>
                  ))}
                </div>
              </div>

              {/* Live rate */}
              <div className="border-t border-[#1e2230] px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-xs font-semibold text-white">Live exchange rate</div>
                    <div className="text-[11px] text-[#555] mt-0.5">Updated hourly from open.er-api.com</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-bold text-[#DDE048]">{liveRate}</div>
                    <button onClick={() => {
                      localStorage.removeItem("rs_fx_rate");
                      localStorage.removeItem("rs_fx_rate_at");
                      window.location.reload();
                    }} className="flex items-center gap-1 text-[10px] text-[#555] hover:text-[#888] mt-0.5 ml-auto transition-colors">
                      <RefreshCw size={10} /> Refresh
                    </button>
                  </div>
                </div>
              </div>
            </Card>
          </div>

          {/* Transfer corridor */}
          <div>
            <SectionLabel label="CORRIDOR" />
            <Card>
              <Row>
                <IconBox Icon={Globe} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">USA → Philippines</div>
                  <div className="text-xs text-[#555] mt-0.5">{liveRate} · USDC on-chain</div>
                </div>
                <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#22c55e]/10 text-[#22c55e]">Active</span>
              </Row>
              <Row border={false}>
                <IconBox Icon={TrendingUp} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-white">Your trust score</div>
                  <div className="text-xs text-[#555] mt-0.5">Affects deposit % and active pledge cap</div>
                </div>
                <Link href="/profile" className="text-xs text-[#DDE048] font-semibold hover:underline flex items-center gap-1">
                  View <ChevronRight size={12} />
                </Link>
              </Row>
            </Card>
          </div>

          {/* App info */}
          <div className="bg-[#13161c] border border-[#1e2230] rounded-2xl p-5">
            <div className="text-[11px] text-[#555] tracking-[1.5px] mb-3">ABOUT</div>
            <div className="space-y-2 text-xs text-[#555]">
              <div className="flex justify-between"><span>App</span><span className="text-white">RemitSafe</span></div>
              <div className="flex justify-between"><span>Version</span><span className="text-white">1.0.0-beta</span></div>
              <div className="flex justify-between"><span>Service fee</span><span className="text-white">1% per transfer</span></div>
              <div className="flex justify-between"><span>Max pledge duration</span><span className="text-white">90 days</span></div>
              <div className="flex justify-between"><span>Grace period</span><span className="text-white">3 days</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  /* ── MOBILE ── */
  const Mobile = (
    <div className="md:hidden">
      <Header title="Settings" back />
      <div className="px-4 pt-5 pb-24 space-y-5">

        {/* Account */}
        <div>
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">ACCOUNT</div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl overflow-hidden">
            <MRow>
              <MIcon Icon={role === "merchant" ? Store : User} color="#DDE048" />
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">{role === "merchant" ? "Merchant" : "OFW Sender"}</div>
                <div className="text-xs text-[#666]">Your account role</div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#DDE048]/10 text-[#DDE048] font-semibold">{role === "merchant" ? "Merchant" : "Sender"}</span>
            </MRow>
            <MRow>
              <MIcon Icon={Wallet} color={account ? "#DDE048" : "#888"} />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-white">{account ? "Wallet" : "No wallet"}</div>
                <div className="text-xs text-[#666] font-mono truncate">{account ? shortAddr : "Not connected"}</div>
              </div>
              {account ? (
                <button onClick={copyAddress} className="text-xs text-[#555]">
                  {copied ? <Check size={14} color="#DDE048" /> : <Copy size={14} />}
                </button>
              ) : (
                <button onClick={connect} className="text-xs text-[#DDE048] font-semibold px-2.5 py-1 bg-[#DDE048]/10 rounded-lg">Connect</button>
              )}
            </MRow>
            <MRow last={!account}>
              <MIcon Icon={Shield} />
              <div className="flex-1">
                <div className="text-sm font-semibold text-white">Identity & KYC</div>
                <div className="text-xs text-[#666]">Verification documents</div>
              </div>
              <span className="text-[11px] px-2 py-0.5 rounded-full bg-[#1e1e1e] text-[#555]">Soon</span>
            </MRow>
            {account && (
              <MRow last>
                <MIcon Icon={LogOut} danger />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-red-400">Disconnect</div>
                  <div className="text-xs text-[#666]">Clear wallet connection</div>
                </div>
                <button onClick={disconnect} className="text-xs text-red-400 font-semibold px-2.5 py-1 bg-red-500/10 rounded-lg">Disconnect</button>
              </MRow>
            )}
          </div>
        </div>

        {/* Display currency */}
        <div>
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">DISPLAY</div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4">
            <div className="text-xs font-semibold text-white mb-3">Display currency</div>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {(["USD", "PHP"] as const).map((c) => (
                <button
                  key={c}
                  onClick={() => currency !== c && toggleCurrency()}
                  className={`flex items-center justify-center gap-2 py-3 rounded-xl border transition-all ${currency === c ? "border-[#DDE048] bg-[#DDE048]/5" : "border-[#1F2127] bg-[#0e1014]"}`}
                >
                  <span className={`text-base font-extrabold ${currency === c ? "text-[#DDE048]" : "text-[#555]"}`}>{c === "USD" ? "$" : "₱"}</span>
                  <span className={`text-sm font-semibold ${currency === c ? "text-white" : "text-[#555]"}`}>{c}</span>
                </button>
              ))}
            </div>
            <div className="border-t border-[#1F2127] pt-3 flex items-center justify-between">
              <div>
                <div className="text-xs font-semibold text-white">Live rate</div>
                <div className="text-[10px] text-[#666] mt-0.5">Updated hourly</div>
              </div>
              <span className="text-sm font-bold text-[#DDE048]">{liveRate}</span>
            </div>
          </div>
        </div>

        {/* Notifications */}
        <div>
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">NOTIFICATIONS</div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl overflow-hidden">
            {[
              { key: "notif_reminders", label: "Payment reminders", sub: "3 days and 1 day before deadline" },
              { key: "notif_grace", label: "Grace period alerts", sub: "When grace starts or is about to expire" },
              { key: "notif_completed", label: "Pledge completed", sub: "When funds are released to merchant" },
              { key: "notif_merchant_received", label: "Transfer received", sub: "When a pledge is directed to your address" },
            ].map(({ key, label, sub }, i, arr) => (
              <div key={key} className={`flex items-center gap-3.5 px-4 py-3.5 ${i < arr.length - 1 ? "border-b border-[#1F2127]" : ""}`}>
                <MIcon Icon={Bell} />
                <div className="flex-1">
                  <div className="text-sm font-semibold text-white">{label}</div>
                  <div className="text-xs text-[#666]">{sub}</div>
                </div>
                <Toggle on={notifs[key]} onToggle={() => toggleNotif(key)} />
              </div>
            ))}
          </div>
        </div>

        {/* App info */}
        <div>
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">ABOUT</div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl p-4 space-y-2 text-xs">
            {[
              ["App", "RemitSafe"],
              ["Version", "1.0.0-beta"],
              ["Service fee", "1% per transfer"],
              ["Max pledge duration", "90 days"],
              ["Grace period", "3 days"],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between">
                <span className="text-[#666]">{label}</span>
                <span className="text-white font-semibold">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Data */}
        <div>
          <div className="text-[10px] text-[#888] tracking-[1.5px] mb-2">DATA</div>
          <div className="bg-[#11141A] border border-[#1F2127] rounded-2xl overflow-hidden">
            <MRow last>
              <MIcon Icon={Trash2} danger />
              <div className="flex-1">
                <div className="text-sm font-semibold text-red-400">Clear local data</div>
                <div className="text-xs text-[#666]">Preferences, rate cache, sidebar state</div>
              </div>
              <button onClick={clearLocalData} className="text-xs text-red-400 font-semibold px-2.5 py-1 bg-red-500/10 rounded-lg">
                {cleared ? "Done" : "Clear"}
              </button>
            </MRow>
          </div>
        </div>
      </div>
    </div>
  );

  return <>{Desktop}{Mobile}</>;
}

function MRow({ children, last = false }: { children: React.ReactNode; last?: boolean }) {
  return (
    <div className={`flex items-center gap-3.5 px-4 py-3.5 ${!last ? "border-b border-[#1F2127]" : ""}`}>
      {children}
    </div>
  );
}

function MIcon({ Icon, color = "#888", danger = false }: { Icon: React.ElementType; color?: string; danger?: boolean }) {
  return (
    <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 ${danger ? "bg-red-500/10" : "bg-[#1e1e1e]"}`}>
      <Icon size={15} color={danger ? "#ef4444" : color} />
    </div>
  );
}

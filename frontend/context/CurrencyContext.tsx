"use client";
import { createContext, useContext, useEffect, useState } from "react";

const FALLBACK_RATE = 56;

export type DisplayCurrency = "USD" | "PHP";

interface CurrencyContextValue {
  currency: DisplayCurrency;
  rate: number;
  toggle: () => void;
  fmt: (usdc: number) => string;
  fmtSub: (usdc: number) => string;
  /** Always returns the opposite currency label — the subtitle conversion */
  fmtAlt: (usdc: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue>({
  currency: "PHP",
  rate: FALLBACK_RATE,
  toggle: () => {},
  fmt: (u) => `₱${(u * FALLBACK_RATE).toLocaleString()}`,
  fmtSub: (u) => `₱${(u * FALLBACK_RATE).toLocaleString()} PHP`,
  fmtAlt: (u) => `${u.toFixed(2)} USDC`,
});

export function CurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrency] = useState<DisplayCurrency>("PHP");
  const [rate, setRate] = useState<number>(FALLBACK_RATE);

  useEffect(() => {
    const saved = localStorage.getItem("rs_currency") as DisplayCurrency | null;
    if (saved === "USD" || saved === "PHP") setCurrency(saved);

    // Fetch live USD → PHP rate; cache for 1 hour
    const cached = localStorage.getItem("rs_fx_rate");
    const cachedAt = Number(localStorage.getItem("rs_fx_rate_at") || 0);
    if (cached && Date.now() - cachedAt < 60 * 60 * 1000) {
      setRate(Number(cached));
      return;
    }
    fetch("https://open.er-api.com/v6/latest/USD")
      .then((r) => r.json())
      .then((data) => {
        const r = data?.rates?.PHP;
        if (r && typeof r === "number") {
          setRate(r);
          localStorage.setItem("rs_fx_rate", String(r));
          localStorage.setItem("rs_fx_rate_at", String(Date.now()));
        }
      })
      .catch(() => {});
  }, []);

  function toggle() {
    setCurrency((c) => {
      const next = c === "PHP" ? "USD" : "PHP";
      localStorage.setItem("rs_currency", next);
      return next;
    });
  }

  function toPhp(usdc: number) {
    return `₱${(usdc * rate).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }

  function fmt(usdc: number): string {
    if (currency === "PHP") return toPhp(usdc);
    return `$${usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  function fmtSub(usdc: number): string {
    if (currency === "PHP") return `${toPhp(usdc)} PHP`;
    return `$${usdc.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} USD`;
  }

  function fmtAlt(usdc: number): string {
    if (currency === "PHP") return `${usdc.toFixed(2)} USDC`;
    return `${toPhp(usdc)} PHP`;
  }

  return (
    <CurrencyContext.Provider value={{ currency, rate, toggle, fmt, fmtSub, fmtAlt }}>
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() { return useContext(CurrencyContext); }
